import test from 'node:test';
import assert from 'node:assert/strict';
import { AYAR_TANIMLARI, ayarTanimi, sayiAyristir, ayarDogrula, kuralDakikaDogrula, baslangicSecenekleri, ayarDurumu, kuralDurumlari, degisiklikGecmisi } from '../src/lib/ayarlar.js';

const BUGUN = '2026-10-29';
const t = (a) => ayarTanimi(a);

test('sayı ayrıştırma: virgül, nokta, binlik ayırıcı, geçersizler', () => {
  assert.equal(sayiAyristir('22,5'), 22.5);
  assert.equal(sayiAyristir('22.5'), 22.5);
  assert.equal(sayiAyristir('11.700'), 11700);
  assert.equal(sayiAyristir('1.234.567'), 1234567);
  assert.equal(sayiAyristir(' 20 '), 20);
  assert.equal(sayiAyristir('0'), 0);
  for (const k of ['', '  ', 'abc', '1,2,3', '-5', '1e3', '12%', null, undefined]) assert.ok(Number.isNaN(sayiAyristir(k)), String(k));
});

test('ayar doğrulama: aralık, tam sayı, mesajlar', () => {
  assert.deepEqual(ayarDogrula(t('kapasite_dakika'), '11.700'), { deger: 11700 });
  assert.match(ayarDogrula(t('kapasite_dakika'), '59').hata, /60 ile 44640/);
  assert.match(ayarDogrula(t('kapasite_dakika'), '50000').hata, /arasında/);
  assert.match(ayarDogrula(t('kapasite_dakika'), '11700,5').hata, /tam sayı/);
  assert.deepEqual(ayarDogrula(t('kurumlar_vergisi_orani'), '22,5'), { deger: 22.5 });
  assert.match(ayarDogrula(t('kurumlar_vergisi_orani'), '101').hata, /0 ile 100/);
  assert.match(ayarDogrula(t('marj_esigi_yuzde'), 'yirmi').hata, /sayı olmalıdır/);
  assert.deepEqual(ayarDogrula(t('varsayilan_kdv_orani'), '0'), { deger: 0 });
  assert.match(ayarDogrula(t('varsayilan_kdv_orani'), '').hata, /sayı olmalıdır/);
});

test('kural dakikası doğrulama', () => {
  assert.deepEqual(kuralDakikaDogrula('25'), { deger: 25 });
  assert.deepEqual(kuralDakikaDogrula('7,5'), { deger: 7.5 });
  assert.deepEqual(kuralDakikaDogrula('0'), { deger: 0 });
  assert.match(kuralDakikaDogrula('601').hata, /0 ile 600/);
  assert.match(kuralDakikaDogrula('x').hata, /sayı olmalıdır/);
});

test('başlangıç seçenekleri bu aydan başlar, yıl dönümünü aşar', () => {
  const l = baslangicSecenekleri(BUGUN);
  assert.equal(l.length, 13);
  assert.equal(l[0], '2026-10-01'); assert.equal(l[1], '2026-11-01'); assert.equal(l[3], '2027-01-01'); assert.equal(l[12], '2027-10-01');
  assert.ok(l.every((x) => x.endsWith('-01')));
});

const ayarlar = [
  { key: 'kapasite_dakika', value: 11700, valid_from: '2000-01-01' },
  { key: 'kapasite_dakika', value: 10000, valid_from: '2026-09-01' },
  { key: 'kapasite_dakika', value: 9000, valid_from: '2026-12-01' },
  { key: 'kapasite_dakika', value: 9500, valid_from: '2026-11-01' },
  { key: 'marj_esigi_yuzde', value: 20, valid_from: '2000-01-01' },
];
test('ayar durumu: geçerli, planlanan (en yakın ileri tarih), geçmiş sıralaması, varsayılan', () => {
  const d = ayarDurumu(ayarlar, t('kapasite_dakika'), BUGUN);
  assert.deepEqual(d.gecerli, { deger: 10000, baslangic: '2026-09-01', varsayilan: false });
  assert.deepEqual(d.planli, { deger: 9500, baslangic: '2026-11-01' });
  assert.deepEqual(d.gecmis.map((x) => x.baslangic), ['2026-12-01', '2026-11-01', '2026-09-01', '2000-01-01']);
  const m = ayarDurumu(ayarlar, t('marj_esigi_yuzde'), BUGUN);
  assert.equal(m.planli, null); assert.equal(m.gecerli.deger, 20);
  const v = ayarDurumu([], t('kurumlar_vergisi_orani'), BUGUN);
  assert.deepEqual(v.gecerli, { deger: 25, baslangic: null, varsayilan: true });
  assert.deepEqual(v.gecmis, []);
  // bugün başlayan ayar geçerlidir
  assert.equal(ayarDurumu([{ key: 'marj_esigi_yuzde', value: 33, valid_from: BUGUN }], t('marj_esigi_yuzde'), BUGUN).gecerli.deger, 33);
});

