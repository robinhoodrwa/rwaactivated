"use strict";

const CACHE_NAME = "rwa-product-suite-v21";
const CORE_ASSETS = [
  "/",
  "/styles.css",
  "/product-data.js",
  "/scan-scene.js",
  "/app.js",
  "/evidence-linter.js",
  "/evidence-passport.schema.json",
  "/favicon.svg",
  "/apple-touch-icon.png",
  "/icon-192.png",
  "/icon-512.png",
  "/manifest.webmanifest?v=20260719.1",
  "/wallet/",
  "/wallet/wallet.js?v=20260717.7",
  "/wallet/wallet.css?v=20260717.5",
  "/wallet/passport-store.js?v=20260717.3",
  "/wallet/recognition.js?v=20260717.3",
  "/wallet/robinhood.js?v=20260717.4",
  "/wallet/protocol-config.js?v=20260717.3",
  "/wallet/grid2d-worker.js?v=20260717.3",
  "/wallet/grid2d/rwa_grid2d_wasm.js?v=20260717.3",
  "/wallet/grid2d/rwa_grid2d_wasm_bg.wasm?v=20260717.3",
  "/wallet/vendor/ethers.min.js?v=20260717.3",
  "/wallet/vendor/walletconnect.min.js?v=20260717.3",
  "/proofgate/",
  "/proofgate/config.js",
  "/proofgate/app.js",
  "/proofgate/styles.css",
  "/markets/",
  "/markets/app.js",
  "/markets/styles.css",
  "/guard/",
  "/guard/app.js",
  "/guard/styles.css",
  "/tickets/",
  "/tickets/app.js",
  "/tickets/styles.css",
  "/receipts/",
  "/receipts/app.js",
  "/receipts/styles.css",
  "/studio/",
  "/studio/studio.js",
  "/verify/",
  "/verify/verify.js"
];

function canCache(request, response) {
  if (!response.ok) return false;
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  return !contentType.includes("text/html") || request.mode === "navigate" || new URL(request.url).pathname.endsWith("/");
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      const entries = await Promise.all(
        CORE_ASSETS.map(async (url) => {
          const request = new Request(url, { cache: "reload" });
          const response = await fetch(request);
          if (!canCache(request, response)) throw new Error(`Invalid offline asset: ${url}`);
          return { request, response };
        }),
      );
      await Promise.all(entries.map(({ request, response }) => cache.put(request, response)));
      await self.skipWaiting();
    }),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(names.filter((name) => name !== CACHE_NAME).map((name) => caches.delete(name))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (canCache(request, response)) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => caches.match(request).then((cached) => cached || caches.match("/"))),
    );
    return;
  }

  event.respondWith(
    fetch(request)
      .then((response) => {
        if (canCache(request, response)) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(() => caches.match(request).then((cached) => cached || Response.error())),
  );
});
