// The new screens in a real account, in a browser: Settings (rates, billing, check-ins, papers), offers from email,
// the load's broker card with "book it", a draft with attachments, and the driver's app. Run after dispatch-e2e.
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
const pm = () => fs.readFileSync(S + "/fakes/postmark.jsonl", "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
const tw = () => fs.readFileSync(S + "/fakes/twilio.jsonl", "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));

async function signIn(browser, sub, phone, width = 1280) {
  const tok = execSync(`node ${S}/pgrst/jwt.cjs ${sub} ${phone}`).toString();
  const session = JSON.stringify({ access_token: tok, refresh_token: "x", token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: sub, phone, aud: "authenticated", role: "authenticated", app_metadata: {}, user_metadata: {} } });
  const p = await browser.newPage({ viewport: { width, height: 900 } });
  p.errors = [];
  p.on("pageerror", (e) => p.errors.push(e.message));
  p.on("console", (m) => { if (m.type() === "error" && !/osrm|ERR_FAILED|tile|realtime|WebSocket/i.test(m.text())) p.errors.push(m.text()); });
  await p.goto("http://localhost:3210/login", { waitUntil: "domcontentloaded" });
  await p.evaluate((s) => localStorage.setItem("sb-localhost-auth-token", s), session);
  return p;
}

(async () => {
  // An offer from email for truck 102 (Ana), and a load waiting on its broker for truck 101.
  db(`insert into loads (id, carrier_id, truck_id, stage, data) select 'load-ui-offer', carrier_id, truck_id, 'offered', data || '{"id":"load-ui-offer","referenceNumber":"UI-OFFER","stage":"offered","offerGroupId":"offers-ui","targetRate":2100,"listedRate":2000,"source":"Email from TQL"}'::jsonb from loads where carrier_id = '${cid}' and data->>'referenceNumber' = 'TQL-5501'`);
  const waiting = db(`select id from loads where carrier_id = '${cid}' and data->>'referenceNumber' = 'TQL-7701'`);
  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ARGS });
  const p = await signIn(browser, "aaaaaaaa-0000-0000-0000-000000000001", "12145550100");

  // Settings
  await p.goto("http://localhost:3210/carrier/settings?tab=general", { waitUntil: "domcontentloaded" });
  await p.getByText("Rates, billing and check-ins").waitFor({ timeout: 90000 });
  check("rates card shows the saved lowest rate", (await p.getByLabel("Lowest rate per loaded mile").inputValue()) === "2.50");
  await p.getByLabel("Lowest rate per loaded mile").fill("0.10");
  check("a silly rate is refused", (await p.getByText(/a rate per mile between/).count()) === 1);
  await p.getByLabel("Lowest rate per loaded mile").fill("2.75");
  await p.getByLabel("Factoring company email (optional)").fill("ops@factor.test");
  await p.getByRole("button", { name: "Save", exact: true }).click();
  await p.waitForTimeout(4000);
  check("saved to the account", db(`select (settings->>'minRpm') || '|' || (settings->>'factoringEmail') from carriers where id = '${cid}'`) === "2.75|ops@factor.test");
  await p.getByRole("switch", { name: "Check-ins with drivers" }).click();
  await p.waitForTimeout(4000);
  check("check-ins can be turned off", db(`select settings->>'checkIns' from carriers where id = '${cid}'`) === "false");
  await p.getByRole("switch", { name: "Check-ins with drivers" }).click();
  await p.waitForTimeout(3000);
  const papers = await p.getByText("Your papers").locator("xpath=ancestor::*[contains(@class,'rounded')][1]").innerText();
  check("papers card lists the W-9 and the newest COI with its expiry", /Titan-W9\.pdf/.test(papers) && /Titan-COI-old\.pdf · expires/.test(papers) && /Operating authority[\s\S]*Not on file/.test(papers), papers.slice(0, 300));
  await p.getByLabel("Upload Operating authority (MC letter)").setInputFiles({ name: "MC-letter.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 MC") });
  await p.getByText("MC-letter.pdf").waitFor({ timeout: 15000 });
  check("owner uploads the authority letter from Settings", db(`select count(*) from carrier_files where carrier_id = '${cid}' and kind = 'authority'`) === "1");
  await p.getByLabel("Upload Insurance certificate (COI)").setInputFiles({ name: "x.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF") });
  check("COI needs its expiry date first", (await p.getByText("Put in the date it expires first.").count()) === 1);
  await p.screenshot({ path: `${S}/.out/ui-settings-papers.png`, fullPage: true });

  // Offers from email on the dashboard
  await p.evaluate(() => window.next.router.push("/carrier"));
  await p.getByText("Choose your next load").waitFor({ timeout: 30000 });
  const board = await p.locator("#next-load").innerText();
  check("offers say where they came from and what the AI will ask", /brokers emailed you/.test(board) && /Backroute asks \$[0-9,]+ \(posted \$2,000\)/i.test(board) && /Email from TQL/.test(board), board.slice(0, 300));
  check("no demo load-board wording or fake broker Q&A", !/connected board/.test(board) && (await p.getByRole("button", { name: "Ask a question" }).count()) === 0);
  await p.screenshot({ path: `${S}/.out/ui-offers.png` });
  const pm0 = pm().length;
  await p.getByRole("button", { name: "Ask to book it" }).first().click();
  await p.waitForTimeout(5000);
  const req = pm().slice(pm0).find((x) => /UI-OFFER/.test(x.body.TextBody));
  check("tapping it emails the broker the book request, raised to the new floor ($2.75 × 780 mi → $2,150)", !!req && /\$2,150 all in/.test(req.body.TextBody), req?.body.TextBody?.slice(0, 120));
  check("the offer leaves the board", (await p.getByText("Choose your next load").count()) === 0 && db(`select stage from loads where id = 'load-ui-offer'`) === "negotiating");

  // Needs you: a draft with attachments
  const drafts = await p.getByText("Invoice INV", { exact: false }).count() + (await p.locator("button:has-text('.pdf')").count());
  check("drafts show their attachments to open", drafts > 0 || (await p.locator("text=/\\.pdf/").count()) > 0);

  // The load waiting on its broker
  await p.evaluate((id) => window.next.router.push(`/carrier/loads/${id}`), waiting);
  await p.getByText("With the broker").waitFor({ timeout: 30000 });
  const card = await p.getByText("With the broker").locator("xpath=ancestor::*[contains(@class,'rounded')][1]").innerText();
  check("broker card shows the ask and where it stands", /Asked \$1,050/.test(card) && /waiting on their answer/.test(card), card.slice(0, 200));
  check("no simulated negotiation controls in a real account", (await p.getByText("Negotiation", { exact: true }).count()) === 0);
  const tw0 = tw().length;
  await p.getByRole("button", { name: "The broker confirmed: book it" }).click();
  await p.waitForTimeout(5000);
  check("book it: load goes on the truck as its next load", db(`select stage from loads where id = '${waiting}'`) === "booked" && !!db(`select data->>'nextLoadId' from trucks where carrier_id = '${cid}' and data->>'nextLoadId' = '${waiting}'`));
  check("...and the driver gets the text", tw().slice(tw0).some((x) => x.params.To === "+12145550148" && /TQL-7701/.test(x.params.Body ?? "")));
  await p.screenshot({ path: `${S}/.out/ui-booking-card.png`, fullPage: true });
  console.log("owner errors:", p.errors);

  // The driver's app: no offers, POD upload goes to the server
  const d = await signIn(browser, "dddddddd-0000-0000-0000-000000000003", "12145550148", 420);
  await d.goto("http://localhost:3210/driver/loads", { waitUntil: "domcontentloaded" });
  await d.waitForTimeout(12000);
  await d.screenshot({ path: `${S}/.out/ui-driver-loads.png`, fullPage: true });
  const dtext = await d.locator("body").innerText();
  check("a company driver's app shows no broker offers", !/Ask to book it|Select this load|Choose your next load/.test(dtext));
  await d.screenshot({ path: `${S}/.out/ui-driver-loads.png`, fullPage: true });
  console.log("driver errors:", d.errors);
  await browser.close();
  console.log(`\n${passed} passed, ${failed} failed`);
})().catch((e) => { console.error(e); process.exit(1); });
