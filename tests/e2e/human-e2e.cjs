// The rest of a human dispatcher's job, against the stand-ins: signing the rate con, the tracking app, dock
// appointments by phone, layover, broker credit, priced changes after booking, the factoring packet and cargo claims.
const path = require("path");
const S = path.join(__dirname, "..");
const ROOT = path.join(__dirname, "../..");
const crypto = require("crypto");
const fs = require("fs");
const { execSync } = require("child_process");
const { PDFDocument } = require(ROOT + "/node_modules/pdf-lib");
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
const calls = (i) => read("twilio").slice(i).filter((x) => x.path.endsWith("/Calls.json"));
const esc = (like) => db(`select status || '|' || (data->>'reason') from escalations where carrier_id = '${cid}' and data->>'reason' like '${like.replace(/'/g, "''")}' order by (data->>'createdAt') desc limit 1`);
const key = db(`select inbound_key from carriers where id = '${cid}'`);
const truckBy = (unit) => JSON.parse(db(`select data from trucks where carrier_id = '${cid}' and unit_number = '${unit}'`));
const sign = (url, params) => crypto.createHmac("sha1", "twilio-secret").update(url + Object.keys(params).sort().map((k) => k + params[k]).join("")).digest("base64");
async function twilio(path, params) {
  const url = BASE + path;
  return (await fetch(url, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", "x-twilio-signature": sign(url, params) }, body: new URLSearchParams(params) })).text();
}
let n = 0;
const RUN = Date.now().toString(36);
async function email(from, name, subject, text, attachments = []) {
  const body = { MessageID: `pm-human-${RUN}-${++n}`, From: from, FromName: name, FromFull: { Email: from, Name: name }, To: `abc123+${key}@inbound.postmarkapp.com`, MailboxHash: key, Subject: subject, TextBody: text, Headers: [{ Name: "Message-ID", Value: `<human-${RUN}-${n}@x.test>` }], Attachments: attachments };
  await fetch(`${BASE}/api/channels/email?token=email-hook-secret`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  await sleep(3500);
}
const MARCUS = "+12145550148";
const HX = "loads@hxlog.test";
const broker = (id, company, email, mc, extra = {}) => {
  const b = { id, carrierId: cid, company, contact: "Dana", phone: "", email, reliability: 90, avgResponseMins: 20, loadsBooked: 0, onTimePct: 95, avgRateVariancePct: 0, tier: "standard", authorityVerified: true, mc, legalName: company, verifiedAt: new Date().toISOString(), verifyNote: "FMCSA: broker authority active.", fraudRisk: "low", avgDaysToPay: 30, detentionPaidPct: 80, cancellations90d: 0, ...extra };
  db(`insert into records (carrier_id, id, kind, data) values ('${cid}', '${id}', 'broker', '${JSON.stringify(b).replace(/'/g, "''")}'::jsonb) on conflict (carrier_id, kind, id) do update set data = excluded.data`);
};
// A copy of CFP-88213 (truck 101's first load) with a new id and whatever the test needs.
const copyLoad = (id, patch, stage, truckId) => {
  db(`delete from loads where carrier_id = '${cid}' and id = '${id}'`);
  db(`insert into loads (id, carrier_id, truck_id, stage, data) select '${id}', carrier_id, ${truckId ? `'${truckId}'` : "truck_id"}, '${stage}', data || '${JSON.stringify({ id, stage, updatedAt: new Date().toISOString(), ...(truckId ? { truckId } : {}), ...patch }).replace(/'/g, "''")}'::jsonb from loads where carrier_id = '${cid}' and data->>'referenceNumber' = 'CFP-88213' limit 1`);
};
const freeTrucks = () => {
  db(`update loads set stage = 'declined', data = data || '{"stage":"declined"}'::jsonb where carrier_id = '${cid}' and stage in ('offered', 'negotiating', 'booked', 'dispatched', 'at_pickup', 'in_transit', 'at_delivery')`);
  db(`update trucks set data = data || '{"nextLoadId":null,"currentLoadId":null,"status":"available"}'::jsonb where carrier_id = '${cid}'`);
};
const fileRow = (kind, loadId, name) => db(`insert into carrier_files (carrier_id, kind, load_id, name, content_type, size, data) values ('${cid}', '${kind}', '${loadId}', '${name}', 'image/jpeg', 10, 'aGVsbG8=') returning id`).split("\n")[0];
const RC = (patch) => ({ isRateCon: true, broker: "Hexa Logistics", brokerMc: null, brokerEmail: HX, loadNumber: "HX-1001", totalRate: 2000, originCity: "Dallas", originState: "TX", destinationCity: "Memphis", destinationState: "TN", miles: 452, equipment: "Dry van 53 ft", detention: "2 hrs free, then $50/hr", paymentTerms: "Net 30", finesAndFees: [], mismatches: [], otherConcerns: [], summary: "Matches what was agreed.", shipper: "Dallas Foods", receiver: "Memphis DC 4", shipperPhone: null, receiverPhone: null, appointmentNeeded: "none", ...patch });

(async () => {
  const t101 = truckBy("101");
  const t102 = truckBy("102");
  broker("hx-broker", "Hexa Logistics", HX, "771999");
  settings({ autonomy: "rules", rateConSigner: { name: "Maria Lopez", title: "Owner" }, factoringEmail: null, cargoInsurerEmail: null, sandbox: false });
  freeTrucks();
  db(`delete from agent_marks where carrier_id = '${cid}' and (load_id like 'hx-%' or load_id like 'broker:%')`);
  db(`delete from loads where carrier_id = '${cid}' and (id like 'hx-%' or data->>'referenceNumber' like 'SIM-71%')`);
  db(`delete from carrier_files where carrier_id = '${cid}' and load_id like 'hx-%'`);

  // ── 1. The rate con: signed and sent back; the tracking app; the delivery appointment ──
  copyLoad("hx-1", { referenceNumber: "HX-1001", brokerId: "hx-broker", brokerContactEmail: HX, bookedRate: null, targetRate: 2000, bookRequest: { ask: 2000, askedAt: new Date().toISOString(), status: "sent" }, rateConReading: null, rateCon: null, tracking: null, appointments: null, rateConSignedAt: null, lane: { origin: "Dallas", originState: "TX", destination: "Memphis", destState: "TN", miles: 452, marketRpm: 2.5 } }, "negotiating", t101.id);
  fs.writeFileSync(`${S}/fakes/ratecon.json`, JSON.stringify(RC({ otherConcerns: ["Macropoint tracking required"], receiverPhone: "(901) 555-0177", appointmentNeeded: "delivery" })));
  const pdf = fs.readFileSync(`${S}/fakes/data/ratecon.pdf`).toString("base64");
  let p0 = read("postmark").length, t0 = read("twilio").length;
  await email(HX, "Dana at Hexa", "Rate con HX-1001", "Rate con attached for HX-1001. Macropoint link: https://visibility.macropoint.com/t/abc123", [{ Name: "HX-1001.pdf", ContentType: "application/pdf", ContentLength: 645, Content: pdf }]);
  fs.unlinkSync(`${S}/fakes/ratecon.json`);
  let l = loadById("hx-1");
  const thanks = sent(p0).find((m) => m.To === HX && /HX-1001/.test(m.Subject));
  const signedAtt = thanks?.Attachments?.find((a) => a.Name === "HX-1001-signed.pdf");
  check("a matching rate con books the load", ["booked", "dispatched"].includes(l.stage), l.stage);
  check("the thanks email says it's signed and carries the signed copy", !!signedAtt && /signed copy is attached/i.test(thanks.TextBody), thanks?.TextBody?.slice(0, 200));
  const signedPdf = signedAtt ? await PDFDocument.load(Buffer.from(signedAtt.Content, "base64")) : null;
  check("the signed copy is the broker's pages plus a signature page", signedPdf?.getPageCount() === 2, signedPdf?.getPageCount());
  check("the load records who signed and when", l.rateConSignedBy === "Maria Lopez" && !!l.rateConSignedAt);
  const kinds = db(`select string_agg(kind, ',' order by kind) from carrier_files where carrier_id = '${cid}' and load_id = 'hx-1'`);
  check("the broker's rate con and the signed copy are both kept on the load", kinds === "rate_con,rate_con_signed", kinds);
  const trackText = texts(t0, MARCUS).find((b) => /HX-1001 needs Macropoint/.test(b));
  check("the driver is told to turn on Macropoint, with the link", !!trackText && trackText.includes("https://visibility.macropoint.com/t/abc123") && /Reply YES/.test(trackText), trackText);

  p0 = read("postmark").length; t0 = read("twilio").length;
  await twilio("/api/channels/sms", { From: MARCUS, To: "+14695550199", Body: "yes", MessageSid: `SM-hx-yes-${RUN}` });
  await sleep(3000);
  l = loadById("hx-1");
  check("driver's yes turns tracking on", !!l.tracking?.acceptedAt);
  check("...the broker is told", sent(p0).some((m) => m.To === HX && /Tracking on HX-1001/.test(m.Subject)));
  check("...and the driver gets a short thanks", texts(t0, MARCUS).some((b) => /tracking's on for HX-1001/.test(b)), texts(t0, MARCUS).join(" / "));

  // The rate con says to call for a delivery appointment: the rounds take it up.
  t0 = read("twilio").length;
  await cron();
  l = loadById("hx-1");
  const appt = l.appointments?.delivery;
  const dialed = calls(t0).find((c) => c.params.To === "+19015550177");
  check("a delivery appointment to book is on the load (called now in desk hours, or later)", appt?.purpose === "book" && (appt.status === "calling" ? !!dialed : appt.status === "needed"), JSON.stringify(appt));
  // The call itself (placed now, or as if placed).
  db(`update loads set data = jsonb_set(data, '{appointments}', '{"delivery":{"purpose":"book","status":"calling","tries":1,"lastCallAt":"${new Date().toISOString()}"}}'::jsonb) where id = 'hx-1' and carrier_id = '${cid}'`);
  const fUrl = `/api/channels/voice/facility?carrier=${encodeURIComponent(cid)}&load=hx-1&stop=delivery`;
  let tw = await twilio(fUrl, { CallSid: `CAF1-${RUN}`, From: "+14695550199", To: "+19015550177", Direction: "outbound-api", AnsweredBy: "human" });
  check("on the call: says it's an AI, transcribed, and asks to book the delivery", /AI dispatcher for Titan Freight LLC/.test(tw) && /transcribed/.test(tw) && /book a delivery appointment for load HX-1001 with Hexa Logistics/.test(tw), tw.slice(0, 400));
  const fTurn = `/api/channels/voice/facility/turn?carrier=${encodeURIComponent(cid)}&load=hx-1&stop=delivery`;
  tw = await twilio(fTurn, { CallSid: `CAF1-${RUN}`, SpeechResult: "Thank you for calling Memphis DC. For receiving appointments, press 3. For shipping, press 2." });
  check("their phone menu: presses 3 for receiving", /<Play digits="w3"\/>/.test(tw), tw.slice(0, 300));
  tw = await twilio(fTurn, { CallSid: `CAF1-${RUN}`, SpeechResult: "Receiving, this is Pat. What's the PO number on that?" });
  check("a question: answers from the load and asks for a time again", /HX-1001/.test(tw) && /What time can you give us/.test(tw) && !/<Hangup/.test(tw), tw.slice(0, 400));
  p0 = read("postmark").length; t0 = read("twilio").length;
  tw = await twilio(fTurn, { CallSid: `CAF1-${RUN}`, SpeechResult: "OK I can do 9 AM tomorrow, confirmation number 55812" });
  l = loadById("hx-1");
  check("a time: repeated back with the confirmation, and the call ends", /confirmation 55812/.test(tw) && /<Hangup\/>/.test(tw), tw.slice(0, 300));
  check("the appointment is on the load", l.appointments?.delivery?.status === "set" && l.appointments.delivery.confirmation === "55812" && l.deliveryAt === l.appointments.delivery.at && /9:00 AM/.test(l.deliveryWindow), JSON.stringify(l.appointments) + " " + l.deliveryWindow);
  check("the driver is texted the time", texts(t0, MARCUS).some((b) => /HX-1001 delivery appointment is .*9:00 AM.*confirmation 55812/.test(b)), texts(t0, MARCUS).join(" / "));
  check("the broker is told", sent(p0).some((m) => m.To === HX && /Appointment/.test(m.Subject) && /55812/.test(m.TextBody)));

  // Moving a pickup the truck will miss: the facility says the broker has to.
  db(`update loads set data = data || '${JSON.stringify({ rateConReading: { ...RC({}), shipperPhone: "(214) 555-0166", readAt: new Date().toISOString(), fileName: "x.pdf" }, pickupAt: new Date(Date.now() + 2 * 3600000).toISOString(), appointments: { pickup: { purpose: "move", status: "calling", tries: 1, eta: new Date(Date.now() + 5 * 3600000).toISOString(), lastCallAt: new Date().toISOString() } } })}'::jsonb where id = 'hx-1' and carrier_id = '${cid}'`);
  tw = await twilio(`/api/channels/voice/facility?carrier=${encodeURIComponent(cid)}&load=hx-1&stop=pickup`, { CallSid: `CAF2-${RUN}`, From: "+14695550199", To: "+12145550166", Direction: "outbound-api", AnsweredBy: "human" });
  check("a move: says the truck is running behind and when it'll get there", /running behind: it(&apos;|')ll get there around/.test(tw), tw.slice(0, 400));
  p0 = read("postmark").length;
  tw = await twilio(`/api/channels/voice/facility/turn?carrier=${encodeURIComponent(cid)}&load=hx-1&stop=pickup`, { CallSid: `CAF2-${RUN}`, SpeechResult: "Sorry, the broker has to reschedule that, we can't do it from here." });
  l = loadById("hx-1");
  check("they won't by phone: thanks them and hangs up, and it's handed to the broker", /<Hangup\/>/.test(tw) && l.appointments?.pickup?.status === "broker");
  check("...the broker is asked to move it", sent(p0).some((m) => m.To === HX && /Appointment/.test(m.Subject) && /has to come from you/.test(m.TextBody)));
  check("...the owner is told, and nothing goes to support", /^open\|HX-1001: Dallas Foods wants the broker to set the pickup appointment/.test(esc("HX-1001: Dallas Foods%")), esc("HX-1001: Dallas Foods%"));
  // Voicemail: tried again later, not a failure.
  db(`update loads set data = data || '{"appointments":{"delivery":{"purpose":"book","status":"calling","tries":1}}}'::jsonb where id = 'hx-1' and carrier_id = '${cid}'`);
  tw = await twilio(fUrl, { CallSid: `CAF3-${RUN}`, From: "+14695550199", To: "+19015550177", Direction: "outbound-api", AnsweredBy: "machine_end_beep" });
  check("voicemail: a short message, and it's tried again later", /We(&apos;|')ll call back shortly/.test(tw) && loadById("hx-1").appointments?.delivery?.status === "needed", tw.slice(0, 200));
  db(`update loads set stage = 'declined', data = data || '{"stage":"declined"}'::jsonb where id = 'hx-1' and carrier_id = '${cid}'`);

  // ── 2. Layover: held overnight at a stop it reached on time ──
  const ago = (h) => new Date(Date.now() - h * 3600000).toISOString();
  copyLoad("hx-lay", { referenceNumber: "HX-LAY", brokerId: "hx-broker", brokerContactEmail: HX, bookedRate: 1900, deliveryAt: ago(30), tripChecklist: { arrivedPickupAt: ago(60), loadedAt: ago(58), arrivedDeliveryAt: ago(30.2) }, rateConReading: { ...RC({ loadNumber: "HX-LAY", finesAndFees: ["Layover $300/day"] }), readAt: ago(70), fileName: "x.pdf" }, layoverClaims: null, detentionClaims: null }, "at_delivery", t102.id);
  p0 = read("postmark").length;
  await cron();
  l = loadById("hx-lay");
  const lay = sent(p0).find((m) => m.To === HX && /Layover/.test(m.Subject));
  check("held overnight: the broker gets a layover claim at the rate con's $300/day", !!lay && /1 day of layover at \$300\/day: \$300/.test(lay.TextBody) && /on time for the appointment/.test(lay.TextBody), lay?.TextBody?.slice(0, 300));
  check("...recorded as sent on the load", l.layoverClaims?.[0]?.amount === 300 && !!l.layoverClaims[0].sentAt);
  // It leaves, 31 hours after arriving: no hourly detention on top for that stop.
  db(`update loads set stage = 'delivered', data = data || '${JSON.stringify({ stage: "delivered", tripChecklist: { arrivedPickupAt: ago(60), loadedAt: ago(58), arrivedDeliveryAt: ago(30.2), unloadedAt: ago(0.1) } })}'::jsonb where id = 'hx-lay' and carrier_id = '${cid}'`);
  p0 = read("postmark").length;
  await cron();
  check("no hourly detention on top of the layover for the same stop", !sent(p0).some((m) => /HX-LAY/.test(m.Subject) && /Detention/.test(m.Subject)) && !(loadById("hx-lay").detentionClaims ?? []).some((c) => c.stop === "delivery"));
  // Late for the appointment: nothing owed.
  copyLoad("hx-late", { referenceNumber: "HX-LATE", brokerId: "hx-broker", brokerContactEmail: HX, deliveryAt: ago(40), tripChecklist: { arrivedDeliveryAt: ago(30) }, layoverClaims: null }, "at_delivery", t102.id);
  p0 = read("postmark").length;
  await cron();
  check("a truck that got there late claims no layover", !sent(p0).some((m) => /HX-LATE/.test(m.Subject) && /Layover/.test(m.Subject)) && !loadById("hx-late").layoverClaims);
  db(`update loads set stage = 'delivered', data = data || '{"stage":"delivered"}'::jsonb where id = 'hx-late' and carrier_id = '${cid}'`);

  // ── 3. Broker credit before booking ──
  freeTrucks();
  settings({ maxDeadhead: 1000 });
  broker("lc-broker", "Lowcredit Freight", "ops@lowcredit.test", "777013");
  broker("sp-broker", "Slowpay Brokerage", "ops@slowpay.test", "777014");
  db(`update trucks set data = data || '{"currentCity":"Dallas","currentState":"TX"}'::jsonb where carrier_id = '${cid}'`);
  const equip = t101.equipmentType === "Reefer" ? " reefer" : "";
  p0 = read("postmark").length;
  let b0 = read("boards").length;
  await email("ops@lowcredit.test", "Lowcredit Freight", "Load SIM-7101", `Load SIM-7101${equip}: Dallas, TX to Houston, TX, 240 miles, $1,300. Pickup tomorrow.`);
  const lc = JSON.parse(db(`select data from records where carrier_id = '${cid}' and id = 'lc-broker'`));
  check("the credit service is asked about the broker's MC", read("boards").slice(b0).some((x) => x.board === "credit" && x.mc === "777013" && x.auth === "credit-key"));
  check("the broker's score is recorded", lc.credit?.score === 41 && lc.credit.daysToPay === 52 && /TestCredit/.test(lc.credit.source), JSON.stringify(lc.credit));
  check("under the owner's lowest score: no book request goes out", !sent(p0).some((m) => m.To === "ops@lowcredit.test" && /SIM-7101/.test(m.Subject + m.TextBody)), sent(p0).map((m) => m.To + ":" + m.Subject).join(" / "));
  check("...and the owner is told why", /credit score is 41\/100, under your lowest \(70\)/.test(esc("Backroute didn't ask to book SIM-7101%")), esc("Backroute didn't ask to book SIM-7101%"));
  freeTrucks();
  p0 = read("postmark").length;
  await email("ops@slowpay.test", "Slowpay Brokerage", "Load SIM-7102", `Load SIM-7102${equip}: Dallas, TX to Houston, TX, 240 miles, $1,300. Pickup tomorrow.`);
  const sp = JSON.parse(db(`select data from loads where carrier_id = '${cid}' and data->>'referenceNumber' = 'SIM-7102'`) || "null");
  const ask = sent(p0).find((m) => m.To === "ops@slowpay.test");
  check("a slow payer (48 days) is asked 4% more, and still booked with", sp?.surchargePct === 4 && !!ask && sp.bookRequest?.ask > 0, JSON.stringify({ s: sp?.surchargePct, ask: sp?.bookRequest?.ask, stage: sp?.stage }));
  freeTrucks();

  // ── 4. A change after booking, priced before saying yes ──
  copyLoad("hx-chg", { referenceNumber: "HX-2002", brokerId: "hx-broker", brokerContactEmail: HX, bookedRate: 1800, change: null, stops: [], lane: { origin: "Dallas", originState: "TX", destination: "Memphis", destState: "TN", miles: 452, marketRpm: 2.5 } }, "dispatched", t101.id);
  db(`update trucks set data = data || '{"currentLoadId":"hx-chg","status":"on_load"}'::jsonb where id = '${t101.id}'`);
  p0 = read("postmark").length; t0 = read("twilio").length;
  await email(HX, "Dana at Hexa", "HX-2002", "Hi, can you add a stop in Jackson, MS on HX-2002? Thanks, Dana");
  l = loadById("hx-chg");
  const minRpm = Number(db(`select coalesce(settings->>'minRpm', '0') from carriers where id = '${cid}'`));
  const want = Math.round((l.change?.extraMiles * Math.max(1800 / 452, minRpm) + 75) / 25) * 25;
  const priced = sent(p0).find((m) => m.To === HX && /HX-2002/.test(m.Subject));
  check("an added stop is priced: extra miles at the load's rate a mile plus stop pay", l.change?.status === "asked" && l.change.extraMiles > 0 && l.change.extra === want && l.change.newTotal === 1800 + want, JSON.stringify(l.change));
  check("...and the broker gets the number and the new total", !!priced && new RegExp(`\\$${want.toLocaleString("en-US")} more \\(\\$75 stop pay and ${l.change?.extraMiles} extra miles\\), so \\$${(1800 + want).toLocaleString("en-US")} all in`).test(priced.TextBody), priced?.TextBody?.slice(0, 300));
  p0 = read("postmark").length; t0 = read("twilio").length;
  await email(HX, "Dana at Hexa", "Re: HX-2002", "Works for us, revised rate con coming.");
  l = loadById("hx-chg");
  check("their yes puts the stop on the load", l.change?.status === "agreed" && l.stops?.some((s) => s.city === "Jackson" && s.state === "MS") && l.lane.miles === 452 + l.change.extraMiles, JSON.stringify({ c: l.change?.status, stops: l.stops, miles: l.lane.miles }));
  check("...and the driver hears about it", texts(t0, MARCUS).some((b) => /HX-2002 changed: there's an extra stop in Jackson, MS/.test(b)), texts(t0, MARCUS).join(" / "));
  // A reroute answered with a revised rate con.
  copyLoad("hx-rr", { referenceNumber: "HX-2003", brokerId: "hx-broker", brokerContactEmail: HX, bookedRate: 1800, change: null, lane: { origin: "Dallas", originState: "TX", destination: "Memphis", destState: "TN", miles: 452, marketRpm: 2.5 } }, "booked", t102.id);
  await email(HX, "Dana at Hexa", "HX-2003", "Need to reroute to Nashville, TN on HX-2003.");
  l = loadById("hx-rr");
  check("a reroute is priced from the extra miles", l.change?.kind === "reroute" && l.change.status === "asked" && l.change.extraMiles > 100, JSON.stringify(l.change));
  const rrTotal = l.change?.newTotal;
  fs.writeFileSync(`${S}/fakes/ratecon.json`, JSON.stringify(RC({ loadNumber: "HX-2003", totalRate: rrTotal, destinationCity: "Nashville" })));
  await email(HX, "Dana at Hexa", "Revised rate con HX-2003", "Revised rate con attached.", [{ Name: "HX-2003-rev.pdf", ContentType: "application/pdf", ContentLength: 645, Content: pdf }]);
  fs.unlinkSync(`${S}/fakes/ratecon.json`);
  l = loadById("hx-rr");
  check("a revised rate con at the new total agrees it: the load now delivers to Nashville", l.change?.status === "agreed" && l.lane.destination === "Nashville" && l.lane.destState === "TN", JSON.stringify({ c: l.change, lane: l.lane }));
  db(`update loads set stage = 'declined', data = data || '{"stage":"declined"}'::jsonb where id in ('hx-chg', 'hx-rr') and carrier_id = '${cid}'`);
  db(`update trucks set data = data || '{"currentLoadId":null,"status":"available"}'::jsonb where carrier_id = '${cid}'`);

  // ── 5. The factoring packet ──
  settings({ factoringEmail: "submit@factor.test" });
  db(`delete from carrier_files where carrier_id = '${cid}' and load_id like 'hx-%'`);
  copyLoad("hx-inv", { referenceNumber: "HX-3003", brokerId: "hx-broker", brokerContactEmail: HX, bookedRate: 2000, invoice: null, factoredAt: null, detentionClaims: [], documents: [], layoverClaims: [{ stop: "delivery", days: 1, amount: 250, draftedAt: ago(20), sentAt: ago(20) }], change: { kind: "add_stop", places: [{ city: "Tyler", state: "TX" }], extraMiles: 20, extra: 150, newTotal: 2150, askedAt: ago(40), status: "agreed", agreedAt: ago(39) }, lane: { origin: "Dallas", originState: "TX", destination: "Memphis", destState: "TN", miles: 472, marketRpm: 2.5 } }, "delivered", t102.id);
  const podId = fileRow("pod", "hx-inv", "HX-3003-pod.jpg");
  fileRow("rate_con", "hx-inv", "HX-3003-ratecon.pdf");
  db(`update loads set data = data || '${JSON.stringify({ documents: [{ id: "d1", type: "pod", name: "HX-3003-pod.jpg", generatedAt: ago(1), status: "verified", fileId: podId }] })}'::jsonb where id = 'hx-inv' and carrier_id = '${cid}'`);
  p0 = read("postmark").length;
  await cron();
  const packet = sent(p0).find((m) => m.To === "submit@factor.test" && /HX-3003/.test(m.Subject));
  const names = packet?.Attachments?.map((a) => a.Name) ?? [];
  check("the factoring company gets the packet: schedule, invoice, rate con, POD", names.join(",") === "INV-HX-3003-schedule.pdf,INV-HX-3003.pdf,HX-3003-ratecon.pdf,HX-3003-pod.jpg", names.join(","));
  check("...for the line haul plus the layover and the agreed extra stop", /invoice INV-HX-3003, \$2,400/.test(packet?.TextBody ?? "") && loadById("hx-inv").invoice?.lines?.length === 3, packet?.TextBody?.slice(0, 200));
  check("...and it's recorded as factored", !!loadById("hx-inv").factoredAt && loadById("hx-inv").invoice?.sentTo === "submit@factor.test");
  check("nothing goes to the broker (the factor collects)", !sent(p0).some((m) => m.To === HX && /INV-HX-3003/.test(m.Subject)));
  settings({ factoringEmail: null });

  // ── 6. A cargo claim ──
  settings({ cargoInsurerEmail: "claims@insurer.test" });
  copyLoad("hx-clm", { referenceNumber: "HX-4004", brokerId: "hx-broker", brokerContactEmail: HX, bookedRate: 1700, claim: null, invoice: { number: "INV-HX-4004", amount: 1700, draftedAt: ago(5), sentAt: ago(5) }, tripChecklist: { arrivedPickupAt: ago(40), loadedAt: ago(39), arrivedDeliveryAt: ago(10), unloadedAt: ago(9) } }, "delivered", t101.id);
  fileRow("bol", "hx-clm", "HX-4004-bol.jpg");
  p0 = read("postmark").length; t0 = read("twilio").length;
  await email(HX, "Dana at Hexa", "Cargo claim HX-4004", "We're filing a damage claim on HX-4004: 3 pallets crushed at delivery. Claim amount $1,240. Dana");
  l = loadById("hx-clm");
  const ack = sent(p0).find((m) => m.To === HX && /Cargo claim HX-4004/.test(m.Subject));
  check("the claim is acknowledged in writing, with what they need to send", !!ack && /received your claim on HX-4004 for \$1,240/.test(ack.TextBody) && /commercial invoice/.test(ack.TextBody) && /within 30 days/.test(ack.TextBody), ack?.TextBody?.slice(0, 300));
  check("the claim is on the load", l.claim?.kind === "damage" && l.claim.amount === 1240 && l.claim.source === "broker" && !!l.claim.ackSentAt, JSON.stringify(l.claim));
  check("the driver is asked what happened", texts(t0, MARCUS).some((b) => /damage claim on HX-4004/.test(b) && /sealed/.test(b)), texts(t0, MARCUS).join(" / "));
  check("the owner is told it's their call to pay or file", /^open\|Cargo claim on HX-4004 \(damage, \$1,240\)/.test(esc("Cargo claim on HX-4004%")) && /pay it yourself or file it with insurance/.test(esc("Cargo claim on HX-4004%")), esc("Cargo claim on HX-4004%"));
  t0 = read("twilio").length;
  await twilio("/api/channels/sms", { From: MARCUS, To: "+14695550199", Body: "It was sealed at pickup, seal 44821. Receiver broke the seal, two pallets were leaning, I wrote it on the BOL.", MessageSid: `SM-hx-stmt-${RUN}` });
  await sleep(3000);
  l = loadById("hx-clm");
  check("the driver's account goes in the claim file", /seal 44821/.test(l.claim?.statement ?? "") && texts(t0, MARCUS).some((b) => /in the claim file for HX-4004/.test(b)), texts(t0, MARCUS).join(" / "));
  p0 = read("postmark").length;
  await cron();
  l = loadById("hx-clm");
  const claimFile = db(`select name from carrier_files where carrier_id = '${cid}' and load_id = 'hx-clm' and kind = 'claim_file'`);
  check("the claim file is put together", claimFile === "HX-4004-claim.pdf" && l.claim?.packetFileId, claimFile);
  check("it waits for the owner's OK before going to the insurer", !sent(p0).some((m) => m.To === "claims@insurer.test") && /^open\|The claim file for HX-4004 is ready\. Send it to your cargo insurer \(claims@insurer\.test\)/.test(esc("The claim file for HX-4004%")), esc("The claim file for HX-4004%"));
  const draft = JSON.parse(db(`select data->'draft' from escalations where carrier_id = '${cid}' and data->>'reason' like 'The claim file for HX-4004%' order by (data->>'createdAt') desc limit 1`) || "null");
  check("...with the file, the BOL and the rate con attached to the draft", draft?.to === "claims@insurer.test" && draft.attachments?.some((a) => a.name === "HX-4004-claim.pdf") && draft.attachments?.some((a) => a.name === "HX-4004-bol.jpg"), JSON.stringify(draft?.attachments));
  settings({ cargoInsurerEmail: null, maxDeadhead: 300, rateConSigner: null });

  console.log(`\n${passed} passed, ${failed} failed`);
})().catch((e) => { console.error(e); process.exit(1); });
