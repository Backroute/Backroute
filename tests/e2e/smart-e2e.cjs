// Smarter booking against the stand-ins: pricing from lane history, home time in the pick, states a driver avoids,
// capacity emails to brokers who work the area, and the plan per truck. Run after boards-e2e.
const path = require("path");
const S = path.join(__dirname, "..");
const ROOT = path.join(__dirname, "../..");
const fs = require("fs");
const { execSync } = require("child_process");
const BASE = "http://localhost:3210";
let passed = 0, failed = 0;
const check = (label, ok, extra = "") => { ok ? passed++ : failed++; console.log(`${ok ? "PASS" : "FAIL"} ${label}${extra ? ` (${String(extra).slice(0, 300)})` : ""}`); };
const db = (q) => execSync(`su postgres -c "/usr/lib/postgresql/16/bin/psql -h /var/lib/postgresql/backroute-test -p 55432 -U postgres -d rest -tA -c \\"${q.replace(/"/g, '\\\\\\"')}\\""`).toString().trim();
const read = (f) => fs.readFileSync(`${S}/fakes/${f}.jsonl`, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
const cid = fs.readFileSync(`${S}/fakes/carrier.txt`, "utf8").trim();
const OWNER = execSync(`node ${S}/pgrst/jwt.cjs aaaaaaaa-0000-0000-0000-000000000001 12145550100`).toString();
const auth = { authorization: `Bearer ${OWNER}` };
const post = (path, body) => fetch(BASE + path, { method: "POST", headers: { "content-type": "application/json", ...auth }, body: JSON.stringify(body) });
const cron = () => fetch(`${BASE}/api/cron/dispatch`, { headers: { authorization: "Bearer cron-secret" } }).then((r) => r.json());
const settings = (patch) => db(`update carriers set settings = settings || '${JSON.stringify(patch)}'::jsonb where id = '${cid}'`);
const load = (ref) => JSON.parse(db(`select data from loads where carrier_id = '${cid}' and data->>'referenceNumber' = '${ref}'`) || "null");
const truckBy = (unit) => JSON.parse(db(`select data from trucks where carrier_id = '${cid}' and unit_number = '${unit}'`));
const sent = (i) => read("postmark").slice(i).map((x) => x.body);
const feed = (loads) => fs.writeFileSync(`${S}/fakes/feed2.json`, JSON.stringify(loads));
const inDays = (n, hhmm) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10) + "T" + hhmm;
const acme = (o) => ({ originCity: "Memphis", originState: "TN", pickupLocal: inDays(1, "09:00"), equipment: "Dry Van", brokerName: "Acme Freight", brokerEmail: "dispatch@acmefreight.test", brokerMc: "555001", ...o });
function freeTrucks() {
  db(`update loads set stage = 'declined', data = data || '{"stage":"declined"}'::jsonb where carrier_id = '${cid}' and stage in ('offered', 'negotiating', 'booked', 'dispatched', 'at_pickup', 'in_transit', 'at_delivery')`);
  db(`update trucks set data = data || '{"nextLoadId":null,"currentLoadId":null,"status":"available"}'::jsonb where carrier_id = '${cid}'`);
}
const marcusId = db(`select id from drivers where carrier_id = '${cid}' and phone_last10 = '2145550148'`);
const marcus = (patch) => db(`update drivers set data = data || '${JSON.stringify(patch)}'::jsonb where id = '${marcusId}'`);

