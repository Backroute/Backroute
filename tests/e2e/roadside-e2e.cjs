// A breakdown on the road, against the stand-ins: shops found near the ELD position, texted to the driver, the AI
// phones them one by one, the broker hears about the delay, the owner gets the bill question. Run after smart-e2e.
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
const truckBy = (unit) => JSON.parse(db(`select data from trucks where carrier_id = '${cid}' and unit_number = '${unit}'`));
const after = (f, i) => read(f).slice(i);
const sign = (url, params) => crypto.createHmac("sha1", "twilio-secret").update(url + Object.keys(params).sort().map((k) => k + params[k]).join("")).digest("base64");
async function twilio(path, params) {
  const url = BASE + path;
  return (await fetch(url, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", "x-twilio-signature": sign(url, params) }, body: new URLSearchParams(params) })).text();
}
const MARCUS = "+12145550148";

(async () => {
  // Truck 101 is rolling on a load for Acme, and the ELD has it on I-35 at Waco.
  const t101 = truckBy("101");
  db(`insert into loads (id, carrier_id, truck_id, stage, data) select 'road-1', carrier_id, truck_id, 'in_transit', data || '{"id":"road-1","referenceNumber":"ROAD-1","stage":"in_transit","brokerContactEmail":"dispatch@acmefreight.test","lane":{"origin":"Dallas","originState":"TX","destination":"Houston","destState":"TX","miles":240}}'::jsonb from loads where carrier_id = '${cid}' and data->>'referenceNumber' = 'CFP-88213' on conflict do nothing`);
  db(`update trucks set data = data || '${JSON.stringify({ currentLoadId: "road-1", status: "on_load", position: { lat: 31.55, lon: -97.15, at: new Date().toISOString(), description: "I-35 mile 335, Waco, TX", source: "motive" } })}'::jsonb where id = '${t101.id}'`);
  db(`delete from agent_marks where carrier_id = '${cid}' and kind like 'breakdown%'`);

  let b0 = read("boards").length, t0 = read("twilio").length, p0 = read("postmark").length;
  await twilio("/api/channels/sms", { From: MARCUS, To: "+14695550199", Body: "truck broke down, no power, sitting on the shoulder", MessageSid: "SM-road-1" });
  await sleep(4000);
  const search = after("boards", b0).find((x) => x.board === "places");
  const c = search?.body?.locationBias?.circle?.center;
  check("repair shops are searched near where the ELD has the truck", !!search && search.key === "places-key" && /nationalPhoneNumber/.test(search.mask) && search.body.textQuery === "semi truck repair" && Math.abs(c.latitude - 31.55) < 0.01 && Math.abs(c.longitude + 97.15) < 0.01, JSON.stringify(search?.body));
  const list = after("twilio", t0).find((x) => x.params.To === MARCUS && /Repair help near you/.test(x.params.Body ?? ""));
  const lines = list?.params.Body.split("\n") ?? [];
  check("the driver gets the nearest open shops first, closed ones marked, ones with no phone left out", /^1\. I-35 Truck & Trailer Repair, \d+ mi: \(254\) 555-0101/.test(lines[1] ?? "") && /^2\. Central Texas Diesel/.test(lines[2] ?? "") && /^3\. Brazos Tire Service.*\(closed now\)/.test(lines[3] ?? "") && !/No Phone Garage/.test(list.params.Body), list?.params.Body);
  check("...and hears the AI is calling the first one", /I'm calling I-35 Truck & Trailer Repair now/.test(list?.params.Body ?? ""));
  const call1 = after("twilio", t0).find((x) => x.path.endsWith("/Calls.json") && x.params.To === "+12545550101");
  check("the AI phones the shop", !!call1 && call1.params.MachineDetection === "Enable" && /\/api\/channels\/voice\/shop\?.*shop=0/.test(call1.params.Url), call1?.params.Url);
  const notice = after("postmark", p0).map((x) => x.body).find((m) => m.To === "dispatch@acmefreight.test" && /^Delay: Load ROAD-1/.test(m.Subject));
  check("the broker is told the load is delayed, before anyone asks", !!notice && /broke down near I-35 mile 335, Waco, TX/.test(notice.TextBody), notice?.TextBody?.slice(0, 200));
  const esc = db(`select status || '|' || (data->>'reason') from escalations where carrier_id = '${cid}' and data->>'reason' like 'Marcus Bell (breakdown): truck 101%' order by (data->>'createdAt') desc limit 1`);
  check("the owner sees it with what's been done, and the bill is theirs to OK", /^open\|/.test(esc) && /texted Marcus 3 shops/.test(esc) && /told the broker/.test(esc) && /repair bill needs your OK/.test(esc), esc);

  // The shop call.
  const u1 = new URL(call1.params.Url);
  let tw = await twilio(u1.pathname + u1.search, { CallSid: "CAS1", From: "+14695550199", To: "+12545550101", Direction: "outbound-api", AnsweredBy: "human" });
  check("on the call: says it's an AI, that it's transcribed, and what's wrong", /AI dispatcher for Titan Freight LLC/.test(tw) && /This call is transcribed/.test(tw) && /broken down near I-35 mile 335, Waco, TX: Truck broke down on I-35 near Waco/.test(tw) && tw.includes("<Gather"), tw.slice(0, 300));
  const turn1 = `/api/channels/voice/shop/turn?carrier=${encodeURIComponent(cid)}&truck=${encodeURIComponent(t101.id)}`;
  t0 = read("twilio").length;
  tw = await twilio(turn1, { CallSid: "CAS1", From: "+14695550199", To: "+12545550101", SpeechResult: "sorry we're booked up today" });
  const call2 = after("twilio", t0).find((x) => x.path.endsWith("/Calls.json") && x.params.To === "+12545550102");
  check("they can't: the AI thanks them and calls the next shop", tw.includes("<Hangup/>") && !!call2 && /shop=1/.test(call2.params.Url));
  const u2 = new URL(call2.params.Url);
  await twilio(u2.pathname + u2.search, { CallSid: "CAS2", From: "+14695550199", To: "+12545550102", Direction: "outbound-api", AnsweredBy: "human" });
  t0 = read("twilio").length;
  tw = await twilio(turn1, { CallSid: "CAS2", From: "+14695550199", To: "+12545550102", SpeechResult: "yes we can have a truck out there in 90 minutes" });
  const found = after("twilio", t0).find((x) => x.params.To === MARCUS);
  check("the next one can: the driver gets their number and how soon", /Marcus, will call you/.test(tw) && /Central Texas Diesel can help \(90 minutes\)\. Call them to set it up: \(254\) 555-0102/.test(found?.params.Body ?? "") && truckBy("101").roadside?.found?.shop === "Central Texas Diesel", found?.params.Body ?? tw.slice(0, 200));

  // The driver texts about it again: no second round of calls.
  b0 = read("boards").length;
  t0 = read("twilio").length;
  await twilio("/api/channels/sms", { From: MARCUS, To: "+14695550199", Body: "still broke down, anyone coming?", MessageSid: "SM-road-2" });
  await sleep(4000);
  check("a second report of the same breakdown doesn't start over", after("boards", b0).filter((x) => x.board === "places").length === 0 && !after("twilio", t0).some((x) => x.path.endsWith("/Calls.json")));

  db(`update trucks set data = data || '{"currentLoadId":null,"status":"available"}'::jsonb where id = '${t101.id}'`);
  db(`update loads set stage = 'delivered', data = data || '{"stage":"delivered"}'::jsonb where id = 'road-1' and carrier_id = '${cid}'`);
  console.log(`\n${passed} passed, ${failed} failed`);
})().catch((e) => { console.error(e); process.exit(1); });
