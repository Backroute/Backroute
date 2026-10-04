// The built app opens with no signal: the driver's screen loads once online, the phone loses signal, and the app is
// opened again from scratch. Runs against `next start` on 3211 (built with the stand-ins' settings).
const path = require("path");
const S = path.join(__dirname, "..");
const ROOT = path.join(__dirname, "../..");
const { execSync } = require("child_process");
const { chromium } = require("playwright");
const BASE = "http://localhost:3211";
let passed = 0, failed = 0;
const check = (label, ok, extra = "") => { ok ? passed++ : failed++; console.log(`${ok ? "PASS" : "FAIL"} ${label}${extra ? ` (${String(extra).slice(0, 300)})` : ""}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const token = (sub, phone) => execSync(`node ${S}/pgrst/jwt.cjs ${sub} ${phone}`).toString();
const DRV_SUB = "dddddddd-0000-0000-0000-000000000003", DRV_PHONE = "12145550148";

const db = (q) => execSync(`su postgres -c "/usr/lib/postgresql/16/bin/psql -h /var/lib/postgresql/backroute-test -p 55432 -U postgres -d rest -tA -c \\"${q.replace(/"/g, '\\\\\\"').replace(/\$/g, () => "\\\\\\$")}\\""`).toString().trim();

(async () => {
  // The test driver signs in as Marcus, on truck 101 (made by real-e2e).
  const cid = require("fs").readFileSync(`${S}/fakes/carrier.txt`, "utf8").trim();
  const marcus = db(`select id from drivers where carrier_id = '${cid}' and name = 'Marcus Bell'`);
  db(`delete from members where user_id = '${DRV_SUB}'`);
  db(`insert into members (user_id, carrier_id, role, driver_id) values ('${DRV_SUB}', '${cid}', 'driver', '${marcus}')`);
  // Through the proxy, so the map pieces can come from the internet while online.
  const browser = await chromium.launch({ args: [`--proxy-server=${process.env.HTTPS_PROXY}`, "--proxy-bypass-list=localhost;127.0.0.1"] });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const tok = token(DRV_SUB, DRV_PHONE);
  const session = JSON.stringify({ access_token: tok, refresh_token: "x", token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: DRV_SUB, phone: DRV_PHONE, aud: "authenticated", role: "authenticated", app_metadata: {}, user_metadata: {} } });
  await ctx.addInitScript((x) => localStorage.setItem("sb-localhost-auth-token", x), session);
  const p = await ctx.newPage();
  const errors = [];
  p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(`${BASE}/driver`, { waitUntil: "load" });
  await p.waitForFunction(() => navigator.serviceWorker && navigator.serviceWorker.controller !== null, null, { timeout: 60000 }).catch(() => {});
  // The first visit installs the worker; a second load makes sure the page and its files are in the copy.
  await p.reload({ waitUntil: "load" });
  await sleep(4000);
  const sw = await p.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.active?.scriptURL ?? null);
  check("the built app keeps an offline copy (worker with offline on)", !!sw && sw.includes("offline=1"), sw);
  const onlineText = await p.locator("body").innerText().catch(() => "");
  console.log("CACHED", JSON.stringify(await p.evaluate(async () => { const out = []; for (const k of await caches.keys()) { const c = await caches.open(k); out.push(k, (await c.keys()).map((r) => new URL(r.url).pathname).filter((x) => !x.startsWith("/_next")).join(",")); } return out; })));
  console.log("CONTROLLED", await p.evaluate(() => !!navigator.serviceWorker.controller));
  console.log("ONLINE TEXT", onlineText.slice(0, 120).replace(/\n/g, " | "));
  await ctx.setOffline(true);
  await p.goto(`${BASE}/driver`, { waitUntil: "load" }).catch((e) => errors.push(`navigate: ${e.message}`));
  await sleep(4000);
  const offlineText = await p.locator("body").innerText().catch(() => "");
  console.log("OFFLINE BODY", (await p.locator("body").innerText().catch((e) => "ERR " + e.message)).slice(0, 200).replace(/\n/g, " | "));
  check("no signal, opened from scratch: the driver's screen still opens", offlineText.length > 50 && !/ERR_INTERNET_DISCONNECTED|No internet/i.test(offlineText), offlineText.slice(0, 200));
  check("…showing the same trip as before", /Hi Marcus/.test(onlineText) && /Hi Marcus/.test(offlineText) && /Pay this week/.test(offlineText), offlineText.slice(0, 200));
  await p.screenshot({ path: `${S}/.out/offline-prod-driver.png` });
  await ctx.setOffline(false);

  // (The trip's map area is tested in sw-unit.cjs: this sandbox's service workers can't reach the internet.)

  // A Yes tapped on a notification with no signal waits on the phone, then goes once it's back online.
  const crypto = require("crypto");
  const escId = `esc-offline-${Date.now()}`;
  db(`insert into escalations (id, carrier_id, status, data) values ('${escId}', '${cid}', 'open', '${JSON.stringify({ id: escId, loadId: "", carrierId: "carrier-titan", reason: "Offline answer test", createdAt: new Date().toISOString(), status: "open", complexity: "routine", recommendedAction: "approve", recommendedLabel: "Got it", source: "app" })}'::jsonb)`);
  const key = crypto.createHmac("sha256", process.env.SUPABASE_SERVICE_ROLE_KEY).update("backroute-answer-links").digest();
  const body = Buffer.from(JSON.stringify({ c: cid, e: escId, x: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url");
  const answerTok = `${body}.${crypto.createHmac("sha256", key).update(body).digest("base64url")}`;
  await p.evaluate(
    (a) =>
      new Promise((res, rej) => {
        const o = indexedDB.open("backroute-sw", 1);
        o.onupgradeneeded = () => o.result.createObjectStore("answers", { keyPath: "id" });
        o.onsuccess = () => {
          const tx = o.result.transaction("answers", "readwrite");
          tx.objectStore("answers").put(a);
          tx.oncomplete = () => res(true);
          tx.onerror = () => rej(tx.error);
        };
      }),
    { id: "a1", token: answerTok, answer: "yes", title: "Offline answer test", url: "/carrier", at: Date.now() },
  );
  await p.evaluate(() => navigator.serviceWorker.ready.then((r) => r.active.postMessage({ type: "online" })));
  let status = "";
  for (let i = 0; i < 20 && status !== "resolved"; i++) {
    await sleep(1000);
    status = db(`select data->>'status' from escalations where carrier_id = '${cid}' and id = '${escId}'`);
  }
  check("a Yes saved with no signal goes through once back online", status === "resolved", status);
  const left = await p.evaluate(() => new Promise((res) => { const o = indexedDB.open("backroute-sw", 1); o.onsuccess = () => { const q = o.result.transaction("answers").objectStore("answers").count(); q.onsuccess = () => res(q.result); }; }));
  check("...and isn't kept to send again", left === 0, left);
  check("no page errors", errors.filter((e) => !/Failed to fetch|NetworkError|Load failed|navigate:/.test(e)).length === 0, errors.join(" | "));
  await browser.close();
  console.log(`${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
