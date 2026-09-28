// Backroute's browser worker: the AI dispatcher's hands on other companies' websites. It signs rate cons in DocuSign
// and brokers' portals, fills carrier setups (MyCarrierPackets, RMIS, Highway...) and books dock appointments on
// scheduling sites. It holds no carrier data and makes no decisions: it takes a job from the app, opens the link in a
// fresh browser, and on every page sends the app what's there (the text, the things you can click or type in, a
// screenshot); the app answers with one action, which this does. Passwords arrive only inside the action that types
// them, for the website they belong to, and are never written to a log or a disk.
//
// Runs anywhere Chromium runs (a container: see Dockerfile). Environment:
//   APP_URL                 the app, e.g. https://backroute.vercel.app
//   PORTAL_WORKER_SECRET    shared with the app
//   WORKER_ID               a name for this worker (default: host and process)
//   WORKER_CONCURRENCY      jobs at once (default 3)
//   POLL_SECONDS            how often to ask for work when idle (default 10)
//   TASK_MAX_MINUTES        longest a job may take, waiting on the owner included (default 45)
//   CHROMIUM_PATH           a Chromium to use instead of Playwright's
//   CHROMIUM_ARGS           extra Chromium flags, each starting with --
//   PORT                    health check (default 8081)
//   ALLOW_PRIVATE_HOSTS=1   tests only: lets the browser open localhost and private addresses

import dns from "node:dns/promises";
import fs from "node:fs/promises";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright-core";

const APP = (process.env.APP_URL ?? "").replace(/\/$/, "");
const SECRET = process.env.PORTAL_WORKER_SECRET ?? "";
const WORKER = process.env.WORKER_ID || `${os.hostname()}-${process.pid}`;
const CONCURRENCY = Math.max(1, Number(process.env.WORKER_CONCURRENCY ?? 3));
const POLL = Math.max(1, Number(process.env.POLL_SECONDS ?? 10)) * 1000;
const MAX_MS = Math.max(1, Number(process.env.TASK_MAX_MINUTES ?? 45)) * 60_000;
const CHROMIUM = process.env.CHROMIUM_PATH || undefined;
const PORT = Number(process.env.PORT ?? 8081);
const PRIVATE_OK = process.env.ALLOW_PRIVATE_HOSTS === "1";
const EXTRA_ARGS = (process.env.CHROMIUM_ARGS ?? "").trim() ? process.env.CHROMIUM_ARGS.trim().split(/\s+(?=--)/) : [];

