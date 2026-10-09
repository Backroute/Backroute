// Crash reporting, against the stand-ins: errors on the server and in browsers are counted by kind, an error page
// reports what it caught, anyone posting errors is capped, and the System tab and on-call hear about them.
const path = require("path");
const S = path.join(__dirname, "..");
const { chromium } = require("playwright");
const { execSync } = require("child_process");
const BASE = "http://localhost:3210";
const ARGS = [`--proxy-server=${process.env.HTTPS_PROXY}`, "--proxy-bypass-list=localhost;127.0.0.1"];
let passed = 0, failed = 0;
const check = (label, ok, extra = "") => { ok ? passed++ : failed++; console.log(`${ok ? "PASS" : "FAIL"} ${label}${extra ? ` (${String(extra).slice(0, 300)})` : ""}`); };
const db = (q) => execSync(`su postgres -c "/usr/lib/postgresql/16/bin/psql -h /var/lib/postgresql/backroute-test -p 55432 -U postgres -d rest -tA -c \\"${q.replace(/"/g, '\\\\\\"')}\\""`).toString().trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SUPPORT = execSync(`node ${S}/pgrst/jwt.cjs cccccccc-0000-0000-0000-000000000005 13125550100`).toString().trim();
const post = (body, ip = "198.51.100.7") => fetch(`${BASE}/api/errors`, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": ip }, body: JSON.stringify(body) });
const RUN = Date.now().toString(36);

(async () => {
  db(`delete from app_errors`);
  db(`delete from rate_limits where key like 'errors:%'`);
  db(`insert into auth.users values ('cccccccc-0000-0000-0000-000000000005', '13125550100') on conflict do nothing`);
  db(`insert into support_staff (user_id, name) values ('cccccccc-0000-0000-0000-000000000005', 'Sam') on conflict do nothing`);

  // From a browser: the same error twice on two loads is one kind, counted twice; the query never kept.
  await post({ message: `TypeError: x is undefined ${RUN} at load-ab12cd34`, stack: "at a (app.js:1:2)", path: "/carrier/loads/load-ab12cd34ef?token=SECRET" });
  await post({ message: `TypeError: x is undefined ${RUN} at load-zz99yy88`, stack: "at a (app.js:1:2)", path: "/carrier/loads/load-zz99yy88xx" });
  check("a browser error is kept, one row per kind, counted", db(`select count(*) || '|' || max(count) from app_errors where source = 'browser' and message like '%${RUN}%'`) === "1|2", db(`select count(*) || '|' || max(count) from app_errors`));
  check("…without the page's query (it can carry tokens)", !db(`select coalesce(string_agg(path, ','), '') from app_errors`).includes("SECRET"));
  check("…and a bad report is refused", (await post({ stack: "no message" })).status === 400);

  // Anyone can post one, so it's capped per address.
  let last = 0;
  for (let i = 0; i < 31; i++) last = (await post({ message: `flood ${i} ${RUN}` }, "203.0.113.99")).status;
  check("31 reports in ten minutes from one address: the last is refused", last === 429, last);
  check("…and the same error with a different number is one kind, counted", db(`select count(*) || '|' || max(count) from app_errors where message like 'flood % ${RUN}'`) === "1|30");
  db(`delete from app_errors where message like 'flood % ${RUN}'`);

  // On the server: a route that throws is counted, with the route's path (the drill's test crash needs CRON_SECRET).
  check("the test crash is hidden without the secret", (await fetch(`${BASE}/api/errors`)).status === 404);
  const crash = await fetch(`${BASE}/api/errors`, { headers: { authorization: "Bearer cron-secret" } });
  await sleep(1500);
  check("…and with it, a server error is counted, with its path", crash.status === 500 && db(`select count(*) from app_errors where source = 'server' and path = '/api/errors' and message like 'Test crash from /api/errors%'`) === "1", db(`select string_agg(source || ' ' || coalesce(path,'') || ' ' || message, ' / ') from app_errors where source = 'server'`));

  // A page that crashes in the browser: the error page shows, and reports what it caught.
  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ARGS });
  const p = await browser.newPage();
  await p.goto(`${BASE}/login`, { waitUntil: "load" });
  await p.waitForLoadState("networkidle").catch(() => {});
  await p.evaluate((run) => { window.dispatchEvent(new ErrorEvent("error", { error: new Error(`Page blew up ${run}`), message: `Page blew up ${run}` })); }, RUN);
  await p.evaluate(() => { window.dispatchEvent(new ErrorEvent("error", { error: new TypeError("Failed to fetch"), message: "Failed to fetch" })); });
  await sleep(2500);
  check("an error in a page reaches the team, from the page it happened on", db(`select path from app_errors where message like 'Page blew up ${RUN}%'`) === "/login", db(`select string_agg(message, ' / ') from app_errors where source = 'browser'`));
  check("…but a dropped connection (common in a truck) isn't reported", db(`select count(*) from app_errors where message like '%Failed to fetch%'`) === "0");
  await browser.close();

  // The System tab shows them; enough of them, and on-call is alerted.
  let report = await fetch(`${BASE}/api/support/health`, { headers: { authorization: `Bearer ${SUPPORT}` } }).then((r) => r.json());
  let row = report.checks?.find((c) => c.key === "errors");
  check("the System tab lists app errors, with the most common one (a few now and then: shown, not alerted)", row?.level === "warn" && /3 kinds in the last hour/.test(row.detail), JSON.stringify(row));
  db(`update app_errors set count = 25 where message like 'Page blew up ${RUN}%'`);
  report = await fetch(`${BASE}/api/support/health`, { headers: { authorization: `Bearer ${SUPPORT}` } }).then((r) => r.json());
  row = report.checks?.find((c) => c.key === "errors");
  check("…and one that keeps happening is serious enough to alert on-call", row?.level === "down" && /Page blew up/.test(row.detail), JSON.stringify(row));
  db(`delete from app_errors`);
  db(`delete from rate_limits where key like 'errors:%'`);

  console.log(`\n${passed} passed, ${failed} failed`);
})().catch((e) => { console.error(e); process.exit(1); });
