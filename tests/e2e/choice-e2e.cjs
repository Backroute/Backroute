// How the AI chooses, against the stand-ins: power-only loads only for a tractor that can pull the shipper's trailer,
// a load that nearly fits kept aside and offered once a truck fits, a polite no to a broker who answered our "truck
// is free" email when the owner picks another, what the owner's pick over the AI's teaches, an offer the owner keeps
// for a truck, and new reasons to ask more (no detention pay).
const path = require("path");
const S = path.join(__dirname, "..");
const fs = require("fs");
const { execSync } = require("child_process");
const BASE = "http://localhost:3210";
let passed = 0, failed = 0;
const check = (label, ok, extra = "") => { ok ? passed++ : failed++; console.log(`${ok ? "PASS" : "FAIL"} ${label}${extra ? ` (${String(extra).slice(0, 400)})` : ""}`); };
const db = (q) => execSync(`su postgres -c "/usr/lib/postgresql/16/bin/psql -h /var/lib/postgresql/backroute-test -p 55432 -U postgres -d rest -tA -c \\"${q.replace(/"/g, '\\\\\\"').replace(/\$/g, () => "\\\\\\$")}\\""`).toString().trim();
const read = (f) => (fs.existsSync(`${S}/fakes/${f}.jsonl`) ? fs.readFileSync(`${S}/fakes/${f}.jsonl`, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const cid = fs.readFileSync(`${S}/fakes/carrier.txt`, "utf8").trim();
const OWNER = execSync(`node ${S}/pgrst/jwt.cjs aaaaaaaa-0000-0000-0000-000000000001 12145550100`).toString();
const cron = () => fetch(`${BASE}/api/cron/dispatch`, { headers: { authorization: "Bearer cron-secret" } }).then((r) => r.json());
const settings = (patch) => db(`update carriers set settings = settings || '${JSON.stringify(patch)}'::jsonb where id = '${cid}'`);
const key = db(`select inbound_key from carriers where id = '${cid}'`);
const RUN = Date.now().toString(36);
let n = 0;
const email = (from, name, subject, text) =>
  fetch(`${BASE}/api/channels/email?token=email-hook-secret`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ MessageID: `pm-ch-${RUN}-${++n}`, From: from, FromName: name, FromFull: { Email: from, Name: name }, To: `abc123+${key}@inbound.postmarkapp.com`, MailboxHash: key, Subject: subject, TextBody: text, Headers: [{ Name: "Message-ID", Value: `<ch-${RUN}-${n}@x.test>` }], Attachments: [] }) });
