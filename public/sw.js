// Backroute's service worker: shows push notifications (something needs the owner, a message for a driver), opens the
// app on tap, and answers Yes / No from the notification's buttons without opening it (/api/agent/answer).
//
// In a built app (registered as /sw.js?offline=1) it also keeps a copy of the app on the phone, so the driver's screen
// opens with no signal: pages come from the network when there is one (and the copy is refreshed), from the copy when
// there isn't; the app's own files (hashed, never change) come from the copy. Nothing from /api is kept: the trip
// itself comes from the last view the app saved, and anything typed offline waits in its outbox.
//
// The map too: the trip's map area (the road ahead, a few zoom levels) is saved when the trip map opens, and any map
// piece seen online is kept, so the map still draws with no signal. And a Yes / No tapped on a notification with no
// signal is kept here and sent once the phone is back online.
const OFFLINE = new URL(self.location.href).searchParams.get("offline") === "1";
const SHELL = "backroute-shell-v1";
const MAP = "backroute-map-v1";
const MAP_MAX = 2500;
const MAP_HOSTS = ["tiles.openfreemap.org"];
const isMapLib = (url) => url.hostname === "cdn.jsdelivr.net" && /^\/npm\/maplibre-gl@[\d.]+\/dist\//.test(url.pathname);
const PAGES = ["/driver", "/carrier"];

self.addEventListener("install", (event) => {
  self.skipWaiting();
  if (OFFLINE) event.waitUntil(caches.open(SHELL).then((c) => Promise.all(PAGES.map((p) => c.add(p).catch(() => {})))));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("backroute-") && (![SHELL, MAP].includes(k) || !OFFLINE)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

const isAsset = (path) => path.startsWith("/_next/static/") || path.startsWith("/icons/") || path.startsWith("/splash/") || path === "/manifest.webmanifest" || path === "/favicon.ico";

self.addEventListener("fetch", (event) => {
  if (!OFFLINE) return;
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  // Map pieces: the style (and the tile list it points to) fresh when online; tiles, fonts, icons and MapLibre's
  // worker never change at their address, so the saved copy is used first.
  if (MAP_HOSTS.includes(url.hostname) || isMapLib(url)) {
    const fresh = MAP_HOSTS.includes(url.hostname) && (url.pathname.startsWith("/styles/") || /^\/[a-z]+$/.test(url.pathname));
    event.respondWith(fresh ? networkThenMap(req) : mapThenNetwork(req));
    return;
  }
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;
  if (isAsset(url.pathname)) {
    event.respondWith(
      caches.open(SHELL).then((c) =>
        c.match(req).then(
          (hit) =>
            hit ||
            fetch(req).then((res) => {
              if (res.ok) c.put(req, res.clone());
              return res;
            }),
        ),
      ),
    );
    return;
  }
  if (req.mode === "navigate") {
    const fallback = url.pathname.startsWith("/driver") ? "/driver" : "/carrier";
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok && (url.pathname.startsWith("/driver") || url.pathname.startsWith("/carrier"))) {
            const copy = res.clone();
            caches.open(SHELL).then((c) => c.put(url.pathname, copy));
          }
          return res;
        })
        .catch(() => caches.open(SHELL).then((c) => c.match(url.pathname).then((hit) => hit || c.match(fallback)).then((hit) => hit || Response.error()))),
    );
  }
});
function keep(req, res) {
  if (!res || !(res.ok || res.type === "opaque")) return res;
  const copy = res.clone();
  caches.open(MAP).then((c) => c.put(req, copy).then(() => trim(c)));
  return res;
}
function networkThenMap(req) {
  return fetch(req)
    .then((res) => keep(req, res))
    .catch(() => caches.open(MAP).then((c) => c.match(req)).then((hit) => hit || Response.error()));
}
function mapThenNetwork(req) {
  return caches.open(MAP).then((c) => c.match(req).then((hit) => hit || fetch(req).then((res) => keep(req, res))));
}
let trimming = false;
function trim(c) {
  if (trimming) return;
  trimming = true;
  // Oldest first: past trips go before the one the driver is on.
  return c
    .keys()
    .then((keys) => Promise.all(keys.slice(0, Math.max(0, keys.length - MAP_MAX)).map((k) => c.delete(k))))
    .finally(() => (trimming = false));
}

