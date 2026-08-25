// PWAとしてインストール可能にするための最小Service Worker
// アプリ本体(HTML/アイコン)はネットワーク優先＋キャッシュフォールバックで表示を安定化。
// Firestore等のAPIリクエストはキャッシュせず常にネットワークから取得する。
const CACHE = 'karidokoro-v1';
const ASSETS = ['./', './index.html', './manifest.json', './icon-192.png', './icon-512.png'];

self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).catch(()=>{}));
});
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k))))
      .then(()=>self.clients.claim())
  );
});
self.addEventListener('fetch', e => {
  const url = e.request.url;
  // APIや外部(Firestore等)はキャッシュせずネットワークのみ
  if (e.request.method !== 'GET' || !url.startsWith(self.location.origin)) return;
  // アプリ本体はネットワーク優先、失敗時キャッシュ
  e.respondWith(
    fetch(e.request).then(res => {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(e.request, copy)).catch(()=>{});
      return res;
    }).catch(() => caches.match(e.request).then(r => r || caches.match('./index.html')))
  );
});
