// Everything gets an answer, the way a dispatcher's desk would: a broker's yes, a question alongside a price, a rate
// per mile, a cancellation, loads that don't fit, an email the AI can't answer; a broker calling back, the owner
// calling or texting the line, and a stranger calling. Run after negotiate-e2e.
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
const settings = (patch) => db(`update carriers set settings = settings || '${JSON.stringify(patch)}'::jsonb where id = '${cid}'`);
const load = (ref) => JSON.parse(db(`select data from loads where carrier_id = '${cid}' and data->>'referenceNumber' = '${ref}'`) || "null");
const sign = (url, params) => crypto.createHmac("sha1", "twilio-secret").update(url + Object.keys(params).sort().map((k) => k + params[k]).join("")).digest("base64");
async function twilio(path, params) {
  const url = BASE + path;
  return (await fetch(url, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", "x-twilio-signature": sign(url, params) }, body: new URLSearchParams(params) })).text();
}
const spoken = (xml) => [...xml.matchAll(/<Say[^>]*>([\s\S]*?)<\/Say>/g)].map((m) => m[1]).join(" ").replace(/&apos;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
const key = db(`select inbound_key from carriers where id = '${cid}'`);
const RUN = Date.now().toString(36);
let n = 0;
async function email(subject, text, from = "loads@tql.test") {
  const body = { MessageID: `pm-rep-${RUN}-${++n}`, From: from, FromName: "Kim at TQL", FromFull: { Email: from, Name: "Kim at TQL" }, To: `abc123+${key}@inbound.postmarkapp.com`, MailboxHash: key, Subject: subject, TextBody: text, Headers: [{ Name: "Message-ID", Value: `<rep-${RUN}-${n}@tql.test>` }], Attachments: [] };
  const res = await fetch(`${BASE}/api/channels/email?token=email-hook-secret`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (res.status !== 200) throw new Error(`email webhook ${res.status}`);
  await sleep(2500);
}
const mailAfter = (i, re) => waitFor(() => read("postmark").slice(i).map((x) => x.body).find((m) => re.test(`${m.Subject}\n${m.TextBody}`)), 15000);
function newLoad(id, ref, patch) {
  const data = { id, referenceNumber: ref, stage: "negotiating", truckId: null, bookedRate: null, invoice: null, rateCon: null, rateConReading: null, detentionClaims: [], documents: [], tripChecklist: {}, deadheadMiles: 0, weight: 0, equipmentType: "Dry Van", lane: { origin: "Dallas", originState: "TX", destination: "Memphis", destState: "TN", miles: 500 }, pickupWindow: "Tomorrow 8:00 AM", pickupAt: new Date(Date.now() + 3 * 86400000).toISOString(), market: null, updatedAt: new Date().toISOString(), ...patch };
  db(`delete from loads where carrier_id = '${cid}' and id = '${id}'`);
  db(`insert into loads (id, carrier_id, truck_id, stage, data) select '${id}', carrier_id, null, 'negotiating', data || '${JSON.stringify(data).replace(/'/g, "''")}'::jsonb from loads where carrier_id = '${cid}' and data->>'referenceNumber' = 'TQL-5501'`);
}

(async () => {
  settings({ minRpm: 2.5, autonomy: "ask" });

  // ── Email ────────────────────────────────────────────────────────────────────────────────────────────
  // Even on "Ask me first", short notes with no price or promise go straight out, like a dispatcher's would.
  newLoad("rep-1", "REP-1", { targetRate: 1600, bookRequest: { ask: 1600, askedAt: new Date().toISOString(), status: "sent" } });
  let pm0 = read("postmark").length;
  await email("Re: REP-1 Dallas to Memphis", "$1,600 works for us on REP-1. When can your truck get there?");
  const yes = await mailAfter(pm0, /REP-1/);
  check("a broker's yes gets a thank-you and 'send the rate con', with the terms", !!yes && /Sounds good, thanks: \$1,600 all in on REP-1/.test(yes.TextBody) && /Send the rate con here/.test(yes.TextBody) && /TONU/.test(yes.TextBody) && load("REP-1").bookRequest.status === "accepted", yes?.TextBody);
  check("...and the question in it is answered in the same email, without naming a price", !!yes && /QA: The truck is empty in Dallas, TX, right by the pickup/.test(yes.TextBody), yes?.TextBody);
  check("'tomorrow' reads mid-sentence in lower case", !/picking up Tomorrow/.test(read("postmark").slice(-20).map((x) => x.body.TextBody).join("\n")));

  settings({ autonomy: "rules" });
  newLoad("rep-2", "REP-2", { targetRate: 2000, lane: { origin: "Dallas", originState: "TX", destination: "Houston", destState: "TX", miles: 600 }, bookRequest: { ask: 2000, askedAt: new Date().toISOString(), status: "sent" } });
  pm0 = read("postmark").length;
  await email("Re: REP-2", "We can do 2.90 a mile on REP-2.");
  const perMile = await mailAfter(pm0, /REP-2/);
  check("a rate per mile by email ($2.90 × 600 = $1,740) is answered like any offer", !!perMile && /come down to \$1,9\d\d all in on REP-2/.test(perMile.TextBody) && load("REP-2").bookRequest.brokerOffer === 1740, perMile?.TextBody ?? JSON.stringify(load("REP-2").bookRequest));

  pm0 = read("postmark").length;
  await email("REP-1 cancelled", "Sorry, we cancelled REP-1, shipper pushed it.");
  const cancel = await mailAfter(pm0, /REP-1/);
  check("a cancellation before the truck rolled: 'got it, thanks for letting us know'", !!cancel && /Got it, thanks for letting us know\. We've taken REP-1/.test(cancel.TextBody) && load("REP-1").stage === "cancelled", cancel?.TextBody);

  pm0 = read("postmark").length;
  await email("Flatbed out of Seattle", "Hi, got a flatbed SEA to PDX, nothing near you probably. Kim", "flatbeds@tql.test");
  const nofit = await mailAfter(pm0, /None of them fit/);
  check("loads that fit no truck: 'not today, here's what we run'", !!nofit && /None of them fit our trucks today\. We run .*(reefers|dry vans)/.test(nofit.TextBody), nofit?.TextBody);
  pm0 = read("postmark").length;
  await email("More flatbeds", "Another flatbed SEA to PDX, nothing near you. Kim", "flatbeds@tql.test");
  await sleep(2000);
  check("...once a day per broker, not every email", !read("postmark").slice(pm0).some((x) => /None of them fit/.test(x.body.TextBody)));

  pm0 = read("postmark").length;
  await email("Question about your insurance", "FAIL-DRAFT: can you send your cargo limits and a few other things?");
  const hold = await mailAfter(pm0, /We'll get back to you shortly/);
  check("an email the AI can't answer: a quick 'got it, we'll get back to you', and support takes it", !!hold && db(`select count(*) from escalations where carrier_id = '${cid}' and data->>'reason' like '%couldn''t write a reply%so it told them%'`) !== "0", hold?.TextBody);

  // ── Calls ────────────────────────────────────────────────────────────────────────────────────────────
  // A broker calls back the number the AI called them from.
  newLoad("rep-3", "REP-3", { targetRate: 1600, bookRequest: { ask: 1600, askedAt: new Date().toISOString(), status: "sent" } });
  db(`insert into channel_messages (carrier_id, channel, direction, counterparty, body, data) values ('${cid}', 'voice', 'out', '+14695550111', 'Calling TQL about REP-3', '{"kind":"broker_call","loadId":"rep-3"}'::jsonb)`);
  let tw = await twilio("/api/channels/voice", { From: "+14695550111", To: "+14695550199", CallSid: `CAR1${RUN}` });
  check("a broker calling back: the AI picks up about that load", /Titan Freight LLC dispatch, this is the AI dispatcher\. This call is transcribed\. Thanks for calling back about your Dallas to Memphis load, REP-3\. Is it still available\?/.test(spoken(tw)) && /broker\/turn\?carrier=.*load=rep-3/.test(tw), tw.slice(0, 400));
  tw = await twilio(`/api/channels/voice/broker/turn?carrier=${encodeURIComponent(cid)}&load=rep-3`, { From: "+14695550111", To: "+14695550199", CallSid: `CAR1${RUN}`, SpeechResult: "yeah still have it, what do you need on it?" });
  check("...and works it like any broker call", /OUR-PRICE:.*1600 dollars/.test(spoken(tw)), spoken(tw).slice(0, 200));

  // The owner calls the line.
  const c0 = read("claude").length;
  tw = await twilio("/api/channels/voice", { From: "+12145550100", To: "+14695550199", CallSid: `CAO1${RUN}` });
  check("the owner calls the dispatch line: the AI answers as their dispatcher", /Hi, it's your AI dispatcher for Titan Freight LLC\. What do you need\?/.test(spoken(tw)) && /owner\/turn/.test(tw), tw.slice(0, 300));
  tw = await twilio("/api/channels/voice/owner/turn", { From: "+12145550100", To: "+14695550199", CallSid: `CAO1${RUN}`, SpeechResult: "how are my trucks doing" });
  const ownerAsk = read("claude").slice(c0).find((x) => JSON.stringify(x.body.messages ?? "").includes("The owner said"));
  check("...from the fleet data", /OWNER-REPLY: 2 trucks rolling/.test(spoken(tw)) && !!ownerAsk && JSON.stringify(ownerAsk.body.messages).includes("Fleet data right now"), spoken(tw));
  tw = await twilio("/api/channels/voice/owner/turn", { From: "+12145550100", To: "+14695550199", CallSid: `CAO1${RUN}`, SpeechResult: "can someone call me about insurance" });
  check("...and anything that needs a person goes to support", /SUPPORT:/.test(spoken(tw)) && db(`select count(*) from escalations where carrier_id = '${cid}' and data->>'reason' like 'The owner (on the phone): Owner wants a call back%' and status = 'with_support'`) === "1", spoken(tw));
  tw = await twilio("/api/channels/voice/owner/turn", { From: "+12145550100", To: "+14695550199", CallSid: `CAO1${RUN}`, SpeechResult: "ok thanks bye" });
  check("...and hangs up after goodbye", tw.includes("<Hangup/>"));

  // The owner texts the line.
  let t0 = read("twilio").length;
  const sms = `${BASE}/api/channels/sms`;
  const params = { From: "+12145550100", To: "+14695550199", Body: "anything need me today?", MessageSid: `SM-own-${RUN}` };
  await fetch(sms, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", "x-twilio-signature": sign(sms, params) }, body: new URLSearchParams(params) });
  const ownerText = await waitFor(() => read("twilio").slice(t0).find((x) => x.params.To === "+12145550100" && /OWNER-REPLY/.test(x.params.Body ?? "")), 15000);
  check("the owner texts the line: the AI texts back", !!ownerText, JSON.stringify(read("twilio").slice(t0).map((x) => x.params.Body)));

  // Someone the line doesn't know: the front desk.
  tw = await twilio("/api/channels/voice", { From: "+13105550000", To: "+14695550199", CallSid: `CAU1${RUN}` });
  check("a stranger calls: the AI asks who's calling and for which carrier (no hang-up)", /Who's calling, and which carrier is it for\?/.test(spoken(tw)) && /voice\/desk/.test(tw) && !tw.includes("<Hangup/>"), tw.slice(0, 300));
  t0 = read("twilio").length;
  tw = await twilio("/api/channels/voice/desk", { From: "+13105550000", To: "+14695550199", CallSid: `CAU1${RUN}`, SpeechResult: "This is Joe at ABC Logistics, just leave a message for Backroute to call me back" });
  const alert = read("twilio").slice(t0).find((x) => x.params.To === "+13125550100");
  check("...takes a message for support's phones and says someone will call back", /MSG:/.test(spoken(tw)) && tw.includes("<Hangup/>") && !!alert && /Joe at ABC Logistics/.test(alert.params.Body), alert?.params?.Body ?? tw.slice(0, 200));

  // A broker who saw a truck post calls the line for the carrier, with a load.
  const t101 = db(`select id from trucks where carrier_id = '${cid}' and unit_number = '101'`);
  const marcus = db(`select id from drivers where carrier_id = '${cid}' and phone_last10 = '2145550148'`);
  db(`insert into trucks (id, carrier_id, unit_number, driver_id, data) values ('desk-t', '${cid}', 'D1', '${marcus}', '{"id":"desk-t","unitNumber":"D1","driverId":"${marcus}","status":"available","equipmentType":"Dry Van","currentCity":"Dallas","currentState":"TX","currentLoadId":null,"nextLoadId":null}'::jsonb) on conflict do nothing`);
  tw = await twilio("/api/channels/voice", { From: "+19045550177", To: "+14695550199", CallSid: `CAD1${RUN}` });
  tw = await twilio("/api/channels/voice/desk", { From: "+19045550177", To: "+14695550199", CallSid: `CAD1${RUN}`, SpeechResult: "Hi, calling for Titan Freight about your posted van" });
  check("a broker asks for the carrier by name: the desk finds it", /DESK:.*Found Titan Freight LLC/.test(spoken(tw)) && /voice\/desk\?carrier=/.test(tw), spoken(tw).slice(0, 200));
  const deskUrl = new URL(tw.match(/action="([^"]+)"/)[1].replace(/&amp;/g, "&"));
  tw = await twilio(deskUrl.pathname + deskUrl.search, { From: "+19045550177", To: "+14695550199", CallSid: `CAD1${RUN}`, SpeechResult: "Summit Logistics, got a van Dallas to Memphis tomorrow 8 AM, 38,000 pounds of paper, load SUM-1" });
  const phoned = JSON.parse(db(`select data from loads where carrier_id = '${cid}' and data->>'referenceNumber' = 'SUM-1'`) || "null");
  check("...takes the load down, checks it fits a truck, and moves to the price on the same call", /INTAKE:.*It fits truck/.test(spoken(tw)) && phoned?.stage === "negotiating" && /Phone call · Summit Logistics/.test(phoned?.source ?? "") && /broker\/turn\?carrier=.*load=/.test(tw), spoken(tw).slice(0, 200) + " | " + JSON.stringify(phoned?.source));
  const priceUrl = new URL(tw.match(/action="([^"]+)"/)[1].replace(/&amp;/g, "&"));
  tw = await twilio(priceUrl.pathname + priceUrl.search, { From: "+19045550177", To: "+14695550199", CallSid: `CAD1${RUN}`, SpeechResult: "what do you need on it?" });
  check("...where the AI gives its number like any broker call", /OUR-PRICE:.*dollars all in/.test(spoken(tw)), spoken(tw).slice(0, 200));
  db(`delete from loads where carrier_id = '${cid}' and data->>'referenceNumber' = 'SUM-1'`);
  db(`delete from trucks where carrier_id = '${cid}' and id = 'desk-t'`);

  // A broker who writes in French gets our answers in French.
  newLoad("rep-4", "FR-1", { targetRate: 1600, bookRequest: { ask: 1600, askedAt: new Date().toISOString(), status: "sent" } });
  pm0 = read("postmark").length;
  await email("Re: FR-1", "Bonjour, we can do $1,300 on FR-1. Merci");
  const fr = await mailAfter(pm0, /FR-1/);
  check("a broker writing in French gets the counter in French, every amount intact", !!fr && /^\[fr\] /.test(fr.TextBody) && /\$1,\d{3} all in on FR-1/.test(fr.TextBody), fr?.TextBody?.slice(0, 200));
  check("...and the broker's language is remembered", db(`select data->>'language' from records where carrier_id = '${cid}' and kind = 'broker' and data->>'email' = 'loads@tql.test'`) === "fr");
  db(`update records set data = data || '{"language":"en"}'::jsonb where carrier_id = '${cid}' and kind = 'broker' and data->>'email' = 'loads@tql.test'`);
  db(`delete from loads where carrier_id = '${cid}' and id = 'rep-4'`);

  db(`delete from loads where carrier_id = '${cid}' and id in ('rep-1', 'rep-2', 'rep-3')`);
  settings({ autonomy: "rules" });
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
