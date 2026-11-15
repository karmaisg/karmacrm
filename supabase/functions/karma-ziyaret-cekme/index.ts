// @ts-nocheck
// OSGB 360 - Karma OSGB yazılımından ziyaret kayıtlarını çeker (Supabase Edge Function).
// İki yoldan çalışır:
//   1) Zamanlanmış (pg_cron): "x-ozet-sirri" başlığı OZET_CRON_SIRRI ile aynıysa.
//   2) Elle: Sistem ayarları > "Karma OSGB ziyaret aktarımı" kartındaki "Şimdi çek" düğmesi (oturum + "ayarlar" izni).
// Gizli ayarlar (Supabase > Edge Functions > Secrets): KARMA_API_ADRES (https://.../api/ziyaretler), KARMA_API_ANAHTARI, OZET_CRON_SIRRI
// İsteğe bağlı: KARMA_BASLANGIC (YYYY-MM-DD; ilk çekimde bu tarihten itibaren alınır, varsayılan: geçen ayın başı), KARMA_ORGANIZASYON (birden fazla kurum varsa)
// Anahtar yalnızca bu gizli ayardadır; veritabanına, loga ya da yanıta yazılmaz.

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type, x-ozet-sirri',
  'access-control-allow-methods': 'POST, OPTIONS',
};
const SAYFA = 500; const AZAMI_SAYFA = 20; const ZAMAN_ASIMI_MS = 20000;
export const esitMi = (a, b) => { a = String(a); b = String(b); if (a.length !== b.length) return false; let f = 0; for (let i = 0; i < a.length; i++) f |= a.charCodeAt(i) ^ b.charCodeAt(i); return f === 0; };
const metin = (v, n) => (v === null || v === undefined ? null : String(v).replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n) || null);

