// 旧Service Workerを確実に撤去するための自己破壊SW。
// （SWはキャッシュ更新の不具合原因だったため廃止。fetchハンドラ無し＝全てネットワーク直通）
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    try {
      const keys = await caches.keys();
      await Promise.all(keys.map(k => caches.delete(k)));
    } catch (_) {}
    try { await self.registration.unregister(); } catch (_) {}
    try {
      const clients = await self.clients.matchAll({ type: 'window' });
      clients.forEach(c => { try { c.navigate(c.url); } catch (_) {} });
    } catch (_) {}
  })());
});
// fetch ハンドラを定義しない → リクエストは全てネットワークへ直通（キャッシュしない）
