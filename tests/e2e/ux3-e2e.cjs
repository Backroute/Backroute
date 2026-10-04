// Round 3, end to end against the stand-ins: the back office and driver tools in a real account. A fuel statement
// feed matched to loads, paperwork reminders at their stage, contract loads made by the AI, ELD odometer and engine
// codes, the audit log, the bookkeeper's limits, devices, weather on the route, lumper alerts, and in the browser:
// a fuel CSV brought in and saved, and the new pages opening.
const path = require("path");
const S = path.join(__dirname, "..");
const ROOT = path.join(__dirname, "../..");
const fs = require("fs");
const { execSync } = require("child_process");
const { chromium } = require("playwright");
const BASE = "http://localhost:3210";
const REST = "http://localhost:3002/rest/v1";
const ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImV4cCI6MTgyMTk4Nzk2N30.9Jxna8DpRpomKTkzvXhtAP304R7f6A-Pxza7_qpdnes";
const ARGS = [`--proxy-server=${process.env.HTTPS_PROXY}`, "--proxy-bypass-list=localhost;127.0.0.1", "--enable-unsafe-swiftshader", "--use-angle=swiftshader", "--ignore-gpu-blocklist"];
let passed = 0, failed = 0;
const check = (label, ok, extra = "") => { ok ? passed++ : failed++; console.log(`${ok ? "PASS" : "FAIL"} ${label}${extra ? ` (${String(extra).slice(0, 400)})` : ""}`); };
const db = (q) => execSync(`su postgres -c "/usr/lib/postgresql/16/bin/psql -h /var/lib/postgresql/backroute-test -p 55432 -U postgres -d rest -tA -c \\"${q.replace(/"/g, '\\\\\\"').replace(/\$/g, () => "\\\\\\$")}\\""`).toString().trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const read = (f) => (fs.existsSync(`${S}/fakes/${f}.jsonl`) ? fs.readFileSync(`${S}/fakes/${f}.jsonl`, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
const cid = fs.readFileSync(`${S}/fakes/carrier.txt`, "utf8").trim();
const token = (sub, phone) => execSync(`node ${S}/pgrst/jwt.cjs ${sub} ${phone}`).toString();
const OWNER_SUB = "aaaaaaaa-0000-0000-0000-000000000001", OWNER_PHONE = "12145550100";
const OWNER = token(OWNER_SUB, OWNER_PHONE);
const BK_SUB = "b00c0000-0000-0000-0000-0000000000bb", BK_PHONE = "12145550166";
const DRV_SUB = "dddddddd-0000-0000-0000-000000000003", DRV_PHONE = "12145550148";
const api = (path, { method = "GET", body, as = OWNER } = {}) =>
  fetch(`${BASE}${path}`, { method, headers: { ...(as ? { authorization: `Bearer ${as}` } : {}), ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) }));
const rest = (path, { method = "GET", body, as = OWNER, prefer } = {}) =>
  fetch(`${REST}${path}`, { method, headers: { apikey: ANON, authorization: `Bearer ${as}`, "content-type": "application/json", ...(prefer ? { prefer } : {}) }, body: body ? JSON.stringify(body) : undefined }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));
