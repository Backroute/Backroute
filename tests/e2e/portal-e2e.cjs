// Broker websites, end to end against stand-in sites (fakes/portals.cjs) and the real browser worker
// (portal-worker/worker.mjs, with Chromium): signing a rate con in a DocuSign-style site, stopping on a rate that
// doesn't match, a carrier setup with sign-up, an emailed code, a question for the owner and the owner's OK, a dock
// appointment on a scheduling site, the worker being down, and that no password or private answer leaks anywhere.
const path = require("path");
const S = path.join(__dirname, "..");
const ROOT = path.join(__dirname, "../..");
const fs = require("fs");
const { execSync, spawn } = require("child_process");
const BASE = "http://localhost:3210";
const SITE = "http://127.0.0.1:3021";
let passed = 0, failed = 0;
const check = (label, ok, extra = "") => { ok ? passed++ : failed++; console.log(`${ok ? "PASS" : "FAIL"} ${label}${extra ? ` (${String(extra).slice(0, 400)})` : ""}`); };
const db = (q) => execSync(`su postgres -c "/usr/lib/postgresql/16/bin/psql -h /var/lib/postgresql/backroute-test -p 55432 -U postgres -d rest -tA -c \\"${q.replace(/"/g, '\\\\\\"').replace(/\$/g, () => "\\\\\\$")}\\""`).toString().trim();
const read = (f) => fs.readFileSync(`${S}/fakes/${f}.jsonl`, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const cid = fs.readFileSync(`${S}/fakes/carrier.txt`, "utf8").trim();
const cron = () => fetch(`${BASE}/api/cron/dispatch`, { headers: { authorization: "Bearer cron-secret" } }).then((r) => r.json());
const settings = (patch) => db(`update carriers set settings = settings || '${JSON.stringify(patch).replace(/'/g, "''")}'::jsonb where id = '${cid}'`);
const loadById = (id) => JSON.parse(db(`select data from loads where carrier_id = '${cid}' and id = '${id}'`) || "null");
const sent = (i) => read("postmark").slice(i).map((x) => x.body);
const texts = (i) => read("twilio").slice(i).filter((x) => x.params.Body).map((x) => x.params.Body);
const key = db(`select inbound_key from carriers where id = '${cid}'`);
const truckBy = (unit) => JSON.parse(db(`select data from trucks where carrier_id = '${cid}' and unit_number = '${unit}'`));
const RUN = Date.now().toString(36);
let n = 0;
async function email(from, name, subject, text) {
  const body = { MessageID: `pm-portal-${RUN}-${++n}`, From: from, FromName: name, FromFull: { Email: from, Name: name }, To: `abc123+${key}@inbound.postmarkapp.com`, MailboxHash: key, Subject: subject, TextBody: text, Headers: [{ Name: "Message-ID", Value: `<portal-${RUN}-${n}@x.test>` }], Attachments: [] };
  await fetch(`${BASE}/api/channels/email?token=email-hook-secret`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  await sleep(2500);
}
const token = (sub, phone) => execSync(`node ${S}/pgrst/jwt.cjs ${sub} ${phone}`).toString();
const OWNER = token("aaaaaaaa-0000-0000-0000-000000000001", "12145550100");
const SUPPORT = token("cccccccc-0000-0000-0000-000000000005", "13125550100");
const owner = (method, body, query = "") => fetch(`${BASE}/api/portal${query}`, { method, headers: { authorization: `Bearer ${OWNER}`, ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) }));
const task = (where) => JSON.parse(db(`select row_to_json(t) from portal_tasks t where carrier_id = '${cid}' and ${where} order by created_at desc limit 1`) || "null");
const state = () => fetch(`${SITE}/state`).then((r) => r.json());
async function until(label, fn, ms = 90_000) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) { console.log(`… timed out waiting for ${label}`); return null; }
    await sleep(1000);
  }
}
const PF = "loads@portalfreight.test";
const broker = (id, company, email) => {
  const b = { id, carrierId: cid, company, contact: "Dana", phone: "", email, reliability: 90, avgResponseMins: 20, loadsBooked: 0, onTimePct: 95, avgRateVariancePct: 0, tier: "standard", authorityVerified: true, mc: "771888", legalName: company, verifiedAt: new Date().toISOString(), verifyNote: "FMCSA: broker authority active.", fraudRisk: "low", avgDaysToPay: 30, detentionPaidPct: 80, cancellations90d: 0 };
  db(`insert into records (carrier_id, id, kind, data) values ('${cid}', '${id}', 'broker', '${JSON.stringify(b).replace(/'/g, "''")}'::jsonb) on conflict (carrier_id, kind, id) do update set data = excluded.data`);
};
const copyLoad = (id, patch, stage, truckId) => {
  db(`delete from loads where carrier_id = '${cid}' and id = '${id}'`);
  db(`insert into loads (id, carrier_id, truck_id, stage, data) select '${id}', carrier_id, ${truckId ? `'${truckId}'` : "null"}, '${stage}', (data - 'rateConSignedAt' - 'rateConSignedBy' - 'appointments') || '${JSON.stringify({ id, stage, updatedAt: new Date().toISOString(), truckId: truckId ?? null, ...patch }).replace(/'/g, "''")}'::jsonb from loads where carrier_id = '${cid}' and data->>'referenceNumber' = 'CFP-88213' limit 1`);
};
const day = (d) => new Date(Date.now() + d * 86400000).toISOString().slice(0, 10);

