// The AI dispatcher's own work, against the stand-ins: setup packets, loads from broker email, booking inside the
// owner's rate floor, check-ins by text and phone, POD upload, invoices and detention. Run after real-e2e,
// channels-e2e and approve-e2e (it uses the carrier they built).
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
const MARCUS = token("dddddddd-0000-0000-0000-000000000003", "12145550148");
const auth = (t) => ({ authorization: `Bearer ${t}` });
const post = (path, body, t = OWNER) => fetch(BASE + path, { method: "POST", headers: { "content-type": "application/json", ...auth(t) }, body: JSON.stringify(body) });
const cron = () => fetch(`${BASE}/api/cron/dispatch`, { headers: { authorization: "Bearer cron-secret" } }).then((r) => r.json());
const settings = (patch) => db(`update carriers set settings = settings || '${JSON.stringify(patch)}'::jsonb where id = '${cid}'`);
const load = (ref) => JSON.parse(db(`select data from loads where carrier_id = '${cid}' and data->>'referenceNumber' = '${ref}'`) || "null");
const setLoad = (ref, patch) => db(`update loads set data = data || '${JSON.stringify(patch)}'::jsonb${patch.stage ? `, stage = '${patch.stage}'` : ""} where carrier_id = '${cid}' and data->>'referenceNumber' = '${ref}'`);
const key = db(`select inbound_key from carriers where id = '${cid}'`);
let n = 0;
async function email(subject, text, { from = "loads@tql.test", name = "Kim at TQL", attachments = [], replyTo } = {}) {
  const id = `<tql-${++n}@tql.test>`;
  const body = {
    MessageID: `pm-in-${n}`, From: from, FromName: name, FromFull: { Email: from, Name: name }, To: `abc123+${key}@inbound.postmarkapp.com`, MailboxHash: key,
    Subject: subject, TextBody: text, Headers: [{ Name: "Message-ID", Value: id }, ...(replyTo ? [{ Name: "In-Reply-To", Value: replyTo }] : [])], Attachments: attachments,
  };
  const res = await fetch(`${BASE}/api/channels/email?token=email-hook-secret`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (res.status !== 200) throw new Error(`email webhook ${res.status}`);
  await sleep(2500);
  return id;
}
async function upload(t, kind, name, type, bytes, extra = {}) {
  const form = new FormData();
  form.set("file", new Blob([bytes], { type }), name);
  form.set("kind", kind);
  for (const [k, v] of Object.entries(extra)) form.set(k, v);
  const res = await fetch(`${BASE}/api/files`, { method: "POST", headers: auth(t), body: form });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}
function sign(url, params) {
  return crypto.createHmac("sha1", "twilio-secret").update(url + Object.keys(params).sort().map((k) => k + params[k]).join("")).digest("base64");
}
async function twilio(path, params) {
  const url = BASE + path;
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", "x-twilio-signature": sign(url, params) }, body: new URLSearchParams(params) });
  return res.text();
}
const escalations = (like) => db(`select count(*) from escalations where carrier_id = '${cid}' and data->>'reason' like '${like}'`);
const pmAfter = (i) => read("postmark").slice(i);

(async () => {
  settings({ minRpm: 2.5, autonomy: "ask", driverCheckins: false, remitEmail: "billing@titan.test", businessAddress: "100 Main St, Dallas, TX 75201" });
  const marcusId = db(`select id from drivers where carrier_id = '${cid}' and phone_last10 = '2145550148'`);
  const anaId = db(`select id from drivers where carrier_id = '${cid}' and phone_last10 = '9725550163'`);
  db(`insert into members (user_id, carrier_id, role, driver_id) values ('dddddddd-0000-0000-0000-000000000003', '${cid}', 'driver', '${marcusId}') on conflict do nothing`);

  // ── Setup packet ──────────────────────────────────────────────────────────
  let pm0 = read("postmark").length;
  await email("New carrier setup", "Hi, please send your carrier packet so we can set you up. Kim");
  check("setup request without papers: the owner is told what to upload", (await waitFor(() => escalations("%asked for your setup papers. Upload W-9 and insurance certificate%") === "1")) !== null);
  let r = await upload(MARCUS, "w9", "w9.pdf", "application/pdf", Buffer.from("%PDF-1.4 w9"));
  check("a driver can't add the carrier's papers", r.status === 403);
  const w9 = await upload(OWNER, "w9", "Titan-W9.pdf", "application/pdf", Buffer.from("%PDF-1.4 W9 CONTENT"));
  const later = new Date(Date.now() + 200 * 86400000).toISOString().slice(0, 10);
  const coi = await upload(OWNER, "coi", "Titan-COI.pdf", "application/pdf", Buffer.from("%PDF-1.4 COI CONTENT"), { expiresOn: later });
  check("owner uploads W-9 and COI", w9.status === 200 && coi.status === 200 && !!w9.body.id);
  const list = await fetch(`${BASE}/api/files`, { headers: auth(OWNER) }).then((x) => x.json());
  check("papers on file listed, with the COI's expiry", list.files.length === 2 && list.files.some((f) => f.kind === "coi" && f.expires_on === later));
  await email("Re: New carrier setup", "Following up: we still need your carrier packet for setup.");
  const packet = await waitFor(() => { const d = db(`select data->'draft' from escalations where carrier_id = '${cid}' and data->'draft'->>'purpose' = 'setup_packet'`); return d ? JSON.parse(d) : null; });
  check("setup packet drafted with the W-9 and COI attached (Ask me first: waits)", packet?.attachments?.length === 2 && /W-9, certificate of insurance/.test(packet.body) && pmAfter(pm0).every((m) => !(m.body.Attachments ?? []).length), packet?.body);
  check("meanwhile the broker heard the packet is coming (a short note, no papers)", pmAfter(pm0).some((m) => /got your email about our carrier packet\. We'll get back to you shortly/.test(m.body.TextBody)), pmAfter(pm0).map((m) => m.body.TextBody.slice(0, 80)).join(" | "));
  const escId = db(`select id from escalations where carrier_id = '${cid}' and data->'draft'->>'purpose' = 'setup_packet'`);
  r = await post("/api/agent/approve", { escalationId: escId, send: true });
  const sentPacket = pmAfter(pm0).at(-1)?.body;
  check("approved packet goes out with both files", r.status === 200 && sentPacket?.Attachments?.map((a) => a.Name).sort().join(",") === "Titan-COI.pdf,Titan-W9.pdf" && Buffer.from(sentPacket.Attachments.find((a) => a.Name === "Titan-W9.pdf").Content, "base64").toString() === "%PDF-1.4 W9 CONTENT");

  // ── Loads offered by email ────────────────────────────────────────────────
  pm0 = read("postmark").length;
  const offerMail = await email("Loads available this week", "Hi team, loads available: FTW to ATL reefer $2600, MEM to BNA van $900, SEA to PDX reefer $800. Kim");
  const o1 = await waitFor(() => load("TQL-5501"));
  const o2 = load("TQL-5502");
  const trucks = Object.fromEntries(db(`select id || ':' || unit_number from trucks where carrier_id = '${cid}'`).split("\n").map((x) => x.split(":")).map(([id, u]) => [u, id]));
  check("reefer load offered to the free reefer truck (102)", o1?.stage === "offered" && o1.truckId === trucks["102"], o1?.truckId);
  check("van load offered to truck 101, after its current delivery", o2?.stage === "offered" && o2.truckId === trucks["101"]);
  check("a load too far from every truck isn't offered", load("TQL-5503") === null);
  check("price: opens with room, 8% over a post that already pays, never under the floor ($2,600 → $2,825; floor $1,950)", o1?.targetRate === 2825 && o1?.listedRate === 2600, o1?.targetRate);
  check("Ask me first: nothing emailed for offers", pmAfter(pm0).length === 0);
  r = await post("/api/agent/book", { loadId: o1.id }, MARCUS);
  check("a driver can't book with a broker", r.status === 401);
  r = await post("/api/agent/book", { loadId: o1.id });
  const bookBody = await r.json();
  const bookMail = pmAfter(pm0).at(-1)?.body;
  check("owner picks it: book request emailed at $2,825, in the broker's thread", r.status === 200 && bookMail?.To === "loads@tql.test" && /Our rate is \$2,825 all in/.test(bookMail.TextBody) && bookMail.Headers?.[0]?.Value === offerMail, bookMail?.TextBody);
  check("the broker's answer comes back to the carrier's Backroute address, not the shared sender", /^abc123\+[a-z0-9]+@inbound\.postmarkapp\.com$/.test(bookMail?.ReplyTo ?? ""), bookMail?.ReplyTo);
  check("load now negotiating, ask on record", load("TQL-5501").stage === "negotiating" && load("TQL-5501").bookRequest?.status === "sent" && bookBody.loads.some((l) => l.id === o1.id && l.stage === "negotiating"));

  // ── Haggling inside the rules, like a dispatcher ───────────────────────────
  check("the book request reads like a dispatcher's: can we get it, where the truck is", /Can we get TQL-5501, Fort Worth, TX to Atlanta, GA/.test(bookMail?.TextBody ?? "") && /Our reefer is (empty in|unloading in|in) [A-Z]/.test(bookMail?.TextBody ?? ""), bookMail?.TextBody);
  check("the book request asks for detention and TONU on the rate con", /detention at \$50\/hour after 2 hours free, and TONU at \$150/.test(bookMail?.TextBody ?? ""), bookMail?.TextBody);
  settings({ autonomy: "rules" });
  pm0 = read("postmark").length;
  await email("Re: Loads available this week (TQL-5501)", "We can do $1,800 on TQL-5501. Kim");
  let counterMail = await waitFor(() => pmAfter(pm0).at(-1)?.body);
  check("first counter: comes down part of the way ($2,825 → $2,575), with a reason, sent on its own", /come down to \$2,575 all in on TQL-5501/.test(counterMail?.TextBody ?? "") && /ready and will be there on time|a mile|empty/.test(counterMail?.TextBody ?? "") && load("TQL-5501").bookRequest?.rounds === 1 && load("TQL-5501").bookRequest?.opening === 2825, counterMail?.TextBody);
  pm0 = read("postmark").length;
  await email("Re: Loads available this week (TQL-5501)", "Like I said, we can do $1,800. Kim");
  counterMail = await waitFor(() => pmAfter(pm0).at(-1)?.body);
  check("they don't move: neither does the AI (with a different reason)", /I hear you, but we're staying at \$2,575 all in/.test(counterMail?.TextBody ?? "") && load("TQL-5501").bookRequest?.rounds === 2, counterMail?.TextBody);
  pm0 = read("postmark").length;
  await email("Re: Loads available this week (TQL-5501)", "OK we can do $1,900. Kim");
  counterMail = await waitFor(() => pmAfter(pm0).at(-1)?.body);
  check("they move: the AI's last number ($2,100), never under the floor ($1,950), and it offers to book right now", /best we can do on TQL-5501.*\$2,100 all in/s.test(counterMail?.TextBody ?? "") && /If you can do \$2,100, send the rate con and we'll book it right now/.test(counterMail?.TextBody ?? "") && load("TQL-5501").bookRequest?.rounds === 3 && load("TQL-5501").bookRequest?.countered === true, counterMail?.TextBody);
  pm0 = read("postmark").length;
  await email("Re: Loads available this week (TQL-5501)", "Best I have is this: we can do $1,900. Kim");
  await sleep(1500);
  const below = db(`select data->'draft'->>'amount' || '|' || status from escalations where carrier_id = '${cid}' and data->'draft'->>'purpose' = 'accept'`);
  check("just under the floor after three counters: the owner decides, nothing sent", below === "1900|open" && pmAfter(pm0).length === 0, below);
  await email("Re: Loads available this week (TQL-5501)", "OK, $1,950 works for us. Rate con to follow.");
  const acceptMail = await waitFor(() => pmAfter(pm0).find((m) => /\$1,950 all in works for us/.test(m.body.TextBody))?.body);
  check("they meet the floor: the AI takes it, asks for detention and TONU terms", !!acceptMail && /TONU at \$150/.test(acceptMail.TextBody) && (await waitFor(() => load("TQL-5501").bookRequest?.status === "accepted")) !== null, acceptMail?.TextBody);
  const hist = load("TQL-5501").bookRequest?.history ?? [];
  check("the back-and-forth is on record", hist.map((h) => `${h.by}${h.amount}`).join(",") === "them1800,us2575,them1800,us2575,them1900,us2100,them1900,them1950,us1950", hist.map((h) => `${h.by}${h.amount}`).join(","));

  // ── The rate con confirms the booking ─────────────────────────────────────
  db(`update drivers set data = jsonb_set(data, '{prefs,smsOptOut}', 'false') where id = '${anaId}'`);
  fs.writeFileSync(`${S}/fakes/ratecon.json`, JSON.stringify({ broker: "TQL", brokerEmail: "loads@tql.test", loadNumber: "TQL-5501", totalRate: 1950, originCity: "Fort Worth", originState: "TX", destinationCity: "Atlanta", destinationState: "GA", miles: 780, equipment: "Reefer", detention: "2 hrs free, then $50/hr", mismatches: [], otherConcerns: [], summary: "Matches: $1,950 Fort Worth to Atlanta." }));
  const pdf = fs.readFileSync(`${S}/fakes/data/ratecon.pdf`).toString("base64");
  const tw0 = read("twilio").length;
  const pmRc = read("postmark").length;
  await email("Rate con TQL-5501", "Rate con attached.", { attachments: [{ Name: "TQL-5501.pdf", Content: pdf, ContentType: "application/pdf", ContentLength: 900 }] });
  const booked = await waitFor(() => (load("TQL-5501").stage === "dispatched" ? load("TQL-5501") : null));
  const thanks = await waitFor(() => read("postmark").slice(pmRc).find((m) => /Got the rate con for TQL-5501, thanks\. It matches\./.test(m.body.TextBody))?.body);
  check("...and the broker hears back: got it, it matches, which truck and driver", !!thanks && /Truck 102 with Ana is set for pickup/.test(thanks.TextBody), thanks?.TextBody);
  check("matching rate con books it onto truck 102 at $1,950", booked?.bookedRate === 1950 && db(`select data->>'currentLoadId' from trucks where id = '${trucks["102"]}'`) === o1.id, booked?.stage);
  const anaText = await waitFor(() => read("twilio").slice(tw0).find((x) => x.params.To === "+19725550163" && /TQL-5501/.test(x.params.Body)));
  check("the driver gets the new-load text", !!anaText, anaText?.params.Body);
  fs.unlinkSync(`${S}/fakes/ratecon.json`);

  // ── Within my rules: asks on its own, but not with an unverified broker ──
  pm0 = read("postmark").length;
  await email("More loads for you", "more loads: MEM to LIT van $800");
  const o3 = await waitFor(() => load("TQL-6601"));
  check("unverified broker: offer shown, no book request on its own", o3?.stage === "offered" && pmAfter(pm0).length === 0);
  const brokerId = o3.brokerId;
  settings({ brokerOverrides: { [brokerId]: "normal" } });
  await email("Extra loads", "extra loads: MEM to JAN van $950");
  const auto = await waitFor(() => pmAfter(pm0).find((x) => /TQL-7701/.test(x.body.TextBody)));
  check("owner trusts the broker: AI asks for the best one on its own ($950 → $1,050)", !!auto && /\$1,050 all in/.test(auto.body.TextBody) && load("TQL-7701").stage === "negotiating", auto?.body.TextBody);
  check("the truck's other offers are set aside", load("TQL-6601").stage === "declined" && load("TQL-5502").stage === "declined");

  // ── Check-ins ─────────────────────────────────────────────────────────────
  const inMin = (m) => new Date(Date.now() + m * 60000).toISOString();
  setLoad("CFP-88213", { deliveryAt: inMin(120) });
  setLoad("TQL-5501", { pickupAt: inMin(90), createdAt: inMin(-300) });
  db(`update drivers set data = jsonb_set(data, '{prefs,smsOptOut}', 'true') where id = '${anaId}'`);
  let t0 = read("twilio").length;
  let res = await cron();
  const marcusCheck = read("twilio").slice(t0).find((x) => x.params.To === "+12145550148" && /Load CFP-88213: delivery in Memphis, TN is/.test(x.params.Body ?? ""));
  check("before delivery: the driver gets a check-in text", !!marcusCheck, marcusCheck?.params.Body ?? JSON.stringify(res));
  const anaCall = read("twilio").slice(t0).find((x) => x.path.endsWith("/Calls.json") && x.params.To === "+19725550163");
  check("a driver who texted STOP gets a call instead", !!anaCall && anaCall.params.Url.includes("/api/channels/voice/checkin?load=") && anaCall.params.Url.includes("kind=before_pickup"), anaCall?.params.Url);
  t0 = read("twilio").length;
  await cron();
  check("each check-in happens once", read("twilio").length === t0);
  const url = new URL(anaCall.params.Url);
  let twiml = await twilio(url.pathname + url.search, { CallSid: "CA-checkin-1", From: "+14695550199", To: "+19725550163", Direction: "outbound-api" });
  check("check-in call says it's the AI and asks about the pickup", /AI dispatcher for Titan Freight LLC, checking on your load/.test(twiml) && /pickup at Fort Worth, TX/.test(twiml) && twiml.includes("<Gather"), twiml.slice(0, 400));
  twiml = await twilio("/api/channels/voice/turn", { CallSid: "CA-checkin-1", From: "+14695550199", To: "+19725550163", Direction: "outbound-api", SpeechResult: "yes I'm loaded already" });
  const after5501 = load("TQL-5501");
  check("the driver's answer on the call moves the load, with the time for detention", after5501.stage === "in_transit" && !!after5501.tripChecklist?.loadedAt, twiml.slice(0, 200));

  // Late, then silent
  setLoad("CFP-88213", { deliveryAt: inMin(-40) });
  t0 = read("twilio").length;
  await cron();
  check("delivery missed: 'are you there?' text", read("twilio").slice(t0).some((x) => x.params.To === "+12145550148" && /delivery in Memphis, TN was/.test(x.params.Body ?? "")));
  // Pretend the late text went out 50 minutes ago, with nothing from Marcus since (his earlier texts are older).
  db(`update channel_messages set created_at = created_at - interval '3 hours' where carrier_id = '${cid}' and driver_id = '${marcusId}'`);
  db(`update driver_messages set created_at = created_at - interval '3 hours' where carrier_id = '${cid}' and driver_id = '${marcusId}'`);
  db(`update agent_marks set created_at = now() - interval '50 minutes' where carrier_id = '${cid}' and kind = 'delivery_late'`);
  t0 = read("twilio").length;
  await cron();
  const silent = read("twilio").slice(t0);
  check("no answer in 45 minutes: the AI calls the driver", silent.some((x) => x.path.endsWith("/Calls.json") && x.params.To === "+12145550148"));
  check("...and tells the owner by text, in Needs you", silent.some((x) => x.params.To === "+12145550100" && /Marcus hasn't answered about load CFP-88213/.test(x.params.Body ?? "")) && escalations("Marcus Bell hasn''t answered about delivery CFP-88213%") === "1");

  // ── POD, invoice and detention ────────────────────────────────────────────
  const cfp = load("CFP-88213");
  r = await upload(MARCUS, "pod", "pod.jpg", "image/jpeg", Buffer.from("fake jpeg bytes"), { loadId: o1.id });
  check("a driver can't file a POD on another truck's load", r.status === 404);
  const pod = await upload(MARCUS, "pod", "pod-CFP-88213.jpg", "image/jpeg", Buffer.from("fake jpeg bytes"), { loadId: cfp.id });
  check("driver's POD photo stored and checked by the AI", pod.status === 200 && pod.body.status === "verified" && /Signed by the receiver/.test(pod.body.note ?? ""), JSON.stringify(pod.body));
  const short = await upload(MARCUS, "pod", "pod-short.jpg", "image/jpeg", Buffer.from("SHORT two cases"), { loadId: cfp.id });
  check("a POD with a shortage written on it is flagged", short.body.status === "check" && /2 cases short/.test(short.body.note ?? ""), JSON.stringify(short.body));
  let got = await fetch(`${BASE}/api/files/${pod.body.id}`, { headers: auth(MARCUS) });
  check("the driver can open their own POD", got.status === 200 && (await got.text()) === "fake jpeg bytes");
  got = await fetch(`${BASE}/api/files/${w9.body.id}`, { headers: auth(MARCUS) });
  check("a driver can't open the carrier's W-9", got.status === 404);
  // What the driver's app saves when they swipe delivered with the POD (see store.uploadLoadDocument).
  const now = Date.now();
  setLoad("CFP-88213", {
    stage: "delivered",
    documents: [{ id: "doc-1", type: "pod", name: "pod-CFP-88213.jpg", generatedAt: new Date().toISOString(), status: "verified", uploadedBy: "driver", fileId: pod.body.id }],
    tripChecklist: { ...cfp.tripChecklist, arrivedDeliveryAt: new Date(now - 5 * 3600000).toISOString(), unloadedAt: new Date(now - 3600000).toISOString() },
  });
  pm0 = read("postmark").length;
  res = await cron();
  const mails = pmAfter(pm0).map((x) => x.body);
  const inv = mails.find((m) => /^Invoice INV-CFP-88213/.test(m.Subject));
  check("invoice sent to the broker with the POD (Within my rules)", inv?.To === "loads@coastalfreight.test" && inv.Attachments.map((a) => a.Name).join(",") === "INV-CFP-88213.pdf,pod-CFP-88213.jpg" && /Amount due: \$1,850/.test(inv.TextBody), inv?.Subject ?? JSON.stringify(res));
  const pdfBytes = Buffer.from(inv?.Attachments?.[0]?.Content ?? "", "base64");
  fs.writeFileSync(`${S}/.out/invoice.pdf`, pdfBytes);
  let pdfOk = false;
  try {
    const text = execSync(`PYTHONPATH=${S}/.out/pylib python3 -c "import pypdf; r = pypdf.PdfReader('${S}/.out/invoice.pdf', strict=True); print(len(r.pages)); print(r.pages[0].extract_text())"`).toString();
    pdfOk = text.startsWith("1\n") && /Invoice number: INV-CFP-88213/.test(text) && /Total due \$1,850\.00/.test(text);
  } catch (e) { console.log(String(e).slice(0, 300)); }
  check("the invoice is a readable one-page PDF", pdfOk);
  check("the invoice's answers go to the billing email and the carrier's Backroute address", /^billing@titan\.test, abc123\+[a-z0-9]+@inbound\.postmarkapp\.com$/.test(inv?.ReplyTo ?? ""), inv?.ReplyTo);
  check("load shows the invoice sent", !!load("CFP-88213").invoice?.sentAt);
  const det = mails.find((m) => /^Detention/.test(m.Subject));
  check("detention claimed from the driver's times and the rate con's terms (4h on site, 3 free, $40/h)", !!det && /On site: 4h 00m, with 3 hours free, so 1h 00m billable at \$40\/hour: \$40\./.test(det.TextBody), det?.TextBody);
  pm0 = read("postmark").length;
  await cron();
  check("invoices and claims go once", pmAfter(pm0).length === 0);

  // ── Upkeep ────────────────────────────────────────────────────────────────
  const soon = new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10);
  await upload(OWNER, "coi", "Titan-COI-old.pdf", "application/pdf", Buffer.from("%PDF-1.4"), { expiresOn: soon });
  await cron();
  check("insurance certificate running out: the owner hears once", escalations(`Your insurance certificate expires on ${soon}%`) === "1");
  await cron();
  check("...only once", escalations(`Your insurance certificate expires on ${soon}%`) === "1");

  console.log(`\n${passed} passed, ${failed} failed`);
})().catch((e) => { console.error(e); process.exit(1); });
