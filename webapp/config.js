// Supabase 설정 — 채워지면 클라우드 실시간 공유가 활성화됩니다.
// 비우면 자동으로 '로컬 저장(localStorage)' 모드로 동작합니다(단일 기기 테스트용).
//
// ※ 여기 들어가는 anon key 는 공개돼도 안전한 키입니다(RLS 로 보호). 비공개 레포라 더 안전.
//   service_role 키나 액세스 토큰(sbp_...)은 절대 넣지 마세요.
window.__CONFIG__ = {
  SUPABASE_URL: "https://dcmkrwbtspiqwsjkefax.supabase.co",
  SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRjbWtyd2J0c3BpcXdzamtlZmF4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI0MTM5NTksImV4cCI6MjA5Nzk4OTk1OX0.3NJyFXaJRfwplCEknIpXO_skiLKNA804kDA__981zgs",
};
