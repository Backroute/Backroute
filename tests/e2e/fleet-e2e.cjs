// Rounds D2 and D3 against the stand-ins: truck routing, planning the fleet together, moving an idle truck to the
// freight, remembering slow docks, compliance deadlines, CSV downloads and the support team's numbers.
const path = require("path");
const S = path.join(__dirname, "..");
const ROOT = path.join(__dirname, "../..");
const crypto = require("crypto");
const fs = require("fs");
const { execSync } = require("child_process");
const BASE = "http://localhost:3210";
let passed = 0, failed = 0;
const check = (label, ok, extra = "") => { ok ? passed++ : failed++; console.log(`${ok ? "PASS" : "FAIL"} ${label}${extra ? ` (${String(extra).slice(0, 300)})` : ""}`); };
const db = (q) => execSync(`su postgres -c "/usr/lib/postgresql/16/bin/psql -h /var/lib/postgresql/backroute-test -p 55432 -U postgres -d rest -tA -c \\"${q.replace(/"/g, '\\\\\\"')}\\""`).toString().trim();
const read = (f) => fs.readFileSync(`${S}/fakes/${f}.jsonl`, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const cid = fs.readFileSync(`${S}/fakes/carrier.txt`, "utf8").trim();
const token = (sub, phone) => execSync(`node ${S}/pgrst/jwt.cjs ${sub} ${phone}`).toString();
const OWNER = token("aaaaaaaa-0000-0000-0000-000000000001", "12145550100");
const SUPPORT = token("cccccccc-0000-0000-0000-000000000005", "13125550100");
const auth = (t = OWNER) => ({ authorization: `Bearer ${t}` });
const cron = () => fetch(`${BASE}/api/cron/dispatch`, { headers: { authorization: "Bearer cron-secret" } }).then((r) => r.json());
const settings = (patch) => db(`update carriers set settings = settings || '${JSON.stringify(patch)}'::jsonb where id = '${cid}'`);
const load = (ref) => JSON.parse(db(`select data from loads where carrier_id = '${cid}' and data->>'referenceNumber' = '${ref}'`) || "null");
const truckBy = (unit) => JSON.parse(db(`select data from trucks where carrier_id = '${cid}' and unit_number = '${unit}'`));
const setTruck = (unit, patch) => db(`update trucks set data = data || '${JSON.stringify(patch)}'::jsonb where carrier_id = '${cid}' and unit_number = '${unit}'`);
const feed = (loads) => fs.writeFileSync(`${S}/fakes/feed2.json`, JSON.stringify(loads));
const inDays = (d, hhmm) => new Date(Date.now() + d * 86400000).toISOString().slice(0, 10) + "T" + hhmm;
const acme = (o) => ({ originCity: "Memphis", originState: "TN", pickupLocal: inDays(1, "09:00"), equipment: "Dry Van", brokerName: "Acme Freight", brokerEmail: "dispatch@acmefreight.test", brokerMc: "555001", ...o });
const esc = (like) => db(`select status || '|' || (data->>'reason') from escalations where carrier_id = '${cid}' and data->>'reason' like '${like.replace(/'/g, "''")}' order by (data->>'createdAt') desc limit 1`);
const texts = (i, to) => read("twilio").slice(i).filter((x) => x.params.To === to && x.params.Body).map((x) => x.params.Body);
const key = db(`select inbound_key from carriers where id = '${cid}'`);
const copyLoad = (id, patch, stage) => db(`insert into loads (id, carrier_id, truck_id, stage, data) select '${id}', carrier_id, truck_id, '${stage}', data || '${JSON.stringify({ id, stage, ...patch })}'::jsonb from loads where carrier_id = '${cid}' and data->>'referenceNumber' = 'CFP-88213' on conflict do nothing`);
function freeTrucks() {
  db(`update loads set stage = 'declined', data = data || '{"stage":"declined"}'::jsonb where carrier_id = '${cid}' and stage in ('offered', 'negotiating', 'booked', 'dispatched', 'at_pickup', 'in_transit', 'at_delivery')`);
  db(`update trucks set data = data || '{"nextLoadId":null,"currentLoadId":null,"status":"available"}'::jsonb where carrier_id = '${cid}'`);
}
const MARCUS = "+12145550148";

(async () => {
  settings({ autonomy: "rules", driverCheckins: false, checkCallEmails: false });
  freeTrucks();
  await fetch(`${BASE}/api/integrations`, { method: "POST", headers: { "content-type": "application/json", ...auth() }, body: JSON.stringify({ kind: "load_feed", url: "http://localhost:3009/feed2.json", format: "json", name: "Test feed" }) });

  // ── Truck routing ────────────────────────────────────────────────────────
  feed([acme({ loadNumber: "RT-1", destinationCity: "Nashville", destinationState: "TN", rate: 700 })]);
  let b0 = read("boards").length;
  await cron();
  const here = read("boards").slice(b0).filter((x) => x.board === "here");
  const expected = await fetch("http://localhost:3009/here-router/v8/routes?transportMode=truck&origin=35.1495,-90.049&destination=36.1627,-86.7816&apiKey=here-key").then((r) => r.json());
  const miles = Math.round(expected.routes[0].sections[0].summary.length / 1609.34);
  check("a load posted without miles gets real truck-route miles", load("RT-1")?.lane.miles === miles && here.some((x) => x.mode === "truck") && here.some((x) => x.key === "here-key"), `${load("RT-1")?.lane.miles} vs ${miles}`);

  // ── The whole fleet at once ──────────────────────────────────────────────
  freeTrucks();
  const reefer = truckBy("102").equipmentType;
  setTruck("102", { equipmentType: "Dry Van", currentCity: "Nashville", currentState: "TN" });
  // No home day for 102's driver here, so the weekday the test runs on can't decide it.
  const d102 = truckBy("102").driverId;
  const home102 = db(`select data->>'homeTimeTarget' from drivers where carrier_id = '${cid}' and id = '${d102}'`);
  db(`update drivers set data = data || '{"homeTimeTarget":"Flexible"}'::jsonb where carrier_id = '${cid}' and id = '${d102}'`);
  feed([
    acme({ loadNumber: "FL-A", destinationCity: "Atlanta", destinationState: "GA", rate: 1500, miles: 390 }),
    acme({ loadNumber: "FL-B", destinationCity: "Birmingham", destinationState: "AL", rate: 800, miles: 240 }),
  ]);
  await cron();
  const a = load("FL-A"), bl = load("FL-B");
  check("two loads near one truck: the nearest truck takes the better one, and the other goes to the next free truck", a?.stage === "negotiating" && a.truckId === truckBy("101").id && bl?.stage === "negotiating" && bl.truckId === truckBy("102").id, `${a?.stage}/${a?.truckId} ${bl?.stage}/${bl?.truckId}`);
  setTruck("102", { equipmentType: reefer, currentCity: "Fort Worth", currentState: "TX" });
  db(`update drivers set data = data || '${JSON.stringify({ homeTimeTarget: home102 })}'::jsonb where carrier_id = '${cid}' and id = '${d102}'`);
  feed([]);

  // ── An idle truck moves to the freight ──────────────────────────────────
  await fetch(`${BASE}/api/integrations?kind=motive`, { method: "DELETE", headers: auth() }); // the ELD would put it back in Memphis
  freeTrucks();
  setTruck("101", { currentCity: "Little Rock", currentState: "AR", position: null, repositionTo: null });
  const t101 = truckBy("101").id;
  copyLoad("idle-1", { referenceNumber: "IDLE-1", truckId: t101, updatedAt: new Date(Date.now() - 13 * 3600000).toISOString() }, "delivered");
  db(`update loads set truck_id = '${t101}' where id = 'idle-1' and carrier_id = '${cid}'`);
  // Its last delivery was 13 hours ago.
  db(`update loads set data = data || '${JSON.stringify({ tripChecklist: { unloadedAt: new Date(Date.now() - 14 * 3600000).toISOString() } })}'::jsonb where carrier_id = '${cid}' and stage = 'delivered' and data->>'truckId' = '${t101}' and id <> 'idle-1'`);
  db(`update loads set data = data || '${JSON.stringify({ tripChecklist: { unloadedAt: new Date(Date.now() - 13 * 3600000).toISOString() } })}'::jsonb where carrier_id = '${cid}' and id = 'idle-1'`);
  db(`delete from agent_marks where carrier_id = '${cid}' and kind like 'reposition:%'`);
  // Memphis is about 150 road miles from Little Rock: within half of a 400-mile empty-miles limit.
  settings({ autonomy: "full", maxDeadhead: 400 });
  let t0 = read("twilio").length;
  await cron();
  const moveText = texts(t0, MARCUS).find((b) => /Head empty to Memphis, TN/.test(b));
  check("empty 13 hours where nothing ships: on full autopilot the driver is sent to Memphis, where the loads are", !!moveText && truckBy("101").repositionTo?.city === "Memphis", moveText ?? JSON.stringify(texts(t0, MARCUS)));
  check("...and the truck's plan says so", /heading to Memphis, TN/.test((truckBy("101").plan?.lines ?? []).join(" ")), JSON.stringify(truckBy("101").plan));
  settings({ autonomy: "rules", maxDeadhead: 300 });
  setTruck("101", { repositionTo: null });
  db(`delete from agent_marks where carrier_id = '${cid}' and kind like 'reposition:%'`);
  await cron();
  check("on Within my rules, the owner is asked instead", /^open\|Truck 101 has been empty in Little Rock, AR for 13 hours/.test(esc("Truck 101 has been empty in Little Rock%")));

  // ── Slow docks ───────────────────────────────────────────────────────────
  freeTrucks();
  const at = (h) => new Date(Date.now() - h * 3600000).toISOString();
  for (const [n, hrs] of [[1, 4], [2, 4.5]]) copyLoad(`dock-${n}`, { referenceNumber: `DOCK-${n}`, rateConReading: { receiver: "Kroger DC", shipper: null, otherConcerns: [], finesAndFees: [], summary: "" }, tripChecklist: { arrivedDeliveryAt: at(48 + hrs), unloadedAt: at(48) } }, "delivered");
  copyLoad("fac-1", { referenceNumber: "FAC-1", truckId: t101, brokerContactEmail: "dispatch@acmefreight.test", brokerId: db(`select id from records where carrier_id = '${cid}' and kind = 'broker' and data->>'email' = 'dispatch@acmefreight.test'`), bookRequest: { ask: 1850, askedAt: new Date().toISOString(), status: "accepted" }, targetRate: 1850, rateConReading: null, invoice: null }, "negotiating");
  fs.writeFileSync(`${S}/fakes/ratecon.json`, JSON.stringify({ broker: "Acme Freight", brokerMc: "MC 555001", loadNumber: "FAC-1", totalRate: 1850, receiver: "Kroger DC", shipper: "Coastal Plant 4", mismatches: [], otherConcerns: [], summary: "Matches." }));
  t0 = read("twilio").length;
  await fetch(`${BASE}/api/channels/email?token=email-hook-secret`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ MessageID: "pm-fac-1", From: "dispatch@acmefreight.test", FromName: "Rosa", FromFull: { Email: "dispatch@acmefreight.test", Name: "Rosa" }, To: `abc123+${key}@inbound.postmarkapp.com`, MailboxHash: key, Subject: "Rate con FAC-1", TextBody: "Attached.", Headers: [{ Name: "Message-ID", Value: "<fac-1@x.test>" }], Attachments: [{ Name: "FAC-1.pdf", Content: Buffer.from("%PDF-1.4").toString("base64"), ContentType: "application/pdf", ContentLength: 900 }] }) });
  await sleep(3500);
  fs.unlinkSync(`${S}/fakes/ratecon.json`);
  const heads = texts(t0, MARCUS).find((b) => /New load FAC-1/.test(b));
  check("a receiver that kept our trucks 4+ hours twice: the driver hears it with the new load", !!heads && /Heads up: Kroger DC usually takes about 4\.5 hours/.test(heads), heads);

  // ── Compliance ───────────────────────────────────────────────────────────
  const soon = new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10);
  setTruck("101", { nextInspectionDue: soon });
  await cron();
  check("a truck's annual DOT inspection due in 10 days: the owner is reminded", /^open\|Truck 101's annual DOT inspection is due \d{4}-\d\d-\d\d, in 10 days/.test(esc("Truck 101's annual DOT inspection%")));
  await cron();
  check("...once", db(`select count(*) from escalations where carrier_id = '${cid}' and data->>'reason' like 'Truck 101''s annual DOT inspection%'`) === "1");

  // ── Downloads ────────────────────────────────────────────────────────────
  const from = new Date(Date.now() - 3 * 86400000).toISOString().slice(0, 10);
  const to = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  let r = await fetch(`${BASE}/api/export?kind=invoices&from=${from}&to=${to}`, { headers: auth() });
  const inv = await r.text();
  check("invoices download in QuickBooks import columns, one row per charge", r.status === 200 && /^InvoiceNo,Customer,InvoiceDate,DueDate,Terms,ItemDescription,ItemAmount,LoadNumber,Paid\r\n/.test(inv) && (inv.match(/^INV-ACC-1,/gm) ?? []).length === 3 && /Lumper \(receipt attached\).*,185\.00,ACC-1/.test(inv), inv.slice(0, 300));
  r = await fetch(`${BASE}/api/export?kind=settlements&from=${from}&to=${to}`, { headers: auth() });
  const pay = await r.text();
  check("driver pay downloads per load", r.status === 200 && /^Driver,PayType,Rate,LoadNumber/.test(pay) && /Marcus Bell,per_mile,0\.6,/.test(pay), pay.slice(0, 200));
  r = await fetch(`${BASE}/api/export?kind=invoices`, { headers: auth(token("dddddddd-0000-0000-0000-000000000003", "12145550148")) });
  check("a driver can't download the carrier's books", r.status === 401);

  // ── The support team's numbers ──────────────────────────────────────────
  r = await fetch(`${BASE}/api/support/metrics`, { headers: auth(SUPPORT) });
  const m = await r.json();
  check("support sees hand-offs per truck per week, by kind (fraud is handled by the AI and the owner now, not support)", r.status === 200 && m.week.handoffs > 0 && typeof m.week.perTruckPerWeek === "number" && Object.keys(m.week.byKind).length > 0 && (m.week.byKind.fraud ?? 0) === 0, JSON.stringify(m.week));
  check("owners can't see support's numbers", (await fetch(`${BASE}/api/support/metrics`, { headers: auth() })).status === 403);

  // Put things back for the next tests.
  await fetch(`${BASE}/api/integrations?kind=load_feed`, { method: "DELETE", headers: auth() });
  await fetch(`${BASE}/api/integrations`, { method: "POST", headers: { "content-type": "application/json", ...auth() }, body: JSON.stringify({ kind: "motive", apiKey: "motive-good-key" }) });
  freeTrucks();
  console.log(`\n${passed} passed, ${failed} failed`);
})().catch((e) => { console.error(e); process.exit(1); });
