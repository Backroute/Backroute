// Reaching drivers the way they already talk, and owners trusting what the AI does, end to end against the stand-ins:
// the first text and consent (YES, STOP, START, the app, the owner), WhatsApp (answers the same way, the template
// after 24 hours, the driver's own pick), voice messages (transcribed, answered in voice on WhatsApp, a signed link),
// driver push, dock tips passed to the next driver, the morning text (tips, weather, reefer), reefer readings,
// holiday and drive-time checks, why-lines on bookings, the weekly review, and history from old rate cons.
const path = require("path");
const S = path.join(__dirname, "..");
const ROOT = path.join(__dirname, "../..");
const crypto = require("crypto");
const fs = require("fs");
const { execSync } = require("child_process");
const BASE = "http://localhost:3210";
let passed = 0, failed = 0;
const check = (label, ok, extra = "") => { ok ? passed++ : failed++; console.log(`${ok ? "PASS" : "FAIL"} ${label}${extra ? ` (${String(extra).slice(0, 500)})` : ""}`); };
const db = (q) => execSync(`su postgres -c "/usr/lib/postgresql/16/bin/psql -h /var/lib/postgresql/backroute-test -p 55432 -U postgres -d rest -tA -c \\"${q.replace(/"/g, '\\\\\\"').replace(/\$/g, () => "\\\\\\$")}\\""`).toString().trim();
const read = (f) => (fs.existsSync(`${S}/fakes/${f}.jsonl`) ? fs.readFileSync(`${S}/fakes/${f}.jsonl`, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const cid = fs.readFileSync(`${S}/fakes/carrier.txt`, "utf8").trim();
const cron = () => fetch(`${BASE}/api/cron/dispatch`, { headers: { authorization: "Bearer cron-secret" } }).then((r) => r.json());
const token = (sub, phone) => execSync(`node ${S}/pgrst/jwt.cjs ${sub} ${phone}`).toString();
const OWNER = token("aaaaaaaa-0000-0000-0000-000000000001", "12145550100");
const SUPPORT_ID = "cccccccc-0000-0000-0000-000000000005";
const SUPPORT = token(SUPPORT_ID, "13125550100");
const api = (path, { method = "GET", body, as = OWNER, form } = {}) =>
  fetch(`${BASE}${path}`, { method, headers: { ...(as ? { authorization: `Bearer ${as}` } : {}), ...(body ? { "content-type": "application/json" } : {}) }, body: form ?? (body ? JSON.stringify(body) : undefined) }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) }));
const RUN = Date.now().toString(36);
const sign = (url, params) => crypto.createHmac("sha1", "twilio-secret").update(url + Object.keys(params).sort().map((k) => k + params[k]).join("")).digest("base64");
let n = 0;
async function inbound(from, body, extra = {}) {
  const url = `${BASE}/api/channels/sms`;
  const params = { From: from, To: from.startsWith("whatsapp:") ? "whatsapp:+14695550177" : "+14695550199", Body: body, MessageSid: `SM-nat-${RUN}-${n++}`, NumMedia: "0", ...extra };
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", "x-twilio-signature": sign(url, params) }, body: new URLSearchParams(params) });
  return r.text();
}
const settle = () => sleep(3500);
const sent = (i) => read("twilio").slice(i).filter((x) => x.params && (x.params.Body || x.params.ContentSid));
const to = (i, phone) => sent(i).filter((x) => x.params.To === phone || x.params.To === `whatsapp:${phone}`);

const NIA = "+12145550191", NIA10 = "2145550191", NIA_USER = "abababab-0000-0000-0000-00000000000a";
const LEO = "+12145550192", LEO10 = "2145550192";
// Consent records can't be deleted, so each run has its own driver ids.
const NIA_T = "nat-t1", NIA_D = `nat-d1-${RUN}`, LEO_T = "nat-t2", LEO_D = `nat-d2-${RUN}`;
const hoursFromNow = (h) => new Date(Date.now() + h * 3600_000).toISOString();

function driverRow(id, name, phone, truckId, lang = "en") {
  return { id, name, phone, email: "", truckId, carrierId: "carrier-titan", hosStatus: "on_duty", hoursRemaining: 9.5, cdl: "", rating: 5, hireDate: new Date().toISOString(), homeBase: "Dallas, TX", runType: "regional", homeTimeTarget: "Home by Friday", payType: "percentage", payRate: 0.28, prefs: { language: lang } };
}
function truckRow(id, unit, driverId, equipment) {
  return { id, unitNumber: unit, driverId, carrierId: "carrier-titan", equipmentType: equipment, status: "available", currentCity: "Dallas", currentState: "TX", homeBase: "Dallas, TX", currentLoadId: null, nextLoadId: null, mpg: 6.5, odometer: 0, lastServiceMiles: 0, serviceIntervalMiles: 25000, nextInspectionDue: hoursFromNow(24 * 300) };
}
function loadRow(id, ref, truckId, patch = {}) {
  return {
    id, referenceNumber: ref, stage: "in_transit", source: "test", brokerId: "brk-nat", lane: { origin: "Dallas", originState: "TX", destination: "Memphis", destState: "TN", miles: 452, marketRpm: 2.4 }, equipmentType: "Reefer", weight: 38000,
    pickupWindow: "Today 6:00 AM", deliveryWindow: "Tomorrow 8:00 AM", listedRate: 1900, targetRate: 1900, bookedRate: 1900, deadheadMiles: 20, fuelCost: 300, tollCost: 0, deadheadCost: 20, commission: 0, netProfit: 900, rpm: 4.2, score: 80,
    carrierId: "carrier-titan", truckId, messages: [], calls: [], documents: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), isChained: false, aiConfidence: 0.9, ticksInStage: 0, progressPct: 45,
    pickupAt: hoursFromNow(-3), deliveryAt: hoursFromNow(20), tripChecklist: { arrivedPickupAt: hoursFromNow(-3), loadedAt: hoursFromNow(-1.5) },
    appointments: { delivery: { purpose: "book", status: "set", tries: 1, at: hoursFromNow(20), confirmation: "APPT-7788" } },
    rateConReading: { fileName: "rc.pdf", readAt: new Date().toISOString(), isRateCon: true, broker: "Nat Test Brokerage", brokerMc: null, loadNumber: ref, totalRate: 1900, pickup: null, delivery: null, equipment: "Reefer", detention: null, paymentTerms: null, shipper: "Lone Star Produce", receiver: "Acme Cold DC", finesAndFees: [], mismatches: [], otherConcerns: [], summary: "", reefer: { setF: 34, minF: null, maxF: null, mode: "continuous", preCool: true } },
    ...patch,
  };
}
const put = (table, id, data, extra = {}) => {
  const cols = { drivers: ["name", "phone"], trucks: ["unit_number", "driver_id"], loads: ["truck_id", "stage"] }[table];
  const vals = { drivers: [data.name, data.phone], trucks: [data.unitNumber, data.driverId], loads: [data.truckId, data.stage] }[table];
  db(`delete from ${table} where carrier_id = '${cid}' and id = '${id}'`);
  db(`insert into ${table} (id, carrier_id, ${cols.join(", ")}, data) values ('${id}', '${cid}', ${vals.map((v) => (v === null ? "null" : `'${v}'`)).join(", ")}, '${JSON.stringify(data).replace(/'/g, "''")}'::jsonb)`);
};

