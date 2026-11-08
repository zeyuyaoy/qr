/* QR Studio service worker.
 * What it caches: the app shell + hashed static assets, so the generator works offline.
 * What it NEVER caches: /api/* (private data lives in IndexedDB, not here), /r/* redirects, /expired,
 * /api/auth/*. Page HTML for signed-in routes is kept in a per-browser cache that is wiped on sign-out. */
const V = new URL(self.location.href).searchParams.get("v") || "v1";
const STATIC = `qr-static-${V}`;
const PAGES = `qr-pages-${V}`;
let privateEpoch = 0;
const PRECACHE_PAGES = ["/", "/library", "/scan", "/templates", "/bulk", "/analytics", "/settings", "/offline"];
const NEVER = [/^\/api\//, /^\/r\//, /^\/expired/, /^\/sw\.js$/, /^\/_next\/image/];

const isHtml = (res) => (res.headers.get("content-type") || "").includes("text/html");
const privatePage = (path) => PRECACHE_PAGES.includes(path) || /^\/library\/[a-z0-9]{8,24}$/.test(path);

async function precache() {
  const epoch = privateEpoch;
  const pages = await caches.open(PAGES);
  const statics = await caches.open(STATIC);
  const assets = new Set(["/fonts/nunito-latin.woff2", "/icons/icon-192.png", "/icons/icon-512.png", "/icons/icon.svg"]);
  await Promise.all(
    PRECACHE_PAGES.map(async (path) => {
      try {
        const res = await fetch(path, { credentials: "same-origin" });
        // A redirect (e.g. to /login when signed out) must not be cached as the page.
        if (!res.ok || res.redirected || !isHtml(res)) return;
        const html = await res.clone().text();
        if (epoch === privateEpoch) await pages.put(path, res);
        for (const m of html.matchAll(/(?:src|href)="(\/_next\/static\/[^"]+)"/g)) assets.add(m[1]);
      } catch {}
    }),
  );
  await Promise.all([...assets].map((a) => statics.add(a).catch(() => undefined)));
}

self.addEventListener("install", (e) => {
  e.waitUntil(precache().then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    (async () => {
      for (const k of await caches.keys()) if (/^qr-(static|pages)-/.test(k) && ![STATIC, PAGES].includes(k)) await caches.delete(k);
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("message", (e) => {
  if (e.data && e.data.type === "clear-private") { privateEpoch++; e.waitUntil(caches.delete(PAGES)); }
  if (e.data && e.data.type === "cache-private") e.waitUntil(precache());
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (NEVER.some((r) => r.test(url.pathname))) return;
  if (url.searchParams.has("_rsc") || req.headers.get("RSC")) return; // client-side navigation data → network (falls back to a hard navigation)

  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/") || url.pathname.startsWith("/fonts/")) {
    event.respondWith(
      caches.open(STATIC).then(async (c) => {
        const hit = await c.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok) c.put(req, res.clone());
        return res;
      }),
    );
    return;
  }

  if (req.mode === "navigate" && privatePage(url.pathname)) {
    const epoch = privateEpoch;
    event.respondWith(
      (async () => {
        const pages = await caches.open(PAGES);
        try {
          const res = await Promise.race([fetch(req), new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 4000))]);
          if (res.redirected && new URL(res.url).pathname === "/login") await caches.delete(PAGES);
          if (epoch === privateEpoch && res.ok && !res.redirected && isHtml(res) && privatePage(url.pathname)) await pages.put(url.pathname, res.clone());
          return res;
        } catch {
          return (await pages.match(url.pathname)) || (await pages.match("/offline")) || new Response("Offline", { status: 503, headers: { "Content-Type": "text/plain" } });
        }
      })(),
    );
  }
});
