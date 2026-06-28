// Supabase 설정 — 채워지면 클라우드 실시간 공유가 활성화됩니다.
// 비우면 자동으로 '로컬 저장(localStorage)' 모드로 동작합니다(단일 기기 테스트용).
//
// ※ anon key 는 클라이언트에 실리는 '공개 키'입니다 — 배포되면 누구나 볼 수 있습니다(원래 그런 키).
//   실제 보호는 Supabase RLS 가 담당합니다. 현재 정책은 cells/photos '삭제'를 차단(schema.sql 참고).
//   쓰기까지 막으려면 Netlify 접근제어 또는 Supabase Auth 도입 필요(schema.sql ※ 항목).
//   service_role 키나 액세스 토큰(sbp_...)은 절대 넣지 마세요.
window.__CONFIG__ = {
  SUPABASE_URL: "https://dcmkrwbtspiqwsjkefax.supabase.co",
  SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRjbWtyd2J0c3BpcXdzamtlZmF4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI0MTM5NTksImV4cCI6MjA5Nzk4OTk1OX0.3NJyFXaJRfwplCEknIpXO_skiLKNA804kDA__981zgs",
};
