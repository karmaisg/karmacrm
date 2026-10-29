// @ts-nocheck
// OSGB 360 - Günlük özet e-postası (Supabase Edge Function). Alıcı YALNIZCA işletme sahibidir (tek, sabit adres).
//
// İki yoldan çalışır:
//   1) Zamanlanmış (pg_cron): "x-ozet-sirri" başlığı OZET_CRON_SIRRI ile aynıysa, her kurum için günde en çok bir özet gönderilir
//      (bildirilecek bir şey yoksa gönderilmez).
//   2) Test: Sistem ayarları sayfasındaki "Test e-postası gönder" düğmesi; oturum açmış, "ayarlar" izni olan kullanıcı gerekir.
//
// Gizli ayarlar (Supabase > Edge Functions > Secrets): RESEND_API_KEY, OZET_ALICI, OZET_CRON_SIRRI
// İsteğe bağlı: OZET_GONDEREN (varsayılan: "OSGB 360 <onboarding@resend.dev>"), OZET_UYGULAMA_ADRESI
// Müşterilere hiçbir mesaj gönderilmez; alıcı kodda değil, gizli ayardadır. API anahtarı hiçbir yerde kaydedilmez ya da geri döndürülmez.

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type, x-ozet-sirri',
  'access-control-allow-methods': 'POST, OPTIONS',
};
const VARSAYILAN_GONDEREN = 'OSGB 360 <onboarding@resend.dev>';
const VARSAYILAN_ADRES = 'https://karmaisg.github.io/karmacrm/';
const ALICI = /^[^\s@,;<>"']+@[^\s@,;<>"']+\.[^\s@,;<>"']+$/;

// ---------------------------------------------------------------- biçimlendirme
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
const NF = new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const para = (n) => `${NF.format(Number(n) || 0)} TL`;
export const tarih = (iso) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso ?? '')); return m ? `${m[3]}.${m[2]}.${m[1]}` : ''; };
const ONCELIK = { dusuk: 'düşük', orta: 'orta', yuksek: 'yüksek', kritik: 'kritik' };
const ISARET = { itirazli: 'itirazlı', takip_gerekiyor: 'takip gerekiyor' };
export const maskele = (e) => { const [a, d] = String(e).split('@'); return `${a.slice(0, 1)}***@${d}`; };

const bol = (o, k) => o?.[k] ?? { adet: 0, liste: [] };
export const ozetBos = (o) => ['gecikmis_fatura', 'yaklasan_vade', 'sozlesme', 'gorev'].every((k) => !(bol(o, k).adet > 0));

/** Bölümler: [{baslik, satirlar:[metin], fazla:n}] — hem düz metin hem HTML bunlardan üretilir. */
export function ozetBolumleri(o) {
  const b = [];
  const g = bol(o, 'gecikmis_fatura');
  if (g.adet > 0) {
    b.push({ baslik: `Vadesi geçmiş faturalar: ${g.adet} adet, toplam ${para(g.toplam)}`, baglanti: '#/tahsilat', fazla: g.adet - g.liste.length,
      satirlar: g.liste.map((x) => `${x.no} · ${x.firma} · vade ${tarih(x.vade)} (${x.gun} gün gecikmiş) · ${para(x.kalan)}${x.isaret ? ` · ${ISARET[x.isaret] ?? x.isaret}` : ''}`) });
  }
  const y = bol(o, 'yaklasan_vade');
  if (y.adet > 0) {
    b.push({ baslik: `7 gün içinde vadesi gelen faturalar: ${y.adet} adet, toplam ${para(y.toplam)}`, baglanti: '#/tahsilat', fazla: y.adet - y.liste.length,
      satirlar: y.liste.map((x) => `${x.no} · ${x.firma} · vade ${tarih(x.vade)} (${x.gun === 0 ? 'bugün' : `${x.gun} gün kaldı`}) · ${para(x.kalan)}`) });
  }
  const s = bol(o, 'sozlesme');
  if (s.adet > 0) {
    b.push({ baslik: `90 gün içinde biten sözleşmeler: ${s.adet} adet`, baglanti: '#/sozlesmeler', fazla: s.adet - s.liste.length,
      satirlar: s.liste.map((x) => `${x.firma} · bitiş ${tarih(x.bitis)} (${x.kalan_gun < 0 ? `${-x.kalan_gun} gün önce doldu` : x.kalan_gun === 0 ? 'bugün bitiyor' : `${x.kalan_gun} gün kaldı`})`) });
  }
  const t = bol(o, 'gorev');
  if (t.adet > 0) {
    b.push({ baslik: `Bugün ve gecikmiş görevler: ${t.adet} adet`, baglanti: '#/gorevler', fazla: t.adet - t.liste.length,
      satirlar: t.liste.map((x) => `${x.baslik}${x.firma ? ` · ${x.firma}` : ''} · son tarih ${tarih(x.son)}${x.gecikmis ? ' (gecikmiş)' : ' (bugün)'} · öncelik ${ONCELIK[x.oncelik] ?? x.oncelik}`) });
  }
  return b;
}

