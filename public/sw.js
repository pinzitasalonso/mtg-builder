/* Spellpool service worker — installable PWA + offline review support.
   - App shell & static assets: cache-first.
   - Deck card lists: network-first, cached so a deck can be reviewed offline.
   - Scryfall card art: cache-first (CDN, long-lived).
   - Everything else (auth, chat, search, mutations): network-only / passthrough.
   Mutations made offline aren't handled here — the app queues them and replays
   them on reconnect. */
const STATIC = "sp-static-v3";
const RUNTIME = "sp-runtime-v3";

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== STATIC && k !== RUNTIME).map((k) => caches.delete(k)));
      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return; // mutations pass straight through
  const url = new URL(req.url);

  // Scryfall card art — cache-first.
  const isScryfallImage =
    url.hostname.endsWith("scryfall.io") ||
    (url.hostname === "api.scryfall.com" && url.searchParams.get("format") === "image");
  if (isScryfallImage) {
    event.respondWith(cacheFirst(req, RUNTIME));
    return;
  }

  if (url.origin !== self.location.origin) return;

  // Deck card lists — network-first, cached for offline review.
  if (url.pathname.startsWith("/api/decks/") && url.pathname.endsWith("/cards")) {
    event.respondWith(networkFirst(req, RUNTIME));
    return;
  }
  // Other API routes — network only (don't cache auth/AI/search).
  if (url.pathname.startsWith("/api/")) return;

  // Build assets & icons — cache-first.
  if (url.pathname.startsWith("/_next/static") || url.pathname === "/icon.svg" || url.pathname === "/manifest.webmanifest") {
    event.respondWith(cacheFirst(req, STATIC));
    return;
  }

  // Navigations & the rest — network-first, fall back to cache, then home shell.
  event.respondWith(networkFirst(req, RUNTIME));
});

async function cacheFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req);
  if (hit) return hit;
  try {
    const res = await fetch(req);
    if (res && (res.ok || res.type === "opaque")) cache.put(req, res.clone());
    return res;
  } catch {
    return hit || Response.error();
  }
}

async function networkFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const res = await fetch(req);
    if (res && res.ok) cache.put(req, res.clone());
    return res;
  } catch {
    const hit = await cache.match(req);
    if (hit) return hit;
    if (req.mode === "navigate") {
      const home = await cache.match("/");
      if (home) return home;
    }
    return Response.error();
  }
}
