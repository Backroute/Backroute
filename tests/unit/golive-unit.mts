// scripts/go-live-check.mjs against a stand-in for every service it asks: a setup that's right passes with nothing to
// fix, and each kind of mistake it's there to catch is caught. Nothing here reaches a real service.
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";

let passed = 0,
  failed = 0;
const check = (label: string, ok: boolean, extra = "") => {
  ok ? passed++ : failed++;
  console.log(`${ok ? "PASS" : "FAIL"} ${label}${extra && !ok ? ` (${extra.slice(0, 600)})` : ""}`);
};

const PORT = 3031;
const SITE = `http://localhost:${PORT}/site`;
const jwt = (role: string) => `x.${Buffer.from(JSON.stringify({ role })).toString("base64url")}.y`;
const SERVICE = jwt("service_role");
const ANON = jwt("anon");
const HOOK_TOKEN = "h".repeat(40);

/** What the stand-ins answer; each case changes a piece. */
let world = {
  smsUrl: `${SITE}/api/channels/sms`,
  inboundHook: `${SITE}/api/channels/email?token=${HOOK_TOKEN}`,
  anonSeesCarriers: false,
  latestMigration: true,
  accountType: "Full",
  cronStatus: 401,
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url!, `http://localhost:${PORT}`);
  const p = url.pathname;
  const json = (status: number, body: unknown, headers: Record<string, string> = {}) => {
    res.writeHead(status, { "content-type": "application/json", ...headers });
    res.end(JSON.stringify(body));
  };
  const key = req.headers.apikey;
  if (p === "/supabase/rest/v1/carriers") return json(200, key === ANON && !world.anonSeesCarriers ? [] : [{ id: "c1" }]);
  if (p === "/supabase/rest/v1/lookup_cache") return world.latestMigration ? json(200, []) : json(404, { message: "relation does not exist" });
  if (p === "/anthropic/v1/models") return req.headers["x-api-key"] === "sk-ant-good" ? json(200, { data: [] }) : json(401, { error: { message: "invalid x-api-key" } });
  if (p === "/twilio/Accounts/ACgood.json") return json(200, { status: "active", type: world.accountType });
  if (p === "/twilio/Accounts/ACgood/IncomingPhoneNumbers.json")
    return json(200, { incoming_phone_numbers: url.searchParams.get("PhoneNumber") === "+14695550199" ? [{ sms_url: world.smsUrl, sms_method: "POST", voice_url: `${SITE}/api/channels/voice`, voice_method: "POST" }] : [] });
  if (p === "/postmark/server") return json(200, { InboundHookUrl: world.inboundHook, InboundAddress: "abc@inbound.postmarkapp.com" });
  if (p.startsWith("/fmcsa/carriers/docket-number/")) return url.searchParams.get("webKey") === "fm-good" ? json(200, { content: [] }) : json(401, {});
  if (p === "/stripe/v1/prices/price_truck") return json(200, { active: true, recurring: { interval: "month" }, unit_amount: 4900 });
  if (p === "/site/api/health") return json(200, { ok: true });
  if (p === "/site/api/cron/dispatch") return json(world.cronStatus, {});
  if (p === "/site/") return json(200, {}, { "x-frame-options": "DENY", "x-content-type-options": "nosniff", "strict-transport-security": "max-age=1", "content-security-policy": "frame-ancestors 'none'" });
  json(404, {});
});
await new Promise<void>((r) => server.listen(PORT, r));

const good: Record<string, string> = {
  PUBLIC_BASE_URL: SITE,
  NEXT_PUBLIC_DEMO: "off",
  NEXT_PUBLIC_SUPABASE_URL: `http://localhost:${PORT}/supabase`,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: ANON,
  SUPABASE_SERVICE_ROLE_KEY: SERVICE,
  ANTHROPIC_API_KEY: "sk-ant-good",
  TWILIO_ACCOUNT_SID: "ACgood",
  TWILIO_AUTH_TOKEN: "t".repeat(32),
  TWILIO_FROM_NUMBER: "+14695550199",
  POSTMARK_SERVER_TOKEN: "pm-good",
  EMAIL_FROM: "dispatch@backroute.pro",
  EMAIL_INBOUND_ADDRESS: "abc@inbound.postmarkapp.com",
  EMAIL_WEBHOOK_TOKEN: HOOK_TOKEN,
  CRON_SECRET: "c".repeat(40),
  FMCSA_WEB_KEY: "fm-good",
  SUPPORT_PHONES: "+13125550100",
  SUPPORT_EMAIL: "support@backroute.pro",
  STRIPE_SECRET_KEY: "sk_live_good",
  STRIPE_WEBHOOK_SECRET: "whsec_good",
  STRIPE_PRICE_PER_TRUCK: "price_truck",
  CONSENT_REQUIRED: "1",
};
// The checker's own way to reach stand-ins; it reports these as test settings, so they're kept out of the file.
const bases = {
  ANTHROPIC_BASE_URL: `http://localhost:${PORT}/anthropic`,
  TWILIO_API_BASE: `http://localhost:${PORT}/twilio`,
  POSTMARK_API_BASE: `http://localhost:${PORT}/postmark`,
  FMCSA_API_BASE: `http://localhost:${PORT}/fmcsa`,
  STRIPE_API_BASE: `http://localhost:${PORT}/stripe`,
};

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "golive-"));
const script = path.join(import.meta.dirname, "../../scripts/go-live-check.mjs");