export function ozetKonu(o, test = false) {
  const p = [];
  const g = bol(o, 'gecikmis_fatura').adet; if (g > 0) p.push(`${g} gecikmiş fatura`);
  const y = bol(o, 'yaklasan_vade').adet; if (y > 0) p.push(`${y} yaklaşan vade`);
  const s = bol(o, 'sozlesme').adet; if (s > 0) p.push(`${s} sözleşme`);
  const t = bol(o, 'gorev').adet; if (t > 0) p.push(`${t} görev`);
  return `${test ? '[TEST] ' : ''}OSGB 360 özet${p.length ? ` — ${p.join(', ')}` : ': bildirilecek kayıt yok'}`;
}

export function ozetMetni(o, adres = VARSAYILAN_ADRES) {
  const b = ozetBolumleri(o);
  const govde = b.length
    ? b.map((x) => `${x.baslik}\n${x.satirlar.map((l) => `  - ${l}`).join('\n')}${x.fazla > 0 ? `\n  … ve ${x.fazla} kayıt daha` : ''}\n  Aç: ${adres}${x.baglanti}`).join('\n\n')
    : 'Bugün bildirilecek bir kayıt yok.';
  return `OSGB 360 özeti — ${tarih(o?.tarih)}\n\n${govde}\n\nBu e-posta yalnızca sizin için otomatik hazırlanmıştır; müşterilere gönderilmez.`;
}

export function ozetHtml(o, adres = VARSAYILAN_ADRES) {
  const b = ozetBolumleri(o);
  const govde = b.length
    ? b.map((x) => `<h3 style="margin:22px 0 8px;font-size:16px;color:#1f2937">${esc(x.baslik)}</h3>
<ul style="margin:0;padding-left:20px;color:#374151;font-size:14px;line-height:1.6">${x.satirlar.map((l) => `<li>${esc(l)}</li>`).join('')}${x.fazla > 0 ? `<li><em>… ve ${x.fazla} kayıt daha</em></li>` : ''}</ul>
<p style="margin:8px 0 0;font-size:13px"><a href="${esc(adres + x.baglanti)}" style="color:#c8312b">Uygulamada aç</a></p>`).join('\n')
    : '<p style="color:#374151;font-size:14px">Bugün bildirilecek bir kayıt yok.</p>';
  return `<!doctype html><html lang="tr"><body style="margin:0;padding:24px;background:#f6f2ef;font-family:Arial,Helvetica,sans-serif">
<div style="max-width:640px;margin:0 auto;background:#ffffff;border-radius:12px;padding:24px 28px">
<h2 style="margin:0 0 4px;font-size:20px;color:#111827">OSGB 360 özeti</h2><p style="margin:0;color:#6b7280;font-size:13px">${esc(tarih(o?.tarih))}</p>
${govde}
<p style="margin:28px 0 0;color:#9ca3af;font-size:12px">Bu e-posta yalnızca sizin için otomatik hazırlanmıştır; müşterilere gönderilmez.</p></div></body></html>`;
}

// ---------------------------------------------------------------- işleyici
const istanbulGunu = (ms) => new Date(ms).toLocaleDateString('sv-SE', { timeZone: 'Europe/Istanbul' });
const esitMi = (a, b) => { // sabit süreli karşılaştırma
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let f = 0; for (let i = 0; i < a.length; i += 1) f |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return f === 0;
};

/**
 * @param istek  Request
 * @param b      { env, fetch, istemci(url, anahtar), simdi() } — test için dışarıdan verilir
 */
