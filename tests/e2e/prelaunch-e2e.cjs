// Before real carriers: a broker's rate con from a new address is held, and one tap trusts that address from then on;
// tracking and shipper links can be stopped, and show the carrier's MC; connections and bank changes land in the
// owner's Changes log; the report card on Money and the weekly goal in Basics.
const path = require("path");
const S = path.join(__dirname, "..");
const fs = require("fs");
const { execSync } = require("child_process");
const { chromium } = require("playwright");
const BASE = "http://localhost:3210";
const ARGS = [`--proxy-server=${process.env.HTTPS_PROXY}`, "--proxy-bypass-list=localhost;127.0.0.1", "--enable-unsafe-swiftshader", "--use-angle=swiftshader", "--ignore-gpu-blocklist"];
let passed = 0, failed = 0;
const check = (label, ok, extra = "") => { ok ? passed++ : failed++; console.log(`${ok ? "PASS" : "FAIL"} ${label}${extra ? ` (${String(extra).slice(0, 400)})` : ""}`); };
const db = (q) => execSync(`su postgres -c "/usr/lib/postgresql/16/bin/psql -h /var/lib/postgresql/backroute-test -p 55432 -U postgres -d rest -tA -c \\"${q.replace(/"/g, '\\\\\\"').replace(/\$/g, () => "\\\\\\$")}\\""`).toString().trim();
const read = (f) => (fs.existsSync(`${S}/fakes/${f}.jsonl`) ? fs.readFileSync(`${S}/fakes/${f}.jsonl`, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const cid = fs.readFileSync(`${S}/fakes/carrier.txt`, "utf8").trim();
const token = (sub, phone) => execSync(`node ${S}/pgrst/jwt.cjs ${sub} ${phone}`).toString();
const OWNER_SUB = "aaaaaaaa-0000-0000-0000-000000000001", OWNER_PHONE = "12145550100";
const OWNER = token(OWNER_SUB, OWNER_PHONE);
const api = (p, { method = "GET", body, as = OWNER } = {}) =>
  fetch(`${BASE}${p}`, { method, headers: { ...(as ? { authorization: `Bearer ${as}` } : {}), ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) }));
const cron = () => fetch(`${BASE}/api/cron/dispatch`, { headers: { authorization: "Bearer cron-secret" } }).then((r) => r.json());
const key = db(`select inbound_key from carriers where id = '${cid}'`);
const RUN = Date.now().toString(36);
let n = 0;
const email = (from, subject, text, attachments = []) =>
  fetch(`${BASE}/api/channels/email?token=email-hook-secret`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ MessageID: `pm-pl-${RUN}-${++n}`, From: from, FromName: "Dee", FromFull: { Email: from, Name: "Dee" }, To: `abc123+${key}@inbound.postmarkapp.com`, MailboxHash: key, Subject: subject, TextBody: text, Headers: [{ Name: "Message-ID", Value: `<pl-${RUN}-${n}@x.test>` }], Attachments: attachments }) });
const pdf = (name) => [{ Name: name, Content: Buffer.from("%PDF-1.4").toString("base64"), ContentType: "application/pdf", ContentLength: 900 }];
const broker = (id, company, mail) => {
  const b = { id, carrierId: cid, company, contact: "Dee", phone: "", email: mail, reliability: 90, avgResponseMins: 20, loadsBooked: 0, onTimePct: 95, avgRateVariancePct: 0, tier: "standard", authorityVerified: true, mc: "771888", legalName: company, verifiedAt: new Date().toISOString(), verifyNote: "FMCSA: broker authority active.", fraudRisk: "low", avgDaysToPay: 30, detentionPaidPct: 80, cancellations90d: 0 };
  db(`insert into records (carrier_id, id, kind, data) values ('${cid}', '${id}', 'broker', '${JSON.stringify(b).replace(/'/g, "''")}'::jsonb) on conflict (carrier_id, kind, id) do update set data = excluded.data`);
};
const brokerData = (id) => JSON.parse(db(`select data from records where carrier_id = '${cid}' and kind = 'broker' and id = '${id}'`) || "null");
const copyLoad = (id, patch, stage) => {
  db(`delete from loads where carrier_id = '${cid}' and id = '${id}'`);
  db(`insert into loads (id, carrier_id, truck_id, stage, data) select '${id}', carrier_id, null, '${stage}', data || '${JSON.stringify({ id, stage, updatedAt: new Date().toISOString(), truckId: null, ...patch }).replace(/'/g, "''")}'::jsonb from loads where carrier_id = '${cid}' and data->>'referenceNumber' = 'CFP-88213' limit 1`);
};
const loadData = (id) => JSON.parse(db(`select data from loads where carrier_id = '${cid}' and id = '${id}'`) || "null");
const escFor = (loadId) => db(`select data from escalations where carrier_id = '${cid}' and data->>'loadId' = '${loadId}' and data->>'reason' like 'Held %' order by (data->>'createdAt') desc limit 1`);

