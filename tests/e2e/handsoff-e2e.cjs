// What used to go to the support team and now the AI finishes itself, against the stand-ins: a broker's missing MC,
// bank-detail scams, impostors, short pays, late invoices, appointments through the broker, portal rate cons, tracking
// that won't turn on. Support gets only an emergency, another company's website, an outage, or an owner who didn't
// pick up something urgent.
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
const esc = (like) => db(`select status || '|' || (data->>'reason') from escalations where carrier_id = '${cid}' and data->>'reason' like '${like.replace(/'/g, "''")}' order by (data->>'createdAt') desc limit 1`);
const supportSince = (at) => db(`select coalesce(string_agg(left(data->>'reason', 140), ' / '), '') from escalations where carrier_id = '${cid}' and status = 'with_support' and data->>'createdAt' > '${at}'`);
const key = db(`select inbound_key from carriers where id = '${cid}'`);
const truckBy = (unit) => JSON.parse(db(`select data from trucks where carrier_id = '${cid}' and unit_number = '${unit}'`));
let n = 0;
const RUN = Date.now().toString(36);
async function email(from, name, subject, text, attachments = []) {
  const body = { MessageID: `pm-hands-${RUN}-${++n}`, From: from, FromName: name, FromFull: { Email: from, Name: name }, To: `abc123+${key}@inbound.postmarkapp.com`, MailboxHash: key, Subject: subject, TextBody: text, Headers: [{ Name: "Message-ID", Value: `<hands-${RUN}-${n}@x.test>` }], Attachments: attachments };
  await fetch(`${BASE}/api/channels/email?token=email-hook-secret`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  await sleep(3500);
}
const ago = (h) => new Date(Date.now() - h * 3600000).toISOString();
const MARCUS = "+12145550148";
const SUPPORT = "+13125550100";
const HO = "loads@hoboker.test";
const broker = (id, company, email, extra = {}) => {
  const b = { id, carrierId: cid, company, contact: "Jo", phone: "", email, reliability: 90, avgResponseMins: 20, loadsBooked: 0, onTimePct: 95, avgRateVariancePct: 0, tier: "standard", authorityVerified: true, mc: "771888", legalName: company, verifiedAt: new Date().toISOString(), verifyNote: "FMCSA: broker authority active.", fraudRisk: "low", avgDaysToPay: 30, detentionPaidPct: 80, cancellations90d: 0, ...extra };
  db(`insert into records (carrier_id, id, kind, data) values ('${cid}', '${id}', 'broker', '${JSON.stringify(b).replace(/'/g, "''")}'::jsonb) on conflict (carrier_id, kind, id) do update set data = excluded.data`);
};
const copyLoad = (id, patch, stage, truckId) => {
  db(`delete from loads where carrier_id = '${cid}' and id = '${id}'`);
  db(`insert into loads (id, carrier_id, truck_id, stage, data) select '${id}', carrier_id, ${truckId ? `'${truckId}'` : "truck_id"}, '${stage}', data || '${JSON.stringify({ id, stage, updatedAt: new Date().toISOString(), ...(truckId ? { truckId } : {}), ...patch }).replace(/'/g, "''")}'::jsonb from loads where carrier_id = '${cid}' and data->>'referenceNumber' = 'CFP-88213' limit 1`);
};
const freeTrucks = () => {
  db(`update loads set stage = 'declined', data = data || '{"stage":"declined"}'::jsonb where carrier_id = '${cid}' and stage in ('offered', 'negotiating', 'booked', 'dispatched', 'at_pickup', 'in_transit', 'at_delivery')`);
  db(`update trucks set data = data || '{"nextLoadId":null,"currentLoadId":null,"status":"available"}'::jsonb where carrier_id = '${cid}'`);
};
const RC = (patch) => ({ isRateCon: true, broker: "Hoboker Logistics", brokerMc: null, brokerEmail: HO, loadNumber: "HO-1001", totalRate: 2000, originCity: "Dallas", originState: "TX", destinationCity: "Memphis", destinationState: "TN", miles: 452, equipment: "Dry van", detention: "2 hrs free, then 50 per hour", paymentTerms: "Net 30", finesAndFees: [], mismatches: [], otherConcerns: [], summary: "Matches what was agreed.", shipper: "Dallas Foods", receiver: "Memphis DC 4", shipperPhone: null, receiverPhone: null, appointmentNeeded: "none", ...patch });

(async () => {
  const start = new Date().toISOString();
  const t101 = truckBy("101");
  const t102 = truckBy("102");
  settings({ autonomy: "rules", factoringEmail: null, sandbox: false, maxDeadhead: 1000, rateConSigner: { name: "Maria Lopez" } });
  broker("ho-broker", "Hoboker Logistics", HO);
  db(`delete from agent_marks where carrier_id = '${cid}' and (load_id like 'ho-%' or load_id like 'broker:%' or load_id like 'esc:%')`);
  db(`delete from loads where carrier_id = '${cid}' and (id like 'ho-%' or data->>'referenceNumber' like 'SIM-72%')`);
  db(`delete from records where carrier_id = '${cid}' and kind = 'broker' and data->>'email' = 'loads@prairiefreight.test'`);
  freeTrucks();
  db(`update trucks set data = data || '{"currentCity":"Dallas","currentState":"TX"}'::jsonb where carrier_id = '${cid}'`);
  const equip = t101.equipmentType === "Reefer" ? " reefer" : "";

  // ── A new broker with no MC: the AI asks for it, checks it, then books ──
  let p0 = read("postmark").length;
  await email("loads@prairiefreight.test", "Prairie Freight", "Load SIM-7201", `Load SIM-7201${equip}: Dallas, TX to Houston, TX, 240 miles, $1,300. Pickup tomorrow.`);
  const mcAsk = sent(p0).find((m) => m.To === "loads@prairiefreight.test" && /MC number/.test(m.Subject));
  check("a broker with no MC is asked for it by email", !!mcAsk && /what's your MC number/.test(mcAsk.TextBody), sent(p0).map((m) => m.To + ":" + m.Subject).join(" / "));
  check("...and nothing goes to support", supportSince(start) === "", supportSince(start));
  p0 = read("postmark").length;
  await email("loads@prairiefreight.test", "Prairie Freight", "Re: MC number for Prairie Freight", "Sure, our MC is 777003. Thanks, Jo");
  const pf = JSON.parse(db(`select data from records where carrier_id = '${cid}' and kind = 'broker' and data->>'email' = 'loads@prairiefreight.test'`) || "null");
  check("their MC is checked with FMCSA when they send it", pf?.authorityVerified === true && pf.mc === "777003", JSON.stringify({ v: pf?.authorityVerified, mc: pf?.mc, note: pf?.verifyNote }));
  check("...and the AI asks to book their load", sent(p0).some((m) => m.To === "loads@prairiefreight.test" && /SIM-7201/.test(m.Subject + m.TextBody)), sent(p0).map((m) => m.To + ":" + m.Subject).join(" / "));
  freeTrucks();

  // ── Someone asking for bank details ──
  p0 = read("postmark").length;
  await email(HO, "Jo at Hoboker", "Banking update", "Please confirm your bank account and routing number so we can update our ACH records.");
  const bank = sent(p0).find((m) => m.To === HO);
  check("a bank-details request gets the standing answer, nothing shared", !!bank && /don't share, confirm or change payment or bank details by email/.test(bank.TextBody), bank?.TextBody?.slice(0, 200));
  check("...the owner is told (not support)", /^open\|Jo at Hoboker <loads@hoboker.test> asked about bank or payment details/.test(esc("Jo at Hoboker <loads@hoboker.test> asked about bank%")), esc("Jo at Hoboker%bank%"));

  // ── An impostor of a broker we know ──
  p0 = read("postmark").length;
  await email("loads@hobokerr.test", "Jo at Hoboker", "Load for you", "Got a load for you, reply with your rate.");
  const warn = sent(p0).find((m) => m.To === HO && /Someone is emailing as Hoboker Logistics/.test(m.Subject));
  check("an impostor: the real broker is warned at the address we had", !!warn && /loads@hobokerr.test/.test(warn.TextBody), sent(p0).map((m) => m.To + ":" + m.Subject).join(" / "));
  check("...the impostor gets nothing", !sent(p0).some((m) => m.To === "loads@hobokerr.test"));
  check("...and the owner is told", /^open\|/.test(esc("Jo at Hoboker <loads@hobokerr.test>%")), esc("Jo at Hoboker <loads@hobokerr.test>%"));

  // ── A short payment ──
  copyLoad("ho-pay", { referenceNumber: "HO-5005", brokerId: "ho-broker", brokerContactEmail: HO, bookedRate: 1800, invoice: { number: "INV-HO-5005", amount: 1800, lines: [{ label: "Line haul, all in", amount: 1800 }], draftedAt: ago(200), sentAt: ago(200), sentTo: "ap@hoboker.test" } }, "delivered", t102.id);
  p0 = read("postmark").length;
  await email("ap@hoboker.test", "Hoboker AP", "Remittance", "ACH sent today. paid invoice INV-HO-5005 $1,500");
  const shortQ = sent(p0).find((m) => m.To === "ap@hoboker.test" && /Short payment on invoice INV-HO-5005/.test(m.Subject));
  check("a short pay: the broker is asked what the $300 is for, with the invoice lines", !!shortQ && /\$300 less than the \$1,800 billed/.test(shortQ.TextBody) && /Line haul, all in: \$1,800/.test(shortQ.TextBody), shortQ?.TextBody?.slice(0, 300));

  // ── An invoice 31 days late after two reminders ──
  copyLoad("ho-late", { referenceNumber: "HO-6006", brokerId: "ho-broker", brokerContactEmail: HO, bookedRate: 2100, rateConReading: { ...RC({ loadNumber: "HO-6006" }), readAt: ago(1500), fileName: "x.pdf" }, invoice: { number: "INV-HO-6006", amount: 2100, draftedAt: ago(61 * 24), sentAt: ago(61 * 24), sentTo: "ap@hoboker.test", remindedAt: [ago(27 * 24), ago(17 * 24)] } }, "delivered", t102.id);
  db(`insert into agent_marks (carrier_id, load_id, kind) values ('${cid}', 'ho-late', 'pay_reminder_1'), ('${cid}', 'ho-late', 'pay_reminder_2') on conflict do nothing`);
  p0 = read("postmark").length;
  await cron();
  const final = sent(p0).find((m) => m.To === "ap@hoboker.test" && /Final notice: invoice INV-HO-6006/.test(m.Subject));
  check("31 days late after two reminders: a final notice naming the broker bond", !!final && /claim against your broker bond/.test(final.TextBody), sent(p0).map((m) => m.To + ":" + m.Subject).join(" / "));
  check("...and filing on the bond is the owner's call, not support's", /^open\|Invoice INV-HO-6006 .*final notice/.test(esc("Invoice INV-HO-6006%")), esc("Invoice INV-HO-6006%"));

  // ── A dock appointment through the broker ──
  copyLoad("ho-appt", { referenceNumber: "HO-7007", brokerId: "ho-broker", brokerContactEmail: HO, bookedRate: 1900, appointments: null, rateConReading: { ...RC({ loadNumber: "HO-7007", appointmentNeeded: "delivery", receiverPhone: null }), readAt: ago(1), fileName: "x.pdf" }, lane: { origin: "Dallas", originState: "TX", destination: "Memphis", destState: "TN", miles: 452, marketRpm: 2.5 } }, "dispatched", t101.id);
  db(`update trucks set data = data || '{"currentLoadId":"ho-appt","status":"on_load"}'::jsonb where id = '${t101.id}'`);
  p0 = read("postmark").length;
  await cron();
  let l = loadById("ho-appt");
  const askAppt = sent(p0).find((m) => m.To === HO && /Appointment/.test(m.Subject));
  check("no facility number on the rate con: the broker is asked to set the appointment", l.appointments?.delivery?.status === "broker" && !!askAppt && /Can you set it and send us the time/.test(askAppt.TextBody), JSON.stringify(l.appointments) + " " + askAppt?.TextBody?.slice(0, 200));
  let t0 = read("twilio").length;
  p0 = read("postmark").length;
  await email(HO, "Jo at Hoboker", "Re: Appointment HO-7007", "Delivery appointment is set for 10 AM tomorrow, confirmation 7781. HO-7007");
  l = loadById("ho-appt");
  check("their answer puts the time on the load", l.appointments?.delivery?.status === "set" && l.appointments.delivery.confirmation === "7781" && /10:00 AM/.test(l.deliveryWindow), JSON.stringify(l.appointments) + " " + l.deliveryWindow);
  check("...the driver is texted it", texts(t0, MARCUS).some((b) => /HO-7007 delivery appointment is .*10:00 AM/.test(b)), texts(t0, MARCUS).join(" / "));
  check("...and the broker gets a short thanks, not a note telling them their own news", sent(p0).some((m) => m.To === HO && /Got it, thanks/.test(m.TextBody)) && !sent(p0).some((m) => m.To === HO && /We booked the delivery appointment/.test(m.TextBody)));

  // ── Tracking still off at pickup ──
  copyLoad("ho-trk", { referenceNumber: "HO-8008", brokerId: "ho-broker", brokerContactEmail: HO, bookedRate: 1900, pickupAt: ago(0.2), tracking: { app: "Macropoint", link: null, askedAt: ago(5) } }, "dispatched", t101.id);
  p0 = read("postmark").length;
  t0 = read("twilio").length;
  await cron();
  const resend = sent(p0).find((m) => m.To === HO && /Tracking on HO-8008/.test(m.Subject));
  check("tracking still off at pickup: the broker is asked to resend it to the driver's number", !!resend && /send the request again to Marcus/.test(resend.TextBody), resend?.TextBody?.slice(0, 200));
  check("...and the driver hears it's coming", texts(t0, MARCUS).some((b) => /sending the Macropoint request for HO-8008 again/.test(b)), texts(t0, MARCUS).join(" / "));
  db(`update loads set stage = 'declined', data = data || '{"stage":"declined"}'::jsonb where id in ('ho-appt', 'ho-trk') and carrier_id = '${cid}'`);
  db(`update trucks set data = data || '{"currentLoadId":null,"status":"available"}'::jsonb where carrier_id = '${cid}'`);

  // ── A rate con to sign in the broker's portal ──
  copyLoad("ho-sign", { referenceNumber: "HO-9009", brokerId: "ho-broker", brokerContactEmail: HO, bookedRate: null, targetRate: 2000, bookRequest: { ask: 2000, askedAt: ago(1), status: "sent" }, rateConReading: null, lane: { origin: "Dallas", originState: "TX", destination: "Memphis", destState: "TN", miles: 452, marketRpm: 2.5 } }, "negotiating", t102.id);
  fs.writeFileSync(`${S}/fakes/ratecon.json`, JSON.stringify(RC({ loadNumber: "HO-9009" })));
  const pdf = fs.readFileSync(`${S}/fakes/data/ratecon.pdf`).toString("base64");
  p0 = read("postmark").length;
  const portalText = "Rate con for HO-9009 attached. Please sign via DocuSign: https://docusign.net/sign/abc";
  await email(HO, "Jo at Hoboker", "Rate con HO-9009", portalText, [{ Name: "HO-9009.pdf", ContentType: "application/pdf", ContentLength: 645, Content: pdf }]);
  check("a portal rate con: the AI first asks for it as a PDF by email", sent(p0).some((m) => m.To === HO && /as a PDF\? We sign and send it straight back/.test(m.TextBody)), sent(p0).map((m) => m.Subject).join(" / "));
  check("...with no support item yet", !/HO-9009/.test(supportSince(start)), supportSince(start));
  await email(HO, "Jo at Hoboker", "Re: Rate con HO-9009", portalText, [{ Name: "HO-9009.pdf", ContentType: "application/pdf", ContentLength: 645, Content: pdf }]);
  fs.unlinkSync(`${S}/fakes/ratecon.json`);
  check("they insist on the portal: support signs it there (another company's website)", /^with_support\|Jo at Hoboker needs the rate con for HO-9009 signed in their online portal/.test(esc("Jo at Hoboker needs the rate con for HO-9009%")), esc("%HO-9009 signed%"));

  // ── Something urgent the owner didn't pick up ──
  const escId = `esc-owner-${RUN}`;
  const old = ago(1.2);
  db(`insert into escalations (id, carrier_id, load_id, status, data, updated_at) values ('${escId}', '${cid}', null, 'open', '${JSON.stringify({ id: escId, loadId: "", reason: `Marcus Bell has not answered about delivery ${RUN}`, status: "open", complexity: "critical", createdAt: old, label: "Reached them" })}'::jsonb, '${old}')`);
  t0 = read("twilio").length;
  await cron();
  const moved = db(`select status from escalations where carrier_id = '${cid}' and id = '${escId}'`);
  check("an urgent item the owner hasn't touched in an hour goes to support", moved === "with_support", moved);
  check("...and the support team's phones get it", texts(t0, SUPPORT).some((b) => new RegExp(`has not answered about delivery ${RUN}`).test(b)), texts(t0, SUPPORT).join(" / "));

  // ── What reached support in all of this ──
  const all = supportSince(start);
  check("the only new support items were the portal and the owner-silent emergency", all.split(" / ").filter(Boolean).every((r) => /portal|has not answered/.test(r)), all);

  db(`update loads set stage = 'declined', data = data || '{"stage":"declined"}'::jsonb where carrier_id = '${cid}' and id like 'ho-%' and stage not in ('delivered')`);
  settings({ maxDeadhead: 300, rateConSigner: null });
  console.log(`\n${passed} passed, ${failed} failed`);
})().catch((e) => { console.error(e); process.exit(1); });
