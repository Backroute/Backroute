// The time-savers, end to end against the stand-ins: the owner writes a driver from the app (it reaches their phone
// as a text when they have no app notifications), a receipt's amount is read off its photo, defect photos are stored,
// and the owner's screens: today's stops, Call/Text on a load, Money in three tabs, Settings search, the driver
// thread. The driver's: the things-for-you list, the receipt-first expense, and time off from Home.
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
const tw = () => (fs.existsSync(`${S}/fakes/twilio.jsonl`) ? fs.readFileSync(`${S}/fakes/twilio.jsonl`, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
const cid = fs.readFileSync(`${S}/fakes/carrier.txt`, "utf8").trim();
const token = (sub, phone) => execSync(`node ${S}/pgrst/jwt.cjs ${sub} ${phone}`).toString().trim();
const OWNER_SUB = "aaaaaaaa-0000-0000-0000-000000000001", OWNER_PHONE = "12145550100";
const OWNER = token(OWNER_SUB, OWNER_PHONE);
const DRV_SUB = "dddddddd-0000-0000-0000-000000000031", DRV_PHONE = "12145550131";
const iso = (h) => new Date(Date.now() + h * 3600000).toISOString();
const sessionFor = (tk, sub, phone) => JSON.stringify({ access_token: tk, refresh_token: "x", token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: sub, phone, aud: "authenticated", role: "authenticated", app_metadata: {}, user_metadata: {} } });
function put(table, id, data, cols = {}, kind) {
  db(`delete from ${table} where carrier_id = '${cid}' and id = '${id}'${kind ? ` and kind = '${kind}'` : ""}`);
  const names = [...(kind ? ["kind"] : []), ...Object.keys(cols)];
  const vals = [...(kind ? [`'${kind}'`] : []), ...Object.values(cols).map((v) => (v === null ? "null" : `'${v}'`))];
  db(`insert into ${table} (id, carrier_id, ${names.map((n) => n + ", ").join("")}data) values ('${id}', '${cid}', ${vals.map((v) => v + ", ").join("")}'${JSON.stringify(data).replace(/'/g, "''")}'::jsonb)`);
}
// A small JPEG (1x1), enough to store and send to the reader.
const JPEG = Buffer.from("/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=", "base64");
async function upload(kind, as, loadId) {
  const form = new FormData();
  form.set("file", new Blob([JPEG], { type: "image/jpeg" }), "photo.jpg");
  form.set("kind", kind);
  if (loadId) form.set("loadId", loadId);
  const r = await fetch(`${BASE}/api/files`, { method: "POST", headers: { authorization: `Bearer ${as}` }, body: form });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}

(async () => {
  // A driver with a truck on a load that delivers today, running late.
  put("drivers", "ez-d1", { id: "ez-d1", name: "Ezra Lane", phone: "+12145550131", email: "", truckId: "ez-t1", carrierId: "carrier-titan", hosStatus: "on_duty", hoursRemaining: 9, cdl: "", rating: 5, hireDate: iso(-24 * 400), homeBase: "Dallas, TX", runType: "regional", homeTimeTarget: "Flexible", payType: "percentage", payRate: 0.28, prefs: { language: "en" } }, { name: "Ezra Lane", phone: "+12145550131" });
  put("trucks", "ez-t1", { id: "ez-t1", unitNumber: "EZ-1", driverId: "ez-d1", carrierId: "carrier-titan", equipmentType: "Dry Van", status: "on_load", currentCity: "Waco", currentState: "TX", homeBase: "Dallas, TX", currentLoadId: "ez-L1", nextLoadId: null, mpg: 6.5, odometer: 100000, lastServiceMiles: 90000, serviceIntervalMiles: 25000, nextInspectionDue: iso(24 * 300) }, { unit_number: "EZ-1", driver_id: "ez-d1" });
  const today = new Date();
  const at = (h) => { const d = new Date(today); d.setHours(h, 0, 0, 0); return d.toISOString(); };
  put("loads", "ez-L1", { id: "ez-L1", referenceNumber: "EZ-100", stage: "in_transit", carrierId: "carrier-titan", truckId: "ez-t1", brokerId: "u5-b1", source: "test", lane: { origin: "Dallas", originState: "TX", destination: "Houston", destState: "TX", miles: 240 }, equipmentType: "Dry Van", weight: 30000, pickupWindow: "today", deliveryWindow: "today", pickupAt: at(6), deliveryAt: at(20), listedRate: 900, targetRate: 900, bookedRate: 900, deadheadMiles: 0, fuelCost: 100, tollCost: 0, deadheadCost: 0, commission: 0, netProfit: 700, rpm: 3.75, score: 80, messages: [], calls: [], documents: [], createdAt: iso(-30), updatedAt: iso(0), late: { stop: "delivery", eta: "9:10 pm", at: iso(0) } }, { truck_id: "ez-t1", stage: "in_transit" });
  db(`insert into auth.users values ('${DRV_SUB}', '${DRV_PHONE}') on conflict do nothing`);
  db(`delete from members where user_id = '${DRV_SUB}'`);
  db(`insert into members (user_id, carrier_id, role, driver_id) values ('${DRV_SUB}', '${cid}', 'driver', 'ez-d1')`);
  const DRV = token(DRV_SUB, DRV_PHONE);

  // The owner writes the driver from the app.
  const tw0 = tw().length;
  const post = (body, as = OWNER) => fetch(`${BASE}/api/driver-message`, { method: "POST", headers: { authorization: `Bearer ${as}`, "content-type": "application/json" }, body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) }));
  const sent = await post({ id: "dm-ez-1", driverId: "ez-d1", body: "Call me when you're unloaded" });
  check("the owner's message to a driver goes out", sent.status === 200 && sent.body.sent === "sms", JSON.stringify(sent));
  const text = tw().slice(tw0).find((x) => (x.params?.To ?? "").endsWith("2145550131") && /Call me when/.test(x.params?.Body ?? ""));
  check("…as a text with the company's name on it, so the driver knows it's the office", !!text && /: Call me when you're unloaded$/.test(text.params.Body) && !/^Backroute/.test(text.params.Body), text?.params?.Body);
  const row = JSON.parse(db(`select data from driver_messages where carrier_id = '${cid}' and id = 'dm-ez-1'`) || "{}");
  check("…and it's in the driver's messages, marked from the owner", row.from === "owner" && row.byOwner === "the owner" && row.channel === "sms", JSON.stringify(row));
  check("a driver can't send as the office", (await post({ id: "dm-ez-2", driverId: "ez-d1", body: "hi" }, DRV)).status === 403);

  // Photos on the road.
  const receipt = await upload("receipt", DRV, "ez-L1");
  check("a receipt's amount is read off its photo", receipt.status === 200 && receipt.body.amount === 42.5, JSON.stringify(receipt));
  const defect = await upload("dvir_photo", DRV);
  check("a defect photo is stored for the inspection", defect.status === 200 && db(`select kind from carrier_files where id = '${defect.body.id}'`) === "dvir_photo", JSON.stringify(defect));
  check("a driver still can't add the company's papers", (await upload("coi", DRV)).status === 403);

  const browser = await chromium.launch({ args: ARGS });
  const errors = [];
  const octx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await octx.addInitScript((s) => localStorage.setItem("sb-localhost-auth-token", s), sessionFor(OWNER, OWNER_SUB, OWNER_PHONE));
  const op = await octx.newPage();
  op.on("pageerror", (e) => errors.push(e.message));
  await op.goto(`${BASE}/carrier`, { waitUntil: "domcontentloaded" });
  await op.getByText("Today's stops").waitFor({ timeout: 120000 }).catch(() => {});
  const board = await op.locator("section[aria-labelledby='today-title']").innerText().catch(() => "");
  check("Home: today's stops, the late one marked with its ETA", /Delivery · Houston, TX/.test(board) && /EZ-1 · Ezra Lane/.test(board) && /Late, about 9:10 pm/.test(board), board.slice(0, 400));
  check("Home folds the map, money and the log under More", (await op.getByRole("button", { name: /More: map, money/ }).count()) === 1 && (await op.getByText("What Backroute did", { exact: true }).count()) === 0);
  await op.goto(`${BASE}/carrier/loads/ez-L1`, { waitUntil: "domcontentloaded" });
  await op.getByRole("group", { name: "Contact" }).waitFor({ timeout: 90000 }).catch(() => {});
  const contact = await op.getByRole("group", { name: "Contact" }).innerText().catch(() => "");
  check("a load: call or text the driver in one tap", /Call Ezra/.test(contact) && /Text Ezra/.test(contact) && (await op.getByRole("link", { name: "Text Ezra Lane" }).getAttribute("href")) === "sms:+12145550131", contact);
  const head = await op.locator("body").innerText();
  check("…where the truck is and that it's running late, up top; no Cancel button out in the open", /EZ-1 · Ezra Lane is in/.test(head) && /Running late, about 9:10 pm/.test(head) && (await op.getByRole("button", { name: "Cancel load" }).count()) === 0, head.match(/EZ-1 ·[^\n]*/)?.[0]);
  await op.getByRole("link", { name: "Message Ezra Lane in the app" }).click();
  await op.waitForURL(/\/carrier\/messages\?driver=ez-d1/, { timeout: 30000 });
  await op.getByText("Call me when you're unloaded").waitFor({ timeout: 30000 }).catch(() => {});
  check("Message opens that driver's thread, with what the owner sent", (await op.getByRole("tab", { name: "Ezra Lane", selected: true }).count()) === 1 && (await op.getByText("Call me when you're unloaded").count()) >= 1);
  await op.goto(`${BASE}/carrier/earnings`, { waitUntil: "domcontentloaded" });
  await op.getByRole("navigation", { name: "Money sections" }).waitFor({ timeout: 90000 }).catch(() => {});
  const tabs = await op.getByRole("navigation", { name: "Money sections" }).getByRole("link").allInnerTexts();
  check("Money fits a phone: three tabs, lanes and brokers inside Earnings", tabs.join("|") === "Earnings|Getting paid|Costs & drivers" && (await op.getByRole("navigation", { name: "Earnings pages" }).getByRole("link").allInnerTexts()).join("|") === "Overview|Lanes|Brokers", tabs.join("|"));
  await op.goto(`${BASE}/carrier/settings`, { waitUntil: "domcontentloaded" });
  await op.getByLabel("Search settings").waitFor({ timeout: 90000 });
  await op.getByLabel("Search settings").fill("quickbooks");
  await op.getByRole("option", { name: "QuickBooks Online" }).click();
  await op.waitForTimeout(1500);
  check("Settings search opens the right tab on the right card", (await op.getByRole("button", { name: "Company", pressed: true }).count()) === 1 && (await op.locator("#set-quickbooks").isVisible()));

  // The driver.
  const dctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await dctx.addInitScript((s) => localStorage.setItem("sb-localhost-auth-token", s), sessionFor(DRV, DRV_SUB, DRV_PHONE));
  const dp = await dctx.newPage();
  dp.on("pageerror", (e) => errors.push(e.message));
  await dp.goto(`${BASE}/driver`, { waitUntil: "domcontentloaded" });
  await dp.getByText(/Hi Ezra/).waitFor({ timeout: 120000 }).catch(() => {});
  check("driver Home lists what's for them, each a tap away", (await dp.getByRole("list", { name: "For you" }).getByRole("listitem").count()) >= 1, await dp.getByRole("list", { name: "For you" }).innerText().catch(() => "none"));
  await dp.getByRole("button", { name: "Ask for time off" }).click();
  await dp.getByPlaceholder("Why (a few words)").fill("Family wedding");
  await dp.getByRole("button", { name: "Send to my carrier" }).click();
  await dp.waitForTimeout(4000);
  check("time off asked for from Home, and the owner gets it", db(`select count(*) from records where carrier_id = '${cid}' and kind = 'time_off' and data->>'driverId' = 'ez-d1' and data->>'reason' = 'Family wedding'`) === "1");
  await dp.goto(`${BASE}/driver/messages`, { waitUntil: "domcontentloaded" });
  await dp.getByText("Call me when you're unloaded").waitFor({ timeout: 60000 }).catch(() => {});
  check("the driver sees the owner's message, marked from the office", (await dp.getByText("The office").count()) >= 1);
  await dp.goto(`${BASE}/driver/loads/ez-L1`, { waitUntil: "domcontentloaded" });
  await dp.getByRole("button", { name: "Submit an expense" }).click({ timeout: 90000 });
  await dp.getByLabel("Photo of the receipt").setInputFiles({ name: "r.jpg", mimeType: "image/jpeg", buffer: JPEG });
  await dp.getByText(/Read \$42.5 off the receipt/).waitFor({ timeout: 30000 }).catch(() => {});
  check("an expense starts with the receipt: the amount comes off it", (await dp.getByRole("spinbutton").inputValue().catch(() => "")) === "42.5", await dp.getByRole("spinbutton").inputValue().catch(() => "none"));
  check("no page errors", errors.length === 0, errors.join(" / "));
  await browser.close();

  for (const t of ["drivers", "trucks", "loads"]) db(`delete from ${t} where carrier_id = '${cid}' and id like 'ez-%'`);
  db(`delete from records where carrier_id = '${cid}' and kind = 'time_off' and data->>'driverId' = 'ez-d1'`);
  db(`delete from members where user_id = '${DRV_SUB}'`);
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
