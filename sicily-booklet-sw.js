const CACHE_NAME = "sicily-booklet-v2";
const CORE_FILES = ["./sicily-booklet_6-guides.html", "sicily-booklet.webmanifest", "sicily-icon.svg", "sicily-icon-192.png", "sicily-icon-512.png"];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(CORE_FILES)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener("message", event => {
  if (event.data && event.data.type === "CACHE_URL" && event.data.url) event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.add(event.data.url)));
});
self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;
  event.respondWith(caches.match(event.request).then(cached => cached || fetch(event.request).then(response => { const copy = response.clone(); caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy)); return response; }).catch(() => caches.match("./sicily-booklet_6-guides.html"))));
});