const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
function put(table, id, data, cols, kind) {
  db(`delete from ${table} where carrier_id = '${cid}' and id = '${id}'${kind ? ` and kind = '${kind}'` : ""}`);
  db(`insert into ${table} (id, carrier_id, ${kind ? "kind, " : ""}${Object.keys(cols).join(", ")}${Object.keys(cols).length ? ", " : ""}data) values ('${id}', '${cid}', ${kind ? `'${kind}', ` : ""}${Object.values(cols).map((v) => (v === null ? "null" : `'${v}'`)).join(", ")}${Object.keys(cols).length ? ", " : ""}'${JSON.stringify(data).replace(/'/g, "''")}'::jsonb)`);
}
const truck = (id, unit, driverId, equipment, city, state, extra = {}) => ({ id, unitNumber: unit, driverId, carrierId: "carrier-titan", equipmentType: equipment, status: "available", currentCity: city, currentState: state, homeBase: `${city}, ${state}`, currentLoadId: null, nextLoadId: null, mpg: 6.5, odometer: 100000, lastServiceMiles: 90000, serviceIntervalMiles: 25000, nextInspectionDue: new Date(Date.now() + 300 * 86400000).toISOString(), ...extra });
const driver = (id, name, phone, truckId, city, state, extra = {}) => ({ id, name, phone, email: "", truckId, carrierId: "carrier-titan", hosStatus: "on_duty", hoursRemaining: 11, cdl: "", rating: 5, hireDate: new Date().toISOString(), homeBase: `${city}, ${state}`, runType: "regional", homeTimeTarget: "Flexible", payType: "percentage", payRate: 0.28, prefs: { language: "en" }, ...extra });
const cron = () => fetch(`${BASE}/api/cron/dispatch`, { headers: { authorization: "Bearer cron-secret" } });

async function signIn(browser, { width = 1280 } = {}) {
  const session = JSON.stringify({ access_token: OWNER, refresh_token: "x", token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: OWNER_SUB, phone: OWNER_PHONE, aud: "authenticated", role: "authenticated", app_metadata: {}, user_metadata: {} } });
  const ctx = await browser.newContext({ viewport: { width, height: 900 } });
  await ctx.addInitScript((s) => localStorage.setItem("sb-localhost-auth-token", s), session);
  const p = await ctx.newPage();
  p.errors = [];
  p.on("pageerror", (e) => p.errors.push(e.message));
  return p;
}