/** Karma yazılımın kaydını yalnızca bilinen alanlara indirger. */
export function kayitTemizle(k) {
  if (!k || typeof k !== 'object') return null;
  const id = metin(k.id, 200); if (!id) return null;
  return {
    id, firma_kisaltma: metin(k.firma_kisaltma, 60), personel_eposta: metin(k.personel_eposta, 160), tarih: metin(k.tarih, 10),
    sure_dakika: k.sure_dakika === null || k.sure_dakika === undefined || k.sure_dakika === '' ? null : Number(k.sure_dakika),
    tur: metin(k.tur, 80), not: metin(k.not, 300), silindi: k.silindi === true || k.silindi === 'true' || k.silindi === 1,
  };
}
export function baslangicImleci(env, simdi) {
  const b = String(env.KARMA_BASLANGIC ?? '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(b)) return `${b}T00:00:00+03:00`;
  const d = new Date(simdi); d.setUTCMonth(d.getUTCMonth() - 1, 1);
  return `${d.toISOString().slice(0, 7)}-01T00:00:00+03:00`;
}

export async function isle(istek, b) {
  const cevap = (govde, durum = 200) => new Response(JSON.stringify(govde), { status: durum, headers: { ...CORS, 'content-type': 'application/json; charset=utf-8' } });
  if (istek.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (istek.method !== 'POST') return cevap({ ok: false, hata: 'Yalnızca POST desteklenir.' }, 405);
  const env = b.env;
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return cevap({ ok: false, hata: 'Sunucu ayarı eksik (SUPABASE_URL / SERVICE_ROLE).' }, 500);
  const db = b.istemci(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

  let org = null;
  const sirri = istek.headers.get('x-ozet-sirri');
  if (sirri) {
    if (!env.OZET_CRON_SIRRI || !esitMi(sirri, env.OZET_CRON_SIRRI)) return cevap({ ok: false, hata: 'Yetkisiz.' }, 401);
    const { data, error } = await db.from('organizations').select('id');
    if (error) return cevap({ ok: false, hata: 'Kurumlar okunamadı.' }, 500);
    const liste = (data ?? []).map((k) => k.id);
    org = env.KARMA_ORGANIZASYON ? liste.find((x) => x === env.KARMA_ORGANIZASYON) : (liste.length === 1 ? liste[0] : null);
    if (!org) return cevap({ ok: false, hata: 'Kurum belirlenemedi (birden fazla kurum varsa KARMA_ORGANIZASYON tanımlayın).' }, 500);
  } else {
    const yetki = istek.headers.get('authorization') ?? '';
    const belirtec = yetki.toLowerCase().startsWith('bearer ') ? yetki.slice(7).trim() : '';
    if (!belirtec) return cevap({ ok: false, hata: 'Oturum gerekli.' }, 401);
    const { data: kd, error: ke } = await db.auth.getUser(belirtec);
    if (ke || !kd?.user) return cevap({ ok: false, hata: 'Oturum geçersiz.' }, 401);
    const { data: u } = await db.from('users').select('organization_id, role_id, is_active').eq('id', kd.user.id).maybeSingle();
    if (!u || !u.is_active) return cevap({ ok: false, hata: 'Kullanıcı bulunamadı.' }, 403);
    const { data: p } = await db.from('role_permissions').select('can_create, can_edit').eq('role_id', u.role_id).eq('module', 'settings').maybeSingle();
    if (!p?.can_create || !p?.can_edit) return cevap({ ok: false, hata: 'Bu işlem için yetkiniz yok.' }, 403);
    org = u.organization_id;
  }

  const hata = async (mesaj) => { try { await db.rpc('karma_senkron_hata', { p_org: org, p_mesaj: mesaj }); } catch (_) { /* kayıt başarısız olsa da yanıt döner */ } return cevap({ ok: false, mesaj }); };
  const adres = String(env.KARMA_API_ADRES ?? '').trim(); const anahtar = String(env.KARMA_API_ANAHTARI ?? '').trim();
  if (!adres || !anahtar) return await hata('KARMA_API_ADRES ve KARMA_API_ANAHTARI gizli ayarları tanımlı değil.');
  let url; try { url = new URL(adres); } catch (_) { return await hata('KARMA_API_ADRES geçerli bir adres değil.'); }
  if (url.protocol !== 'https:') return await hata('KARMA_API_ADRES https ile başlamalıdır.');

  const { data: sen } = await db.from('karma_senkron').select('imlec').eq('organization_id', org).maybeSingle();
  let imlec = sen?.imlec || baslangicImleci(env, b.simdi());
  const toplam = {}; let sayfa = 0; let alinan = 0;
  while (sayfa < AZAMI_SAYFA) {
    sayfa++;
    const u = new URL(url); u.searchParams.set('since', imlec); u.searchParams.set('limit', String(SAYFA));
    let yanit;
    try {
      yanit = await b.fetch(u.toString(), { method: 'GET', headers: { authorization: `Bearer ${anahtar}`, accept: 'application/json' }, signal: AbortSignal.timeout(ZAMAN_ASIMI_MS) });
    } catch (_) { return await hata('Karma OSGB yazılımına ulaşılamadı (bağlantı veya zaman aşımı).'); }
    if (yanit.status === 401 || yanit.status === 403) return await hata('Karma OSGB yazılımı anahtarı reddetti; KARMA_API_ANAHTARI değerini kontrol edin.');
    if (!yanit.ok) return await hata(`Karma OSGB yazılımı hata verdi (${yanit.status}).`);
    let govde; try { govde = await yanit.json(); } catch (_) { return await hata('Karma OSGB yanıtı JSON değil.'); }
    if (!govde || !Array.isArray(govde.kayitlar)) return await hata('Karma OSGB yanıtında "kayitlar" listesi yok.');
    const kayitlar = govde.kayitlar.slice(0, SAYFA).map(kayitTemizle).filter(Boolean);
    const sonraki = typeof govde.sonraki === 'string' && govde.sonraki ? govde.sonraki : imlec;
    const { data: sonuc, error } = await db.rpc('karma_ziyaret_isle', { p_org: org, p_kayitlar: kayitlar, p_imlec: sonraki });
    if (error) return await hata(`Kayıtlar işlenemedi: ${String(error.message ?? '').slice(0, 150)}`);
    for (const [d, n] of Object.entries(sonuc ?? {})) toplam[d] = (toplam[d] ?? 0) + Number(n);
    alinan += kayitlar.length;
    if (govde.kayitlar.length < SAYFA || sonraki === imlec) break;
    imlec = sonraki;
  }
  // Kısaltma/e-posta bu arada düzeltildiyse bekleyenleri de yeniden dene
  try { const { data: yeni } = await db.rpc('karma_eslesmeyenleri_yeniden_dene', { p_org: org }); for (const [d, n] of Object.entries(yeni ?? {})) toplam[`tekrar_${d}`] = Number(n); } catch (_) { /* sonraki çalışmada denenir */ }
  const islendi = toplam.islendi ?? 0; const bekleyen = toplam.eslesmedi ?? 0;
  return cevap({ ok: true, mesaj: alinan ? `${alinan} kayıt alındı; ${islendi} ziyaret işlendi${bekleyen ? `, ${bekleyen} kayıt eşleşmedi` : ''}.` : 'Yeni ziyaret kaydı yok.', sonuc: toplam });
}

if (typeof Deno !== 'undefined' && typeof Deno.serve === 'function') {
  const { createClient } = await import('npm:@supabase/supabase-js@2');
  Deno.serve((istek) => isle(istek, {
    env: Deno.env.toObject(),
    fetch: (...a) => fetch(...a),
    istemci: (url, anahtar) => createClient(url, anahtar, { auth: { persistSession: false, autoRefreshToken: false } }),
    simdi: () => Date.now(),
  }));
}
