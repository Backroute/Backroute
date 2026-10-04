// Driver care against the stand-ins: the weekly check-in in each driver's language, the pay text, what drivers say
// back, and home time from the ELD. Run after rules-e2e.
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
const OWNER = execSync(`node ${S}/pgrst/jwt.cjs aaaaaaaa-0000-0000-0000-000000000001 12145550100`).toString();
const cron = () => fetch(`${BASE}/api/cron/dispatch`, { headers: { authorization: "Bearer cron-secret" } }).then((r) => r.json());
const settings = (patch) => db(`update carriers set settings = settings || '${JSON.stringify(patch)}'::jsonb where id = '${cid}'`);
const texts = (i, to) => read("twilio").slice(i).filter((x) => x.params.To === to && x.params.Body).map((x) => x.params.Body);
const sign = (url, params) => crypto.createHmac("sha1", "twilio-secret").update(url + Object.keys(params).sort().map((k) => k + params[k]).join("")).digest("base64");
async function sms(from, body, sid) {
  const url = `${BASE}/api/channels/sms`;
  const params = { From: from, To: "+14695550199", Body: body, MessageSid: sid };
  await fetch(url, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", "x-twilio-signature": sign(url, params) }, body: new URLSearchParams(params) });
  await sleep(3500);
}
const MARCUS = "+12145550148", ANA = "+19725550163";
const driver = (phone10) => JSON.parse(db(`select data from drivers where carrier_id = '${cid}' and phone_last10 = '${phone10}'`));
const setDriver = (phone10, patch) => db(`update drivers set data = data || '${JSON.stringify(patch)}'::jsonb where carrier_id = '${cid}' and phone_last10 = '${phone10}'`);

(async () => {
  // The ELD would move the truck back each round; this test places it by hand.
  await fetch(`${BASE}/api/integrations?kind=motive`, { method: "DELETE", headers: { authorization: `Bearer ${OWNER}` } });
  settings({ driverCheckins: true, payTexts: true, autonomy: "rules" });
  setDriver("2145550148", { payType: "per_mile", payRate: 0.6, prefs: { ...driver("2145550148").prefs, smsOptOut: false, language: "en" } });
  setDriver("9725550163", { prefs: { ...driver("9725550163").prefs, smsOptOut: false, language: "es" } });
  db(`delete from agent_marks where carrier_id = '${cid}' and (kind like 'care:%' or kind like 'pay:%')`);
  const t101 = db(`select id from trucks where carrier_id = '${cid}' and unit_number = '101'`);
  const week = JSON.parse(db(`select json_build_object('n', count(*), 'miles', coalesce(sum((data->'lane'->>'miles')::numeric), 0)) from loads where carrier_id = '${cid}' and truck_id = '${t101}' and stage = 'delivered' and (data->>'updatedAt')::timestamptz > now() - interval '7 days'`));

  let t0 = read("twilio").length;
  await cron();
  const m = texts(t0, MARCUS);
  check("the weekly check-in goes to each driver in their language", m.some((b) => /^Hi Marcus, it's the AI dispatcher for Titan Freight LLC\. Quick weekly check-in/.test(b)) && texts(t0, ANA).some((b) => /^Hola Ana, habla el despachador IA de Titan Freight LLC\. Chequeo semanal/.test(b)), JSON.stringify(texts(t0, ANA)));
  const pay = m.find((b) => /^Your week/.test(b));
  const expected = `$${Math.round(week.miles * 0.6).toLocaleString("en-US")}`;
  check("with pay texts on, the driver sees their week: loads, miles, pay before deductions", week.n > 0 ? !!pay && pay.includes(`${week.n} load`) && pay.includes(`about ${expected} in pay before deductions`) : !pay, `${pay} / expected ${week.n} loads ${expected}`);
  t0 = read("twilio").length;
  await cron();
  check("...once a week", !texts(t0, MARCUS).some((b) => /weekly check-in|^Your week/.test(b)));

  // What drivers say back.
  await sms(MARCUS, "honestly I'm fed up, pay is too low and I might quit", "SM-care-1");
  const marcus = driver("2145550148");
  const esc = db(`select data->>'reason' from escalations where carrier_id = '${cid}' and data->>'reason' like 'Marcus Bell isn''t happy%' and status = 'open'`);
  check("an unhappy driver: noted, and the owner is asked to call", marcus.care?.mood === "bad" && /Worth a call from you/.test(esc), esc);
  const homeBy = new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10);
  const homeDay = new Date(`${homeBy}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
  await sms(ANA, `todo bien, but I need to be home by ${homeBy}`, "SM-care-2");
  const ana = driver("9725550163");
  check("a driver asks for a home day: recorded and the owner knows", ana.care?.homeBy === homeBy && db(`select count(*) from escalations where carrier_id = '${cid}' and data->>'reason' like 'Ana Lopez wants to be home by ${homeDay}%'`) === "1");

  // Home time from the ELD.
  const at = (lat, lon, where) => db(`update trucks set data = data || '${JSON.stringify({ position: { lat, lon, at: new Date().toISOString(), description: where, source: "motive" } })}'::jsonb where id = '${t101}'`);
  at(32.78, -96.8, "Dallas, TX");
  await cron();
  check("the ELD has Marcus's truck at home: the AI notes when he was last home", Date.parse(driver("2145550148").lastHomeAt ?? 0) > Date.now() - 600000);
  setDriver("2145550148", { lastHomeAt: new Date(Date.now() - 25 * 86400000).toISOString() });
  at(35.15, -90.05, "Memphis, TN");
  db(`delete from agent_marks where carrier_id = '${cid}' and kind like 'long_away:%'`);
  await cron();
  const away = db(`select data->>'reason' from escalations where carrier_id = '${cid}' and data->>'reason' like 'Marcus Bell hasn''t been home in 25 days%'`);
  check("25 days without getting home: the owner hears, with the one switch that fixes it", /Get Marcus home first/.test(away), away);

  settings({ payTexts: false });
  await fetch(`${BASE}/api/integrations`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${OWNER}` }, body: JSON.stringify({ kind: "motive", apiKey: "motive-good-key" }) });
  console.log(`\n${passed} passed, ${failed} failed`);
})().catch((e) => { console.error(e); process.exit(1); });
