/* 号码玄机 · Service Worker
   策略定版（勿改回 cache-first）：
   - 网络优先：有网永远拿最新（浏览器 HTTP 缓存照常生效），断网才落回 SW 缓存
   - 为什么禁止 cache-first：SW 的 cache-first 会把用户钉死在旧代码上——
     页面 HTML 里的 ?v= 戳只管入口文件，子模块由 SW 策略决定新旧（kline 项目实测踩坑）
   - 本站纯客户端、无任何网络请求，整站可离线 */
const CACHE = 'haoma-v1';
const SHELL = ['/', '/style.css', '/404.html',
  '/js/app.js', '/js/data.js', '/js/engine.js', '/js/share.js', '/js/compare.js',
  '/apple-touch-icon.png', '/favicon-32.png', '/manifest.json'];

self.addEventListener('install', e => {
  /* 单个 shell 资源失败不阻断安装（如暂时 404），运行期兜底缓存会补齐 */
  e.waitUntil(caches.open(CACHE)
    .then(c => Promise.all(SHELL.map(u => c.add(u).catch(() => {}))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;

  e.respondWith(
    fetch(req).then(res => {
      if (res && res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
      }
      return res;
    }).catch(() =>
      /* ignoreSearch：页面带 ?v=戳 请求的模块，能命中预缓存的无戳条目 */
      caches.match(req, { ignoreSearch: true }).then(r => r || caches.match('/'))
    )
  );
});
