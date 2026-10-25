// OSGB 360 - Supabase istemcisini oluşturur.
// Kütüphane jsDelivr üzerinden, sabit sürümle yüklenir. Sabit sürüm bulunamazsa 2.x en güncel sürüme düşülür.
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../config.js';

const SURUM_SABIT = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';
const SURUM_YEDEK = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

export async function createDb() {
  let modul;
  try {
    modul = await import(SURUM_SABIT);
  } catch (e) {
    console.warn('Sabit Supabase sürümü yüklenemedi, yedek sürüm deneniyor.', e);
    modul = await import(SURUM_YEDEK);
  }
  return modul.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      flowType: 'pkce',            // şifre sıfırlama bağlantısı adres çubuğunda "?code=" ile döner (# ile çakışmaz)
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });
}
