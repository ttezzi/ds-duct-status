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

-- 실시간 발행
alter publication supabase_realtime add table public.cells;
alter publication supabase_realtime add table public.notes;

-- RLS (익명 링크 공유)
alter table public.cells      enable row level security;
alter table public.notes      enable row level security;
alter table public.change_log enable row level security;
create policy "cells_all"  on public.cells      for all using (true) with check (true);
create policy "notes_all"  on public.notes      for all using (true) with check (true);
create policy "log_insert" on public.change_log for insert with check (true);
create policy "log_read"   on public.change_log for select using (true);

-- ---- 사진 저장(Storage) ----
-- 공개 버킷 'photos' 생성 (이미 있으면 무시)
insert into storage.buckets (id, name, public)
values ('photos', 'photos', true)
on conflict (id) do nothing;
-- 익명 업로드/조회 허용(현장 공유 링크용)
create policy "photos_read"   on storage.objects for select using (bucket_id = 'photos');
create policy "photos_insert" on storage.objects for insert with check (bucket_id = 'photos');
create policy "photos_delete" on storage.objects for delete using (bucket_id = 'photos');
