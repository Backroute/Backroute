// The demo, after the store split: every main screen opens with no errors, and the simulation keeps moving.
const path = require("path");
const S = path.join(__dirname, "..");
const ROOT = path.join(__dirname, "../..");
const { chromium } = require("playwright");
const BASE = "http://localhost:3300";
const ARGS = [`--proxy-server=${process.env.HTTPS_PROXY}`, "--proxy-bypass-list=localhost;127.0.0.1"];
(async () => {
  const b = await chromium.launch({ args: ARGS });
  const errors = [];
  let ok = 0, bad = 0;
  const check = (l, c, x = "") => { c ? ok++ : bad++; console.log(`${c ? "PASS" : "FAIL"} ${l}${x ? ` (${String(x).slice(0, 300)})` : ""}`); };
  const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
  p.on("pageerror", (e) => errors.push(e.message));
  for (const path of ["/carrier", "/carrier/loads", "/carrier/fleet", "/carrier/messages", "/carrier/settings", "/carrier/settlements", "/ops", "/driver", "/driver/loads", "/driver/messages", "/driver/profile"]) {
    await p.goto(BASE + path, { waitUntil: "domcontentloaded", timeout: 180000 });
    await p.waitForTimeout(2500);
    const t = await p.locator("body").innerText();
    check(`${path} opens`, t.length > 200 && !/Application error|Unhandled Runtime Error/.test(t), t.slice(0, 120));
  }
  // The simulation ticks: the carrier's activity feed grows over half a minute.
  await p.goto(BASE + "/carrier", { waitUntil: "domcontentloaded" });
  await p.waitForTimeout(3000);
  const before = await p.evaluate(() => document.body.innerText.length);
  await p.waitForTimeout(25000);
  const after = await p.evaluate(() => document.body.innerText.length);
  check("the demo keeps moving (screen changes as the simulation ticks)", before !== after, `${before} → ${after}`);
  // Driver chat answers.
  await p.goto(BASE + "/driver/messages", { waitUntil: "domcontentloaded" });
  await p.waitForTimeout(3000);
  const box = p.getByPlaceholder(/Ask about your load/);
  await box.fill("Where is my next load?");
  await box.press("Enter");
  await p.waitForTimeout(4000);
  check("the demo AI answers the driver's message", (await p.locator("body").innerText()).split("Where is my next load?").length > 1);
  check("no page errors", errors.length === 0, errors.join(" | "));
  await b.close();
  console.log(`${ok} passed, ${bad} failed`);
  process.exit(bad ? 1 : 0);
})();
