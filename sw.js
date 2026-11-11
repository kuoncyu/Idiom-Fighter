// 成語戰機：離線支援（Service Worker）
// - 網頁本身：有網路時用最新版並更新快取，沒網路時改用快取
// - 圖片 / 音樂 / Firebase SDK：只要存進「離線資料包」就從快取直接讀取
const VERSION = '20261111-12';
const SHELL = 'idiom-shell-' + VERSION;

self.addEventListener('install', e => {
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(['./', 'index.html', 'manifest.webmanifest'])).catch(() => {}).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith('idiom-shell-') && k !== SHELL).map(k => caches.delete(k)))).then(() => self.clients.claim())));   // 新版本：清掉舊的網頁快取

// 音樂會用 Range 請求：從快取回覆 206
async function rangeResponse(req, res) {
  const m = /bytes=(\d+)-(\d*)/.exec(req.headers.get('range') || '');
  if (!m || !res || res.status !== 200) return res;
  const buf = await res.arrayBuffer(), start = +m[1], end = m[2] ? Math.min(+m[2], buf.byteLength - 1) : buf.byteLength - 1;
  return new Response(buf.slice(start, end + 1), { status: 206, statusText: 'Partial Content', headers: {
    'Content-Type': res.headers.get('Content-Type') || 'audio/mpeg', 'Content-Range': `bytes ${start}-${end}/${buf.byteLength}`,
    'Content-Length': String(end - start + 1), 'Accept-Ranges': 'bytes' } });
}

async function cachedPage(req) {
  return (await caches.match(req, { ignoreSearch: true, ignoreVary: true })) ||
         (await caches.match('index.html', { ignoreVary: true })) || (await caches.match('./', { ignoreVary: true }));
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (!/^https?:$/.test(url.protocol)) return;
  const same = url.origin === self.location.origin, gstatic = url.hostname === 'www.gstatic.com';
  if (!same && !gstatic) return;                       // Firebase API 等請求直接走網路

  if (req.cache === 'reload' || req.cache === 'no-store') return;   // 下載資料包時強制走網路，才能覆蓋舊檔案

  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).then(r => { const cp = r.clone(); caches.open(SHELL).then(c => c.put(req, cp)); return r; }).catch(() => cachedPage(req)));
    return;
  }
  e.respondWith((async () => {
    const hit = await caches.match(req, { ignoreSearch: true, ignoreVary: true });
    if (hit) return req.headers.get('range') ? rangeResponse(req, hit.clone()) : hit;
    return fetch(req);
  })());
});
