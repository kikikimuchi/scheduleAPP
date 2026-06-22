// scheduleAPP Service Worker — ネットワーク優先（常に最新を取得・オフライン時のみキャッシュ）
const CACHE = 'scheduleapp-cache-v1';

self.addEventListener('install', (e) => {
  self.skipWaiting(); // 新SWを即時有効化
});

self.addEventListener('activate', (e) => {
  e.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  let url;
  try { url = new URL(req.url); } catch (_) { return; }
  // 自サイトのGETのみ対象（Firestore等の外部通信はそのまま素通し）
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;

  e.respondWith(
    fetch(req)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(req)) // オフライン時のみキャッシュから
  );
});
