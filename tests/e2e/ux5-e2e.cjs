// Round 5, end to end against the stand-ins: several partial loads on one truck's trip (asked for from a broker's
// email, booked, run stop by stop, one cancelled, the rest dropped), parking that follows through (company expense,
// a reminder, cancelled with the load), the driver told when it's tight, and QuickBooks invoices updated and voided.
const path = require("path");
const S = path.join(__dirname, "..");
const ROOT = path.join(__dirname, "../..");
const fs = require("fs");
const { execSync } = require("child_process");
const { chromium } = require("playwright");
const BASE = "http://localhost:3210";
const ARGS = [`--proxy-server=${process.env.HTTPS_PROXY}`, "--proxy-bypass-list=localhost;127.0.0.1", "--enable-unsafe-swiftshader", "--use-angle=swiftshader", "--ignore-gpu-blocklist"];
let passed = 0, failed = 0;
const check = (label, ok, extra = "") => { ok ? passed++ : failed++; console.log(`${ok ? "PASS" : "FAIL"} ${label}${extra ? ` (${String(extra).slice(0, 500)})` : ""}`); };
const db = (q) => execSync(`su postgres -c "/usr/lib/postgresql/16/bin/psql -h /var/lib/postgresql/backroute-test -p 55432 -U postgres -d rest -tA -c \\"${q.replace(/"/g, '\\\\\\"').replace(/\$/g, () => "\\\\\\$")}\\""`).toString().trim();
const read = (f) => (fs.existsSync(`${S}/fakes/${f}.jsonl`) ? fs.readFileSync(`${S}/fakes/${f}.jsonl`, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const cid = fs.readFileSync(`${S}/fakes/carrier.txt`, "utf8").trim();
const token = (sub, phone) => execSync(`node ${S}/pgrst/jwt.cjs ${sub} ${phone}`).toString();
const OWNER_SUB = "aaaaaaaa-0000-0000-0000-000000000001", OWNER_PHONE = "12145550100";
const OWNER = token(OWNER_SUB, OWNER_PHONE);
const DRV_SUB = "dddddddd-0000-0000-0000-000000000004", DRV_PHONE = "12145550194";
const api = (path, { method = "GET", body, as = OWNER, redirect = "follow" } = {}) =>
  fetch(`${BASE}${path}`, { method, redirect, headers: { ...(as ? { authorization: `Bearer ${as}` } : {}), ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined }).then(async (r) => ({ status: r.status, location: r.headers.get("location"), body: await r.json().catch(() => ({})) }));
function put(table, id, data, cols, kind) {
  db(`delete from ${table} where carrier_id = '${cid}' and id = '${id}'${kind ? ` and kind = '${kind}'` : ""}`);
  db(`insert into ${table} (id, carrier_id, ${kind ? "kind, " : ""}${Object.keys(cols).join(", ")}${Object.keys(cols).length ? ", " : ""}data) values ('${id}', '${cid}', ${kind ? `'${kind}', ` : ""}${Object.values(cols).map((v) => (v === null ? "null" : `'${v}'`)).join(", ")}${Object.keys(cols).length ? ", " : ""}'${JSON.stringify(data).replace(/'/g, "''")}'::jsonb)`);
}
const iso = (h) => new Date(Date.now() + h * 3600000).toISOString();
const truck = (id, unit, driverId, city, state, extra = {}) => ({ id, unitNumber: unit, driverId, carrierId: "carrier-titan", equipmentType: "Dry Van", status: "on_load", currentCity: city, currentState: state, homeBase: `${city}, ${state}`, currentLoadId: null, nextLoadId: null, mpg: 6.5, odometer: 100000, lastServiceMiles: 90000, serviceIntervalMiles: 25000, nextInspectionDue: iso(24 * 300), ...extra });
const driver = (id, name, phone, truckId, extra = {}) => ({ id, name, phone, email: "", truckId, carrierId: "carrier-titan", hosStatus: "driving", hoursRemaining: 11, cdl: "", rating: 5, hireDate: iso(-24 * 400), homeBase: "Dallas, TX", runType: "regional", homeTimeTarget: "Flexible", payType: "percentage", payRate: 0.28, prefs: { language: "en" }, ...extra });
const load = (id, ref, truckId, lane, extra = {}) => ({ id, referenceNumber: ref, stage: "in_transit", carrierId: "carrier-titan", truckId, brokerId: "u5-b1", brokerContactEmail: "partials@pb.test", source: "test", lane, equipmentType: "Dry Van", weight: 8000, pickupWindow: "today", deliveryWindow: "in 3 days", pickupAt: iso(-2), deliveryAt: iso(80), listedRate: 700, targetRate: 700, bookedRate: 700, deadheadMiles: 0, fuelCost: 100, tollCost: 0, deadheadCost: 0, commission: 0, netProfit: 550, rpm: 2.9, score: 80, messages: [], calls: [], documents: [], createdAt: iso(-30), updatedAt: iso(0), ...extra });
const cron = () => fetch(`${BASE}/api/cron/dispatch`, { headers: { authorization: "Bearer cron-secret" } }).then((r) => r.json().catch(() => ({})));
const truckData = (id) => JSON.parse(db(`select data from trucks where carrier_id = '${cid}' and id = '${id}'`) || "{}");
const loadData = (id) => JSON.parse(db(`select data from loads where carrier_id = '${cid}' and id = '${id}'`) || "{}");
const byRef = (ref) => JSON.parse(db(`select data from loads where carrier_id = '${cid}' and data->>'referenceNumber' = '${ref}' order by updated_at desc limit 1`) || "null");
const setStage = (id, stage) => db(`update loads set stage = '${stage}', data = data || '{"stage":"${stage}"}'::jsonb where carrier_id = '${cid}' and id = '${id}'`);
const key = db(`select inbound_key from carriers where id = '${cid}'`);
let n = 0;
async function email(subject, text, { from = "partials@pb.test", name = "Pat at Partial Brokers" } = {}) {
  const body = { MessageID: `pm-u5-${++n}-${Date.now()}`, From: from, FromName: name, FromFull: { Email: from, Name: name }, To: `abc123+${key}@inbound.postmarkapp.com`, MailboxHash: key, Subject: subject, TextBody: text, Headers: [{ Name: "Message-ID", Value: `<u5-${n}-${Date.now()}@pb.test>` }], Attachments: [] };
  const res = await fetch(`${BASE}/api/channels/email?token=email-hook-secret`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (res.status !== 200) throw new Error(`email webhook ${res.status}`);
  await sleep(2500);
}
async function waitFor(fn, ms = 20000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = fn();
    if (v) return v;
    await sleep(500);
  }
  return fn();
}

(async () => {
  const before = JSON.parse(db(`select settings from carriers where id = '${cid}'`) || "{}");
  db(`update carriers set settings = settings || '{"autonomy":"rules","sandbox":false,"paused":false,"minRpm":2.5,"maxDeadhead":300,"brokerOverrides":{"u5-b1":"normal"}}'::jsonb where id = '${cid}'`);
  db(`delete from records where carrier_id = '${cid}' and kind = 'broker' and id = 'u5-b1'`);
  db(`insert into records (id, carrier_id, kind, data) values ('u5-b1', '${cid}', 'broker', '${JSON.stringify({ id: "u5-b1", company: "Partial Brokers", email: "partials@pb.test", contact: "Pat", mc: "778899", authorityVerified: true, fraudRisk: "low", reliability: 90, carrierId: "carrier-titan" })}'::jsonb)`);
  // The other trucks sit this one out, so the test is about one truck's trip (put back at the end).
  const others = db(`select id from trucks where carrier_id = '${cid}' and id not like 'u5-%' and coalesce(data->>'status','') <> 'maintenance'`).split("\n").filter(Boolean);
  for (const id of others) db(`update trucks set data = data || '{"status":"maintenance"}'::jsonb where carrier_id = '${cid}' and id = '${id}'`);
  db(`delete from loads where carrier_id = '${cid}' and (id like 'u5-%' or data->>'referenceNumber' in ('PRT-1','PRT-2','FULL-9'))`);

  // ── Partials on the way ──────────────────────────────────────────────────────
  // Truck U51 in Dallas with a 12-foot partial on, headed to Houston in three days.
  put("drivers", "u5-d1", driver("u5-d1", "Rosa Diaz", "+12145550197", "u5-t1"), { name: "Rosa Diaz", phone: "+12145550197" });
  db(`insert into driver_consents (carrier_id, driver_id, phone, granted, via, wording, version) values ('${cid}', 'u5-d1', '+12145550197', true, 'sms', 'Texted yes', '2026-10-01')`);
  put("trucks", "u5-t1", truck("u5-t1", "U51", "u5-d1", "Dallas", "TX", { currentLoadId: "u5-L1", position: { lat: 32.7767, lon: -96.797, at: iso(0), source: "samsara", description: "I-35E, Dallas, TX" } }), { unit_number: "U51", driver_id: "u5-d1" });
  put("loads", "u5-L1", load("u5-L1", "U5-100", "u5-t1", { origin: "Dallas", originState: "TX", destination: "Houston", destState: "TX", miles: 240 }, { partial: { feet: 12 } }), { truck_id: "u5-t1", stage: "in_transit" });
  const pm0 = read("postmark").length;
  const tw0 = read("twilio").length;
  await email("Partial loads this week", "Partial loads: Waco to Houston 5 pallets $450, Dallas to Houston 14 ft $600, and a full Dallas to Houston $1,200.");
  const p1 = await waitFor(() => byRef("PRT-1"));
  const p2 = byRef("PRT-2");
  check("the broker's partials come in as offers for the truck already headed to Houston", p1?.truckId === "u5-t1" && p2?.truckId === "u5-t1", JSON.stringify([p1?.truckId, p2?.truckId]));
  check("...with how much of the trailer each takes", JSON.stringify(p1?.partial) === JSON.stringify({ pallets: 5 }) && JSON.stringify(p2?.partial) === JSON.stringify({ feet: 14 }), JSON.stringify([p1?.partial, p2?.partial]));
  const full = byRef("FULL-9");
  check("a full truckload doesn't go on a truck carrying partials", !full || full.truckId !== "u5-t1", JSON.stringify(full && { truckId: full.truckId, stage: full.stage }));
  check("riding along costs only the miles it adds: no empty miles, little fuel", p1?.deadheadMiles === 0 && p1?.fuelCost < 60, JSON.stringify(p1 && { dh: p1.deadheadMiles, fuel: p1.fuelCost, net: p1.netProfit }));
  check("priced as a partial: $525 for the Waco one (a full truck's floor would have asked $550)", p1?.targetRate === 525, p1?.targetRate);
  const asks = read("postmark").slice(pm0).filter((x) => x.body?.To === "partials@pb.test");
  check("the AI asks for both partials, on the same truck", byRef("PRT-1")?.stage === "negotiating" && byRef("PRT-2")?.stage === "negotiating" && asks.some((x) => /PRT-1/.test(x.body.Subject + x.body.TextBody)) && asks.some((x) => /PRT-2/.test(x.body.Subject + x.body.TextBody)), JSON.stringify(asks.map((x) => x.body.Subject)));

  // The broker confirms both (the owner marks them booked, the same as a matching rate con).
  let r = await api("/api/agent/booked", { method: "POST", body: { loadId: p2.id } });
  let t = truckData("u5-t1");
  const b2 = loadData(p2.id);
  check("booked: the Dallas partial joins the truck's trip, dispatched", r.status === 200 && b2.stage === "dispatched" && !!t.trip && b2.tripId === t.trip.id && loadData("u5-L1").tripId === t.trip.id, JSON.stringify({ status: r.status, stage: b2.stage, trip: t.trip }));
  check("the trip keeps the pickup already made, then the new pickup before any drop", t.trip?.stops?.[0]?.loadId === "u5-L1" && t.trip.stops[0].kind === "pickup" && t.trip.stops[1]?.loadId === p2.id && t.trip.stops[1].kind === "pickup", JSON.stringify(t.trip?.stops));
  check("the truck works the next stop: the Dallas pickup", t.currentLoadId === p2.id, t.currentLoadId);
  const told = read("twilio").slice(tw0).find((x) => x.params?.To === "+12145550197" && /PRT-2/.test(x.params.Body ?? ""));
  check("the driver's text says where it fits: which stop to pick it up and drop it", !!told && /Pick it up at stop 2 and drop it at stop \d of 4\./.test(told.params.Body), told?.params?.Body);
  r = await api("/api/agent/booked", { method: "POST", body: { loadId: p1.id } });
  t = truckData("u5-t1");
  const order = (t.trip?.stops ?? []).map((s) => `${s.kind[0]}:${s.loadId === "u5-L1" ? "L1" : s.loadId === p1.id ? "P1" : s.loadId === p2.id ? "P2" : "?"}`).join(" ");
  check("the Waco partial joins too: six stops, Dallas then Waco then the Houston drops", r.status === 200 && t.trip?.stops?.length === 6 && order.startsWith("p:L1 p:P2 p:P1") && /d:.* d:.* d:/.test(order), order);
  check("the drops come off last-loaded first: nothing to restack", !t.trip?.warnings?.length && order.endsWith("d:P1 d:P2 d:L1"), `${order} ${JSON.stringify(t.trip?.warnings)}`);
  await cron();
  t = truckData("u5-t1");
  check("the owner's plan for the truck: a trip of 3 loads, stop 2 of 6", (t.plan?.lines ?? []).some((l) => l === "Now: a trip of 3 loads, stop 2 of 6: pick up PRT-2 in Dallas, TX."), JSON.stringify(t.plan?.lines));

  // In the browser: the driver's trip, and the owner's fleet page.
  db(`insert into auth.users values ('${DRV_SUB}', '${DRV_PHONE}') on conflict do nothing`);
  db(`delete from members where user_id = '${DRV_SUB}'`);
  db(`insert into members (user_id, carrier_id, role, driver_id) values ('${DRV_SUB}', '${cid}', 'driver', 'u5-d1')`);
  const DRV = token(DRV_SUB, DRV_PHONE);
  const browser = await chromium.launch({ args: ARGS });
  const sessionFor = (tk, sub, phone) => JSON.stringify({ access_token: tk, refresh_token: "x", token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: sub, phone, aud: "authenticated", role: "authenticated", app_metadata: {}, user_metadata: {} } });
  const errors = [];
  const dctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await dctx.addInitScript((s) => localStorage.setItem("sb-localhost-auth-token", s), sessionFor(DRV, DRV_SUB, DRV_PHONE));
  const dp = await dctx.newPage();
  dp.on("pageerror", (e) => errors.push(e.message));
  await dp.goto(`${BASE}/driver`, { waitUntil: "domcontentloaded" });
  await dp.getByText("Your trip").first().waitFor({ timeout: 120000 }).catch(() => {});
  const dtext = await dp.locator("body").innerText();
  check("driver home: 'Your trip', 3 loads, stop 2 of 6, every stop in order", /Your trip/i.test(dtext) && /3 loads · stop 2 of 6/.test(dtext) && /Pick up PRT-2 · Dallas, TX[\s\S]*Pick up PRT-1 · Waco, TX[\s\S]*Drop PRT-1 · Houston, TX[\s\S]*Drop U5-100 · Houston, TX/.test(dtext), dtext.match(/Your trip[\s\S]{0,400}/i)?.[0]);
  await dp.locator('[aria-label="Your trip"]').screenshot({ path: `${S}/.out/ux5-driver-trip.png` }).catch(() => {});
  const octx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await octx.addInitScript((s) => localStorage.setItem("sb-localhost-auth-token", s), sessionFor(OWNER, OWNER_SUB, OWNER_PHONE));
  const op = await octx.newPage();
  op.on("pageerror", (e) => errors.push(e.message));
  await op.goto(`${BASE}/carrier/fleet`, { waitUntil: "domcontentloaded" });
  await op.getByText(/Trip: 3 loads/).first().waitFor({ timeout: 120000 }).catch(() => {});
  const otext = await op.locator("body").innerText();
  check("fleet page: 'Trip: 3 loads · stop 2 of 6 · pick up PRT-2 in Dallas'", /Trip: 3 loads · stop 2 of 6 · pick up PRT-2 in Dallas/.test(otext), otext.match(/U51[\s\S]{0,600}/)?.[0]);
  check("no page errors", errors.length === 0, errors.join(" | "));
  await browser.close();

  // Loaded in Dallas: on to Waco.
  setStage(p2.id, "in_transit");
  await cron();
  check("loaded at the Dallas stop: the truck moves on to the Waco pickup", truckData("u5-t1").currentLoadId === p1.id, truckData("u5-t1").currentLoadId);
  // The broker cancels the Waco one: its stops come off; the trip goes on to Houston.
  const tw1 = read("twilio").length;
  await email("Cancel PRT-1", "Sorry, we have to cancel PRT-1, the shipper pulled it.");
  t = await waitFor(() => { const x = truckData("u5-t1"); return x.trip?.stops?.length === 4 ? x : null; });
  check("cancelled: its stops come off the trip and the truck heads for the next drop", loadData(p1.id).stage === "cancelled" && t?.trip?.stops?.every((s) => s.loadId !== p1.id) && t.currentLoadId === p2.id, JSON.stringify({ stage: loadData(p1.id).stage, trip: truckData("u5-t1").trip?.stops, cur: truckData("u5-t1").currentLoadId }));
  check("...and the driver is told not to go to Waco", read("twilio").slice(tw1).some((x) => x.params?.To === "+12145550197" && /PRT-1/.test(x.params.Body ?? "")));
  // Both dropped in Houston: the trip is over.
  setStage(p2.id, "delivered");
  await cron();
  check("first Houston drop made: on to the last one", truckData("u5-t1").currentLoadId === "u5-L1" && !!truckData("u5-t1").trip);
  setStage("u5-L1", "delivered");
  await cron();
  t = truckData("u5-t1");
  check("every stop made: the trip is over and the truck is free", !t.trip && !t.currentLoadId && t.status === "available", JSON.stringify({ trip: t.trip, cur: t.currentLoadId, status: t.status }));

  // ── Parking that follows through ─────────────────────────────────────────────
  put("loads", "u5-L2", load("u5-L2", "PKG-200", "u5-t1", { origin: "Dallas", originState: "TX", destination: "Memphis", destState: "TN", miles: 452 }, { stage: "dispatched", pickupAt: iso(5), deliveryAt: iso(30) }), { truck_id: "u5-t1", stage: "dispatched" });
  put("trucks", "u5-t1", { ...truckData("u5-t1"), currentLoadId: "u5-L2", status: "on_load" }, { unit_number: "U51", driver_id: "u5-d1" });
  r = await api("/api/parking", { method: "POST", as: DRV, body: { spotId: "P-1" } });
  const res = truckData("u5-t1").parking;
  const exp = JSON.parse(db(`select data from records where carrier_id = '${cid}' and kind = 'expense' and id = 'parking-${res?.id}'`) || "{}");
  check("booked parking goes on the books as a company-paid cost, not something to pay the driver back", r.status === 200 && exp.category === "parking" && exp.status === "approved" && exp.upfront === true && exp.amount === res.price && exp.loadId === "u5-L2", JSON.stringify(exp));
  db(`delete from agent_marks where carrier_id = '${cid}' and load_id like 'parking:%'`);
  put("trucks", "u5-t1", { ...truckData("u5-t1"), parking: { ...res, arriveAt: iso(1) } }, { unit_number: "U51", driver_id: "u5-d1" });
  const tw2 = read("twilio").length;
  await cron();
  const remind = read("twilio").slice(tw2).find((x) => x.params?.To === "+12145550197" && /^Your parking tonight/.test(x.params.Body ?? ""));
  check("an hour before getting there, the driver gets the spot again (address and confirmation)", !!remind && new RegExp(`Confirmation ${res.confirmation}`).test(remind.params.Body), remind?.params?.Body);
  const tw3 = read("twilio").length;
  await cron();
  check("...once", !read("twilio").slice(tw3).some((x) => /^Your parking tonight/.test(x.params?.Body ?? "")));
  const pk0 = read("parking").length;
  await email("Cancel PKG-200", "We need to cancel PKG-200, sorry about that.");
  await waitFor(() => truckData("u5-t1").parking?.status === "cancelled");
  check("the load is cancelled: its parking spot is cancelled with it", truckData("u5-t1").parking?.status === "cancelled" && read("parking").slice(pk0).some((x) => x.kind === "cancel"), JSON.stringify(truckData("u5-t1").parking));
  check("...and its cost comes off the books", JSON.parse(db(`select data from records where carrier_id = '${cid}' and kind = 'expense' and id = 'parking-${res?.id}'`) || "{}").status === "denied");

  // ── Tight on time: the driver hears it, without being rushed ─────────────────
  put("loads", "u5-L3", load("u5-L3", "U5-300", "u5-t1", { origin: "Dallas", originState: "TX", destination: "Houston", destState: "TX", miles: 240 }, { deliveryAt: iso(7.2) }), { truck_id: "u5-t1", stage: "in_transit" });
  put("trucks", "u5-t1", { ...truckData("u5-t1"), currentLoadId: "u5-L3", status: "on_load", parking: undefined, position: { lat: 32.7767, lon: -96.797, at: iso(0), source: "samsara", description: "I-45, Dallas, TX" } }, { unit_number: "U51", driver_id: "u5-d1" });
  put("drivers", "u5-d1", driver("u5-d1", "Rosa Diaz", "+12145550197", "u5-t1", { hos: { drive: 10, shift: 12, cycle: 50, at: iso(0), source: "samsara" } }), { name: "Rosa Diaz", phone: "+12145550197" });
  db(`delete from agent_marks where carrier_id = '${cid}' and load_id = 'u5-L3'`);
  const tw4 = read("twilio").length;
  await cron();
  const heads = read("twilio").slice(tw4).find((x) => x.params?.To === "+12145550197" && /^Heads-up on U5-300/.test(x.params.Body ?? ""));
  check("into a jam with little room: the driver gets a heads-up that says why, and not to rush", !!heads && /traffic adds 2/.test(heads.params.Body) && /Drive safe, no need to rush/.test(heads.params.Body), heads?.params?.Body ?? JSON.stringify(loadData("u5-L3").why));

  // ── QuickBooks: invoices kept up to date, voided when the load is ─────────────
  r = await api("/api/integrations/quickbooks", { method: "POST" });
  const start = new URL(r.body.url ?? "http://x/");
  await api(`/api/integrations/quickbooks/callback?state=${encodeURIComponent(start.searchParams.get("state"))}&code=good-code&realmId=4620816365`, { as: null, redirect: "manual" });
  db(`delete from agent_marks where carrier_id = '${cid}' and load_id = 'u5-Q1'`);
  const invNo = `INV-U5-${Date.now().toString(36)}`;
  put("loads", "u5-Q1", load("u5-Q1", "U5-Q1", "u5-t1", { origin: "Dallas", originState: "TX", destination: "Memphis", destState: "TN", miles: 452 }, { stage: "delivered", invoice: { number: invNo, amount: 1000, lines: [{ label: "Line haul", amount: 1000 }], draftedAt: iso(-10), sentAt: iso(-9) } }), { truck_id: "u5-t1", stage: "delivered" });
  for (let k = 0; k < 4; k++) {
    r = await api("/api/integrations/quickbooks", { method: "PUT" });
    if (r.status !== 200 || r.body.invoices + r.body.payments + r.body.costs < 60) break;
  }
  const q0 = read("qbo").length;
  const ql = loadData("u5-Q1");
  put("loads", "u5-Q1", { ...ql, invoice: { ...ql.invoice, amount: 1150, lines: [{ label: "Line haul", amount: 1000 }, { label: "Detention, 3 h", amount: 150 }] } }, { truck_id: "u5-t1", stage: "delivered" });
  r = await api("/api/integrations/quickbooks", { method: "PUT" });
  const upd = read("qbo").slice(q0).find((x) => x.kind === "update" && x.type === "Invoice");
  check("detention added after the invoice went in: the invoice in QuickBooks is brought up to date", r.status === 200 && r.body.updated === 1 && !!upd && upd.row.Line.filter((l) => l.Amount).map((l) => l.Amount).join() === "1000,150", JSON.stringify({ body: r.body, upd: upd?.row?.Line?.map((l) => l.Amount) }));
  const q1 = read("qbo").length;
  put("loads", "u5-Q1", { ...loadData("u5-Q1"), stage: "cancelled", cancellationReason: "Broker cancelled: billing error" }, { truck_id: "u5-t1", stage: "cancelled" });
  r = await api("/api/integrations/quickbooks", { method: "PUT" });
  check("the load is cancelled: its invoice is voided in QuickBooks (not deleted)", r.status === 200 && read("qbo").slice(q1).some((x) => x.kind === "void"), JSON.stringify(read("qbo").slice(q1).map((x) => x.kind)));
  const q2 = read("qbo").length;
  r = await api("/api/integrations/quickbooks", { method: "PUT" });
  check("...once", !read("qbo").slice(q2).some((x) => x.kind === "void" || x.kind === "update"));
  await api("/api/integrations/quickbooks", { method: "DELETE" });

  // Put things back for the next suite.
  for (const id of others) db(`update trucks set data = data || '{"status":"available"}'::jsonb where carrier_id = '${cid}' and id = '${id}'`);
  db(`update carriers set settings = '${JSON.stringify(before).replace(/'/g, "''")}'::jsonb where id = '${cid}'`);

  console.log(`${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
