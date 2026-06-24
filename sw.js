// scheduleAPP Service Worker — 常に最新を取得（no-storeでHTTPキャッシュも回避）。オフライン時のみキャッシュ
const CACHE = 'scheduleapp-cache-v2';

self.addEventListener('install', (e) => {
  self.skipWaiting(); // 新SWを即時有効化
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    // 旧キャッシュを破棄
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  let url;
  try { url = new URL(req.url); } catch (_) { return; }
  // 自サイトのGETのみ対象（Firestore等の外部通信はそのまま素通し）
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;

  e.respondWith(
    // no-store でブラウザのHTTPキャッシュを使わず必ずネットワークから取得
    fetch(req.url, { cache: 'no-store' })
      .then((res) => {
        try { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {}); } catch (_) {}
        return res;
      })
      .catch(() => caches.match(req)) // オフライン時のみキャッシュから
  );
});
