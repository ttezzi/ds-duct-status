# DS 입상덕트 설치현황 웹앱 — Gap Analysis (Check)

| 항목 | 값 |
|---|---|
| Feature | `ds-webapp` (기존 코드 / legacy) |
| 분석일 | 2026-06-28 |
| 분석 방식 | 문서(CLAUDE.md·README·schema) ↔ 구현 정합성 + 코드품질 + 런타임 데이터안전 |
| 비고 | PRD/Plan/Design 문서 부재 → Design↔구현 표준 비교 불가. 위 3개 문서를 사실상 명세로 사용 |

> ⚠️ 표준 PDCA의 "Design 문서 vs 구현" Match Rate가 아니라, **명시 문서의 주장 vs 실제 구현** 정합성으로 재해석한 결과입니다.

---

## 1. Match Rate 요약 (static-only 공식)

자동 테스트·런타임 자동검증 수단이 없어 정적 분석 공식 적용:
`Overall = Structural×0.2 + Functional×0.4 + Contract×0.4`

| 축 | 점수 | 근거 |
|---|---:|---|
| **Structural** (파일·부팅·구성) | 95% | 모든 파일 존재, 단일 HTML 부팅 정상, CDN 의존(supabase-js·exceljs) 정상 로드 |
| **Functional** (기능 완성도) | 85% | 격자·편집·줌·색판정·대시보드·내보내기·사진·접점·검색·전일대비 모두 구현. 라인메모 미구현, change_log 반쪽 |
| **Contract** (문서 주장 ↔ 구현 일치) | 80% | 라인메모 주장 불일치, change_log 미노출, RLS "보호" 표현 오해소지 |
| **Overall** | **85%** | (19 + 34 + 32) |
| **Runtime 안전성** (참고축, 가중 외) | **60%** | 저장 실패 무음 손실·오프라인 큐 부재 → 현장 데이터 손실 위험 |

> 구조적 85%에도 불구하고 **런타임 데이터안전 갭(G1)은 Critical** — PDCA 규칙상 데이터 무결성 위반은 Match Rate와 무관하게 Critical로 분류합니다.

---

## 2. Gap List (심각도순)

### 🔴 Critical

**G1. 클라우드 저장 실패 = 무음 데이터 손실**
- 증거: `webapp/app.js:59`, `:63` — `try { await backend.saveCell(...) } catch (e) { toast("저장 실패") }`
- 변경값은 메모리(`over` Map)에만 남고 재시도·영속 큐 없음. 새로고침 시 `boot()`→`cloudBackend()`가 DB에서 재로딩(`app.js:102-103`)하며 미저장분 소실.
- 현장(지하·EV·약전파)에서 빈번할 시나리오. 저장 성공/실패의 시각적 구분도 없음.
- 영향: **작업자가 입력한 현황이 조용히 사라짐** → 앱 신뢰성의 근간.

**G2. RLS 전면 개방 — 보호 부재**
- 증거: `webapp/supabase/schema.sql:48-51` `for all using(true) with check(true)`, `:59-61` photos insert/delete 익명 허용.
- 배포 URL만 알면 누구나 전체 cells/notes/photos를 수정·**삭제** 가능.
- `config.js:4`의 "비공개 레포라 더 안전" 주석은 오해소지 — anon key는 클라이언트라 배포 시 어차피 공개. 실제 보호는 RLS가 담당해야 하는데 무력.
- 영향: 악의·실수에 의한 전체 데이터/사진 일괄 삭제 가능.

### 🟡 Important

**G3. 라인 메모(`lm:`) 문서엔 있으나 미구현**
- 주장: `CLAUDE.md`("메모 3종 … 라인 `lm:`"), `README.md:40`("파트 헤더 📝=라인 메모"), `schema.sql:19`(`lm:AB` 예시)
- 구현: `app.js`는 파트 헤더에 `pn/sz/sg`만 렌더(`:187-190`), 클릭 핸들러는 `fm:`(층메모)만 처리(`:497`). **라인메모 버튼·핸들러 없음.**
- 영향: 문서-구현 불일치(3곳). 사용자가 있다고 믿는 기능이 부재.

**G4. change_log 반쪽 활용**
- 증거: `app.js:113` insert에 `new_status`만 기록 — `schema.sql:31`의 `old_status` 컬럼 미사용.
- UI 어디서도 이력 조회 불가(대시보드에 미노출). "누가 언제 바꿨나"가 핵심 가치인데 수집만 하고 안 씀.
- 영향: 저비용 고효용 기능 사장(데이터는 이미 적재 중).

### 🟢 Minor

| ID | 항목 | 증거 | 비고 |
|---|---|---|---|
| G5 | 오프라인/PWA 미지원 | manifest·service worker 부재 | G1과 연계, 현장앱 거의 필수 |
| G6 | 동시 편집 last-write-wins, 경고 없음 | `app.js:57` | 같은 칸 동시 수정 시 무음 덮어쓰기 |
| G7 | seed.json(605KB) 배포 동반 게시 | `index.html:118`은 seed.js만 로드 | seed.json은 import 산출물, 배포 불필요 |
| G8 | 접근성/모달 UX | `index.html:5` user-scalable=no, 모달 Esc·포커스트랩 없음 | 자체 줌은 있음 |
| G9 | 테스트 부재 | `effColor`/`floorDoneCount`/금일로직 등 | seed 재생성 후 회귀 위험 |
| G10 | 자잘 | `partsByZone["all"]` 3중 할당(`:146,:539,renderAll`), 내보내기 원색 사용(`:679`) | 후자는 의도면 OK |

