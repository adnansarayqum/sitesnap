// SiteSnap service worker — keeps the app shell available offline so an
// inspection can carry on mid-property with no signal. Photos live in
// IndexedDB, so only the shell (HTML + hashed assets) is cached here.
const CACHE = "sitesnap-shell-v6";

async function shellAssets(html, requireManifest = false) {
  const manifestResponse = await fetch("/manifest.json", { cache: "no-store" }).catch(() => null);
  if (requireManifest && (!manifestResponse || !manifestResponse.ok)) throw new Error("manifest unavailable");
  const manifest = manifestResponse && manifestResponse.ok ? await manifestResponse.json().catch(() => ({})) : {};
  const built = Object.values(manifest).flatMap((entry) => [entry.file, ...(entry.css || []), ...(entry.assets || [])]).filter(Boolean).map((file) => `/${file.replace(/^\//, "")}`);
  return Array.from(new Set([...(html.match(/\/assets\/[^"' )]+/g) || []), ...built]));
}

// Precache the shell and the hashed bundles it references at install, so
// the app works offline from the very first visit. Without this the shell
// was only cached by a *controlled* navigation — i.e. the second visit — and
// a surveyor who installed the app in the office and drove straight to a
// property with no signal got a browser error page.
self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil((async () => {
    try {
      const c = await caches.open(CACHE);
      const res = await fetch("/", { cache: "no-store" });
      if (!res.ok) return;
      const html = await res.clone().text();
      const assets = await shellAssets(html, true);
      // Preserve an existing complete release during an update: only swap
      // its shell after every chunk referenced by the new manifest exists.
      await Promise.all(assets.map((a) => c.add(a)));
      await c.put("/", res);
    } catch { /* offline at install — the next online visit fills the cache */ }
  })());
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
    const network = fetch(event.request);
    const refreshShell = network.then(async (res) => {
      // a 502 from a mid-deploy host must not become the offline shell
      if (!res.ok) return;
      const copy = res.clone();
      const forPrune = res.clone();
      const c = await caches.open(CACHE);
      // every deploy ships a new hashed bundle; stage the whole new release
      // before publishing its shell or dropping the previous one
      const html = await forPrune.text();
      const wanted = new Set((await shellAssets(html, true)).map((p) => new URL(p, location.origin).href));
      const before = new Set((await c.keys()).map((req) => req.url));
      await Promise.all([...wanted]
        .filter((url) => !before.has(url))
        .map((url) => c.add(url)));
      // Commit the new shell only after every asset it can reference exists.
      // A failed staging fetch therefore leaves the previous complete shell
      // and its chunks untouched.
      await c.put("/", copy);
      const cached = await c.keys();
      await Promise.all(cached
        .filter((req) => new URL(req.url).pathname.startsWith("/assets/") && !wanted.has(req.url))
        .map((req) => c.delete(req)));
    }).catch(() => { /* retain the previous complete offline release */ });
    event.waitUntil(refreshShell);
    event.respondWith(network.catch(() => caches.match("/")));
    return;
  }

  // Hashed build assets never change content for a given URL: cache-first.
  // The on-device OCR model (public/tesseract/) and the report templates
  // (public/templates/) are the same story — large, versioned by filename,
  // fetched once on first use and then wanted for every offline use after
  // that (an agency export needs to work from a property with no signal,
  // same as everything else in this app).
  if (url.pathname.startsWith("/assets/") || url.pathname.startsWith("/icon-") || url.pathname.startsWith("/tesseract/") || url.pathname.startsWith("/templates/")) {
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
