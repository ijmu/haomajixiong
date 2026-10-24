/* 号码玄机 · Service Worker —— v2
   策略：网络优先，断网落缓存；respondWith 永不返回 undefined。

   v1 真机教训（用户 Safari 截图："Returned response is null"）：
   1) Safari 拒绝 cache.put 导航请求（mode:'navigate' 抛 TypeError），被 catch 吞掉
      → 首页 HTML 永远没进缓存（Chrome 没这限制，本地测不出来）；
   2) 网络失败时兜底链 resolve 成 undefined → respondWith(undefined) → 上述报错。
   v2：导航响应以普通 Request 为键写缓存；兜底末尾保证返回离线页；
   缓存版本 v2（activate 清掉 v1 坏缓存）。 */
const CACHE = 'haoma-v2';
const SHELL = ['/', '/style.css', '/404.html',
  '/js/app.js', '/js/data.js', '/js/engine.js', '/js/share.js', '/js/compare.js',
  '/apple-touch-icon.png', '/favicon-32.png', '/manifest.json'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE)
    .then(c => Promise.all(SHELL.map(u => c.add(u).catch(() => {}))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

function offlinePage() {
  return new Response(
    '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>离线 · 号码玄机</title>' +
    '<div style="font-family:-apple-system,sans-serif;background:#0b0a10;color:#bdb6c6;min-height:100vh;' +
    'display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;text-align:center">' +
    '<div style="font-size:42px">\u262f\uFE0E</div>' +
    '<div style="font-size:16px;color:#f4e0b0;letter-spacing:.2em">当前离线</div>' +
    '<div style="font-size:13px;line-height:1.9;max-width:280px">网络恢复后刷新即可；' +
    '已缓存的页面断网时仍可打开。</div>' +
    '<button onclick="location.reload()" style="margin-top:10px;padding:10px 28px;border:0;border-radius:9px;' +
    'background:#d9b877;color:#1c1508;font-size:14px;font-weight:600">重试</button></div>',
    { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  let url;
  try { url = new URL(req.url); } catch (err) { return; }
  if (url.origin !== location.origin) return;
  const isNav = req.mode === 'navigate';

  e.respondWith((async () => {
    let res = null;
    try { res = await fetch(req); } catch (err) { res = null; }
    if (res && res.ok && res.type !== 'opaque') {
      try {
        const c = await caches.open(CACHE);
        /* 关键修复：Safari 拒绝以导航请求为键写缓存，换普通 Request 键 */
        await c.put(isNav ? new Request('/', { method: 'GET' }) : req, res.clone());
      } catch (err) { /* 写缓存失败不阻断正常上网 */ }
    }
    if (res) return res;
    const c = await caches.open(CACHE).catch(() => null);
    const hit = c && await c.match(isNav ? '/' : req, { ignoreSearch: true }).catch(() => null);
    return hit || offlinePage();   /* 兜底必有 Response，绝不 undefined */
  })());
});
