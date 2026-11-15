// Karma OSGB ziyaret çekme (Edge Function) testleri: sahte veritabanı ve sahte Karma API ile.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const gecici = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'karma-')), 'index.mjs');
fs.copyFileSync(new URL('../supabase/functions/karma-ziyaret-cekme/index.ts', import.meta.url), gecici);
const { isle, kayitTemizle, baslangicImleci, esitMi } = await import(pathToFileURL(gecici).href);

function kur({ env = {}, imlec = null, apiYanit = null, rpcHata = null, izin = { can_create: true, can_edit: true }, kurumlar = [{ id: 'o1' }] } = {}) {
  const rpcler = []; const istekler = [];
  const ortam = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'srv', OZET_CRON_SIRRI: 'sirli', KARMA_API_ADRES: 'https://karma.example.com/api/ziyaretler', KARMA_API_ANAHTARI: 'gizli-anahtar', ...env };
  const db = {
    auth: { getUser: async (t) => (t === 'gecerli' ? { data: { user: { id: 'u1' } }, error: null } : { data: { user: null }, error: { message: 'bad' } }) },
    from(tablo) {
      const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: tablo === 'karma_senkron' ? (imlec ? { imlec } : null) : tablo === 'users' ? { organization_id: 'o1', role_id: 'r1', is_active: true } : izin }),
        then: (coz) => coz({ data: kurumlar, error: null }) };
      return q;
    },
    rpc: async (ad, arg) => { rpcler.push([ad, arg]); if (rpcHata && ad === 'karma_ziyaret_isle') return { data: null, error: { message: rpcHata } }; return { data: ad === 'karma_ziyaret_isle' ? { islendi: arg.p_kayitlar.length } : {}, error: null }; },
  };
  const sayfalar = Array.isArray(apiYanit) ? [...apiYanit] : [apiYanit ?? { kayitlar: [], sonraki: 'x' }];
  const b = { env: ortam, simdi: () => Date.UTC(2026, 10, 15), istemci: () => db,
    fetch: async (url, init) => { istekler.push({ url, init }); const y = sayfalar.length > 1 ? sayfalar.shift() : sayfalar[0]; if (y instanceof Error) throw y; if (typeof y === 'number') return new Response('x', { status: y }); return new Response(JSON.stringify(y), { status: 200 }); } };
  return { b, rpcler, istekler };
}
const cron = (govde = {}) => new Request('https://f.test/', { method: 'POST', headers: { 'x-ozet-sirri': 'sirli', 'content-type': 'application/json' }, body: JSON.stringify(govde) });
const K = (id, ek = {}) => ({ id, firma_kisaltma: 'EGE', personel_eposta: 'a@b.com', tarih: '2026-11-10', sure_dakika: 60, ...ek });

test('yardımcılar: kayıt temizleme, başlangıç, sabit süreli karşılaştırma', () => {
  assert.equal(kayitTemizle({ firma_kisaltma: 'x' }), null); assert.equal(kayitTemizle(null), null);
  const t = kayitTemizle({ id: 5, firma_kisaltma: ' EGE\n', sure_dakika: '45', silindi: 'true', fazlalik: 'x', not: 'a'.repeat(999) });
  assert.equal(t.id, '5'); assert.equal(t.firma_kisaltma, 'EGE'); assert.equal(t.sure_dakika, 45); assert.equal(t.silindi, true); assert.equal(t.fazlalik, undefined); assert.equal(t.not.length, 300);
  assert.equal(baslangicImleci({}, Date.UTC(2026, 10, 15)), '2026-10-01T00:00:00+03:00'); assert.equal(baslangicImleci({ KARMA_BASLANGIC: '2026-01-05' }, 0), '2026-01-05T00:00:00+03:00');
  assert.equal(esitMi('a', 'a'), true); assert.equal(esitMi('a', 'b'), false);
});

test('yetkisiz çağrılar reddedilir', async () => {
  let { b } = kur(); let c = await isle(new Request('https://f.test/', { method: 'POST', headers: { 'x-ozet-sirri': 'yanlis' } }), b); assert.equal(c.status, 401);
  ({ b } = kur()); c = await isle(new Request('https://f.test/', { method: 'POST' }), b); assert.equal(c.status, 401);
  ({ b } = kur({ izin: { can_create: false, can_edit: true } })); c = await isle(new Request('https://f.test/', { method: 'POST', headers: { authorization: 'Bearer gecerli' } }), b); assert.equal(c.status, 403);
  ({ b } = kur()); c = await isle(new Request('https://f.test/', { method: 'GET' }), b); assert.equal(c.status, 405);
});

