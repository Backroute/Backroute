// UX round 2, end to end against the stand-ins: the emergency pause (nothing goes, nothing books, held emails wait,
// the owner's own asks still go), who started a booking (timeline), and in the browser: send-all on Home, the command
// bar running an action, the load timeline, Loads filters remembered, the sample fleet and back, dark mode, phone tabs.
const path = require("path");
const S = path.join(__dirname, "..");
const ROOT = path.join(__dirname, "../..");
const crypto = require("crypto");
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
const api = (path, { method = "GET", body, as = OWNER, headers = {} } = {}) =>
  fetch(`${BASE}${path}`, { method, headers: { ...(as ? { authorization: `Bearer ${as}` } : {}), ...(body ? { "content-type": "application/json" } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) }));
const RUN = Date.now().toString(36);
const inbound = db(`select inbound_key from carriers where id = '${cid}'`);
let n = 0;
const email = (subject, text, from) =>
  fetch(`${BASE}/api/channels/email?token=email-hook-secret`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ MessageID: `ux2-${RUN}-${n++}`, From: from, FromName: "Kim", FromFull: { Email: from, Name: "Kim" }, To: `abc123+${inbound}@inbound.postmarkapp.com`, MailboxHash: inbound, Subject: subject, TextBody: text, Headers: [], Attachments: [] }) }).then((r) => r.json());
const toBroker = (to, i) => read("postmark").slice(i).map((m) => m.body).filter((m) => m?.To === to);
function put(table, id, data, cols) {
  db(`delete from ${table} where carrier_id = '${cid}' and id = '${id}'`);
  db(`insert into ${table} (id, carrier_id, ${Object.keys(cols).join(", ")}, data) values ('${id}', '${cid}', ${Object.values(cols).map((v) => (v === null ? "null" : `'${v}'`)).join(", ")}, '${JSON.stringify(data).replace(/'/g, "''")}'::jsonb)`);
}
const truck = (id, unit, driverId, equipment, city, state) => ({ id, unitNumber: unit, driverId, carrierId: "carrier-titan", equipmentType: equipment, status: "available", currentCity: city, currentState: state, homeBase: `${city}, ${state}`, currentLoadId: null, nextLoadId: null, mpg: 6.5, odometer: 0, lastServiceMiles: 0, serviceIntervalMiles: 25000, nextInspectionDue: new Date(Date.now() + 300 * 86400000).toISOString() });
const driver = (id, name, phone, truckId, city, state) => ({ id, name, phone, email: "", truckId, carrierId: "carrier-titan", hosStatus: "on_duty", hoursRemaining: 11, cdl: "", rating: 5, hireDate: new Date().toISOString(), homeBase: `${city}, ${state}`, runType: "regional", homeTimeTarget: "Flexible", payType: "percentage", payRate: 0.28, prefs: { language: "en" } });

async function signIn(browser, { width = 1280, theme } = {}) {
  const session = JSON.stringify({ access_token: OWNER, refresh_token: "x", token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: OWNER_SUB, phone: OWNER_PHONE, aud: "authenticated", role: "authenticated", app_metadata: {}, user_metadata: {} } });
  const mobile = width < 600;
  const ctx = await browser.newContext({ viewport: { width, height: mobile ? 844 : 900 }, hasTouch: mobile, isMobile: mobile });
  await ctx.addInitScript(([s, t]) => {
    localStorage.setItem("sb-localhost-auth-token", s);
    if (t) localStorage.setItem("backroute.theme", t);
  }, [session, theme ?? ""]);
  const p = await ctx.newPage();
  p.errors = [];
  p.on("pageerror", (e) => p.errors.push(e.message));
  return p;
}

