// The web app's service worker. It keeps the app's own files on the device so
// the installed app opens without a network, and it never touches anything
// else: balances, prices and transactions always go to the network, because a
// cached answer there would be a wrong answer.
//
// scripts/build-web.mjs fills in BUILD and FILES. A new build is a new cache,
// and the old one is deleted once the new one is ready.
const BUILD = "6e6ebb937cd06ea4";
const FILES = [
  "/app/_expo/static/js/web/index-0783af34bd36ee5abce504db068a2853.js",
  "/app/_expo/static/js/web/native-e325d192001aee1a6b51f4c06b60e630.js",
  "/app/apple-touch-icon.png",
  "/app/assets/assets/RH-RWA-Assets-Media/amazon.011a040ad5744ef03634d45133707895.png",
  "/app/assets/assets/RH-RWA-Assets-Media/apple.7eb2afd24c5c70287d47aae4b2905a30.png",
  "/app/assets/assets/RH-RWA-Assets-Media/eth.4080ea9dc13cd8a86cfab4495b0b675b.jpeg",
  "/app/assets/assets/RH-RWA-Assets-Media/google.4d1fd5d1d6a65adaba740415cd12532f.png",
  "/app/assets/assets/RH-RWA-Assets-Media/meta.b4ec0ce9e55a8f24ade4fc38127b160d.jpg",
  "/app/assets/assets/RH-RWA-Assets-Media/microsoft.4c36196e43620278b90f49162ef26d91.png",
  "/app/assets/assets/RH-RWA-Assets-Media/nvidia.0415f095c266d16406bbdfd034639d24.png",
  "/app/assets/assets/RH-RWA-Assets-Media/rh-icon.e5b0bac682a97078c6b99ec49d6960b9.png",
  "/app/assets/assets/RH-RWA-Assets-Media/spacex.3eb38ebf62c60d9ca1e9e8a40e3fd6df.png",
  "/app/assets/assets/RH-RWA-Assets-Media/tesla.8687fe0692d035be6940590f0a426b7b.png",
  "/app/assets/assets/RH-RWA-Assets-Media/usdg_logo.a9346202ce82da17dc71d1b663568517.png",
  "/app/assets/assets/arc-logo.5424d80bbdbd4ef15e72ce417c8b2cf9.jpeg",
  "/app/assets/assets/arc.7c126e22e75915cbb6620fe222aa5d90.jpg",
  "/app/assets/assets/avalanche.8228c9428aaca08e1a5d49c8d2be0b41.png",
  "/app/assets/assets/base.8722b4eb8e41254ca621ba37b456983f.jpeg",
  "/app/assets/assets/bitcoin.565e8c524f6da22928811f836d0b92a2.png",
  "/app/assets/assets/bnb.d2963b42f5b0f6cdcad306c98082cfbc.png",
  "/app/assets/assets/cardano.9b309376bebb3092a5f07cfb377f7b64.png",
  "/app/assets/assets/chainlink.60bacd44306174919569d46df3f1398a.png",
  "/app/assets/assets/dogecoin.f9ddca8c0ebef673c0c27ab14ad9b749.png",
  "/app/assets/assets/fonts/PlusJakartaSans-Bold.b8f51215f39f23ca34e81fc7c1052612.ttf",
  "/app/assets/assets/fonts/PlusJakartaSans-ExtraBold.bb29fce7acc11211f9072cbe67f8fca6.ttf",
  "/app/assets/assets/fonts/PlusJakartaSans-Medium.ac10432b62149c67f1e5be9ebd8a5ca3.ttf",
  "/app/assets/assets/fonts/PlusJakartaSans-Regular.39bf24d996514baab62181a45744d670.ttf",
  "/app/assets/assets/fonts/PlusJakartaSans-SemiBold.bda37ed2fd163d86422d87fb77599c14.ttf",
  "/app/assets/assets/icon.3fdb9799c5ef22224a588e2d1a022379.png",
  "/app/assets/assets/logo-mark.087912cd03b504690712c0e70befcd4f.png",
  "/app/assets/assets/solana.c77657e6bcd28104bcacc56b7d5c0cb0.png",
  "/app/assets/assets/usdc.e0ca62f73a5d97ee01b2080a857d242f.png",
  "/app/assets/assets/usdt.82516b8838e83a0439e0aed365206a4a.png",
  "/app/assets/assets/xrp.8c9a8c477f324c88cead49db9a5fc1a2.png",
  "/app/icon-192.png",
  "/app/icon-512.png",
  "/app/icon-maskable-512.png",
  "/app/manifest.webmanifest"
];
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
