// The web app's service worker. It keeps the app's own files on the device so
// the installed app opens without a network, and it never touches anything
// else: balances, prices and transactions always go to the network, because a
// cached answer there would be a wrong answer.
//
// scripts/build-web.mjs fills in BUILD and FILES. A new build is a new cache,
// and the old one is deleted once the new one is ready.
const BUILD = "__BUILD__";
const FILES = __FILES__;
const CACHE = `tera-app-${BUILD}`;
const SHELL = "/app/";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll([SHELL, ...FILES]))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((key) => key.startsWith("tera-app-") && key !== CACHE).map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || !url.pathname.startsWith("/app")) return;

  // The page: the network first, so a deploy shows up on the next launch; the
  // cached copy when offline.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(SHELL, copy));
          }
          return response;
        })
        .catch(() => caches.match(SHELL)),
    );
    return;
  }

  // Everything else under /app is named by its content hash, so a cached copy
  // is always the right one.
  event.respondWith(caches.match(request).then((hit) => hit || fetch(request)));
});

// Push notifications (core/push.js). Tera's service sends a short line, already
// written for the lock screen, encrypted to this browser. With Tera open and in
// front, the app announces the payment itself, so the push stays quiet.
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }
  const title = typeof data.title === "string" ? data.title : "Tera";
  const body = typeof data.body === "string" ? data.body : "Something moved in your wallet. Open Tera to see it.";
  const url = typeof data.url === "string" && data.url.startsWith("/app") ? data.url : "/app/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      if (windows.some((w) => w.visibilityState === "visible" && w.focused)) return;
      return self.registration.showNotification(title, {
        body,
        tag: typeof data.tag === "string" ? data.tag : undefined,
        icon: "/app/icon-192.png",
        badge: "/app/icon-192.png",
        data: { url },
      });
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/app/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      const open = windows.find((w) => new URL(w.url).pathname.startsWith("/app"));
      if (open) {
        open.postMessage({ tera: "open", page: "notifications" });
        return open.focus();
      }
      return self.clients.openWindow(url);
    }),
  );
});
