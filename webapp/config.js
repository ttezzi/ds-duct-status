// Supabase 설정 — 여기에 값을 채우면 클라우드 실시간 공유가 활성화됩니다.
// 비워두면 자동으로 '로컬 저장(localStorage)' 모드로 동작합니다(단일 기기 테스트용).
//
// 채우는 방법:
//  1) https://supabase.com 에서 무료 프로젝트 생성
//  2) Project Settings > API 에서 'Project URL' 과 'anon public' 키 복사
//  3) supabase/schema.sql 을 SQL Editor 에 붙여넣어 실행(테이블 생성 + 시드 적재)
//  4) 아래 두 값을 채우고 저장
window.__CONFIG__ = {
  SUPABASE_URL: "",      // 예: "https://abcdxyz.supabase.co"
  SUPABASE_ANON_KEY: "", // 예: "eyJhbGciOi..."
};
