// Practice mode (sandbox): the AI does its job but nothing leaves; and a provider outage doesn't lose a message.
// Run after the other real-mode tests.
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
const waitFor = async (fn, ms = 30000) => { const end = Date.now() + ms; while (Date.now() < end) { const v = fn(); if (v) return v; await sleep(500); } return null; };
const cid = fs.readFileSync(`${S}/fakes/carrier.txt`, "utf8").trim();
const settings = (patch) => db(`update carriers set settings = settings || '${JSON.stringify(patch)}'::jsonb where id = '${cid}'`);
const sign = (url, params) => crypto.createHmac("sha1", "twilio-secret").update(url + Object.keys(params).sort().map((k) => k + params[k]).join("")).digest("base64");
async function twilio(path, params) {
  const url = BASE + path;
  return (await fetch(url, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", "x-twilio-signature": sign(url, params) }, body: new URLSearchParams(params) })).text();
}
const key = db(`select inbound_key from carriers where id = '${cid}'`);
const RUN = Date.now().toString(36);
let n = 0;
async function email(subject, text, from = "loads@tql.test") {
  const body = { MessageID: `pm-sbx-${RUN}-${++n}`, From: from, FromName: "Kim at TQL", FromFull: { Email: from, Name: "Kim at TQL" }, To: `abc123+${key}@inbound.postmarkapp.com`, MailboxHash: key, Subject: subject, TextBody: text, Headers: [{ Name: "Message-ID", Value: `<sbx-${RUN}-${n}@tql.test>` }], Attachments: [] };
  const res = await fetch(`${BASE}/api/channels/email?token=email-hook-secret`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (res.status !== 200) throw new Error(`email webhook ${res.status}`);
}
const texted = () => read("twilio").filter((x) => /Messages\.json/.test(x.path));
const called = () => read("twilio").filter((x) => /Calls\.json/.test(x.path));
const outbound = (where) => db(`select count(*) from outbound where carrier_id = '${cid}' and ${where}`);
const driverPhone = "+12145550148";

(async () => {
  db(`delete from outbound where carrier_id = '${cid}'`);
  // ── Practice mode ─────────────────────────────────────────────────────────────────────────────────────
  settings({ sandbox: true, autonomy: "full", minRpm: 2.5 });
  let tw0 = texted().length, call0 = called().length, pm0 = read("postmark").length;

  await twilio("/api/channels/sms", { From: driverPhone, Body: `Where do I go next? ${RUN}`, MessageSid: `SMsbx${RUN}1` });
  const heldText = await waitFor(() => Number(outbound(`channel = 'sms' and status = 'held' and recipient = '${driverPhone}'`)) > 0);
  check("practice mode: the AI answers a driver's text, but the answer is held, not texted", !!heldText && texted().length === tw0);
  check("...and the log shows it as not sent", db(`select count(*) from channel_messages where carrier_id = '${cid}' and direction = 'out' and provider_id like 'held:%'`) !== "0");

  const broker = `ops-${RUN}@tql.test`;
  await email("Carrier setup", "Please send your carrier packet and setup documents.", broker);
  const heldMail = await waitFor(() => Number(outbound(`channel = 'email' and status = 'held' and recipient = '${broker}'`)) > 0, 40000);
  check("practice mode: a broker asking for the setup packet gets it, held instead of emailed", !!heldMail && read("postmark").length === pm0, db(`select recipient || ' / ' || coalesce(subject, '') from outbound where carrier_id = '${cid}' and channel = 'email' limit 3`));
  check("...and the held email is the whole email (subject and body), for the owner to read", /\S/.test(db(`select coalesce(subject, '') || body from outbound where carrier_id = '${cid}' and recipient = '${broker}' limit 1`)));

  const rounds = await (await fetch(`${BASE}/api/cron/dispatch`, { headers: { authorization: "Bearer cron-secret" } })).json();
  await sleep(1000);
  check("practice mode: the dispatcher's rounds run (check-ins, follow-ups) without texting, calling or emailing anyone for this carrier", texted().length === tw0 && called().length === call0 && read("postmark").length === pm0, JSON.stringify(rounds).slice(0, 200));

  const status = await (await fetch(`${BASE}/api/channels/status?carrier=${cid}`, { headers: { authorization: `Bearer ${execSync(`node ${S}/pgrst/jwt.cjs aaaaaaaa-0000-0000-0000-000000000001 12145550100`).toString().trim()}` } })).json();
  check("the owner can read what practice mode held back", (status.outbound ?? []).some((m) => m.status === "held"), JSON.stringify(status.outbound?.[0] ?? {}).slice(0, 200));

  // The simulator only works on practice carriers it made itself.
  const simReal = await fetch(`${BASE}/api/sim`, { method: "POST", headers: { authorization: "Bearer eval-secret", "content-type": "application/json" }, body: JSON.stringify({ action: "text", carrier: cid, from: driverPhone, body: "hi" }) });
  check("the simulator refuses a real carrier, even one in practice mode", simReal.status === 403);
  const simNoKey = await fetch(`${BASE}/api/sim`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "state", carrier: "sim-x" }) });
  check("the simulator is hidden without the eval secret", simNoKey.status === 404);

  // A driver let in while in practice mode: no link yet (it would never go out), and it goes once the carrier is live.
  const NEWD = `drv-link-${RUN}`, newPhone = "+14695550177";
  db(`delete from drivers where carrier_id = '${cid}' and phone_last10 = '4695550177'`);
  db(`delete from invites where carrier_id = '${cid}' and phone like '%4695550177'`);
  db(`insert into drivers (id, carrier_id, name, phone, data) values ('${NEWD}', '${cid}', 'Lee Grant', '${newPhone}', '${JSON.stringify({ id: NEWD, name: "Lee Grant", phone: newPhone, homeBase: "Dallas, TX", prefs: {} })}'::jsonb)`);
  const ownerJwt = execSync(`node ${S}/pgrst/jwt.cjs aaaaaaaa-0000-0000-0000-000000000001 12145550100`).toString().trim();
  tw0 = texted().length;
  const access = await (await fetch(`${BASE}/api/agent/driver-access`, { method: "POST", headers: { authorization: `Bearer ${ownerJwt}`, "content-type": "application/json" }, body: JSON.stringify({ driverIds: [NEWD] }) })).json();
  check("practice mode: a driver let in can sign in, but isn't texted the link yet", access.results?.[0]?.invited === true && access.results[0].reason === "practice" && !texted().slice(tw0).some((x) => x.params.To === newPhone), JSON.stringify(access));

  settings({ sandbox: false });
  db(`delete from outbound where carrier_id = '${cid}'`);
  tw0 = texted().length;
  await fetch(`${BASE}/api/cron/dispatch`, { headers: { authorization: "Bearer cron-secret" } });
  await fetch(`${BASE}/api/cron/dispatch`, { headers: { authorization: "Bearer cron-secret" } });
  const links = texted().slice(tw0).filter((x) => x.params.To === newPhone && /sign in with this phone number/.test(x.params.Body ?? ""));
  check("...live: the rounds text them the link, once", links.length === 1, JSON.stringify(texted().slice(tw0).filter((x) => x.params.To === newPhone).map((x) => x.params.Body.slice(0, 60))));
  db(`delete from drivers where id = '${NEWD}' and carrier_id = '${cid}'`);
  db(`delete from invites where carrier_id = '${cid}' and phone like '%4695550177'`);

  // ── A provider outage ─────────────────────────────────────────────────────────────────────────────────
  fs.writeFileSync(`${S}/fakes/outage-twilio`, "");
  tw0 = texted().length;
  await twilio("/api/channels/sms", { From: driverPhone, Body: `Running 20 min late ${RUN}`, MessageSid: `SMsbx${RUN}2` });
  const queued = await waitFor(() => Number(outbound(`channel = 'sms' and status = 'retry'`)) > 0);
  check("Twilio down: the AI's answer is kept to send again, not lost", !!queued && texted().length === tw0);
  fs.unlinkSync(`${S}/fakes/outage-twilio`);
  db(`update outbound set next_at = now() - interval '1 second' where carrier_id = '${cid}' and status = 'retry'`);
  const r2 = await (await fetch(`${BASE}/api/cron/dispatch`, { headers: { authorization: "Bearer cron-secret" } })).json();
  check("Twilio back: the next round sends it", Number(outbound(`channel = 'sms' and status = 'sent'`)) > 0 && texted().slice(tw0).some((x) => x.params.To === driverPhone), (r2.done ?? []).filter((d) => /held-up/.test(d)).join("; "));

  fs.writeFileSync(`${S}/fakes/outage-postmark`, "");
  pm0 = read("postmark").length;
  await email("Setup", "Please send your carrier packet and setup documents.", "newbroker@summit.test");
  const mailQueued = await waitFor(() => Number(outbound(`channel = 'email' and status = 'retry'`)) > 0, 40000);
  check("Postmark down: the setup packet waits to be sent again", !!mailQueued && read("postmark").length === pm0);
  fs.unlinkSync(`${S}/fakes/outage-postmark`);
  db(`update outbound set next_at = now() - interval '1 second' where carrier_id = '${cid}' and status = 'retry'`);
  await fetch(`${BASE}/api/cron/dispatch`, { headers: { authorization: "Bearer cron-secret" } });
  const resent = read("postmark").slice(pm0).find((x) => x.body.To === "newbroker@summit.test");
  check("Postmark back: it goes, attachments and all", !!resent && (resent.body.Attachments ?? []).length > 0, resent ? `${resent.body.Subject} · ${(resent.body.Attachments ?? []).map((a) => a.Name).join(", ")}` : "none");

  // Too old to still make sense: a text from an hour ago isn't sent.
  db(`insert into outbound (carrier_id, channel, recipient, body, status, attempts, next_at, created_at) values ('${cid}', 'sms', '${driverPhone}', 'stale ${RUN}', 'retry', 1, now() - interval '1 minute', now() - interval '1 hour')`);
  tw0 = texted().length;
  await fetch(`${BASE}/api/cron/dispatch`, { headers: { authorization: "Bearer cron-secret" } });
  check("a text held up for an hour is given up on, not sent late", outbound(`body = 'stale ${RUN}' and status = 'gave_up'`) === "1" && !texted().slice(tw0).some((x) => x.params.Body === `stale ${RUN}`));
  check("...and support is asked to reach them another way", db(`select count(*) from escalations where carrier_id = '${cid}' and status = 'with_support' and data->>'reason' like '%couldn''t be delivered%stale ${RUN}%'`) === "1");

  // An urgent item nobody on the support team has taken in 15 minutes: the team is texted again, once.
  const stuckId = `esc-stuck-${RUN}`;
  const old = new Date(Date.now() - 20 * 60_000).toISOString();
  db(`insert into escalations (id, carrier_id, load_id, status, data, updated_at) values ('${stuckId}', '${cid}', null, 'with_support', '${JSON.stringify({ id: stuckId, loadId: "", reason: `Driver says the trailer was broken into ${RUN}`, status: "with_support", complexity: "critical", createdAt: old, label: "Sorted" })}'::jsonb, '${old}')`);
  tw0 = texted().length;
  await fetch(`${BASE}/api/cron/dispatch`, { headers: { authorization: "Bearer cron-secret" } });
  await fetch(`${BASE}/api/cron/dispatch`, { headers: { authorization: "Bearer cron-secret" } });
  const again = texted().slice(tw0).filter((x) => new RegExp(`Still waiting after \\d+ min.*trailer was broken into ${RUN}`).test(x.params.Body));
  check("an urgent item unclaimed for 15 minutes: support is texted again, once", again.length > 0 && again.length === new Set(again.map((x) => x.params.To)).size, `${again.length} texts`);

  console.log(`\n${passed} passed, ${failed} failed`);
})().catch((e) => { console.error(e); process.exit(1); });
