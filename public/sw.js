// SiteSnap service worker — keeps the app shell available offline so an
// inspection can carry on mid-property with no signal. Photos live in
// IndexedDB, so only the shell (HTML + hashed assets) is cached here.
const CACHE = "sitesnap-shell-v2";

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

  // App shell: network-first so deploys show up, cached copy when offline.
  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request)
        .then((res) => {
          // a 502 from a mid-deploy host must not become the offline shell
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put("/", copy));
          }
          return res;
        })
        .catch(() => caches.match("/"))
    );
    return;
  }

  // Hashed build assets never change content for a given URL: cache-first.
  if (url.pathname.startsWith("/assets/") || url.pathname.startsWith("/icon-")) {
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