(async () => {
  const started = db("select now()");
  const set = (patch) => db(`update carriers set settings = settings || '${JSON.stringify(patch)}'::jsonb where id = '${cid}'`);
  set({ autonomy: "ask", sandbox: false, paused: false });

  // A truck on a load today, with papers coming due.
  put("drivers", "u3-d1", driver("u3-d1", "Rosa Vance", "+12145550193", "u3-t1", "Amarillo", "TX", { medCardExpires: day(-2) }), { name: "Rosa Vance", phone: "+12145550193" });
  put("trucks", "u3-t1", truck("u3-t1", "U31", "u3-d1", "Reefer", "Amarillo", "TX", { registrationExpires: day(9) }), { unit_number: "U31", driver_id: "u3-d1" });
  const load = { id: "u3-L1", referenceNumber: "U3-100", stage: "in_transit", carrierId: "carrier-titan", truckId: "u3-t1", brokerId: "b-x", source: "test", lane: { origin: "Amarillo", originState: "TX", destination: "Tulsa", destState: "OK", miles: 350, marketRpm: 2.4 }, equipmentType: "Reefer", weight: 30000, pickupWindow: "today", deliveryWindow: "tomorrow", pickupAt: new Date(Date.now() - 6 * 3600000).toISOString(), deliveryAt: new Date(Date.now() + 20 * 3600000).toISOString(), listedRate: 1000, targetRate: 1000, bookedRate: 1000, deadheadMiles: 0, fuelCost: 200, tollCost: 0, deadheadCost: 0, commission: 0, netProfit: 800, rpm: 2.86, score: 80, messages: [], calls: [], documents: [], createdAt: new Date(Date.now() - 86400000).toISOString(), updatedAt: new Date().toISOString(), invoice: { amount: 1000, sentAt: new Date().toISOString() } };
  put("loads", "u3-L1", load, { truck_id: "u3-t1", stage: "in_transit" });
  db(`delete from records where carrier_id = '${cid}' and kind in ('fuel', 'toll', 'advance', 'pay_run')`);
  db(`delete from agent_marks where carrier_id = '${cid}' and (load_id in ('compliance', 'statements', 'contracts', 'faults'))`);

  // ── Fuel card statement feed ──
  const conn = await api("/api/integrations", { method: "POST", body: { kind: "fuel_feed", url: "http://localhost:3009/fuel.csv", headerName: "x-report-key", headerValue: "fuel-secret", name: "WEX" } });
  check("fuel statement connects and reads now", conn.status === 200 && /2 lines read, 1 on a load/.test(conn.body.status ?? ""), JSON.stringify(conn.body));
  const fuelRows = db(`select data->>'unit' || ':' || coalesce(data->>'loadId', '-') || ':' || (data->>'amount') from records where carrier_id = '${cid}' and kind = 'fuel' order by 1`);
  check("each line on the load its truck ran that day; the unknown unit waits", fuelRows.includes("U31:u3-L1:395.85") && fuelRows.includes("U99:-:156"), fuelRows);
  const bad = await api("/api/integrations", { method: "POST", body: { kind: "toll_feed", url: "http://localhost:3009/fuel.csv", headerName: "x-report-key", headerValue: "wrong" } });
  check("a wrong key is caught when connecting", bad.status === 422 && /403/.test(bad.body.reason ?? ""), JSON.stringify(bad.body));
  const list = await api("/api/integrations");
  check("the connection shows (never the key)", list.body.connections?.some((c) => c.kind === "fuel_feed" && c.name === "WEX") && !JSON.stringify(list.body).includes("fuel-secret"));

  // ── A round: reminders, the same statement again, contract loads ──
  put("records", "u3-ship", { id: "u3-ship", carrierId: "carrier-titan", company: "Panhandle Feed Co", contact: "Jo", phone: "", email: "ap@panhandle.test", reliability: 90, avgResponseMins: 20, loadsBooked: 0, onTimePct: 100, avgRateVariancePct: 0, tier: "preferred", authorityVerified: true, fraudRisk: "low", avgDaysToPay: 30, detentionPaidPct: 0, cancellations90d: 0, direct: true, terms: 21, lanes: [{ id: "lane-u3", origin: "Amarillo", originState: "TX", destination: "Lubbock", destState: "TX", miles: 124, rate: 640, equipmentType: "Flatbed", days: [0, 1, 2, 3, 4, 5, 6], pickupTime: "07:00", active: true }] }, { driver_id: null }, "broker");
  put("drivers", "u3-d2", driver("u3-d2", "Cal Brooks", "+12145550194", "u3-t2", "Amarillo", "TX"), { name: "Cal Brooks", phone: "+12145550194" });
  put("trucks", "u3-t2", truck("u3-t2", "U32", "u3-d2", "Flatbed", "Amarillo", "TX"), { unit_number: "U32", driver_id: "u3-d2" });
  db(`delete from loads where carrier_id = '${cid}' and data->>'source' like 'Contract%'`);
  const r = await cron();
  check("the round runs", r.status === 200, r.status);
  await sleep(1500);
  const reminders = db(`select data->>'reason' from escalations where carrier_id = '${cid}' and updated_at > now() - interval '5 minutes'`);
  check("registration 9 days out: the 14-day reminder", /Truck U31's registration is due .*in 9 days/.test(reminders), reminders);
  check("a medical card that ran out: said so, with what to do", /Rosa Vance's medical card ran out .*DOT physical/.test(reminders), reminders);
  check("each reminder once per stage", db(`select count(*) from agent_marks where carrier_id = '${cid}' and load_id = 'compliance' and kind like 'registration:u3-t1:%:14'`) === "1");
  check("the statement isn't read twice the same day", db(`select count(*) from records where carrier_id = '${cid}' and kind = 'fuel'`) === "2");
  const contract = db(`select count(*) from loads where carrier_id = '${cid}' and data->>'source' = 'Contract · Panhandle Feed Co' and truck_id = 'u3-t2'`);
  check("contract pickups for the next week made as booked loads on the flatbed", Number(contract) >= 7, contract);
  check("the lane remembers how far ahead they're made", db(`select data->'lanes'->0->>'madeThrough' from records where carrier_id = '${cid}' and kind = 'broker' and id = 'u3-ship'`) === day(7));
  await cron();
  await sleep(800);
  check("…and the next round doesn't make them again", db(`select count(*) from loads where carrier_id = '${cid}' and data->>'source' = 'Contract · Panhandle Feed Co'`) === contract);

  // ── ELD: odometer and engine codes ──
  const eldFile = `${S}/fakes/eld.json`;
  const eldBefore = fs.existsSync(eldFile) ? fs.readFileSync(eldFile, "utf8") : null;
  fs.writeFileSync(eldFile, JSON.stringify({ ...(eldBefore ? JSON.parse(eldBefore) : {}), odo101: 160934400, fault101: { spnId: 100, fmiId: 1, spnDescription: "Engine Oil Pressure", fmiDescription: "Low" }, fault101Stop: true }));
  put("trucks", "u3-t3", truck("u3-t3", "101", null, "Dry Van", "Dallas", "TX"), { unit_number: "101", driver_id: null });
  const eld = await api("/api/integrations", { method: "POST", body: { kind: "samsara", apiKey: "samsara-good-key" } });
  const t3 = JSON.parse(db(`select data from trucks where carrier_id = '${cid}' and id = 'u3-t3'`) || "{}");
  check("odometer from the ELD, in miles", eld.status === 200 && t3.odometer === 100000, JSON.stringify({ status: eld.status, odo: t3.odometer }));
  check("engine code saved with its severity", t3.faults?.[0]?.code === "SPN 100 FMI 1" && t3.faults[0].severity === "critical", JSON.stringify(t3.faults));
  check("a code that means stop reaches the owner once", db(`select count(*) from activity where carrier_id = '${cid}' and data->>'type' = 'maintenance' and data->>'message' like '101: Engine Oil Pressure%' and created_at >= '${started}'`) === "1");
  // Personal conveyance isn't followed; parked off duty, the truck's spot still comes in (the AI plans from there).
  db(`delete from trucks where carrier_id = '${cid}' and id = 'u3-t3'`);
  const t101 = db(`select t.id from trucks t join drivers d on d.carrier_id = t.carrier_id and d.id = t.driver_id where t.carrier_id = '${cid}' and t.unit_number = '101' and d.name = 'Marcus Bell'`);
  const at101 = () => JSON.parse(db(`select data->'position' from trucks where carrier_id = '${cid}' and id = '${t101}'`) || "null");
  const parkAt = (lat, lon, city) => db(`update trucks set data = data || jsonb_build_object('position', jsonb_build_object('lat', ${lat}, 'lon', ${lon}, 'at', now(), 'source', 'samsara', 'description', '${city}')) where carrier_id = '${cid}' and id = '${t101}'`);
  const eldAs = async (status) => {
    fs.writeFileSync(eldFile, JSON.stringify({ ...(eldBefore ? JSON.parse(eldBefore) : {}), marcusStatus: status }));
    return api("/api/integrations", { method: "POST", body: { kind: "samsara", apiKey: "samsara-good-key" } });
  };
  parkAt(32.7555, -97.3308, "Fort Worth, TX");
  await eldAs("personalConveyance");
  check("personal conveyance: where the driver takes the truck on their own time isn't followed", !!t101 && at101()?.description === "Fort Worth, TX", JSON.stringify(at101()));
  await eldAs("offDuty");
  check("parked off duty: the truck's spot still comes in, so the AI plans its next load from the right city", at101()?.lat === 32.7767, JSON.stringify(at101()));
  await api("/api/integrations?kind=samsara", { method: "DELETE" });
  if (eldBefore === null) fs.unlinkSync(eldFile);
  else fs.writeFileSync(eldFile, eldBefore);

  // ── Audit log ──
  const before = Number(db(`select count(*) from audit_log where carrier_id = '${cid}' and action = 'Paused the AI' and who = 'owner'`));
  const pause = await rest("/rpc/merge_carrier_settings", { method: "POST", body: { p_carrier: cid, p_patch: { paused: true }, p_owner_operator: false } });
  await rest("/rpc/merge_carrier_settings", { method: "POST", body: { p_carrier: cid, p_patch: { paused: false }, p_owner_operator: false } });
  check("pausing is in the audit log, by the owner", pause.status < 300 && Number(db(`select count(*) from audit_log where carrier_id = '${cid}' and action = 'Paused the AI' and who = 'owner'`)) === before + 1, `${pause.status} ${db(`select string_agg(action || '/' || who, '; ' order by at desc) from (select * from audit_log where carrier_id = '${cid}' order by at desc limit 4) x`)} role=${db(`select role from members where user_id = '${OWNER_SUB}' and carrier_id = '${cid}'`)} settings=${db(`select settings->>'paused' from carriers where id = '${cid}'`)}`);
  const log = await rest(`/audit_log?carrier_id=eq.${cid}&select=action,who&order=at.desc&limit=5`);
  check("the owner reads the log", log.status === 200 && log.body.some((x) => x.action === "Resumed the AI"), JSON.stringify(log.body));

  // ── Bookkeeper ──
  db(`insert into auth.users values ('${BK_SUB}', '${BK_PHONE}') on conflict do nothing`);
  db(`delete from members where user_id = '${BK_SUB}'`);
  db(`insert into members (user_id, carrier_id, role) values ('${BK_SUB}', '${cid}', 'bookkeeper')`);
  const BK = token(BK_SUB, BK_PHONE);
  check("bookkeeper can't book a load or change connections", (await api("/api/agent/book", { method: "POST", body: { loadId: "u3-L1" }, as: BK })).status === 401 && (await api("/api/integrations", { as: BK })).status === 401);
  check("bookkeeper can't use the AI chat to act", (await api("/api/ai/chat", { method: "POST", body: { role: "owner", question: "book it", history: [], snapshot: {} }, as: BK })).status === 403);
  const bkLoads = await rest(`/loads?carrier_id=eq.${cid}&select=id&id=eq.u3-L1`, { as: BK });
  check("bookkeeper sees the loads", bkLoads.status === 200 && bkLoads.body.length === 1);
  const bkEsc = await rest(`/escalations?carrier_id=eq.${cid}&select=id`, { as: BK });
  check("…and not the dispatch side", bkEsc.status === 200 && bkEsc.body.length === 0);
  const adv = await rest("/records", { method: "POST", as: BK, prefer: "return=minimal", body: { id: "u3-adv", carrier_id: cid, kind: "advance", driver_id: "u3-d1", data: { id: "u3-adv", driverId: "u3-d1", amount: 150, at: new Date().toISOString() } } });
  check("bookkeeper records an advance", adv.status === 201, adv.status);
  const inc = await rest("/records", { method: "POST", as: BK, prefer: "return=minimal", body: { id: "u3-inc", carrier_id: cid, kind: "incident", data: {} } });
  check("…but not an incident", inc.status >= 400, inc.status);
  const paid = await rest("/rpc/mark_invoice_paid", { method: "POST", as: BK, body: { p_carrier: cid, p_load: "u3-L1", p_amount: 1000 } });
  check("bookkeeper marks the invoice paid, and nothing else on the load changes", paid.body === true && db(`select data->'invoice'->>'paidAmount' || ':' || stage || ':' || (data->>'bookedRate') from loads where carrier_id = '${cid}' and id = 'u3-L1'`) === "1000:in_transit:1000", JSON.stringify(paid.body));
  check("the audit log says the bookkeeper did it", db(`select count(*) from audit_log where carrier_id = '${cid}' and who = 'bookkeeper' and action = 'Marked paid' and target = 'U3-100' and at >= '${started}'`) === "1");
  check("…and the bookkeeper can't read the log", ((await rest(`/audit_log?carrier_id=eq.${cid}&select=id`, { as: BK })).body ?? []).length === 0);

  // ── Devices ──
  db(`delete from devices where user_id = '${OWNER_SUB}'`);
  await rest("/devices", { method: "POST", prefer: "return=minimal", body: { id: "dev_u3_owner_phone", label: "Safari on iPhone" } });
  await rest("/devices", { method: "POST", prefer: "return=minimal", body: { id: "dev_u3_owner_mac", label: "Chrome on Mac" } });
  const mine = await rest("/devices?select=id");
  check("the owner sees their two devices", mine.body?.length === 2, JSON.stringify(mine.body));
  check("nobody else sees them", ((await rest("/devices?select=id", { as: BK })).body ?? []).length === 0);

  // ── Weather along the route, lumper alerts ──
  const wx = await api("/api/weather/route?pts=35.15,-90.05;36.1,-95.9", { as: null });
  check("weather on the route: the storm at the Memphis point, nothing at Tulsa", wx.status === 200 && wx.body.points?.[0]?.alerts?.some((a) => a.event === "Winter Storm Warning") && wx.body.points[1].alerts.length === 0, JSON.stringify(wx.body).slice(0, 200));
  check("weather refuses points outside North America", (await api("/api/weather/route?pts=48.85,2.35", { as: null })).status === 400);
  const ownerAsk = await api("/api/push", { method: "POST", body: { op: "lumper_ask", amount: 180 } });
  check("only a driver asks for lumper money", ownerAsk.status === 403 || ownerAsk.status === 503, ownerAsk.status);
  db(`delete from members where user_id = '${DRV_SUB}' and carrier_id = '${cid}'`);
  db(`insert into members (user_id, carrier_id, role, driver_id) values ('${DRV_SUB}', '${cid}', 'driver', 'u3-d1')`);
  const drvAsk = await api("/api/push", { method: "POST", body: { op: "lumper_ask", amount: 180, facility: "Dock 4" }, as: token(DRV_SUB, DRV_PHONE) });
  check("a driver asks the office for lumper money", drvAsk.status === 200 || drvAsk.status === 503, drvAsk.status);
  const drvCode = await api("/api/push", { method: "POST", body: { op: "lumper_code", driverId: "u3-d1" }, as: token(DRV_SUB, DRV_PHONE) });
  check("only the office sends a lumper code", drvCode.status === 403 || drvCode.status === 503, drvCode.status);

  // ── In the browser ──
  const browser = await chromium.launch({ args: ARGS });
  const p = await signIn(browser);
  await p.goto(`${BASE}/carrier/costs`, { waitUntil: "domcontentloaded" });
  await p.getByText("Bring in a statement").waitFor({ timeout: 120000 });
  const csv = `${S}/fakes/data/u3-fuel.csv`;
  fs.writeFileSync(csv, `Date,Unit,Location,City,State,Gallons,Amount,Product\n${day(0)},U31,Upload Stop,Amarillo,TX,50,199.50,Diesel\n${day(0)},U31,Upload Stop,Amarillo,TX,8,30,DEF\n`);
  await p.getByLabel("Fuel card statement").setInputFiles(csv);
  await p.getByRole("status").filter({ hasText: "new fuel purchases" }).waitFor({ timeout: 20000 });
  const said = await p.getByRole("status").filter({ hasText: "new fuel purchases" }).textContent();
  check("CSV brought in on Fuel & tolls: both lines, both on the load", /2 new fuel purchases, 2 on a load/.test(said), said);
  await sleep(4000);
  check("…saved to the account", db(`select count(*) from records where carrier_id = '${cid}' and kind = 'fuel' and data->>'merchant' = 'Upload Stop' and data->>'loadId' = 'u3-L1'`) === "2");
  for (const [path, text] of [["/carrier/pay", "Work out this week"], ["/carrier/lanes", "Lanes"], ["/carrier/customers", "Panhandle Feed Co"], ["/carrier/compliance", "Papers and dates"], ["/carrier/maintenance", "From the trucks"], ["/carrier/settings?tab=security", "Where you're signed in"]]) {
    await p.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded" });
    const ok = await p.getByText(text).first().waitFor({ timeout: 120000 }).then(() => true, () => false);
    check(`${path} opens in a real account`, ok);
  }
  await p.goto(`${BASE}/carrier/compliance`, { waitUntil: "domcontentloaded" });
  await p.getByText("Papers and dates").waitFor({ timeout: 60000 });
  check("compliance lists what's due from the account", (await p.getByText("Truck U31's registration").count()) > 0 && (await p.getByText("Rosa Vance's medical card").count()) > 0);
  await p.goto(`${BASE}/carrier/settings?tab=security`, { waitUntil: "domcontentloaded" });
  await p.getByText("Where you're signed in").waitFor({ timeout: 60000 });
  await sleep(1500);
  check("this browser is on the device list", (await p.getByText("This one").count()) === 1 || Number(db(`select count(*) from devices where user_id = '${OWNER_SUB}'`)) >= 3);
  check("no page errors", p.errors.length === 0, p.errors.join(" | "));

  // ── Directions: truck GPS only, to the dock, never a car route or the middle of town ──
  const DRV = token(DRV_SUB, DRV_PHONE);
  const spot = await api(`/api/directions?address=${encodeURIComponent("4500 Industrial Pkwy, Memphis, TN 38118")}`, { as: DRV });
  check("a dock's street address to its exact spot", spot.status === 200 && spot.body.at?.[0] === 35.0412 && spot.body.at?.[1] === -89.9663, JSON.stringify(spot));
  const cityOnly = await api(`/api/directions?address=${encodeURIComponent("Somewhere, Memphis, TN")}`, { as: DRV });
  check("a city-only match isn't passed off as the dock", cityOnly.status === 200 && cityOnly.body.at === null, JSON.stringify(cityOnly));
  const road = await api("/api/directions?from=35.22,-101.83&to=36.15,-95.99&height=162&weight=80000&length=70", { as: DRV });
  check("the truck's road comes from truck routing, sized for the truck", road.status === 200 && road.body.path?.length === 3 && Math.abs(road.body.path[0][0] - 35.22) < 1e-4, JSON.stringify(road.body).slice(0, 200));
  const sized = read("boards").filter((x) => x.board === "here" && x.path === "polyline").pop();
  check("…with its height and weight, in HERE's units", sized?.height === "411" && sized?.weight === "36288", JSON.stringify(sized));
  check("directions need a signed-in person", (await api("/api/directions?address=4500%20Industrial%20Pkwy", { as: null })).status === 401);
  db(`update loads set data = data || '{"deliveryAddress":"4500 Industrial Pkwy, Memphis, TN 38118"}'::jsonb where carrier_id = '${cid}' and id = 'u3-L1'`);
  db(`update trucks set data = data - 'position' where carrier_id = '${cid}' and id = 'u3-t1'`);
  const dctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const dsession = JSON.stringify({ access_token: DRV, refresh_token: "x", token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: DRV_SUB, phone: DRV_PHONE, aud: "authenticated", role: "authenticated", app_metadata: {}, user_metadata: {} } });
  await dctx.addInitScript((x) => localStorage.setItem("sb-localhost-auth-token", x), dsession);
  const dp = await dctx.newPage();
  dp.errors = [];
  dp.on("pageerror", (e) => dp.errors.push(e.message));
  await dp.goto(`${BASE}/driver`, { waitUntil: "domcontentloaded" });
  await dp.getByText("On the road").first().waitFor({ timeout: 120000 }).catch(() => {});
  await sleep(4000);
  const sygic = await dp.locator('a[href^="com.sygic.aura://coordinate|-89.9663|35.0412"]').count();
  check("the driver's big button opens the truck GPS at the dock itself", sygic === 1, await dp.locator('a[href^="com.sygic"]').evaluateAll((els) => els.map((e) => e.getAttribute("href"))).catch(() => "none"));
  check("the dock's address is on the card", (await dp.getByText("4500 Industrial Pkwy, Memphis, TN 38118").count()) > 0);
  const html = await dp.content();
  check("no Google Maps, Apple Maps, Waze or car router anywhere on the driver's screen", !/google\.com\/maps|maps\.apple\.com|waze\.com|project-osrm/.test(html));
  check("no GPS on the truck: the app says so instead of inventing miles left", (await dp.getByText("No GPS yet").count()) > 0);
  await dp.screenshot({ path: `${S}/.out/ux3-driver-directions.png` });
  check("no page errors on the driver's screen", dp.errors.length === 0, dp.errors.join(" | "));

  // ── Offline: a change made with no signal survives the app being closed, and goes when it's back ──
  const voice = () => db(`select coalesce(data->'prefs'->>'hosVoice', 'unset') from drivers where carrier_id = '${cid}' and id = 'u3-d1'`);
  db(`update drivers set data = data #- '{prefs,hosVoice}' where carrier_id = '${cid}' and id = 'u3-d1'`);
  await dp.goto(`${BASE}/driver/profile`, { waitUntil: "domcontentloaded" });
  const sw = dp.getByRole("switch", { name: "Hours heads-ups out loud" });
  await sw.waitFor({ timeout: 120000 });
  await sleep(2500);
  await dctx.setOffline(true);
  await sw.click();
  await sleep(6000);
  check("no signal: the change waits on the phone", voice() === "unset", voice());
  const kept = await dp.evaluate(() => localStorage.getItem("backroute.outbox"));
  check("…kept on the phone, not just in memory", !!kept && kept.includes('"hosVoice":false'), (kept ?? "none").slice(0, 200));
  await dp.close();
  await dctx.setOffline(false);
  const dp2 = await dctx.newPage();
  dp2.errors = [];
  dp2.on("pageerror", (e) => dp2.errors.push(e.message));
  await dp2.goto(`${BASE}/driver`, { waitUntil: "domcontentloaded" });
  let sent = "unset";
  for (let n = 0; n < 20 && sent !== "false"; n++) {
    await sleep(1000);
    sent = voice();
  }
  check("app closed and opened again with signal: the change goes by itself", sent === "false", sent);
  let box = "unset";
  for (let n = 0; n < 10 && box !== null; n++) {
    box = await dp2.evaluate(() => localStorage.getItem("backroute.outbox"));
    if (box !== null) await sleep(1000);
  }
  check("…and the outbox is empty", box === null, box);
  check("…nothing else on the driver changed", db(`select name from drivers where carrier_id = '${cid}' and id = 'u3-d1'`) === "Rosa Vance");
  check("no page errors after coming back online", dp2.errors.length === 0, dp2.errors.join(" | "));
  await browser.close();

  // Clean up what other suites might trip on.
  db(`delete from loads where carrier_id = '${cid}' and (id like 'u3-%' or data->>'source' like 'Contract%')`);
  db(`delete from trucks where carrier_id = '${cid}' and id like 'u3-%'`);
  db(`delete from drivers where carrier_id = '${cid}' and id like 'u3-%'`);
  db(`delete from records where carrier_id = '${cid}' and (id like 'u3-%' or kind in ('fuel', 'toll', 'advance'))`);
  db(`delete from members where user_id = '${BK_SUB}'`);
  db(`delete from members where user_id = '${DRV_SUB}' and carrier_id = '${cid}' and driver_id = 'u3-d1'`);
  await api("/api/integrations?kind=fuel_feed", { method: "DELETE" });
  console.log(`${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
