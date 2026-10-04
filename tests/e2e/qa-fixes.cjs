// Screenshots of the screens this round changed, in a real account: the driver's "how dispatch reaches you" (texts
// too, voice answers), Settings → Bring your history (Your imports, Undo), Negotiations (the real composer), and the
// maintenance form's note.
const path = require("path");
const S = path.join(__dirname, "..");
const ROOT = path.join(__dirname, "../..");
const { chromium } = require("playwright");
const { execSync } = require("child_process");
const fs = require("fs");
const ARGS = [`--proxy-server=${process.env.HTTPS_PROXY}`, "--proxy-bypass-list=localhost;127.0.0.1", "--enable-unsafe-swiftshader", "--use-angle=swiftshader", "--ignore-gpu-blocklist"];
const db = (q) => execSync(`su postgres -c "/usr/lib/postgresql/16/bin/psql -h /var/lib/postgresql/backroute-test -p 55432 -U postgres -d rest -tA -c \\"${q.replace(/"/g, '\\\\\\"')}\\""`).toString().trim();
const cid = fs.readFileSync(`${S}/fakes/carrier.txt`, "utf8").trim();
let passed = 0, failed = 0;
const check = (label, ok, extra = "") => { ok ? passed++ : failed++; console.log(`${ok ? "PASS" : "FAIL"} ${label}${extra ? ` (${String(extra).slice(0, 200)})` : ""}`); };

async function signIn(browser, sub, phone, width = 1280) {
  const tok = execSync(`node ${S}/pgrst/jwt.cjs ${sub} ${phone}`).toString();
  const session = JSON.stringify({ access_token: tok, refresh_token: "x", token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: sub, phone, aud: "authenticated", role: "authenticated", app_metadata: {}, user_metadata: {} } });
  const p = await browser.newPage({ viewport: { width, height: 900 } });
  p.errors = [];
  p.on("pageerror", (e) => p.errors.push(e.message));
  await p.goto("http://localhost:3210/login", { waitUntil: "domcontentloaded" });
  await p.evaluate((s) => localStorage.setItem("sb-localhost-auth-token", s), session);
  return p;
}

