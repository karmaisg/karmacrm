import test from 'node:test';
import assert from 'node:assert/strict';
import { musteriAnahtari, baglantiAdresi, teklifOzeti, yanitDogrula, baglantiDurumu, tl, TOKEN_DESENI } from '../src/lib/musteri.js';

const T64 = 'ab'.repeat(32);
test('adresten anahtar ayrıştırma; müşteri adresi olmayanlar null', () => {
  assert.equal(musteriAnahtari(`#/t/${T64}`), T64);
  assert.equal(musteriAnahtari('#/t/abc'), 'abc');
  assert.equal(musteriAnahtari('#/t/'), '');
  for (const h of ['#/panel', '', null, undefined, '#/t', '#/teklifler/abc', `#/t/${T64}/x`, `#/t/${T64}?a=1`]) assert.equal(musteriAnahtari(h), null, String(h));
  assert.ok(TOKEN_DESENI.test(T64)); assert.ok(!TOKEN_DESENI.test(T64.toUpperCase())); assert.ok(!TOKEN_DESENI.test(T64 + 'a'));
});

test('bağlantı adresi anahtarı # sonrasına koyar (sunucuya gitmez)', () => {
  const a = baglantiAdresi(T64, { origin: 'https://karmaisg.github.io', pathname: '/karmacrm/' });
  assert.equal(a, `https://karmaisg.github.io/karmacrm/#/t/${T64}`);
  assert.ok(!a.split('#')[0].includes(T64));
});

test('para biçimi kuruşludur', () => { assert.match(tl(1234.5), /1\.234,50/); assert.match(tl(0), /0,00/); assert.match(tl(null), /0,00/); });

const temel = { fiyatlama: 'kisi_basi', birim_fiyat: 100, sabit_fiyat: null, calisan_sayisi: 25, kdv_modu: 'kdv_haric', kdv_orani: 20, indirim: 10, kalemler: [] };
test('fiyat özeti: kişi başı, indirim ve KDV', () => {
  const o = teklifOzeti(temel);
  assert.equal(o.brut, 2500); assert.equal(o.indirimTutari, 250); assert.equal(o.aylikHaric, 2250); assert.equal(o.aylikKdv, 450); assert.equal(o.aylikDahil, 2700);
  assert.equal(o.fiyatlama, 'kisi_basi'); assert.equal(o.calisan, 25);
});
test('fiyat özeti: sabit aylık, KDV dahil girilmiş', () => {
  const o = teklifOzeti({ ...temel, fiyatlama: 'sabit_aylik', birim_fiyat: null, sabit_fiyat: 1200, indirim: 0, kdv_modu: 'kdv_dahil' });
  assert.equal(o.brut, 1200); assert.equal(o.aylikHaric, 1000); assert.equal(o.aylikKdv, 200); assert.equal(o.aylikDahil, 1200); assert.equal(o.indirimTutari, 0);
});
test('fiyat özeti: özel fiyatlama birim fiyat varsa kişi başı, yoksa sabit sayılır', () => {
  assert.equal(teklifOzeti({ ...temel, fiyatlama: 'ozel', indirim: 0 }).brut, 2500);
  assert.equal(teklifOzeti({ ...temel, fiyatlama: 'ozel', birim_fiyat: null, sabit_fiyat: 900, indirim: 0 }).brut, 900);
});
test('ek kalemler: kalem bazında KDV, toplamlar kuruşlu', () => {
  const o = teklifOzeti({ ...temel, kalemler: [
    { aciklama: 'Eğitim', miktar: 2, birim_fiyat: 500, kdv_modu: 'kdv_haric', kdv_orani: 20 },
    { aciklama: 'Ölçüm', miktar: 1, birim_fiyat: 120, kdv_modu: 'kdv_dahil', kdv_orani: 20 }] });
  assert.deepEqual(o.kalemler.map((k) => [k.haric, k.kdv, k.dahil]), [[1000, 200, 1200], [100, 20, 120]]);
  assert.equal(o.kalemHaric, 1100); assert.equal(o.kalemKdv, 220); assert.equal(o.kalemDahil, 1320);
  assert.deepEqual(teklifOzeti(temel).kalemler, []);
});

test('yanıt doğrulama: ad kırpılır, kontrol karakterleri temizlenir, sınırlar uygulanır', () => {
  assert.deepEqual(yanitDogrula({ ad: '  Ali \t Veli\n', not: '  ' }), { ad: 'Ali Veli', not: null });
  assert.deepEqual(yanitDogrula({ ad: 'Ayşe Kaya', not: ' Teşekkürler ' }), { ad: 'Ayşe Kaya', not: 'Teşekkürler' });
  assert.ok(yanitDogrula({ ad: 'A' }).hata.ad); assert.ok(yanitDogrula({ ad: '   ' }).hata.ad); assert.ok(yanitDogrula({}).hata.ad);
  assert.ok(yanitDogrula({ ad: 'a'.repeat(81) }).hata.ad); assert.equal(yanitDogrula({ ad: 'a'.repeat(80) }).hata, undefined);
  assert.ok(yanitDogrula({ ad: 'Ali Veli', not: 'n'.repeat(501) }).hata.not); assert.equal(yanitDogrula({ ad: 'Ali Veli', not: 'n'.repeat(500) }).hata, undefined);
});

test('bağlantı durumu: yok, aktif, doldu, iptal', () => {
  const simdi = new Date('2026-10-30T12:00:00Z');
  assert.equal(baglantiDurumu(null, simdi).ad, 'yok');
  assert.equal(baglantiDurumu({ expires_at: '2026-11-05T00:00:00Z', revoked_at: null }, simdi).ad, 'aktif');
  assert.equal(baglantiDurumu({ expires_at: '2026-10-30T11:59:59Z', revoked_at: null }, simdi).ad, 'doldu');
  assert.equal(baglantiDurumu({ expires_at: '2026-11-05T00:00:00Z', revoked_at: '2026-10-30T10:00:00Z' }, simdi).ad, 'iptal');
});
