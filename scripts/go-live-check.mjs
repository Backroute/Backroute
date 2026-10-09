#!/usr/bin/env node
// Is the real site ready for real carriers? Reads the settings (an env file, or the shell's), checks each value is
// there and looks right, then asks each service whether the key works and is pointed at this site. It only reads:
// no text, call, email or charge is made. Never prints a secret.
//
//   node scripts/go-live-check.mjs                  reads .env.local if it's there, else the shell's settings
//   node scripts/go-live-check.mjs --env .env.prod  reads that file
//   node scripts/go-live-check.mjs --offline        only the settings, no calls to the services
//
// Exits 1 when something must be fixed first. "!" lines are worth a look but don't block.
import fs from "node:fs";

const args = process.argv.slice(2);
const offline = args.includes("--offline");
const envFile = args.includes("--env") ? args[args.indexOf("--env") + 1] : fs.existsSync(".env.local") ? ".env.local" : null;

/** KEY=value lines, quotes and comments allowed; the file wins over the shell. */
function readEnv(file) {
  const env = { ...process.env };
  if (!file) return env;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    let v = m[2];
    if (/^(["']).*\1$/.test(v)) v = v.slice(1, -1);
    else v = v.replace(/\s+#.*$/, "");
    env[m[1]] = v;
  }
  return env;
}

const env = readEnv(envFile);
const has = (k) => !!env[k]?.trim();
const results = [];
let section = "";
const out = (level, text) => results.push({ section, level, text });
const ok = (t) => out("ok", t);
const warn = (t) => out("warn", t);
const fail = (t) => out("fail", t);
const head = (t) => (section = t);

/** Each service's address, the same overrides the app reads (so it can be checked against stand-ins too). */
const base = (k, d) => (env[k] ?? d).replace(/\/$/, "");
const SITE = (env.PUBLIC_BASE_URL ?? "").replace(/\/$/, "");

async function get(url, headers = {}) {
  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(10_000), redirect: "manual" });
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {}
    return { status: res.status, json, text, headers: res.headers };
  } catch (e) {
    return { status: 0, json: null, text: String(e?.cause?.code ?? e?.message ?? e), headers: new Headers() };
  }
}

/** A Supabase key's role, from the middle of the token (new-style sb_ keys say it in the prefix). */
function keyRole(key) {
  if (!key) return null;
  if (key.startsWith("sb_publishable_")) return "anon";
  if (key.startsWith("sb_secret_")) return "service_role";
  try {
    return JSON.parse(Buffer.from(key.split(".")[1], "base64url").toString()).role ?? null;
  } catch {
    return null;
  }
}

const longSecret = (k, min = 24) => {
  if (!has(k)) return fail(`${k} isn't set`);
  if (env[k].length < min) return fail(`${k} is too short to be a secret (${env[k].length} characters; use at least ${min}, e.g. openssl rand -hex 32)`);
  ok(`${k} is set and long enough`);
};

const need = (keys, why) => {
  const missing = keys.filter((k) => !has(k));
  if (missing.length) fail(`${missing.join(", ")} not set: ${why}`);
  else ok(`${keys.join(", ")} set`);
  return !missing.length;
};

// ── The settings ────────────────────────────────────────────────────────────────────────────────────────────────
head("Settings");
if (envFile) ok(`Read ${envFile}`);
else warn("No .env.local here: checking the shell's settings (pass --env <file> to check another)");

