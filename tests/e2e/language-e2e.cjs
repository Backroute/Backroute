// Talking to the AI any way people do: the app's chat can act (not just answer), the owner can say "send it" in chat,
// a driver can text a photo of the POD, a broker can email a photo of the rate con, phone lines listen for trucking
// words, and the eval endpoint scores the AI on generated messages. Run after replies-e2e.
const path = require("path");
const S = path.join(__dirname, "..");
const ROOT = path.join(__dirname, "../..");
const crypto = require("crypto");
const fs = require("fs");
const { execSync } = require("child_process");
const BASE = "http://localhost:3210";
let passed = 0, failed = 0;
const check = (label, ok, extra = "") => { ok ? passed++ : failed++; console.log(`${ok ? "PASS" : "FAIL"} ${label}${extra ? ` (${String(extra).slice(0, 300)})` : ""}`); };
const db = (q) => execSync(`su postgres -c "/usr/lib/postgresql/16/bin/psql -h /var/lib/postgresql/backroute-test -p 55432 -U postgres -d rest -tA -c \\"${q.replace(/"/g, '\\\\\\"')}\\""`).toString().trim();
const read = (f) => fs.readFileSync(`${S}/fakes/${f}.jsonl`, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (fn, ms = 20000) => { const end = Date.now() + ms; while (Date.now() < end) { const v = fn(); if (v) return v; await sleep(500); } return null; };
const cid = fs.readFileSync(`${S}/fakes/carrier.txt`, "utf8").trim();
const token = (sub, phone) => execSync(`node ${S}/pgrst/jwt.cjs ${sub} ${phone}`).toString();
const OWNER = token("aaaaaaaa-0000-0000-0000-000000000001", "12145550100");
const MARCUS = token("dddddddd-0000-0000-0000-000000000003", "12145550148");
const load = (id) => JSON.parse(db(`select data from loads where carrier_id = '${cid}' and id = '${id}'`) || "null");
const sign = (url, params) => crypto.createHmac("sha1", "twilio-secret").update(url + Object.keys(params).sort().map((k) => k + params[k]).join("")).digest("base64");
async function twilio(path, params) {
  const url = BASE + path;
  return (await fetch(url, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", "x-twilio-signature": sign(url, params) }, body: new URLSearchParams(params) })).text();
}
const chat = (t, role, question) => fetch(`${BASE}/api/ai/chat`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${t}` }, body: JSON.stringify({ role, question, history: [], snapshot: {} }) }).then((r) => r.json());
const RUN = Date.now().toString(36);

(async () => {
  // Marcus is at the pickup.
  const t101 = db(`select id from trucks where carrier_id = '${cid}' and unit_number = '101'`);
  const truck0 = db(`select data from trucks where id = '${t101}' and carrier_id = '${cid}'`);
  db(`delete from loads where carrier_id = '${cid}' and id = 'lc-1'`);
  db(`insert into loads (id, carrier_id, truck_id, stage, data) select 'lc-1', carrier_id, '${t101}', 'at_pickup', data || '{"id":"lc-1","referenceNumber":"LC-1","stage":"at_pickup","truckId":"${t101}","documents":[],"tripChecklist":{}}'::jsonb from loads where carrier_id = '${cid}' and data->>'referenceNumber' = 'CFP-88213'`);
  db(`update trucks set data = data || '{"currentLoadId":"lc-1","nextLoadId":null,"status":"on_load"}'::jsonb where id = '${t101}' and carrier_id = '${cid}'`);

  // ── The app's chat acts ──────────────────────────────────────────────────────────────────────────────
  let r = await chat(MARCUS, "driver", "I'm loaded and rolling");
  check("a driver tells the app's chat they're loaded: the AI moves the load, like a text would", /Marked you loaded/.test(r.reply ?? "") && load("lc-1").stage === "in_transit" && (r.did ?? []).some((d) => /LC-1/.test(d)), JSON.stringify(r).slice(0, 200));

  db(`insert into escalations (id, carrier_id, status, data) values ('esc-uidecide${RUN}', '${cid}', 'open', '{"id":"esc-uidecide${RUN}","loadId":"","carrierId":"carrier-titan","reason":"Kim asked about UI-DECIDE, reply ready","createdAt":"${new Date().toISOString()}","status":"open","complexity":"routine","recommendedAction":"approve","recommendedLabel":"Send this reply","source":"email","draft":{"channel":"email","to":"loads@tql.test","subject":"Re: question","body":"Hi Kim, yes we can take it. Titan Freight","purpose":"reply"}}'::jsonb)`);
  const pm0 = read("postmark").length;
  r = await chat(OWNER, "owner", "yes send it");
  const sent = await waitFor(() => read("postmark").slice(pm0).find((x) => /yes we can take it/.test(x.body.TextBody ?? "")));
  check("the owner says 'send it' in the app's chat: the waiting reply goes out and the item closes", !!sent && db(`select status from escalations where carrier_id = '${cid}' and id = 'esc-uidecide${RUN}'`) === "resolved", JSON.stringify(r).slice(0, 200));

  // ── A driver texts a photo of the POD ────────────────────────────────────────────────────────────────
  let t0 = read("twilio").length;
  await twilio("/api/channels/sms", { From: "+12145550148", To: "+14695550199", Body: "here's the POD", NumMedia: "1", MediaUrl0: `http://localhost:3006/2010-04-01/Accounts/ACtest/Messages/MM${RUN}/Media/ME1`, MediaContentType0: "image/jpeg", MessageSid: `SM-mms-${RUN}` });
  const podReply = await waitFor(() => read("twilio").slice(t0).find((x) => x.params.To === "+12145550148" && /POD/.test(x.params.Body ?? "")));
  const lc = load("lc-1");
  const file = db(`select kind || '|' || content_type || '|' || size from carrier_files where carrier_id = '${cid}' and load_id = 'lc-1' order by created_at desc limit 1`);
  check("a driver texts a photo of the POD: stored, checked, put on the load", file === "pod|image/jpeg|19" && lc.documents.some((d) => d.type === "pod" && d.fileId && !d.flagged), file);
  check("...and a clean POD finishes the delivery, and the driver hears so", lc.stage === "delivered" && JSON.parse(db(`select data from trucks where id = '${t101}' and carrier_id = '${cid}'`)).currentLoadId === null && /Got the signed POD for LC-1, thanks\. Marked delivered/.test(podReply?.params.Body ?? ""), podReply?.params.Body ?? lc.stage);

  // ── A broker emails a photo of the rate con ──────────────────────────────────────────────────────────
  const c0 = read("claude").length;
  const key = db(`select inbound_key from carriers where id = '${cid}'`);
  const photo = crypto.randomBytes(70 * 1024).toString("base64");
  await fetch(`${BASE}/api/channels/email?token=email-hook-secret`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ MessageID: `pm-photo-${RUN}`, From: "loads@tql.test", FromName: "Kim at TQL", FromFull: { Email: "loads@tql.test", Name: "Kim at TQL" }, To: `abc+${key}@inbound.postmarkapp.com`, MailboxHash: key, Subject: "Rate con attached", TextBody: "Rate con attached (photo).", Headers: [{ Name: "Message-ID", Value: `<photo-${RUN}@tql.test>` }], Attachments: [{ Name: "ratecon.jpg", Content: photo, ContentType: "image/jpeg", ContentLength: 70 * 1024 }, { Name: "logo.png", Content: "aGk=", ContentType: "image/png", ContentLength: 2 }] }) });
  await sleep(3000);
  const imageReads = read("claude").slice(c0).filter((x) => JSON.stringify(x.body.messages ?? []).includes('"media_type":"image/jpeg"'));
  check("a photo of a rate con by email is read like a PDF (a signature logo isn't)", imageReads.length >= 1 && !read("claude").slice(c0).some((x) => JSON.stringify(x.body.messages ?? []).includes('"media_type":"image/png"')), imageReads.length);

  // ── Phone lines listen for trucking words ────────────────────────────────────────────────────────────
  const tw = await twilio("/api/channels/voice", { From: "+12145550148", To: "+14695550199", CallSid: `CAL${RUN}` });
  check("calls listen with the phone-call speech model and trucking hints (reefer, lumper, TONU...)", /speechModel="phone_call"/.test(tw) && /hints="reefer, dry van, [^"]*lumper[^"]*TONU/.test(tw), tw.slice(0, 300));

  // ── The eval endpoint and runner ─────────────────────────────────────────────────────────────────────
  let res = await fetch(`${BASE}/api/eval/turn`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "driver", text: "loaded" }) });
  check("the eval endpoint doesn't exist without its secret", res.status === 404);
  res = await fetch(`${BASE}/api/eval/turn`, { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer eval-secret" }, body: JSON.stringify({ kind: "driver", text: "all loaded up, heading out" }) });
  const ev = await res.json();
  check("with it: the real AI's pick comes back, and nothing is saved (dry run)", ev.tools?.some((t) => t.tool === "update_load_status" && t.input.status === "loaded") && db(`select count(*) from loads where carrier_id = 'carrier-titan'`) === "0", JSON.stringify(ev).slice(0, 200));
  execSync(`cd ${ROOT} && EVAL_SECRET=eval-secret node eval/run.mjs --base ${BASE} --n 48 --seed 5 --concurrency 4 > ${S}/.out/logs/eval-run.log 2>&1`);
  const results = JSON.parse(fs.readFileSync(ROOT + "/eval/results.json", "utf8"));
  check("the runner scores a sample across every intent and writes the misses", results.total.n === 48 && Object.keys(results.by).length === 24 && Array.isArray(results.misses), fs.readFileSync(`${S}/.out/logs/eval-run.log`, "utf8").split("\n").slice(-3).join(" "));
  fs.unlinkSync(ROOT + "/eval/results.json");

  db(`delete from loads where carrier_id = '${cid}' and id = 'lc-1'`);
  db(`update trucks set data = '${truck0.replace(/'/g, "''")}'::jsonb where id = '${t101}' and carrier_id = '${cid}'`);
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
