// The demo: every main screen opens with no errors, the simulation keeps moving, and nothing covers a button.
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
  // Plans: the AI offers several loads as one choice (back to back, or partials on one trailer), and booking one books
  // the whole plan, so the row of choices for that truck goes away.
  await p.goto(BASE + "/driver/loads", { waitUntil: "domcontentloaded" });
  await p.getByText("Choose your next load").waitFor({ timeout: 90000 }).catch(() => {});
  const rail = await p.locator("body").innerText();
  check("the AI offers multi-load plans among the choices", /\d loads back to back|\d loads, one trailer/.test(rail), rail.slice(0, 200));
  const later = p.getByRole("button", { name: /Later, text me/ });
  if (await later.count()) await later.first().click().catch(() => {});
  const bookAll = p.getByRole("button", { name: /^Book all \d loads$/ }).first();
  if (await bookAll.count()) {
    await bookAll.scrollIntoViewIfNeeded();
    await bookAll.click();
    await p.waitForTimeout(1500);
    check("booking a plan books it whole: the truck's choices are gone", (await p.getByRole("button", { name: /^Book all \d loads$|^Select this load$/ }).count()) === 0);
  } else check("a plan's card has a Book all button", false);
  // Nothing covers a button: on a phone, every button in driving mode is the thing a tap at its centre lands on.
  const ph = await b.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  ph.on("pageerror", (e) => errors.push(e.message));
  await ph.goto(BASE + "/driver", { waitUntil: "domcontentloaded" });
  await ph.getByRole("button", { name: /driving mode/i }).first().click({ timeout: 60000 });
  await ph.waitForTimeout(1500);
  // Every button and line of text, at its centre and both ends: what's there must be driving mode itself.
  const covered = await ph.evaluate(() => {
    const dialog = document.querySelector('[role="dialog"][aria-label="Driving mode"]');
    return [...dialog.querySelectorAll("button, p")]
      .filter((el) => {
        const r = el.getBoundingClientRect();
        return [r.left + 4, r.left + r.width / 2, r.right - 4].some((x) => {
          const hit = document.elementFromPoint(x, r.top + r.height / 2);
          // Next's own dev-mode badge (bottom corner) isn't part of the app and isn't there in production.
          if (hit?.tagName === "NEXTJS-PORTAL") return false;
          return !hit || !dialog.contains(hit);
        });
      })
      .map((el) => el.textContent.trim().slice(0, 40));
  });
  check("driving mode: nothing on it is covered (buttons, the stop, the footer)", covered.length === 0, covered.join(" | "));
  const parked = await ph.getByRole("button", { name: /parked/i }).boundingBox();
  check("…and I'm parked sits on screen, below the top edge", !!parked && parked.y >= 0 && parked.y + parked.height <= 844, JSON.stringify(parked));
  await ph.getByRole("button", { name: /parked/i }).click();
  await ph.waitForTimeout(800);
  check("…and tapping it closes driving mode", (await ph.getByRole("dialog", { name: "Driving mode" }).count()) === 0);
  // The website on a phone: nothing wider than the screen.
  await ph.goto(BASE + "/", { waitUntil: "domcontentloaded" });
  await ph.waitForTimeout(2500);
  check("the website fits a phone (no sideways scroll)", await ph.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  check("…and leads with the new headline", /Your next load\s+is already booked\./.test(await ph.locator("h1").innerText()));
  check("…with the lanes drawn behind it (the 3D scene, or the flat drawing where 3D can't run)", (await ph.locator("section canvas, section svg").count()) > 0);
  const kept = () => ph.getByText("What you keep", { exact: true }).locator("xpath=..").innerText();
  const keptBefore = await kept();
  await ph.getByLabel("The load pays").fill("4000");
  await ph.waitForTimeout(800);
  check("the load math: a higher rate means more kept, right away", (await kept()) !== keptBefore && /\$3,/.test(await kept()), `${keptBefore} → ${await kept()}`);
  check("no page errors", errors.length === 0, errors.join(" | "));
  await b.close();
  console.log(`${ok} passed, ${bad} failed`);
  process.exit(bad ? 1 : 0);
})();
