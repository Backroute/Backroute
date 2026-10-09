// What a paid pilot needs around the AI, end to end against the stand-ins: security headers, health checks and alerts,
// rate limits, several carriers on one login, Stripe billing (checkout, signed webhooks, a failed card holding new
// bookings, the truck count following the fleet), phone push alerts, and the pilot carrier script.
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
const read = (f) => (fs.existsSync(`${S}/fakes/${f}.jsonl`) ? fs.readFileSync(`${S}/fakes/${f}.jsonl`, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const cid = fs.readFileSync(`${S}/fakes/carrier.txt`, "utf8").trim();
const cron = (which = "dispatch") => fetch(`${BASE}/api/cron/${which}`, { headers: { authorization: "Bearer cron-secret" } }).then((r) => r.json());
const token = (sub, phone) => execSync(`node ${S}/pgrst/jwt.cjs ${sub} ${phone}`).toString();
const OWNER_ID = "aaaaaaaa-0000-0000-0000-000000000001";
const OWNER = token(OWNER_ID, "12145550100");
const SUPPORT_ID = "cccccccc-0000-0000-0000-000000000005";
const SUPPORT = token(SUPPORT_ID, "13125550100");
const api = (path, { method = "GET", body, as = OWNER, headers = {} } = {}) =>
  fetch(`${BASE}${path}`, { method, headers: { ...(as ? { authorization: `Bearer ${as}` } : {}), ...(body ? { "content-type": "application/json" } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined }).then(async (r) => ({ status: r.status, headers: r.headers, body: await r.json().catch(() => ({})) }));
const texts = (i, to) => read("twilio").slice(i).filter((x) => x.params.To === to && x.params.Body).map((x) => x.params.Body);
const stripeSig = (raw, secret = "whsec_backroute_test") => {
  const t = Math.floor(Date.now() / 1000);
  return `t=${t},v1=${crypto.createHmac("sha256", secret).update(`${t}.${raw}`).digest("hex")}`;
};
const webhook = async (event, sig) => {
  const raw = JSON.stringify(event);
  const r = await fetch(`${BASE}/api/billing/webhook`, { method: "POST", headers: { "content-type": "application/json", "stripe-signature": sig ?? stripeSig(raw) }, body: raw });
  return { status: r.status, body: await r.json().catch(() => ({})) };
};
const RUN = Date.now().toString(36);
const sign = (url, params) => crypto.createHmac("sha1", "twilio-secret").update(url + Object.keys(params).sort().map((k) => k + params[k]).join("")).digest("base64");
async function twilio(path, params) {
  const url = BASE + path;
  return (await fetch(url, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", "x-twilio-signature": sign(url, params) }, body: new URLSearchParams(params) })).text();
}

(async () => {
  db(`insert into auth.users values ('${SUPPORT_ID}', '13125550100') on conflict do nothing`);
  db(`insert into support_staff (user_id, name) values ('${SUPPORT_ID}', 'Sam') on conflict do nothing`);
  db(`delete from carrier_billing where carrier_id = '${cid}'`);
  db(`delete from push_subscriptions`);
  db(`delete from service_heartbeats where name = 'alerts'`);
  db(`delete from rate_limits`);
  db(`update carriers set settings = settings || '{"autonomy":"rules","sandbox":false}'::jsonb where id = '${cid}'`);

  // ── Security headers ──
  let r = await fetch(`${BASE}/carrier`);
  const h = r.headers;
  check("pages can't be framed (clickjacking)", h.get("x-frame-options") === "DENY" && /frame-ancestors 'none'/.test(h.get("content-security-policy") ?? ""), `${h.get("x-frame-options")} ${h.get("content-security-policy")}`);
  check("HTTPS only, no MIME sniffing, limited referrer", /max-age=\d+/.test(h.get("strict-transport-security") ?? "") && h.get("x-content-type-options") === "nosniff" && !!h.get("referrer-policy"));
  r = await fetch(`${BASE}/sw.js`);
  check("the push service worker is served fresh", r.ok && /no-cache/.test(r.headers.get("cache-control") ?? "") && /showNotification/.test(await r.text()));
  r = await fetch(`${BASE}/manifest.webmanifest`);
  check("the app can be added to a phone's home screen", r.ok && (await r.json()).name === "Backroute");

  // ── Health ──
  r = await fetch(`${BASE}/api/health`);
  check("uptime monitors get a plain 200 when the app and database answer", r.status === 200 && (await r.json()).ok === true);
  check("the full health report is for support only", (await api("/api/support/health")).status === 403);
  await cron();
  let report = await api("/api/support/health", { as: SUPPORT });
  const lvl = (k) => report.body.checks?.find((c) => c.key === k);
  check("support sees each part: database, AI, texts, email, rounds, outbox, voice, websites, spending", ["database", "ai", "texts", "email", "rounds", "outbox", "voice", "portal", "spend"].every((k) => lvl(k)), JSON.stringify(report.body.checks?.map((c) => `${c.key}:${c.level}`)));
  check("…the database and the dispatcher's rounds are working", lvl("database")?.level === "ok" && lvl("rounds")?.level === "ok", JSON.stringify([lvl("database"), lvl("rounds")]));
  check("…the voice server shows as not set up (not as down)", lvl("voice")?.level === "off");
  // A message the text provider gave up on: the outbox is down, and whoever's on call hears once.
  db(`delete from outbound where carrier_id = '${cid}' and recipient = '+15550009999'`);
  db(`insert into outbound (carrier_id, channel, recipient, body, status) values ('${cid}', 'sms', '+15550009999', 'test', 'gave_up')`);
  let tx = read("twilio").length;
  let pm = read("postmark").length;
  await cron();
  check("a system problem texts whoever is on call", texts(tx, "+13125550199").some((b) => /system alert: Messages waiting to send is down/i.test(b)), JSON.stringify(texts(tx, "+13125550199")));
  check("…and emails SUPPORT_EMAIL", read("postmark").slice(pm).some((x) => x.body.To === "alerts@backroute.test" && /Messages waiting to send/.test(x.body.TextBody)));
  check("…and not support's hand-off phones", !texts(tx, "+13125550100").some((b) => /system alert/i.test(b)));
  tx = read("twilio").length;
  await cron();
  check("the same problem isn't texted again within the hour", !texts(tx, "+13125550199").some((b) => /Messages waiting to send/.test(b)));
  db(`delete from outbound where carrier_id = '${cid}' and recipient = '+15550009999'`);
  tx = read("twilio").length;
  await cron();
  check("when it's fixed, they hear it's working again", texts(tx, "+13125550199").some((b) => /Messages waiting to send is working again/.test(b)), JSON.stringify(texts(tx, "+13125550199")));

  // ── Rate limits ──
  let last = 0;
  for (let i = 0; i < 31; i++) last = (await fetch(`${BASE}/api/fmcsa/123456`, { headers: { "x-forwarded-for": "203.0.113.9" } })).status;
  check("the public FMCSA lookup is limited per address (31st in 10 minutes refused)", last === 429, last);
  r = await fetch(`${BASE}/api/fmcsa/123456`, { headers: { "x-forwarded-for": "203.0.113.10" } });
  check("…another address isn't affected", r.status !== 429, r.status);

  // ── Several carriers on one login ──
  const trucksHere = Number(db(`select count(*) from trucks where carrier_id = '${cid}'`));
  db(`insert into carriers (id, name, owner_phone) values ('pilot-two', 'Second Company LLC', '12145550100') on conflict (id) do nothing`);
  db(`insert into members (user_id, carrier_id, role) values ('${OWNER_ID}', 'pilot-two', 'owner') on conflict do nothing`);
  const one = await api("/api/billing");
  const two = await api("/api/billing", { headers: { "x-carrier-id": "pilot-two" } });
  const nope = await api("/api/billing", { headers: { "x-carrier-id": "not-mine" } });
  check("the server works in the carrier the app says (for someone in two)", one.body.trucks === Math.max(1, trucksHere) && two.body.trucks === 1, `${one.body.trucks} / ${two.body.trucks}`);
  check("…and a carrier they don't belong to falls back to their own", nope.body.trucks === one.body.trucks);
  // A driver who drives for both: a text goes to the carrier with a load on their truck.
  const DUAL = "+12145550166";
  db(`delete from drivers where phone = '${DUAL}'`);
  db(`delete from trucks where id in ('dual-t1', 'dual-t2')`);
  db(`insert into drivers (id, carrier_id, name, phone, data) values ('dual-d1', '${cid}', 'Dual Driver', '${DUAL}', '{"id":"dual-d1","name":"Dual Driver","phone":"${DUAL}","truckId":"dual-t1","prefs":{}}'), ('dual-d2', 'pilot-two', 'Dual Driver', '${DUAL}', '{"id":"dual-d2","name":"Dual Driver","phone":"${DUAL}","truckId":"dual-t2","prefs":{}}')`);
  db(`insert into trucks (id, carrier_id, unit_number, driver_id, data) values ('dual-t1', '${cid}', 'D1', 'dual-d1', '{"id":"dual-t1","unitNumber":"D1","driverId":"dual-d1","currentLoadId":null}'), ('dual-t2', 'pilot-two', 'D2', 'dual-d2', '{"id":"dual-t2","unitNumber":"D2","driverId":"dual-d2","currentLoadId":"some-load"}')`);
  await twilio("/api/channels/sms", { From: DUAL, To: "+14695550199", Body: "hey what's my next stop", MessageSid: `SM-pilot-${RUN}` });
  await sleep(2500);
  check("a driver in two carriers is heard by the one with a load on their truck", db(`select carrier_id from channel_messages where counterparty = '${DUAL}' and direction = 'in' order by created_at desc limit 1`) === "pilot-two");
  db(`delete from drivers where phone = '${DUAL}'`);
  db(`delete from trucks where id in ('dual-t1', 'dual-t2')`);

  // ── Billing ──
  let b = await api("/api/billing");
  check("billing shows as not started, with the trucks it'll bill", b.body.configured === true && b.body.status === "none" && b.body.trucks >= 1 && !b.body.hold, JSON.stringify(b.body));
  check("only the owner starts the subscription", (await api("/api/billing", { method: "POST", body: { op: "checkout" }, as: token("bbbbbbbb-0000-0000-0000-000000000002", "12145550111") })).status === 403);
  const stripeBefore = read("stripe").length;
  r = await api("/api/billing", { method: "POST", body: { op: "checkout" } });
  const calls = read("stripe").slice(stripeBefore);
  check("the owner goes to Stripe's checkout for trucks × price, with the trial left", /^https:\/\/checkout\.stripe\.test\//.test(r.body.url ?? "") && new RegExp(`q=${b.body.trucks}&trial=14`).test(r.body.url), r.body.url);
  check("…made as a Stripe customer once (idempotent), for the per-truck price", calls.some((c) => c.path === "/v1/customers" && c.idem === `customer-${cid}`) && calls.some((c) => c.path === "/v1/checkout/sessions" && c.form["line_items[0][price]"] === "price_truck" && c.form.client_reference_id === cid));
  const unsigned = await webhook({ id: "evt_x", type: "customer.subscription.updated", data: { object: { id: "sub_x", customer: "cus_x", status: "active" } } }, "t=1,v1=bad");
  check("a webhook without Stripe's signature changes nothing", unsigned.status === 400 && db(`select status from carrier_billing where carrier_id = '${cid}'`) === "none");
  const customer = `cus_${cid.slice(0, 8)}`;
  await webhook({ id: `evt_a${RUN}`, type: "checkout.session.completed", data: { object: { id: "cs_test", customer, subscription: "sub_1", client_reference_id: cid } } });
  const trialEnd = Math.floor(Date.now() / 1000) + 14 * 86400;
  await webhook({ id: `evt_b${RUN}`, type: "customer.subscription.created", data: { object: { id: "sub_1", customer, status: "trialing", trial_end: trialEnd, current_period_end: trialEnd, metadata: { carrier_id: cid }, items: { data: [{ id: "si_1", quantity: 1 }] } } } });
  b = await api("/api/billing");
  check("Stripe's signed messages start the trial", b.body.status === "trialing" && !!b.body.trialEnd && b.body.billedTrucks === 1, JSON.stringify(b.body));
  check("invoices are listed with links", b.body.invoices?.[0]?.url === "https://invoice.stripe.test/in_1" && b.body.invoices[0].amount === 299);
  r = await api("/api/billing", { method: "POST", body: { op: "portal" } });
  check("the owner manages the card and cancels on Stripe's page", /^https:\/\/billing\.stripe\.test\//.test(r.body.url ?? ""), r.body.url);
  check("…and can't start a second subscription", (await api("/api/billing", { method: "POST", body: { op: "checkout" } })).status === 409);
  // The truck count follows the fleet, every day.
  const beforeSync = read("stripe").length;
  await cron("daily");
  check("the subscription follows the trucks on Backroute (prorated)", read("stripe").slice(beforeSync).some((c) => c.path === "/v1/subscription_items/si_1" && Number(c.form.quantity) === b.body.trucks && c.form.proration_behavior === "create_prorations"), JSON.stringify(read("stripe").slice(beforeSync).map((c) => c.path)));

  // ── Push, before the card fails (so its Needs you item buzzes) ──
  const ecdh = crypto.createECDH("prime256v1");
  ecdh.generateKeys();
  const keys = { p256dh: ecdh.getPublicKey().toString("base64url"), auth: crypto.randomBytes(16).toString("base64url") };
  let pushLog = read("push").length;
  r = await api("/api/push", { method: "POST", body: { op: "subscribe", subscription: { endpoint: "https://localhost:3022/push/owner-phone", keys } } });
  const t = await api("/api/push", { method: "POST", body: { op: "test" } });
  const got = read("push").slice(pushLog);
  check("the owner turns on phone alerts and gets a test", r.status === 200 && t.body.sent === 1 && got.some((p) => p.path === "/push/owner-phone"), JSON.stringify({ r: r.body, t: t.body }));
  check("…sent encrypted, signed with Backroute's key (Web Push)", got.some((p) => p.encoding === "aes128gcm" && /^vapid t=.+, k=/.test(p.auth ?? "") && p.bytes > 50), JSON.stringify(got[0]));
  // A driver can turn on notifications for their own messages, but the office's alerts never reach their phone.
  await api("/api/push", { method: "POST", as: token("dddddddd-0000-0000-0000-000000000003", "12145550148"), body: { op: "subscribe", subscription: { endpoint: "https://localhost:3022/push/driver", keys } } });
  await api("/api/push", { method: "POST", body: { op: "subscribe", subscription: { endpoint: "https://localhost:3022/push/gone-phone", keys } } });

  // ── A failed card: a week of grace, then no new bookings ──
  pushLog = read("push").length;
  await webhook({ id: `evt_c${RUN}`, type: "invoice.payment_failed", data: { object: { id: `in_2${RUN}`, customer } } });
  b = await api("/api/billing");
  check("a failed card puts the account past due, still working (grace)", b.body.status === "past_due" && !!b.body.pastDueSince && !b.body.hold, JSON.stringify(b.body));
  check("the owner hears their card failed (Needs you)", !!db(`select id from escalations where carrier_id = '${cid}' and data->>'reason' like '%couldn''t charge your card%'`));
  const pushed = read("push").slice(pushLog);
  check("…and their phone buzzes with it", pushed.some((p) => p.path === "/push/owner-phone"), JSON.stringify(pushed.map((p) => p.path)));
  check("…and not a driver's phone (drivers get only their own messages)", !pushed.some((p) => p.path === "/push/driver"));
  check("a phone that's gone (uninstalled) is forgotten", pushed.some((p) => p.path === "/push/gone-phone") && db(`select count(*) from push_subscriptions where endpoint like '%gone-phone'`) === "0");
  db(`update carrier_billing set past_due_since = now() - interval '10 days' where carrier_id = '${cid}'`);
  b = await api("/api/billing");
  check("past the grace days, billing says the AI is holding new bookings", /failing for over a week/.test(b.body.hold ?? ""), JSON.stringify(b.body));
  db(`delete from loads where carrier_id = '${cid}' and id = 'pb-1'`);
  db(`insert into loads (id, carrier_id, truck_id, stage, data) select 'pb-1', carrier_id, null, 'offered', data || '{"id":"pb-1","stage":"offered","referenceNumber":"PB-7001","truckId":null,"bookRequest":null,"offerGroupId":"pb-g"}'::jsonb from loads where carrier_id = '${cid}' and data->>'referenceNumber' = 'CFP-88213' limit 1`);
  pm = read("postmark").length;
  r = await api("/api/agent/book", { method: "POST", body: { loadId: "pb-1" } });
  const booked = JSON.parse(db(`select data from loads where carrier_id = '${cid}' and id = 'pb-1'`));
  check("so asking to book a new load doesn't go to the broker", r.status === 200 && !booked.bookRequest && !read("postmark").slice(pm).some((x) => /PB-7001/.test(x.body.Subject + x.body.TextBody)), JSON.stringify(booked.bookRequest));
  check("…and the owner is told why, once a day", !!db(`select id from escalations where carrier_id = '${cid}' and data->>'reason' like '%isn''t booking new loads%'`));
  await webhook({ id: `evt_d${RUN}`, type: "invoice.paid", data: { object: { id: `in_2${RUN}`, customer } } });
  b = await api("/api/billing");
  check("paying clears it", ["active", "trialing"].includes(b.body.status) && !b.body.hold && !b.body.pastDueSince, JSON.stringify(b.body));
  await webhook({ id: `evt_e${RUN}`, type: "customer.subscription.deleted", data: { object: { id: "sub_1", customer, status: "canceled", items: { data: [{ id: "si_1", quantity: 3 }] } } } });
  b = await api("/api/billing");
  check("a cancelled subscription holds new bookings too", b.body.status === "canceled" && /cancelled/.test(b.body.hold ?? ""), JSON.stringify(b.body));
  db(`delete from carrier_billing where carrier_id = '${cid}'`);
  db(`delete from loads where carrier_id = '${cid}' and id = 'pb-1'`);

  // ── The pilot carrier script ──
  fs.writeFileSync(`${S}/fakes/data/pilot-fleet.csv`, "unit,driver,phone,equipment,city,state,run\n501,Rosa Diaz,(214) 555-0181,Reefer,Dallas,TX,regional\n502,Tom Hale,2145550182,Dry Van,Fort Worth,TX,otr\n");
  const env = { ...process.env, NEXT_PUBLIC_SUPABASE_URL: "http://localhost:3002", SUPABASE_SERVICE_ROLE_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIiwiZXhwIjoxODIxOTg3OTY3fQ.MjZ3X01YU9uTQeGnA6EOOvyedKjPz6fOR3zpMPYE5kE", EMAIL_INBOUND_ADDRESS: "abc123@inbound.postmarkapp.com" };
  db(`delete from carriers where name = 'Pilot Test Co'`);
  const out = execSync(`node ${ROOT}/scripts/pilot-carrier.mjs create --name "Pilot Test Co" --mc MC-889900 --dot 3300111 --owner-phone "+1 (214) 555-0177" --fleet ${S}/fakes/data/pilot-fleet.csv`, { env, cwd: S }).toString();
  const pid = out.match(/id:\s+(\S+)/)?.[1];
  const pc = JSON.parse(db(`select row_to_json(c) from (select id, mc, dot, owner_phone, settings from carriers where id = '${pid}') c`) || "null");
  check("the script makes a pilot carrier in practice mode, asking first", pc?.settings?.sandbox === true && pc.settings.autonomy === "ask" && pc.settings.pilotStage === "shadow" && pc.mc === "889900", JSON.stringify(pc));
  check("…with its fleet and invites for the owner and each driver", db(`select count(*) from trucks where carrier_id = '${pid}'`) === "2" && db(`select string_agg(role, ',' order by role) from invites where carrier_id = '${pid}'`) === "driver,driver,owner" && db(`select phone from drivers where carrier_id = '${pid}' and name = 'Rosa Diaz'`) === "+12145550181");
  check("…and prints the broker email and the next steps", /abc123\+\w+@inbound\.postmarkapp\.com/.test(out) && /stage .+ ask/.test(out), out.slice(0, 300));
  execSync(`node ${ROOT}/scripts/pilot-carrier.mjs stage ${pid} rules`, { env, cwd: S });
  let st = JSON.parse(db(`select settings from carriers where id = '${pid}'`));
  check("moving a stage sets live mode and the autopilot for it", st.sandbox === false && st.autonomy === "rules" && st.pilotStage === "rules");
  const status = execSync(`node ${ROOT}/scripts/pilot-carrier.mjs status ${pid}`, { env, cwd: S }).toString();
  check("status shows the stage and what's waiting", /stage:\s+rules/.test(status) && /needs owner:\s+0/.test(status), status);
  execSync(`node ${ROOT}/scripts/pilot-carrier.mjs pause ${pid}`, { env, cwd: S });
  st = JSON.parse(db(`select settings from carriers where id = '${pid}'`));
  check("pause puts them straight back in practice mode", st.sandbox === true && st.pilotStage === "shadow");
  execSync(`node ${ROOT}/scripts/pilot-carrier.mjs resume ${pid}`, { env, cwd: S });
  st = JSON.parse(db(`select settings from carriers where id = '${pid}'`));
  check("resume puts them back where they were (live, within the rules)", st.sandbox === false && st.autonomy === "rules" && st.pilotStage === "rules" && !st.pausedFrom, JSON.stringify(st));

  // The stop button, on every carrier at once, and back: the test carrier signed up on its own (no pilot stage).
  const mainBefore = JSON.parse(db(`select settings from carriers where id = '${cid}'`));
  const listed = execSync(`node ${ROOT}/scripts/pilot-carrier.mjs list`, { env, cwd: S }).toString();
  check("list shows each carrier live or in practice", new RegExp(`${pid}\\s+LIVE`).test(listed) && listed.includes(cid), listed);
  const stopped = execSync(`node ${ROOT}/scripts/pilot-carrier.mjs pause-all`, { env, cwd: S }).toString();
  const live = db(`select count(*) from carriers where coalesce((settings->>'sandbox')::boolean, false) = false`);
  check("pause-all: no carrier is live (nothing goes to brokers or drivers)", live === "0" && /in practice mode/.test(stopped), `${live} live; ${stopped}`);
  execSync(`node ${ROOT}/scripts/pilot-carrier.mjs resume-all`, { env, cwd: S });
  const mainAfter = JSON.parse(db(`select settings from carriers where id = '${cid}'`));
  const same = (k) => JSON.stringify(mainBefore[k] ?? null) === JSON.stringify(mainAfter[k] ?? null);
  check("resume-all: each carrier runs exactly as before, even one with no pilot stage", ["sandbox", "autonomy", "pilotStage"].every(same) && !mainAfter.pausedFrom && JSON.parse(db(`select settings from carriers where id = '${pid}'`)).autonomy === "rules", JSON.stringify({ mainBefore, mainAfter }).slice(0, 300));
  db(`delete from carriers where id in ('${pid}', 'pilot-two')`);

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