// ─── The trip's map area, saved ahead ───────────────────────────────────────

const tileOf = (lat, lon, z) => {
  const n = 2 ** z;
  const x = Math.floor(((lon + 180) / 360) * n);
  const r = (lat * Math.PI) / 180;
  const y = Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n);
  return [Math.min(n - 1, Math.max(0, x)), Math.min(n - 1, Math.max(0, y))];
};

/** Tiles along the road (points as [lat, lon]), with a tile either side, from the whole-trip view down to street level near the ends. */
function tilesAlong(points, zooms) {
  const out = new Set();
  for (const z of zooms) {
    const step = 180 / 2 ** z; // about half a tile, in degrees
    for (let i = 0; i < points.length; i++) {
      const a = points[i];
      const b = points[i + 1] || a;
      const n = Math.max(1, Math.ceil(Math.max(Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1])) / step));
      for (let k = 0; k <= n; k++) {
        const [x, y] = tileOf(a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n, z);
        for (const dx of [-1, 0, 1]) for (const dy of [-1, 0, 1]) out.add(`${z}/${x + dx}/${y + dy}`);
      }
    }
  }
  return [...out];
}

async function keepTripMap(style, points) {
  if (!OFFLINE || !Array.isArray(points) || points.length < 2 || points.length > 400) return;
  const c = await caches.open(MAP);
  const res = await fetch(style).then((r) => keep(new Request(style), r));
  const sheet = await res.json();
  // The vector tile set the style draws from, and its address pattern.
  const source = Object.values(sheet.sources || {}).find((x) => x.type === "vector" && x.url);
  if (!source) return;
  const info = await fetch(source.url).then((r) => keep(new Request(source.url), r)).then((r) => r.json());
  const pattern = info.tiles && info.tiles[0];
  if (!pattern) return;
  const max = Math.min(info.maxzoom || 14, 11);
  // The fonts for road and town names, and the map's icons.
  if (typeof sheet.sprite === "string") for (const ext of [".json", ".png", "@2x.json", "@2x.png"]) await mapThenNetwork(new Request(sheet.sprite + ext)).catch(() => 0);
  const names = ["Noto Sans Regular", "Noto Sans Bold"];
  if (sheet.glyphs) for (const f of names) for (const r of ["0-255", "256-511"]) await mapThenNetwork(new Request(sheet.glyphs.replace("{fontstack}", encodeURIComponent(f)).replace("{range}", r))).catch(() => 0);
  const ends = [points[0], points[points.length - 1]];
  // Whole-trip view down to regional (zoom 8) along the road, town level only at the two ends: a few hundred small
  // pieces, a few megabytes, once per trip.
  const tiles = [...tilesAlong(points, [4, 5, 6, 7, 8].filter((z) => z <= max)), ...tilesAlong(ends, [10, max].filter((z, i, a) => a.indexOf(z) === i))].slice(0, 400);
  for (let i = 0; i < tiles.length; i += 6) {
    await Promise.all(
      tiles.slice(i, i + 6).map((t) => {
        const [z, x, y] = t.split("/");
        const url = pattern.replace("{z}", z).replace("{x}", x).replace("{y}", y);
        return c.match(url).then((hit) => hit || fetch(url).then((r) => keep(new Request(url), r)).catch(() => 0));
      }),
    );
  }
}

// ─── Yes / No from a notification, with no signal ────────────────────────────

const DB = "backroute-sw";
function db() {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(DB, 1);
    open.onupgradeneeded = () => open.result.createObjectStore("answers", { keyPath: "id" });
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error);
  });
}
function store(mode, fn) {
  return db().then(
    (d) =>
      new Promise((resolve, reject) => {
        const tx = d.transaction("answers", mode);
        const out = fn(tx.objectStore("answers"));
        tx.oncomplete = () => resolve(out && "result" in out ? out.result : undefined);
        tx.onerror = () => reject(tx.error);
      }),
  );
}
const waiting = () => store("readonly", (s) => s.getAll());

