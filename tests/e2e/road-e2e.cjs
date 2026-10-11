// After booking, against the stand-ins: extra pay the driver reports (tarping at the rate con's price, driver assist at
// the owner's price once set, a scale ticket from the receipt), freight gone wrong (refused, stolen), the broker told
// when free time runs out at a dock, a breakdown that won't be fixed today (a repower offered with the closest free
// truck, the broker told, hotels for the driver), the driver's share of extra pay, and the settings in the browser.
const path = require("path");
const S = path.join(__dirname, "..");
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
const cron = () => fetch(`${BASE}/api/cron/dispatch`, { headers: { authorization: "Bearer cron-secret" } }).then((r) => r.json());
const settings = (patch) => db(`update carriers set settings = settings || '${JSON.stringify(patch)}'::jsonb where id = '${cid}'`);
const sign = (url, params) => crypto.createHmac("sha1", "twilio-secret").update(url + Object.keys(params).sort().map((k) => k + params[k]).join("")).digest("base64");
let n = 0;
async function sms(from, body) {
  const url = `${BASE}/api/channels/sms`;
  const params = { From: from, To: "+14695550199", Body: body, MessageSid: `SM-road2-${Date.now()}-${++n}` };
  await fetch(url, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", "x-twilio-signature": sign(url, params) }, body: new URLSearchParams(params) });
  await sleep(4000);
}
const MARCUS = "+12145550148";
const BROKER_MAIL = "ops@roadline.test";
const mails = (i, subject) => read("postmark").slice(i).map((m) => m.body).filter((m) => m.To === BROKER_MAIL && subject.test(m.Subject ?? ""));
const loadById = (id) => JSON.parse(db(`select data from loads where carrier_id = '${cid}' and id = '${id}'`) || "null");
const truckBy = (unit) => JSON.parse(db(`select data from trucks where carrier_id = '${cid}' and unit_number = '${unit}'`));
const setTruck = (unit, patch) => db(`update trucks set data = data || '${JSON.stringify(patch).replace(/'/g, "''")}'::jsonb where carrier_id = '${cid}' and unit_number = '${unit}'`);
const escalation = (like) => db(`select status || '|' || coalesce(data->>'complexity', '') || '|' || (data->>'reason') from escalations where carrier_id = '${cid}' and data->>'reason' like '${like.replace(/'/g, "''")}' order by (data->>'createdAt') desc limit 1`);
const H = 3600000;
const iso = (ms) => new Date(Date.now() + ms).toISOString();

// A rate con as the reader leaves it, with the terms a test needs.
const reading = (detention, finesAndFees = []) => ({ fileName: "ratecon.pdf", readAt: new Date().toISOString(), isRateCon: true, broker: "Roadline Logistics", brokerMc: "771555", loadNumber: null, totalRate: 2000, pickup: null, delivery: null, equipment: "Dry Van", detention, paymentTerms: "Net 30", finesAndFees, otherConcerns: [], mismatches: [], summary: "" });

function makeLoad(id, ref, truckId, stage, extra) {
  db(`delete from loads where carrier_id = '${cid}' and id = '${id}'`);
  const data = { id, stage, referenceNumber: ref, truckId, brokerId: "rd-broker", brokerContactEmail: BROKER_MAIL, bookedRate: 2000, imported: false, extraClaims: [], tripChecklist: {}, updatedAt: new Date().toISOString(), ...extra };
  db(`insert into loads (id, carrier_id, truck_id, stage, data) select '${id}', carrier_id, '${truckId}', '${stage}', (data - 'exception' - 'claim' - 'invoice' - 'detentionClaims' - 'layoverClaims') || '${JSON.stringify(data).replace(/'/g, "''")}'::jsonb from loads where carrier_id = '${cid}' and data->>'referenceNumber' = 'CFP-88213' limit 1`);
}

(async () => {
  // The ELD would move the trucks back each round; this test places them by hand.
  await fetch(`${BASE}/api/integrations?kind=motive`, { method: "DELETE", headers: { authorization: `Bearer ${OWNER}` } });
  await fetch(`${BASE}/api/integrations?kind=samsara`, { method: "DELETE", headers: { authorization: `Bearer ${OWNER}` } });
  settings({ autonomy: "rules", extraPay: null, roadsidePlan: null });
  db(`update carriers set settings = settings - 'extraPay' - 'roadsidePlan' where id = '${cid}'`);
  const b = { id: "rd-broker", carrierId: cid, company: "Roadline Logistics", contact: "Pat", phone: "", email: BROKER_MAIL, reliability: 90, avgResponseMins: 20, loadsBooked: 3, onTimePct: 95, avgRateVariancePct: 0, tier: "standard", authorityVerified: true, mc: "771555", legalName: "Roadline Logistics", verifiedAt: new Date().toISOString(), fraudRisk: "low", avgDaysToPay: 30, detentionPaidPct: 80, cancellations90d: 0 };
  db(`insert into records (carrier_id, id, kind, data) values ('${cid}', 'rd-broker', 'broker', '${JSON.stringify(b).replace(/'/g, "''")}'::jsonb) on conflict (carrier_id, kind, id) do update set data = excluded.data`);
  db(`update loads set stage = 'delivered', data = data || '{"stage":"delivered"}'::jsonb where carrier_id = '${cid}' and stage in ('booked', 'dispatched', 'at_pickup', 'in_transit', 'at_delivery')`);
  const t101 = truckBy("101"), t102 = truckBy("102");
  db(`update drivers set data = jsonb_set(data, '{prefs}', coalesce(data->'prefs', '{}'::jsonb) || '{"smsOptOut":false,"language":"en"}'::jsonb) where carrier_id = '${cid}' and id = '${t101.driverId}'`);
  db(`update trucks set data = data - 'roadside' where carrier_id = '${cid}'`);
  // A run before this one left its once-only marks on the same load ids.
  db(`delete from agent_marks where carrier_id = '${cid}' and load_id like 'rd-%'`);

  // ── Extra pay ─────────────────────────────────────────────────────────────
  makeLoad("rd-1", "RD-1", t101.id, "in_transit", { rateConReading: reading("$50/hr after 2 hours", ["Tarp pay $100 when required"]) });
  setTruck("101", { currentLoadId: "rd-1", status: "on_load", currentCity: "Waco", currentState: "TX", position: null });
  let p0 = read("postmark").length;
  await sms(MARCUS, "tarped it at the shipper this morning, took an hour");
  let mail = mails(p0, /^Tarping: Load RD-1/)[0];
  let l = loadById("rd-1");
  check("tarping: claimed from the broker at the rate con's $100, the same hour", !!mail && /our driver reported tarping/.test(mail.TextBody) && /\$100 per the rate confirmation/.test(mail.TextBody) && !!l.extraClaims?.[0]?.sentAt, mail?.TextBody?.slice(0, 300) ?? JSON.stringify(l.extraClaims));

  p0 = read("postmark").length;
  await sms(MARCUS, "receiver made me unload it myself, 22 pallets");
  check("driver assist with no price anywhere: nothing sent, the owner is asked for their price", mails(p0, /Driver assist/).length === 0 && /Settings → Business → Extra pay/.test(escalation("RD-1: the driver reported driver assist%")), escalation("RD-1: the driver reported driver assist%"));
  settings({ extraPay: { driver_assist: 75 } });
  await cron();
  mail = mails(p0, /^Driver assist: Load RD-1/)[0];
  check("...and once the owner sets $75, the next round claims it", !!mail && /\$75 at our standard rate/.test(mail.TextBody), mail?.TextBody?.slice(0, 300));
  p0 = read("postmark").length;
  await cron();
  check("...once", mails(p0, /^Driver assist: Load RD-1/).length === 0);

  p0 = read("postmark").length;
  await sms(MARCUS, "had to scale it, scale ticket was $13.50");
  mail = mails(p0, /^Scale ticket: Load RD-1/)[0];
  check("a scale ticket: claimed at what the receipt says", !!mail && /\$13\.50 at cost/.test(mail.TextBody), mail?.TextBody?.slice(0, 300));
  l = loadById("rd-1");
  check("all three on the load, ready for the invoice", (l.extraClaims ?? []).filter((c) => c.sentAt).map((c) => `${c.kind}:${c.amount}`).join() === "tarp:100,driver_assist:75,scale:13.5", JSON.stringify(l.extraClaims));

  // ── Freight gone wrong ────────────────────────────────────────────────────
  p0 = read("postmark").length;
  await sms(MARCUS, "receiver refused the load, said it's damaged");
  mail = mails(p0, /^Refused at delivery: Load RD-1/)[0];
  l = loadById("rd-1");
  check("refused at delivery: the broker asked for instructions in writing", !!mail && /refused RD-1/.test(mail.TextBody) && /return to the shipper, deliver somewhere else, or salvage/.test(mail.TextBody) && l.exception?.kind === "refused" && !!l.exception.brokerToldAt, mail?.TextBody?.slice(0, 300) ?? JSON.stringify(l.exception));
  check("...and the owner knows the driver is holding", /^open\|routine\|RD-1: the receiver refused the load/.test(escalation("RD-1: the receiver refused%")), escalation("RD-1: the receiver refused%"));

  p0 = read("postmark").length;
  await sms(MARCUS, "my trailer got stolen at the truck stop");
  mail = mails(p0, /^URGENT: cargo theft: Load RD-1/)[0];
  l = loadById("rd-1");
  const theft = escalation("RD-1 was reported stolen%");
  check("theft: an emergency for support, the broker told, a claim file started", /^with_support\|critical\|/.test(theft) && !!mail && l.claim?.source === "driver" && l.claim.kind === "loss", `${theft} / ${JSON.stringify(l.claim)}`);

  // ── The driver's share of extra pay ────────────────────────────────────────
  // (lib/pay-runs is unit-tested; here, that the load's claims carry what it needs.)
  check("claims carry when they went out, for the pay run", (l.extraClaims ?? []).every((c) => !!c.sentAt && !!c.basis), JSON.stringify(l.extraClaims));

  // ── A breakdown that won't be fixed today ─────────────────────────────────
  makeLoad("rd-2", "RD-2", t101.id, "in_transit", {});
  setTruck("101", { currentLoadId: "rd-2", status: "on_load", currentCity: "Waco", currentState: "TX", roadside: { at: iso(-4 * H), driverId: t101.driverId, loadId: "rd-2", details: "No power", where: "I-35 near Waco, TX", shops: [], calling: -1, exhausted: true } });
  // 102 is the reefer; for a repower it has to pull the same trailer type, so it's a van for this part.
  const t102type = t102.equipmentType;
  setTruck("102", { equipmentType: "Dry Van", currentLoadId: null, nextLoadId: null, status: "available", currentCity: "Dallas", currentState: "TX", position: null });
  db(`delete from agent_marks where carrier_id = '${cid}' and (kind like 'recovery:%' or kind like 'hotel:%')`);
  p0 = read("postmark").length;
  let t0 = read("twilio").length;
  await cron();
  const repower = escalation("RD-2 is stuck with truck 101%");
  check("the owner is offered a repower with the closest free truck", /Truck 102 \(.+\) is free \d+ miles away in Dallas, TX: send it to take the trailer/.test(repower), repower);
  mail = mails(p0, /^Breakdown update: Load RD-2/)[0];
  check("...the broker hears the load won't move soon, and what we can do", !!mail && /send another of our trucks, about \d+ miles away/.test(mail.TextBody), mail?.TextBody?.slice(0, 300));
  const hotel = read("twilio").slice(t0).find((x) => x.params.To === MARCUS && /Hotels near you/.test(x.params.Body ?? ""));
  check("...and the driver gets hotels nearby with room for the truck", !!hotel && /Brazos Inn & Truck Lot(, \d+ mi)?: \(254\) 555-0150/.test(hotel.params.Body), hotel?.params.Body);
  t0 = read("twilio").length;
  p0 = read("postmark").length;
  await cron();
  check("...each once", mails(p0, /^Breakdown update/).length === 0 && !read("twilio").slice(t0).some((x) => x.params.To === MARCUS && /Hotels near you/.test(x.params.Body ?? "")));
  db(`update trucks set data = data - 'roadside' where carrier_id = '${cid}'`);
  setTruck("101", { currentLoadId: null, status: "available" });
  setTruck("102", { equipmentType: t102type });
  db(`update loads set stage = 'delivered', data = data || '{"stage":"delivered"}'::jsonb where carrier_id = '${cid}' and id in ('rd-1', 'rd-2')`);

  // ── Free time runs out at the dock ────────────────────────────────────────
  const terms = { rateConReading: reading("$50/hr after 2 hours free") };
  makeLoad("rd-3", "RD-3", t102.id, "at_delivery", { ...terms, deliveryAt: iso(-3 * H), tripChecklist: { arrivedDeliveryAt: iso(-3.2 * H) } });
  setTruck("102", { currentLoadId: "rd-3", status: "on_load" });
  p0 = read("postmark").length;
  await cron();
  mail = mails(p0, /^Detention starting: Load RD-3/)[0];
  l = loadById("rd-3");
  check("free time ran out with the truck still at the dock: the broker hears detention has started", !!mail && /still waiting to be unloaded/.test(mail.TextBody) && /Free time \(2 hours\) ran out at/.test(mail.TextBody) && (l.tripChecklist?.detentionNoticeSent ?? []).includes("delivery"), mail?.TextBody?.slice(0, 400));
  p0 = read("postmark").length;
  await cron();
  check("...once", mails(p0, /^Detention starting/).length === 0);
  makeLoad("rd-4", "RD-4", t102.id, "at_delivery", { ...terms, deliveryAt: iso(-3 * H), tripChecklist: { arrivedDeliveryAt: iso(-2 * H) } });
  setTruck("102", { currentLoadId: "rd-4" });
  p0 = read("postmark").length;
  await cron();
  check("a truck that got there an hour late isn't owed it: no notice", mails(p0, /^Detention starting: Load RD-4/).length === 0);
  db(`update loads set stage = 'delivered', data = data || '{"stage":"delivered"}'::jsonb where carrier_id = '${cid}' and id in ('rd-3', 'rd-4')`);
  setTruck("102", { currentLoadId: null, status: "available" });

  // ── In the browser ───────────────────────────────────────────────────────
  const session = JSON.stringify({ access_token: OWNER, refresh_token: "x", token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: OWNER_SUB, phone: OWNER_PHONE, aud: "authenticated", role: "authenticated", app_metadata: {}, user_metadata: {} } });
  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ARGS });
  const p = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await p.evaluate((s) => localStorage.setItem("sb-localhost-auth-token", s), session);
  await p.goto(`${BASE}/carrier/settings?tab=general`, { waitUntil: "domcontentloaded" });
  await p.getByLabel("Roadside plan phone").waitFor({ timeout: 60000 }).catch(() => {});
  await p.waitForTimeout(3000); // the account's own settings arrive after the page draws
  const tarp = p.getByLabel("Tarping price, in dollars");
  check("Settings has the roadside plan and extra pay, with the owner's $75 driver assist", (await p.getByLabel("Roadside plan phone").count()) === 1 && (await p.getByLabel("Driver assist price, in dollars").inputValue().catch(() => "")) === "75");
  await tarp.fill("120");
  await tarp.blur();
  await p.getByLabel("Roadside plan name").fill("FleetAssist");
  await p.getByLabel("Roadside plan phone").fill("(800) 555-0177");
  await p.getByLabel("Roadside plan phone").blur();
  let saved = "";
  for (let i = 0; i < 20 && !/120.*FleetAssist/.test(saved); i++) {
    await sleep(500);
    saved = db(`select coalesce(settings->'extraPay'->>'tarp', '') || '|' || coalesce(settings->'roadsidePlan'->>'name', '') from carriers where id = '${cid}'`);
  }
  check("...and what's typed is saved", saved === "120|FleetAssist", saved);
  await p.goto(`${BASE}/carrier/loads/rd-1`, { waitUntil: "domcontentloaded" });
  await p.getByText("Reported stolen").first().waitFor({ timeout: 60000 }).catch(() => {});
  const timeline = await p.locator("section", { hasText: "Timeline" }).first().innerText().catch(() => "");
  check("the load's timeline shows what happened and what was claimed", /Reported stolen/.test(timeline) && /Tarping \$100 claimed/.test(timeline), timeline.slice(0, 600));
  check("no page errors", errors.length === 0, errors.join(" | "));
  await browser.close();

  // Leave nothing behind for the suites after this one.
  db(`update carriers set settings = settings - 'extraPay' - 'roadsidePlan' where id = '${cid}'`);
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
