const cacheName = "vannportalen-shell-v5";
const appShell = [
  "./",
  "./index.html",
  "./style.css?v=3",
  "./app.js?v=5",
  "./manifest.json",
  "./app-icon.svg"
];
const optionalLibraries = [
  "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css",
  "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js",
  "https://unpkg.com/papaparse@5.4.1/papaparse.min.js"
];

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(cacheName)
      .then(cache => cache.addAll(appShell))
      .then(() => caches.open(cacheName))
      .then(cache => Promise.allSettled(optionalLibraries.map(url => cache.add(url))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(key => key !== cacheName).map(key => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", function (event) {
  if (event.request.method !== "GET") return;

  const requestUrl = new URL(event.request.url);
  const isAppAsset = requestUrl.origin === self.location.origin;
  const isPublishedCsv = requestUrl.hostname === "docs.google.com" && requestUrl.pathname.includes("/spreadsheets/");
  const isLibrary = requestUrl.hostname === "unpkg.com";

  if (!isAppAsset && !isPublishedCsv && !isLibrary) return;

  event.respondWith(
    fetch(event.request)
      .then(response => {
        if (response.ok || response.type === "opaque") {
          const copy = response.clone();
          caches.open(cacheName).then(cache => cache.put(event.request, copy));
        }
        return response;
      })
      .catch(() => caches.match(event.request).then(response => {
        if (response) return response;
        if (event.request.mode === "navigate") return caches.match("./index.html");
        return Response.error();
      }))
  );
});
