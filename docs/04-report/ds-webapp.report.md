# DS 입상덕트 설치현황 웹앱 — 완료 보고서 (PDCA Report)

| 항목 | 값 |
|---|---|
| Feature | `ds-webapp` (기존 코드 보완 사이클) |
| 기간 | 2026-06-28 (단일 세션) |
| 사이클 | Check → Act(Critical) → Re-Check → Act(잔여 전부) → Report |
| 최종 Match Rate | **≈98%** (시작 85%) |
| 배포 | GitHub Pages — https://ttezzi.github.io/ds-duct-status/ |
| 분석 문서 | `docs/03-analysis/ds-webapp.analysis.md` |

> ⚠️ PRD/Plan/Design 부재(legacy). 본 사이클은 **문서(CLAUDE.md·README·schema)↔구현 정합성 + 데이터안전 + 사용성** 갭을 기준으로 한 보완 작업입니다.

---

## Executive Summary

### 개요
| 항목 | 내용 |
|---|---|
| 무엇 | 현장 DS 입상덕트 설치현황 실시간 편집 웹앱의 데이터안전·보안·사용성 보완 |
| 범위 | 갭 10건 도출 → Critical 2 + 잔여 6 해소(+부가 1), 의도된 설계 1건 유지 |
| 결과 | Match Rate 85% → ≈98%, 코드·라이브 DB·배포 전부 반영 및 검증 |

### 결과 요약
| 지표 | 값 |
|---|---|
| 해소 갭 | G1·G2·G4·G3·G5·G6·G7·G8·G9 (+web 구버전 정리) |
| 변경 파일 | app.js·index.html·styles.css·config.js·schema.sql·import_xlsx.py·README·CLAUDE.md + PWA 3종·테스트 1종 |
| 라이브 DB | RLS 마이그레이션 2건(삭제 차단·목록 차단) 적용·검증 |
| 커밋 | 7a36693 · cce98dc · c9c6a62 · 8e56b37 |

### Value Delivered (4관점)
| 관점 | 전 | 후 |
|---|---|---|
| **Problem** | 통신 끊김 시 입력이 조용히 소실 / 링크만 알면 전체 삭제 가능 / 변경이력 안 보임 | 미저장 보관·자동재시도로 손실 방지 / 삭제 차단 / 이력 화면 제공 |
| **Solution** | — | 오프라인 큐(영속+재시도) · RLS 삭제·목록 차단 · change_log 화면 + old_status · PWA · 동시편집 알림 |
| **Function UX 효과** | 저장 성공/실패 구분 불가, 새로고침 시 손실 | 빨간 점선·⏳N 배지, 재연결 자동저장, 홈화면 설치·오프라인 실행, Esc 닫기 |
| **Core Value** | "공유 현황판"인데 손실·무보안·무이력 | **신뢰 가능한 실시간 공유 현황판** (안전·추적·오프라인) |

---

## 1. 사이클 진행 (Journey)
1. **Check(1차)** — 갭 10건(Critical 2·Important 2·Minor 6), Match 85%
2. **Act(Critical)** — G1 미저장 큐 + G2 RLS 삭제차단 → 코드 배포 + 라이브 DB 적용
3. **Re-Check(2차)** — Match ≈92%, Critical 0
4. **Act(잔여 전부)** — G3·G5·G6·G7·G8·G9 일괄 해소 + web 구버전 사본 정리
5. **Report** — 본 문서, Match ≈98%

## 2. 해소 갭
| ID | 내용 | 조치 | 검증 |
|---|---|---|---|
| G1 | 저장 실패 무음 손실 | 미저장 큐(localStorage 영속)+online/20초 재시도+부팅 복원+빨간점선/⏳배지 | node·부팅스모크, anon REST(cells RW/삭제차단) |
| G2 | RLS 전면 개방 | cells·photos **삭제 차단**, photos·web **목록 차단**(마이그레이션 2건) | **E2E**(테스트행 insert→anon delete 0건→생존), advisor clean |
| G4 | change_log 미노출 | 📜 이력 화면 + old_status 기록(변경시만) | anon REST change_log 200, 배포본 마커 |
| G3 | 라인메모 문서불일치 | 파트헤더 📝(lm:) 구현, 빈 상태도 추가 가능 | 배포본 data-linememo |
| G5 | PWA 미지원 | manifest+sw.js(앱셸 network-first·오프라인 폴백)+icon | manifest/sw/icon 200 |
| G6 | 동시편집 무경고 | 실시간 타인 변경 토스트 | 배포본 토스트 마커 |
| G7 | seed.json 배포 동반 | 저장소 루트로 이동 + import 경로 분리 | 배포 URL 404(제외) |
| G8 | 모달 Esc 없음 | Esc 닫기 | 코드 반영 |
| G9 | 테스트 부재 | webapp/test/boot_smoke.js | PASS |
| 부가 | web 구버전 사본 | 옛 앱 5파일 삭제 | 옛 URL 400 |

## 3. Key Decisions & Outcomes
- **삭제만 차단, 쓰기는 허용** — 현장 "링크=편집" 편의 유지하면서 최악(일괄 삭제) 차단. 완전 통제는 Netlify 접근제어/Supabase Auth 필요(문서화). → 적중: 무회귀로 공격면 축소.
- **앱이 사진 객체를 안 지움(참조만 제거)** 확인 → photos delete 정책 무회귀 제거.
- **SW network-first** — 배포 즉시 최신 반영 + 오프라인 폴백. 구버전 캐시 고착 방지.
- **seed.json 루트 이동**(삭제 아님) — 사람이 읽는 사본 보존하면서 605KB 배포 제외.

## 4. Success Criteria(문서 주장) 최종
| 주장 | 결과 |
|---|---|
| 메모 3종(fm/lm/rm) | ✅ Met (lm 구현 완료) |
| 변경 이력 추적 | ✅ Met (화면+old_status) |
| 안전한 공유(삭제 보호) | ✅ Met (E2E 검증) |
| 데이터 손실 방지 | ✅ Met (큐) / ⚠️ 오프라인 전사이클 수동확인(③) 권장 |
| 색=상태·금일색·전일대비·접점·사진·엑셀·실시간 | ✅ Met (기존 유지) |

**충족: 11/11 Met (1건 수동 최종확인 권장)**

## 5. 잔여/후속
- ③ 오프라인 미저장 전사이클 **사용자 수동 테스트**(비행기모드→점선/⏳→재연결 자동저장→새로고침 유지)
- "누구나 수정" = 의도된 링크공유 설계(완전 통제 시 Netlify/Supabase Auth)
- 선택: web 빈 버킷 제거, iOS용 PNG 아이콘, 단위테스트 확대