const day = (d, hhmm) => new Date(Date.now() + d * 86400000).toISOString().slice(0, 10) + "T" + hhmm;
const weekday = (hhmm, from = 2) => {
  for (let d = from; d < from + 4; d++) {
    const at = new Date(Date.now() + d * 86400000);
    if (at.getUTCDay() !== 0 && at.getUTCDay() !== 6) return day(d, hhmm);
  }
  return day(from, hhmm);
};
const offerFile = `${S}/fakes/offers.json`;
async function offers(from, name, list) {
  fs.writeFileSync(offerFile, JSON.stringify(list));
  await email(from, name, `Loads ${RUN}-${n + 1}`, "See loads below. MC 771999");
  await sleep(2500);
  fs.unlinkSync(offerFile);
}
const load = (ref) => JSON.parse(db(`select data from loads where carrier_id = '${cid}' and data->>'referenceNumber' = '${ref}' order by updated_at desc limit 1`) || "null");
const truckBy = (unit) => JSON.parse(db(`select data from trucks where carrier_id = '${cid}' and unit_number = '${unit}'`));
const setTruck = (unit, patch) => db(`update trucks set data = data || '${JSON.stringify(patch).replace(/'/g, "''")}'::jsonb where carrier_id = '${cid}' and unit_number = '${unit}'`);
function freeTrucks() {
  db(`update loads set stage = 'declined', data = data || '{"stage":"declined"}'::jsonb where carrier_id = '${cid}' and stage in ('offered', 'negotiating', 'booked', 'dispatched', 'at_pickup', 'in_transit', 'at_delivery')`);
  db(`update trucks set data = data || '{"nextLoadId":null,"currentLoadId":null,"status":"available","currentCity":"Dallas","currentState":"TX","powerOnly":false}'::jsonb where carrier_id = '${cid}' and unit_number in ('101', '102')`);
}
const broker = (id, company, mail, mc, extra = {}) => {
  const b = { id, carrierId: cid, company, contact: "Dee", phone: "", email: mail, reliability: 90, avgResponseMins: 20, loadsBooked: 0, onTimePct: 95, avgRateVariancePct: 0, tier: "standard", authorityVerified: true, mc, legalName: company, verifiedAt: new Date().toISOString(), verifyNote: "FMCSA: broker authority active.", fraudRisk: "low", avgDaysToPay: 30, detentionPaidPct: 80, cancellations90d: 0, ...extra };
  db(`insert into records (carrier_id, id, kind, data) values ('${cid}', '${id}', 'broker', '${JSON.stringify(b).replace(/'/g, "''")}'::jsonb) on conflict (carrier_id, kind, id) do update set data = excluded.data`);
};
const lane = (o) => ({ originCity: "Dallas", originState: "TX", destinationCity: "Memphis", destinationState: "TN", equipment: "Dry van", miles: 452, pickupLocal: weekday("09:00"), ...o });