const kurallar = [
  { staff_type: 'is_guvenligi_uzmani', hazard_class: 'tehlikeli', minutes_per_employee: 20, valid_from: '2000-01-01', valid_to: '2026-10-31' },
  { staff_type: 'is_guvenligi_uzmani', hazard_class: 'tehlikeli', minutes_per_employee: 25, valid_from: '2026-11-01', valid_to: null },
  { staff_type: 'isyeri_hekimi', hazard_class: 'az_tehlikeli', minutes_per_employee: 5, valid_from: '2000-01-01', valid_to: null, note: 'x' },
];
test('kural durumları: 6 hücre, geçerli ve planlanan kural', () => {
  const d = kuralDurumlari(kurallar, BUGUN);
  assert.equal(Object.keys(d).length, 6);
  assert.equal(d['is_guvenligi_uzmani|tehlikeli'].gecerli.minutes_per_employee, 20);
  assert.equal(d['is_guvenligi_uzmani|tehlikeli'].planli.minutes_per_employee, 25);
  assert.equal(d['is_guvenligi_uzmani|tehlikeli'].adet, 2);
  assert.equal(d['isyeri_hekimi|az_tehlikeli'].gecerli.minutes_per_employee, 5);
  assert.equal(d['isyeri_hekimi|az_tehlikeli'].planli, null);
  assert.deepEqual(d['isyeri_hekimi|cok_tehlikeli'], { gecerli: null, planli: null, adet: 0 });
  // ileri tarihte planlanan geçerli olur
  assert.equal(kuralDurumlari(kurallar, '2026-11-01')['is_guvenligi_uzmani|tehlikeli'].gecerli.minutes_per_employee, 25);
});

test('değişiklik geçmişi: ayar ve kurallar tek listede, yeniden eskiye; bilinmeyen anahtar yok sayılır', () => {
  const g = degisiklikGecmisi([...ayarlar, { key: 'yenileme_uyari_gunleri', value: [90], valid_from: '2030-01-01' }], kurallar,
    { turAdi: { is_guvenligi_uzmani: 'Uzman', isyeri_hekimi: 'Hekim' }, tehlikeAdi: { tehlikeli: 'Tehlikeli', az_tehlikeli: 'Az tehlikeli' } });
  assert.equal(g.length, ayarlar.length + kurallar.length);
  assert.deepEqual(g.map((x) => x.baslangic), [...g.map((x) => x.baslangic)].sort().reverse());
  assert.equal(g[0].baslangic, '2026-12-01');
  const k = g.find((x) => x.tur === 'kural' && x.deger === 20);
  assert.deepEqual([k.ad, k.bitis, k.birim], ['Uzman · Tehlikeli', '2026-10-31', 'dk/çalışan']);
  assert.equal(g.find((x) => x.not === 'x').ad, 'Hekim · Az tehlikeli');
});

test('tanımlar: dört ayar, anahtarlar veri tabanı beyaz listesiyle aynı', () => {
  assert.deepEqual(AYAR_TANIMLARI.map((x) => x.anahtar).sort(), ['kapasite_dakika', 'kurumlar_vergisi_orani', 'marj_esigi_yuzde', 'varsayilan_kdv_orani']);
  for (const x of AYAR_TANIMLARI) assert.ok(x.varsayilan >= x.min && x.varsayilan <= x.max, x.anahtar);
});
