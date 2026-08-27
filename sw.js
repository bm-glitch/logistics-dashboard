/* =====================================================================
   업무 요청 대장부 — 서비스워커 (v2)
   -------------------------------------------------------------------
   [왜 고쳤나]
   예전 버전도 "네트워크 먼저"였는데 배포 후에도 옛 화면이 보였습니다.
   원인은 서비스워커가 아니라 그 아래 **브라우저 HTTP 캐시**였어요.
   GitHub Pages는 index.html에 캐시 시간을 붙여서 내려주기 때문에,
   서비스워커가 fetch(req)를 해도 브라우저가 캐시에 있던 옛 HTML을
   그대로 돌려줍니다. 그래서 Ctrl+Shift+R이 필요했던 것.

   [고친 방법]
   1) 화면 문서(HTML) 요청만은 cache:'no-store'로 받아서 HTTP 캐시를 건너뜁니다.
      → 배포하면 다음 접속에 바로 최신 화면.
   2) 캐시 이름을 v2로 올리고, 활성화될 때 옛 캐시를 모두 지웁니다.
      → 기존 사용자에게 남아 있던 옛 index.html이 한 번에 정리됩니다.
   3) 인터넷이 끊겼을 때만 캐시로 돌아갑니다(오프라인 보험은 그대로 유지).

   ※ 이 파일은 저장소 최상위(index.html 옆)에 둡니다.
   ===================================================================== */

const CACHE = 'yocheongseo-v2';
const OLD_CACHE_PREFIX = 'yocheongseo-';

self.addEventListener('install', () => {
  // 새 버전을 기다리지 않고 바로 적용
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    // 옛 버전 캐시 정리 — 남아 있던 옛 index.html을 확실히 버립니다.
    const names = await caches.keys();
    await Promise.all(
      names.filter(n => n.startsWith(OLD_CACHE_PREFIX) && n !== CACHE)
           .map(n => caches.delete(n))
    );
    await self.clients.claim();
  })());
});

// 화면(index.html)에 해당하는 요청인지 판단
function isDocumentRequest(req) {
  if (req.mode === 'navigate') return true;
  if (req.destination === 'document') return true;
  const accept = req.headers.get('accept') || '';
  return accept.includes('text/html');
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  const sameOrigin = (url.origin === self.location.origin);

  // ── ① 화면 문서: HTTP 캐시를 건너뛰고 항상 서버에서 새로 받습니다 ──
  if (sameOrigin && isDocumentRequest(req)) {
    e.respondWith((async () => {
      try {
        // req 자체는 mode:'navigate'라서 cache 옵션을 덮어쓸 수 없어요 → URL로 새로 요청
        const fresh = await fetch(url.href, { cache: 'no-store', credentials: 'same-origin' });
        if (fresh && fresh.ok) {
          const copy = fresh.clone();
          caches.open(CACHE).then(c => c.put(url.href, copy)).catch(() => {});
        }
        return fresh;
      } catch (err) {
        // 인터넷이 끊겼을 때만 지난번 화면으로
        const cached = await caches.match(url.href);
        if (cached) return cached;
        const index = await caches.match('./index.html');
        if (index) return index;
        throw err;
      }
    })());
    return;
  }

  // ── ② 그 밖의 파일(폰트·아이콘 등): 네트워크 먼저, 실패하면 캐시 ──
  e.respondWith(
    fetch(req).then((res) => {
      if (res && res.ok && sameOrigin) {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
      }
      return res;
    }).catch(() => caches.match(req))
  );
});

// 화면 쪽에서 "새 버전 바로 적용해" 신호를 보낼 때
self.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});
