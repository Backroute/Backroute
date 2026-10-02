// Backroute's service worker: shows push notifications (something needs the owner, a message for a driver), opens the
// app on tap, and answers Yes / No from the notification's buttons without opening it (/api/agent/answer).
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
