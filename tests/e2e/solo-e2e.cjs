// An owner-operator signing up ("Just me"), on a phone, against the stand-ins: one truck that is theirs, they drive it
// and own it, nobody is invited or texted the app link (they're already in), and the done screen gets them to their
// app and to adding the first load. Uses its own sign-in and deletes its carrier at the end.
const path = require("path");
const S = path.join(__dirname, "..");
const { chromium } = require("playwright");
const { execSync } = require("child_process");
const fs = require("fs");
const BASE = "http://localhost:3210";
const ARGS = [`--proxy-server=${process.env.HTTPS_PROXY}`, "--proxy-bypass-list=localhost;127.0.0.1", "--enable-unsafe-swiftshader", "--use-angle=swiftshader", "--ignore-gpu-blocklist"];
let passed = 0, failed = 0;
const check = (label, ok, extra = "") => { ok ? passed++ : failed++; console.log(`${ok ? "PASS" : "FAIL"} ${label}${extra ? ` (${String(extra).slice(0, 300)})` : ""}`); };
const db = (q) => execSync(`su postgres -c "/usr/lib/postgresql/16/bin/psql -h /var/lib/postgresql/backroute-test -p 55432 -U postgres -d rest -tA -c \\"${q.replace(/"/g, '\\\\\\"')}\\""`).toString().trim();
const tw = () => fs.readFileSync(S + "/fakes/twilio.jsonl", "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
const sub = "cccccccc-0000-0000-0000-000000000021", phone = "13145550121";

(async () => {
  db(`delete from carriers where id in (select carrier_id from members where user_id = '${sub}')`);
  db(`insert into auth.users values ('${sub}', '${phone}') on conflict do nothing`);
  const tok = execSync(`node ${S}/pgrst/jwt.cjs ${sub} ${phone}`).toString().trim();
  const session = JSON.stringify({ access_token: tok, refresh_token: "x", token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: sub, phone, aud: "authenticated", role: "authenticated", app_metadata: {}, user_metadata: {} } });
  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ARGS });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await ctx.addInitScript((s) => localStorage.setItem("sb-localhost-auth-token", s), session);
  const p = await ctx.newPage();
  const errors = [];
  p.on("pageerror", (e) => errors.push(e.message));
  const tw0 = tw().length;

  await p.goto(`${BASE}/signup`, { waitUntil: "domcontentloaded" });
  await p.getByLabel("MC number").waitFor({ timeout: 90000 });
  await p.getByLabel("MC number").fill("548213");
  await p.getByRole("button", { name: "Look up" }).click();
  await p.getByRole("radio", { name: /Just me/ }).click();
  await p.getByRole("button", { name: /That's us/ }).click();
  await p.getByRole("heading", { name: "Your truck" }).waitFor();
  const f = p.getByRole("group").nth(0);
  check("one truck, and the form speaks to the owner (\"Your name\", \"Your cell number\")", (await f.getByLabel("Your name", { exact: true }).count()) === 1 && (await f.getByLabel("Your cell number", { exact: true }).count()) === 1 && (await p.getByRole("button", { name: "Another truck" }).count()) === 0);
  await f.getByLabel("Your name", { exact: true }).fill("Ray Ortiz");
  await f.getByLabel("Your cell number", { exact: true }).fill("(314) 555-0121");
  await f.getByLabel("Truck unit number", { exact: true }).fill("1");
  await f.getByLabel("Home base city", { exact: true }).fill("St. Louis");
  await f.getByLabel("Home base state", { exact: true }).fill("MO");
  await p.getByRole("button", { name: "Next", exact: true }).click();
  await p.getByRole("button", { name: /^Next/ }).click();
  await p.getByRole("button", { name: /Finish/ }).click();
  await p.getByText("You're set up").waitFor({ timeout: 30000 });
  check("the done screen opens their app, and offers to add the first load", (await p.getByRole("link", { name: /Open your app/ }).count()) === 1 && (await p.getByRole("link", { name: /Add your first load/ }).getAttribute("href")) === "/carrier/loads" && !(await p.getByText(/on the Loads page/).count()));
  await p.waitForTimeout(4000);

  const cid = db(`select carrier_id from members where user_id = '${sub}'`);
  check("the carrier is an owner-operator, and they're its owner and its driver", db(`select owner_operator from carriers where id = '${cid}'`) === "t" && /^owner\|driver-/.test(db(`select role || '|' || coalesce(driver_id, '') from members where user_id = '${sub}'`)), db(`select role || '|' || coalesce(driver_id, '') from members where user_id = '${sub}'`));
  check("…with one truck and one driver, them, on their own number", db(`select count(*) from trucks where carrier_id = '${cid}'`) === "1" && db(`select name || '|' || phone_last10 from drivers where carrier_id = '${cid}'`) === "Ray Ortiz|3145550121");
  check("nobody is invited and nothing is texted: they're already in", db(`select count(*) from invites where carrier_id = '${cid}'`) === "0" && !tw().slice(tw0).some((x) => (x.params?.To ?? "").endsWith("3145550121")));

  await p.getByRole("link", { name: /Open your app/ }).click();
  await p.waitForURL(/\/driver$/, { timeout: 90000 });
  await p.getByText(/Hi Ray/).waitFor({ timeout: 60000 }).catch(() => {});
  check("their app opens on the driver home, by name", (await p.getByText(/Hi Ray/).count()) >= 1);
  await p.goto(`${BASE}/driver/profile`, { waitUntil: "domcontentloaded" });
  await p.getByText(/on a bigger screen/).waitFor({ timeout: 60000 }).catch(() => {});
  check("Profile has the business side, and the way to the owner screens", (await p.getByRole("link", { name: /Brokers, payments and paperwork on a bigger screen/ }).getAttribute("href").catch(() => null)) === "/carrier");
  await p.goto(`${BASE}/carrier/loads`, { waitUntil: "domcontentloaded" });
  await p.getByRole("button", { name: "Add a load" }).waitFor({ timeout: 90000 }).catch(() => {});
  check("…where they can add a load", (await p.getByRole("button", { name: "Add a load" }).count()) >= 1);
  check("no page errors", errors.length === 0, errors.join(" / "));

  await browser.close();
  db(`delete from carriers where id = '${cid}'`);
  console.log(`\n${passed} passed, ${failed} failed`);
})().catch((e) => { console.error(e); process.exit(1); });
