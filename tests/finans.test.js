import test from 'node:test';
import assert from 'node:assert/strict';
import { faturaDurumu, finansOzeti, giderOzeti, gecikmeKovasi, tahsilatHaritasi } from '../src/lib/finans.js';

const f = (id, firma, dahilHaric, kdv, vade, ekstra = {}) => ({ id, company_id: firma, amount_excl_vat: dahilHaric, vat_amount: kdv, amount_incl_vat: dahilHaric + kdv, due_date: vade, ...ekstra });
const p = (inv, tutar, tarih = '2026-10-05', ekstra = {}) => ({ id: `${inv}-${tutar}-${tarih}`, invoice_id: inv, amount: tutar, paid_at: tarih, ...ekstra });
const BUGUN = '2026-10-28';

test('faturaDurumu: kısmi tahsilat, gecikme günü ve kalan', () => {
  const d = faturaDurumu(f('a', 'f1', 1000, 200, '2026-10-18'), [p('a', 500)], BUGUN);
  assert.equal(d.kalan, 700); assert.equal(d.durum, 'kismi_tahsilat'); assert.equal(d.gecikmeGunu, 10); assert.equal(d.gecikmis, true);
});
test('faturaDurumu: vadesi gelmemiş fatura gecikmiş sayılmaz; tam ödenen gecikmez', () => {
  assert.equal(faturaDurumu(f('a', 'f1', 1000, 200, '2026-11-10'), [], BUGUN).gecikmis, false);
  const d = faturaDurumu(f('a', 'f1', 1000, 200, '2026-01-10'), [p('a', 1200)], BUGUN);
  assert.equal(d.durum, 'tahsil_edildi'); assert.equal(d.gecikmis, false);
});
test('faturaDurumu: fazla tahsilat işaretlenir, itirazlı durum öne geçer', () => {
  const d = faturaDurumu(f('a', 'f1', 100, 20, '2026-10-01'), [p('a', 150)], BUGUN);
  assert.equal(d.fazlaTahsilat, true); assert.equal(d.fazlaTutar, 30);
  assert.equal(faturaDurumu(f('a', 'f1', 100, 20, '2026-10-01', { flag: 'itirazli' }), [], BUGUN).durum, 'itirazli');
});
test('gecikmeKovasi sınırları', () => {
  assert.deepEqual([0, 1, 30, 31, 60, 61, 90, 91, -3].map(gecikmeKovasi), ['guncel', 'g30', 'g30', 'g60', 'g60', 'g90', 'g90', 'g90p', 'guncel']);
});
test('tahsilatHaritasi: iptal edilenler dışarıda', () => {
  const h = tahsilatHaritasi([p('a', 10), p('a', 20, '2026-10-06', { archived_at: 'x' })]);
  assert.equal(h.get('a').length, 1);
});
test('finansOzeti: toplamlar, yaşlandırma, firma bazlı kalan, arşiv hariç, kuruş doğruluğu', () => {
  const faturalar = [
    f('a', 'f1', 1000, 200, '2026-10-18'),                 // kalan 700, 10 gün
    f('b', 'f1', 83.33, 16.67, '2026-07-01'),              // kalan 100, 119 gün
    f('c', 'f2', 500, 100, '2026-11-15'),                  // kalan 600, vadesi gelmedi
    f('d', 'f2', 100, 20, '2026-08-01', { flag: 'itirazli' }), // kalan 120, itirazlı + gecikmiş
    f('e', 'f2', 999, 99, '2026-01-01', { archived_at: 'x' }), // arşiv
    f('g', 'f3', 100, 20, '2026-09-01'),                   // fazla tahsilat
  ];
  const tahsilatlar = [p('a', 500, '2026-10-05'), p('g', 150, '2026-09-20'), p('c', 0.1, '2026-10-07'), p('a', 40, '2026-10-06', { archived_at: 'x' })];
  const o = finansOzeti(faturalar, tahsilatlar, BUGUN);
  assert.equal(o.faturaAdedi, 5);
  assert.equal(o.toplamFatura, 1200 + 100 + 600 + 120 + 120);
  assert.equal(o.toplamTahsil, 650.1);
  assert.equal(o.toplamKalan, 700 + 100 + 599.9 + 120);
  assert.equal(o.gecikmisKalan, 700 + 100 + 120); assert.equal(o.gecikmisAdet, 3);
  assert.equal(o.itirazliKalan, 120); assert.equal(o.itirazliAdet, 1);
  assert.equal(o.fazlaTahsilatAdet, 1);
  assert.equal(o.buAyTahsilat, 500.1);
  assert.deepEqual(o.yaslandirma, { guncel: 599.9, g30: 700, g60: 0, g90: 120, g90p: 100 });
  assert.equal(o.firmaKalan.f1, 800); assert.equal(o.firmaKalan.f3, undefined);
});
test('giderOzeti: ay filtresi, doğrudan/ortak, ödenmemiş KDV dahil, arşiv hariç', () => {
  const g = (id, tarih, haric, kdv, tur, paid, ekstra = {}) => ({ id, expense_date: tarih, amount_excl_vat: haric, vat_amount: kdv, amount_incl_vat: haric + kdv, cost_type: tur, paid, category_id: 'k1', ...ekstra });
  const l = [g('1', '2026-10-03', 10000, 2000, 'ortak', true), g('2', '2026-10-04', 500, 100, 'dogrudan', false, { company_id: 'f1' }),
    g('3', '2026-09-30', 700, 0, 'ortak', true), g('4', '2026-10-09', 50, 10, 'ortak', false, { archived_at: 'x' })];
  const o = giderOzeti(l, '2026-10-01');
  assert.equal(o.adet, 2); assert.equal(o.toplamGider, 10500); assert.equal(o.dogrudanToplam, 500); assert.equal(o.ortakHavuz, 10000);
  assert.equal(o.dahilToplam, 12600); assert.equal(o.odenmemisDahil, 600); assert.equal(o.kategoriBazli.k1, 10500);
});