/** Runs the checker on these settings (as an env file); the stand-in addresses come from the shell. */
async function run(settings: Record<string, string>, extra: string[] = []) {
  const file = path.join(dir, `env-${Math.random().toString(36).slice(2)}`);
  fs.writeFileSync(file, Object.entries(settings).map(([k, v]) => `${k}="${v}"`).join("\n") + "\n# a comment\n");
  // Not spawnSync: that would block the stand-ins, which answer from this same process.
  return new Promise<{ code: number; out: string }>((resolve) => {
    const child = spawn(process.execPath, [script, "--env", file, ...extra], { env: { PATH: process.env.PATH!, NO_PROXY: "localhost", ...bases } });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    child.on("close", (code) => resolve({ code: code ?? 1, out }));
  });
}
const fixes = (out: string) => out.split("\n").filter((l) => l.includes("✗")).filter((l) => !/_BASE(_URL)? points at http:\/\/localhost/.test(l));

{
  const { code, out } = await run(good);
  const real = fixes(out);
  check("a setup that's right: nothing to fix (the stand-in addresses aside)", real.length === 0, real.join("\n") || out);
  check("...every service was asked", ["The service key reads the database", "The API key works", "The account answers and is active", "incoming texts come to this site", "Inbound email comes to this site with the right token", "The web key works", "The per-truck price is $49.00 a month", "/api/health", "The rounds refuse", "security headers"].every((s) => out.includes(s)), out);
  check("...and no secret is printed", ![SERVICE, "sk-ant-good", HOOK_TOKEN, "c".repeat(40), "t".repeat(32), "sk_live_good"].some((s) => out.includes(s)));
  check("the stand-in addresses themselves are flagged as test settings", code === 1 && /TWILIO_API_BASE points at http:\/\/localhost/.test(out));
}
{
  const { out } = await run({ ...good, NEXT_PUBLIC_SUPABASE_ANON_KEY: SERVICE, NEXT_PUBLIC_CRON_SECRET: "x" }, ["--offline"]);
  check("the service_role key where the browser can read it is caught", /ANON_KEY is the service_role key/.test(out), out);
  check("a secret named NEXT_PUBLIC_ is caught", /NEXT_PUBLIC_CRON_SECRET: secrets must not start with NEXT_PUBLIC_/.test(out), out);
  check("--offline asks no service", !/The API key works/.test(out) && /Settings only/.test(out));
}
{
  const { out } = await run({ ...good, CRON_SECRET: "cron-secret", PUBLIC_BASE_URL: "http://backroute.pro", QUIET_HOURS: "0-0", PORTAL_WORKER_SECRET: "p".repeat(40) }, ["--offline"]);
  check("a guessable cron secret is caught", /CRON_SECRET is too short/.test(out), out);
  check("a site address without https is caught", /PUBLIC_BASE_URL must start with https/.test(out), out);
  check("test-only hours are pointed out", /! QUIET_HOURS=0-0/.test(out), out);
  check("broker websites without the vault key are caught", /PORTAL_VAULT_KEY isn't set/.test(out), out);
}
{
  world = { ...world, smsUrl: "https://old-site.vercel.app/api/channels/sms", inboundHook: `${SITE}/api/channels/email?token=wrong`, anonSeesCarriers: true, latestMigration: false, accountType: "Trial", cronStatus: 200 };
  const { out } = await run({ ...good, ANTHROPIC_API_KEY: "sk-ant-bad" });
  check("texts going to another site are caught", /incoming texts go to https:\/\/old-site\.vercel\.app/.test(out), out);
  check("an inbound email token that doesn't match is caught", /token= isn't EMAIL_WEBHOOK_TOKEN/.test(out), out);
  check("access rules off (signed-out reads) are caught", /anon key can read carriers/.test(out), out);
  check("migrations not all run are caught", /newest migration isn't run/.test(out), out);
  check("a Twilio trial account is caught", /trial account/.test(out), out);
  check("rounds open to anyone are caught", /without the secret answered 200/.test(out), out);
  check("a refused AI key is caught, with the reason", /API key was refused \(401: invalid x-api-key\)/.test(out), out);
}

server.close();
fs.rmSync(dir, { recursive: true, force: true });
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
