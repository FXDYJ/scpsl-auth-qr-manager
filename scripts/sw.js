const cacheName = 'scpsl-qr-app-__APP_REVISION__';
const appFiles = [
  '/', '/manifest.webmanifest', '/assets/style.css', '/assets/app.js', '/assets/verify.js',
  '/assets/icon-192.png', '/assets/icon-512.png', '/assets/icons.svg',
  '/assets/trust/root.pem', '/assets/trust/northwood-14.json',
  '/vendor/scanner-worker.js', '/vendor/zxing_reader.wasm',
];
const appPaths = new Set(appFiles);

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(cacheName);
    await cache.addAll(appFiles.map((path) => new Request(path, { cache: 'reload' })));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((name) => name.startsWith('scpsl-qr-app-') && name !== cacheName)
      .map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  const path = url.pathname === '/index.html' ? '/' : url.pathname;
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || !appPaths.has(path)) return;
  event.respondWith((async () => {
    const cache = await caches.open(cacheName);
    return (await cache.match(path)) ?? fetch(event.request);
  })());
});
