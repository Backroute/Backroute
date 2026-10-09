// A carrier leaving Backroute, against the stand-ins: the owner downloads everything (no saved passwords or keys in
// it), and deletes the account (the subscription is cancelled first, every table emptied, drivers' consent records
// archived, sign-ins removed); and support's script doing the same on a written request. Uses its own carriers.
const path = require("path");
const S = path.join(__dirname, "..");
const ROOT = path.join(__dirname, "../..");
const fs = require("fs");
const os = require("os");
const { execSync } = require("child_process");
const BASE = "http://localhost:3210";
let passed = 0, failed = 0;
const check = (label, ok, extra = "") => { ok ? passed++ : failed++; console.log(`${ok ? "PASS" : "FAIL"} ${label}${extra ? ` (${String(extra).slice(0, 400)})` : ""}`); };
const db = (q) => execSync(`su postgres -c "/usr/lib/postgresql/16/bin/psql -h /var/lib/postgresql/backroute-test -p 55432 -U postgres -d rest -tA -c \\"${q.replace(/"/g, '\\\\\\"').replace(/\$/g, () => "\\\\\\$")}\\""`).toString().trim();
const read = (f) => (fs.existsSync(`${S}/fakes/${f}.jsonl`) ? fs.readFileSync(`${S}/fakes/${f}.jsonl`, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
const token = (sub, phone) => execSync(`node ${S}/pgrst/jwt.cjs ${sub} ${phone}`).toString().trim();
const api = (p, { method = "GET", body, as } = {}) =>
  fetch(`${BASE}${p}`, { method, headers: { authorization: `Bearer ${as}`, ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) }));
const env = { ...process.env, NEXT_PUBLIC_SUPABASE_URL: "http://localhost:3002", SUPABASE_SERVICE_ROLE_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIiwiZXhwIjoxODIxOTg3OTY3fQ.MjZ3X01YU9uTQeGnA6EOOvyedKjPz6fOR3zpMPYE5kE", EMAIL_INBOUND_ADDRESS: "abc123@inbound.postmarkapp.com", STRIPE_SECRET_KEY: "sk_test_backroute", STRIPE_API_BASE: "http://localhost:3009/stripe" };
const script = (args) => execSync(`node ${ROOT}/scripts/pilot-carrier.mjs ${args}`, { env, cwd: S, stdio: ["ignore", "pipe", "pipe"] }).toString();
const counts = (id) => db(`select (select count(*) from loads where carrier_id='${id}') + (select count(*) from drivers where carrier_id='${id}') + (select count(*) from trucks where carrier_id='${id}') + (select count(*) from carrier_files where carrier_id='${id}') + (select count(*) from activity where carrier_id='${id}') + (select count(*) from members where carrier_id='${id}') + (select count(*) from invites where carrier_id='${id}') + (select count(*) from driver_consents where carrier_id='${id}') + (select count(*) from portal_logins where carrier_id='${id}') + (select count(*) from usage where carrier_id='${id}')`);

function makeCarrier(name, ownerPhone, fleet) {
  db(`delete from carriers where name = '${name}'`);
  fs.writeFileSync(`${S}/fakes/data/leave-fleet.csv`, `unit,driver,phone,equipment,city,state,run\n${fleet}\n`);
  const out = script(`create --name "${name}" --mc ${Math.floor(700000 + Math.random() * 99999)} --owner-phone "${ownerPhone}" --fleet ${S}/fakes/data/leave-fleet.csv --drivers-agreed`);
  return out.match(/id:\s+(\S+)/)[1];
}

(async () => {
  // ── The owner's side ──
  const OWNER_ID = "eeeeeeee-0000-0000-0000-000000000011", OWNER_PHONE = "12145550191";
  const id = makeCarrier("Leave Test Co", "+1 (214) 555-0191", "601,Pat Lowe,(214) 555-0192,Dry Van,Dallas,TX,regional");
  db(`insert into auth.users values ('${OWNER_ID}', '${OWNER_PHONE}') on conflict do nothing`);
  const OWNER = token(OWNER_ID, OWNER_PHONE);
  await fetch("http://localhost:3002/rest/v1/rpc/claim_invites", { method: "POST", headers: { authorization: `Bearer ${OWNER}`, apikey: "x", "content-type": "application/json" }, body: "{}" });
  check("setup: the owner of the test carrier is signed in to it", db(`select role from members where user_id = '${OWNER_ID}' and carrier_id = '${id}'`) === "owner");
  const DISP_ID = "eeeeeeee-0000-0000-0000-000000000012";
  db(`insert into auth.users values ('${DISP_ID}', '12145550193') on conflict do nothing`);
  db(`insert into members (user_id, carrier_id, role) values ('${DISP_ID}', '${id}', 'dispatcher') on conflict do nothing`);

  // Something of everything: a load, a file, a saved website login, an ELD key, a consent, a lot of activity.
  db(`insert into loads (id, carrier_id, stage, data) values ('lv-1', '${id}', 'delivered', '{"id":"lv-1","referenceNumber":"LV-100","stage":"delivered","lane":{"origin":"Dallas, TX","destination":"Tulsa, OK","miles":257},"bookedRate":1450}')`);
  const fileBytes = Buffer.from("%PDF-1.4 leave test rate con");
  const fileId = db(`insert into carrier_files (carrier_id, kind, load_id, name, content_type, size, data) values ('${id}', 'rate_con', 'lv-1', 'rate con LV-100.pdf', 'application/pdf', ${fileBytes.length}, '${fileBytes.toString("base64")}') returning id`).split("\n")[0];
  db(`insert into portal_logins (id, carrier_id, kind, site, label, username, secret) values ('pl-lv', '${id}', 'login', 'carriers.example.com', 'Setup site', 'leave@test', 'SEALED-SECRET-VALUE')`);
  db(`insert into carrier_integrations (carrier_id, kind, config, status) values ('${id}', 'samsara', '{"apiKey":"SAMSARA-KEY-VALUE"}', 'Connected') on conflict do nothing`);
  db(`insert into activity (id, carrier_id, data) select 'lv-act-' || g, '${id}', '{}'::jsonb from generate_series(1, 1005) g`);
  db(`insert into usage (carrier_id, month, ai_calls) values ('${id}', '2026-10', 3) on conflict do nothing`);
  const consents = Number(db(`select count(*) from driver_consents where carrier_id = '${id}'`));

  const disp = await api("/api/account", { as: token(DISP_ID, "12145550193") });
  check("only the owner can download everything or delete the account", disp.status === 403, disp.status);
  const index = await api("/api/account", { as: OWNER });
  check("the download starts with the company and the list of what's in it", index.status === 200 && index.body.carrier?.name === "Leave Test Co" && index.body.tables?.includes("loads") && index.body.tables.includes("carrier_files") && !("inbound_key" in (index.body.carrier ?? {})), JSON.stringify(index.body).slice(0, 200));
  const loads = await api("/api/account?table=loads", { as: OWNER });
  check("…the loads, whole", loads.body.rows?.length === 1 && loads.body.rows[0].data.referenceNumber === "LV-100" && loads.body.more === false, JSON.stringify(loads.body).slice(0, 200));
  const p0 = await api("/api/account?table=activity&page=0", { as: OWNER });
  const p1 = await api("/api/account?table=activity&page=1", { as: OWNER });
  check("…a page at a time, so a big account still downloads", p0.body.rows?.length === 1000 && p0.body.more === true && p1.body.rows?.length === 5 && p1.body.more === false, `${p0.body.rows?.length} ${p1.body.rows?.length}`);
  const logins = await api("/api/account?table=portal_logins", { as: OWNER });
  const links = await api("/api/account?table=carrier_integrations", { as: OWNER });
  check("…never a saved website password or an ELD key", logins.body.rows?.length === 1 && !JSON.stringify(logins.body).includes("SEALED") && links.body.rows?.length === 1 && !JSON.stringify(links.body).includes("SAMSARA-KEY"), JSON.stringify([logins.body, links.body]).slice(0, 300));
  const files = await api("/api/account?table=carrier_files", { as: OWNER });
  const bytes = Buffer.from(await (await fetch(`${BASE}/api/files/${fileId}`, { headers: { authorization: `Bearer ${OWNER}` } })).arrayBuffer());
  check("…and every file, listed and downloadable", files.body.rows?.[0]?.name === "rate con LV-100.pdf" && !("data" in files.body.rows[0]) && bytes.equals(fileBytes));
  check("a table that isn't part of the download is refused", (await api("/api/account?table=members", { as: OWNER })).status === 400);

  // Deleting: the wrong name, then Stripe refusing, change nothing.
  const wrong = await api("/api/account", { method: "DELETE", body: { confirm: "Leave Test" }, as: OWNER });
  check("deleting needs the company name typed exactly", wrong.status === 400 && wrong.body.error === "confirm" && db(`select count(*) from carriers where id = '${id}'`) === "1");
  db(`insert into carrier_billing (carrier_id, customer_id, subscription_id, status) values ('${id}', 'cus_lv', 'sub_fail', 'active') on conflict (carrier_id) do update set subscription_id = 'sub_fail', status = 'active'`);
  const refused = await api("/api/account", { method: "DELETE", body: { confirm: "leave test co" }, as: OWNER });
  check("if the subscription can't be cancelled, nothing is deleted (nobody is charged for an account that's gone)", refused.status === 502 && refused.body.error === "billing" && db(`select count(*) from loads where carrier_id = '${id}'`) === "1", JSON.stringify(refused));
  db(`update carrier_billing set subscription_id = 'sub_lv_ok' where carrier_id = '${id}'`);
  const s0 = read("stripe").length, a0 = read("auth-admin").length;
  const gone = await api("/api/account", { method: "DELETE", body: { confirm: "  Leave Test Co " }, as: OWNER });
  check("the owner deletes the account", gone.status === 200 && gone.body.deleted === true, JSON.stringify(gone));
  check("…the subscription is cancelled at Stripe first", read("stripe").slice(s0).some((x) => x.method === "DELETE" && x.path === "/v1/subscriptions/sub_lv_ok"), JSON.stringify(read("stripe").slice(s0)));
  check("…and everything of theirs is gone, in every table", db(`select count(*) from carriers where id = '${id}'`) === "0" && counts(id) === "0" && db(`select count(*) from carrier_billing where carrier_id = '${id}'`) === "0", counts(id));
  check("…except the record that the account existed", db(`select name from closed_accounts where carrier_id = '${id}'`) === "Leave Test Co" && /^owner /.test(db(`select closed_by from closed_accounts where carrier_id = '${id}'`)));
  check("…and each driver's answer about texts, archived as the proof of consent", consents > 0 && db(`select count(*) from consent_archive where carrier_id = '${id}' and carrier_name = 'Leave Test Co'`) === String(consents), `${consents} consents`);
  const removed = read("auth-admin").slice(a0).map((x) => x.id);
  check("…and the sign-ins that were only for this company are removed", removed.includes(OWNER_ID) && removed.includes(DISP_ID), JSON.stringify(removed));
  check("the deleted owner is signed out of it: their next request finds no company", (await api("/api/account", { as: OWNER })).status === 401);

  // ── Support's script, on a written request ──
  const id2 = makeCarrier("Leave Script Co", "+1 (214) 555-0194", "602,Lee Moss,(214) 555-0195,Reefer,Austin,TX,otr");
  db(`insert into carrier_files (carrier_id, kind, name, content_type, size, data) values ('${id2}', 'pod', 'pod.jpg', 'image/jpeg', 4, '${Buffer.from("JPEG").toString("base64")}')`);
  db(`insert into portal_logins (id, carrier_id, kind, site, label, username, secret) values ('pl-lv2', '${id2}', 'login', 'carriers.example.com', 'Setup site', 'leave2@test', 'SEALED-SECRET-2')`);
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "leave-"));
  const exported = script(`export ${id2} --out ${out}`);
  const podFile = fs.readdirSync(`${out}/files/pod`)[0];
  check("the script exports a carrier: a JSON file per table and the files themselves", fs.existsSync(`${out}/data/drivers.json`) && JSON.parse(fs.readFileSync(`${out}/data/drivers.json`, "utf8")).length === 1 && fs.readFileSync(`${out}/files/pod/${podFile}`, "utf8") === "JPEG" && /exported/.test(exported), exported);
  check("…without saved passwords", !fs.readFileSync(`${out}/data/portal_logins.json`, "utf8").includes("SEALED"));
  let refusedScript = "";
  try {
    script(`delete ${id2}`);
  } catch (e) {
    refusedScript = String(e.stderr);
  }
  check("the script won't delete without the company name", /--confirm "Leave Script Co"/.test(refusedScript) && db(`select count(*) from carriers where id = '${id2}'`) === "1", refusedScript);
  const consents2 = db(`select count(*) from driver_consents where carrier_id = '${id2}'`);
  const deleted = script(`delete ${id2} --confirm "Leave Script Co"`);
  check("…and with it, deletes everything of theirs and archives the consent records", db(`select count(*) from carriers where id = '${id2}'`) === "0" && counts(id2) === "0" && db(`select count(*) from consent_archive where carrier_id = '${id2}'`) === consents2 && /deleted/.test(deleted), deleted);
  fs.rmSync(out, { recursive: true, force: true });
  fs.rmSync(`${S}/fakes/data/leave-fleet.csv`, { force: true });

  console.log(`\n${passed} passed, ${failed} failed`);
})().catch((e) => { console.error(e); process.exit(1); });