function sendAnswer(a) {
  return fetch("/api/agent/answer", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: a.token, answer: a.answer }) }).then((r) =>
    r.json().catch(() => ({})).then((b) => ({ ok: r.ok, status: r.status, b })),
  );
}

let flushing = null;
/** Sends the answers kept while offline, oldest first. One the server turns down (expired, gone) isn't tried again. */
function flushAnswers() {
  if (flushing) return flushing;
  flushing = waiting()
    .then(async (list) => {
      for (const a of list.sort((x, y) => x.at - y.at)) {
        try {
          const { ok, b } = await sendAnswer(a);
          await store("readwrite", (s) => s.delete(a.id));
          if (ok) await self.registration.showNotification("Backroute", { body: `${a.title ? `${a.title}: ` : ""}${b.note || "Done."} (sent now you're back online)`, tag: `answered-${a.id}`, icon: "/favicon.ico" });
          else await self.registration.showNotification("Backroute", { body: `Your ${a.answer === "yes" ? "Yes" : "No"} couldn't be sent${a.title ? ` (${a.title})` : ""}. Open the app to answer it.`, tag: `answered-${a.id}`, icon: "/favicon.ico", data: { url: a.url } });
        } catch {
          break; // Still no signal: try again later.
        }
      }
    })
    .catch(() => 0)
    .finally(() => (flushing = null));
  return flushing;
}

self.addEventListener("sync", (event) => {
  if (event.tag === "answers") event.waitUntil(flushAnswers());
});

self.addEventListener("message", (event) => {
  const m = event.data || {};
  if (m.type === "online") event.waitUntil(flushAnswers());
  if (m.type === "keep-trip-map") event.waitUntil(keepTripMap(m.style, m.points).catch(() => 0));
});

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "Backroute", body: event.data ? event.data.text() : "" };
  }
  event.waitUntil(
    self.registration.showNotification(data.title || "Backroute", {
      body: data.body || "",
      tag: data.tag || undefined,
      renotify: Boolean(data.tag),
      requireInteraction: Boolean(data.urgent || (data.actions && data.actions.length)),
      icon: "/favicon.ico",
      badge: "/favicon.ico",
      actions: Array.isArray(data.actions) ? data.actions.slice(0, 2) : [],
      data: { url: data.url || "/carrier", answer: data.answer || null },
    }),
  );
});

function open(url) {
  return self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
    for (const c of list) if (c.url.startsWith(self.location.origin) && "focus" in c) return c.navigate(url).then((w) => (w || c).focus());
    return self.clients.openWindow(url);
  });
}

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const d = event.notification.data || {};
  const url = new URL(d.url || "/carrier", self.location.origin).href;
  if ((event.action === "yes" || event.action === "no") && d.answer) {
    const answer = { id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, token: d.answer, answer: event.action, title: event.notification.body ? event.notification.body.slice(0, 80) : "", url, at: Date.now() };
    event.waitUntil(
      sendAnswer(answer)
        .then(({ ok, b }) =>
          ok
            ? self.registration.showNotification("Backroute", { body: b.note || "Done.", tag: `answered-${answer.id}`, icon: "/favicon.ico" })
            : open(url),
        )
        // No signal: kept on the phone and sent when it's back (Background Sync where the phone has it, else when the
        // app next opens online).
        .catch(() =>
          store("readwrite", (s) => s.put(answer))
            .then(() => (self.registration.sync ? self.registration.sync.register("answers").catch(() => 0) : 0))
            .then(() => self.registration.showNotification("Backroute", { body: `No signal. Your ${event.action === "yes" ? "Yes" : "No"} is saved and goes as soon as you're back online.`, tag: `answered-${answer.id}`, icon: "/favicon.ico" }))
            .catch(() => open(url)),
        ),
    );
    return;
  }
  event.waitUntil(open(url));
});
