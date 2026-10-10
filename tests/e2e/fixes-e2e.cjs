// The "fix everything" round, end to end against the stand-ins: the owner's Gmail connected and read for freight mail
// only, the email setup's own mail (the test, Gmail's forwarding code), invoice actions (send to accounts payable,
// marked paid short), truck papers on the driver's phone (and only their truck's), the load sheet without the rate,
// the load page in stage order, Home's one-line live loads and the slim Messages header on a phone.
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
const read = (name) => (fs.existsSync(`${S}/fakes/${name}.jsonl`) ? fs.readFileSync(`${S}/fakes/${name}.jsonl`, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
const cid = fs.readFileSync(`${S}/fakes/carrier.txt`, "utf8").trim();
const token = (sub, phone) => execSync(`node ${S}/pgrst/jwt.cjs ${sub} ${phone}`).toString().trim();
const OWNER_SUB = "aaaaaaaa-0000-0000-0000-000000000001", OWNER_PHONE = "12145550100";
const OWNER = token(OWNER_SUB, OWNER_PHONE);
const DRV_SUB = "dddddddd-0000-0000-0000-000000000041", DRV_PHONE = "12145550141";
const iso = (h) => new Date(Date.now() + h * 3600000).toISOString();
const cron = () => fetch(`${BASE}/api/cron/dispatch`, { headers: { authorization: "Bearer cron-secret" } }).then((r) => r.json()).catch(() => ({}));
const sessionFor = (tk, sub, phone) => JSON.stringify({ access_token: tk, refresh_token: "x", token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: sub, phone, aud: "authenticated", role: "authenticated", app_metadata: {}, user_metadata: {} } });
function put(table, id, data, cols = {}) {
  db(`delete from ${table} where carrier_id = '${cid}' and id = '${id}'`);
  const names = Object.keys(cols);
  const vals = Object.values(cols).map((v) => (v === null ? "null" : `'${v}'`));
  db(`insert into ${table} (id, carrier_id, ${names.map((n) => n + ", ").join("")}data) values ('${id}', '${cid}', ${vals.map((v) => v + ", ").join("")}'${JSON.stringify(data).replace(/'/g, "''")}'::jsonb)`);
}
const api = (p, { method = "GET", body, as = OWNER } = {}) =>
  fetch(`${BASE}${p}`, { method, redirect: "manual", headers: { authorization: `Bearer ${as}`, ...(body ? { "content-type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) }).then(async (r) => ({ status: r.status, location: r.headers.get("location"), body: await r.json().catch(() => ({})) }));
const JPEG = Buffer.from("/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=", "base64");
async function upload(kind, as, extra = {}) {
  const form = new FormData();
  form.set("file", new Blob([JPEG], { type: "image/jpeg" }), `${kind}.jpg`);
  form.set("kind", kind);
  for (const [k, v] of Object.entries(extra)) form.set(k, v);
  const r = await fetch(`${BASE}/api/files`, { method: "POST", headers: { authorization: `Bearer ${as}` }, body: form });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}
const mailbox = (m) => fetch("http://localhost:3009/mailbox/add", { method: "POST", body: JSON.stringify(m) }).then((r) => r.json());
const emailsIn = (q) => db(`select count(*) from channel_messages where carrier_id = '${cid}' and channel = 'email' and direction = 'in' and ${q}`);

(async () => {
  // A driver on a truck with a load in transit (its rate con read), a second truck, and a delivered, invoiced load.
  put("drivers", "fx-d1", { id: "fx-d1", name: "Faye Cruz", phone: "+12145550141", email: "", truckId: "fx-t1", carrierId: "carrier-titan", hosStatus: "on_duty", hoursRemaining: 9, cdl: "", rating: 5, hireDate: iso(-24 * 400), homeBase: "Dallas, TX", runType: "regional", homeTimeTarget: "Flexible", payType: "per_mile", payRate: 0.6, prefs: { language: "en" } }, { name: "Faye Cruz", phone: "+12145550141" });
  put("trucks", "fx-t1", { id: "fx-t1", unitNumber: "FX-1", driverId: "fx-d1", carrierId: "carrier-titan", equipmentType: "Dry Van", status: "on_load", currentCity: "Waco", currentState: "TX", homeBase: "Dallas, TX", currentLoadId: "fx-L1", nextLoadId: null, mpg: 6.5, odometer: 100000, lastServiceMiles: 90000, serviceIntervalMiles: 25000, nextInspectionDue: iso(24 * 300) }, { unit_number: "FX-1", driver_id: "fx-d1" });
  put("trucks", "fx-t2", { id: "fx-t2", unitNumber: "FX-2", driverId: null, carrierId: "carrier-titan", equipmentType: "Dry Van", status: "available", currentCity: "Dallas", currentState: "TX", homeBase: "Dallas, TX", currentLoadId: null, nextLoadId: null, mpg: 6.5, odometer: 100000, lastServiceMiles: 90000, serviceIntervalMiles: 25000, nextInspectionDue: iso(24 * 300) }, { unit_number: "FX-2", driver_id: null });
  const base = { carrierId: "carrier-titan", brokerId: "u5-b1", source: "test", equipmentType: "Dry Van", weight: 30000, pickupWindow: "today", deliveryWindow: "tomorrow", listedRate: 1850, targetRate: 1850, bookedRate: 1850, deadheadMiles: 0, fuelCost: 100, tollCost: 0, deadheadCost: 0, commission: 0, netProfit: 1200, rpm: 4.1, score: 80, messages: [], calls: [], documents: [], createdAt: iso(-30), updatedAt: iso(0) };
  const reading = { fileName: "rc.pdf", readAt: iso(-20), isRateCon: true, broker: "TQL", brokerMc: null, loadNumber: "FX-100", totalRate: 1850, pickup: "today", delivery: "tomorrow", equipment: "Dry van", detention: null, paymentTerms: "Net 30", finesAndFees: [], mismatches: [], otherConcerns: [], summary: "", pickupNumber: "PU-55120", deliveryNumber: "PO 88213-A", referenceNumbers: [{ label: "BOL #", value: "BOL-7781" }], commodity: "Paper products", weightLbs: 38000, pieces: "22 pallets", specialInstructions: ["Hard hat and vest at the shipper"] };
  put("loads", "fx-L1", { ...base, id: "fx-L1", referenceNumber: "FX-100", stage: "in_transit", truckId: "fx-t1", lane: { origin: "Dallas", originState: "TX", destination: "Houston", destState: "TX", miles: 240 }, rateConReading: reading }, { truck_id: "fx-t1", stage: "in_transit" });
  put("loads", "fx-L2", { ...base, id: "fx-L2", referenceNumber: "FX-200", stage: "delivered", truckId: "fx-t1", lane: { origin: "Austin", originState: "TX", destination: "Dallas", destState: "TX", miles: 195 }, invoice: { number: "INV-FX-200", amount: 1850, lines: [{ label: "Line haul", amount: 1850 }], draftedAt: iso(-48), sentAt: iso(-48), sentTo: "loads@tql.test" } }, { truck_id: "fx-t1", stage: "delivered" });
  db(`insert into auth.users values ('${DRV_SUB}', '${DRV_PHONE}') on conflict do nothing`);
  db(`delete from members where user_id = '${DRV_SUB}'`);
  db(`insert into members (user_id, carrier_id, role, driver_id) values ('${DRV_SUB}', '${cid}', 'driver', 'fx-d1')`);
  const DRV = token(DRV_SUB, DRV_PHONE);
  const key = db(`select inbound_key from carriers where id = '${cid}'`);

  // ── The owner's Gmail ─────────────────────────────────────────────────────
  db(`delete from carrier_integrations where carrier_id = '${cid}' and kind in ('gmail', 'outlook')`);
  check("a driver can't connect a mailbox", (await api("/api/integrations/mailbox?kind=gmail", { method: "POST", as: DRV })).status === 401);
  const start = await api("/api/integrations/mailbox?kind=gmail", { method: "POST" });
  const url = new URL(start.body.url ?? "http://x/");
  check("connecting Gmail asks Google for read-only, offline access", url.pathname === "/google/authorize" && url.searchParams.get("scope") === "https://www.googleapis.com/auth/gmail.readonly" && url.searchParams.get("access_type") === "offline", start.body.url);
  const state = url.searchParams.get("state");
  const tampered = await api(`/api/integrations/mailbox/callback?state=${encodeURIComponent(state.replace(/^./, (c) => (c === "e" ? "f" : "e")))}&code=good-code`);
  check("a changed state is turned away", /mailbox=expired/.test(tampered.location ?? ""), tampered.location);
  const back = await api(`/api/integrations/mailbox/callback?state=${encodeURIComponent(state)}&code=good-code`);
  check("back from Google: connected, back on the Settings card", back.status === 303 && /\/carrier\/settings\?tab=general&mailbox=connected#set-channels$/.test(back.location ?? ""), back.location);
  const row = JSON.parse(db(`select config from carrier_integrations where carrier_id = '${cid}' and kind = 'gmail'`) || "{}");
  check("…the mailbox is kept, its sign-in sealed (never stored as given)", row.email === "owner@titanfreight.test" && !!row.refresh && !String(row.refresh).includes("g-refresh"), JSON.stringify(row).slice(0, 200));
  const info = await api("/api/integrations/mailbox");
  check("Settings sees which mailbox is connected", info.body.connected?.kind === "gmail" && info.body.connected?.email === "owner@titanfreight.test" && info.body.available?.gmail === true, JSON.stringify(info.body));

  await mailbox({ kind: "gmail", from: "friend@gmail.test", fromName: "Sam", subject: "Dinner Sunday?", text: "Are you free?" });
  await mailbox({ kind: "gmail", from: "billing@phoneco.test", subject: "Your invoice is ready", text: "Your bill", attachments: [{ name: "invoice.pdf", contentType: "application/pdf", base64: JPEG.toString("base64") }] });
  await mailbox({ kind: "gmail", from: "ops@newbroker.test", fromName: "Nina at New Broker", subject: "Rate Confirmation NB-77", text: "Rate con for NB-77 to follow. Can you cover it?" });
  await mailbox({ kind: "gmail", from: "owner@titanfreight.test", subject: "Backroute test", text: "testing" });
  await cron();
  check("the rate con in the owner's Gmail reaches Backroute", emailsIn(`counterparty = 'ops@newbroker.test' and data->>'via' = 'gmail'`) === "1", db(`select counterparty, data->>'subject' from channel_messages where carrier_id = '${cid}' and data->>'via' = 'gmail'`));
  check("…personal mail and a phone bill are skipped, not stored", emailsIn(`counterparty in ('friend@gmail.test', 'billing@phoneco.test')`) === "0");
  check("…the owner's own test counts as setup mail, not for the AI", emailsIn(`counterparty = 'owner@titanfreight.test' and data->>'kind' = 'test'`) === "1");
  await cron();
  check("…and the same mail isn't taken twice on the next round", emailsIn(`counterparty = 'ops@newbroker.test'`) === "1");
  const status = await api(`/api/channels/status?carrier=${cid}`);
  check("the email setup's live test shows it arrived, from the mailbox", status.body.emailSetup?.lastTest?.via === "gmail" && status.body.emailSetup?.lastTest?.from === "owner@titanfreight.test", JSON.stringify(status.body.emailSetup));

  // ── Gmail's forwarding code, sent to the Backroute address ────────────────
  const hook = (email) => fetch(`${BASE}/api/channels/email?token=email-hook-secret`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(email) });
  await hook({ MessageID: `fx-fwd-${Date.now()}`, From: "forwarding-noreply@google.com", FromFull: { Email: "forwarding-noreply@google.com" }, To: `abc123+${key}@inbound.postmarkapp.com`, MailboxHash: key, Subject: "(#481516234) Gmail Forwarding Confirmation - Receive Mail from owner@gmail.com", TextBody: "Confirmation code: 481516234\n\nhttps://mail-settings.google.com/mail/vf-abc123-xyz" });
  const st2 = await api(`/api/channels/status?carrier=${cid}`);
  check("Gmail's forwarding code shows in the setup as it arrives", st2.body.emailSetup?.gmailCode?.code === "481516234" && /^https:\/\/mail-settings\.google\.com\/mail\/vf-/.test(st2.body.emailSetup?.gmailCode?.link ?? ""), JSON.stringify(st2.body.emailSetup));
  check("…and it isn't in the Latest list as a broker email", !(st2.body.log ?? []).some((m) => m.counterparty === "forwarding-noreply@google.com"));

  const off = await api("/api/integrations/mailbox?kind=gmail", { method: "DELETE" });
  check("disconnecting lets Google know and forgets the mailbox", off.status === 200 && db(`select count(*) from carrier_integrations where carrier_id = '${cid}' and kind = 'gmail'`) === "0" && read("mailbox").some((x) => x.kind === "revoke"));

  // ── Invoices ──────────────────────────────────────────────────────────────
  const pm0 = read("postmark").length;
  check("a driver can't touch an invoice", (await api("/api/agent/invoice", { method: "POST", as: DRV, body: { action: "paid", loadId: "fx-L2", amount: 1 } })).status === 401);
  const resend = await api("/api/agent/invoice", { method: "POST", body: { action: "resend", loadId: "fx-L2", to: "ap@tql.test" } });
  const sentAgain = read("postmark").slice(pm0).map((x) => x.body).find((m) => m.To === "ap@tql.test");
  check("send the invoice again, to the broker's accounts payable, with the PDF", resend.status === 200 && !!sentAgain && /^Invoice INV-FX-200|INV-FX-200/.test(sentAgain.Subject) && sentAgain.Attachments?.some((a) => a.Name === "INV-FX-200.pdf"), JSON.stringify(resend.body).slice(0, 200));
  check("…and their answer comes back to the carrier", new RegExp(`abc123\\+${key}@inbound\\.postmarkapp\\.com`).test(sentAgain?.ReplyTo ?? ""), sentAgain?.ReplyTo);
  const pm1 = read("postmark").length;
  const paid = await api("/api/agent/invoice", { method: "POST", body: { action: "paid", loadId: "fx-L2", amount: 1700, paidOn: new Date().toISOString().slice(0, 10) } });
  const l2 = JSON.parse(db(`select data from loads where carrier_id = '${cid}' and id = 'fx-L2'`));
  check("marked paid short: the amount received is kept", paid.status === 200 && l2.invoice.paidAmount === 1700 && !!l2.invoice.paidAt, JSON.stringify(l2.invoice));
  // Sent, or waiting for the owner's OK on "Ask me first": either way the email asks about the $150.
  const shortMail = read("postmark").slice(pm1).map((x) => x.body).find((m) => /Short payment on invoice INV-FX-200/.test(m.Subject))?.TextBody ?? db(`select data->'draft'->>'body' from escalations where carrier_id = '${cid}' and data->'draft'->>'subject' like '%Short payment on invoice INV-FX-200%' limit 1`);
  check("…and the broker is asked what the $150 is for", /\$150 less than the \$1,850 billed/.test(shortMail ?? ""), shortMail);
  check("…once: a second mark-paid is refused", (await api("/api/agent/invoice", { method: "POST", body: { action: "paid", loadId: "fx-L2", amount: 1850 } })).status === 409);

  // ── Truck papers ──────────────────────────────────────────────────────────
  const cab = await upload("cab_card", OWNER, { truckId: "fx-t1", expiresOn: "2027-03-31" });
  const ins = await upload("insurance_card", OWNER);
  const other = await upload("cab_card", OWNER, { truckId: "fx-t2" });
  check("the office adds a truck's cab card and the fleet's insurance card", cab.status === 200 && ins.status === 200 && other.status === 200);
  check("a driver can't add the truck's papers", (await upload("cab_card", DRV, { truckId: "fx-t1" })).status === 403);
  const mine = await api("/api/files", { as: DRV });
  const ids = (mine.body.files ?? []).map((f) => f.id);
  check("the driver sees their truck's papers and the fleet's", ids.includes(cab.body.id) && ids.includes(ins.body.id), JSON.stringify(mine.body).slice(0, 300));
  check("…not another truck's, and not the company's W-9 or COI", !ids.includes(other.body.id) && !(mine.body.files ?? []).some((f) => ["w9", "coi", "voided_check"].includes(f.kind)));
  const open = await fetch(`${BASE}/api/files/${cab.body.id}`, { headers: { authorization: `Bearer ${DRV}` } });
  check("…and can open one to show at an inspection", open.status === 200 && (await open.arrayBuffer()).byteLength === JPEG.length);

  // ── Screens ───────────────────────────────────────────────────────────────
  const browser = await chromium.launch({ args: ARGS });
  const errors = [];
  const octx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await octx.addInitScript((s) => localStorage.setItem("sb-localhost-auth-token", s), sessionFor(OWNER, OWNER_SUB, OWNER_PHONE));
  const op = await octx.newPage();
  op.on("pageerror", (e) => errors.push(e.message));
  await op.goto(`${BASE}/carrier`, { waitUntil: "domcontentloaded" });
  const row1 = op.getByRole("button", { name: /^FX-1 · Faye Cruz: Houston, TX/ });
  await row1.waitFor({ timeout: 120000 }).catch(() => {});
  const box = await row1.boundingBox().catch(() => null);
  check("Home: each live load is one short line", !!box && box.height < 90, JSON.stringify(box));
  await op.goto(`${BASE}/carrier/loads/fx-L1`, { waitUntil: "domcontentloaded" });
  await op.getByRole("region", { name: "Load sheet" }).first().waitFor({ timeout: 90000 }).catch(() => {});
  const sheet = await op.getByRole("region", { name: "Load sheet" }).first().innerText().catch(() => "");
  check("the load page has the load sheet from the rate con", /PU-55120/.test(sheet) && /PO 88213-A/.test(sheet) && /Paper products · 22 pallets · 38,000 lbs/.test(sheet) && /Hard hat/.test(sheet), sheet);
  const order = await op.evaluate(() => {
    const y = (re) => [...document.querySelectorAll("h1,h2,h3,p,div")].find((e) => re.test(e.textContent?.trim() ?? "") && e.children.length === 0)?.getBoundingClientRect().top ?? -1;
    return { docs: y(/^Documents$/), profit: y(/^Rate & profit$/) };
  });
  check("on the road, the papers come before the money", order.docs >= 0 && order.profit >= 0 && order.docs < order.profit, JSON.stringify(order));
  await op.goto(`${BASE}/carrier/messages`, { waitUntil: "domcontentloaded" });
  await op.getByRole("tablist", { name: "Conversations" }).waitFor({ timeout: 90000 }).catch(() => {});
  await op.waitForTimeout(1500);
  const tabs = await op.getByRole("tablist", { name: "Conversations" }).boundingBox().catch(() => null);
  const box2 = await op.getByRole("textbox", { name: "Message" }).boundingBox().catch(() => null);
  const scrolled = await op.evaluate(() => window.scrollY);
  check("Messages on a phone: the conversations under a slim header, the box to write in above the tab bar, nothing scrolled away", !!tabs && tabs.y < 260 && !!box2 && box2.y + box2.height < 844 - 70 && scrolled === 0, JSON.stringify({ tabs, box2, scrolled }));

  const dctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await dctx.addInitScript((s) => localStorage.setItem("sb-localhost-auth-token", s), sessionFor(DRV, DRV_SUB, DRV_PHONE));
  const dp = await dctx.newPage();
  dp.on("pageerror", (e) => errors.push(e.message));
  await dp.goto(`${BASE}/driver/loads/fx-L1`, { waitUntil: "domcontentloaded" });
  await dp.getByRole("region", { name: "Load sheet" }).first().waitFor({ timeout: 90000 }).catch(() => {});
  const dsheet = await dp.getByRole("region", { name: "Load sheet" }).first().innerText().catch(() => "");
  const dpage = await dp.locator("main, body").first().innerText().catch(() => "");
  check("the driver's load sheet has the numbers the docks ask for", /PU-55120/.test(dsheet) && /BOL-7781/.test(dsheet), dsheet);
  check("…and a per-mile driver sees their pay, not what the load pays", /Your pay/.test(dpage) && !/\$1,850/.test(dpage), dpage.slice(0, 300));
  await dp.goto(`${BASE}/driver/profile`, { waitUntil: "domcontentloaded" });
  await dp.getByRole("region", { name: "Truck papers" }).waitFor({ timeout: 90000 }).catch(() => {});
  await dp.getByRole("button", { name: "Show" }).first().waitFor({ timeout: 30000 }).catch(() => {});
  const papers = await dp.getByRole("region", { name: "Truck papers" }).innerText().catch(() => "");
  check("Profile: the truck papers, each a tap to show", (await dp.getByRole("region", { name: "Truck papers" }).getByRole("button", { name: "Show" }).count()) === 2 && /IFTA license\s*Not added yet/.test(papers), papers);
  check("no page errors", errors.length === 0, errors.join(" | "));
  await browser.close();

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
