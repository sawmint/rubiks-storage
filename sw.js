/* =========================================================
 * sw.js - Service worker for Rubik's Storage.
 *
 * Caches the app shell + dataset on install so the site works
 * fully offline after the first visit. VisualCube case images
 * are cached on demand the first time each one is fetched.
 *
 * Bump CACHE_VERSION when shipping breaking changes so old
 * caches get cleared on activate.
 * ========================================================= */

const CACHE_VERSION = "rs-v22";

// Same-origin shell files. Pre-fetched at install time.
const CORE_ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./selection.js",
  "./modal.js",
  "./cube-notation.js",
  "./stats.js",
  "./drill.js",
  "./recognition.js",
  "./timer.js",
  "./scramble-3x3.js",
  "./sessions.js",
  "./batch.js",
  "./pll-compose.json",
  "./rubiks-cube-algorithms.json",
  "./manifest.webmanifest",
  "./icon.svg",
];

const VISUALCUBE_ORIGIN = "https://visualcube.api.cubing.net";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(CORE_ASSETS))
  );
  // Take over from any older worker as soon as possible.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // Network-first for HTML navigations so updates show up;
  // fall back to cache if offline.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((res) => cacheAndReturn(request, res))
        .catch(() =>
          caches.match(request).then((cached) => cached || caches.match("./index.html"))
        )
    );
    return;
  }

  // Cache-first for shell assets and VisualCube images.
  if (url.origin === self.location.origin || url.origin === VISUALCUBE_ORIGIN) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request)
          .then((res) => cacheAndReturn(request, res))
          .catch(() => cached);
      })
    );
    return;
  }

  // Everything else: just pass through to network.
});

function cacheAndReturn(request, response) {
  // Only cache successful, basic/cors responses (avoid opaque errors).
  if (!response || response.status !== 200) return response;
  if (response.type !== "basic" && response.type !== "cors") return response;
  const clone = response.clone();
  caches.open(CACHE_VERSION).then((cache) => cache.put(request, clone));
  return response;
}

/* Optional: bulk-prefetch all PLL+OLL case images so they're available
   offline without the user having to visit each card first. Triggered
   from the page via postMessage({ type: "prefetch-images", urls: [...] }). */
self.addEventListener("message", (event) => {
  if (event.data?.type !== "prefetch-images") return;
  const urls = event.data.urls || [];
  event.waitUntil(
    caches.open(CACHE_VERSION).then(async (cache) => {
      for (const url of urls) {
        try {
          const cached = await cache.match(url);
          if (cached) continue;
          const res = await fetch(url, { mode: "cors" });
          if (res && res.status === 200) await cache.put(url, res);
        } catch (e) {
          // Ignore individual fetch failures; user can retry later.
        }
      }
    })
  );
});
