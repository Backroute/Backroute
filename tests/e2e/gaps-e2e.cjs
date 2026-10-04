// The gaps between the AI and a veteran dispatcher that could be closed before real carriers, against the stand-ins:
// remembering drivers, dock knowledge shared across carriers, the carrier's report card for brokers, asking for
// reloads, brokers who won't talk to an AI, blurry paperwork, and the weekly review of what still needs people.
const path = require("path");
const S = path.join(__dirname, "..");
const ROOT = path.join(__dirname, "../..");
const crypto = require("crypto");
const fs = require("fs");
const { execSync } = require("child_process");
const BASE = "http://localhost:3210";
let passed = 0, failed = 0;
const check = (label, ok, extra = "") => { ok ? passed++ : failed++; console.log(`${ok ? "PASS" : "FAIL"} ${label}${extra ? ` (${String(extra).slice(0, 400)})` : ""}`); };
const db = (q) => execSync(`su postgres -c "/usr/lib/postgresql/16/bin/psql -h /var/lib/postgresql/backroute-test -p 55432 -U postgres -d rest -tA -c \\"${q.replace(/"/g, '\\\\\\"').replace(/\$/g, () => "\\\\\\$")}\\""`).toString().trim();
const read = (f) => fs.readFileSync(`${S}/fakes/${f}.jsonl`, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const cid = fs.readFileSync(`${S}/fakes/carrier.txt`, "utf8").trim();
const cron = () => fetch(`${BASE}/api/cron/dispatch`, { headers: { authorization: "Bearer cron-secret" } }).then((r) => r.json());
const settings = (patch) => db(`update carriers set settings = settings || '${JSON.stringify(patch).replace(/'/g, "''")}'::jsonb where id = '${cid}'`);
const loadById = (id) => JSON.parse(db(`select data from loads where carrier_id = '${cid}' and id = '${id}'`) || "null");
const sent = (i) => read("postmark").slice(i).map((x) => x.body);
const texts = (i, to) => read("twilio").slice(i).filter((x) => x.params.To === to && x.params.Body).map((x) => x.params.Body);
const key = db(`select inbound_key from carriers where id = '${cid}'`);
const truckBy = (unit) => JSON.parse(db(`select data from trucks where carrier_id = '${cid}' and unit_number = '${unit}'`));
const sign = (url, params) => crypto.createHmac("sha1", "twilio-secret").update(url + Object.keys(params).sort().map((k) => k + params[k]).join("")).digest("base64");
async function twilio(path, params) {
  const url = BASE + path;
  return (await fetch(url, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", "x-twilio-signature": sign(url, params) }, body: new URLSearchParams(params) })).text();
}
const RUN = Date.now().toString(36);
let n = 0;
async function email(from, name, subject, text, attachments = []) {
  const body = { MessageID: `pm-gaps-${RUN}-${++n}`, From: from, FromName: name, FromFull: { Email: from, Name: name }, To: `abc123+${key}@inbound.postmarkapp.com`, MailboxHash: key, Subject: subject, TextBody: text, Headers: [{ Name: "Message-ID", Value: `<gaps-${RUN}-${n}@x.test>` }], Attachments: attachments };
  await fetch(`${BASE}/api/channels/email?token=email-hook-secret`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  await sleep(3500);
}
const token = (sub, phone) => execSync(`node ${S}/pgrst/jwt.cjs ${sub} ${phone}`).toString();
const SUPPORT_ID = "cccccccc-0000-0000-0000-000000000005";
const SUPPORT = token(SUPPORT_ID, "13125550100");
const ago = (h) => new Date(Date.now() - h * 3600000).toISOString();
const ahead = (h) => new Date(Date.now() + h * 3600000).toISOString();
const MARCUS = "+12145550148";
const GA = "loads@gapfreight.test";
const broker = (id, company, email, extra = {}) => {
  const b = { id, carrierId: cid, company, contact: "Lee", phone: "", email, reliability: 90, avgResponseMins: 20, loadsBooked: 0, onTimePct: 95, avgRateVariancePct: 0, tier: "standard", authorityVerified: true, mc: "771777", legalName: company, verifiedAt: new Date().toISOString(), verifyNote: "FMCSA: broker authority active.", fraudRisk: "low", avgDaysToPay: 30, detentionPaidPct: 80, cancellations90d: 0, ...extra };
  db(`insert into records (carrier_id, id, kind, data) values ('${cid}', '${id}', 'broker', '${JSON.stringify(b).replace(/'/g, "''")}'::jsonb) on conflict (carrier_id, kind, id) do update set data = excluded.data`);
};
const copyLoad = (id, patch, stage, truckId) => {
  db(`delete from loads where carrier_id = '${cid}' and id = '${id}'`);
  db(`insert into loads (id, carrier_id, truck_id, stage, data) select '${id}', carrier_id, ${truckId ? `'${truckId}'` : "null"}, '${stage}', data || '${JSON.stringify({ id, stage, updatedAt: new Date().toISOString(), truckId: truckId ?? null, ...patch }).replace(/'/g, "''")}'::jsonb from loads where carrier_id = '${cid}' and data->>'referenceNumber' = 'CFP-88213' limit 1`);
};
const freeTrucks = () => {
  db(`update loads set stage = 'declined', data = data || '{"stage":"declined"}'::jsonb where carrier_id = '${cid}' and stage in ('offered', 'negotiating', 'booked', 'dispatched', 'at_pickup', 'in_transit', 'at_delivery')`);
  db(`update trucks set data = data || '{"nextLoadId":null,"currentLoadId":null,"status":"available"}'::jsonb where carrier_id = '${cid}'`);
};
const RC = (patch) => ({ isRateCon: true, broker: "Gap Freight", brokerMc: null, brokerEmail: GA, loadNumber: "GA-1001", totalRate: 2000, originCity: "Dallas", originState: "TX", destinationCity: "Memphis", destinationState: "TN", miles: 452, equipment: "Dry van", detention: "2 hrs free, then 50 per hour", paymentTerms: "Net 30", finesAndFees: [], mismatches: [], otherConcerns: [], summary: "Matches what was agreed.", shipper: "Dallas Foods", receiver: "Slowpoke Grocers DC", shipperPhone: null, receiverPhone: null, appointmentNeeded: "none", ...patch });

(async () => {
  const t101 = truckBy("101");
  settings({ autonomy: "rules", sandbox: false, factoringEmail: null, maxDeadhead: 1000 });
  broker("ga-broker", "Gap Freight", GA);
  db(`delete from agent_marks where carrier_id = '${cid}' and (load_id like 'ga-%' or load_id like 'broker:%')`);
  db(`delete from loads where carrier_id = '${cid}' and (id like 'ga-%' or data->>'referenceNumber' like 'SIM-73%')`);
  db(`delete from facility_visits where name_key = 'slowpokegrocers'`);
  freeTrucks();

  // ── 7. The AI remembers drivers ──
  let t0 = read("twilio").length;
  await twilio("/api/channels/sms", { From: MARCUS, To: "+14695550199", Body: "Heads up my daughter has her soccer final Saturday", MessageSid: `SM-gaps-1-${RUN}` });
  await sleep(3000);
  const notes = JSON.parse(db(`select data->'prefs'->'notes' from drivers where carrier_id = '${cid}' and phone_last10 = '2145550148'`) || "null");
  check("a driver mentions something about their life: the AI remembers it", Array.isArray(notes) && notes.some((x) => /soccer final/.test(x.text) && x.until), JSON.stringify(notes));
  t0 = read("twilio").length;
  await twilio("/api/channels/sms", { From: MARCUS, To: "+14695550199", Body: "hows my week looking", MessageSid: `SM-gaps-2-${RUN}` });
  await sleep(3000);
  const lastPrompt = JSON.stringify(read("claude").at(-1)?.body ?? {});
  check("...and next time the AI has it in front of it", /Daughter's soccer final Saturday/.test(lastPrompt) && texts(t0, MARCUS).some((b) => /soccer final/.test(b)), texts(t0, MARCUS).join(" / "));

  // ── 8. Dock knowledge shared across every carrier on Backroute ──
  const other = db(`select id from carriers where id <> '${cid}' limit 1`) || cid;
  for (let i = 0; i < 4; i++) db(`insert into facility_visits (carrier_id, load_id, stop, name_key, city, state, minutes) values ('${other}', 'other-${RUN}-${i}', 'delivery', 'slowpokegrocers', 'memphis', 'TN', ${250 + i * 10}) on conflict do nothing`);
  copyLoad("ga-1", { referenceNumber: "GA-1001", brokerId: "ga-broker", brokerContactEmail: GA, bookedRate: null, targetRate: 2000, bookRequest: { ask: 2000, askedAt: ago(1), status: "sent" }, rateConReading: null, rateConSignedAt: null, tracking: null, appointments: null, lane: { origin: "Dallas", originState: "TX", destination: "Memphis", destState: "TN", miles: 452, marketRpm: 2.5 } }, "negotiating", t101.id);
  fs.writeFileSync(`${S}/fakes/ratecon.json`, JSON.stringify(RC({})));
  const pdf = fs.readFileSync(`${S}/fakes/data/ratecon.pdf`).toString("base64");
  let p0 = read("postmark").length;
  t0 = read("twilio").length;
  await email(GA, "Lee at Gap", "Rate con GA-1001", "Rate con attached for GA-1001.", [{ Name: "GA-1001.pdf", ContentType: "application/pdf", ContentLength: 645, Content: pdf }]);
  fs.unlinkSync(`${S}/fakes/ratecon.json`);
  const newLoad = texts(t0, MARCUS).find((b) => /GA-1001/.test(b));
  check("a dock this carrier has never been to, but other carriers' trucks waited 4+ hours at: the driver is warned", !!newLoad && /Slowpoke Grocers DC usually takes about 4(\.5)? hours/.test(newLoad), newLoad);

  // ── 3. Asking the broker for a reload ──
  const thanks = sent(p0).find((m) => m.To === GA && /GA-1001/.test(m.Subject));
  check("the rate con thanks asks the broker for a reload out of the delivery city", !!thanks && /The truck will be empty in Memphis, TN after it delivers/.test(thanks.TextBody) && /Anything going out of there you could use us on\?/.test(thanks.TextBody), thanks?.TextBody?.slice(0, 400));

  // ── 8b. This carrier's finished stops go into the shared record ──
  const doneAt = ago(3);
  db(`update loads set stage = 'delivered', data = data || '${JSON.stringify({ stage: "delivered", pickupAt: ago(30), deliveryAt: ago(8), rateConReading: { ...RC({}), readAt: ago(10), fileName: "x.pdf" }, tripChecklist: { arrivedPickupAt: ago(30), loadedAt: ago(29), arrivedDeliveryAt: ago(8), unloadedAt: doneAt } })}'::jsonb where id = 'ga-1' and carrier_id = '${cid}'`);
  db(`update trucks set data = data || '{"currentLoadId":null,"status":"available"}'::jsonb where carrier_id = '${cid}'`);
  await cron();
  const mine = db(`select stop || ':' || minutes from facility_visits where carrier_id = '${cid}' and load_id = 'ga-1' order by stop`);
  check("this carrier's finished stops are shared (facility, city and minutes only)", /delivery:300/.test(mine) && /pickup:60/.test(mine), mine);
  check("...and no one who signs in can read the shared record", db(`select relrowsecurity from pg_class where relname = 'facility_visits'`) === "t" && db(`select count(*) from pg_policies where tablename = 'facility_visits'`) === "0");

  // ── 2. The carrier's report card, in book requests ──
  for (let i = 0; i < 8; i++)
    copyLoad(`ga-hist-${i}`, { referenceNumber: `GA-H${i}`, brokerId: "ga-broker", bookedRate: 1500, imported: false, claim: null, pickupAt: ago(200 + i * 24), deliveryAt: ago(180 + i * 24), tripChecklist: { arrivedPickupAt: ago(200.5 + i * 24), loadedAt: ago(199 + i * 24), arrivedDeliveryAt: ago(180.2 + i * 24), unloadedAt: ago(179 + i * 24) }, invoice: { number: `INV-GA-H${i}`, amount: 1500, draftedAt: ago(178 + i * 24), sentAt: ago(178 + i * 24) }, tracking: { app: "Macropoint", link: null, askedAt: ago(210 + i * 24), acceptedAt: ago(209 + i * 24) } }, "delivered", t101.id);
  // Late loads elsewhere in the test data would drag the record down: keep this carrier's record about these.
  db(`update loads set data = data || '{"imported": true}'::jsonb where carrier_id = '${cid}' and stage = 'delivered' and id not like 'ga-%'`);
  freeTrucks();
  db(`update trucks set data = data || '{"currentCity":"Dallas","currentState":"TX"}'::jsonb where carrier_id = '${cid}'`);
  const equip = t101.equipmentType === "Reefer" ? " reefer" : "";
  p0 = read("postmark").length;
  await email(GA, "Lee at Gap", "Load SIM-7301", `Load SIM-7301${equip}: Dallas, TX to Houston, TX, 240 miles, $1,300. Pickup tomorrow.`);
  const ask = sent(p0).find((m) => m.To === GA && /SIM-7301/.test(m.Subject + m.TextBody));
  check("a book request carries the carrier's record: loads, on-time, tracking, paperwork, claims", !!ask && /Our record: \d+ loads in the last six months, 100% on time, tracking on every load that asked for it, paperwork the same day, no claims\./.test(ask.TextBody), ask?.TextBody?.slice(0, 500));
  db(`update loads set data = data - 'imported' where carrier_id = '${cid}' and stage = 'delivered' and id not like 'ga-%' and data->>'source' <> 'Imported history'`);
  freeTrucks();

  // ── 5. A broker who won't talk to an AI ──
  broker("ga-noai", "Old School Logistics", "dispatch@oldschool.test", { phone: "(312) 555-0199" });
  copyLoad("ga-call", { referenceNumber: "GA-CALL", brokerId: "ga-noai", brokerContactEmail: "dispatch@oldschool.test", targetRate: 1700, bookRequest: { ask: 1700, askedAt: ago(0.5), status: "sent" }, pickupAt: ahead(30) }, "negotiating", null);
  const q = `?carrier=${encodeURIComponent(cid)}&load=ga-call`;
  const call = { From: "+14695550199", To: "+13125550199", Direction: "outbound-api" };
  await twilio(`/api/channels/voice/broker${q}`, { ...call, CallSid: `CAGAP-${RUN}`, AnsweredBy: "human" });
  p0 = read("postmark").length;
  const tw = await twilio(`/api/channels/voice/broker/turn${q}`, { ...call, CallSid: `CAGAP-${RUN}`, SpeechResult: "Sorry buddy, we don't deal with AI. Bye." });
  const oldSchool = JSON.parse(db(`select data from records where carrier_id = '${cid}' and kind = 'broker' and id = 'ga-noai'`));
  check("'we don't deal with AI': a polite goodbye, and the AI says it'll email", /send it over by email/.test(tw) && /<Hangup\/>/.test(tw), tw.slice(0, 300));
  check("...the email goes out with where things stood", sent(p0).some((m) => m.To === "dispatch@oldschool.test" && /\$1,700 all in/.test(m.TextBody)), sent(p0).map((m) => m.To).join(" / "));
  check("...and the broker is remembered as email only", !!oldSchool.noAiCalls?.at);
  db(`delete from agent_marks where carrier_id = '${cid}' and load_id = 'ga-call' and kind = 'broker_call'`);
  let c0 = read("twilio").length;
  db(`update loads set data = data || '${JSON.stringify({ bookRequest: { ask: 1700, askedAt: ago(0.6), status: "sent" } })}'::jsonb where id = 'ga-call' and carrier_id = '${cid}'`);
  await cron();
  check("...so the AI never phones them again", !read("twilio").slice(c0).some((x) => x.path.endsWith("/Calls.json") && x.params.To === "+13125550199"));
  db(`update loads set stage = 'declined', data = data || '{"stage":"declined"}'::jsonb where id = 'ga-call' and carrier_id = '${cid}'`);

  // ── 10. A blurry photo of the POD ──
  copyLoad("ga-pod", { referenceNumber: "GA-POD", brokerId: "ga-broker", bookedRate: 1600, documents: [] }, "at_delivery", t101.id);
  db(`update trucks set data = data || '{"currentLoadId":"ga-pod","status":"on_load"}'::jsonb where id = '${t101.id}'`);
  t0 = read("twilio").length;
  await twilio("/api/channels/sms", { From: MARCUS, To: "+14695550199", Body: "pod", NumMedia: "1", MediaUrl0: `http://localhost:3006/2010-04-01/Accounts/ACtest/Messages/MM${RUN}/Media/blurry1`, MediaContentType0: "image/jpeg", MessageSid: `SM-gaps-3-${RUN}` });
  await sleep(3500);
  const retake = texts(t0, MARCUS).join(" / ");
  const pod = loadById("ga-pod");
  check("a POD photo too blurry to bill on: the driver is asked for another before leaving, with a tip", /too hard to read for the broker to pay on it/.test(retake) && /flash/.test(retake) && /before you leave/.test(retake), retake);
  check("...and it isn't filed or used to mark the load delivered", !pod.documents.some((d) => d.type === "pod") && pod.stage === "at_delivery", `${pod.stage} ${JSON.stringify(pod.documents)}`);
  db(`update loads set stage = 'declined', data = data || '{"stage":"declined"}'::jsonb where id = 'ga-pod' and carrier_id = '${cid}'`);
  db(`update trucks set data = data || '{"currentLoadId":null,"status":"available"}'::jsonb where carrier_id = '${cid}'`);

  // ── 11. The weekly review of what still needs people ──
  db(`insert into auth.users values ('${SUPPORT_ID}', '13125550100') on conflict do nothing`);
  db(`insert into support_staff (user_id, name) values ('${SUPPORT_ID}', 'Sam') on conflict do nothing`);
  const m = await (await fetch(`${BASE}/api/support/metrics`, { headers: { authorization: `Bearer ${SUPPORT}` } })).json();
  const reps = m.week?.repeats ?? [];
  check("support sees what came up most this week, grouped, with an example each", Array.isArray(reps) && reps.length > 0 && reps.every((r) => r.count >= 2 && r.example && r.kind) && reps[0].count >= reps.at(-1).count, JSON.stringify(reps.slice(0, 3)));

  settings({ maxDeadhead: 300 });
  console.log(`\n${passed} passed, ${failed} failed`);
})().catch((e) => { console.error(e); process.exit(1); });
