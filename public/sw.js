// Backroute's service worker: shows push notifications (something needs the owner, a message for a driver), opens the
// app on tap, and answers Yes / No from the notification's buttons without opening it (/api/agent/answer).
//
// In a built app (registered as /sw.js?offline=1) it also keeps a copy of the app on the phone, so the driver's screen
// opens with no signal: pages come from the network when there is one (and the copy is refreshed), from the copy when
// there isn't; the app's own files (hashed, never change) come from the copy. Nothing from /api is kept: the trip
// itself comes from the last view the app saved, and anything typed offline waits in its outbox.
const OFFLINE = new URL(self.location.href).searchParams.get("offline") === "1";
const SHELL = "backroute-shell-v1";
const PAGES = ["/driver", "/carrier"];

self.addEventListener("install", (event) => {
  self.skipWaiting();
  if (OFFLINE) event.waitUntil(caches.open(SHELL).then((c) => Promise.all(PAGES.map((p) => c.add(p).catch(() => {})))));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("backroute-") && (k !== SHELL || !OFFLINE)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

const isAsset = (path) => path.startsWith("/_next/static/") || path.startsWith("/icons/") || path.startsWith("/splash/") || path === "/manifest.webmanifest" || path === "/favicon.ico";

self.addEventListener("fetch", (event) => {
  if (!OFFLINE) return;
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
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
    event.waitUntil(
      fetch("/api/agent/answer", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: d.answer, answer: event.action }) })
        .then((r) => r.json().catch(() => ({})).then((b) => ({ ok: r.ok, b })))
        .then(({ ok, b }) =>
          ok
            ? self.registration.showNotification("Backroute", { body: b.note || "Done.", tag: `answered-${Date.now()}`, icon: "/favicon.ico" })
            : open(url),
        )
        .catch(() => open(url)),
    );
    return;
  }
  event.waitUntil(open(url));
});