test('zamanlanmış çekim: anahtar başlıkla gider, kayıtlar temizlenip işlenir, imleç ilerler', async () => {
  const { b, rpcler, istekler } = kur({ apiYanit: { kayitlar: [K('1'), { yok: true }, K('2', { silindi: true })], sonraki: '2026-11-12T10:00:00Z' } });
  const c = await isle(cron(), b); const j = await c.json();
  assert.equal(j.ok, true); assert.match(j.mesaj, /2 kayıt alındı; 2 ziyaret işlendi/);
  assert.equal(istekler[0].init.headers.authorization, 'Bearer gizli-anahtar');
  assert.ok(istekler[0].url.includes('since=2026-10-01') && istekler[0].url.includes('limit=500'));
  const isleme = rpcler.find((r) => r[0] === 'karma_ziyaret_isle'); assert.equal(isleme[1].p_kayitlar.length, 2); assert.equal(isleme[1].p_imlec, '2026-11-12T10:00:00Z');
  assert.ok(!JSON.stringify(j).includes('gizli-anahtar'), 'anahtar yanıtta yok');
  assert.ok(rpcler.some((r) => r[0] === 'karma_eslesmeyenleri_yeniden_dene'));
});

test('kayıtlı imleçten devam eder; tam sayfa gelirse sonraki sayfayı da alır', async () => {
  const tam = Array.from({ length: 500 }, (_, i) => K(`k${i}`));
  const { b, istekler, rpcler } = kur({ imlec: 'IMLEC-1', apiYanit: [{ kayitlar: tam, sonraki: 'IMLEC-2' }, { kayitlar: [K('son')], sonraki: 'IMLEC-3' }] });
  const j = await (await isle(cron(), b)).json();
  assert.ok(istekler[0].url.includes('since=IMLEC-1')); assert.ok(istekler[1].url.includes('since=IMLEC-2')); assert.equal(istekler.length, 2);
  assert.match(j.mesaj, /501 kayıt alındı/); assert.equal(rpcler.filter((r) => r[0] === 'karma_ziyaret_isle').length, 2);
});

test('hatalar Türkçe mesajla kaydedilir', async () => {
  for (const [kur_, bekle] of [
    [{ env: { KARMA_API_ANAHTARI: '' } }, /gizli ayarları tanımlı değil/], [{ env: { KARMA_API_ADRES: 'http://x.test/a' } }, /https/],
    [{ apiYanit: 401 }, /anahtarı reddetti/], [{ apiYanit: 500 }, /hata verdi \(500\)/], [{ apiYanit: new Error('ag') }, /ulaşılamadı/],
    [{ apiYanit: { yanlis: 1 } }, /kayitlar/], [{ apiYanit: { kayitlar: [K('1')], sonraki: 'x' }, rpcHata: 'boom' }, /işlenemedi/],
  ]) {
    const { b, rpcler } = kur(kur_); const j = await (await isle(cron(), b)).json();
    assert.equal(j.ok, false); assert.match(j.mesaj, bekle);
    assert.ok(rpcler.some((r) => r[0] === 'karma_senkron_hata'), 'hata kaydı yazıldı');
  }
});

test('birden fazla kurum varsa KARMA_ORGANIZASYON gerekir', async () => {
  const iki = [{ id: 'o1' }, { id: 'o2' }];
  let { b } = kur({ kurumlar: iki }); assert.equal((await isle(cron(), b)).status, 500);
  ({ b } = kur({ kurumlar: iki, env: { KARMA_ORGANIZASYON: 'o2' } })); assert.equal((await isle(cron(), b)).status, 200);
});

test('elle çekim: yetkili kullanıcı oturumuyla çalışır', async () => {
  const { b } = kur(); const c = await isle(new Request('https://f.test/', { method: 'POST', headers: { authorization: 'Bearer gecerli' } }), b);
  assert.equal(c.status, 200); assert.equal((await c.json()).ok, true);
});
