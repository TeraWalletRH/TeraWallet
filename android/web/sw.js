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
