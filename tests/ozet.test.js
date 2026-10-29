// Günlük özet e-postası (Edge Function) testleri: sahte veritabanı ve sahte Resend ile, Deno gerektirmeden.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const kaynak = new URL('../supabase/functions/gunluk-ozet/index.ts', import.meta.url);
const gecici = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ozet-')), 'index.mjs');
fs.copyFileSync(kaynak, gecici);
const m = await import(pathToFileURL(gecici).href);
const { isle, ozetKonu, ozetMetni, ozetHtml, ozetBos, ozetBolumleri, esc, para, tarih, maskele } = m;

const OZET = {
  tarih: '2026-10-29',
  gecikmis_fatura: { adet: 12, toplam: 5000.5, liste: Array.from({ length: 10 }, (_, i) => ({ no: `F-${i + 1}`, firma: i === 0 ? '<b>Alfa</b> & "Ortak"' : `Firma ${i}`, vade: '2026-09-01', kalan: 100 + i, gun: 58, isaret: i === 1 ? 'itirazli' : null })) },
  yaklasan_vade: { adet: 1, toplam: 300, liste: [{ no: 'F-9', firma: 'Delta', vade: '2026-10-29', kalan: 300, gun: 0, isaret: null }] },
  sozlesme: { adet: 2, liste: [{ firma: 'Gama', bitis: '2026-10-28', kalan_gun: -1 }, { firma: 'Epsilon', bitis: '2026-11-28', kalan_gun: 30 }] },
  gorev: { adet: 1, liste: [{ baslik: 'Ara', firma: null, son: '2026-10-28', oncelik: 'yuksek', gecikmis: true }] },
};
const BOS = { tarih: '2026-10-29', gecikmis_fatura: { adet: 0, toplam: 0, liste: [] }, yaklasan_vade: { adet: 0, toplam: 0, liste: [] }, sozlesme: { adet: 0, liste: [] }, gorev: { adet: 0, liste: [] } };

