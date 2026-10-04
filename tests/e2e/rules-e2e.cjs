// Owner rules and learning from approvals, against the stand-ins. Run after roadside-e2e.
const path = require("path");
const S = path.join(__dirname, "..");
const ROOT = path.join(__dirname, "../..");
const fs = require("fs");
const { execSync } = require("child_process");
const BASE = "http://localhost:3210";
let passed = 0, failed = 0;
const check = (label, ok, extra = "") => { ok ? passed++ : failed++; console.log(`${ok ? "PASS" : "FAIL"} ${label}${extra ? ` (${String(extra).slice(0, 300)})` : ""}`); };
const db = (q) => execSync(`su postgres -c "/usr/lib/postgresql/16/bin/psql -h /var/lib/postgresql/backroute-test -p 55432 -U postgres -d rest -tA -c \\"${q.replace(/"/g, '\\\\\\"')}\\""`).toString().trim();
const read = (f) => fs.readFileSync(`${S}/fakes/${f}.jsonl`, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const cid = fs.readFileSync(`${S}/fakes/carrier.txt`, "utf8").trim();
const OWNER = execSync(`node ${S}/pgrst/jwt.cjs aaaaaaaa-0000-0000-0000-000000000001 12145550100`).toString();
const approve = (id, body) => fetch(`${BASE}/api/agent/approve`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${OWNER}` }, body: JSON.stringify({ escalationId: id, send: true, ...(body ? { body } : {}) }) });
const settings = (patch) => db(`update carriers set settings = settings || '${JSON.stringify(patch)}'::jsonb where id = '${cid}'`);
const key = db(`select inbound_key from carriers where id = '${cid}'`);
const suggestion = () => db(`select count(*) from escalations where carrier_id = '${cid}' and data->>'suggestRule' = 'tonu_default'`);
let n = 0;
function tonuDraft() {
  const id = `esc-rule-${++n}`;
  const at = new Date(Date.now() - (10 - n) * 60000).toISOString();
  const data = { id, reason: `Claim $150 TONU on TEST-${n}?`, status: "open", createdAt: at, source: "email", draft: { channel: "email", to: "loads@tql.test", subject: `TONU: Load TEST-${n}`, body: `TONU claim ${n}`, purpose: "tonu", amount: 150, rule: "tonu_default" } };
  db(`insert into escalations (id, carrier_id, status, data) values ('${id}', '${cid}', 'open', '${JSON.stringify(data)}'::jsonb)`);
  return id;
}

(async () => {
  settings({ autonomy: "rules", ownerRules: {} });
  let r = await approve(tonuDraft(), "TONU claim, edited by the owner");
  check("the owner sends a TONU claim after changing it", r.status === 200 && (await r.json()).escalation.draft.edited === true);
  await approve(tonuDraft());
  await approve(tonuDraft());
  check("two sent as written after an edited one: the AI doesn't suggest anything yet", suggestion() === "0");
  await approve(tonuDraft());
  const s = db(`select status || '|' || (data->>'reason') from escalations where carrier_id = '${cid}' and data->>'suggestRule' = 'tonu_default'`);
  check("three in a row sent as written: the AI offers to stop asking about TONU claims", /^open\|You've sent the last 3 TONU claims the AI wrote without changing a word/.test(s), s);
  await approve(tonuDraft());
  check("...once", suggestion() === "1");

  // The owner turns the rule on: the next TONU claim goes without asking.
  settings({ ownerRules: { tonu_default: true } });
  const t102 = JSON.parse(db(`select data from trucks where carrier_id = '${cid}' and unit_number = '102'`));
  db(`insert into loads (id, carrier_id, truck_id, stage, data) select 'rule-1', carrier_id, '${t102.id}', 'dispatched', data || '{"id":"rule-1","referenceNumber":"TQL-9901","stage":"dispatched","truckId":"${t102.id}","brokerContactEmail":"loads@tql.test","bookRequest":null,"rateConReading":null}'::jsonb from loads where carrier_id = '${cid}' and data->>'referenceNumber' = 'TQL-5501'`);
  db(`update trucks set data = data || '{"currentLoadId":"rule-1","status":"on_load"}'::jsonb where id = '${t102.id}'`);
  const p0 = read("postmark").length;
  await fetch(`${BASE}/api/channels/email?token=email-hook-secret`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ MessageID: "pm-rule-1", From: "loads@tql.test", FromName: "Kim at TQL", FromFull: { Email: "loads@tql.test", Name: "Kim at TQL" }, To: `abc123+${key}@inbound.postmarkapp.com`, MailboxHash: key, Subject: "Cancelled", TextBody: "We're cancelling load TQL-9901, sorry.", Headers: [{ Name: "Message-ID", Value: "<rule-1@x.test>" }], Attachments: [] }) });
  await sleep(3000);
  const tonu = read("postmark").slice(p0).map((x) => x.body).find((m) => /^TONU: Load TQL-9901/.test(m.Subject));
  check("with the rule on, a TONU claim at the usual amount goes out on its own", !!tonu && tonu.To === "loads@tql.test" && db(`select count(*) from escalations where carrier_id = '${cid}' and data->>'loadId' = 'rule-1' and status = 'open'`) === "0", tonu?.Subject);
  settings({ ownerRules: {} });
  console.log(`\n${passed} passed, ${failed} failed`);
})().catch((e) => { console.error(e); process.exit(1); });
