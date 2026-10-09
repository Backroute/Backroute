// The support console and the owner's view of support items, in a browser. Run after autonomy-e2e.
const path = require("path");
const S = path.join(__dirname, "..");
const ROOT = path.join(__dirname, "../..");
const { chromium } = require("playwright");
const { execSync } = require("child_process");
const fs = require("fs");
const ARGS = [`--proxy-server=${process.env.HTTPS_PROXY}`, "--proxy-bypass-list=localhost;127.0.0.1", "--enable-unsafe-swiftshader", "--use-angle=swiftshader", "--ignore-gpu-blocklist"];
let passed = 0, failed = 0;
const check = (label, ok, extra = "") => { ok ? passed++ : failed++; console.log(`${ok ? "PASS" : "FAIL"} ${label}${extra ? ` (${String(extra).slice(0, 200)})` : ""}`); };
const db = (q) => execSync(`su postgres -c "/usr/lib/postgresql/16/bin/psql -h /var/lib/postgresql/backroute-test -p 55432 -U postgres -d rest -tA -c \\"${q.replace(/"/g, '\\\\\\"')}\\""`).toString().trim();
const cid = fs.readFileSync(`${S}/fakes/carrier.txt`, "utf8").trim();

async function signIn(browser, sub, phone) {
  const tok = execSync(`node ${S}/pgrst/jwt.cjs ${sub} ${phone}`).toString();
  const session = JSON.stringify({ access_token: tok, refresh_token: "x", token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: sub, phone, aud: "authenticated", role: "authenticated", app_metadata: {}, user_metadata: {} } });
  const p = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  p.setDefaultTimeout(90000);
  p.setDefaultNavigationTimeout(120000);
  p.errors = [];
  p.on("pageerror", (e) => p.errors.push(e.message));
  p.on("console", (m) => { if (m.type() === "error" && !/osrm|ERR_FAILED|tile|realtime|WebSocket/i.test(m.text())) p.errors.push(m.text()); });
  await p.goto("http://localhost:3210/login", { waitUntil: "domcontentloaded" });
  await p.evaluate((s) => localStorage.setItem("sb-localhost-auth-token", s), session);
  return p;
}

(async () => {
  // The dev server was just restarted by the voice test: compile each page once before the browser times anything.
  for (const path of ["/ops", "/carrier", "/carrier/settings", "/carrier/fleet"]) await fetch(`http://localhost:3210${path}`, { signal: AbortSignal.timeout(180000) }).catch(() => {});
  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ARGS });
  const s = await signIn(browser, "cccccccc-0000-0000-0000-000000000005", "13125550100");
  await s.goto("http://localhost:3210/ops", { waitUntil: "domcontentloaded" });
  await s.getByText(/Waiting on us/).waitFor({ timeout: 90000 });
  await s.waitForTimeout(3000);
  const text = await s.locator("main").innerText();
  const waiting = Number(db(`select count(*) from escalations where status = 'with_support'`));
  check("support console lists what's waiting across carriers", /waiting/.test(text) && waiting > 0 && (await s.locator("article").count()) === waiting, `${waiting} waiting`);
  check("urgent items say so, and show who to call", /Urgent|Call /.test(text) && (await s.getByRole("link", { name: /Call owner/ }).count()) > 0);
  await s.screenshot({ path: `${S}/.out/ui-support-console.png`, fullPage: true });
  const notesBefore = Number(db(`select count(*) from escalations where data->>'resolutionNote' = 'Handled from the console test.'`));
  const first = s.locator("article").first();
  const reason = (await first.locator("p").nth(0).innerText()).slice(0, 40);
  if ((await first.getByRole("button", { name: /take it/ }).count()) > 0) {
    await first.getByRole("button", { name: /take it/ }).click();
    await s.waitForTimeout(3000);
  }
  check("taking an item shows who has it", /Sam has it/.test(await s.locator("article").first().innerText()));
  await s.locator("article").first().getByLabel("What you did").fill("Handled from the console test.");
  await s.locator("article").first().getByRole("button", { name: "Done" }).click();
  await s.waitForTimeout(4000);
  check("closing it takes it off the queue and records the note", Number(db(`select count(*) from escalations where status = 'with_support'`)) === waiting - 1 && Number(db(`select count(*) from escalations where data->>'resolutionNote' = 'Handled from the console test.'`)) === notesBefore + 1, reason);
  await s.getByRole("button", { name: "Carriers" }).click();
  check("carriers tab shows each carrier and its autopilot", /Titan Freight LLC/.test(await s.locator("main").innerText()) && /Full autopilot|Within my rules|Ask me first/.test(await s.locator("main").innerText()));
  console.log("support errors:", s.errors);

  const o = await signIn(browser, "aaaaaaaa-0000-0000-0000-000000000001", "12145550100");
  await o.goto("http://localhost:3210/carrier", { waitUntil: "domcontentloaded" });
  await o.getByText("Needs you").first().waitFor({ timeout: 90000 });
  await o.waitForTimeout(3000);
  check("the owner sees support items as handled, with nothing to do", (await o.getByText("Backroute support is on it. Nothing needed from you.").count()) > 0);
  check("the AI's offer to stop asking shows with a one-tap answer", (await o.getByRole("button", { name: "Yes, stop asking" }).count()) === 1);
  await o.goto("http://localhost:3210/ops", { waitUntil: "domcontentloaded" });
  await o.getByText("This page is for Backroute's support team.").waitFor({ timeout: 60000 });
  check("an owner can't open the support console", true);
  await o.goto("http://localhost:3210/carrier/settings?tab=general", { waitUntil: "domcontentloaded" });
  await o.getByText("ELD, load boards and feeds").waitFor({ timeout: 180000 });
  await o.waitForTimeout(3000);
  const conn = await o.getByText("ELD, load boards and feeds").locator("xpath=ancestor::*[contains(@class,'rounded')][1]").innerText();
  check("Settings shows what's connected, never the keys", /Motive ELD/.test(conn) && /Truckstop/.test(conn) && /DAT/.test(conn) && !/motive-good-key|feed-secret|b123-key/.test(conn), conn.slice(0, 200));
  await o.screenshot({ path: `${S}/.out/ui-connections.png`, fullPage: true });
  check("Settings has the owner's rules, all off to start", (await o.getByText("Your rules").count()) === 1 && (await o.getByRole("switch", { name: "Claim TONU at the usual amount" }).getAttribute("aria-checked")) === "false");
  await o.goto("http://localhost:3210/carrier/fleet", { waitUntil: "domcontentloaded" });
  await o.getByText("Backroute's plan").first().waitFor({ timeout: 60000 }).catch(() => {});
  const fleet = await o.locator("main").innerText();
  check("Fleet shows the AI's plan per truck and where the GPS comes from", /Backroute's plan/.test(fleet) && /Empty in|Now:/.test(fleet) && /GPS via Motive|no ELD connected/.test(fleet), fleet.slice(0, 300));
  await o.screenshot({ path: `${S}/.out/ui-fleet-plan.png`, fullPage: true });
  console.log("owner errors:", o.errors);
  await browser.close();
  console.log(`\n${passed} passed, ${failed} failed`);
})().catch((e) => { console.error(e); process.exit(1); });
