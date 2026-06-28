# DS 입상덕트 작업현황 — 프로젝트 가이드 (Claude Code용)

현장 DS(입상덕트 샤프트)의 층×덕트파트 **입면도**를 모바일에서 실시간 수정하는 웹앱.
원본은 엑셀 1장(`DS 설치현황` 시트)이고, 이를 색=상태로 편집하는 앱으로 옮긴 것.

## 구조
```
/ (repo root)
├─ (260617)세보 PH2 DUCT설치현황_rev01.xlsx   # 원본 엑셀(입면도)
├─ webapp/
│  ├─ index.html / app.js / styles.css        # 빌드 불필요 단일 앱(vanilla JS)
│  ├─ config.js                               # Supabase 설정(비우면 localStorage 모드)
│  ├─ seed.js / seed.json                      # 엑셀에서 추출한 기준 데이터(파트100·셀2900)
│  ├─ import_xlsx.py                           # 엑셀→seed 재생성 스크립트
│  ├─ supabase/schema.sql                      # 클라우드 DB 스키마
│  └─ README.md                                # 운영·배포·사용 상세
└─ .claude/launch.json                         # 미리보기 서버(python http.server) 설정
```

## 실행 / 미리보기
- **이 PC엔 Node.js가 없음** → Vite 등 빌드도구 사용 불가. 빌드리스 단일 HTML로 구성됨.
- 로컬 미리보기: `python -m http.server 5510 --directory webapp` 후 http://localhost:5510
  (또는 Claude Code 의 preview 가 `.claude/launch.json` 의 `ds-web` 사용)
- 배포: `webapp` 폴더를 Netlify Drop 등에 올리면 됨. 단일 HTML이라 정적 호스팅이면 충분.

## 데이터 재생성
원본 엑셀이 바뀌면: `cd webapp && python import_xlsx.py` → `webapp/seed.js`(앱 로드용) + `seed.json`(**저장소 루트**, 배포 제외) 갱신.
(openpyxl 필요. 색 추출은 테마색→RGB 해석 포함)

## PWA / 테스트
- **PWA**: `manifest.webmanifest`·`sw.js`·`icon.svg`. 서비스워커는 앱 셸 network-first(배포 즉시 최신) + 오프라인 폴백, CDN은 cache-first, Supabase는 미개입. 홈화면 추가 가능.
- **부팅 스모크 테스트**: `node webapp/test/boot_smoke.js` (의존성 없음, 최소 DOM 스텁으로 IIFE 부팅 무에러 확인 — seed 재생성·리팩터 후 회귀 방지). `node --check webapp/app.js`도 병행.

## 핵심 도메인 규칙 (정합성 — 검증 완료)
- 세로축: 층마다 3행 = **횡주 / 입상 / 바닥(층막이타공)**, 10F→1F. + 상부접점·하부접점 행.
- 가로축: 덕트파트 4구역 — **북DS(FA,SA) C–V / 동DS(FA) W–Y / 북DS(배기) AA–CT / 동DS(배기) CV–CZ**.
  (W–Y는 라벨이 '동DS배기'여도 성상 FA라 **동DS(FA)** 가 맞음 — 사용자 확인)
- 물량 숫자: 엑셀 표시서식 반영해 **항상 정수 반올림** 표기(표기만, 의미는 무시).
- **대각선 = 횡주간 없음**(횡주 레이어 전용, 값 없음). 옅게 표시.
- 색=상태(원본 입면도 8색, 범례 이미지 직접 확인 — **색 스와치는 라벨 왼쪽**에 배치됨):
  - 미설치 = **회색 #BFBFBF**  ·  기타 간섭구간 = 빨강 #FF0000  ·  비계 간섭구간 = 핑크 #FF8F8F
  - 금일타공 = 노랑 #FFFF00(바닥)  ·  타공완료 = **시안 #66FFFF**(바닥)
  - 금일설치 = 진파랑 #0070C0(입상/횡주)  ·  설치완료 = **시안 #66FFFF**(입상/횡주)
  - 기설치덕트/기설치타공 = **하늘 #00B0F0**  ·  작업없음 = 흰색  ·  횡주간없음 = 대각선(횡주)
  - 핵심: **설치완료(시안)와 기설치(하늘)는 원본부터 다른 색**. 레이어로 시안=타공완료/설치완료, 하늘=기설치타공/덕트 구분.
- 완료 집계(구간 칸 수): 덕트=설치완료+기설치덕트+금일설치 / 바닥=타공완료+기설치타공+금일타공. 미설치·간섭은 미완료.

## 저장 모드
- `config.js` 비면 **localStorage**(단일기기), 채우면 **Supabase 실시간 공유**(여러 기기·변경이력).
- Supabase: `webapp/supabase/schema.sql` 실행 → `config.js` 에 URL/anon key 입력. 변경분만 저장(기준은 seed).
- **미저장 큐**: 저장 실패 시 변경분을 `localStorage("ds_pending_v1")` 에 보관 → 칸에 빨간 점선 + 상단 ⏳N 배지, `online`/20초 주기로 자동 재시도. 부팅 시 `reapplyPending()` 로 서버값 위에 복원(새로고침 손실 방지).
- **RLS**: cells·photos **삭제 차단**(앱은 cells upsert만·사진은 참조만 제거). 쓰기 통제는 Netlify 접근제어/Supabase Auth 필요(schema.sql ※).

## 인터랙션 (v3)
- 기본보기 = **전체 구역**. 셀 클릭 → **(라인+층) 통합 편집 모달**(횡주·입상·바닥 한 번에, 모바일 하단시트).
  - 횡주: 있음/없음(없음=대각선, 색은 입상 따라감) · 바닥: 있음/없음(없음=해당없음) · 각 레이어 상태 5종(미설치/완료/기타간섭/비계간섭/기설치).
- **금일색은 자동**: 완료(설치완료/타공완료)로 바꾸면 `d`(변경일) 기록 → 당일은 금일색(입상 진파랑·바닥 노랑), 다음날 완료색(시안). 저장은 완료상태로만.
- **전일대비** 토글: 오늘(`d==today`) 변경된 설치·간섭 칸에 주황 마커.
- 메모 3종(층 `fm:`, 라인 `lm:`, 잔여작업 `rm:<라인>:<층>`) + 접점(`uc:`/`dc:`). 사진은 `ph:<라인>:<층>`(Supabase Storage 버킷 `photos`, 로컬모드는 base64). 층 hover 시 해당 층 강조.

## 작업 시 주의
- 셀 좌표 키: `"<열문자>|<층>|<레이어>"` 예) `"AB|9F|입상"`.
- 앱은 외부 의존성을 CDN으로 로드(supabase-js, exceljs). 인터넷 필요.
- 미리보기 스크린샷 도구가 가끔 멈추면 `preview_eval` 로 DOM 상태 확인.
