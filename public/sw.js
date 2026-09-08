// SiteSnap service worker — keeps the app shell available offline so an
// inspection can carry on mid-property with no signal. Photos live in
// IndexedDB, so only the shell (HTML + hashed assets) is cached here.
const CACHE = "sitesnap-shell-v3";

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== location.origin) return;
  // the cloud-link service (sign-in pages, token endpoints) is never the
  // app shell and must never be served from cache
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/auth/")) return;

  // App shell: network-first so deploys show up, cached copy when offline.
  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request)
        .then((res) => {
          // a 502 from a mid-deploy host must not become the offline shell
          if (res.ok) {
            const copy = res.clone();
            const forPrune = res.clone();
            caches.open(CACHE).then(async (c) => {
              await c.put("/", copy);
              // every deploy ships a new hashed bundle; drop the ones this
              // shell no longer references so the cache doesn't grow forever
              try {
                const html = await forPrune.text();
                const wanted = new Set((html.match(/\/assets\/[^"' )]+/g) || []).map((p) => new URL(p, location.origin).href));
                const cached = await c.keys();
                await Promise.all(cached
                  .filter((req) => new URL(req.url).pathname.startsWith("/assets/") && !wanted.has(req.url))
                  .map((req) => c.delete(req)));
              } catch { /* pruning is best-effort */ }
            });
          }
          return res;
        })
        .catch(() => caches.match("/"))
    );
    return;
  }

  // Hashed build assets never change content for a given URL: cache-first.
  // The on-device OCR model (public/tesseract/) is the same story — large,
  // versioned by filename, fetched once on first use and then wanted for
  // every offline use after that.
  if (url.pathname.startsWith("/assets/") || url.pathname.startsWith("/icon-") || url.pathname.startsWith("/tesseract/")) {
    event.respondWith(
      caches.match(event.request).then(
        (hit) =>
          hit ||
          fetch(event.request).then((res) => {
            // never pin a 404 or an error page under an asset URL
            if (res.ok) {
              const copy = res.clone();
              caches.open(CACHE).then((c) => c.put(event.request, copy));
            }
            return res;
          })
      )
    );
  }
});