export async function isle(istek, b) {
  const cevap = (govde, durum = 200) => new Response(JSON.stringify(govde), { status: durum, headers: { ...CORS, 'content-type': 'application/json; charset=utf-8' } });
  if (istek.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (istek.method !== 'POST') return cevap({ ok: false, hata: 'Yalnızca POST desteklenir.' }, 405);

  const env = b.env;
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return cevap({ ok: false, hata: 'Sunucu ayarı eksik (SUPABASE_URL / SERVICE_ROLE).' }, 500);
  const db = b.istemci(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

  // --- kim çağırıyor?
  let mod = null; let kurumlar = [];
  const sirri = istek.headers.get('x-ozet-sirri');
  if (sirri) {
    if (!env.OZET_CRON_SIRRI || !esitMi(sirri, env.OZET_CRON_SIRRI)) return cevap({ ok: false, hata: 'Yetkisiz.' }, 401);
    mod = 'gunluk';
    const { data, error } = await db.from('organizations').select('id');
    if (error) return cevap({ ok: false, hata: 'Kurumlar okunamadı.' }, 500);
    kurumlar = (data ?? []).map((k) => k.id);
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
    mod = 'test'; kurumlar = [u.organization_id];
  }

  // --- yapılandırma
  const anahtar = env.RESEND_API_KEY; const alici = String(env.OZET_ALICI ?? '').trim();
  const gonderen = env.OZET_GONDEREN || VARSAYILAN_GONDEREN; const adres = env.OZET_UYGULAMA_ADRESI || VARSAYILAN_ADRES;
  const gun = istanbulGunu(b.simdi());
  const kayit = async (org, durum, ayrinti) => {
    try { await db.from('email_digest_log').insert({ organization_id: org, gun, tur: mod, durum, ayrinti: String(ayrinti ?? '').slice(0, 300) }); } catch (_) { /* kayıt başarısız olsa da akış sürer */ }
  };
  const eksik = !anahtar ? 'RESEND_API_KEY tanımlı değil.' : !alici ? 'OZET_ALICI tanımlı değil.' : !ALICI.test(alici) ? 'OZET_ALICI tek bir geçerli e-posta adresi olmalıdır.' : null;
  if (eksik) {
    for (const org of kurumlar) await kayit(org, 'hata', eksik);
    return cevap({ ok: false, mesaj: eksik, sonuclar: kurumlar.map((k) => ({ kurum: k, durum: 'hata', ayrinti: eksik })) });
  }

  // --- her kurum için özet
  const sonuclar = [];
  for (const org of kurumlar) {
    if (mod === 'gunluk') {
      const { data: var_ } = await db.from('email_digest_log').select('id').eq('organization_id', org).eq('gun', gun).eq('tur', 'gunluk').eq('durum', 'gonderildi').limit(1);
      if (var_?.length) { sonuclar.push({ kurum: org, durum: 'atlandi', ayrinti: 'Bugün zaten gönderildi.' }); continue; }
    }
    const { data: ozet, error: oe } = await db.rpc('gunluk_ozet', { p_org: org });
    if (oe || !ozet) { const m = `Özet hazırlanamadı: ${oe?.message ?? 'veri yok'}`; await kayit(org, 'hata', m); sonuclar.push({ kurum: org, durum: 'hata', ayrinti: m }); continue; }
    if (mod === 'gunluk' && ozetBos(ozet)) { await kayit(org, 'atlandi', 'Bildirilecek kayıt yok.'); sonuclar.push({ kurum: org, durum: 'atlandi', ayrinti: 'Bildirilecek kayıt yok.' }); continue; }
    let yanit;
    try {
      yanit = await b.fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { authorization: `Bearer ${anahtar}`, 'content-type': 'application/json' },
        body: JSON.stringify({ from: gonderen, to: [alici], subject: ozetKonu(ozet, mod === 'test'), html: ozetHtml(ozet, adres), text: ozetMetni(ozet, adres) }),
      });
    } catch (e) {
      const m = 'E-posta servisine ulaşılamadı.'; await kayit(org, 'hata', m); sonuclar.push({ kurum: org, durum: 'hata', ayrinti: m }); continue;
    }
    if (yanit.ok) { await kayit(org, 'gonderildi', `Gönderildi: ${maskele(alici)}`); sonuclar.push({ kurum: org, durum: 'gonderildi', ayrinti: `Gönderildi: ${maskele(alici)}` }); continue; }
    const govde = (await yanit.text().catch(() => '')).slice(0, 200);
    const ipucu = yanit.status === 403 && /testing emails to your own/i.test(govde)
      ? 'Resend hesabınızın e-posta adresi ile OZET_ALICI aynı olmalıdır (kendi alan adınızı doğrulamadıkça yalnızca hesap adresine gönderilebilir).'
      : yanit.status === 401 ? 'RESEND_API_KEY geçersiz görünüyor.' : `E-posta servisi hata verdi (${yanit.status}).`;
    await kayit(org, 'hata', ipucu); sonuclar.push({ kurum: org, durum: 'hata', ayrinti: ipucu });
  }
  const gonderilen = sonuclar.filter((s) => s.durum === 'gonderildi').length; const hata = sonuclar.find((s) => s.durum === 'hata');
  const mesaj = hata ? hata.ayrinti : gonderilen ? `${mod === 'test' ? 'Test e-postası' : 'Özet'} gönderildi: ${maskele(alici)}` : (sonuclar[0]?.ayrinti ?? 'Gönderilecek bir şey yok.');
  return cevap({ ok: !hata, mesaj, sonuclar });
}

// ---------------------------------------------------------------- Deno başlatma (Node/test ortamında çalışmaz)
if (typeof Deno !== 'undefined' && typeof Deno.serve === 'function') {
  const { createClient } = await import('npm:@supabase/supabase-js@2');
  Deno.serve((istek) => isle(istek, {
    env: Deno.env.toObject(),
    fetch: (...a) => fetch(...a),
    istemci: (url, anahtar) => createClient(url, anahtar, { auth: { persistSession: false, autoRefreshToken: false } }),
    simdi: () => Date.now(),
  }));
}