const log = (...a) => console.log(new Date().toISOString(), "[portal-worker]", ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function app(body) {
  const res = await fetch(`${APP}/api/portal/worker`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${SECRET}` },
    body: JSON.stringify({ worker: WORKER, ...body }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) throw new Error(`app answered ${res.status}`);
  return res.json();
}

// ─── Where the browser may go ────────────────────────────────────────────────

// A link from an email must not reach the machine's own network (cloud metadata, internal services).
function privateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  const v = ip.toLowerCase();
  return v === "::1" || v === "::" || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe80") || v.startsWith("::ffff:127.") || v.startsWith("::ffff:10.") || v.startsWith("::ffff:192.168.");
}
const hostVerdict = new Map();
async function allowedUrl(raw) {
  let u;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol === "data:" || u.protocol === "blob:" || u.protocol === "about:") return true;
  if (u.protocol !== "https:" && u.protocol !== "http:") return false;
  if (PRIVATE_OK) return true;
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (/^(localhost|.*\.local|.*\.internal)$/i.test(host)) return false;
  if (net.isIP(host)) return !privateIp(host);
  if (!hostVerdict.has(host)) {
    const ok = await dns
      .lookup(host, { all: true })
      .then((all) => all.every((a) => !privateIp(a.address)))
      .catch(() => true); // Unresolvable: the browser fails on its own.
    hostVerdict.set(host, ok);
  }
  return hostVerdict.get(host);
}

// ─── What's on the page ──────────────────────────────────────────────────────

// Runs inside each frame: numbers what you can click or type in (marking each with data-br-i), and reads the text.
function readFrame(base) {
  const out = [];
  let k = base;
  document.querySelectorAll("[data-br-i]").forEach((e) => e.removeAttribute("data-br-i"));
  const shown = (el) => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 1 && r.height > 1 && s.visibility !== "hidden" && s.display !== "none" && Number(s.opacity) > 0.05;
  };
  const text = (s) => (s ?? "").replace(/\s+/g, " ").trim();
  const labelOf = (el) => {
    const by = el.getAttribute("aria-labelledby");
    const parts = [
      el.getAttribute("aria-label"),
      by ? by.split(/\s+/).map((id) => document.getElementById(id)?.innerText ?? "").join(" ") : null,
      el.labels?.length ? [...el.labels].map((l) => l.innerText).join(" ") : null,
      el.getAttribute("placeholder"),
      el.getAttribute("title"),
      ["INPUT", "SELECT", "TEXTAREA"].includes(el.tagName) ? null : el.innerText,
      el.tagName === "INPUT" && ["submit", "button"].includes(el.type) ? el.value : null,
      el.getAttribute("alt"),
      el.getAttribute("name"),
      el.id,
    ];
    return text(parts.find((p) => text(p)) ?? "").slice(0, 160);
  };
  const sel =
    "a[href], button, input:not([type=hidden]), select, textarea, [role=button], [role=link], [role=checkbox], [role=radio], [role=tab], [role=menuitem], [role=option], [role=combobox], [contenteditable=true], [onclick], summary";
  for (const el of document.querySelectorAll(sel)) {
    if (out.length >= 250) break;
    const tag = el.tagName.toLowerCase();
    const type = tag === "input" ? (el.type || "text").toLowerCase() : undefined;
    // File boxes and styled checkboxes are often hidden behind a label or button: kept when their label shows.
    const hiddenOk = type === "file" || ((type === "checkbox" || type === "radio") && [...(el.labels ?? [])].some(shown));
    if (!hiddenOk && !shown(el)) continue;
    const label = labelOf(el);
    if (!label && tag === "a") continue;
    const i = k++;
    el.setAttribute("data-br-i", String(i));
    const item = { i, tag, label: label || tag };
    if (type) item.type = type;
    const role = el.getAttribute("role");
    if (role) item.role = role;
    if (tag === "input" || tag === "textarea") {
      const v = el.value ?? "";
      if (type === "checkbox" || type === "radio") item.checked = !!el.checked;
      else if (type !== "file" && v) item.value = type === "password" ? "•••" : v.slice(0, 120);
    }
    if (role === "checkbox" || role === "radio") item.checked = el.getAttribute("aria-checked") === "true";
    if (tag === "select") {
      item.options = [...el.options].slice(0, 120).map((o) => text(o.text));
      item.value = text(el.options[el.selectedIndex]?.text ?? "");
    }
    if (el.required || el.getAttribute("aria-required") === "true") item.required = true;
    if (el.disabled || el.getAttribute("aria-disabled") === "true") item.disabled = true;
    out.push(item);
  }
  return { elements: out, next: k, text: text(document.body?.innerText ?? "").slice(0, 9000) };
}

async function snapshot(page) {
  const frames = page.frames();
  const elements = [];
  const where = new Map();
  const texts = [];
  let base = 1;
  for (const frame of frames) {
    if (frame.isDetached()) continue;
    try {
      const r = await frame.evaluate(readFrame, base);
      for (const e of r.elements) where.set(e.i, frame);
      elements.push(...r.elements);
      if (r.text) texts.push(frame === page.mainFrame() ? r.text : `--- inside ${frame.url().slice(0, 120)} ---\n${r.text}`);
      base = r.next + 1;
    } catch {
      // A frame that navigated away mid-read: skipped this time.
    }
  }
  const shot = await page.screenshot({ type: "jpeg", quality: 60, timeout: 15_000 }).catch(() => null);
  return {
    page: { url: page.url(), title: (await page.title().catch(() => "")).slice(0, 300), text: texts.join("\n").slice(0, 30_000), elements, ...(shot ? { screenshot: shot.toString("base64") } : {}) },
    where,
  };
}

// ─── Doing it ────────────────────────────────────────────────────────────────

async function settle(page) {
  await page.waitForLoadState("domcontentloaded", { timeout: 15_000 }).catch(() => {});
  await page.waitForLoadState("networkidle", { timeout: 4_000 }).catch(() => {});
  await sleep(600);
}

async function act(page, where, a, tmp) {
  const frame = a.element !== undefined ? where.get(a.element) : null;
  const el = frame ? frame.locator(`[data-br-i="${a.element}"]`).first() : null;
  if (a.element !== undefined && !el) throw new Error("that element is gone");
  switch (a.do) {
    case "click":
      if (a.download) {
        const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 45_000 }), el.click({ timeout: 10_000 })]);
        const file = path.join(tmp, "download");
        await dl.saveAs(file);
        const bytes = await fs.readFile(file);
        await fs.rm(file, { force: true });
        const name = dl.suggestedFilename() || "download";
        const contentType = /\.pdf$/i.test(name) || bytes.subarray(0, 4).toString() === "%PDF" ? "application/pdf" : "application/octet-stream";
        return { download: { name, contentType, base64: bytes.toString("base64") } };
      }
      await el.click({ timeout: 10_000 }).catch(() => el.click({ timeout: 5_000, force: true }));
      return {};
    case "check":
    case "uncheck": {
      const box = await el.evaluate((n) => n.tagName === "INPUT" && ["checkbox", "radio"].includes(n.type)).catch(() => false);
      if (box) await (a.do === "check" ? el.check({ timeout: 10_000, force: true }) : el.uncheck({ timeout: 10_000, force: true }));
      else await el.click({ timeout: 10_000 });
      return {};
    }
    case "fill": {
      const editable = await el.evaluate((n) => n.isContentEditable).catch(() => false);
      if (editable) {
        await el.click({ timeout: 10_000 });
        await page.keyboard.type(a.value, { delay: 15 });
      } else await el.fill(a.value, { timeout: 10_000 });
      return {};
    }
    case "select":
      await el.selectOption({ label: a.value }, { timeout: 10_000 }).catch(() => el.selectOption(a.value, { timeout: 5_000 }));
      return {};
    case "upload": {
      // Kept until the job ends: the browser reads the file again when the form is sent.
      const dir = await fs.mkdtemp(path.join(tmp, "up-"));
      const file = path.join(dir, a.file.name.replace(/[^\w.-]+/g, "-") || "paper.pdf");
      await fs.writeFile(file, Buffer.from(a.file.base64, "base64"));
      const isInput = await el.evaluate((n) => n.tagName === "INPUT" && n.type === "file").catch(() => false);
      if (isInput) await el.setInputFiles(file, { timeout: 10_000 });
      else {
        const [chooser] = await Promise.all([page.waitForEvent("filechooser", { timeout: 10_000 }), el.click({ timeout: 10_000 })]);
        await chooser.setFiles(file);
      }
      return {};
    }
    case "press":
      await page.keyboard.press(a.key);
      return {};
    case "scroll":
      await page.mouse.wheel(0, a.direction === "up" ? -700 : 700);
      return {};
    case "wait":
      await sleep(Math.min(30, Math.max(1, a.seconds)) * 1000);
      return {};
    default:
      throw new Error(`unknown action ${a.do}`);
  }
}

async function run(browser, task) {
  const started = Date.now();
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "br-"));
  const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1280, height: 900 }, locale: "en-US", timezoneId: "America/Chicago" });
  // Every request checked: nothing on the machine's own network, nothing but web pages.
  await context.route("**/*", async (route) => ((await allowedUrl(route.request().url())) ? route.continue() : route.abort("blockedbyclient")));
  let page = await context.newPage();
  // A link that opens a new tab (common on signing sites): the work follows it.
  context.on("page", (p) => {
    page = p;
    p.on("close", () => {
      const open = context.pages().filter((x) => !x.isClosed());
      if (open.length) page = open[open.length - 1];
    });
  });
  let last = null;
  try {
    if (!(await allowedUrl(task.url))) throw new Error("that link isn't allowed");
    await page.goto(task.url, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await settle(page);
    for (;;) {
      if (Date.now() - started > MAX_MS) throw new Error(`took longer than ${MAX_MS / 60_000} minutes`);
      if (page.isClosed()) page = context.pages().find((p) => !p.isClosed()) ?? (await context.newPage());
      const { page: seen, where } = await snapshot(page);
      const { action } = await app({ op: "step", taskId: task.id, page: seen, last });
      last = null;
      if (!action || action.do === "finish") {
        log(task.id, "finished:", action?.outcome ?? "no action", action?.note ? `(${String(action.note).slice(0, 120)})` : "");
        return;
      }
      // What it's doing, never with the value it types.
      log(task.id, action.do, action.element ?? action.key ?? action.direction ?? action.seconds ?? "");
      try {
        const extra = await act(page, where, action, tmp);
        last = { ok: true, ...extra };
      } catch (e) {
        last = { ok: false, error: String(e?.message ?? e).split("\n")[0].slice(0, 300) };
      }
      if (action.do !== "wait") await settle(page);
    }
  } catch (e) {
    const note = String(e?.message ?? e).split("\n")[0].slice(0, 300);
    log(task.id, "failed:", note);
    const shot = await page.screenshot({ type: "jpeg", quality: 60, timeout: 10_000 }).catch(() => null);
    await app({ op: "finish", taskId: task.id, note, ...(shot ? { screenshot: shot.toString("base64") } : {}) }).catch((err) => log(task.id, "couldn't report the failure:", err.message));
  } finally {
    await context.close().catch(() => {});
    await fs.rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
}

// ─── The loop ────────────────────────────────────────────────────────────────

let stopping = false;
let running = 0;

async function lane(browser, n) {
  while (!stopping) {
    let task = null;
    try {
      task = (await app({ op: "next" })).task;
    } catch (e) {
      log(`lane ${n}: couldn't reach the app:`, e.message);
    }
    if (!task) {
      await sleep(POLL);
      continue;
    }
    running++;
    log(task.id, "starting", task.kind, new URL(task.url).hostname);
    try {
      await run(browser, task);
    } finally {
      running--;
    }
  }
}

async function main() {
  if (!APP || !SECRET) {
    log("APP_URL and PORTAL_WORKER_SECRET must be set");
    process.exit(1);
  }
  const browser = await chromium.launch({ headless: process.env.HEADLESS !== "0", executablePath: CHROMIUM, args: ["--disable-dev-shm-usage", ...EXTRA_ARGS] });
  http
    .createServer((req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, worker: WORKER, running }));
    })
    .listen(PORT, () => log(`health on :${PORT}, ${CONCURRENCY} at a time, app ${APP}`));
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    log("stopping: finishing what's open");
    for (let i = 0; i < 60 && running > 0; i++) await sleep(1000);
    await browser.close().catch(() => {});
    process.exit(0);
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
  await Promise.all(Array.from({ length: CONCURRENCY }, (_, n) => lane(browser, n)));
}

main().catch((e) => {
  log("fatal:", e);
  process.exit(1);
});
