// PWAとしてインストール可能にするためのService Worker。
// アプリ本体(HTML/JS/CSS/アイコン)はネットワーク優先＋キャッシュフォールバックで表示を安定化。
// Firestore等の外部API・GET以外のリクエストはキャッシュせず素通り（データは常に最新取得）。
const CACHE = 'schedule-v1';
const ASSETS = [
  './',
  './index.html',
  './ui.js',
  './theme-manbo.css',
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).catch(()=>{}));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  // GET以外・外部(Firestore等)はキャッシュせずネットワークへ素通り
  if (req.method !== 'GET' || !req.url.startsWith(self.location.origin)) return;
  // アプリ本体はネットワーク優先、失敗時にキャッシュへフォールバック
  e.respondWith(
    fetch(req).then(res => {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(req, copy)).catch(()=>{});
      return res;
    }).catch(() => caches.match(req).then(r => r || caches.match('./index.html')))
  );
});