let worker = null;
let workerOut = "";
function startWorker() {
  worker = spawn("node", [ROOT + "/portal-worker/worker.mjs"], {
    env: { ...process.env, APP_URL: BASE, PORTAL_WORKER_SECRET: "portal-secret", WORKER_ID: "test-worker", WORKER_CONCURRENCY: "1", POLL_SECONDS: "1", CHROMIUM_PATH: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", ALLOW_PRIVATE_HOSTS: "1", CHROMIUM_ARGS: "--host-resolver-rules=MAP opendock.com 127.0.0.1", PORT: "8091", NODE_PATH: ROOT + "/portal-worker/node_modules" },
    cwd: ROOT + "/portal-worker",
  });
  worker.stdout.on("data", (d) => (workerOut += d));
  worker.stderr.on("data", (d) => (workerOut += d));
}
const stopWorker = async () => { if (worker) { worker.kill("SIGTERM"); await sleep(1500); worker.kill("SIGKILL"); worker = null; } };

(async () => {
  const t101 = truckBy("101");
  settings({ autonomy: "rules", sandbox: false, rateConSigner: { name: "Maria Lopez", title: "Owner" }, ownerRules: {}, portalAi: false });
  broker("pw-broker", "Portal Freight", PF);
  db(`delete from portal_tasks where carrier_id = '${cid}'`);
  db(`delete from portal_logins where carrier_id = '${cid}'`);
  db(`delete from agent_marks where carrier_id = '${cid}' and load_id like 'pw-%'`);
  db(`delete from escalations where carrier_id = '${cid}' and data->>'portalTaskId' is not null`);
  db(`delete from carrier_files where carrier_id = '${cid}' and load_id like 'pw-%'`);
  db(`insert into auth.users values ('cccccccc-0000-0000-0000-000000000005', '13125550100') on conflict do nothing`);
  db(`insert into support_staff (user_id, name) values ('cccccccc-0000-0000-0000-000000000005', 'Sam') on conflict do nothing`);
  // A W-9 on file for the setup website.
  if (!db(`select id from carrier_files where carrier_id = '${cid}' and kind = 'w9' limit 1`))
    db(`insert into carrier_files (carrier_id, kind, name, content_type, size, data) values ('${cid}', 'w9', 'w9.pdf', 'application/pdf', 20, '${Buffer.from("%PDF-1.4 W-9 form\n%%EOF").toString("base64")}')`);
  const common = { brokerId: "pw-broker", brokerContactEmail: PF, rateConReading: null };
  copyLoad("pw-1", { ...common, referenceNumber: "PW-1001", bookedRate: 2600 }, "booked", t101.id);
  copyLoad("pw-2", { ...common, referenceNumber: "PW-1002", bookedRate: 2600 }, "booked", null);
  // Delivery at 8 AM Central the day after tomorrow, still waiting on its appointment (the broker was asked).
  copyLoad("pw-3", { ...common, referenceNumber: "PW-1003", bookedRate: 2600, deliveryAt: `${day(2)}T13:00:00.000Z`, appointments: { delivery: { purpose: "book", tries: 3, status: "broker", brokerAskedAt: new Date().toISOString() } } }, "dispatched", t101.id);
  copyLoad("pw-4", { ...common, referenceNumber: "PW-1004", bookedRate: 2600 }, "booked", null);

  // ── The worker's door is locked ──
  let r = await fetch(`${BASE}/api/portal/worker`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ op: "next", worker: "x" }) });
  check("the worker endpoint refuses a caller without the secret", r.status === 401, r.status);
  r = await fetch(`${BASE}/api/portal/worker`, { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer wrong-secret-xx" }, body: JSON.stringify({ op: "next", worker: "x" }) });
  check("…and one with the wrong secret", r.status === 401, r.status);

  // ── 0. Switched off for this carrier: support still does it ──
  await email(PF, "Dana Portal", "Carrier setup", `Please complete our carrier setup here: ${SITE}/mycarrierpackets/invite?broker=Off`);
  check("with the owner's switch off, a setup website still goes to support and no job is queued", db(`select count(*) from portal_tasks where carrier_id = '${cid}'`) === "0" && !!db(`select id from escalations where carrier_id = '${cid}' and status = 'with_support' and data->>'reason' like '%broker=Off%'`));
  settings({ portalAi: true });

  // ── 1. Sign in their DocuSign-style site ──
  let pm = read("postmark").length;
  await email(PF, "Dana Portal", "Rate con PW-1001", `Hi, please sign the rate confirmation for PW-1001 via DocuSign: ${SITE}/sign/pw1?ref=PW-1001&rate=2600 Thanks`);
  let t1 = task(`load_id = 'pw-1'`);
  check("a DocuSign link for a booked load becomes a signing job for the worker", t1?.kind === "sign_rate_con" && t1?.status === "queued", JSON.stringify(t1)?.slice(0, 200));
  check("…instead of asking the broker for a PDF", !sent(pm).some((b) => b.To === PF && /as a PDF/.test(b.TextBody)), JSON.stringify(sent(pm).map((b) => b.Subject)));
  await email(PF, "Dana Portal", "Rate con PW-1001", `Reminder: sign PW-1001 via DocuSign: ${SITE}/sign/pw1?ref=PW-1001&rate=2600`);
  check("the same request again doesn't queue it twice", db(`select count(*) from portal_tasks where carrier_id = '${cid}' and load_id = 'pw-1'`) === "1");

  startWorker();
  t1 = await until("signing done", () => { const t = task(`load_id = 'pw-1'`); return t && ["done", "failed"].includes(t.status) ? t : null; });
  let st = await state();
  check("the worker signed it on the site in the authorized signer's name", st.signed.pw1?.name === "Maria Lopez" && st.signed.pw1?.finished === true, JSON.stringify(st.signed.pw1));
  check("…after accepting the electronic records consent", st.signed.pw1?.consent === true);
  check("the job is done and the load shows the rate con signed", t1?.status === "done" && !!loadById("pw-1").rateConSignedAt && loadById("pw-1").rateConSignedBy === "Maria Lopez", `${t1?.status} ${t1?.data?.note} ${JSON.stringify(t1?.data?.steps?.slice(-4))}`);
  check("the signed copy was downloaded and kept with the load", st.signed.pw1?.downloaded === true && db(`select count(*) from carrier_files where carrier_id = '${cid}' and load_id = 'pw-1' and kind = 'rate_con_signed'`) === "1");
  check("screenshots of the moment before signing and the end are kept", Number(db(`select count(*) from carrier_files where carrier_id = '${cid}' and load_id = 'pw-1' and kind = 'portal_screenshot'`)) >= 2);
  check("the owner's activity log says where it was signed", /signed on 127\.0\.0\.1/.test(db(`select string_agg(data->>'message', ' | ') from activity where carrier_id = '${cid}' and data->>'loadId' = 'pw-1'`)));

  // ── 2. Their portal shows a different rate: not signed ──
  pm = read("postmark").length;
  await email(PF, "Dana Portal", "Rate con PW-1002", `Please sign PW-1002 in DocuSign: ${SITE}/sign/pw2?ref=PW-1002&rate=2300`);
  const t2 = await until("mismatch stop", () => { const t = task(`load_id = 'pw-2'`); return t && ["done", "failed"].includes(t.status) ? t : null; });
  st = await state();
  check("a rate in their portal that isn't what was agreed is not signed", t2?.status === "failed" && !st.signed.pw2?.name && !st.signed.pw2?.finished && !loadById("pw-2").rateConSignedAt, `${t2?.status} ${JSON.stringify(st.signed.pw2)}`);
  const fix = sent(pm).find((b) => b.To === PF && /2,300/.test(b.TextBody) && /2,600/.test(b.TextBody));
  check("the broker is asked to fix it, with both numbers", !!fix, JSON.stringify(sent(pm).map((b) => b.TextBody.slice(0, 160))));
  check("the owner hears it wasn't signed and why", !!db(`select id from escalations where carrier_id = '${cid}' and data->>'portalTaskId' = '${t2?.id}' and data->>'reason' like '%didn''t sign%'`));

  // ── 3. Carrier setup: sign up, emailed code, a question, the owner's OK ──
  pm = read("postmark").length;
  await email(PF, "Dana Portal", "Carrier setup", `Hi! Before we can book you, please complete our carrier setup here: ${SITE}/mycarrierpackets/invite?broker=Portal%20Freight Thanks`);
  const t3a = task(`kind = 'carrier_setup'`);
  check("a setup network invite becomes a setup job", !!t3a && t3a.url.includes("mycarrierpackets"), JSON.stringify(t3a)?.slice(0, 200));
  check("…and no support hand-off for it", !db(`select id from escalations where carrier_id = '${cid}' and data->>'status' = 'with_support' and data->>'reason' like '%broker=Portal%20Freight%'`));
  const asked = await until("the EIN question", () => { const t = task(`kind = 'carrier_setup'`); return t?.status === "needs_answer" ? t : t?.status === "failed" ? t : null; });
  st = await state();
  const acct = Object.keys(st.accounts)[0];
  check("the AI opened the carrier's account with its own address", acct === `abc123+${key}@inbound.postmarkapp.com`, acct);
  check("…verified it with the code the site emailed", st.accounts[acct]?.verified === true);
  check("the emailed code didn't get a reply or a draft (it was just typed in)", !sent(pm).some((b) => /mycarrierpackets/i.test(b.To)) && !db(`select id from escalations where carrier_id = '${cid}' and data->>'reason' like '%verification code%'`));
  const pw = st.accounts[acct]?.password ?? "NOPE";
  const vault = db(`select site || '|' || username || '|' || left(secret, 3) from portal_logins where carrier_id = '${cid}' and kind = 'login'`);
  check("the new password went into the vault, encrypted", vault.startsWith(`127.0.0.1|abc123+${key}@`) && vault.endsWith("|v1.") && !db(`select count(*) from portal_logins where carrier_id = '${cid}' and secret like '%${pw}%'`).startsWith("1"), vault);
  check("the password is strong", pw.length >= 16 && /[A-Z]/.test(pw) && /[a-z]/.test(pw) && /\d/.test(pw) && /[^A-Za-z0-9]/.test(pw));
  check("the website's question (the EIN) went to the owner, not support", asked?.status === "needs_answer" && /EIN/.test(asked?.data?.question?.text ?? "") && !!db(`select id from escalations where carrier_id = '${cid}' and data->>'portalTaskId' = '${asked?.id}' and data->>'status' = 'open'`), `${asked?.status} ${asked?.data?.note}`);
  const view = await owner("GET", null, `?task=${asked?.id}`);
  check("the owner's card shows the question and a screenshot", view.status === 200 && /EIN/.test(view.body.task?.question ?? "") && !!view.body.task?.screenshotId && view.body.task?.secretAnswer === true, JSON.stringify(view.body).slice(0, 300));
  r = await owner("POST", { op: "answer", taskId: asked?.id, answer: "12-3456789" });
  check("the owner answers it in the app", r.status === 200, JSON.stringify(r.body));
  check("the answer is kept encrypted for next time", db(`select site || '|' || left(secret, 3) from portal_logins where carrier_id = '${cid}' and kind = 'fact'`) === "ein|v1." && db(`select count(*) from portal_logins where secret like '%3456789%'`) === "0");
  const approval = await until("the submit approval", () => { const t = task(`kind = 'carrier_setup'`); return t?.status === "needs_approval" || t?.status === "failed" || t?.status === "done" ? t : null; });
  check("with the setup rule off, the final submit waits for the owner", approval?.status === "needs_approval" && (await state()).profiles.length === 0, `${approval?.status} ${approval?.data?.note} ${JSON.stringify(approval?.data?.steps?.slice(-3))}`);
  check("…with the page and what it's about to submit on Needs you", !!db(`select id from escalations where carrier_id = '${cid}' and data->>'portalTaskId' = '${approval?.id}' and data->>'status' = 'open' and data->>'reason' like '%Submit it?%'`) && !!approval?.data?.pending?.screenshotId);
  r = await owner("POST", { op: "approve", taskId: approval?.id });
  check("the owner says submit", r.status === 200, JSON.stringify(r.body));
  const t3 = await until("setup done", () => { const t = task(`kind = 'carrier_setup'`); return t?.status === "done" || t?.status === "failed" ? t : null; });
  st = await state();
  const prof = st.profiles[0] ?? {};
  check("the setup is submitted with the carrier's details, the EIN and the W-9", t3?.status === "done" && /\w/.test(prof.legal ?? "") && prof.ein === "12-3456789" && prof.agree === "on" && prof.w9?.pdf === true, JSON.stringify(prof));
  check("the owner's items for it are closed", db(`select count(*) from escalations where carrier_id = '${cid}' and data->>'portalTaskId' = '${t3?.id}' and data->>'status' = 'open'`) === "0");

  // ── 4. Dock appointment on a scheduling site ──
  const tx = read("twilio").length;
  pm = read("postmark").length;
  await email(PF, "Dana Portal", "PW-1003 appointment", `The receiver books through Opendock, please set the delivery appointment for PW-1003 here: http://opendock.com:3021/dock/pw3`);
  const t4a = task(`load_id = 'pw-3'`);
  check("a scheduling site link for a stop without its appointment becomes a booking job", t4a?.kind === "dock_appointment" && t4a?.data?.stop === "delivery", JSON.stringify(t4a)?.slice(0, 200));
  const t4 = await until("dock booking", () => { const t = task(`load_id = 'pw-3'`); return t && ["done", "failed", "needs_approval"].includes(t.status) ? t : null; });
  st = await state();
  const load3 = loadById("pw-3");
  check("the AI booked a slot in the load's window, with the load number", t4?.status === "done" && st.bookings[0]?.po === "PW-1003" && st.bookings[0]?.slot?.startsWith(day(2)), `${t4?.status} ${t4?.data?.note} ${JSON.stringify(st.bookings)}`);
  check("the appointment is on the load with its confirmation", load3?.appointments?.delivery?.status === "set" && load3?.appointments?.delivery?.confirmation === st.bookings[0]?.conf, JSON.stringify(load3?.appointments));
  check("the driver is texted the time", texts(tx).some((b) => /PW-1003 delivery appointment/.test(b)), JSON.stringify(texts(tx)));
  check("the broker hears it's booked", sent(pm).some((b) => b.To === PF && /booked the delivery appointment on PW-1003/.test(b.TextBody)), JSON.stringify(sent(pm).map((b) => b.TextBody.slice(0, 100))));

  // ── 5. Nothing secret leaks ──
  const all = await owner("GET");
  const dump = JSON.stringify(all.body);
  check("the owner's list shows the login but never the password or the answer", all.status === 200 && all.body.logins?.length === 1 && !dump.includes(pw) && !dump.includes("3456789") && all.body.answers?.[0]?.key === "ein", dump.slice(0, 300));
  const steps = db(`select string_agg(data::text, ' ') from portal_tasks where carrier_id = '${cid}'`);
  check("the jobs' step logs have placeholders, not the password, code or EIN", !steps.includes(pw) && !steps.includes("3456789") && steps.includes("{{new_password}}") && steps.includes("{{fact:ein}}"));
  check("the worker's own log has no password, code or EIN", !workerOut.includes(pw) && !workerOut.includes("3456789") && workerOut.includes("finished: done"), workerOut.slice(-300));
  const supportView = await fetch(`${BASE}/api/support/queue`, { headers: { authorization: `Bearer ${SUPPORT}` } }).then((x) => x.json());
  check("support can't see the password or the EIN either", !JSON.stringify(supportView).includes(pw) && !JSON.stringify(supportView).includes("3456789"));
  r = await fetch(`${BASE}/api/portal/worker`, { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer portal-secret" }, body: JSON.stringify({ op: "step", worker: "someone-else", taskId: t3?.id, page: { url: "http://x", title: "", text: "", elements: [] }, last: null }) });
  check("a job only answers to the worker holding it", (await r.json()).action?.outcome === "stopped");

  // ── 6. The worker is down ──
  await stopWorker();
  pm = read("postmark").length;
  await email(PF, "Dana Portal", "Rate con PW-1004", `Please sign PW-1004 via DocuSign: ${SITE}/sign/pw4?ref=PW-1004&rate=2600`);
  await email(PF, "Dana Portal", "Carrier setup again", `Please also complete setup on our other network: ${SITE}/mycarrierpackets/invite?broker=Other`);
  db(`update portal_tasks set updated_at = now() - interval '45 minutes' where carrier_id = '${cid}' and status = 'queued'`);
  await cron();
  await sleep(1500);
  const t5 = task(`load_id = 'pw-4'`);
  check("a signing job nobody picked up: the broker is asked for a PDF the AI signs itself", t5?.status === "failed" && sent(pm).some((b) => b.To === PF && /PW-1004 as a PDF/.test(b.TextBody)), `${t5?.status} ${JSON.stringify(sent(pm).map((b) => b.TextBody.slice(0, 80)))}`);
  const t6 = task(`kind = 'carrier_setup' and url like '%Other%'`);
  const sup = db(`select data->>'status' from escalations where carrier_id = '${cid}' and data->>'portalTaskId' = '${t6?.id}'`);
  check("a setup job nobody picked up goes to support (our system failing)", t6?.status === "failed" && sup === "with_support", `${t6?.status} ${sup}`);
  const q = await fetch(`${BASE}/api/support/queue`, { headers: { authorization: `Bearer ${SUPPORT}` } }).then((x) => x.json());
  const item = q.items?.find((i) => i.escalation.portalTaskId === t6?.id);
  if (!item?.portal) console.log(JSON.stringify(q).slice(0, 600), t6?.id);
  check("support sees the link and where the AI stopped", !!item?.portal && item.portal.url.includes("Other") && /didn't pick it up/.test(item.portal.note ?? ""), JSON.stringify(item?.portal)?.slice(0, 300));
  r = await owner("POST", { op: "retry", taskId: t6?.id });
  check("the owner can send a failed job back to the AI", r.status === 200 && task(`id = '${t6?.id}'`)?.status === "queued", JSON.stringify(r.body));
  r = await owner("POST", { op: "stop", taskId: t6?.id });
  check("…or stop it", r.status === 200 && task(`id = '${t6?.id}'`)?.status === "cancelled");

  settings({ portalAi: false });
  console.log(`\n${passed} passed, ${failed} failed`);
  await stopWorker();
  process.exit(failed ? 1 : 0);
})().catch(async (e) => {
  console.error(e);
  console.log(workerOut.slice(-2000));
  await stopWorker();
  process.exit(1);
});
