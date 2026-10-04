// Round 4, end to end against the stand-ins: parking booked only when asked (the driver's button, never a round of
// the AI), late trucks seen early (traffic on the road, a truck stopped where it shouldn't be), and QuickBooks Online
// connected and kept in step (invoices, payments, costs; once each), plus the settings card in the browser.
const path = require("path");
const S = path.join(__dirname, "..");
const ROOT = path.join(__dirname, "../..");
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
const DRV_SUB = "dddddddd-0000-0000-0000-000000000004", DRV_PHONE = "12145550194";
const api = (path, { method = "GET", body, as = OWNER, redirect = "follow" } = {}) =>
  fetch(`${BASE}${path}`, { method, redirect, headers: { ...(as ? { authorization: `Bearer ${as}` } : {}), ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined }).then(async (r) => ({ status: r.status, location: r.headers.get("location"), body: await r.json().catch(() => ({})) }));
function put(table, id, data, cols, kind) {
  db(`delete from ${table} where carrier_id = '${cid}' and id = '${id}'${kind ? ` and kind = '${kind}'` : ""}`);
  db(`insert into ${table} (id, carrier_id, ${kind ? "kind, " : ""}${Object.keys(cols).join(", ")}${Object.keys(cols).length ? ", " : ""}data) values ('${id}', '${cid}', ${kind ? `'${kind}', ` : ""}${Object.values(cols).map((v) => (v === null ? "null" : `'${v}'`)).join(", ")}${Object.keys(cols).length ? ", " : ""}'${JSON.stringify(data).replace(/'/g, "''")}'::jsonb)`);
}
const iso = (h) => new Date(Date.now() + h * 3600000).toISOString();
const truck = (id, unit, driverId, city, state, extra = {}) => ({ id, unitNumber: unit, driverId, carrierId: "carrier-titan", equipmentType: "Dry Van", status: "on_load", currentCity: city, currentState: state, homeBase: `${city}, ${state}`, currentLoadId: null, nextLoadId: null, mpg: 6.5, odometer: 100000, lastServiceMiles: 90000, serviceIntervalMiles: 25000, nextInspectionDue: iso(24 * 300), ...extra });
const driver = (id, name, phone, truckId, extra = {}) => ({ id, name, phone, email: "", truckId, carrierId: "carrier-titan", hosStatus: "driving", hoursRemaining: 9, cdl: "", rating: 5, hireDate: iso(-24 * 400), homeBase: "Dallas, TX", runType: "regional", homeTimeTarget: "Flexible", payType: "percentage", payRate: 0.28, prefs: { language: "en" }, ...extra });
const load = (id, ref, truckId, lane, extra = {}) => ({ id, referenceNumber: ref, stage: "in_transit", carrierId: "carrier-titan", truckId, brokerId: "u4-b1", brokerContactEmail: "ops@lanebroker.test", source: "test", lane, equipmentType: "Dry Van", weight: 30000, pickupWindow: "today", deliveryWindow: "today", pickupAt: iso(-4), deliveryAt: iso(10), listedRate: 1500, targetRate: 1500, bookedRate: 1500, deadheadMiles: 0, fuelCost: 200, tollCost: 0, deadheadCost: 0, commission: 0, netProfit: 1100, rpm: 2.4, score: 80, messages: [], calls: [], documents: [], createdAt: iso(-30), updatedAt: iso(0), ...extra });
const cron = () => fetch(`${BASE}/api/cron/dispatch`, { headers: { authorization: "Bearer cron-secret" } });
const truckData = (id) => JSON.parse(db(`select data from trucks where carrier_id = '${cid}' and id = '${id}'`) || "{}");
const loadData = (id) => JSON.parse(db(`select data from loads where carrier_id = '${cid}' and id = '${id}'`) || "{}");

(async () => {
  db(`update carriers set settings = settings || '{"autonomy":"rules","sandbox":false,"paused":false}'::jsonb where id = '${cid}'`);
  db(`delete from records where carrier_id = '${cid}' and kind = 'broker' and id = 'u4-b1'`);
  db(`insert into records (id, carrier_id, kind, data) values ('u4-b1', '${cid}', 'broker', '${JSON.stringify({ id: "u4-b1", company: "Lane Broker Co", email: "ops@lanebroker.test", mc: "771234", carrierId: "carrier-titan" })}'::jsonb)`);

  // ── Parking: only when someone asks ─────────────────────────────────────────
  // A driver with three hours left on the clock, 420 miles from the receiver: their hours run out on the way.
  put("drivers", "u4-d1", driver("u4-d1", "Nia Brooks", "+12145550194", "u4-t1", { hos: { drive: 3, shift: 4, cycle: 30, at: iso(0), source: "samsara" }, hoursRemaining: 3 }), { name: "Nia Brooks", phone: "+12145550194" });
  put("trucks", "u4-t1", truck("u4-t1", "U41", "u4-d1", "Dallas", "TX", { currentLoadId: "u4-L1", position: { lat: 32.7767, lon: -96.797, at: iso(0), source: "samsara", description: "I-30, Dallas, TX" } }), { unit_number: "U41", driver_id: "u4-d1" });
  put("loads", "u4-L1", load("u4-L1", "U4-100", "u4-t1", { origin: "Dallas", originState: "TX", destination: "Memphis", destState: "TN", miles: 452 }, { deliveryAt: iso(30) }), { truck_id: "u4-t1", stage: "in_transit" });
  db(`insert into auth.users values ('${DRV_SUB}', '${DRV_PHONE}') on conflict do nothing`);
  db(`delete from members where user_id = '${DRV_SUB}'`);
  db(`insert into members (user_id, carrier_id, role, driver_id) values ('${DRV_SUB}', '${cid}', 'driver', 'u4-d1')`);
  const DRV = token(DRV_SUB, DRV_PHONE);
  const park0 = read("parking").length;
  await cron();
  check("a dispatch round never reserves parking on its own", !read("parking").slice(park0).some((x) => x.kind === "reserve") && !truckData("u4-t1").parking, JSON.stringify(read("parking").slice(park0)));
  let r = await api("/api/parking", { as: DRV });
  check("the driver asks for spots: ones near where their hours run out", r.status === 200 && r.body.spots?.length === 2 && r.body.spots[0].id === "P-1" && /hours run out/.test(r.body.where ?? ""), JSON.stringify(r.body));
  const searched = read("parking").slice(park0).find((x) => x.kind === "search");
  check("...searched ahead on the road, not where the truck is now", !!searched && searched.lon > -96.5 && searched.lon < -90, JSON.stringify(searched));
  r = await api("/api/parking", { method: "POST", as: DRV, body: { spotId: "P-NOPE" } });
  check("a spot the service didn't offer can't be booked (price and place come from the service)", r.status === 409 && r.body.error === "gone");
  r = await api("/api/parking", { method: "POST", as: DRV, body: { spotId: "P-1" } });
  const booked = truckData("u4-t1").parking;
  const reserve = read("parking").slice(park0).find((x) => x.kind === "reserve");
  check("the driver taps Book: reserved, saved on the truck, with the confirmation and the way in", r.status === 200 && booked?.status === "booked" && booked.confirmation === "TPC-7781" && booked.askedBy === "driver" && /Gate code 4412/.test(booked.checkIn ?? ""), JSON.stringify(r.body));
  check("...under the driver's name, the truck's unit and the company", reserve?.driverName === "Nia Brooks" && reserve?.unitNumber === "U41" && !!reserve?.company, JSON.stringify(reserve));
  check("...and the owner sees it, with who asked", db(`select count(*) from activity where carrier_id = '${cid}' and data->>'message' = 'Parking reserved for U41' and data->>'detail' like '%Nia asked%'`) !== "0");
  r = await api("/api/parking", { method: "POST", as: DRV, body: { spotId: "P-2" } });
  check("a second booking the same night is refused", r.status === 409 && r.body.error === "already_booked");
  const bk = token(BK_SUB, BK_PHONE);
  r = await api("/api/parking", { as: bk });
  check("the bookkeeper can't book parking", r.status === 403 || r.status === 401);
  r = await api("/api/parking", { method: "DELETE", as: DRV });
  check("the driver cancels it", r.status === 200 && truckData("u4-t1").parking?.status === "cancelled" && read("parking").slice(park0).some((x) => x.kind === "cancel" && x.id === "R-P-1"));
  r = await api("/api/parking?truck=u4-t1", { method: "POST", as: OWNER, body: { spotId: "P-2", truck: "u4-t1" } });
  const tw = read("twilio");
  check("the owner books for a truck: the driver gets the address and confirmation by text", r.status === 200 && truckData("u4-t1").parking?.askedBy === "owner" && tw.slice(-3).some((x) => x.params?.To === "+12145550194" && /Parking reserved: Big Rig Lot, 900 Frontage Rd\. Confirmation TPC-7781/.test(x.params.Body ?? "")), JSON.stringify(tw.slice(-2).map((x) => x.params?.Body)));
  await api("/api/parking?truck=u4-t1", { method: "DELETE", as: OWNER });

  // ── Late trucks, early ──────────────────────────────────────────────────────
  // Into Houston in a jam: 5 hours of road becomes 7. The appointment is in 6.
  put("drivers", "u4-d2", driver("u4-d2", "Omar Reyes", "+12145550195", "u4-t2", { hos: { drive: 10, shift: 12, cycle: 50, at: iso(0), source: "samsara" } }), { name: "Omar Reyes", phone: "+12145550195" });
  put("trucks", "u4-t2", truck("u4-t2", "U42", "u4-d2", "Dallas", "TX", { currentLoadId: "u4-L2", position: { lat: 32.7767, lon: -96.797, at: iso(0), source: "samsara", description: "I-45, Dallas, TX" } }), { unit_number: "U42", driver_id: "u4-d2" });
  put("loads", "u4-L2", load("u4-L2", "U4-200", "u4-t2", { origin: "Dallas", originState: "TX", destination: "Houston", destState: "TX", miles: 240 }, { deliveryAt: iso(6) }), { truck_id: "u4-t2", stage: "in_transit" });
  // A truck sitting two hours on the shoulder near Waco, driver on duty, on its way to Memphis.
  put("drivers", "u4-d3", driver("u4-d3", "Lena Park", "+12145550196", "u4-t3", { hosStatus: "on_duty" }), { name: "Lena Park", phone: "+12145550196" });
  // Lena agreed to texts already (the first text and her YES happened long ago).
  db(`insert into driver_consents (carrier_id, driver_id, phone, granted, via, wording, version) values ('${cid}', 'u4-d3', '+12145550196', true, 'sms', 'Texted "yes" to the first text', '2026-10-01')`);
  put("trucks", "u4-t3", truck("u4-t3", "U43", "u4-d3", "Waco", "TX", { currentLoadId: "u4-L3", stoppedSince: iso(-2), position: { lat: 31.7, lon: -97.1, at: iso(0), source: "samsara", description: "I-35 MM 340, Waco, TX" } }), { unit_number: "U43", driver_id: "u4-d3" });
  put("loads", "u4-L3", load("u4-L3", "U4-300", "u4-t3", { origin: "Austin", originState: "TX", destination: "Memphis", destState: "TN", miles: 560 }, { deliveryAt: iso(40) }), { truck_id: "u4-t3", stage: "in_transit" });
  db(`delete from agent_marks where carrier_id = '${cid}' and load_id in ('u4-L1', 'u4-L2', 'u4-L3')`);
  const tw0 = read("twilio").length;
  await cron();
  const l2 = loadData("u4-L2");
  check("traffic on the road makes the truck late: the owner hears why, before the appointment", l2.late?.stop === "delivery" && (l2.why?.lines ?? []).some((l) => /^Running late to the delivery in Houston, TX: new arrival about .*\(traffic adds 2(\.\d)? h\)/.test(l)), JSON.stringify(l2.why?.lines));
  const nudge = read("twilio").slice(tw0).find((x) => x.params?.To === "+12145550196" && /stopped/.test(x.params.Body ?? ""));
  check("a truck stopped two hours off its stops: the driver gets an 'everything OK?' text", !!nudge && /stopped about 2 hours near I-35 MM 340, Waco, TX\. Everything OK\?/.test(nudge.params.Body ?? ""), nudge?.params?.Body);
  check("...and the owner sees it", db(`select count(*) from activity where carrier_id = '${cid}' and data->>'message' like 'Truck U43 stopped 2 hours%'`) !== "0");
  const tw1 = read("twilio").length;
  await cron();
  check("...once per stop, not every round", !read("twilio").slice(tw1).some((x) => x.params?.To === "+12145550196"));
  check("parking still never booked by a round", !truckData("u4-t1").parking || truckData("u4-t1").parking.status === "cancelled");

  // ── QuickBooks Online ───────────────────────────────────────────────────────
  r = await api("/api/integrations/quickbooks/callback?state=bad.sig&code=good-code&realmId=4620816365", { as: null, redirect: "manual" });
  check("Intuit's return with a forged note is refused", r.status === 303 && /quickbooks=expired/.test(r.location ?? ""));
  r = await api("/api/integrations/quickbooks", { method: "POST", as: bk });
  check("only the owner can connect the books", r.status === 401);
  r = await api("/api/integrations/quickbooks", { method: "POST" });
  const start = new URL(r.body.url ?? "http://x/");
  check("the owner starts connecting: Intuit's page, Backroute's app, accounting only, back to Backroute", r.status === 200 && start.origin === "http://localhost:3009" && start.searchParams.get("client_id") === "qbo-id" && start.searchParams.get("scope") === "com.intuit.quickbooks.accounting" && start.searchParams.get("redirect_uri") === "http://localhost:3210/api/integrations/quickbooks/callback", r.body.url);
  r = await api(`/api/integrations/quickbooks/callback?state=${encodeURIComponent(start.searchParams.get("state"))}&code=good-code&realmId=4620816365`, { as: null, redirect: "manual" });
  const row = JSON.parse(db(`select row_to_json(x) from (select config, status from carrier_integrations where carrier_id = '${cid}' and kind = 'quickbooks') x`) || "{}");
  check("back from Intuit: connected to the company", r.status === 303 && /quickbooks=connected/.test(r.location ?? "") && row.config?.realmId === "4620816365" && row.config?.companyName === "Lone Star Freight LLC", JSON.stringify(row).slice(0, 300));
  check("...its sign-in kept encrypted, never as written", /^v1\./.test(row.config?.refresh ?? "") && !JSON.stringify(row).includes("qbo-refresh"));
  const listed = JSON.stringify((await api("/api/integrations")).body);
  check("the connections list shows the company, never the sign-in", listed.includes("Lone Star Freight LLC") && !listed.includes("v1.") && !listed.includes("qbo-"));

  // Something for the books: an invoice the broker paid, one still open, a fuel purchase, a toll, a lumper the owner approved.
  put("loads", "u4-L4", load("u4-L4", "U4-400", "u4-t1", { origin: "Dallas", originState: "TX", destination: "Memphis", destState: "TN", miles: 452 }, { stage: "delivered", invoice: { number: "INV-U4-400", amount: 1650, lines: [{ label: "Line haul", amount: 1500 }, { label: "Detention, 2 h", amount: 150 }], draftedAt: iso(-48), sentAt: iso(-47), paidAt: iso(-2), paidAmount: 1650 } }), { truck_id: "u4-t1", stage: "delivered" });
  put("loads", "u4-L5", load("u4-L5", "U4-500", "u4-t1", { origin: "Memphis", originState: "TN", destination: "Dallas", destState: "TX", miles: 452 }, { stage: "delivered", invoice: { number: "INV-U4-500", amount: 1400, draftedAt: iso(-20), sentAt: iso(-19) } }), { truck_id: "u4-t1", stage: "delivered" });
  db(`delete from records where carrier_id = '${cid}' and id in ('u4-f1', 'u4-x1', 'u4-e1', 'u4-e2')`);
  const rec = (id, kind, data) => db(`insert into records (id, carrier_id, kind, data) values ('${id}', '${cid}', '${kind}', '${JSON.stringify(data).replace(/'/g, "''")}'::jsonb)`);
  rec("u4-f1", "fuel", { id: "u4-f1", carrierId: cid, date: iso(-30).slice(0, 10), truckId: "u4-t1", unit: "U41", merchant: "Pilot #123", city: "Texarkana", state: "AR", gallons: 120.5, amount: 470.15, product: "diesel", loadId: "u4-L4", importedAt: iso(-29) });
  rec("u4-x1", "toll", { id: "u4-x1", carrierId: cid, date: iso(-30).slice(0, 10), truckId: "u4-t1", unit: "U41", agency: "NTTA", plaza: "Main Lane 7", state: "TX", amount: 18.4, loadId: "u4-L4", importedAt: iso(-29) });
  rec("u4-e1", "expense", { id: "u4-e1", driverId: "u4-d1", carrierId: cid, loadId: "u4-L4", category: "lumper", amount: 225, note: "", status: "approved", createdAt: iso(-40), respondedAt: iso(-39), facility: "Delta Cold Storage" });
  rec("u4-e2", "expense", { id: "u4-e2", driverId: "u4-d1", carrierId: cid, loadId: "u4-L4", category: "parking", amount: 30, note: "", status: "pending", createdAt: iso(-40) });
  const q0 = read("qbo").length;
  // The test company already has this run's other invoices waiting: up to 60 go in per run, so it takes a couple.
  const runs = [];
  for (let k = 0; k < 3; k++) {
    r = await api("/api/integrations/quickbooks", { method: "PUT" });
    runs.push(r.body);
    if (r.status !== 200 || r.body.invoices + r.body.payments + r.body.costs < 60) break;
  }
  const made = read("qbo").slice(q0).filter((x) => x.kind === "create");
  const of = (t) => made.filter((x) => x.type === t).map((x) => x.row);
  check("put in now, at most 60 a run: both invoices, the payment, and the three approved costs", runs.every((b) => b.ok && b.invoices + b.payments + b.costs <= 60) && of("Invoice").some((x) => x.DocNumber === "INV-U4-500") && of("Purchase").length >= 3, JSON.stringify(runs));
  const inv = of("Invoice").find((x) => x.DocNumber === "INV-U4-400");
  check("the invoice: the broker as the customer, one line per charge, due on the broker's terms", !!inv && inv.Line.length === 2 && inv.Line[1].Amount === 150 && /Detention, 2 h · U4-400 · Dallas, TX to Memphis, TN/.test(inv.Line[1].Description) && of("Customer").some((c) => c.DisplayName === "Lane Broker Co" && inv.CustomerRef.value === c.Id) && !!inv.DueDate, JSON.stringify(inv).slice(0, 300));
  const pay = of("Payment").find((p) => p.Line[0].LinkedTxn[0].TxnId === inv?.Id);
  check("the broker's payment, applied to that invoice", !!pay && pay.TotalAmt === 1650);
  const buys = of("Purchase");
  check("fuel, the toll and the lumper go in as costs, each to its own account", buys.some((b) => b.Line[0].Amount === 470.15 && /Diesel, 120.5 gal · Pilot #123/.test(b.Line[0].Description)) && buys.some((b) => b.Line[0].Amount === 18.4) && buys.some((b) => b.Line[0].Amount === 225 && /Lumper · Nia Brooks · Delta Cold Storage · load U4-400/.test(b.Line[0].Description)) && new Set(buys.map((b) => b.Line[0].AccountBasedExpenseLineDetail.AccountRef.value)).size === 3, JSON.stringify(buys.map((b) => b.Line[0].Description)));
  check("...paid from the company's bank account (no card account in these books)", buys.every((b) => b.AccountRef.value === "35" && b.PaymentType === "Cash"));
  check("a parking cost the owner hasn't approved stays out", !buys.some((b) => b.Line[0].Amount === 30));
  check("the freight item and expense accounts were set up once", of("Item").length === 1 && of("Account").length === 4, JSON.stringify(of("Account").map((a) => a.Name)));
  const q1 = read("qbo").length;
  r = await api("/api/integrations/quickbooks", { method: "PUT" });
  check("again: nothing goes in twice", r.status === 200 && r.body.invoices === 0 && r.body.payments === 0 && r.body.costs === 0 && !read("qbo").slice(q1).some((x) => x.kind === "create"), JSON.stringify(r.body));
  // The open invoice gets paid: the next sync puts in just the payment.
  const l5 = loadData("u4-L5");
  put("loads", "u4-L5", { ...l5, invoice: { ...l5.invoice, paidAt: iso(0) } }, { truck_id: "u4-t1", stage: "delivered" });
  const q2 = read("qbo").length;
  r = await api("/api/integrations/quickbooks", { method: "PUT" });
  check("a broker pays later: just the payment goes in", r.body.payments === 1 && r.body.invoices === 0 && read("qbo").slice(q2).filter((x) => x.kind === "create").map((x) => x.type).join() === "Payment", JSON.stringify(r.body));

  // In the browser: the card on Settings.
  const browser = await chromium.launch({ args: ARGS });
  const session = JSON.stringify({ access_token: OWNER, refresh_token: "x", token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: OWNER_SUB, phone: OWNER_PHONE, aud: "authenticated", role: "authenticated", app_metadata: {}, user_metadata: {} } });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.addInitScript((s) => localStorage.setItem("sb-localhost-auth-token", s), session);
  const p = await ctx.newPage();
  const errors = [];
  p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(`${BASE}/carrier/settings?tab=general&quickbooks=connected`, { waitUntil: "domcontentloaded" });
  await p.getByText("QuickBooks Online", { exact: true }).waitFor({ timeout: 120000 }).catch(() => {});
  await p.getByText(/Connected to Lone Star Freight LLC/).first().waitFor({ timeout: 30000 }).catch(() => {});
  const text = await p.locator("body").innerText();
  check("Settings shows QuickBooks connected, with what went in, and the note from Intuit's return", /Connected to Lone Star Freight LLC/.test(text) && /QuickBooks is connected/.test(text) && /Put in what.s new now/.test(text), text.match(/QuickBooks[\s\S]{0,300}/)?.[0]);
  await p.screenshot({ path: `${S}/.out/ux4-quickbooks.png` });
  check("no page errors", errors.length === 0, errors.join(" | "));
  await browser.close();

  r = await api("/api/integrations/quickbooks", { method: "DELETE" });
  check("disconnect: Intuit is told to forget the sign-in, and it's gone here", r.status === 200 && read("qbo").slice(-3).some((x) => x.kind === "revoke") && db(`select count(*) from carrier_integrations where carrier_id = '${cid}' and kind = 'quickbooks'`) === "0");

  console.log(`${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