(async () => {
  settings({ autonomy: "rules" });
  freeTrucks();
  feed([]);
  let r = await post("/api/integrations", { kind: "load_feed", url: "http://localhost:3009/feed2.json", format: "json", name: "Test feed" });
  check("a second feed connects", r.status === 200, await r.text());

  // ── Pricing from what the carrier got on the lane before ─────────────────
  const acmeId = db(`select id from records where carrier_id = '${cid}' and kind = 'broker' and data->>'email' = 'dispatch@acmefreight.test'`);
  const truck101 = truckBy("101").id;
  const past = (n, days) => db(`insert into loads (id, carrier_id, truck_id, stage, data) select 'hist-${n}', carrier_id, truck_id, 'delivered', data || '{"id":"hist-${n}","referenceNumber":"HIST-${n}","stage":"delivered","bookedRate":1400,"brokerId":"${acmeId}","lane":{"origin":"Memphis","originState":"TN","destination":"Atlanta","destState":"GA","miles":390},"updatedAt":"${new Date(Date.now() - days * 86400000).toISOString()}"}'::jsonb from loads where carrier_id = '${cid}' and data->>'referenceNumber' = 'CFP-88213'`);
  past(1, 20);
  past(2, 9);
  feed([acme({ loadNumber: "MEM-ATL-1", destinationCity: "Atlanta", destinationState: "GA", rate: 1200, miles: 390 })]);
  let pm0 = read("postmark").length;
  let tw0 = read("twilio").length;
  // The truck is empty now and Acme has a phone on file: a dispatcher calls a board load rather than emailing.
  const called = (n) => read("twilio").slice(n).some((x) => /Calls\.json/.test(x.path) && x.params.To === "+13125550142");
  await cron();
  const ask1 = sent(pm0).find((m) => /MEM-ATL-1/.test(m.Subject + m.TextBody));
  check("hauled Memphis → Atlanta twice at about $3.59 a mile, and this broker has paid a bit more: the AI asks $1,425, not a little over the $1,200 post", load("MEM-ATL-1")?.targetRate === 1425 && load("MEM-ATL-1")?.bookRequest?.ask === 1425, `${load("MEM-ATL-1")?.targetRate}`);
  check("the truck is empty now: it calls the broker to cover it, instead of emailing", called(tw0) && !ask1, ask1?.Subject ?? "no email");

  // ── Home time decides between two loads ──────────────────────────────────
  freeTrucks();
  marcus({ homePriority: true });
  feed([
    acme({ loadNumber: "MEM-ATL-2", destinationCity: "Atlanta", destinationState: "GA", rate: 1500, miles: 390 }),
    acme({ loadNumber: "MEM-DAL-2", destinationCity: "Dallas", destinationState: "TX", rate: 1300, miles: 452 }),
  ]);
  db(`delete from agent_marks where carrier_id = '${cid}' and kind = 'broker_call'`);
  tw0 = read("twilio").length;
  await cron();
  check("the owner said get Marcus home first: the AI goes for the Dallas load, not the better-paying Atlanta one", load("MEM-DAL-2")?.stage === "negotiating" && load("MEM-ATL-2")?.stage !== "negotiating" && called(tw0), `${load("MEM-DAL-2")?.stage} / ${load("MEM-ATL-2")?.stage}`);

  // ── States a driver won't go to ──────────────────────────────────────────
  freeTrucks();
  marcus({ homePriority: false, prefs: { ...JSON.parse(db(`select data->'prefs' from drivers where id = '${marcusId}'`) || "{}"), avoidStates: ["GA"] } });
  feed([acme({ loadNumber: "MEM-ATL-3", destinationCity: "Atlanta", destinationState: "GA", rate: 1600, miles: 390 })]);
  await cron();
  check("Marcus doesn't run into Georgia: that load isn't offered to his truck", !load("MEM-ATL-3"));

  // ── Capacity emails and the plan ─────────────────────────────────────────
  freeTrucks();
  feed([]);
  marcus({ homePriority: true });
  db(`delete from agent_marks where carrier_id = '${cid}' and kind like 'capacity:%'`);
  pm0 = read("postmark").length;
  await cron();
  const cap = sent(pm0).filter((m) => /^Dry Van available in Memphis, TN/.test(m.Subject));
  const acmeCap = cap.find((m) => m.To === "dispatch@acmefreight.test");
  check("a truck with nothing lined up: brokers who've sent loads out of Tennessee hear it's free", !!acmeCap && /empty in Memphis, TN now/.test(acmeCap.TextBody) && /head toward Dallas, TX/.test(acmeCap.TextBody), acmeCap?.TextBody?.slice(0, 200) ?? JSON.stringify(sent(pm0).map((m) => m.Subject)));
  check("...only brokers who passed the check", cap.length > 0 && cap.every((m) => !/gmail/.test(m.To)), cap.map((m) => m.To).join(", "));
  pm0 = read("postmark").length;
  await cron();
  check("...once a day, not every round", sent(pm0).filter((m) => /available in/.test(m.Subject)).length === 0);
  const plan = truckBy("101").plan;
  check("the truck's plan says where it is, what's next, and home time", plan && /Empty in Memphis, TN/.test(plan.lines[0]) && /Next: nothing booked yet/.test(plan.lines[1]) && /Marcus/.test(plan.lines[2] ?? ""), JSON.stringify(plan));

  marcus({ homePriority: false, prefs: { ...JSON.parse(db(`select data->'prefs' from drivers where id = '${marcusId}'`) || "{}"), avoidStates: [] } });
  await fetch(`${BASE}/api/integrations?kind=load_feed`, { method: "DELETE", headers: auth });
  console.log(`\n${passed} passed, ${failed} failed`);
})().catch((e) => { console.error(e); process.exit(1); });
