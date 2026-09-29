/* furnuture service worker: shows push notifications and opens the right house when tapped. */

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: event.data ? event.data.text() : "furnuture" };
  }
  const title = data.title || "furnuture";
  event.waitUntil(
    Promise.all([
      // Always shown (iOS stops sending pushes to an app that receives them silently).
      self.registration.showNotification(title, {
        body: data.body || "",
        icon: "/apple-icon",
        badge: "/apple-icon",
        tag: data.tag,
        data: { url: data.url || "/" },
      }),
      // An open app shows it too (iOS shows no banner while the app is in front) and refreshes the bell.
      self.clients.matchAll({ type: "window" }).then((list) => list.forEach((c) => c.postMessage({ type: "push", title, body: data.body || "", url: data.url }))),
      // The red number on the app icon; cleared when the app opens.
      self.navigator && self.navigator.setAppBadge ? self.navigator.setAppBadge(1).catch(() => {}) : null,
    ]),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || "/", self.location.origin).href;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const open = windows.find((w) => new URL(w.url).origin === self.location.origin);
      if (open) {
        await open.focus();
        // The open app handles it without a reload (see lib/push.ts).
        open.postMessage({ type: "open", url });
        return;
      }
      await self.clients.openWindow(url);
    })(),
  );
});