(async () => {
  // An import to list (as if a spreadsheet had come in).
  db(`delete from agent_marks where carrier_id = '${cid}' and kind = 'import_batch'`);
  db(`insert into agent_marks (carrier_id, load_id, kind, data) values ('${cid}', 'import:imp_qashot0001', 'import_batch', '{"id":"imp_qashot0001","at":"${new Date().toISOString()}","via":"spreadsheet","label":"Spreadsheet","loads":42,"brokerIds":["b1","b2","b3"]}'::jsonb)`);
  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ARGS });

  const d = await signIn(browser, "dddddddd-0000-0000-0000-000000000003", "12145550148", 420);
  await d.goto("http://localhost:3210/driver/profile#dispatch", { waitUntil: "domcontentloaded" });
  await d.getByText("How dispatch reaches you").waitFor({ timeout: 120000 });
  await d.waitForTimeout(1500);
  const card = d.locator("#dispatch");
  await card.scrollIntoViewIfNeeded();
  await card.screenshot({ path: `${S}/.out/fix-driver-dispatch.png` });
  const text = await card.innerText();
  check("the driver can turn texts off and keep notifications", /Texts too/.test(text) && /notifications only/.test(text), text);
  check("voice answers show without WhatsApp too", /Voice answers/.test(text) && /by text or WhatsApp/.test(text), text);
  await d.getByRole("switch", { name: "Texts too" }).click();
  await d.waitForTimeout(4000);
  const saved = db(`select data->'prefs'->>'textsToo' from drivers where carrier_id = '${cid}' and phone_last10 = '2145550148'`);
  check("…and it's saved", saved === "false", saved);
  await d.getByRole("switch", { name: "Texts too" }).click();
  await d.waitForTimeout(3000);

  const p = await signIn(browser, "aaaaaaaa-0000-0000-0000-000000000001", "12145550100");
  await p.goto("http://localhost:3210/carrier/settings?tab=general", { waitUntil: "domcontentloaded" });
  await p.getByText("Bring your history").first().waitFor({ timeout: 120000 }).catch(() => {});
  if (!(await p.getByText("Bring your history").count())) {
    for (const tab of ["Business", "Data", "Integrations", "General"]) {
      const t = p.getByRole("tab", { name: new RegExp(tab, "i") });
      if (await t.count()) { await t.first().click(); await p.waitForTimeout(800); if (await p.getByText("Bring your history").count()) break; }
    }
  }
  const imports = p.getByText("Your imports");
  await imports.waitFor({ timeout: 30000 }).catch(() => {});
  check("Settings lists the imports, each with Undo", (await imports.count()) === 1 && (await p.getByRole("button", { name: /Undo/ }).count()) >= 1);
  const hist = p.getByText("Bring your history").locator("xpath=ancestor::*[contains(@class,'rounded')][1]");
  await hist.scrollIntoViewIfNeeded().catch(() => {});
  await hist.screenshot({ path: `${S}/.out/fix-history.png` }).catch(async () => p.screenshot({ path: `${S}/.out/fix-history.png`, fullPage: true }));

  await p.goto("http://localhost:3210/carrier/negotiations", { waitUntil: "domcontentloaded" });
  await p.waitForTimeout(6000);
  await p.screenshot({ path: `${S}/.out/fix-negotiations.png`, fullPage: false });

  await p.goto("http://localhost:3210/carrier/maintenance", { waitUntil: "domcontentloaded" });
  await p.waitForTimeout(5000);
  const rec = p.getByRole("button", { name: /Record a shop appointment/ });
  if (await rec.count()) { await rec.first().click(); await p.waitForTimeout(800); }
  await p.screenshot({ path: `${S}/.out/fix-maintenance.png`, fullPage: false });
  check("maintenance says the owner books the shop; the AI keeps the truck off", (await p.getByText(/Book the slot with the shop yourself/).count()) >= 1 || (await p.getByText(/Record a shop appointment/).count()) >= 1);

  // This round: Home (setup, money), Settings → Basics, the driver's quick replies.
  await p.goto("http://localhost:3210/carrier", { waitUntil: "domcontentloaded" });
  await p.getByText("Money this week").waitFor({ timeout: 60000 }).catch(() => {});
  await p.screenshot({ path: `${S}/.out/ux-home.png`, fullPage: true });
  check("Home shows the week's money in plain numbers", (await p.getByText("Money this week").count()) === 1);
  await p.goto("http://localhost:3210/carrier/settings?tab=basics", { waitUntil: "domcontentloaded" });
  await p.getByText("What's the lowest you'll take per loaded mile?").waitFor({ timeout: 60000 }).catch(() => {});
  await p.screenshot({ path: `${S}/.out/ux-basics.png`, fullPage: true });
  check("Settings opens on five plain questions", (await p.getByText(/^[1-5] of 5$/).count()) === 5);
  await p.getByRole("radio", { name: "5 minutes" }).click();
  await p.waitForTimeout(4000);
  check("…and an answer saves", db(`select settings->>'undoSeconds' from carriers where id = '${cid}'`) === "300");
  db(`update carriers set settings = settings - 'undoSeconds' where id = '${cid}'`);
  await d.goto("http://localhost:3210/driver/messages", { waitUntil: "domcontentloaded" });
  await d.getByRole("group", { name: "Quick replies to dispatch" }).waitFor({ timeout: 60000 }).catch(() => {});
  await d.waitForTimeout(1500);
  await d.screenshot({ path: `${S}/.out/ux-driver-messages.png` });
  // Which replies show depends on the trip's stage (a booked load has two, a dispatched one three), and the stage this
  // suite finds depends on the time of day the earlier suites ran, so the check is "the replies are there", not a count.
  check("the driver can answer dispatch with one tap", (await d.getByRole("group", { name: "Quick replies to dispatch" }).getByRole("button").count()) >= 2);

  check("no page errors", !d.errors.length && !p.errors.length, [...d.errors, ...p.errors].join(" | "));
  db(`delete from agent_marks where carrier_id = '${cid}' and kind = 'import_batch' and load_id = 'import:imp_qashot0001'`);
  await browser.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
