import test from 'node:test';
import assert from 'node:assert/strict';
import { izinHakki, temelGun, yilEkle, yasHesapla, isGunuSayisi } from '../src/lib/izin.js';

test('temel gün: 1–5 yıl (5 dahil) 14, 5–15 yıl 20, 15 ve üzeri 26', () => {
  assert.deepEqual([1, 5, 6, 14, 15, 30].map(temelGun), [14, 14, 20, 20, 26, 26]);
});
test('yıldönümü ve yaş', () => {
  assert.equal(yilEkle('2020-02-29', 1), '2021-02-28'); assert.equal(yilEkle('2020-02-29', 4), '2024-02-29'); assert.equal(yilEkle('2020-03-15', 6), '2026-03-15');
  assert.equal(yasHesapla('1975-06-10', '2025-06-09'), 49); assert.equal(yasHesapla('1975-06-10', '2025-06-10'), 50); assert.equal(yasHesapla(null, '2025-01-01'), null);
});
test('iş günü: hafta sonları hariç', () => {
  assert.equal(isGunuSayisi('2026-07-06', '2026-07-10'), 5); assert.equal(isGunuSayisi('2026-07-06', '2026-07-12'), 5);
  assert.equal(isGunuSayisi('2026-07-10', '2026-07-13'), 2); assert.equal(isGunuSayisi('2026-07-11', '2026-07-12'), 0); assert.equal(isGunuSayisi('2026-07-10', '2026-07-06'), 0);
});
test('bir yıl dolmadan hak yok; ilk hak 1. yıldönümünde', () => {
  let r = izinHakki({ baslangic: '2026-01-01', dogum: '1990-01-01', bugun: '2026-12-31' });
  assert.equal(r.yillar.length, 0); assert.equal(r.toplamHak, 0); assert.deepEqual(r.sonraki, { no: 1, tarih: '2027-01-01', gun: 14 });
  r = izinHakki({ baslangic: '2026-01-01', dogum: '1990-01-01', bugun: '2027-01-01' });
  assert.equal(r.yillar.length, 1); assert.equal(r.yillar[0].hakGun, 14);
});
test('yıl yıl hak: 2020-03-15 başlangıç, bugün 2026-11-05 → 5×14 + 20', () => {
  const r = izinHakki({ baslangic: '2020-03-15', dogum: '1990-01-01', bugun: '2026-11-05' });
  assert.deepEqual(r.yillar.map((y) => y.hakGun), [14, 14, 14, 14, 14, 20]); assert.equal(r.toplamHak, 90);
  assert.equal(r.yillar[5].hakTarihi, '2026-03-15'); assert.equal(r.yillar[0].donemBas, '2020-03-15'); assert.equal(r.yillar[0].donemBit, '2021-03-14');
  assert.deepEqual(r.sonraki, { no: 7, tarih: '2027-03-15', gun: 20 }); assert.equal(r.calismaYili, 6);
});
test('15. yılda 26 gün', () => {
  const r = izinHakki({ baslangic: '2005-01-10', dogum: '1980-01-01', bugun: '2020-01-10' });
  assert.equal(r.yillar.length, 15); assert.equal(r.yillar[13].hakGun, 20); assert.equal(r.yillar[14].hakGun, 26);
});
test('yaş kuralı: 50 ve üzeri / 18 altı en az 20 gün; 26 gün olan değişmez', () => {
  let r = izinHakki({ baslangic: '2018-06-01', dogum: '1969-06-10', bugun: '2021-12-01' });   // hak 2019 (49 yaş), 2020 (50 yaş), 2021 (51)
  assert.deepEqual(r.yillar.map((y) => y.hakGun), [14, 20, 20]); assert.equal(r.yillar[1].yasKurali, true);
  r = izinHakki({ baslangic: '2022-01-10', dogum: '2005-06-01', bugun: '2023-06-01' });        // 1. hak 2023-01-10: 17 yaşında
  assert.equal(r.yillar[0].hakGun, 20);
  r = izinHakki({ baslangic: '2000-01-01', dogum: '1950-01-01', bugun: '2016-01-01' });         // 15. yıl: 26 kalır
  assert.equal(r.yillar[14].hakGun, 26);
});
test('doğum tarihi yoksa uyarı verir ve yaş kuralı uygulanmaz', () => {
  const r = izinHakki({ baslangic: '2020-01-01', dogum: null, bugun: '2022-06-01' });
  assert.ok(r.uyarilar.some((u) => u.includes('Doğum tarihi'))); assert.equal(r.yillar[0].hakGun, 14);
});
test('kullanılan izin en eski haktan düşülür; fazla kullanım uyarılır', () => {
  let r = izinHakki({ baslangic: '2020-03-15', dogum: '1990-01-01', bugun: '2026-11-05', izinler: [{ days: 10 }, { days: '9.5' }, { days: 20 }] });
  assert.deepEqual(r.yillar.map((y) => y.kullanilan), [14, 14, 11.5, 0, 0, 0]); assert.equal(r.toplamKullanilan, 39.5); assert.equal(r.kalan, 50.5);
  assert.deepEqual(r.yillar.map((y) => y.kalan), [0, 0, 2.5, 14, 14, 20]);
  r = izinHakki({ baslangic: '2025-01-01', dogum: '1990-01-01', bugun: '2026-06-01', izinler: [{ days: 20 }] });
  assert.equal(r.kalan, -6); assert.equal(r.fazla, 6); assert.ok(r.uyarilar.some((u) => u.includes('fazla izin')));
});
test('ayrılan personelde hak ayrılış tarihinden sonra doğmaz; başlangıç yoksa hesaplanamaz', () => {
  const r = izinHakki({ baslangic: '2020-03-15', dogum: '1990-01-01', ayrilis: '2023-01-01', bugun: '2026-11-05' });
  assert.equal(r.yillar.length, 2); assert.equal(r.sonraki, null);
  const e = izinHakki({ baslangic: null, bugun: '2026-11-05' }); assert.equal(e.gecerli, false); assert.equal(e.yillar.length, 0);
});