test('biçim yardımcıları', () => {
  assert.equal(para(1234.5), '1.234,50 TL'); assert.equal(para(0), '0,00 TL'); assert.equal(para(null), '0,00 TL');
  assert.equal(tarih('2026-10-29'), '29.10.2026'); assert.equal(tarih(null), ''); assert.equal(tarih('x'), '');
  assert.equal(esc(`<a href="x">&'`), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;');
  assert.equal(maskele('sahip@gmail.com'), 's***@gmail.com');
});

test('konu: yalnızca dolu bölümler, test öneki, boş özet', () => {
  assert.equal(ozetKonu(OZET), 'OSGB 360 özet — 12 gecikmiş fatura, 1 yaklaşan vade, 2 sözleşme, 1 görev');
  assert.equal(ozetKonu(OZET, true).startsWith('[TEST] '), true);
  assert.equal(ozetKonu(BOS), 'OSGB 360 özet: bildirilecek kayıt yok');
  assert.equal(ozetKonu({ ...BOS, gorev: OZET.gorev }), 'OSGB 360 özet — 1 görev');
  assert.equal(ozetBos(BOS), true); assert.equal(ozetBos(OZET), false); assert.equal(ozetBos({}), true); assert.equal(ozetBos(null), true);
});

test('metin ve HTML: içerik, "ve N daha", gecikme/kalan gün yazımı, bağlantılar', () => {
  const t = ozetMetni(OZET, 'https://ornek.test/app/');
  for (const s of ['29.10.2026', 'Vadesi geçmiş faturalar: 12 adet, toplam 5.000,50 TL', 'F-2 · Firma 1 · vade 01.09.2026 (58 gün gecikmiş) · 101,00 TL · itirazlı', '… ve 2 kayıt daha',
    'bugün', '1 gün önce doldu', '30 gün kaldı', 'Ara · son tarih 28.10.2026 (gecikmiş) · öncelik yüksek', 'https://ornek.test/app/#/tahsilat', 'müşterilere gönderilmez']) assert.ok(t.includes(s), s);
  assert.equal(ozetMetni(BOS).includes('bildirilecek bir kayıt yok'), true);
  const h = ozetHtml(OZET, 'https://ornek.test/app/');
  assert.ok(h.includes('&lt;b&gt;Alfa&lt;/b&gt; &amp; &quot;Ortak&quot;'), 'firma adı kaçırıldı');
  assert.ok(!h.includes('<b>Alfa</b>'), 'ham etiket yok');
  assert.ok(h.includes('href="https://ornek.test/app/#/sozlesmeler"'));
  assert.equal(ozetBolumleri(OZET).length, 4);
  const kotu = ozetHtml({ ...BOS, gorev: { adet: 1, liste: [{ baslik: '"><script>alert(1)</script>', firma: null, son: '2026-10-29', oncelik: 'orta', gecikmis: false }] } }, 'https://a.test/"onmouseover="x/');
  assert.ok(!kotu.includes('<script>')); assert.ok(!kotu.includes('"onmouseover="'), 'adres kaçırıldı');
});

// ---------------------------------------------------------------- sahte altyapı
function kur({ env = {}, kurumlar = [{ id: 'o1' }], ozet = OZET, rpcHata = null, loglar = [], kullanici = { organization_id: 'o1', role_id: 'r1', is_active: true }, izin = { can_create: true, can_edit: true }, resend = { ok: true, status: 200, govde: '{}' }, resendHata = false } = {}) {
  const cagrilar = []; const ortam = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'srv', RESEND_API_KEY: 're_gizli', OZET_ALICI: 'sahip@gmail.com', OZET_CRON_SIRRI: 'sirli', ...env };
  const db = {
    auth: { getUser: async (t) => (t === 'gecerli' ? { data: { user: { id: 'u1' } }, error: null } : { data: { user: null }, error: { message: 'bad' } }) },
    from(tablo) {
      const f = []; let ekle = null; let tek = false;
      const q = { select: () => q, eq: (k, v) => { f.push([k, v]); return q; }, limit: () => q, maybeSingle: () => { tek = true; return q; },
        insert: async (satir) => { ekle = satir; loglar.push(satir); return { error: null }; },
        then: (res) => {
          let veri;
          if (tablo === 'organizations') veri = kurumlar;
          else if (tablo === 'users') veri = kullanici ? [kullanici] : [];
          else if (tablo === 'role_permissions') veri = izin ? [izin] : [];
          else veri = loglar.filter((l) => f.every(([k, v]) => l[k] === v));
          res({ data: tek ? (veri[0] ?? null) : veri, error: null });
        } };
      return q;
    },
    rpc: async (ad, args) => { cagrilar.push(['rpc', ad, args]); return rpcHata ? { data: null, error: { message: rpcHata } } : { data: ozet, error: null }; },
  };
  const b = {
    env: ortam, simdi: () => Date.parse('2026-10-29T05:00:00Z'), istemci: () => db,
    fetch: async (url, ayar) => { cagrilar.push(['fetch', url, ayar]); if (resendHata) throw new Error('ağ'); return { ok: resend.ok, status: resend.status, text: async () => resend.govde }; },
  };
  return { b, cagrilar, loglar };
}
const istek = (basliklar = {}, yontem = 'POST') => new Request('https://x.supabase.co/functions/v1/gunluk-ozet', { method: yontem, headers: basliklar, body: yontem === 'POST' ? '{}' : undefined });
const json = async (r) => ({ durum: r.status, ...(await r.json()) });
const gonderimler = (c) => c.filter((x) => x[0] === 'fetch');

test('yetkisiz çağrılar: başlıksız 401, yanlış sır 401, geçersiz oturum 401, GET 405; hiçbiri e-posta göndermez', async () => {
  const s = kur();
  assert.equal((await json(await isle(istek(), s.b))).durum, 401);
  assert.equal((await json(await isle(istek({ 'x-ozet-sirri': 'yanlis' }), s.b))).durum, 401);
  assert.equal((await json(await isle(istek({ authorization: 'Bearer kotu' }), s.b))).durum, 401);
  assert.equal((await json(await isle(istek({}, 'GET'), s.b))).durum, 405);
  assert.equal((await json(await isle(istek({ 'x-ozet-sirri': 'sirli' }), kur({ env: { OZET_CRON_SIRRI: '' } }).b))).durum, 401, 'sunucuda sır tanımsızsa kapı kapalı');
  assert.equal(gonderimler(s.cagrilar).length, 0);
  const cors = await isle(istek({}, 'OPTIONS'), s.b);
  assert.equal(cors.status, 204);
});