(async () => {
  settings({ sandbox: false, paused: false, autonomy: "ask", askPremiums: true, minRpm: 2, maxDeadhead: 300, checkIns: false, driverCheckins: false });
  db(`update trucks set data = data || '{"status":"maintenance"}'::jsonb where carrier_id = '${cid}' and unit_number not in ('101', '102')`);
  db(`delete from carrier_integrations where carrier_id = '${cid}' and kind in ('samsara', 'motive', 'geotab')`);
  freeTrucks();
  setTruck("101", { position: null, gear: null });
  broker("ch-a", "Atlas Brokerage", "amy@atlasbrok.test", "772001", { capacityAskedAt: new Date(Date.now() - 3600000).toISOString() });
  broker("ch-b", "Beacon Freight", "bo@beaconfreight.test", "772002");
  db(`delete from agent_marks where carrier_id = '${cid}' and load_id in ('broker:ch-a', 'broker:ch-b')`);

  // ── Power only ─────────────────────────────────────────────────────────────
  await offers("bo@beaconfreight.test", "Bo", [lane({ loadNumber: `PO1-${RUN}`, equipment: "Power Only", rate: 1500, notes: "Power only, preloaded trailer at shipper" })]);
  check("a power-only load with no tractor marked for it: not offered", !load(`PO1-${RUN}`) || load(`PO1-${RUN}`).stage !== "offered", load(`PO1-${RUN}`)?.stage);
  setTruck("102", { powerOnly: true });
  await offers("bo@beaconfreight.test", "Bo", [lane({ loadNumber: `PO2-${RUN}`, equipment: "Power Only", rate: 1500, notes: "Power only, preloaded trailer at shipper" })]);
  let l = load(`PO2-${RUN}`);
  check("...once the reefer's tractor is marked power only, it's offered for that truck", l?.stage === "offered" && l.powerOnly === true && l.truckId === truckBy("102").id, JSON.stringify({ stage: l?.stage, po: l?.powerOnly }));
  freeTrucks();

  // ── Nearly fits ───────────────────────────────────────────────────────────
  settings({ maxDeadhead: 200 });
  await offers("bo@beaconfreight.test", "Bo", [lane({ loadNumber: `AF-${RUN}`, originCity: "Houston", originState: "TX", destinationCity: "Atlanta", destinationState: "GA", miles: 790, rate: 2400, pickupLocal: weekday("14:00") })]);
  l = load(`AF-${RUN}`);
  check("a load about 265 miles away with a 200-mile limit: set aside as nearly fitting, with why", l?.stage === "declined" && /over your 200-mile limit/.test(l.almost?.why ?? ""), JSON.stringify({ stage: l?.stage, almost: l?.almost }));
  setTruck("101", { currentCity: "Houston", currentState: "TX" });
  await cron();
  l = load(`AF-${RUN}`);
  check("...and once the truck is in Houston, it comes back as an offer", l?.stage === "offered" && !l.almost && (l.why?.lines ?? []).some((x) => /Nearly fit when it came in/.test(x)), JSON.stringify({ stage: l?.stage, why: l?.why }));
  settings({ maxDeadhead: 300 });
  freeTrucks();

  // ── Several brokers bidding for the truck; the owner picks ──────────────────
  await offers("amy@atlasbrok.test", "Amy", [lane({ loadNumber: `CA1-${RUN}`, rate: 2100 }), lane({ loadNumber: `CA2-${RUN}`, destinationCity: "Nashville", miles: 660, rate: 1900, pickupLocal: weekday("15:00", 3) })]);
  await offers("bo@beaconfreight.test", "Bo", [lane({ loadNumber: `CB1-${RUN}`, rate: 1500, pickupLocal: weekday("11:00") })]);
  const a1 = load(`CA1-${RUN}`), a2 = load(`CA2-${RUN}`), b1 = load(`CB1-${RUN}`);
  check("three offers for truck 101", [a1, a2, b1].every((x) => x?.stage === "offered" && x.truckId === truckBy("101").id), [a1, a2, b1].map((x) => x?.stage).join());
  db(`update loads set data = data || '${JSON.stringify({ keptFor: a2.truckId, createdAt: new Date(Date.now() - 30 * 3600000).toISOString() })}'::jsonb where carrier_id = '${cid}' and id = '${a2.id}'`);
  const p0 = read("postmark").length;
  const r = await fetch(`${BASE}/api/agent/book`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${OWNER}` }, body: JSON.stringify({ loadId: b1.id }) });
  await sleep(1500);
  check("the owner books Beacon's load", r.ok && load(`CB1-${RUN}`)?.stage === "negotiating", r.status);
  const no = read("postmark").slice(p0).map((m) => m.body).find((m) => m.To === "amy@atlasbrok.test" && /covered that truck/.test(m.TextBody ?? ""));
  check("Atlas, who answered our free-truck email, hears a polite no the same minute", !!no && /please don't hold it for us/.test(no.TextBody), no?.TextBody?.slice(0, 300));
  check("what the owner picked over the AI's first choice is kept to learn from", load(`CB1-${RUN}`)?.ownerPick?.overAi === true, JSON.stringify(load(`CB1-${RUN}`)?.ownerPick));
  check("the offer the owner kept for the truck isn't set aside", load(`CA2-${RUN}`)?.stage === "offered" && load(`CA1-${RUN}`)?.stage === "declined");
  await cron();
  check("...nor expired, though it's over a day old", load(`CA2-${RUN}`)?.stage === "offered");
  freeTrucks();

  // ── A new reason to ask more ───────────────────────────────────────────────
  settings({ autonomy: "rules" });
  await offers("bo@beaconfreight.test", "Bo", [lane({ loadNumber: `ND-${RUN}`, rate: 1800, notes: "No detention on this load. Live unload." })]);
  l = load(`ND-${RUN}`);
  check("a post with no detention pay: asked a little more, and why", l?.stage === "negotiating" && (l.premium?.reasons ?? []).includes("no detention pay"), JSON.stringify(l?.premium));

  freeTrucks();
  settings({ askPremiums: false, autonomy: "rules", maxDeadhead: 300 });
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error(e);
  if (fs.existsSync(offerFile)) fs.unlinkSync(offerFile);
  process.exit(1);
});