(async () => {
  db(`update carriers set settings = settings || '{"sandbox":false,"paused":false,"autonomy":"rules"}'::jsonb where id = '${cid}'`);

  // ── A rate con from a new address: held, then trusted with one tap ──────────
  broker("pl-b1", "Delta Freight", "dee@deltafreight.test");
  copyLoad("pl-1", { referenceNumber: "PL-1", brokerId: "pl-b1", brokerContactEmail: "dee@deltafreight.test", bookRequest: { ask: 1900, askedAt: new Date().toISOString(), status: "accepted" }, targetRate: 1900, rateConReading: null, invoice: null }, "negotiating");
  const rc = (load, mail) => fs.writeFileSync(`${S}/fakes/ratecon.json`, JSON.stringify({ broker: "Delta Freight", brokerMc: "MC 771888", brokerEmail: mail, loadNumber: load, totalRate: 1900, receiver: "Delta DC", shipper: "Plant 9", mismatches: [], otherConcerns: [], summary: "Matches." }));
  let p0 = read("postmark").length;
  rc("PL-1", "dee@deltalogistics.test");
  await email("dee@deltafreight.test", "Rate con PL-1", "Attached.", pdf("PL-1.pdf"));
  await sleep(3000);
  let held = JSON.parse(escFor("pl-1") || "null");
  check("a known broker's rate con printing a new company address is held", !!held && /names dee@deltalogistics\.test, not their usual deltafreight\.test/.test(held.reason) && loadData("pl-1")?.stage === "negotiating", held?.reason ?? loadData("pl-1")?.stage);
  check("...the owner gets a one-tap answer: trust the new address, or keep holding", held?.answers?.yes === "Trust deltalogistics.test" && held?.answers?.no === "Keep holding" && held?.decision?.kind === "trust_sender" && held.decision.domain === "deltalogistics.test", JSON.stringify(held?.answers));
  const asked = read("postmark").slice(p0).map((m) => m.body).find((m) => m.To === "dee@deltafreight.test" && /that names dee@deltalogistics\.test, which isn't an address we have for Delta Freight/.test(m.TextBody ?? ""));
  check("...and the broker is asked at the address on file, not the new one", !!asked && !read("postmark").slice(p0).some((m) => m.body.To === "dee@deltalogistics.test"), JSON.stringify(read("postmark").slice(p0).map((m) => [m.body.To, m.body.Subject])));

  // The owner taps Trust in Needs you; the next round acts on it.
  db(`update escalations set status = 'resolved', data = data || '${JSON.stringify({ status: "resolved", resolvedBy: "carrier", resolvedAt: new Date().toISOString(), approved: true })}'::jsonb where carrier_id = '${cid}' and id = '${held.id}'`);
  await cron();
  const b1 = brokerData("pl-b1");
  check("yes: the address is trusted for that broker", (b1?.trustedDomains ?? []).includes("deltalogistics.test"), JSON.stringify(b1?.trustedDomains));
  const doneEsc = JSON.parse(db(`select data from escalations where carrier_id = '${cid}' and id = '${held.id}'`));
  check("...and the owner is told what changed", !!doneEsc.decision?.doneAt && /deltalogistics\.test is trusted for Delta Freight/.test(doneEsc.resolutionNote ?? ""), doneEsc.resolutionNote);

  // The broker sends it again: it goes through.
  copyLoad("pl-2", { referenceNumber: "PL-2", brokerId: "pl-b1", brokerContactEmail: "dee@deltafreight.test", bookRequest: { ask: 1900, askedAt: new Date().toISOString(), status: "accepted" }, targetRate: 1900, rateConReading: null, invoice: null }, "negotiating");
  rc("PL-2", "dee@deltalogistics.test");
  await email("dee@deltafreight.test", "Rate con PL-2", "Attached.", pdf("PL-2.pdf"));
  await sleep(3000);
  check("from then on a rate con naming that address isn't held", !escFor("pl-2") && !!loadData("pl-2")?.rateConReading, loadData("pl-2")?.stage);
  // A different stranger is still held: trust is per address, per broker.
  copyLoad("pl-3", { referenceNumber: "PL-3", brokerId: "pl-b1", brokerContactEmail: "dee@deltafreight.test", bookRequest: { ask: 1900, askedAt: new Date().toISOString(), status: "accepted" }, targetRate: 1900, rateConReading: null, invoice: null }, "negotiating");
  rc("PL-3", "dispatch@otherco.test");
  await email("dee@deltafreight.test", "Rate con PL-3", "Attached.", pdf("PL-3.pdf"));
  await sleep(3000);
  check("...another new address still is", /names dispatch@otherco\.test/.test(JSON.parse(escFor("pl-3") || "{}").reason ?? ""));
  fs.unlinkSync(`${S}/fakes/ratecon.json`);

  // ── Tracking links: the MC shows, and Stop sharing ends every link made so far ──
  const lid = db(`select id from loads where carrier_id = '${cid}' and data->>'referenceNumber' = 'CFP-88213' limit 1`);
  let r = await api("/api/track", { method: "POST", body: { loadId: lid } });
  const t1 = new URL(r.body.url ?? "http://x/track/none").pathname.split("/").pop();
  let v = await api(`/api/track?t=${encodeURIComponent(t1)}`, { as: null });
  const mc = db(`select coalesce(mc, '') from carriers where id = '${cid}'`);
  check("a tracking link opens with the carrier's MC", v.status === 200 && (mc ? v.body.mc === mc : "mc" in v.body), JSON.stringify({ status: v.status, mc: v.body.mc }));
  r = await api("/api/track", { method: "POST", body: { loadId: lid, stop: true }, as: null });
  check("only the carrier's office can stop the links", r.status === 401);
  r = await api("/api/track", { method: "POST", body: { loadId: lid, stop: true } });
  v = await api(`/api/track?t=${encodeURIComponent(t1)}`, { as: null });
  check("Stop sharing: a link sent before doesn't open any more", r.status === 200 && v.status === 404, `${r.status}/${v.status}`);
  await sleep(10);
  r = await api("/api/track", { method: "POST", body: { loadId: lid } });
  const t2 = new URL(r.body.url).pathname.split("/").pop();
  v = await api(`/api/track?t=${encodeURIComponent(t2)}`, { as: null });
  check("...and a new one made after does", v.status === 200, v.status);

  // The same for a direct shipper's page.
  r = await api("/api/shipper", { method: "POST", body: { brokerId: "pl-b1" } });
  const s1 = new URL(r.body.url).pathname.split("/").pop();
  v = await api(`/api/shipper?t=${encodeURIComponent(s1)}`, { as: null });
  const opened = v.status === 200 && "mc" in v.body;
  await api("/api/shipper", { method: "POST", body: { brokerId: "pl-b1", stop: true } });
  v = await api(`/api/shipper?t=${encodeURIComponent(s1)}`, { as: null });
  check("a shipper's page shows the MC, and Stop sharing ends its links too", opened && v.status === 404, v.status);

  // ── The Changes log ─────────────────────────────────────────────────────────
  const log = db(`select string_agg(action || ':' || coalesce(target, ''), '|') from audit_log where carrier_id = '${cid}' and action in ('Connected', 'Disconnected') or (carrier_id = '${cid}' and action like 'Changed%bank%')`);
  check("connections made and removed are in the owner's Changes log, with who", /Connected:Geotab/.test(log) && /Disconnected:/.test(log), log.slice(0, 300));
  check("...and so are bank detail changes for driver pay", /Changed (the bank driver pay comes from|a driver's bank account)/.test(log), log.slice(0, 300));
  const who = db(`select string_agg(distinct who, ',') from audit_log where carrier_id = '${cid}' and action = 'Connected'`);
  check("...each says who did it", /owner/.test(who), who);

  // ── In the browser: the weekly goal in Basics, the report card on Money, the MC on the tracking page ──
  const session = JSON.stringify({ access_token: OWNER, refresh_token: "x", token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: OWNER_SUB, phone: OWNER_PHONE, aud: "authenticated", role: "authenticated", app_metadata: {}, user_metadata: {} } });
  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ARGS });
  const p = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await p.evaluate((s) => localStorage.setItem("sb-localhost-auth-token", s), session);
  await p.goto(`${BASE}/carrier/settings`, { waitUntil: "domcontentloaded" });
  const goal = p.getByRole("textbox", { name: "Weekly goal per truck" });
  await goal.waitFor({ timeout: 120000 });
  await goal.fill("6000");
  await goal.blur();
  await p.getByText("Weekly goal saved").waitFor({ timeout: 10000 }).catch(() => {});
  let saved = "";
  for (let i = 0; i < 20 && saved !== "6000"; i++) {
    await sleep(500);
    saved = db(`select coalesce(settings->>'weeklyGoal', '') from carriers where id = '${cid}'`);
  }
  check("Basics asks for a weekly goal per truck, and it's saved", saved === "6000", saved);

  await p.goto(`${BASE}/carrier/earnings`, { waitUntil: "domcontentloaded" });
  const card = p.getByRole("heading", { name: "How Backroute did, last 30 days" });
  await card.waitFor({ timeout: 90000 }).catch(() => {});
  const money = await p.locator("main").innerText();
  check("the report card shows on Money, judged like a dispatcher", /How Backroute did, last 30 days/.test(money) && /Loads delivered/.test(money) && /Days to get paid/.test(money) && /Times it asked you/.test(money), money.slice(0, 200));
  check("...against the owner's weekly goal", /Your goal: \$6,000 a truck a week/.test(money), (money.match(/Your goal[^\n]*/) ?? [""])[0]);
  check("...and nothing on it says AI", !/\bAI\b/.test((money.match(/How Backroute did[\s\S]*?(Your goal[^\n]*)/) ?? [""])[0]));

  await p.goto(`${BASE}/track/${t2}`, { waitUntil: "domcontentloaded" });
  await p.getByText("Tracking from").waitFor({ timeout: 60000 }).catch(() => {});
  const trackText = await p.locator("main").innerText();
  check("the tracking page names the carrier with its MC", /Tracking from/.test(trackText) && (!mc || trackText.includes(mc.replace(/^MC\s*/i, ""))), trackText.slice(0, 160));
  check("no page errors", errors.length === 0, errors.join(" | "));
  await browser.close();

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