if (!SITE) fail("PUBLIC_BASE_URL isn't set: Twilio signs requests with it and links are built from it");
else if (!/^https:\/\//.test(SITE) && !/localhost|127\.0\.0\.1/.test(SITE)) fail(`PUBLIC_BASE_URL must start with https:// (it's ${SITE})`);
else ok(`PUBLIC_BASE_URL is ${SITE}`);

if (env.NEXT_PUBLIC_DEMO !== "off") warn('NEXT_PUBLIC_DEMO isn\'t "off": the real site will also show the demo and its sample data');
else ok("Demo is off on this site");

// Secrets must never be built into the app's pages.
const leaked = Object.keys(env).filter((k) => k.startsWith("NEXT_PUBLIC_") && /SERVICE_ROLE|SECRET|PRIVATE|TOKEN|PASSWORD|VAULT/.test(k) && has(k));
if (leaked.length) fail(`${leaked.join(", ")}: secrets must not start with NEXT_PUBLIC_ (they'd be readable by anyone in the browser)`);
const anonRole = keyRole(env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
const serviceRole = keyRole(env.SUPABASE_SERVICE_ROLE_KEY);
if (anonRole === "service_role") fail("NEXT_PUBLIC_SUPABASE_ANON_KEY is the service_role key: anyone could read every carrier's data. Use the anon key there.");
if (!leaked.length && anonRole !== "service_role") ok("No secret is in a NEXT_PUBLIC_ setting");

need(["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"], "accounts and saved data");
if (has("SUPABASE_SERVICE_ROLE_KEY") && serviceRole && serviceRole !== "service_role") fail(`SUPABASE_SERVICE_ROLE_KEY is a ${serviceRole} key, not the service_role one`);
need(["ANTHROPIC_API_KEY"], "nothing gets answered without the AI");
need(["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN"], "texts and calls");
if (!has("TWILIO_FROM_NUMBER") && !has("TWILIO_MESSAGING_SERVICE_SID")) fail("Neither TWILIO_FROM_NUMBER nor TWILIO_MESSAGING_SERVICE_SID is set");
if (!has("TWILIO_FROM_NUMBER")) warn("No TWILIO_FROM_NUMBER: the AI can text but can't place check-in or update calls");
need(["POSTMARK_SERVER_TOKEN", "EMAIL_FROM", "EMAIL_INBOUND_ADDRESS"], "broker email");
longSecret("EMAIL_WEBHOOK_TOKEN");
longSecret("CRON_SECRET");
need(["FMCSA_WEB_KEY"], "without it, every new broker waits for the support team");
need(["SUPPORT_PHONES"], "who gets a text for an emergency");
if (!has("SUPPORT_EMAIL") && !has("ALERT_PHONES")) warn("No SUPPORT_EMAIL or ALERT_PHONES: outages only reach SUPPORT_PHONES");

if (has("PORTAL_VAULT_KEY")) {
  // Read the way lib/portal/vault reads it: 64 hex characters, or base64.
  const v = env.PORTAL_VAULT_KEY.trim();
  const bytes = Buffer.from(v, /^[0-9a-f]{64}$/i.test(v) ? "hex" : "base64").length;
  if (bytes !== 32) fail(`PORTAL_VAULT_KEY must be 32 random bytes (openssl rand -base64 32); this one is ${bytes} bytes`);
  else ok("PORTAL_VAULT_KEY is 32 bytes");
  if (has("PORTAL_VAULT_KEY_OLD")) warn("PORTAL_VAULT_KEY_OLD is set: remove it once saved logins have moved to the new key");
} else if (has("PORTAL_WORKER_SECRET") || has("QBO_CLIENT_ID")) fail("PORTAL_VAULT_KEY isn't set: broker website logins and QuickBooks can't be stored");
if (has("PORTAL_WORKER_SECRET")) longSecret("PORTAL_WORKER_SECRET");
if (has("VOICE_SERVER_URL")) {
  if (!/^wss:\/\//.test(env.VOICE_SERVER_URL) && !/localhost/.test(env.VOICE_SERVER_URL)) fail("VOICE_SERVER_URL must start with wss://");
  longSecret("VOICE_SERVER_SECRET");
}
if (has("NEXT_PUBLIC_VAPID_PUBLIC_KEY") !== has("VAPID_PRIVATE_KEY")) fail("Phone alerts need both NEXT_PUBLIC_VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY");

if (has("STRIPE_SECRET_KEY")) {
  if (env.STRIPE_SECRET_KEY.startsWith("sk_test_")) warn("STRIPE_SECRET_KEY is a test key: nobody will actually be charged");
  need(["STRIPE_WEBHOOK_SECRET", "STRIPE_PRICE_PER_TRUCK"], "billing");
} else warn("No Stripe: carriers aren't billed");
if (env.QBO_ENV === "sandbox") warn("QBO_ENV=sandbox: QuickBooks connects to Intuit's test companies only");

// Settings that only make sense while testing.
if (env.QUIET_HOURS === "0-0") warn("QUIET_HOURS=0-0: texts that can wait go out at night too");
for (const k of ["BRIEF_HOURS", "CARE_HOURS", "REVIEW_HOURS"]) if (env[k] === "0-24") warn(`${k}=0-24: these texts can go out at any hour`);
if (env.UNDO_SECONDS === "0") warn("UNDO_SECONDS=0: owners get no chance to undo an email the AI sends");
if (has("EVAL_SECRET")) warn("EVAL_SECRET is set: the measuring endpoints are on. Leave it unset in production unless you're measuring");
if (env.AI_IN_DEMO === "on") warn("AI_IN_DEMO=on: demo visitors use the real AI (and your API spend)");
if (has("PORTAL_ALLOW_HTTP")) fail("PORTAL_ALLOW_HTTP is set: that's for tests only");
for (const k of Object.keys(env).filter((k) => /_API_BASE$|_BASE_URL$|^ANTHROPIC_BASE_URL$/.test(k) && k !== "PUBLIC_BASE_URL" && /localhost|127\.0\.0\.1/.test(env[k]))) fail(`${k} points at ${env[k]}: that's a stand-in for tests`);
if (env.CONSENT_REQUIRED !== "1") warn("CONSENT_REQUIRED isn't 1: a driver with no consent on record still gets texts after the first one (ask the lawyer which you want)");

// ── The services, asked directly ────────────────────────────────────────────────────────────────────────────────
async function services() {
  head("Supabase");
  if (has("NEXT_PUBLIC_SUPABASE_URL") && has("SUPABASE_SERVICE_ROLE_KEY")) {
    const url = env.NEXT_PUBLIC_SUPABASE_URL.replace(/\/$/, "");
    const svc = { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` };
    const r = await get(`${url}/rest/v1/carriers?select=id&limit=1`, svc);
    if (r.status === 200) ok("The service key reads the database");
    else fail(`The database didn't answer with the service key (${r.status || r.text})`);
    // The newest migration's table: missing means the migrations weren't all run.
    const latest = await get(`${url}/rest/v1/lookup_cache?select=key&limit=1`, svc);
    if (latest.status === 200) ok("Migrations are run through the newest one (lookup_cache is there)");
    else if (r.status === 200) fail("The newest migration isn't run: run every file in supabase/migrations/ in order (DEPLOY.md, step 1)");
    if (has("NEXT_PUBLIC_SUPABASE_ANON_KEY")) {
      const anon = await get(`${url}/rest/v1/carriers?select=id&limit=1`, { apikey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY, authorization: `Bearer ${env.NEXT_PUBLIC_SUPABASE_ANON_KEY}` });
      if (anon.status === 200 && Array.isArray(anon.json) && anon.json.length) fail("Signed out, the anon key can read carriers: the access rules (RLS) aren't on");
      else ok("Signed out, the anon key reads no carriers");
    }
  } else warn("Skipped: Supabase isn't set");

  head("Anthropic");
  if (has("ANTHROPIC_API_KEY")) {
    const r = await get(`${base("ANTHROPIC_BASE_URL", "https://api.anthropic.com")}/v1/models?limit=1`, { "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" });
    if (r.status === 200) ok("The API key works");
    else fail(`The API key was refused (${r.status || r.text}${r.json?.error?.message ? `: ${r.json.error.message}` : ""})`);
  } else warn("Skipped: no key");

  head("Twilio");
  if (has("TWILIO_ACCOUNT_SID") && has("TWILIO_AUTH_TOKEN")) {
    const tw = base("TWILIO_API_BASE", "https://api.twilio.com/2010-04-01");
    const auth = { authorization: `Basic ${Buffer.from(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`).toString("base64")}` };
    const acct = await get(`${tw}/Accounts/${env.TWILIO_ACCOUNT_SID}.json`, auth);
    if (acct.status !== 200) fail(`The account SID and auth token were refused (${acct.status || acct.text})`);
    else {
      if (acct.json?.status && acct.json.status !== "active") fail(`The Twilio account is ${acct.json.status}`);
      else ok("The account answers and is active");
      if (acct.json?.type === "Trial") fail("It's a trial account: texts only reach verified numbers and start with a trial notice");
    }
    if (has("TWILIO_FROM_NUMBER") && acct.status === 200) {
      const nums = await get(`${tw}/Accounts/${env.TWILIO_ACCOUNT_SID}/IncomingPhoneNumbers.json?PhoneNumber=${encodeURIComponent(env.TWILIO_FROM_NUMBER)}`, auth);
      const n = nums.json?.incoming_phone_numbers?.[0];
      if (!n) fail(`${env.TWILIO_FROM_NUMBER} isn't a number on this account`);
      else {
        const want = (path) => `${SITE}${path}`;
        const hooks = [
          ["texts", n.sms_url, n.sms_method, "/api/channels/sms"],
          ["calls", n.voice_url, n.voice_method, "/api/channels/voice"],
        ];
        for (const [what, url, method, path] of hooks) {
          // A number in a Messaging Service takes its texts from the service's own setting.
          if (what === "texts" && has("TWILIO_MESSAGING_SERVICE_SID") && !url) continue;
          if (url !== want(path)) fail(`${env.TWILIO_FROM_NUMBER}: incoming ${what} go to ${url || "nowhere"}, not ${want(path)}`);
          else if (method && method.toUpperCase() !== "POST") fail(`${env.TWILIO_FROM_NUMBER}: incoming ${what} must be HTTP POST`);
          else ok(`${env.TWILIO_FROM_NUMBER}: incoming ${what} come to this site`);
        }
      }
    }
    warn("Text registration (A2P 10DLC) can't be read from here: check it's approved in the Twilio console (docs/sms-registration.md)");
  } else warn("Skipped: Twilio isn't set");

  head("Postmark");
  if (has("POSTMARK_SERVER_TOKEN")) {
    const r = await get(`${base("POSTMARK_API_BASE", "https://api.postmarkapp.com")}/server`, { accept: "application/json", "x-postmark-server-token": env.POSTMARK_SERVER_TOKEN });
    if (r.status !== 200) fail(`The server token was refused (${r.status || r.text})`);
    else {
      ok("The server token works");
      const hook = r.json?.InboundHookUrl ?? "";
      if (!hook) fail("No inbound webhook: broker emails won't reach the app");
      else if (!hook.startsWith(`${SITE}/api/channels/email`)) fail(`Inbound email goes to ${hook.replace(/token=[^&]+/, "token=…")}, not ${SITE}/api/channels/email`);
      else if (!hook.includes(`token=${env.EMAIL_WEBHOOK_TOKEN}`)) fail("The inbound webhook's ?token= isn't EMAIL_WEBHOOK_TOKEN: the app will refuse every email");
      else ok("Inbound email comes to this site with the right token");
      const inbound = r.json?.InboundAddress;
      if (inbound && has("EMAIL_INBOUND_ADDRESS") && inbound.toLowerCase() !== env.EMAIL_INBOUND_ADDRESS.toLowerCase()) fail(`EMAIL_INBOUND_ADDRESS is ${env.EMAIL_INBOUND_ADDRESS}, but Postmark's is ${inbound}`);
    }
    warn(`Check in Postmark that ${env.EMAIL_FROM ?? "EMAIL_FROM"}'s domain shows DKIM and Return-Path verified (the server token can't read it)`);
  } else warn("Skipped: Postmark isn't set");

  head("FMCSA");
  if (has("FMCSA_WEB_KEY")) {
    // A docket number that exists: the answer only matters for whether the key is accepted.
    const r = await get(`${base("FMCSA_API_BASE", "https://mobile.fmcsa.dot.gov/qc/services")}/carriers/docket-number/1?webKey=${encodeURIComponent(env.FMCSA_WEB_KEY)}`);
    if (r.status === 200) ok("The web key works");
    else fail(`The web key was refused (${r.status || r.text})`);
  } else warn("Skipped: no web key");

  if (has("STRIPE_SECRET_KEY") && has("STRIPE_PRICE_PER_TRUCK")) {
    head("Stripe");
    const r = await get(`${base("STRIPE_API_BASE", "https://api.stripe.com")}/v1/prices/${encodeURIComponent(env.STRIPE_PRICE_PER_TRUCK)}`, { authorization: `Bearer ${env.STRIPE_SECRET_KEY}` });
    if (r.status !== 200) fail(`The price ${env.STRIPE_PRICE_PER_TRUCK} wasn't found with this key (${r.status || r.text})`);
    else {
      if (r.json?.active === false) fail("The per-truck price is archived");
      else if (!r.json?.recurring) fail("The per-truck price isn't monthly (recurring)");
      else ok(`The per-truck price is ${r.json.unit_amount != null ? `$${(r.json.unit_amount / 100).toFixed(2)}` : "set"} a ${r.json.recurring.interval}`);
    }
  }

  if (has("DEEPGRAM_API_KEY")) {
    head("Deepgram");
    const r = await get(`${base("DEEPGRAM_API_BASE", "https://api.deepgram.com")}/v1/projects`, { authorization: `Token ${env.DEEPGRAM_API_KEY}` });
    r.status === 200 ? ok("The key works") : fail(`The key was refused (${r.status || r.text})`);
  }
  if (has("ELEVENLABS_API_KEY")) {
    head("ElevenLabs");
    const r = await get(`${base("ELEVENLABS_BASE", "https://api.elevenlabs.io")}/v1/user`, { "xi-api-key": env.ELEVENLABS_API_KEY });
    r.status === 200 ? ok("The key works") : fail(`The key was refused (${r.status || r.text})`);
    if (!has("ELEVENLABS_VOICE_ID")) fail("ELEVENLABS_VOICE_ID isn't set");
  }
  if (has("VOICE_SERVER_URL")) {
    head("Voice server");
    const url = `${env.VOICE_SERVER_URL.replace(/^ws/, "http").replace(/\/$/, "")}/health`;
    const r = await get(url);
    r.status === 200 ? ok("It answers") : fail(`No answer from ${url} (${r.status || r.text}): calls fall back to taking turns`);
  }

  head("The site");
  if (SITE) {
    const health = await get(`${SITE}/api/health`);
    if (health.status === 200 && health.json?.ok) ok("/api/health: the app and its database answer");
    else fail(`/api/health answered ${health.status || health.text}: the app or its database is down, or the site isn't deployed with these settings`);
    const cron = await get(`${SITE}/api/cron/dispatch`);
    if (cron.status === 401) ok("The rounds refuse anyone without CRON_SECRET");
    else fail(`/api/cron/dispatch without the secret answered ${cron.status || cron.text}, not 401`);
    const page = await get(`${SITE}/`);
    const missing = ["x-frame-options", "x-content-type-options", "strict-transport-security", "content-security-policy"].filter((h) => !page.headers.get(h));
    if (page.status === 0) fail(`The site doesn't answer (${page.text})`);
    else if (missing.length) fail(`The home page is missing ${missing.join(", ")}`);
    else ok("Pages carry the security headers");
    warn("Check the scheduler runs /api/cron/dispatch every 10 minutes: the support console's System tab shows when it last ran");
  }
}

if (!offline) await services();

// ── The report ──────────────────────────────────────────────────────────────────────────────────────────────────
const mark = { ok: "✓", warn: "!", fail: "✗" };
let last = null;
for (const r of results) {
  if (r.section !== last) console.log(`\n${r.section}`), (last = r.section);
  console.log(`  ${mark[r.level]} ${r.text}`);
}
const fails = results.filter((r) => r.level === "fail").length;
const warns = results.filter((r) => r.level === "warn").length;
console.log(`\n${fails ? `${fails} to fix before going live` : "Nothing blocking"}${warns ? `, ${warns} to look at` : ""}.${offline ? " (Settings only: run without --offline to ask the services.)" : ""}`);
process.exit(fails ? 1 : 0);
