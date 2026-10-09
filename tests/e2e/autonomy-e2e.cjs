// No human dispatcher: the support team console, broker checks, payments, cancellations, AI calls to brokers,
// load feeds and the ELD, against the stand-ins. Run after dispatch-ui (it builds on that carrier's state).
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
const waitFor = async (fn, ms = 30000) => { const end = Date.now() + ms; while (Date.now() < end) { const v = fn(); if (v) return v; await sleep(500); } return null; };
const cid = fs.readFileSync(`${S}/fakes/carrier.txt`, "utf8").trim();
const token = (sub, phone) => execSync(`node ${S}/pgrst/jwt.cjs ${sub} ${phone}`).toString();
const OWNER = token("aaaaaaaa-0000-0000-0000-000000000001", "12145550100");
const SUPPORT_ID = "cccccccc-0000-0000-0000-000000000005";
const SUPPORT = token(SUPPORT_ID, "13125550100");
const auth = (t) => ({ authorization: `Bearer ${t}` });
const get = (path, t) => fetch(BASE + path, { headers: auth(t) });
const post = (path, body, t = OWNER) => fetch(BASE + path, { method: "POST", headers: { "content-type": "application/json", ...auth(t) }, body: JSON.stringify(body) });
const cron = () => fetch(`${BASE}/api/cron/dispatch`, { headers: { authorization: "Bearer cron-secret" } }).then((r) => r.json());
const settings = (patch) => db(`update carriers set settings = settings || '${JSON.stringify(patch)}'::jsonb where id = '${cid}'`);
const load = (ref) => JSON.parse(db(`select data from loads where carrier_id = '${cid}' and data->>'referenceNumber' = '${ref}'`) || "null");
const setLoad = (ref, patch) => db(`update loads set data = data || '${JSON.stringify(patch)}'::jsonb${patch.stage ? `, stage = '${patch.stage}'` : ""} where carrier_id = '${cid}' and data->>'referenceNumber' = '${ref}'`);
const truckBy = (unit) => JSON.parse(db(`select data from trucks where carrier_id = '${cid}' and unit_number = '${unit}'`));
const setTruck = (unit, patch) => db(`update trucks set data = data || '${JSON.stringify(patch)}'::jsonb where carrier_id = '${cid}' and unit_number = '${unit}'`);
const broker = (email) => JSON.parse(db(`select data from records where carrier_id = '${cid}' and kind = 'broker' and data->>'email' = '${email}'`) || "null");
const esc = (like) => db(`select status from escalations where carrier_id = '${cid}' and data->>'reason' like '${like.replace(/'/g, "''")}' order by (data->>'createdAt') desc limit 1`);
const key = db(`select inbound_key from carriers where id = '${cid}'`);
let n = 100;
async function email(from, name, subject, text, attachments = []) {
  const body = { MessageID: `pm-auto-${++n}`, From: from, FromName: name, FromFull: { Email: from, Name: name }, To: `abc123+${key}@inbound.postmarkapp.com`, MailboxHash: key, Subject: subject, TextBody: text, Headers: [{ Name: "Message-ID", Value: `<auto-${n}@x.test>` }], Attachments: attachments };
  const res = await fetch(`${BASE}/api/channels/email?token=email-hook-secret`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (res.status !== 200) throw new Error(`email webhook ${res.status}`);
  await sleep(3000);
}
const sign = (url, params) => crypto.createHmac("sha1", "twilio-secret").update(url + Object.keys(params).sort().map((k) => k + params[k]).join("")).digest("base64");
async function twilio(path, params) {
  const url = BASE + path;
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", "x-twilio-signature": sign(url, params) }, body: new URLSearchParams(params) });
  return res.text();
}
const pmAfter = (i) => read("postmark").slice(i).map((x) => x.body);
const twAfter = (i) => read("twilio").slice(i);

(async () => {
  db(`insert into auth.users values ('${SUPPORT_ID}', '13125550100') on conflict do nothing`);
  db(`insert into support_staff (user_id, name) values ('${SUPPORT_ID}', 'Sam') on conflict do nothing`);
  settings({ factoringEmail: null, autonomy: "rules" });
  const anaId = db(`select id from drivers where carrier_id = '${cid}' and phone_last10 = '9725550163'`);

  // ── Support team ──────────────────────────────────────────────────────────
  check("support staff are recognized", (await (await get("/api/support/me", SUPPORT)).json()).support === true);
  check("a carrier owner is not support", (await (await get("/api/support/me", OWNER)).json()).support === false && (await get("/api/support/queue", OWNER)).status === 403);
  // A driver silent on a late load goes to the owner first; an hour on with nobody picking it up, support has it.
  const hourAgo = new Date(Date.now() - 70 * 60_000).toISOString();
  check("a driver silent on a late load goes to the owner first", /^open\|/.test(db(`select status || '|' from escalations where carrier_id = '${cid}' and data->>'reason' like 'Marcus Bell hasn''t answered%' order by (data->>'createdAt') desc limit 1`)));
  db(`update escalations set updated_at = '${hourAgo}', data = jsonb_set(data, '{createdAt}', '"${hourAgo}"') where carrier_id = '${cid}' and status = 'open' and data->>'reason' like 'Marcus Bell hasn''t answered%'`);
  await fetch(`${BASE}/api/cron/dispatch`, { headers: { authorization: "Bearer cron-secret" } });
  let q = await (await get("/api/support/queue", SUPPORT)).json();
  const silent = q.items.find((i) => /Marcus Bell hasn't answered/.test(i.escalation.reason));
  check("what the AI handed off is in the support queue, urgent first, with who to call and the thread", !!silent && q.items[0].escalation.complexity === "critical" && silent.driver?.phone && silent.thread.length > 0 && silent.carrier.name === "Titan Freight LLC", `${q.items.length} items`);
  let r = await post("/api/support/act", { action: "take", carrierId: cid, escalationId: silent.escalation.id }, SUPPORT);
  check("support takes it", r.status === 200 && (await r.json()).escalation.supportAssignee === "Sam");
  let t0 = read("twilio").length;
  r = await post("/api/support/act", { action: "text_driver", carrierId: cid, driverId: silent.driver.id, body: "Marcus, it's Sam at Backroute. Call me when you can." }, SUPPORT);
  check("support texts the driver from the dispatch number, logged as support", r.status === 200 && twAfter(t0).some((x) => x.params.To === "+12145550148" && /Sam at Backroute/.test(x.params.Body)) && db(`select count(*) from driver_messages where carrier_id = '${cid}' and data->>'bySupport' = 'Sam'`) === "1");
  r = await post("/api/support/act", { action: "resolve", carrierId: cid, escalationId: silent.escalation.id, note: "Reached Marcus: phone died, he's unloading now." }, SUPPORT);
  check("support closes it with a note the owner sees", r.status === 200 && db(`select status || '|' || (data->>'resolvedBy') from escalations where carrier_id = '${cid}' and id = '${silent.escalation.id}'`) === "resolved|support" && db(`select count(*) from activity where carrier_id = '${cid}' and data->>'detail' like 'Reached Marcus%'`) === "1");

  // ── A broker cancels ──────────────────────────────────────────────────────
  let pm0 = read("postmark").length;
  await email("loads@tql.test", "Kim at TQL", "Load TQL-7701 cancelled", "Sorry, we are cancelling load TQL-7701, the shipper pulled it.");
  check("broker cancels a booked load: taken off the truck, no TONU before dispatch", load("TQL-7701")?.stage === "cancelled" && truckBy("101").nextLoadId === null && !pmAfter(pm0).some((m) => /TONU/i.test(`${m.Subject} ${m.TextBody}`)), load("TQL-7701")?.stage);
  check("...and the broker gets a 'got it, thanks'", pmAfter(pm0).some((m) => /Got it, thanks for letting us know\. We've taken TQL-7701 \(.*\) off our truck/.test(m.TextBody)), pmAfter(pm0).map((m) => m.TextBody.slice(0, 80)).join(" | "));
  // A load the truck was already rolling to
  db(`insert into loads (id, carrier_id, truck_id, stage, data) select 'load-8801', carrier_id, truck_id, 'dispatched', data || '{"id":"load-8801","referenceNumber":"TQL-8801","stage":"dispatched","bookRequest":null}'::jsonb from loads where carrier_id = '${cid}' and data->>'referenceNumber' = 'TQL-5501'`);
  setTruck("102", { currentLoadId: "load-8801", nextLoadId: null, status: "on_load" });
  db(`update drivers set data = jsonb_set(data, '{prefs,smsOptOut}', 'false') where id = '${anaId}'`);
  t0 = read("twilio").length;
  await email("loads@tql.test", "Kim at TQL", "Cancelled", "We're cancelling load TQL-8801, sorry.");
  check("cancelled after dispatch: TONU claim drafted (no TONU on the rate con, so it waits)", load("TQL-8801")?.stage === "cancelled" && load("TQL-8801").tonuFee === 150 && db(`select data->'draft'->>'purpose' || '|' || status from escalations where carrier_id = '${cid}' and data->>'loadId' = 'load-8801'`) === "tonu|open");
  check("the driver is told not to go, in their language", twAfter(t0).some((x) => x.params.To === "+19725550163" && /TQL-8801 .*cancelled by the broker/.test(x.params.Body)));
  check("the truck is free again", truckBy("102").status === "available" && truckBy("102").currentLoadId === null);

  // ── Broker checks with FMCSA ──────────────────────────────────────────────
  setTruck("101", { currentLoadId: null, nextLoadId: null, status: "available", currentCity: "Memphis", currentState: "TN" });
  pm0 = read("postmark").length;
  await email("acme.dispatch.loads@gmail.com", "Bob", "Acme lanes", "Acme lanes this week: MEM to BHM van $1100. Bob, Acme Freight MC 999999");
  const fake = broker("acme.dispatch.loads@gmail.com");
  check("someone posing as a broker (inactive MC, free email): not verified, high risk", fake && !fake.authorityVerified && fake.fraudRisk === "high" && /no active broker authority/.test(fake.verifyNote), fake?.verifyNote);
  check("...the AI doesn't book with them, and the owner is told why (not support)", pmAfter(pm0).length === 0 && esc("Backroute isn't booking with Acme Freight <acme.dispatch.loads@gmail.com>%") === "open", esc("Backroute isn't booking with Acme Freight%"));
  await email("dispatch@acmefreight.test", "Rosa at Acme", "Acme lanes", "Acme lanes this week: MEM to BHM van $1100. Rosa, Acme Freight, MC 555001, (312) 555-0142");
  const real = broker("dispatch@acmefreight.test");
  check("a real broker is verified with FMCSA (active authority, name matches)", real?.authorityVerified === true && real.mc === "555001" && real.legalName === "ACME FREIGHT LLC" && real.phone === "(312) 555-0142", real?.verifyNote);
  const acmeAsk = await waitFor(() => pmAfter(pm0).find((m) => /ACM-9001/.test(m.TextBody)));
  check("...and the AI asks to book with them on its own", !!acmeAsk && /Our rate is \$1,200 all in/.test(acmeAsk.TextBody) && load("ACM-9001").stage === "negotiating", acmeAsk?.TextBody?.slice(0, 200));
  const tql = broker("loads@tql.test");
  const tqlEsc = db(`select id from escalations where carrier_id = '${cid}' and data->>'brokerId' = '${tql.id}' order by (data->>'createdAt') desc limit 1`);
  r = await post("/api/support/act", { action: "trust_broker", carrierId: cid, escalationId: tqlEsc, brokerId: tql.id, note: "Called TQL's carrier line, MC confirmed." }, SUPPORT);
  check("support checks a broker by hand and marks them trusted", r.status === 200 && broker("loads@tql.test").authorityVerified === true && /Checked by Backroute support/.test(broker("loads@tql.test").verifyNote));

  // ── Getting paid ──────────────────────────────────────────────────────────
  await email("ap@coastalfreight.test", "Coastal AP", "Payment advice", "ACH sent today. We paid invoice INV-CFP-88213 $1,850.");
  check("a payment email marks the invoice paid", !!load("CFP-88213").invoice?.paidAt && load("CFP-88213").invoice.paidAmount === 1850);
  const daysAgo = (d) => new Date(Date.now() - d * 86400000).toISOString();
  setLoad("TQL-5501", { invoice: { number: "INV-TQL-5501", amount: 1950, draftedAt: daysAgo(50), sentAt: daysAgo(50), sentTo: "ap@tql.test" }, rateConReading: { ...load("TQL-5501").rateConReading, paymentTerms: "Net 45" } });
  pm0 = read("postmark").length;
  await cron();
  const rem1 = pmAfter(pm0).find((m) => /Payment for invoice INV-TQL-5501/.test(m.Subject));
  check("invoice 5 days past terms: a friendly reminder", !!rem1 && /A friendly reminder about invoice INV-TQL-5501/.test(rem1.TextBody) && /5 days past/.test(rem1.TextBody), rem1?.TextBody?.slice(0, 160));
  pm0 = read("postmark").length;
  await cron();
  check("...only once", pmAfter(pm0).filter((m) => /INV-TQL-5501/.test(m.Subject)).length === 0);
  setLoad("TQL-5501", { invoice: { ...load("TQL-5501").invoice, sentAt: daysAgo(60) } });
  await cron();
  check("15 days late: a second reminder", pmAfter(pm0).some((m) => /Following up again on invoice INV-TQL-5501/.test(m.TextBody)));
  setLoad("TQL-5501", { invoice: { ...load("TQL-5501").invoice, sentAt: daysAgo(80) } });
  await cron();
  check("a month late after two reminders: a final notice naming the bond, and the owner decides what's next", pmAfter(pm0).some((m) => /Final notice: invoice INV-TQL-5501/.test(m.Subject)) && esc("Invoice INV-TQL-5501 for TQL-5501%final notice%") === "open", esc("Invoice INV-TQL-5501%"));
  await email("ap@tql.test", "TQL AP", "Remittance", "We paid invoice INV-TQL-5501 $1,500 (fuel advance deducted).");
  check("short paid: marked, and the AI asks the broker for the rest", load("TQL-5501").invoice.paidAmount === 1500 && pmAfter(pm0).some((m) => m.To === "ap@tql.test" && /Short payment on invoice INV-TQL-5501/.test(m.Subject)) && esc("%paid _1,500 on invoice INV-TQL-5501%") === "open");

  // ── The AI phones a broker who didn't answer ─────────────────────────────
  db(`update records set data = data || '{"phone":"(469) 555-0111"}'::jsonb where carrier_id = '${cid}' and kind = 'broker' and data->>'email' = 'loads@tql.test'`);
  const ui = load("UI-OFFER");
  setLoad("UI-OFFER", { pickupAt: new Date(Date.now() + 2 * 86400000).toISOString(), bookRequest: { ...ui.bookRequest, status: "sent", askedAt: new Date(Date.now() - 40 * 60000).toISOString() } });
  t0 = read("twilio").length;
  await cron();
  const call = twAfter(t0).find((x) => x.path.endsWith("/Calls.json") && x.params.To === "+14695550111");
  check("book request unanswered 30 minutes: the AI calls the broker", !!call && call.params.MachineDetection === "Enable" && call.params.Url.includes("/api/channels/voice/broker?carrier="), call?.params.Url);
  const url = new URL(call.params.Url);
  let tw = await twilio(url.pathname + url.search, { CallSid: "CAB1", From: "+14695550199", To: "+14695550111", Direction: "outbound-api", AnsweredBy: "human" });
  check("it says it's an AI, that the call is transcribed, and asks if the load is still available", /AI dispatcher for Titan Freight LLC/.test(tw) && /This call is transcribed/.test(tw) && /UI-OFFER, picking up .*Is it still available\?/.test(tw) && !/dollars/.test(tw) && tw.includes("<Gather"), tw.slice(0, 300));
  const turn = `/api/channels/voice/broker/turn${url.search}`;
  tw = await twilio(turn, { CallSid: "CAB1", From: "+14695550199", To: "+14695550111", SpeechResult: "best I can do is 1900" });
  check("broker's lower number: the rules counter at the floor", /Counter: say the best you can do is 2150/.test(tw) && load("UI-OFFER").bookRequest.brokerOffer === 1900 && load("UI-OFFER").bookRequest.countered === true, tw.slice(0, 300));
  tw = await twilio(turn, { CallSid: "CAB1", From: "+14695550199", To: "+14695550111", SpeechResult: "fine, 1500 works, book it" });
  check("the AI can't be talked into a number the rules didn't accept", /Not booked: 1500/.test(tw) && load("UI-OFFER").bookRequest.status !== "accepted");
  tw = await twilio(turn, { CallSid: "CAB1", From: "+14695550199", To: "+14695550111", SpeechResult: "ok 2150 works, book it" });
  check("agreed at the counter: booked pending the rate con", /BOOKED:/.test(tw) && load("UI-OFFER").bookRequest.status === "accepted" && load("UI-OFFER").bookRequest.ask === 2150);
  tw = await twilio(url.pathname + url.search, { CallSid: "CAB2", From: "+14695550199", To: "+14695550111", Direction: "outbound-api", AnsweredBy: "machine_end_beep" });
  check("voicemail: a short message, then it hangs up", /Please reply to our email/.test(tw) && tw.includes("<Hangup/>") && !tw.includes("<Gather"));

  setLoad("UI-OFFER", { stage: "declined" }); // Truck 102 stops chasing it, so the feed has a free reefer.

  // ── Load feeds ────────────────────────────────────────────────────────────
  r = await post("/api/integrations", { kind: "load_feed", url: "http://localhost:3009/feed.json", format: "json", headerName: "x-feed-key", headerValue: "wrong", name: "BigCo feed" });
  check("a feed that refuses the key isn't saved", r.status === 422 && /403/.test((await r.json()).reason));
  r = await post("/api/integrations", { kind: "load_feed", url: "http://localhost:3009/feed.json", format: "json", headerName: "x-feed-key", headerValue: "feed-secret", name: "BigCo feed" });
  check("JSON feed connects; rows without a lane or a broker are skipped", r.status === 200 && /1 usable load/.test((await r.json()).status));
  r = await post("/api/integrations", { kind: "load_feed", url: "http://localhost:3009/feed.csv", format: "csv", name: "Phone feed" });
  check("CSV feed connects (quoted commas and all)", r.status === 200);
  const listed = await (await get("/api/integrations", OWNER)).text();
  check("the connections list never shows keys", listed.includes("Phone feed") && !listed.includes("feed-secret"));
  t0 = read("twilio").length;
  await cron();
  const csv = await waitFor(() => load("CSV-1"));
  check("feed loads land on the board like emailed ones", csv?.truckId === truckBy("102").id && csv.listedRate === 1000 && /Phone feed · Phone Only, Inc/.test(csv.source), csv?.source);
  check("a poster with only a phone number: within the rules, the AI calls them to book (and asks their MC on the call)", twAfter(t0).some((x) => x.path.endsWith("/Calls.json") && x.params.To === "+12145550177") && load("CSV-1").stage === "negotiating");

  // ── ELD ──────────────────────────────────────────────────────────────────
  r = await post("/api/integrations", { kind: "samsara", apiKey: "samsara-bad-key" });
  check("an ELD key that doesn't work is refused", r.status === 422 && /didn't accept the key/.test((await r.json()).reason));
  r = await post("/api/integrations", { kind: "samsara", apiKey: "samsara-good-key" });
  const eldStatus = (await r.json()).status;
  check("Samsara connects: trucks by unit number (both pages), drivers by name, unknown ones listed", r.status === 200 && /2 trucks and 2 drivers matched; not matched: truck 999/.test(eldStatus), eldStatus);
  const t101 = truckBy("101");
  const marcus = JSON.parse(db(`select data from drivers where carrier_id = '${cid}' and phone_last10 = '2145550148'`));
  check("truck location and driver hours come from the ELD", t101.position?.source === "samsara" && t101.currentCity === "Dallas" && t101.currentState === "TX" && marcus.hos?.drive === 6.5 && marcus.hosStatus === "driving", `${t101.currentCity} ${JSON.stringify(marcus.hos)}`);
  setLoad("TQL-5501", { deliveryAt: new Date(Date.now() + 2 * 3600000).toISOString() });
  pm0 = read("postmark").length;
  await cron();
  const late = pmAfter(pm0).find((m) => /^Running late/.test(m.Subject));
  check("the ELD says the truck can't make it: the broker hears before the appointment", !!late && /running behind for the delivery in Atlanta, GA/.test(late.TextBody), late?.TextBody?.slice(0, 200) ?? JSON.stringify(pmAfter(pm0).map((m) => m.Subject)));
  pm0 = read("postmark").length;
  await cron();
  check("...once", !pmAfter(pm0).some((m) => /^Running late/.test(m.Subject)));
  const lateLoad = JSON.parse(db(`select row_to_json(x) from (select data->'late' as late, data->'why'->'lines' as lines from loads where carrier_id = '${cid}' and data->>'referenceNumber' = 'TQL-5501') x`) || "{}");
  check("...and the owner hears it too, with the new arrival time", lateLoad.late?.stop === "delivery" && (lateLoad.lines ?? []).some((l) => /^Running late to the delivery in Atlanta, GA: new arrival about .*The AI told the broker\.$/.test(l)) && db(`select count(*) from activity where carrier_id = '${cid}' and data->>'message' like 'Truck % running late on TQL-5501'`) !== "0", JSON.stringify(lateLoad));
  r = await fetch(`${BASE}/api/integrations?kind=samsara`, { method: "DELETE", headers: auth(OWNER) });
  r = await post("/api/integrations", { kind: "motive", apiKey: "motive-good-key" });
  check("Motive connects the same way", r.status === 200 && truckBy("101").position?.source === "motive" && truckBy("101").currentCity === "Memphis");

  // ── Full autopilot: nothing lands on the owner but emergencies ───────────
  settings({ autonomy: "full" });
  await email("loads@coastalfreight.test", "Dana at Coastal", "Re: CFP-88213", "Can you do a lower rate on the next one? $1,700?");
  check("on full autopilot, a money decision the AI won't make is the owner's, not support's", esc("Dana at Coastal (email): Broker wants to lower%") === "open");

  console.log(`\n${passed} passed, ${failed} failed`);
})().catch((e) => { console.error(e); process.exit(1); });