test('zamanlanmış: veri varsa tek alıcıya gönderir, kayıt tutar; API anahtarı yanıtta yok', async () => {
  const s = kur();
  const r = await json(await isle(istek({ 'x-ozet-sirri': 'sirli' }), s.b));
  assert.equal(r.durum, 200); assert.equal(r.ok, true);
  const g = gonderimler(s.cagrilar); assert.equal(g.length, 1);
  assert.equal(g[0][1], 'https://api.resend.com/emails');
  assert.equal(g[0][2].headers.authorization, 'Bearer re_gizli');
  const govde = JSON.parse(g[0][2].body);
  assert.deepEqual(govde.to, ['sahip@gmail.com']);
  assert.equal(govde.from, 'OSGB 360 <onboarding@resend.dev>');
  assert.equal(govde.subject, ozetKonu(OZET)); assert.ok(govde.html.includes('Vadesi geçmiş')); assert.ok(govde.text.includes('Vadesi geçmiş'));
  assert.equal(s.loglar.length, 1);
  assert.deepEqual([s.loglar[0].organization_id, s.loglar[0].gun, s.loglar[0].tur, s.loglar[0].durum], ['o1', '2026-10-29', 'gunluk', 'gonderildi']);
  assert.ok(!JSON.stringify(r).includes('re_gizli') && !JSON.stringify(s.loglar).includes('re_gizli'));
  assert.ok(!JSON.stringify(r).includes('sahip@gmail.com'), 'adres maskeli döner');
});

test('zamanlanmış: aynı gün ikinci çağrıda yeniden göndermez; ertesi gün gönderir', async () => {
  const s = kur();
  await isle(istek({ 'x-ozet-sirri': 'sirli' }), s.b);
  const r2 = await json(await isle(istek({ 'x-ozet-sirri': 'sirli' }), s.b));
  assert.equal(gonderimler(s.cagrilar).length, 1); assert.equal(r2.sonuclar[0].durum, 'atlandi');
  s.b.simdi = () => Date.parse('2026-10-30T05:00:00Z');
  await isle(istek({ 'x-ozet-sirri': 'sirli' }), s.b);
  assert.equal(gonderimler(s.cagrilar).length, 2);
});

test('zamanlanmış: bildirilecek kayıt yoksa gönderilmez (atlandı kaydı)', async () => {
  const s = kur({ ozet: BOS });
  const r = await json(await isle(istek({ 'x-ozet-sirri': 'sirli' }), s.b));
  assert.equal(r.ok, true); assert.equal(gonderimler(s.cagrilar).length, 0);
  assert.deepEqual([s.loglar[0].durum, s.loglar[0].tur], ['atlandi', 'gunluk']);
});

test('zamanlanmış: birden çok kurum için ayrı özet; biri hata verse diğeri gider', async () => {
  const s = kur({ kurumlar: [{ id: 'o1' }, { id: 'o2' }] });
  const asil = s.b.istemci;
  s.b.istemci = () => { const d = asil(); const rpc = d.rpc; d.rpc = async (ad, a) => (a.p_org === 'o1' ? { data: null, error: { message: 'patladı' } } : rpc(ad, a)); return d; };
  const r = await json(await isle(istek({ 'x-ozet-sirri': 'sirli' }), s.b));
  assert.equal(r.ok, false);
  assert.deepEqual(r.sonuclar.map((x) => x.durum), ['hata', 'gonderildi']);
  assert.equal(gonderimler(s.cagrilar).length, 1);
});

test('test modu: oturum + ayarlar izni gerekir; boş özet de gönderilir; günlük kayıt kuralını etkilemez', async () => {
  const s = kur({ ozet: BOS });
  const r = await json(await isle(istek({ authorization: 'Bearer gecerli' }), s.b));
  assert.equal(r.durum, 200); assert.equal(r.ok, true);
  const g = gonderimler(s.cagrilar); assert.equal(g.length, 1);
  assert.ok(JSON.parse(g[0][2].body).subject.startsWith('[TEST] '));
  assert.deepEqual([s.loglar[0].tur, s.loglar[0].durum], ['test', 'gonderildi']);
  // test, günlük gönderimi engellemez; tekrar test de gönderir
  await isle(istek({ authorization: 'Bearer gecerli' }), s.b);
  assert.equal(gonderimler(s.cagrilar).length, 2);
  // yalnızca kendi kurumu
  assert.deepEqual(s.cagrilar.filter((x) => x[0] === 'rpc').map((x) => x[2].p_org), ['o1', 'o1']);
});

