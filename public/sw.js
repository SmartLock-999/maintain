const CACHE_NAME = 'smart-lock-v1';
const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './maintain.png',
  './pwa-192.png',
  './pwa-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS);
    })
  );
});

self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request).then((response) => {
      return response || fetch(event.request);
    })
  );
});
