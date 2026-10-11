// Settings → Integrations, end to end against the stand-ins: Geotab signed into and read, Xero connected and kept in
// step (once each), driver direct deposit to a bank file, "ask us to connect it", Check now and Disconnect, and the
// hub in the browser (search, a panel with its steps, a link that opens one).
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
const cid = fs.readFileSync(`${S}/fakes/carrier.txt`, "utf8").trim();
const token = (sub, phone) => execSync(`node ${S}/pgrst/jwt.cjs ${sub} ${phone}`).toString();
const OWNER_SUB = "aaaaaaaa-0000-0000-0000-000000000001", OWNER_PHONE = "12145550100";
const OWNER = token(OWNER_SUB, OWNER_PHONE);
const BK_SUB = "b00c0000-0000-0000-0000-0000000000bb", BK_PHONE = "12145550166";
const api = (p, { method = "GET", body, as = OWNER, redirect = "follow" } = {}) =>
  fetch(`${BASE}${p}`, { method, redirect, headers: { ...(as ? { authorization: `Bearer ${as}` } : {}), ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined }).then(async (r) => ({ status: r.status, location: r.headers.get("location"), body: await r.json().catch(() => ({})) }));
function put(table, id, data, cols, kind) {
  db(`delete from ${table} where carrier_id = '${cid}' and id = '${id}'${kind ? ` and kind = '${kind}'` : ""}`);
  db(`insert into ${table} (id, carrier_id, ${kind ? "kind, " : ""}${Object.keys(cols).join(", ")}${Object.keys(cols).length ? ", " : ""}data) values ('${id}', '${cid}', ${kind ? `'${kind}', ` : ""}${Object.values(cols).map((v) => (v === null ? "null" : `'${v}'`)).join(", ")}${Object.keys(cols).length ? ", " : ""}'${JSON.stringify(data).replace(/'/g, "''")}'::jsonb)`);
}
const iso = (h) => new Date(Date.now() + h * 3600000).toISOString();
const row = (kind) => JSON.parse(db(`select row_to_json(x) from (select config, status from carrier_integrations where carrier_id = '${cid}' and kind = '${kind}') x`) || "null");

(async () => {
  db(`update carriers set settings = settings || '{"sandbox":false,"paused":false}'::jsonb where id = '${cid}'`);
  db(`delete from carrier_integrations where carrier_id = '${cid}' and kind in ('geotab', 'xero', 'payouts')`);
  db(`insert into auth.users values ('${BK_SUB}', '${BK_PHONE}') on conflict do nothing`);
  db(`delete from members where user_id = '${BK_SUB}'`);
  db(`insert into members (user_id, carrier_id, role) values ('${BK_SUB}', '${cid}', 'bookkeeper')`);
  const BK = token(BK_SUB, BK_PHONE);

  let r = await api("/api/integrations");
  check("the hub knows Xero and the vault are set up on Backroute's side", r.status === 200 && r.body.available?.xero === true && r.body.available?.vault === true, JSON.stringify(r.body.available));

  // ── Geotab ──────────────────────────────────────────────────────────────────
  put("drivers", "hb-d1", { id: "hb-d1", name: "Lena Ortiz", phone: "+12145550181", email: "", truckId: "hb-t1", carrierId: "carrier-titan", hosStatus: "on_duty", hoursRemaining: 9, cdl: "", rating: 5, hireDate: iso(-24 * 400), homeBase: "Dallas, TX", runType: "regional", homeTimeTarget: "Flexible", payType: "percentage", payRate: 0.28, prefs: { language: "en" } }, { name: "Lena Ortiz", phone: "+12145550181" });
  put("trucks", "hb-t1", { id: "hb-t1", unitNumber: "HB1", driverId: "hb-d1", carrierId: "carrier-titan", equipmentType: "Dry Van", status: "available", currentCity: "Fort Worth", currentState: "TX", homeBase: "Dallas, TX", currentLoadId: null, nextLoadId: null, mpg: 6.5, odometer: 100000, lastServiceMiles: 90000, serviceIntervalMiles: 25000, nextInspectionDue: iso(24 * 300) }, { unit_number: "HB1", driver_id: "hb-d1" });
  r = await api("/api/integrations", { method: "POST", as: BK, body: { kind: "geotab", database: "lonestar", userName: "backroute@lonestar.test", password: "geotab-good-pass" } });
  check("the bookkeeper can't connect an ELD", r.status === 401);
  r = await api("/api/integrations", { method: "POST", body: { kind: "geotab", database: "lonestar", userName: "backroute@lonestar.test", password: "wrong-pass" } });
  check("a wrong Geotab password is said plainly and nothing is saved", r.status === 422 && /didn't accept/.test(r.body.reason ?? "") && !row("geotab"), JSON.stringify(r.body));
  r = await api("/api/integrations", { method: "POST", body: { kind: "geotab", database: "lonestar", userName: "backroute@lonestar.test", password: "geotab-good-pass" } });
  const geo = row("geotab");
  check("Geotab connects: trucks matched by unit, the unknown one named", r.status === 200 && /1 truck matched/.test(r.body.status ?? "") && /not matched: truck GEO-9/.test(r.body.status ?? ""), JSON.stringify(r.body));
  check("...the password kept sealed, never as typed", !!geo && /^v1\./.test(geo.config.password ?? "") && !JSON.stringify(geo).includes("geotab-good-pass"), JSON.stringify(geo).slice(0, 200));
  const t1 = JSON.parse(db(`select data from trucks where carrier_id = '${cid}' and id = 'hb-t1'`) || "{}");
  check("...and the truck is on the map from Geotab", t1.position?.source === "geotab" && Math.abs(t1.position.lat - 32.78) < 0.01, JSON.stringify(t1.position));
  r = await api("/api/integrations?kind=geotab", { method: "PATCH" });
  check("Check now signs in again with what's on file", r.status === 200 && /1 truck matched/.test(r.body.status ?? ""), JSON.stringify(r.body));
  r = await api("/api/integrations?kind=nothing", { method: "PATCH" });
  check("Check now on something not connected says so", r.status === 404);
  const listed = JSON.stringify((await api("/api/integrations")).body);
  check("the list shows the database, never the password", listed.includes("lonestar") && !listed.includes("geotab-good-pass") && !listed.includes("v1."));

  // ── Xero ────────────────────────────────────────────────────────────────────
  r = await api("/api/integrations/xero", { method: "POST", as: BK, body: {} });
  check("only the owner can connect the books", r.status === 401);
  r = await api("/api/integrations/xero", { method: "POST", body: { sales: "4000", bank: "1010" } });
  const start = new URL(r.body.url ?? "http://x/");
  check("the owner starts connecting: Xero's page, Backroute's app, back to Backroute", r.status === 200 && start.origin === "http://localhost:3009" && start.searchParams.get("client_id") === "xero-id" && start.searchParams.get("redirect_uri") === "http://localhost:3210/api/integrations/xero/callback" && /offline_access/.test(start.searchParams.get("scope") ?? ""), r.body.url);
  r = await api(`/api/integrations/xero/callback?state=bad.sig&code=good-code`, { as: null, redirect: "manual" });
  check("a forged return is refused", r.status === 303 && /xero=expired/.test(r.location ?? ""));
  r = await api(`/api/integrations/xero/callback?state=${encodeURIComponent(start.searchParams.get("state"))}&code=good-code`, { as: null, redirect: "manual" });
  const xr = row("xero");
  check("back from Xero: connected to the organisation, the Xero panel opens", r.status === 303 && /tab=integrations&open=xero&xero=connected/.test(r.location ?? "") && xr?.config.tenantId === "tenant-1" && xr?.config.salesAccount === "4000" && xr?.config.bankAccount === "1010", JSON.stringify(xr).slice(0, 300));
  check("...the sign-in sealed", /^v1\./.test(xr?.config.refresh ?? "") && !JSON.stringify(xr).includes("xero-refresh"));
  put("loads", "hb-L1", { id: "hb-L1", referenceNumber: "HB-100", stage: "delivered", carrierId: "carrier-titan", truckId: "hb-t1", brokerId: "hb-b1", source: "test", lane: { origin: "Dallas", originState: "TX", destination: "Memphis", destState: "TN", miles: 452 }, equipmentType: "Dry Van", weight: 30000, pickupWindow: "", deliveryWindow: "", pickupAt: iso(-60), deliveryAt: iso(-50), listedRate: 1500, targetRate: 1500, bookedRate: 1500, deadheadMiles: 0, fuelCost: 200, tollCost: 0, deadheadCost: 0, commission: 0, netProfit: 1100, rpm: 2.4, score: 80, messages: [], calls: [], documents: [], createdAt: iso(-70), updatedAt: iso(0), invoice: { number: "INV-HB-100", amount: 1650, lines: [{ label: "Line haul", amount: 1500 }, { label: "Detention", amount: 150 }], draftedAt: iso(-48), sentAt: iso(-47), paidAt: iso(-2), paidAmount: 1650 } }, { truck_id: "hb-t1", stage: "delivered" });
  const x0 = read("xero").length;
  for (let k = 0; k < 3 && !read("xero").slice(x0).some((x) => x.kind === "invoice" && x.inv.InvoiceNumber === "INV-HB-100"); k++) await api("/api/integrations/xero", { method: "PUT" });
  const sent = read("xero").slice(x0);
  const inv = sent.find((x) => x.kind === "invoice" && x.inv.InvoiceNumber === "INV-HB-100")?.inv;
  check("Sync now: the invoice goes in, one line per charge, on the sales account picked", !!inv && inv.LineItems.length === 2 && inv.LineItems.every((l) => l.AccountCode === "4000") && inv.Type === "ACCREC", JSON.stringify(inv).slice(0, 300));
  check("...and the broker's payment, to the bank account picked", sent.some((x) => x.kind === "payment" && x.payment.Amount === 1650 && x.payment.Account.Code === "1010"), JSON.stringify(sent.filter((x) => x.kind === "payment")).slice(0, 300));
  check("...and when it ran is kept, the sign-in still sealed", !!row("xero")?.config.lastSync && !JSON.stringify(row("xero")).includes("xero-refresh"));
  const x1 = read("xero").length;
  r = await api("/api/integrations/xero", { method: "PUT" });
  check("syncing again puts nothing in twice", r.status === 200 && !read("xero").slice(x1).some((x) => (x.kind === "invoice" && x.inv.InvoiceNumber === "INV-HB-100") || (x.kind === "payment" && x.payment.Amount === 1650)), JSON.stringify(r.body));

  // ── Direct deposit ──────────────────────────────────────────────────────────
  r = await api("/api/integrations/payouts", { method: "POST", as: BK, body: { company: { name: "Lone Star", companyId: "1234567890", bankRouting: "021000021", bankName: "Big Bank" } } });
  check("the bookkeeper can't set up driver pay", r.status === 401);
  r = await api("/api/integrations/payouts", { method: "POST", body: { company: { name: "Lone Star Freight", companyId: "1234567890", bankRouting: "021000022", bankName: "Big Bank" } } });
  check("a routing number that doesn't check out is turned away", r.status === 422 && /doesn't check out/.test(r.body.reason ?? ""), JSON.stringify(r.body));
  r = await api("/api/integrations/payouts", { method: "POST", body: { company: { name: "Lone Star Freight", companyId: "1234567890", bankRouting: "021000021", bankName: "Big Bank" } } });
  check("the sending bank is saved", r.status === 200);
  r = await api("/api/integrations/payouts", { method: "POST", body: { driverId: "hb-d1", routing: "011000015", account: "000123456789", type: "checking" } });
  const pay = row("payouts");
  check("a driver's account is saved sealed, shown only as the last four", r.status === 200 && /^v1\./.test(pay?.config.drivers?.["hb-d1"]?.account ?? "") && !JSON.stringify(pay).includes("000123456789") && pay.config.drivers["hb-d1"].last4 === "••••6789", JSON.stringify(pay).slice(0, 300));
  r = await api("/api/integrations/payouts");
  check("reading it back never shows the account number", r.status === 200 && r.body.drivers?.["hb-d1"]?.last4 === "••••6789" && !JSON.stringify(r.body).includes("000123456789") && !JSON.stringify(r.body).includes("v1."), JSON.stringify(r.body));
  const monday = (() => { const d = new Date(); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7) - 7); return d.toISOString().slice(0, 10); })();
  db(`delete from records where carrier_id = '${cid}' and kind = 'pay_run' and id like 'hb-%'`);
  const run = (id, driverId, net) => ({ id, carrierId: cid, driverId, period: monday, periodEnd: monday, lines: [], extras: [], gross: net, deductions: [], advances: [], escrow: 0, net, status: "draft", createdAt: iso(0) });
  db(`insert into records (id, carrier_id, kind, data) values ('hb-r1', '${cid}', 'pay_run', '${JSON.stringify(run("hb-r1", "hb-d1", 1843.27))}'::jsonb)`);
  r = await api(`/api/integrations/payouts?file=${monday}&effective=${monday}`);
  const lines = (r.body.file ?? "").trimEnd().split("\n");
  check("the week's bank file: one credit for the driver's net, every record 94 characters, whole blocks", r.status === 200 && r.body.total === 1843.27 && r.body.paid?.join() === "Lena Ortiz" && lines.length % 10 === 0 && lines.every((l) => l.length === 94) && lines.some((l) => l.startsWith("622011000015000123456789     0000184327")), JSON.stringify(r.body).slice(0, 300));
  r = await api(`/api/integrations/payouts?file=1999-01-04`);
  check("a week with no pay runs says so", r.status === 422 && /No pay runs/.test(r.body.reason ?? ""), JSON.stringify(r.body));
  r = await api("/api/integrations/payouts?driverId=hb-d1", { method: "DELETE" });
  check("removing a driver's account", r.status === 200 && !row("payouts").config.drivers["hb-d1"]);

  // ── Ask us to connect it ────────────────────────────────────────────────────
  r = await api("/api/integrations/request", { method: "POST", body: { name: "123Loadboard", note: "Account 55120" } });
  check("asking for one that needs us: it lands with Backroute's support team", r.status === 200 && db(`select count(*) from escalations where carrier_id = '${cid}' and data->>'status' = 'with_support' and data->>'reason' like 'Connect 123Loadboard for this carrier: Account 55120%'`) === "1");

  // ── In the browser ──────────────────────────────────────────────────────────
  const browser = await chromium.launch({ args: ARGS });
  const session = JSON.stringify({ access_token: OWNER, refresh_token: "x", token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: OWNER_SUB, phone: OWNER_PHONE, aud: "authenticated", role: "authenticated", app_metadata: {}, user_metadata: {} } });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.addInitScript((s) => localStorage.setItem("sb-localhost-auth-token", s), session);
  const p = await ctx.newPage();
  const errors = [];
  p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(`${BASE}/carrier/settings?tab=integrations`, { waitUntil: "domcontentloaded" });
  const card = p.locator("#set-integrations");
  await card.getByText(/\d+ connected/).waitFor({ timeout: 180000 }).catch(() => {});
  const text = await card.innerText();
  check("every kind of integration is listed", ["ELD & GPS", "LOAD BOARDS", "FUEL CARDS", "TOLLS", "ACCOUNTING", "FACTORING", "DRIVER PAY"].every((c) => text.toUpperCase().includes(c)), text.slice(0, 300));
  check("Geotab and Xero show as connected, with what happened", /Geotab\n[^\n]*1 truck matched[^\n]*\nConnected/.test(text) && /Xero\n[^\n]*Connected to Lone Star Freight[^\n]*\nConnected/.test(text), text.match(/Geotab[\s\S]{0,120}/)?.[0]);
  await p.getByLabel("Search integrations").fill("wex");
  await p.waitForTimeout(400);
  check("search narrows the list", (await card.getByRole("button").count()) === 1);
  await card.getByRole("button", { name: /WEX/ }).click();
  const dialog = p.getByRole("dialog");
  await dialog.waitFor({ timeout: 10000 });
  const panel = await dialog.innerText();
  check("a panel has what it does, how it connects, the steps and the form", /What Backroute does with it/i.test(panel) && /How it connects/i.test(panel) && /Upload it under Money/.test(panel) && (await dialog.getByLabel("Statement address").count()) === 1 && /Upload a file instead/.test(panel), panel.slice(0, 300));
  await p.screenshot({ path: `${S}/.out/hub-panel.png` });
  await p.keyboard.press("Escape");
  await p.goto(`${BASE}/carrier/settings?tab=integrations&open=geotab`, { waitUntil: "domcontentloaded" });
  await p.getByRole("dialog").getByText("Last checked").waitFor({ timeout: 60000 }).catch(() => {});
  const geoPanel = await p.getByRole("dialog").innerText().catch(() => "");
  check("a link opens one panel: Geotab with its status, Check now and Disconnect", /1 truck matched/.test(geoPanel) && /Check now/.test(geoPanel) && /Disconnect/.test(geoPanel), geoPanel.slice(0, 300));
  await p.getByRole("dialog").getByRole("button", { name: "Disconnect" }).click();
  await p.getByRole("button", { name: "Disconnect" }).last().click();
  await p.waitForTimeout(1500);
  check("Disconnect asks first, then it's gone", !row("geotab"));
  await p.screenshot({ path: `${S}/.out/hub-list.png`, fullPage: true });
  check("no page errors", errors.length === 0, errors.join(" | "));
  await browser.close();

  // Xero off: Xero is told to forget the sign-in.
  r = await api("/api/integrations/xero", { method: "DELETE" });
  check("disconnecting Xero revokes the sign-in and forgets it", r.status === 200 && !row("xero") && read("xero").slice(-3).some((x) => x.kind === "revoke"));
  db(`delete from carrier_integrations where carrier_id = '${cid}' and kind = 'payouts'`);
  db(`delete from loads where carrier_id = '${cid}' and id = 'hb-L1'`);

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
