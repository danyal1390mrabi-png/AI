const CACHE_NAME = "danyalcode-ai-v3";

// همه‌ی صفحات و فایل‌های ثابت سایت که باید برای کارکرد آفلاین کش بشن
const APP_SHELL = [
  "./",
  "./index.html",
  "./page2.html",
  "./page3.html",
  "./page4.html",
  "./page5.html",
  "./manifest.json",
  "./favicon.ico",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-192-maskable.png",
  "./icons/icon-512-maskable.png"
];

// آدرس‌های API که هرگز نباید کش بشن (همیشه باید مستقیم به شبکه بره)
const NO_CACHE_HOSTS = [
  "apis.danyalcode.ir",
  "super-sound-5676.danyal1390mrabi.workers.dev"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // فقط درخواست‌های GET قابل کش هستن؛ بقیه (مثل POST به API) مستقیم به شبکه می‌رن
  if (req.method !== "GET") {
    event.respondWith(fetch(req));
    return;
  }

  // درخواست‌های هوش مصنوعی و جستجو هرگز کش نمی‌شن؛ همیشه تازه از شبکه گرفته می‌شن
  if (NO_CACHE_HOSTS.includes(url.hostname)) {
    event.respondWith(fetch(req));
    return;
  }

  // برای بقیه (صفحات، آیکون‌ها، فونت‌ها و ...): اول کش، بعد شبکه، و به‌روزرسانی کش در پس‌زمینه
  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((response) => {
          if (response && response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
          }
          return response;
        })
        .catch(() => cached);

      return cached || network;
    })
  );
});
