// A carrier's history from a spreadsheet: read and previewed first, then imported; the AI prices the next load on
// that lane from it; nothing is invoiced or texted for old loads. Uses the simulator's practice carriers (clean
// fleet) and the owner's endpoint on the test carrier.
const path = require("path");
const S = path.join(__dirname, "..");
const ROOT = path.join(__dirname, "../..");
const fs = require("fs");
const { execSync } = require("child_process");
const BASE = "http://localhost:3210";
let passed = 0, failed = 0;
const check = (label, ok, extra = "") => { ok ? passed++ : failed++; console.log(`${ok ? "PASS" : "FAIL"} ${label}${extra ? ` (${String(extra).slice(0, 300)})` : ""}`); };
const db = (q) => execSync(`su postgres -c "/usr/lib/postgresql/16/bin/psql -h /var/lib/postgresql/backroute-test -p 55432 -U postgres -d rest -tA -c \\"${q.replace(/"/g, '\\\\\\"')}\\""`).toString().trim();
const sim = async (body) => (await fetch(`${BASE}/api/sim`, { method: "POST", headers: { authorization: "Bearer eval-secret", "content-type": "application/json" }, body: JSON.stringify(body) })).json();
const day = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
const us = (n) => { const d = new Date(Date.now() - n * 86400000); return `${d.getUTCMonth() + 1}/${d.getUTCDate()}/${d.getUTCFullYear()}`; };

const CSV = [
  "Date,Customer,Broker Email,Pickup City,Pickup State,Delivery City,Delivery State,Miles,Linehaul,Load #",
  `${day(30)},Summit Logistics,loads@summitlog.test,Dallas,TX,Memphis,TN,452,"$1,850.00",SUM-1001`,
  `${us(20)},Summit Logistics,loads@summitlog.test,Dallas,TX,Memphis,TN,452,"$1,900.00",SUM-1002`,
  `${day(10)},Summit Logistics,,Dallas,TX,Memphis,TN,,1875,SUM-1003`,
  `${day(12)},Northstar Freight,ops@northstarfreight.test,"Houston, TX",,"Austin, TX",,165,700,NS-1`,
  `2024-01-02,Old Broker,old@x.test,Dallas,TX,Tulsa,OK,260,900,OLD-1`,
  `${day(5)},Summit Logistics,loads@summitlog.test,Dallas,TX,Memphis,TN,452,,BAD-1`,
].join("\n");

(async () => {
  // ── The owner's endpoint: a dry run saves nothing ──────────────────────────────────────────────────────────
  const cid = fs.readFileSync(`${S}/fakes/carrier.txt`, "utf8").trim();
  const token = execSync(`node ${S}/pgrst/jwt.cjs aaaaaaaa-0000-0000-0000-000000000001 12145550100`).toString().trim();
  const before = db(`select count(*) from loads where carrier_id = '${cid}'`);
  const dry = await (await fetch(`${BASE}/api/import/history`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ csv: CSV, dryRun: true }) })).json();
  check("a dry run finds the columns, the loads and the new brokers, and says what it skipped and why", dry.loads === 4 && dry.columns.rate === "Linehaul" && dry.columns.origin === "Pickup City" && dry.columns.ref === "Load #" && dry.skipped.some((x) => /older than a year/.test(x.why)) && dry.skipped.some((x) => /no rate/.test(x.why)), JSON.stringify(dry).slice(0, 300));
  check("...and saves nothing", db(`select count(*) from loads where carrier_id = '${cid}'`) === before);
  const noAuth = await fetch(`${BASE}/api/import/history`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ csv: CSV }) });
  check("only a signed-in owner can import", noAuth.status === 401);

  // ── A clean fleet: import, then price the next load on that lane ──────────────────────────────────────────
  const setup = await sim({ action: "setup", name: "History Test LLC", settings: { autonomy: "rules", minRpm: 2.5 }, fleet: [{ driverName: "Luis Ortega", phone: "(682) 555-0191", unitNumber: "201", equipment: "Dry Van", homeCity: "Dallas", homeState: "TX", runType: "regional" }], brokers: [] });
  const r = await sim({ action: "import", carrier: setup.carrier, csv: CSV });
  check("the import adds the loads and the brokers", r.loads === 4 && r.brokers === 2, JSON.stringify(r).slice(0, 200));
  let st = await sim({ action: "state", carrier: setup.carrier });
  const hist = st.loads.filter((l) => l.imported);
  const dates = db(`select string_agg(to_char(updated_at, 'YYYY-MM-DD'), ',' order by updated_at) from loads where carrier_id = '${setup.carrier}'`);
  check("imported loads are finished history: delivered, no truck, dated when they ran", hist.length === 4 && hist.every((l) => l.stage === "delivered" && !l.truckId) && dates.includes(day(30)) && dates.includes(day(10)), dates);
  check("a city and state in one column ('Houston, TX') is read right", hist.some((l) => l.lane.origin === "Houston" && l.lane.originState === "TX" && l.lane.destination === "Austin"));
  const again = await sim({ action: "import", carrier: setup.carrier, csv: CSV });
  check("importing the same sheet twice doesn't double it", again.loads === 0 && again.skipped.filter((x) => /already in Backroute/.test(x.why)).length === 4, JSON.stringify(again.skipped.slice(0, 2)));

  // Summit paid about $4.15 a mile on Dallas → Memphis three times. Their next post at $1,500: the AI asks for what
  // this lane and this broker have paid (capped at 20% over the post), not a little over $1,500.
  await sim({ action: "email", carrier: setup.carrier, from: "loads@summitlog.test", fromName: "Kim", subject: "Load SIM-9001 Dallas to Memphis", text: "Load SIM-9001\nDallas, TX to Memphis, TN, 452 miles\nPick up tomorrow 8:00 AM\nDry van\nPaying $1,500 all in.\n\nKim" });
  st = await sim({ action: "state", carrier: setup.carrier });
  const next = st.loads.find((l) => l.referenceNumber === "SIM-9001");
  check("the next Summit load on that lane is priced from the history ($1,800: what they've paid, capped at 20% over the $1,500 post)", next?.targetRate === 1800, `${next?.targetRate}`);
  const rounds = await sim({ action: "rounds", carrier: setup.carrier });
  const held = (await sim({ action: "held", carrier: setup.carrier })).held;
  check("nothing is invoiced, texted or chased for the old loads", !held.some((m) => /SUM-100|NS-1/.test(`${m.subject} ${m.body}`)) && !(rounds.done ?? []).some((d) => /SUM-100|NS-1/.test(d)), (rounds.done ?? []).join("; ").slice(0, 200));
  await sim({ action: "teardown", carrier: setup.carrier });

  console.log(`\n${passed} passed, ${failed} failed`);
})().catch((e) => { console.error(e); process.exit(1); });
