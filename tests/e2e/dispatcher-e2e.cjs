// The dispatcher's judgment against the stand-ins: asking more (and saying why) for harder freight, holding loads
// that look like scams, picking the better of the same load from two brokers, coming back to a load reposted higher,
// a driver's no-go cities and a truck's missing gear, a rate con for another load number, a quiet ELD on a load, and
// the settings and readiness marks in the browser.
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
const cron = () => fetch(`${BASE}/api/cron/dispatch`, { headers: { authorization: "Bearer cron-secret" } }).then((r) => r.json());
const settings = (patch) => db(`update carriers set settings = settings || '${JSON.stringify(patch)}'::jsonb where id = '${cid}'`);
const key = db(`select inbound_key from carriers where id = '${cid}'`);
const RUN = Date.now().toString(36);
const MARCUS = "+12145550148";
let n = 0;
const email = (from, name, subject, text, attachments = []) =>
  fetch(`${BASE}/api/channels/email?token=email-hook-secret`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ MessageID: `pm-dp-${RUN}-${++n}`, From: from, FromName: name, FromFull: { Email: from, Name: name }, To: `abc123+${key}@inbound.postmarkapp.com`, MailboxHash: key, Subject: subject, TextBody: text, Headers: [{ Name: "Message-ID", Value: `<dp-${RUN}-${n}@x.test>` }], Attachments: attachments }) });
const pdf = (name) => [{ Name: name, Content: Buffer.from("%PDF-1.4").toString("base64"), ContentType: "application/pdf", ContentLength: 900 }];
const day = (d, hhmm) => new Date(Date.now() + d * 86400000).toISOString().slice(0, 10) + "T" + hhmm;
// Picks up on a weekday two to four days out, so a weekend never adds to what's being checked.
const weekday = (hhmm) => {
  for (let d = 2; d < 6; d++) {
    const at = new Date(Date.now() + d * 86400000);
    if (at.getUTCDay() !== 0 && at.getUTCDay() !== 6) return day(d, hhmm);
  }
  return day(2, hhmm);
};
const offerFile = `${S}/fakes/offers.json`;
async function offers(from, name, list, subject = "Loads available") {
  fs.writeFileSync(offerFile, JSON.stringify(list));
  await email(from, name, `${subject} ${RUN}-${n + 1}`, "See loads below. MC 771999");
  await sleep(2500);
  fs.unlinkSync(offerFile);
}
const load = (ref) => JSON.parse(db(`select data from loads where carrier_id = '${cid}' and data->>'referenceNumber' = '${ref}' order by updated_at desc limit 1`) || "null");
const truckBy = (unit) => JSON.parse(db(`select data from trucks where carrier_id = '${cid}' and unit_number = '${unit}'`));
const setTruck = (unit, patch) => db(`update trucks set data = data || '${JSON.stringify(patch).replace(/'/g, "''")}'::jsonb where carrier_id = '${cid}' and unit_number = '${unit}'`);
const setDriverPrefs = (truckUnit, prefs) => {
  const d = truckBy(truckUnit).driverId;
  db(`update drivers set data = jsonb_set(data, '{prefs}', coalesce(data->'prefs', '{}'::jsonb) || '${JSON.stringify(prefs)}'::jsonb) where carrier_id = '${cid}' and id = '${d}'`);
};
function freeTrucks() {
  db(`update loads set stage = 'declined', data = data || '{"stage":"declined"}'::jsonb where carrier_id = '${cid}' and stage in ('offered', 'negotiating', 'booked', 'dispatched', 'at_pickup', 'in_transit', 'at_delivery')`);
  db(`update trucks set data = data || '{"nextLoadId":null,"currentLoadId":null,"status":"available","currentCity":"Dallas","currentState":"TX"}'::jsonb where carrier_id = '${cid}' and unit_number in ('101', '102')`);
}
const broker = (id, company, mail, mc) => {
  const b = { id, carrierId: cid, company, contact: "Dee", phone: "", email: mail, reliability: 90, avgResponseMins: 20, loadsBooked: 0, onTimePct: 95, avgRateVariancePct: 0, tier: "standard", authorityVerified: true, mc, legalName: company, verifiedAt: new Date().toISOString(), verifyNote: "FMCSA: broker authority active.", fraudRisk: "low", avgDaysToPay: 30, detentionPaidPct: 80, cancellations90d: 0 };
  db(`insert into records (carrier_id, id, kind, data) values ('${cid}', '${id}', 'broker', '${JSON.stringify(b).replace(/'/g, "''")}'::jsonb) on conflict (carrier_id, kind, id) do update set data = excluded.data`);
};
const lane = (o) => ({ originCity: "Dallas", originState: "TX", destinationCity: "Memphis", destinationState: "TN", equipment: "Dry van", miles: 452, pickupLocal: weekday("09:00"), ...o });

