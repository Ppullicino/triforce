const CACHE_NAME = 'triforce-v1';

const PRECACHE = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icons/icon-72x72.png',
  '/icons/icon-96x96.png',
  '/icons/icon-128x128.png',
  '/icons/icon-144x144.png',
  '/icons/icon-152x152.png',
  '/icons/icon-192x192.png',
  '/icons/icon-384x384.png',
  '/icons/icon-512x512.png',
  '/icons/icon-512x512-maskable.png',
];

const OFFLINE_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>TRIFORCE — Offline</title>
<style>
  *, *::before, *::after { margin:0; padding:0; box-sizing:border-box; }
  html, body {
    width:100%; height:100%;
    background:#040507;
    font-family:'Share Tech Mono',monospace;
    color:#a8c8dc;
    display:flex; align-items:center; justify-content:center;
    text-align:center;
  }
  .wrap { display:flex; flex-direction:column; align-items:center; gap:24px; }
  svg { width:64px; height:56px; filter:drop-shadow(0 0 12px rgba(200,150,42,0.5)); }
  h1 {
    font-size:11px; letter-spacing:.42em;
    color:#f0c040;
    text-shadow:0 0 10px rgba(240,192,64,.45);
  }
  p { font-size:9px; letter-spacing:.18em; color:#4a6478; line-height:1.7; }
</style>
</head>
<body>
<div class="wrap">
  <svg viewBox="0 0 100 87" fill="none">
    <polygon points="50,2 98,85 2,85" fill="none" stroke="#c8962a" stroke-width="3"/>
    <polygon points="50,25 74,68 26,68" fill="#f0c040" opacity=".95"/>
    <polygon points="27,25 51,68 3,68" fill="#f0c040" opacity=".95"/>
    <polygon points="73,25 97,68 49,68" fill="#f0c040" opacity=".95"/>
  </svg>
  <h1>TRIFORCE</h1>
  <p>NO NETWORK CONNECTION<br>RECONNECT TO RESUME</p>
</div>
</body>
</html>`;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // WebSocket upgrades — don't intercept
  if (request.headers.get('upgrade') === 'websocket') return;

  // Network-first for API and dynamic routes
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(request).catch(() =>
        new Response(JSON.stringify({ error: 'offline' }), {
          headers: { 'Content-Type': 'application/json' },
        })
      )
    );
    return;
  }

  // Cache-first for static assets
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request)
        .then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        })
        .catch(() => {
          // Offline fallback for navigation requests
          if (request.mode === 'navigate') {
            return new Response(OFFLINE_HTML, {
              headers: { 'Content-Type': 'text/html' },
            });
          }
          return new Response('', { status: 503 });
        });
    })
  );
});