---

## 3. 문서 주장(Success Criteria 대용) 검증

| 문서 주장 | 상태 | 증거 |
|---|---|---|
| 색=상태 8색 레이어 문맥 구분 | ✅ Met | `app.js:263-278` effColor/paintCell |
| 금일색 자동(완료→당일 금일색, 익일 완료색) | ✅ Met | `app.js:16,266` TODAY_OF |
| 전일대비 토글 | ✅ Met | `app.js:277,556-561` |
| 메모 3종(fm/lm/rm) | ⚠️ Partial | fm·rm만 구현, **lm 미구현** (G3) |
| 접점 uc/dc | ✅ Met | `app.js:242-261` |
| 사진(Storage/로컬 base64) | ✅ Met | `app.js:66-76,119-126` |
| 변경 이력 추적 | ⚠️ Partial | 적재만, **조회 UI 없음·old_status 미기록** (G4) |
| 변경분만 저장(기준=seed) | ✅ Met | `app.js:42-48` override 머지 |
| 엑셀 내보내기(색·물량) | ✅ Met | `app.js:662-687` |
| 실시간 공유(Supabase) | ✅ Met (단 G2 위험) | `app.js:100-128` |
| 안전한 공유(RLS 보호) | ❌ Not Met | RLS 무력화 (G2) |

**충족률: 8/11 Met, 2 Partial, 1 Not Met**

---

## 4. 권장 조치 (Act 우선순위)

1. **G1** 미저장 큐+재시도+미저장 시각표시 (Critical, 손실 방지)
2. **G2** Netlify 접근제어 or 암구호 게이트 + 사진 delete 정책 제거 (Critical)
3. **G4** old_status 기록 + 대시보드 "최근 변경 이력" 섹션 (저비용 고효용)
4. **G3** 라인메모 구현 또는 문서에서 제거(택1로 일치)
5. **G5~G10** 여건 시 순차

> 최단 ROI: **G4**(데이터 이미 존재, 표시만) → **G1**(손실 방지) 순.

---

## 5. 다음 단계
- 즉시 수정: `/pdca iterate ds-webapp` 또는 개별 구현
- 정식화 필요 시: `/pdca plan ds-webapp`으로 보완 범위 정의 후 design→do

---

## 6. Act 결과 (2026-06-28, Critical만 수정 선택)

### ✅ G1 해소 — 미저장 큐 + 자동 재시도 + 시각표시
- `app.js`: `pending` Map + `localStorage("ds_pending_v1")` 영속화, `setCell`/`setNote` → `_save()` 경유. 실패 시 큐 보관, 성공 시 제거.
- 재시도: `online` 이벤트 + 20초 주기 `flush()`. 부팅 시 `reapplyPending()`로 서버값 위에 미저장분 복원 → **새로고침 손실 차단**.
- 표시: 미저장 칸 빨간 점선(`.unsaved`), 상단 배지 `⏳N`(`.conn.has-pending`). `styles.css` 마커 추가.
- 영향 칸: `app.js:38-42,62-85,168-178,313,752-759`, `styles.css`(conn/pendpulse/unsaved).

### ✅ G2 해소 — RLS 삭제 차단 + 문서 정정
- `schema.sql`: 개방 `for all` 제거 → cells는 select/insert/update만(**delete 차단**), photos 객체 **delete 차단**(앱은 참조만 제거 → 무회귀). 재실행 안전한 drop-then-create 마이그레이션.
- `config.js`·`README.md`·`CLAUDE.md`: anon key=공개 키임 명시, 쓰기 통제는 Netlify 접근제어/Supabase Auth 필요로 정정.
- ⚠️ 잔여: '쓰기(수정)'는 여전히 익명 허용(링크 공유 편의 유지). 완전 통제는 위 두 옵션 적용 필요 — 의식적 결정 사항으로 문서화.

### 검증
- `node --check app.js` ×2 통과(문법).
- DOM 스텁 부팅 스모크: 전체 IIFE 로컬모드 부팅 무에러, 클린 부팅 시 큐 비어 있음 확인.
- ⚠️ 미검증(자동): 오프라인 실패→재큐→재연결→flush 전 사이클 E2E. (브라우저 확장 미연결 + store 클로저 캡슐화) → **30초 수동 테스트 권장**: 비행기모드 ON→셀 편집(빨간 점선·⏳ 확인)→비행기모드 OFF→자동 저장·새로고침 유지 확인.

### 재평가 Match Rate
| 축 | 이전 | 현재 |
|---|---:|---:|
| Structural | 95% | 95% |
| Functional | 85% | 85% (G3/G4 미수정) |
| Contract | 80% | 88% (RLS 주장 정합) |
| **Overall** | **85%** | **≈88%** |
| Runtime 안전성 | 60% | **≈85%** (손실 방지) |

> 90% 미만은 **G3(라인메모 문서불일치)·G4(change_log 미노출)** 미수정 때문 — Critical-only 선택에 따른 의도된 잔여.

### 잔여 권장(다음 사이클)
- G4: old_status 기록 + 대시보드 "최근 변경 이력"(저비용 고효용)
- G3: 라인메모 구현 or 문서 제거
- G5~G10: PWA·동시편집 경고·seed.json 배포 제외·접근성·테스트
