// Service Worker — 缓存应用外壳，离线可打卡（v2）
const CACHE = 'poop-tracker-v2';
const SHELL = [
  '.',
  'index.html',
  'manifest.webmanifest',
  'icon.svg'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  // API / 健康检查 / 埋点：绝不缓存，始终走网络
  if (url.pathname.startsWith('/api/') || url.pathname === '/healthz' || url.pathname === '/e') {
    e.respondWith(fetch(req));
    return;
  }
  if (req.method !== 'GET') return;
  // 外壳走 cache-first（秒开，抗 Render 冷启动）；其余 network-first 失败回缓存
  e.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        return res;
      }).catch(() => caches.match('index.html'));
    })
  );
});
