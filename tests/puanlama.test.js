import test from 'node:test';
import assert from 'node:assert/strict';
import { potansiyelPuani, puanSinifi, tahminiHizmetDakikasi, huniOzeti, takipDurumu, ASAMA_SIRASI } from '../src/lib/puanlama.js';

const kurallar = [
  { staff_type: 'is_guvenligi_uzmani', hazard_class: 'tehlikeli', minutes_per_employee: 20, valid_from: '2020-01-01', valid_to: null },
  { staff_type: 'isyeri_hekimi', hazard_class: 'tehlikeli', minutes_per_employee: 10, valid_from: '2020-01-01', valid_to: null },
];

test('puan: tüm bilgiler girildiğinde bileşenler toplanır', () => {
  const r = potansiyelPuani({ employee_count: 120, hazard_class: 'cok_tehlikeli', source: 'tavsiye', est_monthly_revenue: 40000 });
  assert.equal(r.puan, 25 + 20 + 20 + 30);
  assert.equal(r.azami, 100);
  assert.equal(r.eksikVar, false);
});
test('puan: eksik bilgi 0 puan alır ve işaretlenir', () => {
  const r = potansiyelPuani({ employee_count: '', hazard_class: '', source: '', est_monthly_revenue: null });
  assert.equal(r.puan, 0);
  assert.equal(r.eksikVar, true);
  assert.ok(r.parcalar.every((p) => p.eksik));
});
test('puan: sınır değerleri', () => {
  const p = (n) => potansiyelPuani({ employee_count: n }).parcalar[0].puan;
  assert.deepEqual([p(0), p(1), p(9), p(10), p(49), p(50), p(249), p(250)], [0, 5, 5, 15, 15, 25, 25, 30]);
  const g = (x) => potansiyelPuani({ est_monthly_revenue: x }).parcalar[3].puan;
  assert.deepEqual([g(0), g(4999), g(5000), g(14999), g(15000), g(29999), g(30000)], [0, 5, 15, 15, 22, 22, 30]);
});
test('puan: sayı metni olarak gelen değerler de çalışır', () => {
  assert.equal(potansiyelPuani({ employee_count: '60', est_monthly_revenue: '16000' }).puan, 25 + 22);
});
test('puan sınıfı', () => {
  assert.deepEqual([null, 10, 40, 69, 70].map(puanSinifi), ['yok', 'dusuk', 'orta', 'orta', 'yuksek']);
});
test('tahmini hizmet süresi: uzman + hekim', () => {
  assert.equal(tahminiHizmetDakikasi({ calisan: 30, tehlike: 'tehlikeli', kurallar, tarih: '2026-10-25' }), 30 * 20 + 30 * 10);
  assert.equal(tahminiHizmetDakikasi({ calisan: '', tehlike: 'tehlikeli', kurallar, tarih: '2026-10-25' }), null);
  assert.equal(tahminiHizmetDakikasi({ calisan: 30, tehlike: 'az_tehlikeli', kurallar, tarih: '2026-10-25' }), null);
  assert.equal(tahminiHizmetDakikasi({ calisan: -1, tehlike: 'tehlikeli', kurallar, tarih: '2026-10-25' }), null);
});
test('huni özeti: arşivli kayıtlar sayılmaz, açık toplam kapalıları içermez', () => {
  const o = huniOzeti([
    { stage: 'yeni_aday', expected_monthly: 1000 }, { stage: 'pazarlik', expected_monthly: '2500.50' },
    { stage: 'kazanildi', expected_monthly: 9000 }, { stage: 'yeni_aday', expected_monthly: null },
    { stage: 'yeni_aday', expected_monthly: 7000, archived_at: '2026-01-01' },
  ]);
  assert.equal(o.asamalar.yeni_aday.adet, 2);
  assert.equal(o.asamalar.yeni_aday.tutar, 1000);
  assert.equal(o.acik.adet, 3);
  assert.equal(o.acik.tutar, 3500.5);
  assert.equal(Object.keys(o.asamalar).length, ASAMA_SIRASI.length);
});
test('takip durumu', () => {
  assert.deepEqual(['2026-10-24', '2026-10-25', '2026-10-26', null].map((t) => takipDurumu(t, '2026-10-25')), ['gecikmis', 'bugun', 'yaklasan', 'yok']);
});
