// The owner's and driver's quick paths, end to end against the stand-ins: an AI email held for Undo (stopped, and
// sent when not), Yes/No from a phone notification (signed, one item, once), and the fleet read from a photo.
const path = require("path");
const S = path.join(__dirname, "..");
const ROOT = path.join(__dirname, "../..");
const crypto = require("crypto");
const fs = require("fs");
const { execSync } = require("child_process");
const BASE = "http://localhost:3210";
let passed = 0, failed = 0;
const check = (label, ok, extra = "") => { ok ? passed++ : failed++; console.log(`${ok ? "PASS" : "FAIL"} ${label}${extra ? ` (${String(extra).slice(0, 500)})` : ""}`); };
const db = (q) => execSync(`su postgres -c "/usr/lib/postgresql/16/bin/psql -h /var/lib/postgresql/backroute-test -p 55432 -U postgres -d rest -tA -c \\"${q.replace(/"/g, '\\\\\\"').replace(/\$/g, () => "\\\\\\$")}\\""`).toString().trim();
const read = (f) => (fs.existsSync(`${S}/fakes/${f}.jsonl`) ? fs.readFileSync(`${S}/fakes/${f}.jsonl`, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const cid = fs.readFileSync(`${S}/fakes/carrier.txt`, "utf8").trim();
const token = (sub, phone) => execSync(`node ${S}/pgrst/jwt.cjs ${sub} ${phone}`).toString();
const OWNER = token("aaaaaaaa-0000-0000-0000-000000000001", "12145550100");
const DRIVER = token("dddddddd-0000-0000-0000-000000000003", "12145550148");
const api = (path, { method = "GET", body, as = OWNER, form } = {}) =>
  fetch(`${BASE}${path}`, { method, headers: { ...(as ? { authorization: `Bearer ${as}` } : {}), ...(body ? { "content-type": "application/json" } : {}) }, body: form ?? (body ? JSON.stringify(body) : undefined) }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) }));
const RUN = Date.now().toString(36);
const SERVICE_KEY = fs.readFileSync(`${S}/fakes/env.sh`, "utf8").match(/SUPABASE_SERVICE_ROLE_KEY=(\S+)/)[1];
let n = 0;
const inbound = db(`select inbound_key from carriers where id = '${cid}'`);
const email = (subject, text, from) =>
  fetch(`${BASE}/api/channels/email?token=email-hook-secret`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ MessageID: `ux-${RUN}-${n++}`, From: from, FromName: "Kim", FromFull: { Email: from, Name: "Kim" }, To: `abc123+${inbound}@inbound.postmarkapp.com`, MailboxHash: inbound, Subject: subject, TextBody: text, Headers: [], Attachments: [] }) }).then((r) => r.json());
const toBroker = (from, i) => read("postmark").slice(i).map((m) => m.body).filter((m) => m?.To === from);

function put(table, id, data, cols) {
  db(`delete from ${table} where carrier_id = '${cid}' and id = '${id}'`);
  db(`insert into ${table} (id, carrier_id, ${Object.keys(cols).join(", ")}, data) values ('${id}', '${cid}', ${Object.values(cols).map((v) => (v === null ? "null" : `'${v}'`)).join(", ")}, '${JSON.stringify(data).replace(/'/g, "''")}'::jsonb)`);
}
const truck = (id, unit, driverId, equipment, city, state) => ({ id, unitNumber: unit, driverId, carrierId: "carrier-titan", equipmentType: equipment, status: "available", currentCity: city, currentState: state, homeBase: `${city}, ${state}`, currentLoadId: null, nextLoadId: null, mpg: 6.5, odometer: 0, lastServiceMiles: 0, serviceIntervalMiles: 25000, nextInspectionDue: new Date(Date.now() + 300 * 86400000).toISOString() });
const driver = (id, name, phone, truckId, city, state) => ({ id, name, phone, email: "", truckId, carrierId: "carrier-titan", hosStatus: "on_duty", hoursRemaining: 11, cdl: "", rating: 5, hireDate: new Date().toISOString(), homeBase: `${city}, ${state}`, runType: "regional", homeTimeTarget: "Flexible", payType: "percentage", payRate: 0.28, prefs: { language: "en" } });