(async () => {
  settings({ sandbox: false, paused: false, autonomy: "rules", askPremiums: true, minRpm: 2, maxDeadhead: 300, checkIns: false, driverCheckins: false });
  // Only trucks 101 (dry van, Marcus) and 102 (reefer) take loads here: others added by earlier suites are parked, and
  // a connected ELD would put a fresh location on 101 every round.
  db(`update trucks set data = data || '{"status":"maintenance"}'::jsonb where carrier_id = '${cid}' and unit_number not in ('101', '102')`);
  db(`delete from carrier_integrations where carrier_id = '${cid}' and kind in ('samsara', 'motive', 'geotab')`);
  freeTrucks();
  setTruck("101", { position: null, gear: null });
  broker("dp-a", "Alpha Logistics", "kim@alphalog.test", "771001");
  broker("dp-b", "Bravo Freight", "lee@bravofreight.test", "771002");

  // ── Harder freight: asked more, and the broker's told why ─────────────────
  let p0 = read("postmark").length;
  await offers("kim@alphalog.test", "Kim", [lane({ loadNumber: `HV-${RUN}`, rate: 1800, notes: "Electronics (TVs), high value. Team not required." })]);
  let l = load(`HV-${RUN}`);
  check("high-value freight: the ask goes up 5%, and why is kept", l?.stage === "negotiating" && l.premium?.pct === 5 && l.premium.reasons.includes("high-value freight"), JSON.stringify({ stage: l?.stage, premium: l?.premium, target: l?.targetRate }));
  const ask = read("postmark").slice(p0).map((m) => m.body).find((m) => m.To === "kim@alphalog.test" && /Our rate is/.test(m.TextBody ?? ""));
  check("...the book request gives the broker the one reason", !!ask && /That's for high-value freight\./.test(ask.TextBody), ask?.TextBody?.slice(0, 300));
  check("...and the owner sees it in the why", (l?.why?.lines ?? []).some((x) => /Asked 5% more: high-value freight/.test(x)), JSON.stringify(l?.why?.lines));
  settings({ askPremiums: false });
  freeTrucks();
  await offers("kim@alphalog.test", "Kim", [lane({ loadNumber: `HV2-${RUN}`, rate: 1800, notes: "Electronics, high value" })]);
  check("turned off in Settings: no premium", load(`HV2-${RUN}`)?.stage === "negotiating" && !load(`HV2-${RUN}`)?.premium, JSON.stringify(load(`HV2-${RUN}`)?.premium));
  settings({ askPremiums: true });

  // ── Loads that look wrong are held for the owner ─────────────────────────
  freeTrucks();
  await offers("kim@alphalog.test", "Kim", [lane({ loadNumber: `BAIT-${RUN}`, destinationCity: "Atlanta", destinationState: "GA", miles: 780, rate: 6200 })]);
  l = load(`BAIT-${RUN}`);
  check("a rate far over what freight pays: offered, not asked for, with a warning", l?.stage === "offered" && (l.scheduleWarnings ?? []).some((w) => w.hard && /far over|the market/.test(w.text)), JSON.stringify({ stage: l?.stage, w: l?.scheduleWarnings }));
  freeTrucks();
  await offers("kim@alphalog.test", "Kim", [lane({ loadNumber: `FEE-${RUN}`, rate: 1700, notes: "Carrier must pay a $150 dispatch fee upfront by Zelle before load info is released" })]);
  l = load(`FEE-${RUN}`);
  check("a post asking the carrier to pay first: held as a scam", l?.stage === "offered" && (l.scheduleWarnings ?? []).some((w) => w.hard && /scam/.test(w.text)), JSON.stringify(l?.scheduleWarnings));

  // ── The same freight from two brokers: the better one ─────────────────────
  settings({ autonomy: "ask" });
  freeTrucks();
  const pick = weekday("10:00");
  await offers("kim@alphalog.test", "Kim", [lane({ loadNumber: `TW1-${RUN}`, rate: 1700, pickupLocal: pick })]);
  await offers("lee@bravofreight.test", "Lee", [lane({ loadNumber: `TW2-${RUN}`, rate: 1900, pickupLocal: pick })]);
  const a = load(`TW1-${RUN}`), b = load(`TW2-${RUN}`);
  check("the same load from another broker for more: the first is set aside with a note", (a?.scheduleWarnings ?? []).some((w) => w.hard && w.text.startsWith(`Same freight as TW2-${RUN} from Bravo Freight`)) && b?.twinId === a?.id && !(b?.scheduleWarnings ?? []).some((w) => w.hard), JSON.stringify({ a: a?.scheduleWarnings, b: b?.scheduleWarnings, twin: b?.twinId }));

  // ── Reposted higher: back on the table ───────────────────────────────────
  freeTrucks();
  await offers("kim@alphalog.test", "Kim", [lane({ loadNumber: `RP-${RUN}`, rate: 1500 })]);
  db(`update loads set stage = 'declined', data = data || '{"stage":"declined"}'::jsonb where carrier_id = '${cid}' and data->>'referenceNumber' = 'RP-${RUN}'`);
  await offers("kim@alphalog.test", "Kim", [lane({ loadNumber: `RP-${RUN}`, rate: 1750 })]);
  l = load(`RP-${RUN}`);
  check("a load we passed on, posted again higher: offered again, the new rate kept, the repost counted", l?.stage === "offered" && l.listedRate === 1750 && l.repostCount === 1 && (l.why?.lines ?? []).some((x) => /Posted again at \$1,750, up from \$1,500/.test(x)), JSON.stringify({ stage: l?.stage, listed: l?.listedRate, count: l?.repostCount, why: l?.why }));
  const count = Number(db(`select count(*) from loads where carrier_id = '${cid}' and data->>'referenceNumber' = 'RP-${RUN}'`));
  check("...the same load, not a second copy", count === 1, count);

  // ── A driver's no-go city, and gear the truck doesn't carry ─────────────
  freeTrucks();
  setDriverPrefs("101", { avoidCities: ["Memphis"] });
  await offers("kim@alphalog.test", "Kim", [lane({ loadNumber: `AV-${RUN}`, rate: 1800 })]);
  check("a city the only fitting driver avoids: not offered to that truck", !load(`AV-${RUN}`), JSON.stringify(load(`AV-${RUN}`)?.truckId));
  setDriverPrefs("101", { avoidCities: [] });
  setTruck("101", { gear: ["straps"] });
  await offers("kim@alphalog.test", "Kim", [lane({ loadNumber: `GR-${RUN}`, rate: 1800, notes: "Tarps required, 8ft drops" })]);
  check("a load asking for tarps the truck doesn't carry: not offered to it", !load(`GR-${RUN}`));
  setTruck("101", { gear: ["straps", "tarps"] });
  await offers("kim@alphalog.test", "Kim", [lane({ loadNumber: `GR2-${RUN}`, rate: 1800, notes: "Tarps required" })]);
  check("...once the owner lists tarps on the truck, it is", !!load(`GR2-${RUN}`));
  setTruck("101", { gear: null });

  // ── A rate con for another load number ───────────────────────────────────
  settings({ autonomy: "rules" });
  freeTrucks();
  broker("dp-c", "Charlie Line", "ops@charlieline.test", "771003");
  db(`delete from loads where carrier_id = '${cid}' and id = 'dp-rc'`);
  db(`insert into loads (id, carrier_id, truck_id, stage, data) select 'dp-rc', carrier_id, truck_id, 'negotiating', data || '${JSON.stringify({ id: "dp-rc", stage: "negotiating", referenceNumber: `RC-${RUN}`, brokerId: "dp-c", brokerContactEmail: "ops@charlieline.test", offerEmail: { subject: "Load RC", messageId: "<rc@x.test>" }, bookRequest: { ask: 1850, askedAt: new Date().toISOString(), status: "accepted" }, targetRate: 1850, rateConReading: null, invoice: null, updatedAt: new Date().toISOString() })}'::jsonb from loads where carrier_id = '${cid}' and data->>'referenceNumber' = 'CFP-88213' limit 1`);
  fs.writeFileSync(`${S}/fakes/ratecon.json`, JSON.stringify({ broker: "Charlie Line", brokerMc: "MC 771003", brokerEmail: "ops@charlieline.test", loadNumber: "ZZ-4410", totalRate: 1850, mismatches: [], otherConcerns: [], summary: "Matches." }));
  p0 = read("postmark").length;
  await email("ops@charlieline.test", "Dee", "Rate confirmation attached", "Attached.", pdf("rc.pdf"));
  await sleep(3500);
  fs.unlinkSync(`${S}/fakes/ratecon.json`);
  l = JSON.parse(db(`select data from loads where carrier_id = '${cid}' and id = 'dp-rc'`));
  const fix = read("postmark").slice(p0).map((m) => m.body).find((m) => m.To === "ops@charlieline.test" && /ZZ-4410/.test(m.TextBody ?? ""));
  check("a rate con naming another load number than the broker gave us: not booked, a corrected one asked for", l.stage === "negotiating" && !!fix && new RegExp(`RC-${RUN}`).test(fix.TextBody), fix?.TextBody?.slice(0, 300) ?? l.stage);

  // ── The ELD goes quiet on a load ──────────────────────────────────────────
  freeTrucks();
  const t101 = truckBy("101");
  db(`delete from loads where carrier_id = '${cid}' and id = 'dp-quiet'`);
  db(`insert into loads (id, carrier_id, truck_id, stage, data) select 'dp-quiet', carrier_id, '${t101.id}', 'in_transit', data || '${JSON.stringify({ id: "dp-quiet", stage: "in_transit", referenceNumber: `Q-${RUN}`, truckId: t101.id, deliveryAt: new Date(Date.now() + 20 * 3600000).toISOString(), updatedAt: new Date().toISOString() })}'::jsonb from loads where carrier_id = '${cid}' and data->>'referenceNumber' = 'CFP-88213' limit 1`);
  setTruck("101", { currentLoadId: "dp-quiet", status: "on_load", position: { lat: 32.9, lon: -96.4, at: new Date(Date.now() - 3 * 3600000).toISOString(), description: "I-30 near Greenville, TX", source: "motive" } });
  db(`update drivers set data = data || '{"hosStatus":"driving"}'::jsonb where carrier_id = '${cid}' and id = '${t101.driverId}'`);
  const t0 = read("twilio").length;
  const round = await cron();
  const asked = read("twilio").slice(t0).filter((x) => x.params.To === MARCUS && x.params.Body).map((x) => x.params.Body).find((x) => /ELD hasn't sent a location in about 3 hours/.test(x));
  check("the ELD quiet 3 hours on a load: the driver is asked where they are", !!asked && /near I-30 near Greenville, TX/.test(asked), asked ?? JSON.stringify(round).slice(0, 400));
  await cron();
  const again = read("twilio").slice(t0).filter((x) => x.params.To === MARCUS && /ELD hasn't sent/.test(x.params.Body ?? "")).length;
  check("...once, not every round", again === 1, again);
  freeTrucks();
  setTruck("101", { position: null });

  // ── In the browser ───────────────────────────────────────────────────────
  const session = JSON.stringify({ access_token: OWNER, refresh_token: "x", token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: OWNER_SUB, phone: OWNER_PHONE, aud: "authenticated", role: "authenticated", app_metadata: {}, user_metadata: {} } });
  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ARGS });
  const p = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await p.evaluate((s) => localStorage.setItem("sb-localhost-auth-token", s), session);
  await p.goto(`${BASE}/carrier/settings`, { waitUntil: "domcontentloaded" });
  await p.getByLabel("Ready for full autopilot").waitFor({ timeout: 120000 }).catch(() => {});
  const ready = await p.getByLabel("Ready for full autopilot").innerText().catch(() => "");
  check("Basics shows what full autopilot should be earned with", /10 loads booked by Backroute and delivered/.test(ready) && /You said yes to 9 in 10 of its asks/.test(ready), ready.slice(0, 300));
  await p.goto(`${BASE}/carrier/settings?tab=general`, { waitUntil: "domcontentloaded" });
  await p.getByText("Ask more when a load is harder").first().waitFor({ timeout: 60000 }).catch(() => {});
  check("Settings has the premiums switch and the repair limit", (await p.getByText("Ask more when a load is harder").count()) > 0 && (await p.getByLabel("Repairs Backroute can okay, in dollars").count()) === 1);
  const limit = p.getByLabel("Repairs Backroute can okay, in dollars");
  await p.waitForTimeout(3000); // the account's own settings arrive after the page draws
  await limit.fill("1500");
  await limit.blur();
  let saved = "";
  for (let i = 0; i < 20 && saved !== "1500"; i++) {
    await sleep(500);
    saved = db(`select coalesce(settings->>'repairLimit', '') from carriers where id = '${cid}'`);
  }
  check("...and the limit is saved", saved === "1500", saved);
  check("no page errors", errors.length === 0, errors.join(" | "));
  await browser.close();
  settings({ askPremiums: false, autonomy: "rules" });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error(e);
  if (fs.existsSync(offerFile)) fs.unlinkSync(offerFile);
  process.exit(1);
});
