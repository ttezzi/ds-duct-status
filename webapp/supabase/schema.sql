-- ============================================================
-- DS 입상덕트 작업현황 — Supabase 스키마 (v2)
-- SQL Editor 에 전체 붙여넣고 RUN. 변경분만 저장(기준 데이터는 seed.js).
-- ============================================================

-- 셀 상태(변경분) : key = "<열문자>|<층>|<레이어>"  예) "AB|9F|입상"
create table if not exists public.cells (
  key         text primary key,
  status      text not null,
  qty         numeric,
  qd          text,                 -- 화면 표시용 물량 문자열
  d           date,                 -- 마지막 변경일(전일대비·금일색 판정)
  updated_by  text,
  updated_at  timestamptz default now()
);
-- 기존 테이블에 컬럼 추가(이미 만든 경우)
alter table public.cells add column if not exists d date;

-- 메모/접점 통합 노트 : key 예) "fm:북DS(배기):9F"(층메모), "lm:AB"(라인메모),
--                              "uc:AB"(상부접점), "dc:AB"(하부접점)
create table if not exists public.notes (
  key         text primary key,
  body        text,
  updated_by  text,
  updated_at  timestamptz default now()
);

-- 변경 이력
create table if not exists public.change_log (
  id          bigserial primary key,
  cell_key    text,
  old_status  text,
  new_status  text,
  qty         numeric,
  user_name   text,
  team        text,
  ts          timestamptz default now()
);

-- 실시간 발행 (change_log 포함 → 변경 이력 실시간 갱신)
alter publication supabase_realtime add table public.cells;
alter publication supabase_realtime add table public.notes;
alter publication supabase_realtime add table public.change_log;

-- RLS (익명 링크 공유) — 안전 강화판
--  · cells : 읽기/추가/수정만 허용, DELETE 차단(앱은 upsert만 사용 → 전체 삭제 공격 방지)
--  · notes : 비우기(삭제)가 필요해 DELETE 허용
--  · change_log : insert/select 만
-- ⚠️ 쓰기 자체는 여전히 익명 허용(링크 공유 편의). '진짜 접근 통제'는 아래 ※ 항목 참고.
alter table public.cells      enable row level security;
alter table public.notes      enable row level security;
alter table public.change_log enable row level security;

-- 기존 개방 정책 제거(이미 한 번 실행한 환경에서도 안전하게 재적용)
drop policy if exists "cells_all"  on public.cells;
drop policy if exists "notes_all"  on public.notes;
drop policy if exists "log_insert" on public.change_log;
drop policy if exists "log_read"   on public.change_log;

create policy "cells_read"   on public.cells for select using (true);
create policy "cells_insert" on public.cells for insert with check (true);
create policy "cells_update" on public.cells for update using (true) with check (true);
-- (cells 에는 delete 정책 없음 = 삭제 불가)

create policy "notes_all"  on public.notes      for all using (true) with check (true);
create policy "log_insert" on public.change_log for insert with check (true);
create policy "log_read"   on public.change_log for select using (true);

-- ※ 누구나 '수정'은 가능한 상태입니다. 더 강한 통제가 필요하면 택1:
--   (a) Netlify 사이트 비밀번호/접근 제어(Site settings → Access control)
--   (b) Supabase Auth(익명 로그인 등) 도입 후 위 정책의 using/check 를 (auth.role() = 'authenticated') 로 교체

-- ---- 사진 저장(Storage) ----
-- 공개 버킷 'photos' 생성 (이미 있으면 무시)
insert into storage.buckets (id, name, public)
values ('photos', 'photos', true)
on conflict (id) do nothing;
-- 익명 '업로드'만 허용(현장 공유 링크용).
--  · 조회: public 버킷의 공개 URL(/object/public/)로 동작 → SELECT 정책 불필요.
--    SELECT 정책을 두지 않음으로써 파일 '목록 열람(enumeration)'을 차단한다.
--  · 삭제: 앱은 사진 삭제 시 객체를 지우지 않고 메모의 참조만 제거(app.js delPhoto)
--    → DELETE 정책도 두지 않아 '전체 사진 일괄 삭제' 공격을 막는다(개별 사진 표시엔 무영향).
drop policy if exists "photos_read"   on storage.objects;
drop policy if exists "photos_delete" on storage.objects;
drop policy if exists "photos_insert" on storage.objects;
create policy "photos_insert" on storage.objects for insert with check (bucket_id = 'photos');
-- (photos read/delete 정책 없음 = 목록 열람·객체 삭제 불가, 개별 사진은 공개 URL로 정상 표시)