(async () => {
  const set = (patch) => db(`update carriers set settings = settings || '${JSON.stringify(patch)}'::jsonb where id = '${cid}'`);
  const unset = (...keys) => db(`update carriers set settings = settings ${keys.map((k) => `- '${k}'`).join(" ")} where id = '${cid}'`);
  set({ autonomy: "rules", sandbox: false, minRpm: 2.0, undoSeconds: 0 });
  put("drivers", "u2-d1", driver("u2-d1", "Lena Ruiz", "+12145550191", "u2-t1", "Fort Worth", "TX"), { name: "Lena Ruiz", phone: "+12145550191" });
  put("trucks", "u2-t1", truck("u2-t1", "U21", "u2-d1", "Reefer", "Fort Worth", "TX"), { unit_number: "U21", driver_id: "u2-d1" });

  // ── The emergency pause ──
  set({ paused: true, pausedAt: new Date().toISOString() });
  const from = `kim@midsouth-u2-${RUN}.test`;
  let pm = read("postmark").length;
  await email(`Loads available u2 ${RUN}`, "Hi, loads available for your reefers. Kim, Midsouth Logistics, our MC number is 777002", from);
  await sleep(4000);
  const held = await api("/api/agent/undo");
  const sentToKim = toBroker(from, pm);
  const offered = db(`select id from loads where carrier_id = '${cid}' and truck_id = 'u2-t1' and data->>'stage' = 'offered' limit 1`) || db(`select id from loads where carrier_id = '${cid}' and data->'lane'->>'destination' = 'Atlanta' and data->>'stage' = 'offered' order by updated_at desc limit 1`);
  check("paused: a load inside the rules isn't asked for on its own", !held.body.held?.some((h) => /to book/.test(h.summary)) && !sentToKim.some((m) => /Can we get/.test(m.TextBody ?? "")), JSON.stringify({ held: held.body.held?.map((h) => h.summary), sent: sentToKim.map((m) => m.Subject) }));
  check("…the offer still lands for the owner to pick", !!offered, offered);

  // A held email that comes due while paused waits.
  const hsId = `hs_${crypto.randomBytes(8).toString("hex")}`;
  db(`insert into held_sends (id, carrier_id, load_id, purpose, summary, draft, send_at) values ('${hsId}', '${cid}', null, 'counter', 'Countering u2 ${RUN}', '{"channel":"email","to":"held-u2-${RUN}@broker.test","subject":"Re: u2","body":"We can do 2,100.","purpose":"counter","amount":2100}'::jsonb, now() - interval '1 minute')`);
  pm = read("postmark").length;
  const cron = await fetch(`${BASE}/api/cron/dispatch`, { headers: { authorization: "Bearer cron-secret" } });
  await sleep(1500);
  check("paused: an email waiting for Undo doesn't go when its time is up", cron.status === 200 && db(`select status from held_sends where id = '${hsId}'`) === "held" && toBroker(`held-u2-${RUN}@broker.test`, pm).length === 0, `${cron.status} ${db(`select status from held_sends where id = '${hsId}'`)}`);

  // The owner's own ask still goes, and the load remembers it was theirs.
  if (offered) {
    pm = read("postmark").length;
    const r = await api("/api/agent/book", { method: "POST", body: { loadId: offered } });
    await sleep(1500);
    const by = db(`select data->'bookRequest'->>'byOwner' from loads where carrier_id = '${cid}' and id = '${offered}'`);
    check("paused: the owner can still ask to book it themselves, and it goes", r.status === 200 && toBroker(from, pm).length === 1, JSON.stringify(r.body));
    check("…and the load records that the owner asked (for its timeline)", by === "true", by);
  }

  // Resumed: the held email goes on the next round.
  unset("paused", "pausedAt");
  await fetch(`${BASE}/api/cron/dispatch`, { headers: { authorization: "Bearer cron-secret" } });
  await sleep(1500);
  check("resumed: the waiting email goes", db(`select status from held_sends where id = '${hsId}'`) === "sent" && toBroker(`held-u2-${RUN}@broker.test`, pm).length === 1);

  // ── In the browser ──
  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ARGS });
  const draftEsc = (id, to, purpose) =>
    put("escalations", id, { id, loadId: "", carrierId: "carrier-titan", reason: `Detention claim for ${id}`, createdAt: new Date().toISOString(), status: "open", complexity: "routine", recommendedAction: "approve", recommendedLabel: "Send it", source: "email", draft: { channel: "email", to, subject: `Detention ${id}`, body: "Our truck waited 4 hours. $100 detention, please add it to the rate con.", purpose } }, { load_id: null, status: "open" });
  const a = `det-a-${RUN}@broker.test`, b = `det-b-${RUN}@broker.test`;
  draftEsc(`esc-u2-a-${RUN}`, a, "detention");
  draftEsc(`esc-u2-b-${RUN}`, b, "detention");

  const p = await signIn(browser);
  await p.goto(`${BASE}/carrier`, { waitUntil: "domcontentloaded" });
  const batch = p.getByRole("button", { name: /Send all: \d+ detention claims/ });
  await batch.waitFor({ timeout: 120000 }).catch(() => {});
  check("Home offers to send the detention claims together", (await batch.count()) === 1, (await batch.count()) ? await batch.innerText() : "none");
  await p.screenshot({ path: `${S}/.out/ux2-home-light.png` });
  pm = read("postmark").length;
  if (await batch.count()) {
    await batch.click();
    await p.getByRole("button", { name: /^Send all \(\d+\)$/ }).click();
    await sleep(5000);
  }
  check("…one tap sends them all", toBroker(a, pm).length === 1 && toBroker(b, pm).length === 1 && db(`select count(*) from escalations where carrier_id = '${cid}' and id in ('esc-u2-a-${RUN}', 'esc-u2-b-${RUN}') and status = 'resolved'`) === "2");

  // The status pill and the command bar.
  check("the AI's status shows up top", (await p.getByRole("button", { name: /AI status and pause/ }).count()) === 1);
  await p.keyboard.press("Control+k");
  await p.getByLabel("Search or tell the AI").fill("pause the AI");
  await p.keyboard.press("Enter");
  await sleep(4000);
  check("typing \"pause the AI\" pauses it, and it's saved", db(`select settings->>'paused' from carriers where id = '${cid}'`) === "true");
  await p.getByRole("status").filter({ hasText: "The AI is paused" }).waitFor({ timeout: 10000 }).catch(() => {});
  check("…Home says it's paused, with Resume", (await p.getByText(/The AI is paused/).count()) >= 1);
  await p.getByRole("button", { name: "Resume" }).first().click();
  await sleep(3000);
  check("…and Resume undoes it", db(`select coalesce(settings->>'paused', 'false') from carriers where id = '${cid}'`) === "false");
  await p.keyboard.press("Control+k");
  await p.getByLabel("Search or tell the AI").fill("what did we make this week?");
  check("a question in the command bar goes to the AI", (await p.getByText("Ask the AI dispatcher").count()) === 1);
  await p.keyboard.press("Escape");

  // The load timeline: who asked.
  if (offered) {
    await p.goto(`${BASE}/carrier/loads/${offered}`, { waitUntil: "domcontentloaded" });
    const tl = p.locator('section[aria-labelledby^="timeline-"]');
    await tl.waitFor({ timeout: 60000 }).catch(() => {});
    const t = (await tl.count()) ? await tl.innerText() : "";
    check("a load's timeline says the owner asked for it", /You asked to book it/.test(t) && /Offer came in/.test(t), t.slice(0, 300));
    if (await tl.count()) await tl.screenshot({ path: `${S}/.out/ux2-timeline.png` });
  }

  // Loads filters are remembered.
  await p.goto(`${BASE}/carrier/loads`, { waitUntil: "domcontentloaded" });
  const search = p.getByPlaceholder("Load #, city or broker");
  await search.waitFor({ timeout: 60000 });
  await search.fill("Atlanta");
  await sleep(500);
  await p.reload({ waitUntil: "domcontentloaded" });
  await search.waitFor({ timeout: 60000 });
  await sleep(1500);
  check("Loads remembers its filters on this device", (await search.inputValue()) === "Atlanta");
  await p.getByRole("button", { name: "Clear" }).click();

  // The sample fleet and back.
  await p.goto(`${BASE}/carrier`, { waitUntil: "domcontentloaded" });
  // Offered while the owner is new (fewer than 3 real loads booked); after that it's out of the way.
  const booked = Number(db(`select count(*) from loads where carrier_id = '${cid}' and coalesce((data->>'imported')::boolean, false) = false and data->>'stage' not in ('sourced', 'scoring', 'offered', 'negotiating', 'declined')`));
  const open = p.getByRole("button", { name: "Open the sample fleet" });
  await p.getByRole("button", { name: /AI status and pause/ }).waitFor({ timeout: 60000 }).catch(() => {});
  if (booked < 3) await open.waitFor({ timeout: 30000 }).catch(() => {});
  else await sleep(3000);
  check(booked < 3 ? "a new owner is offered the sample fleet" : "an owner with booked loads isn't pestered with the sample fleet", (await open.count()) === (booked < 3 ? 1 : 0), `${booked} booked`);
  {
    if (await open.count()) await open.click();
    else await p.evaluate(() => (sessionStorage.setItem("backroute-demo", "sample"), location.assign("/carrier")));
    await p.getByRole("note", { name: "Sample fleet" }).waitFor({ timeout: 60000 }).catch(() => {});
    check("…it opens, clearly marked, with the practice list", (await p.getByRole("note", { name: "Sample fleet" }).count()) === 1 && (await p.getByText("Practice on the sample fleet").count()) === 1);
    await p.screenshot({ path: `${S}/.out/ux2-sample.png` });
    await p.getByRole("button", { name: "Back to my fleet" }).first().click();
    await p.waitForURL(/\/carrier/, { timeout: 60000 });
    await p.getByRole("button", { name: /AI status and pause/ }).waitFor({ timeout: 60000 }).catch(() => {});
    check("…and Back to my fleet returns to the real account", (await p.getByRole("note", { name: "Sample fleet" }).count()) === 0 && (await p.getByText("Practice on the sample fleet").count()) === 0);
  }

  // Dark, and the phone.
  const dk = await signIn(browser, { theme: "dark" });
  await dk.goto(`${BASE}/carrier`, { waitUntil: "domcontentloaded" });
  await dk.getByRole("button", { name: /AI status and pause/ }).waitFor({ timeout: 120000 }).catch(() => {});
  await sleep(1500);
  check("dark mode applies before the page draws", (await dk.evaluate(() => document.documentElement.dataset.theme)) === "dark");
  await dk.screenshot({ path: `${S}/.out/ux2-home-dark.png` });
  const ph = await signIn(browser, { width: 390 });
  for (const path of ["/carrier", "/carrier/loads", "/carrier/fleet", "/carrier/earnings", "/carrier/settings"]) {
    await ph.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded" });
    await ph.getByRole("navigation", { name: "Sections", exact: true }).waitFor({ timeout: 120000 }).catch(() => {});
    await sleep(1200);
    const w = await ph.evaluate(() => document.documentElement.scrollWidth);
    check(`phone: ${path} fits the screen, with the tab bar`, w <= 390 && (await ph.getByRole("navigation", { name: "Sections", exact: true }).count()) === 1, w);
  }
  await ph.goto(`${BASE}/carrier`, { waitUntil: "domcontentloaded" });
  await sleep(4000);
  await ph.screenshot({ path: `${S}/.out/ux2-phone.png` });

  check("no page errors", ![p, dk, ph].some((x) => x.errors.length), [p, dk, ph].flatMap((x) => x.errors).join(" | "));
  await browser.close();

  // Put the shared fleet back the way other suites expect it.
  unset("undoSeconds", "paused", "pausedAt");
  db(`delete from loads where carrier_id = '${cid}' and truck_id = 'u2-t1'`);
  db(`delete from trucks where carrier_id = '${cid}' and id = 'u2-t1'`);
  db(`delete from drivers where carrier_id = '${cid}' and id = 'u2-d1'`);
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
