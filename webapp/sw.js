/* DS 설치현황 서비스워커 — 오프라인 실행(앱 셸) 지원
   · 앱 셸(같은 출처): network-first → 실패 시 캐시 (배포 즉시 최신 반영 + 오프라인 폴백)
   · CDN 라이브러리(버전 고정): cache-first
   · Supabase API/실시간: SW 미개입(항상 네트워크) */
const C = "ds-v3";
const SHELL = ["./", "./index.html", "./app.js", "./styles.css", "./seed.js", "./config.js", "./manifest.webmanifest", "./icon.svg"];
const CDN = [
  "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js",
  "https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js"
];

self.addEventListener("install", e => {
  e.waitUntil((async () => {
    const c = await caches.open(C);
    await Promise.all(SHELL.map(u => c.add(new Request(u, { cache: "reload" }))));   // 항상 서버에서 새로 받아 프리캐시
    await Promise.allSettled(CDN.map(u => c.add(u)));   // CDN 실패해도 설치는 진행
    self.skipWaiting();
  })());
});
// 페이지가 새 버전 감지 시 즉시 교체 요청
self.addEventListener("message", e => { if (e.data === "skipWaiting") self.skipWaiting(); });

self.addEventListener("activate", e => {
  e.waitUntil((async () => {
    const ks = await caches.keys();
    await Promise.all(ks.filter(k => k !== C).map(k => caches.delete(k)));
    self.clients.claim();
  })());
});

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin === location.origin) {
    // 앱 셸: 항상 서버 재검증(no-cache, ETag)으로 최신 받기 → 오프라인이면 캐시(없으면 index.html)
    e.respondWith(
      fetch(new Request(req, { cache: "no-cache" })).then(res => { const cp = res.clone(); caches.open(C).then(c => c.put(req, cp)); return res; })
        .catch(() => caches.match(req).then(r => r || caches.match("./index.html")))
    );
  } else if (CDN.indexOf(url.href) >= 0) {
    // CDN 고정버전: 캐시 우선
    e.respondWith(caches.match(req).then(r => r || fetch(req).then(res => { const cp = res.clone(); caches.open(C).then(c => c.put(req, cp)); return res; })));
  }
  // 그 외(Supabase REST/Realtime/Storage)는 개입하지 않음
});