test('test modu: izni olmayan, pasif veya kayıtsız kullanıcı reddedilir', async () => {
  for (const ayar of [{ izin: { can_create: false, can_edit: true } }, { izin: { can_create: true, can_edit: false } }, { izin: null }, { kullanici: { organization_id: 'o1', role_id: 'r1', is_active: false } }, { kullanici: null }]) {
    const s = kur(ayar);
    const r = await json(await isle(istek({ authorization: 'Bearer gecerli' }), s.b));
    assert.equal(r.durum, 403, JSON.stringify(ayar)); assert.equal(gonderimler(s.cagrilar).length, 0);
  }
});

test('yapılandırma eksik/yanlış: gönderilmez, anlaşılır mesaj ve hata kaydı', async () => {
  for (const [env, beklenen] of [[{ RESEND_API_KEY: '' }, 'RESEND_API_KEY'], [{ OZET_ALICI: '' }, 'OZET_ALICI tanımlı değil'], [{ OZET_ALICI: 'a@b.com, c@d.com' }, 'tek bir geçerli'], [{ OZET_ALICI: 'yanlis' }, 'tek bir geçerli'], [{ OZET_ALICI: 'a@b.com;c@d.com' }, 'tek bir geçerli']]) {
    const s = kur({ env });
    const r = await json(await isle(istek({ 'x-ozet-sirri': 'sirli' }), s.b));
    assert.equal(r.ok, false); assert.ok(r.mesaj.includes(beklenen), r.mesaj); assert.equal(gonderimler(s.cagrilar).length, 0);
    assert.equal(s.loglar[0].durum, 'hata');
  }
  const s = kur({ env: { SUPABASE_SERVICE_ROLE_KEY: '' } });
  assert.equal((await json(await isle(istek({ 'x-ozet-sirri': 'sirli' }), s.b))).durum, 500);
});

test('Resend hataları: 403 test adresi ipucu, 401 anahtar, ağ hatası; hata kaydı; anahtar sızmaz', async () => {
  let s = kur({ resend: { ok: false, status: 403, govde: '{"message":"You can only send testing emails to your own email address (x@y.com)."}' } });
  let r = await json(await isle(istek({ 'x-ozet-sirri': 'sirli' }), s.b));
  assert.equal(r.ok, false); assert.ok(r.mesaj.includes('Resend hesabınızın e-posta adresi')); assert.equal(s.loglar[0].durum, 'hata');
  s = kur({ resend: { ok: false, status: 401, govde: 'x' } });
  r = await json(await isle(istek({ 'x-ozet-sirri': 'sirli' }), s.b)); assert.ok(r.mesaj.includes('RESEND_API_KEY geçersiz'));
  s = kur({ resend: { ok: false, status: 500, govde: 're_gizli leak' } });
  r = await json(await isle(istek({ 'x-ozet-sirri': 'sirli' }), s.b)); assert.ok(r.mesaj.includes('500')); assert.ok(!JSON.stringify([r, s.loglar]).includes('re_gizli'));
  s = kur({ resendHata: true });
  r = await json(await isle(istek({ 'x-ozet-sirri': 'sirli' }), s.b)); assert.ok(r.mesaj.includes('ulaşılamadı'));
  // hata sonrası aynı gün yeniden denenir (başarılı kayıt yok)
  s = kur({ resend: { ok: false, status: 500, govde: 'x' } });
  await isle(istek({ 'x-ozet-sirri': 'sirli' }), s.b);
  s.b.fetch = async (u, a) => { s.cagrilar.push(['fetch', u, a]); return { ok: true, status: 200, text: async () => '' }; };
  const yeniden = await json(await isle(istek({ 'x-ozet-sirri': 'sirli' }), s.b));
  assert.equal(yeniden.ok, true);
});

test('özel gönderen adresi ve uygulama adresi ortamdan alınır', async () => {
  const s = kur({ env: { OZET_GONDEREN: 'Karma <ozet@karma.test>', OZET_UYGULAMA_ADRESI: 'https://karma.test/crm/' } });
  await isle(istek({ 'x-ozet-sirri': 'sirli' }), s.b);
  const g = JSON.parse(gonderimler(s.cagrilar)[0][2].body);
  assert.equal(g.from, 'Karma <ozet@karma.test>'); assert.ok(g.html.includes('https://karma.test/crm/#/tahsilat'));
});
