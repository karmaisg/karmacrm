// OSGB 360 - Herkese açık yapılandırma.
//
// Bu iki değer tarayıcıda durabilir: URL ve "anon public" anahtarı.
// Verinizi koruyan şey bu anahtarın gizliliği değil, veri tabanındaki erişim kurallarıdır (RLS).
//
// ASLA buraya "service_role" anahtarı veya başka bir gizli anahtar yazmayın.
//
// Not: index.html içindeki içerik güvenlik politikası (CSP) yalnızca bu adrese bağlantıya izin verir.
// Supabase projesini değiştirirseniz index.html içindeki connect-src değerini de güncelleyin.

export const SUPABASE_URL = 'https://hstvzdumaabqdwdzsbcx.supabase.co';

export const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhzdHZ6ZHVtYWFicWR3ZHpzYmN4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI4MDgwNTgsImV4cCI6MjEwODM4NDA1OH0.krYqF4Ag6Eo2iYUIDj3_gstR7UEHt0ZGL4WVyyo98II';