(async () => {
  // ── Set up: two new drivers on their own trucks (Nia on a reefer), a clean slate for them ──
  db(`delete from text_routes where phone_last10 in ('${NIA10}', '${LEO10}')`);
  db(`delete from facility_notes where name_key = 'acmecold'`);
  db(`delete from agent_marks where carrier_id = '${cid}' and (load_id like 'brief:%' or load_id like 'review:%' or kind like 'reefer_%' or load_id = 'history_inbox')`);
  db(`delete from weekly_reviews where carrier_id = '${cid}'`);
  db(`delete from loads where carrier_id = '${cid}' and (truck_id in ('${NIA_T}', '${LEO_T}') or data->>'source' in ('Imported rate con'))`);
  db(`delete from push_subscriptions`);
  db(`delete from carrier_billing where carrier_id = '${cid}'`);
  db(`insert into carrier_billing (carrier_id, status, trucks) values ('${cid}', 'active', 5)`);
  const startTx = read("twilio").length;
  const carrierName = db(`select name from carriers where id = '${cid}'`);
  db(`update carriers set settings = settings || '{"autonomy":"rules","sandbox":false,"minRpm":2.0,"morningBriefs":true,"weeklyReview":true,"checkIns":false}'::jsonb where id = '${cid}'`);
  db(`delete from drivers where carrier_id = '${cid}' and id like 'nat-d%'`);
  put("drivers", NIA_D, driverRow(NIA_D, "Nia Reyes", NIA, NIA_T));
  put("drivers", LEO_D, driverRow(LEO_D, "Leo Garza", LEO, LEO_T, "es"));
  put("trucks", NIA_T, truckRow(NIA_T, "N-1", NIA_D, "Reefer"));
  put("trucks", LEO_T, truckRow(LEO_T, "N-2", LEO_D, "Dry Van"));
  db(`insert into auth.users values ('${NIA_USER}', '1${NIA10}') on conflict do nothing`);
  db(`delete from members where user_id = '${NIA_USER}'`);
  db(`insert into members (user_id, carrier_id, role, driver_id) values ('${NIA_USER}', '${cid}', 'driver', '${NIA_D}')`);
  db(`insert into auth.users values ('${SUPPORT_ID}', '13125550100') on conflict do nothing`);
  db(`insert into support_staff (user_id, name) values ('${SUPPORT_ID}', 'Sam') on conflict do nothing`);
  const NIA_TOKEN = token(NIA_USER, `1${NIA10}`);

  // ── The first text, and consent ──
  let i = read("twilio").length;
  await inbound(NIA, "hi, this is Nia, what's the plan");
  await settle();
  let got = to(i, NIA).map((x) => x.params.Body);
  check("a new driver's first text from dispatch says who's texting and how to stop, before anything else", /Reply YES to confirm, HELP for help, STOP to stop texts/.test(got[0] ?? "") && got.length >= 2, JSON.stringify(got));
  i = read("twilio").length;
  await inbound(NIA, "ok thanks");
  await settle();
  got = to(i, NIA).map((x) => x.params.Body);
  check("…only once", got.length >= 1 && !got.some((b) => /Reply YES to confirm/.test(b)), JSON.stringify(got));
  i = read("twilio").length;
  const yes = await inbound(NIA, "YES");
  await settle();
  const yesReply = [yes, ...to(i, NIA).map((x) => x.params.Body)].join(" | ");
  let rec = db(`select granted || ':' || via from driver_consents where carrier_id = '${cid}' and driver_id = '${NIA_D}' order by at desc limit 1`);
  check("YES to the first text is recorded as consent, by text", rec === "true:sms", rec);
  check("…and thanked, without the AI treating YES as a question", /you're all set/.test(yesReply) && !/DRIVER-REPLY/.test(yesReply), yesReply);
  await inbound(NIA, "STOP");
  await sleep(800);
  rec = db(`select granted || ':' || via from driver_consents where carrier_id = '${cid}' and driver_id = '${NIA_D}' order by at desc, id desc limit 1`);
  check("STOP is recorded too (and stops texts)", rec === "false:sms" && JSON.parse(db(`select data->'prefs' from drivers where id = '${NIA_D}' and carrier_id = '${cid}'`)).smsOptOut === true, rec);
  await inbound(NIA, "START");
  await sleep(800);
  rec = db(`select granted || ':' || via from driver_consents where carrier_id = '${cid}' and driver_id = '${NIA_D}' order by at desc, id desc limit 1`);
  check("…and START", rec === "true:sms", rec);
  let r = await api("/api/consent", { method: "POST", as: NIA_TOKEN, body: { op: "agree", granted: true, lang: "es" } });
  let mine = await api("/api/consent", { as: NIA_TOKEN });
  check("a driver agrees in the app; the record keeps the words they saw, in their language", r.status === 200 && mine.body.mine?.via === "app" && db(`select wording from driver_consents where driver_id = '${NIA_D}' and via = 'app' order by at desc limit 1`).startsWith("Acepto que"), JSON.stringify(mine.body));
  check("…with where it came from", db(`select (ip is not null and by_user is not null)::text from driver_consents where driver_id = '${NIA_D}' and via = 'app' order by at desc limit 1`) === "true");
  check("a driver can't say other drivers agreed", (await api("/api/consent", { method: "POST", as: NIA_TOKEN, body: { op: "attest", driverIds: [LEO_D] } })).status === 403);
  r = await api("/api/consent", { method: "POST", body: { op: "attest", phones: ["(214) 555-0192"] } });
  let all = await api("/api/consent");
  check("the owner says a driver agreed when hiring them (found by the phone typed in)", r.body.recorded === 1 && all.body.drivers?.[LEO_D]?.via === "owner", JSON.stringify(r.body));
  check("…and sees every driver's latest answer", all.body.drivers?.[NIA_D]?.via === "app" && all.body.drivers?.[NIA_D]?.granted === true);
  i = read("twilio").length;
  await inbound(LEO, "hola, a qué hora cargo?");
  await settle();
  check("a driver the owner vouched for gets no first-text notice", !to(i, LEO).some((x) => /Reply YES to confirm/.test(x.params.Body ?? "")), JSON.stringify(to(i, LEO).map((x) => x.params.Body)));

  // ── WhatsApp ──
  i = read("twilio").length;
  await inbound(`whatsapp:${NIA}`, "where do I pick up tomorrow?");
  await settle();
  let wa = to(i, NIA);
  check("a WhatsApp message is answered on WhatsApp, from the WhatsApp number", wa.length >= 1 && wa.every((x) => x.params.To === `whatsapp:${NIA}` && x.params.From === "whatsapp:+14695550177" && x.params.Body), JSON.stringify(wa.map((x) => x.params)));
  check("…and heard like any text (same driver thread)", db(`select count(*) from channel_messages where carrier_id = '${cid}' and counterparty = '${NIA}' and direction = 'in' and data->>'via' = 'whatsapp'`) >= "1");
  // A text from dispatch later: still WhatsApp while the 24 hours are open.
  put("loads", "nat-l1", loadRow("nat-l1", `NAT-${RUN}`, NIA_T));
  db(`update trucks set data = data || '{"currentLoadId":"nat-l1","status":"on_load"}'::jsonb where id = '${NIA_T}' and carrier_id = '${cid}'`);
  // ── Dock tips (Nia's tip, before the next driver goes) ──
  i = read("twilio").length;
  await inbound(`whatsapp:${NIA}`, "fyi at Acme you check in at the guard shack, back in from the east gate, receiving closes at 2pm weekdays");
  await settle();
  const tip = db(`select note || '|' || coalesce(hours::text, '') from facility_notes where name_key = 'acmecold' and city = 'memphis' and state = 'TN' order by created_at desc limit 1`);
  check("a driver's tip about the receiver is saved for the next driver", /guard shack/.test(tip) && /east gate/.test(tip), tip);
  check("…without names or phone numbers", !/Maria|901-555/.test(tip) && /the office/.test(tip), tip);
  check("…with the hours they said", /"closes": "14:00"/.test(tip) && /Mon/.test(tip), tip);
  const tipsBefore = db(`select count(*) from facility_notes where name_key = 'acmecold'`);
  await inbound(NIA, "the side door trick at Acme");
  await settle();
  check("a tip that reads like orders to the AI isn't saved", db(`select count(*) from facility_notes where name_key = 'acmecold'`) === tipsBefore && !db(`select coalesce(string_agg(note, '|'), '') from facility_notes where name_key = 'acmecold'`).includes("Shady"));
  check("…and the driver hears it's saved", to(i, NIA).some((x) => /Saved for the next driver going to Acme Cold DC/.test(x.params.Body ?? "")), JSON.stringify(to(i, NIA).map((x) => x.params.Body)));

  // Leo (Spanish) gets a load to the same receiver: the new-load text carries the tip, in Spanish.
  put("loads", "nat-l2", loadRow("nat-l2", `NATL-${RUN}`, LEO_T, { stage: "dispatched", equipmentType: "Dry Van", rateConReading: { ...loadRow("x", "x", "x").rateConReading, reefer: null } }));
  i = read("twilio").length;
  r = await api("/api/agent/notify-load", { method: "POST", body: { loadId: "nat-l2" } });
  const leoNew = to(i, LEO).map((x) => x.params.Body).join(" | ");
  check("the next driver going there gets the tip with the new load, in their language", r.body.sent === true && /\[Spanish\] Acme Cold DC \(delivery\): Check in at the guard shack/.test(leoNew), leoNew);
  let claudeBefore = read("claude").length;
  await inbound(LEO, "algo que deba saber del receiver?");
  await settle();
  const leoTurn = read("claude").slice(claudeBefore).find((c) => (c.body.tools ?? []).some((t) => t.name === "note_facility"));
  check("…and the AI has the tips when they ask about the dock", !!leoTurn && JSON.stringify(leoTurn.body.messages).includes("Tips from drivers who've been to the docks"), leoTurn ? "" : "no driver turn");

  // ── Reefer: the setting goes with the load, readings are asked for and checked ──
  i = read("twilio").length;
  r = await api("/api/agent/notify-load", { method: "POST", body: { loadId: "nat-l1" } });
  const niaNew = to(i, NIA).map((x) => x.params.Body).join(" | ");
  check("the reefer setting goes to the driver with the load (pre-cool, pulp temp)", /Reefer: 34°F, continuous\. Pre-cool/.test(niaNew), niaNew);
  i = read("twilio").length;
  await cron();
  await sleep(500);
  const ask = to(i, NIA).map((x) => x.params.Body).join(" | ");
  check("once loaded, the AI asks for the reefer reading and the pulp temp", /reefer reading/.test(ask) && /pulp temp/.test(ask), ask);
  i = read("twilio").length;
  await cron();
  check("…once", !to(i, NIA).some((x) => /reefer reading now/.test(x.params.Body ?? "")));

  // ── Voice messages ──
  const media = (text) => `http://localhost:3006/2010-04-01/Accounts/ACtest/Messages/MM${RUN}/Media/voice-${encodeURIComponent(text)}`;
  i = read("twilio").length;
  let outside = read("outside").length;
  let esc = Number(db(`select count(*) from escalations where carrier_id = '${cid}'`));
  await inbound(`whatsapp:${NIA}`, "", { NumMedia: "1", MediaUrl0: media("reefer is at 41"), MediaContentType0: "audio/ogg" });
  await sleep(5000);
  const dg = read("outside").slice(outside).find((x) => x.service === "deepgram");
  check("a voice message is transcribed (in the driver's language, with trucking words)", !!dg && /language=en-US/.test(dg.query) && /keyterm=reefer/.test(dg.query) && dg.auth === "Token dg-key" && dg.type === "audio/ogg", JSON.stringify(dg));
  const log = JSON.parse(db(`select coalesce(data->'reeferLog', '[]'::jsonb) from loads where id = 'nat-l1' and carrier_id = '${cid}'`));
  check("…and acted on like a text: the reefer reading is recorded", log.some((x) => x.tempF === 41), JSON.stringify(log));
  check("…a reading out of range reaches the owner", Number(db(`select count(*) from escalations where carrier_id = '${cid}'`)) > esc && db(`select count(*) from escalations where carrier_id = '${cid}' and data->>'reason' like 'Reefer on NAT-%reads 41%'`) !== "0");
  check("the voice message is kept with what it said", db(`select note from carrier_files where carrier_id = '${cid}' and kind = 'voice_note' order by created_at desc limit 1`) === "reefer is at 41");
  check("the driver's thread shows what they said", db(`select count(*) from driver_messages where carrier_id = '${cid}' and data->>'driverId' = '${NIA_D}' and data->>'content' like '%reefer is at 41%'`) !== "0");
  const el = read("outside").slice(outside).find((x) => x.service === "elevenlabs");
  const spoken = to(i, NIA).find((x) => x.params.MediaUrl);
  check("on WhatsApp the answer comes back spoken too (and as text)", !!el && el.key === "el-key" && !!spoken && !!spoken.params.Body, JSON.stringify({ el, spoken: spoken?.params }));
  const link = spoken?.params.MediaUrl ?? "";
  r = await fetch(link);
  const audio = Buffer.from(await r.arrayBuffer()).toString();
  check("…from a signed link WhatsApp can fetch", r.status === 200 && r.headers.get("content-type") === "audio/mpeg" && audio.startsWith("ID3-FAKE-MP3"), `${r.status} ${link}`);
  check("…that doesn't open with a changed signature", (await fetch(link.replace(/s=[0-9a-f]{6}/, "s=000000"))).status === 404);
  const serviceKey = fs.readFileSync(`${S}/fakes/env.sh`, "utf8").match(/SUPABASE_SERVICE_ROLE_KEY=(\S+)/)[1];
  const mkey = crypto.createHmac("sha256", serviceKey).update("backroute-media-links").digest();
  const noteId = db(`select id from carrier_files where carrier_id = '${cid}' and kind = 'voice_note' limit 1`);
  const exp = Math.floor(Date.now() / 1000) + 600;
  check("…and a valid link to anything but a spoken answer opens nothing", (await fetch(`${BASE}/api/media/${noteId}?e=${exp}&s=${crypto.createHmac("sha256", mkey).update(`${noteId}.${exp}`).digest("hex")}`)).status === 404);
  i = read("twilio").length;
  await inbound(`whatsapp:${NIA}`, "", { NumMedia: "1", MediaUrl0: media("silent"), MediaContentType0: "audio/ogg" });
  await settle();
  check("a voice message that can't be made out gets a plain ask to type or call", to(i, NIA).some((x) => /couldn't make out your voice message/.test(x.params.Body ?? "")));
  // A photo of the reefer display with the reading.
  i = read("twilio").length;
  await inbound(NIA, "reefer 35", { NumMedia: "1", MediaUrl0: `http://localhost:3006/2010-04-01/Accounts/ACtest/Messages/MM${RUN}p/Media/ME1`, MediaContentType0: "image/jpeg" });
  await settle();
  check("a photo of the reefer display is kept and its reading recorded", db(`select count(*) from carrier_files where carrier_id = '${cid}' and kind = 'reefer_photo' and load_id = 'nat-l1'`) !== "0" && to(i, NIA).some((x) => /recorded 35°F.*in range/.test(x.params.Body ?? "")), JSON.stringify(to(i, NIA).map((x) => x.params.Body)));

  // WhatsApp after 24 hours of quiet: the approved template; the driver's own pick wins.
  db(`update text_routes set whatsapp_at = now() - interval '26 hours', sms_at = now() - interval '30 hours' where phone_last10 = '${NIA10}'`);
  i = read("twilio").length;
  await api("/api/agent/notify-load", { method: "POST", body: { loadId: "nat-l1" } });
  const tpl = to(i, NIA)[0]?.params ?? {};
  check("after 24 hours WhatsApp gets the approved template, the message as its variable", tpl.ContentSid === "HXtemplate123" && tpl.To === `whatsapp:${NIA}` && /NAT-/.test(JSON.parse(tpl.ContentVariables ?? "{}")["1"] ?? "") && !/\n/.test(tpl.ContentVariables ?? ""), JSON.stringify(tpl));
  db(`update drivers set data = jsonb_set(data, '{prefs,textsBy}', '"sms"') where id = '${NIA_D}' and carrier_id = '${cid}'`);
  db(`update text_routes set whatsapp_at = now() where phone_last10 = '${NIA10}'`);
  i = read("twilio").length;
  await api("/api/agent/notify-load", { method: "POST", body: { loadId: "nat-l1" } });
  check("a driver who picked SMS in the app gets SMS, even after writing on WhatsApp", to(i, NIA)[0]?.params.To === NIA, JSON.stringify(to(i, NIA)[0]?.params));

  // ── Driver push ──
  const keys = { p256dh: "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM", auth: "tBHItJI5svbpez7KI4CCXg" };
  let pushLog = read("push").length;
  r = await api("/api/push", { method: "POST", as: NIA_TOKEN, body: { op: "subscribe", subscription: { endpoint: "https://localhost:3022/push/nia-phone", keys } } });
  const t = await api("/api/push", { method: "POST", as: NIA_TOKEN, body: { op: "test", lang: "es" } });
  check("a driver turns on notifications in the driver app and gets a test", r.status === 200 && t.body.sent === 1 && read("push").slice(pushLog).some((p) => p.path === "/push/nia-phone"), JSON.stringify({ r: r.body, t: t.body }));
  await api("/api/push", { method: "POST", body: { op: "subscribe", subscription: { endpoint: "https://localhost:3022/push/owner-desk", keys } } });
  pushLog = read("push").length;
  await inbound(NIA, "how long is the drive to memphis");
  await settle();
  check("a message from dispatch lights up the driver's phone", read("push").slice(pushLog).some((p) => p.path === "/push/nia-phone"), JSON.stringify(read("push").slice(pushLog).map((p) => p.path)));
  pushLog = read("push").length;
  await api("/api/push", { method: "POST", body: { op: "test" } });
  check("…the office's alerts don't go to the driver's phone", read("push").slice(pushLog).every((p) => p.path !== "/push/nia-phone") && read("push").slice(pushLog).some((p) => p.path === "/push/owner-desk"));
  // A driver who wants notifications instead of texts (and whose phone takes them) gets no SMS.
  db(`update drivers set data = jsonb_set(data, '{prefs,textsToo}', 'false') where id = '${NIA_D}' and carrier_id = '${cid}'`);
  i = read("twilio").length;
  pushLog = read("push").length;
  await inbound(NIA, "how long is the drive to memphis");
  await settle();
  check("a driver who turned texts off gets dispatch's answer as a notification, not a text", to(i, NIA).length === 0 && read("push").slice(pushLog).some((p) => p.path === "/push/nia-phone"), JSON.stringify(to(i, NIA).map((x) => x.params.Body)));
  db(`update drivers set data = data #- '{prefs,textsToo}' where id = '${NIA_D}' and carrier_id = '${cid}'`);
  db(`delete from push_subscriptions where endpoint = 'https://localhost:3022/push/nia-phone'`);
  i = read("twilio").length;
  await inbound(NIA, "how long is the drive to memphis");
  await settle();
  check("…and texts again once it's back on (or the phone stops taking them)", to(i, NIA).length > 0);

  // ── Morning text ──
  db(`update drivers set data = jsonb_set(data, '{prefs,textsBy}', 'null') where id = '${NIA_D}' and carrier_id = '${cid}'`);
  db(`delete from agent_marks where carrier_id = '${cid}' and load_id like 'brief:%'`);
  i = read("twilio").length;
  outside = read("outside").length;
  await cron();
  await sleep(500);
  const brief = to(i, NIA).map((x) => x.params.Body).find((b) => /^BRIEF:/.test(b)) ?? "";
  check("the morning text goes to a driver with a stop today", !!brief, JSON.stringify(to(i, NIA).map((x) => x.params.Body)));
  check("…with the stop, its time and the appointment number", /Delivery NAT-/.test(brief) && /Acme Cold DC, Memphis, TN/.test(brief) && /APPT-7788/.test(brief), brief);
  check("…the dock tip, the reefer setting and the weather warning where they're going", /guard shack/.test(brief) && /Reefer: 34°F/.test(brief) && /Winter Storm Warning near Memphis, TN/.test(brief) && !/Marine/.test(brief), brief);
  // (Warnings are kept 15 minutes, so the call may have been made earlier in the run.)
  check("…weather from the National Weather Service, with a contact", read("outside").some((x) => x.service === "weather" && /Backroute dispatch \(/.test(x.ua)));
  check("…and Leo (in Spanish) gets theirs, written in Spanish", to(i, LEO).some((x) => /^BRIEF:/.test(x.params.Body ?? "")) && read("claude").some((c) => /writing a driver's morning text in Spanish/.test(JSON.stringify(c.body.system))));
  i = read("twilio").length;
  await cron();
  check("…once a day", !to(i, NIA).some((x) => /^BRIEF:/.test(x.params.Body ?? "")));
  db(`delete from agent_marks where carrier_id = '${cid}' and load_id like 'brief:%'`);
  db(`update drivers set data = jsonb_set(data, '{prefs,morningBrief}', 'false') where id = '${NIA_D}' and carrier_id = '${cid}'`);
  i = read("twilio").length;
  await cron();
  check("a driver who turned it off doesn't get it", !to(i, NIA).some((x) => /^BRIEF:/.test(x.params.Body ?? "")));

  // ── Weekly review ──
  const reviews = db(`select count(*) from weekly_reviews where carrier_id = '${cid}'`);
  check("the owner's weekly review is kept", reviews === "1", reviews);
  const rv = await api("/api/review");
  check("…Home shows it: the numbers, best and worst broker, and one thing to change", typeof rv.body.review?.gross === "number" && typeof rv.body.review?.emptyPct === "number" && rv.body.review.change.length > 10, JSON.stringify(rv.body.review));
  check("…drivers can't read it", (await api("/api/review", { as: NIA_TOKEN })).status === 401);
  const reviewText = read("twilio").slice(startTx).filter((x) => x.params.To === "+12145550100" && (x.params.Body ?? "").startsWith(`${carrierName}, your week:`));
  check("…and it's texted to the owner, once", reviewText.length === 1 && /One thing: /.test(reviewText[0].params.Body), JSON.stringify(reviewText.map((x) => x.params.Body)));

  // ── Holiday and drive-time checks ──
  const email = async (subject, text, from = "rosa@acmefreight.test") => {
    const r2 = await fetch(`${BASE}/api/channels/email?token=email-hook-secret`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ MessageID: `nat-${RUN}-${n++}`, From: from, FromName: "Rosa", FromFull: { Email: from, Name: "Rosa" }, To: `abc123+${db(`select inbound_key from carriers where id = '${cid}'`)}@inbound.postmarkapp.com`, MailboxHash: db(`select inbound_key from carriers where id = '${cid}'`), Subject: subject, TextBody: text, Headers: [], Attachments: [] }) });
    return r2.json();
  };
  await email(`Holiday loads ${RUN}`, "Hi, holiday loads for you. Rosa, Acme Freight MC 555001, (312) 555-0142");
  await sleep(6000);
  const hol = JSON.parse(db(`select coalesce(json_agg(json_build_object('stage', stage, 'w', data->'scheduleWarnings')), '[]') from loads where carrier_id = '${cid}' and data->>'referenceNumber' = 'HOL-1126'`) || "[]");
  check("a delivery on Thanksgiving is flagged: most docks are closed", hol.length >= 1 && hol.some((l) => (l.w ?? []).some((w) => w.hard && /Thanksgiving/.test(w.text))), JSON.stringify(hol));
  check("…and the AI doesn't ask for it on its own", hol.every((l) => l.stage !== "negotiating"), JSON.stringify(hol.map((l) => l.stage)));
  await email(`Tight loads ${RUN}`, "Tight loads, need a truck. Rosa, Acme Freight MC 555001, (312) 555-0142");
  await sleep(6000);
  const tight = JSON.parse(db(`select coalesce(json_agg(json_build_object('stage', stage, 'w', data->'scheduleWarnings')), '[]') from loads where carrier_id = '${cid}' and data->>'referenceNumber' = 'TIGHT-1'`) || "[]");
  check("780 miles in 12 hours is flagged: one driver can't legally drive it", tight.some((l) => (l.w ?? []).some((w) => w.hard && /one driver's required breaks/.test(w.text))), JSON.stringify(tight));
  check("…not asked for either", tight.length >= 1 && tight.every((l) => l.stage !== "negotiating"));

  // ── Why-lines on what the AI books ──
  db(`update trucks set data = data || '{"currentLoadId":null,"status":"available"}'::jsonb where id = '${NIA_T}' and carrier_id = '${cid}'`);
  db(`update loads set stage = 'delivered' where id = 'nat-l1' and carrier_id = '${cid}'`);
  db(`update loads set data = data || '{"stage":"delivered"}'::jsonb where id = 'nat-l1' and carrier_id = '${cid}'`);
  await email(`Loads available ${RUN}`, "Hi, loads available for your reefers. Kim, Prairie Freight, our MC number is 777003", `kim@prairie-nat-${RUN}.test`);
  await sleep(7000);
  const why = JSON.parse(db(`select coalesce(json_agg(json_build_object('ref', data->>'referenceNumber', 'stage', stage, 'truck', truck_id, 'why', data->'why')), '[]') from loads where carrier_id = '${cid}' and data->>'brokerContactEmail' = 'kim@prairie-nat-${RUN}.test'`) || "[]");
  const asked = why.find((l) => l.stage === "negotiating");
  check("the AI asked to book one of the new broker's loads for a free truck", !!asked, JSON.stringify(why.map((l) => [l.ref, l.stage])));
  const lines = asked?.why?.lines ?? [];
  check("…and says why: the rate per mile against the owner's lowest", lines.some((l) => /\/mi; above your \$2\.00\/mi lowest/.test(l)), JSON.stringify(lines));
  check("…the empty miles, the driver's home time and the broker", lines.some((l) => /empty miles to the pickup for truck /.test(l)) && lines.some((l) => /home/i.test(l)) && lines.some((l) => /prairie/i.test(l)), JSON.stringify(lines));
  await email(`Re: Loads available ${RUN} ${asked?.ref}`, `We can do $2,100 on ${asked?.ref}. Kim`, `kim@prairie-nat-${RUN}.test`);
  await sleep(6000);
  const after = JSON.parse(db(`select data->'why'->'lines' from loads where carrier_id = '${cid}' and data->>'brokerContactEmail' = 'kim@prairie-nat-${RUN}.test' and data->>'referenceNumber' = '${asked?.ref}' limit 1`) || "[]");
  check("…and what it did with the broker's counter, and why", after.some((l) => /^Broker offered \$2,100:/.test(l)), JSON.stringify(after));

  // ── The owner tells the AI what to do on a negotiation, and it's done for real ──
  const askedId = db(`select id from loads where carrier_id = '${cid}' and data->>'referenceNumber' = '${asked?.ref}' and data->>'brokerContactEmail' = 'kim@prairie-nat-${RUN}.test' limit 1`);
  // (Still talking price with the broker, whatever the AI did with their $2,100.)
  db(`update loads set stage = 'negotiating', data = jsonb_set(data, '{stage}', '"negotiating"') where carrier_id = '${cid}' and id = '${askedId}'`);
  let pmBefore = read("postmark").length;
  r = await api("/api/agent/instruct", { method: "POST", body: { loadId: askedId, text: "push for $2,250 on this one" } });
  const counterMail = read("postmark").slice(pmBefore).map((m) => m.body).find((m) => m?.To === `kim@prairie-nat-${RUN}.test`);
  check("the owner's 'push for $2,250' goes to the broker as a counter", r.status === 200 && r.body.done === "counter" && r.body.amount === 2250 && /2,250/.test(counterMail?.TextBody ?? ""), JSON.stringify({ r: r.body, mail: counterMail?.TextBody }));
  check("…and the load says why", (r.body.load?.why?.lines ?? []).some((l) => /^You countered at \$2,250/.test(l)), JSON.stringify(r.body.load?.why));
  pmBefore = read("postmark").length;
  r = await api("/api/agent/instruct", { method: "POST", body: { loadId: askedId, text: "ask if they can load early tomorrow" } });
  check("anything else the owner types is emailed to the broker", r.status === 200 && r.body.done === "relay" && read("postmark").slice(pmBefore).some((m) => m.body?.To === `kim@prairie-nat-${RUN}.test`), JSON.stringify(r.body));
  check("drivers can't instruct the AI on a negotiation", (await api("/api/agent/instruct", { method: "POST", as: NIA_TOKEN, body: { loadId: askedId, text: "walk away" } })).status === 401);
  r = await api("/api/agent/instruct", { method: "POST", body: { loadId: askedId, text: "walk away" } });
  check("'walk away' sends the polite pass and drops the load", r.status === 200 && r.body.done === "pass" && db(`select stage from loads where carrier_id = '${cid}' and id = '${askedId}'`) === "declined", JSON.stringify(r.body));

  // ── History from old rate cons ──
  const pdf = (name) => new File([Buffer.from(`%PDF-1.4 old rate con ${RUN} ${name}`)], name, { type: "application/pdf" });
  const past = new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10);
  const HMC = String(100000 + Math.floor(Math.random() * 899999));
  fs.writeFileSync(`${S}/fakes/ratecon.json`, JSON.stringify({ loadNumber: `HRC-${RUN}-1`, broker: `Lone Star Brokerage ${RUN}`, brokerMc: `MC ${HMC}`, brokerEmail: `ops@lonestar-${RUN}.test`, pickupLocal: `${past}T08:00`, deliveryLocal: `${past}T18:00`, totalRate: 1650, paymentTerms: "Net 21", shipper: "Tyler Pipe", receiver: "Acme Cold DC" }));
  let form = new FormData();
  form.append("files", pdf("rc1.pdf"));
  form.append("files", pdf("rc1-copy.pdf"));
  form.append("files", new File([Buffer.from(`%PDF-1.4 old rate con ${RUN} rc1.pdf`)], "rc1-again.pdf", { type: "application/pdf" }));
  const claudeReads = read("claude").length;
  r = await api("/api/import/ratecons", { method: "POST", form });
  const firstBatch = r.body.batch;
  check("old rate cons uploaded become history: one load, one new broker", r.body.loads === 1 && r.body.brokers === 1 && r.body.skipped?.some((s) => /already in Backroute/.test(s.why)), JSON.stringify(r.body));
  check("…the same file twice is read once", r.body.skipped?.some((s) => s.file === "rc1-again.pdf" && s.why === "already imported") && read("claude").length - claudeReads === 2, JSON.stringify(r.body.skipped));
  const hist = JSON.parse(db(`select row_to_json(x) from (select stage, data->>'imported' as imported, data->'rateConReading'->>'receiver' as receiver, data->>'bookedRate' as rate from loads where carrier_id = '${cid}' and data->>'referenceNumber' = 'HRC-${RUN}-1') x`) || "{}");
  check("…a finished load from the history, with the docks on it", hist.stage === "delivered" && hist.imported === "true" && hist.receiver === "Acme Cold DC" && hist.rate === "1650", JSON.stringify(hist));
  const broker = JSON.parse(db(`select data from records where carrier_id = '${cid}' and kind = 'broker' and data->>'email' = 'ops@lonestar-${RUN}.test'`) || "{}");
  check("…and the broker, with their MC and payment terms", broker.mc === HMC && broker.avgDaysToPay === 21, JSON.stringify(broker));
  let batches = await api("/api/import/batches");
  check("the import is listed, to undo", batches.body.batches?.some((b) => b.id === firstBatch && b.loads === 1 && b.brokerIds.length === 1), JSON.stringify(batches.body));
  check("drivers can't see or undo imports", (await api("/api/import/batches", { as: NIA_TOKEN })).status === 401 && (await api(`/api/import/batches?batch=${firstBatch}`, { method: "DELETE", as: NIA_TOKEN })).status === 401);
  r = await api(`/api/import/batches?batch=${firstBatch}`, { method: "DELETE" });
  check("undoing it takes out its load and the broker it added", r.status === 200 && r.body.loads === 1 && r.body.brokers === 1 && db(`select count(*) from loads where carrier_id = '${cid}' and data->>'referenceNumber' = 'HRC-${RUN}-1'`) === "0" && db(`select count(*) from records where carrier_id = '${cid}' and kind = 'broker' and data->>'email' = 'ops@lonestar-${RUN}.test'`) === "0", JSON.stringify(r.body));
  check("…and it's gone from the list", !(await api("/api/import/batches")).body.batches?.some((b) => b.id === firstBatch));
  fs.writeFileSync(`${S}/fakes/ratecon.json`, JSON.stringify({ isRateCon: false }));
  form = new FormData();
  form.append("files", pdf("invoice.pdf"));
  r = await api("/api/import/ratecons", { method: "POST", form });
  check("a file that isn't a rate con is skipped, and says so", r.body.loads === 0 && r.body.skipped?.[0]?.why === "not a rate confirmation", JSON.stringify(r.body));
  check("drivers can't add history", (await api("/api/import/ratecons", { method: "POST", as: NIA_TOKEN, form })).status === 401);
  r = await api("/api/import/ratecons?inbox=open", { method: "POST" });
  const key = db(`select inbound_key from carriers where id = '${cid}'`);
  const hhash = r.body.address?.match(/^abc123\+(.+)@inbound\.postmarkapp\.com$/)?.[1] ?? "";
  check("the history address opens for a week, with a random part brokers can't guess", new RegExp(`^${key}-h[a-z0-9]{10}$`).test(hhash) && Date.parse(r.body.until) > Date.now() + 6 * 86400_000, JSON.stringify(r.body));
  fs.writeFileSync(`${S}/fakes/ratecon.json`, JSON.stringify({ loadNumber: `HRC-${RUN}-2`, broker: "Midsouth Logistics", brokerMc: "MC 777002", brokerEmail: `loads@midsouth-${RUN}.test`, pickupLocal: `${past}T08:00`, totalRate: 1200 }));
  const eml = ["From: Kim <kim@midsouth.test>", "Subject: Rate con", 'Content-Type: multipart/mixed; boundary="XYZ"', "", "--XYZ", "Content-Type: text/plain", "", "Rate con attached", "--XYZ", 'Content-Type: application/pdf; name="inner.pdf"', "Content-Transfer-Encoding: base64", 'Content-Disposition: attachment; filename="inner.pdf"', "", Buffer.from("%PDF-1.4 inner rate con").toString("base64"), "--XYZ--"].join("\r\n");
  const postHistory = (hash, sub) =>
    fetch(`${BASE}/api/channels/email?token=email-hook-secret`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ MessageID: `hist-${RUN}-${sub}`, From: "owner@titan.test", FromFull: { Email: "owner@titan.test" }, To: `abc123+${hash}@inbound.postmarkapp.com`, MailboxHash: hash, Subject: "Fwd: rate cons", TextBody: "", Headers: [], Attachments: [{ Name: "forwarded.eml", ContentType: "message/rfc822", ContentLength: eml.length, Content: Buffer.from(eml).toString("base64") }] }) }).then((x) => x.json());
  let pm = read("postmark").length;
  r = await postHistory(`${key}-hzzzzzzzzzz`, 0);
  await sleep(2500);
  check("the history address with the wrong random part takes nothing", db(`select count(*) from loads where carrier_id = '${cid}' and data->>'referenceNumber' = 'HRC-${RUN}-2'`) === "0");
  r = await postHistory(hhash, 1);
  await sleep(4000);
  check("rate cons forwarded to the history address (even inside a forwarded email) go into the history", r.history === true && db(`select count(*) from loads where carrier_id = '${cid}' and data->>'referenceNumber' = 'HRC-${RUN}-2' and data->>'imported' = 'true'`) === "1");
  check("…and nothing is emailed back to anyone", read("postmark").length === pm);
  db(`delete from agent_marks where carrier_id = '${cid}' and load_id = 'history_inbox'`);
  fs.writeFileSync(`${S}/fakes/ratecon.json`, JSON.stringify({ loadNumber: `HRC-${RUN}-3`, broker: "Midsouth Logistics", totalRate: 900, pickupLocal: `${past}T08:00` }));
  await postHistory(hhash, 2);
  await sleep(3000);
  check("once the week is up (or it was never opened), the history address takes nothing", db(`select count(*) from loads where carrier_id = '${cid}' and data->>'referenceNumber' = 'HRC-${RUN}-3'`) === "0");
  fs.rmSync(`${S}/fakes/ratecon.json`, { force: true });

  // ── Health shows the new parts ──
  const health = await api("/api/support/health", { as: SUPPORT });
  const h = (k) => health.body.checks?.find((c) => c.key === k);
  check("support sees WhatsApp and voice messages in the System tab", h("whatsapp")?.level === "ok" && /template/.test(h("whatsapp")?.detail) && h("voice_notes")?.level === "ok" && /spoken/.test(h("voice_notes")?.detail), JSON.stringify([h("whatsapp"), h("voice_notes")]));

  // Put the shared test fleet back the way the other suites expect it.
  db(`delete from loads where carrier_id = '${cid}' and truck_id in ('${NIA_T}', '${LEO_T}')`);
  db(`delete from trucks where carrier_id = '${cid}' and id in ('${NIA_T}', '${LEO_T}')`);
  db(`delete from drivers where carrier_id = '${cid}' and id like 'nat-d%'`);
  db(`delete from members where user_id = '${NIA_USER}'`);
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
