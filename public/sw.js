// Backroute's service worker: shows the owner's push notifications (something needs them) and opens the app on tap.
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
      requireInteraction: Boolean(data.urgent),
      icon: "/favicon.ico",
      badge: "/favicon.ico",
      data: { url: data.url || "/carrier" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL((event.notification.data && event.notification.data.url) || "/carrier", self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) if (c.url.startsWith(self.location.origin) && "focus" in c) return c.navigate(url).then((w) => (w || c).focus());
      return self.clients.openWindow(url);
    }),
  );
});