(async () => {
  db(`update carriers set settings = settings || '{"autonomy":"rules","sandbox":false,"minRpm":2.0,"undoSeconds":6}'::jsonb where id = '${cid}'`);
  // Two free trucks of our own: a reefer near Fort Worth and a dry van in Memphis.
  put("drivers", "ux-d1", driver("ux-d1", "Uma Reyes", "+12145550181", "ux-t1", "Fort Worth", "TX"), { name: "Uma Reyes", phone: "+12145550181" });
  put("trucks", "ux-t1", truck("ux-t1", "UX1", "ux-d1", "Reefer", "Fort Worth", "TX"), { unit_number: "UX1", driver_id: "ux-d1" });
  put("drivers", "ux-d2", driver("ux-d2", "Ola Park", "+12145550182", "ux-t2", "Memphis", "TN"), { name: "Ola Park", phone: "+12145550182" });
  put("trucks", "ux-t2", truck("ux-t2", "UX2", "ux-d2", "Dry Van", "Memphis", "TN"), { unit_number: "UX2", driver_id: "ux-d2" });

  // ── An email the AI writes on its own waits for Undo ──
  const from = `kim@midsouth-ux-${RUN}.test`;
  let pm = read("postmark").length;
  await email(`Loads available ux ${RUN}`, "Hi, loads available for your reefers. Kim, Midsouth Logistics, our MC number is 777002", from);
  await sleep(4000);
  let held = await api("/api/agent/undo");
  const h1 = held.body.held?.find((h) => /^Asking .* to book .* at \$/.test(h.summary));
  check("the AI's book request waits for Undo, and the owner sees what it is", held.status === 200 && !!h1 && Date.parse(h1.sendAt) > Date.now(), JSON.stringify(held.body));
  check("…nothing has gone to the broker yet", toBroker(from, pm).length === 0);
  check("drivers can't see or stop it", (await api("/api/agent/undo", { as: DRIVER })).status === 401 && (await api("/api/agent/undo", { method: "POST", as: DRIVER, body: { id: h1?.id ?? "hs_0000000000000000" } })).status === 401);
  let r = await api("/api/agent/undo", { method: "POST", body: { id: h1?.id } });
  const back = db(`select stage from loads where carrier_id = '${cid}' and id = '${h1?.loadId}'`);
  check("Undo stops it and puts the load back with its offers", r.status === 200 && /back with its offers/.test(r.body.note ?? "") && back === "offered", JSON.stringify({ r: r.body, back }));
  await sleep(8000);
  // Other free trucks (left by earlier suites) can draw their own requests from the same email; only this one must stay.
  const dest = (h1?.summary ?? "").match(/→ (.+?) at \$/)?.[1] ?? "??";
  const leaked = toBroker(from, pm).filter((m) => `${m.Subject} ${m.TextBody}`.includes(dest));
  check("…and it never goes", leaked.length === 0 && db(`select status from held_sends where id = '${h1?.id}'`) === "stopped", JSON.stringify(leaked.map((m) => m.Subject)));
  check("…stopping it twice says it's too late (nothing to stop)", (await api("/api/agent/undo", { method: "POST", body: { id: h1?.id } })).status === 409);

  // The first email can take the Memphis van (its other load); this one gets a free van of its own.
  put("drivers", "ux-d3", driver("ux-d3", "Ivy Cole", "+12145550183", "ux-t3", "Memphis", "TN"), { name: "Ivy Cole", phone: "+12145550183" });
  put("trucks", "ux-t3", truck("ux-t3", "UX3", "ux-d3", "Dry Van", "Memphis", "TN"), { unit_number: "UX3", driver_id: "ux-d3" });
  pm = read("postmark").length;
  await email(`More loads ux ${RUN}`, "More loads for your dry vans. Kim, Midsouth Logistics, our MC number is 777002", from);
  await sleep(3000);
  held = await api("/api/agent/undo");
  const h2 = held.body.held?.find((h) => /to book/.test(h.summary));
  check("a second one waits too", !!h2, JSON.stringify(held.body));
  await sleep(9000);
  const went = toBroker(from, pm);
  check("…left alone, it goes by itself when the wait is over", went.length === 1 && db(`select status from held_sends where id = '${h2?.id}'`) === "sent" && db(`select data->'bookRequest'->>'status' from loads where carrier_id = '${cid}' and id = '${h2?.loadId}'`) === "sent", JSON.stringify(went.map((m) => m.Subject)));

  // ── Yes / No from the phone notification ──
  const mint = (escId, exp = Math.floor(Date.now() / 1000) + 3600) => {
    const key = crypto.createHmac("sha256", SERVICE_KEY).update("backroute-answer-links").digest();
    const bodyPart = Buffer.from(JSON.stringify({ c: cid, e: escId, x: exp })).toString("base64url");
    return `${bodyPart}.${crypto.createHmac("sha256", key).update(bodyPart).digest("base64url")}`;
  };
  const esc = (id, to) => put("escalations", id, { id, loadId: "", carrierId: "carrier-titan", reason: "Send this note?", createdAt: new Date().toISOString(), status: "open", complexity: "routine", recommendedAction: "approve", recommendedLabel: "Send this note", source: "email", draft: { channel: "email", to, subject: `Note ${RUN}`, body: "Thanks, we have it.", purpose: "ack" } }, { load_id: null, status: "open" });
  const yesTo = `yes-ux-${RUN}@broker.test`, noTo = `no-ux-${RUN}@broker.test`;
  esc(`esc-ux-yes-${RUN}`, yesTo);
  esc(`esc-ux-no-${RUN}`, noTo);
  pm = read("postmark").length;
  r = await fetch(`${BASE}/api/agent/answer`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: mint(`esc-ux-yes-${RUN}`), answer: "yes" }) }).then(async (x) => ({ status: x.status, body: await x.json() }));
  check("Yes on the notification sends it, without the app", r.status === 200 && r.body.note === "Sent." && toBroker(yesTo, pm).length === 1 && db(`select status from escalations where carrier_id = '${cid}' and id = 'esc-ux-yes-${RUN}'`) === "resolved", JSON.stringify(r.body));
  r = await fetch(`${BASE}/api/agent/answer`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: mint(`esc-ux-yes-${RUN}`), answer: "yes" }) }).then(async (x) => ({ status: x.status, body: await x.json() }));
  check("…a second tap does nothing more", r.body.already === true && toBroker(yesTo, pm).length === 1);
  r = await fetch(`${BASE}/api/agent/answer`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: mint(`esc-ux-no-${RUN}`), answer: "no" }) }).then(async (x) => ({ status: x.status, body: await x.json() }));
  check("No leaves it unsent", r.body.note === "Not sent." && toBroker(noTo, pm).length === 0 && db(`select status from escalations where carrier_id = '${cid}' and id = 'esc-ux-no-${RUN}'`) === "resolved");
  const forged = mint(`esc-ux-no-${RUN}`).replace(/.$/, (c) => (c === "A" ? "B" : "A"));
  const expired = mint(`esc-ux-no-${RUN}`, Math.floor(Date.now() / 1000) - 10);
  const st = async (t) => (await fetch(`${BASE}/api/agent/answer`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: t, answer: "yes" }) })).status;
  check("a changed or expired token is refused", (await st(forged)) === 401 && (await st(expired)) === 401);

  // ── The fleet from a photo ──
  const photo = (bytes, type = "image/png") => {
    const form = new FormData();
    form.append("photo", new File([bytes], "board.png", { type }));
    return form;
  };
  r = await api("/api/import/fleet-photo", { method: "POST", form: photo(Buffer.alloc(400, 7)) });
  const rows = r.body.rows ?? [];
  check("a photo of the whiteboard becomes rows to check", r.status === 200 && r.body.isFleetList === true && rows.length === 2 && rows[0].driverName === "Rosa Diaz" && rows[0].unitNumber === "301" && rows[0].homeState === "TX", JSON.stringify(r.body));
  check("…phone numbers only when they're whole, never guessed", rows[0]?.phone === "2145550177" && rows[1]?.phone === "", JSON.stringify(rows.map((x) => x.phone)));
  check("…and the hard-to-read row is marked", rows[1]?.sure === false);
  check("…nothing is saved until the owner says", db(`select count(*) from trucks where carrier_id = '${cid}' and unit_number = '301'`) === "0");
  r = await api("/api/import/fleet-photo", { method: "POST", form: photo(Buffer.from("x")) });
  check("a picture that isn't a fleet list says so", r.status === 200 && r.body.isFleetList === false && !r.body.rows?.length, JSON.stringify(r.body));
  check("drivers can't use it, and it takes only photos", (await api("/api/import/fleet-photo", { method: "POST", as: DRIVER, form: photo(Buffer.alloc(400, 7)) })).status === 401 && (await api("/api/import/fleet-photo", { method: "POST", form: photo(Buffer.from("%PDF"), "application/pdf") })).status === 400);

  // Put the shared fleet back the way other suites expect it.
  db(`update carriers set settings = settings - 'undoSeconds' where id = '${cid}'`);
  db(`delete from loads where carrier_id = '${cid}' and truck_id in ('ux-t1', 'ux-t2', 'ux-t3')`);
  db(`delete from trucks where carrier_id = '${cid}' and id in ('ux-t1', 'ux-t2', 'ux-t3')`);
  db(`delete from drivers where carrier_id = '${cid}' and id in ('ux-d1', 'ux-d2', 'ux-d3')`);
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
