import test from 'node:test';
import assert from 'node:assert/strict';
import { hesaplaKarlilik, dagitimSatirlari, faturaAyi } from '../src/lib/karlilik.js';

const AY = '2026-10-01';
const kurallar = [
  { staff_type: 'is_guvenligi_uzmani', hazard_class: 'tehlikeli', minutes_per_employee: 20, valid_from: '2020-01-01', valid_to: null },
  { staff_type: 'isyeri_hekimi', hazard_class: 'tehlikeli', minutes_per_employee: 10, valid_from: '2020-01-01', valid_to: null },
];
const firmalar = [{ id: 'f1', name: 'Alfa' }, { id: 'f2', name: 'Beta' }, { id: 'f3', name: 'Gama' }];
const profil = (c, n) => ({ company_id: c, employee_count: n, hazard_class: 'tehlikeli', valid_from: '2020-01-01', valid_to: null });
const profiller = [profil('f1', 50), profil('f2', 25), profil('f3', 25)];
const personeller = [
  { id: 'u1', full_name: 'Uzman Bir', staff_type: 'is_guvenligi_uzmani', monthly_capacity_min: 2000, is_active: true },
  { id: 'h1', full_name: 'Hekim Bir', staff_type: 'isyeri_hekimi', monthly_capacity_min: 1000, is_active: true },
];
const atama = (id, c, e, tur, pay) => ({ id, company_id: c, employee_id: e, staff_type: tur, share_pct: pay, valid_from: '2026-01-01', valid_to: null, archived_at: null });
// f1: 50x20 = 1000 dk uzman; f2: 500 dk; f3: 500 dk -> uzman toplam 2000 = kapasite
const atamalar = [atama('a1', 'f1', 'u1', 'is_guvenligi_uzmani', 100), atama('a2', 'f2', 'u1', 'is_guvenligi_uzmani', 100), atama('a3', 'f3', 'u1', 'is_guvenligi_uzmani', 100),
  atama('a4', 'f1', 'h1', 'isyeri_hekimi', 100)];
const maliyet = (e, v) => ({ employee_id: e, total_monthly_cost: v, valid_from: '2020-01-01', valid_to: null });
const maliyetler = [maliyet('u1', 40000), maliyet('h1', 30000)];
const fat = (id, c, haric, ay = '2026-10-15', ekstra = {}) => ({ id, company_id: c, amount_excl_vat: haric, vat_amount: haric * 0.2, invoice_date: ay, service_period: null, archived_at: null, ...ekstra });
const faturalar = [fat('i1', 'f1', 20000), fat('i2', 'f2', 10000), fat('i3', 'f3', 10000), fat('x', 'f1', 999, '2026-09-30'), fat('y', 'f1', 999, '2026-10-02', { archived_at: 'z' })];
const kategoriler = [{ id: 'k-kira', name: 'Kira', is_payroll: false, is_income_tax: false }, { id: 'k-maas', name: 'Maaş', is_payroll: true, is_income_tax: false }, { id: 'k-vergi', name: 'Kurumlar vergisi', is_payroll: false, is_income_tax: true }];
const gider = (id, kat, haric, ekstra = {}) => ({ id, category_id: kat, expense_date: '2026-10-05', amount_excl_vat: haric, vat_amount: 0, cost_type: 'ortak', company_id: null, employee_id: null, archived_at: null, ...ekstra });
const temel = { ay: AY, firmalar, profiller, kurallar, atamalar, personeller, maliyetler, faturalar, kategoriler, sozlesmeler: [], zaman: [], giderler: [] };

test('faturaAyi: hizmet dönemi varsa o, yoksa fatura tarihi', () => {
  assert.equal(faturaAyi({ service_period: '2026-09-01', invoice_date: '2026-10-05' }), '2026-09');
  assert.equal(faturaAyi({ service_period: null, invoice_date: '2026-10-05' }), '2026-10');
});

test('gelir yalnız o ayın, arşivsiz faturalarından; KDV hariç', () => {
  const r = hesaplaKarlilik(temel);
  assert.equal(r.isletme.gelir, 40000);
  assert.equal(r.firmalar.find((f) => f.id === 'f1').gelir, 20000);
});

test('teorik yöntem: uzman maliyeti kapasiteyle orantılı firmalara dağılır, boşta yok (yük = kapasite)', () => {
  const r = hesaplaKarlilik(temel);
  const u = r.personel.find((p) => p.id === 'u1');
  assert.equal(u.teorikDk, 2000); assert.equal(u.bosta, 0);
  assert.deepEqual(u.firmaPay.map((f) => [f.companyId, f.maliyet]).sort(), [['f1', 20000], ['f2', 10000], ['f3', 10000]]);
  // hekim: yalnız f1, 500 dk x ... f1 profili 50x10 = 500 dk, kapasite 1000 -> yarısı boşta
  const h = r.personel.find((p) => p.id === 'h1');
  assert.equal(h.teorikDk, 500); assert.equal(h.bosta, 15000);
  assert.equal(r.firmalar.find((f) => f.id === 'f1').personel, 20000 + 15000);
});

test('değişmez: firmalara dağıtılan + boşta = toplam personel maliyeti; işletme kârı = Σ firma kârı - boşta - dağıtılmayan ortak', () => {
  const giderler = [gider('g1', 'k-kira', 10000.01), gider('g2', 'k-kira', 3333.33), gider('d1', 'k-kira', 700, { cost_type: 'dogrudan', company_id: 'f2' }), gider('d2', 'k-kira', 250.5, { cost_type: 'dogrudan', employee_id: 'u1' })];
  const r = hesaplaKarlilik({ ...temel, giderler });
  const firmaPersonel = r.firmalar.reduce((t, f) => t + f.personel, 0);
  assert.equal(Math.round((firmaPersonel + r.isletme.bosta) * 100), Math.round(r.isletme.personel * 100));
  assert.equal(r.isletme.personel, 70250.5); // 40000+30000 + personele bağlı 250.50
  const ortakToplam = r.firmalar.reduce((t, f) => t + f.ortak, 0);
  assert.equal(Math.round((ortakToplam + r.isletme.ortakDagitilmayan) * 100), Math.round(r.isletme.ortakHavuz * 100));
  assert.equal(r.isletme.ortakHavuz, 13333.34);
  const kar = r.firmalar.reduce((t, f) => t + f.kar, 0);
  assert.equal(Math.round((kar - r.isletme.bosta - r.isletme.ortakDagitilmayan) * 100), Math.round(r.isletme.vergiOncesiKar * 100));
});

test('ortak gider: varsayılan gelir oranı (50/25/25), toplamı aşmaz, kuruş kalanı korunur', () => {
  const r = hesaplaKarlilik({ ...temel, giderler: [gider('g1', 'k-kira', 1000.01)] });
  const o = r.ortak[0];
  assert.equal(o.olcut, 'gelir_orani');
  const pay = r.firmalar.map((f) => f.ortak);
  assert.equal(Math.round(pay.reduce((t, x) => t + x, 0) * 100), 100001);
  assert.equal(r.firmalar.find((f) => f.id === 'f1').ortak, 500.01);
});

test('ortak gider: müşteri sayısı ölçütü eşit böler (yalnız gelirli/sözleşmeli firmalar)', () => {
  const kurallarD = [{ category_id: 'k-kira', basis: 'musteri_sayisi', valid_from: '2000-01-01', valid_to: null }];
  const r = hesaplaKarlilik({ ...temel, dagitimKurallari: kurallarD, giderler: [gider('g1', 'k-kira', 900)] });
  assert.deepEqual(r.firmalar.map((f) => f.ortak).sort(), [300, 300, 300]);
});

test('ortak gider: dağıtılacak firma yoksa tutar dağıtılmaz ve uyarı verilir', () => {
  const r = hesaplaKarlilik({ ...temel, faturalar: [], giderler: [gider('g1', 'k-kira', 900)] });
  assert.equal(r.isletme.ortakDagitilmayan, 900);
  assert.ok(r.uyarilar.some((u) => u.includes('dağıtılacak firma bulunamadı')));
});

test('kaydedilmiş dağıtım hesabı sabitler; havuz büyürse fark dağıtılmamış görünür', () => {
  const kayitli = [{ category_id: 'k-kira', period: '2026-10-01', company_id: 'f1', amount: 600, archived_at: null }, { category_id: 'k-kira', period: '2026-10-01', company_id: 'f2', amount: 300, archived_at: null }];
  const r = hesaplaKarlilik({ ...temel, kayitliDagitim: kayitli, giderler: [gider('g1', 'k-kira', 1000)] });
  assert.equal(r.ortak[0].kaydedilmis, true);
  assert.equal(r.firmalar.find((f) => f.id === 'f1').ortak, 600);
  assert.equal(r.firmalar.find((f) => f.id === 'f3').ortak, 0);
  assert.equal(r.isletme.ortakDagitilmayan, 100);
});

test('çift sayım yok: maaş kategorisi dahil edilmez (uyarı), kurumlar vergisi gider sayılmaz ama vergiye yansır', () => {
  const r = hesaplaKarlilik({ ...temel, giderler: [gider('m', 'k-maas', 40000, { cost_type: 'dogrudan', employee_id: 'u1' }), gider('v', 'k-vergi', 1000)] });
  assert.equal(r.isletme.personel, 70000);
  assert.ok(r.uyarilar.some((u) => u.includes('Maaş kategorisindeki 1 gider')));
  assert.equal(r.isletme.kayitliVergi, 1000); assert.equal(r.isletme.ortakHavuz, 0);
  assert.equal(r.isletme.vergiOncesiKar, 40000 - 70000);
});

test('fiili yöntem: maliyet fiilî hizmet dakikası oranında; kayıt yoksa tamamı boşta', () => {
  const zaman = [{ employee_id: 'u1', company_id: 'f1', work_date: '2026-10-03', onsite_minutes: 180, reporting_minutes: 60, activity_type: 'ziyaret' },
    { employee_id: 'u1', company_id: 'f2', work_date: '2026-10-04', onsite_minutes: 120, reporting_minutes: 0, activity_type: 'ziyaret' },
    { employee_id: 'u1', company_id: 'f2', work_date: '2026-09-04', onsite_minutes: 999, reporting_minutes: 0, activity_type: 'ziyaret' }];
  const r = hesaplaKarlilik({ ...temel, zaman, yontem: 'fiili' });
  const u = r.personel.find((p) => p.id === 'u1');
  assert.deepEqual(u.firmaPay.map((f) => [f.companyId, f.maliyet]).sort(), [['f1', 26666.67], ['f2', 13333.33]]);
  assert.equal(u.bosta, 0);
  const h = r.personel.find((p) => p.id === 'h1');
  assert.equal(h.bosta, 30000); assert.equal(h.firmaPay.length, 0);
});

test('personel gelir payı: iki tür varsa %50-%50, pay oranıyla; katkı = gelir payı - maliyet', () => {
  const r = hesaplaKarlilik(temel);
  const u = r.personel.find((p) => p.id === 'u1'); const h = r.personel.find((p) => p.id === 'h1');
  assert.equal(h.gelirPayi, 10000);            // f1 20000 x %50 (iki tür)
  assert.equal(u.gelirPayi, 10000 + 10000 + 10000); // f1 10000 + f2 ve f3 tamamı (tek tür)
  assert.equal(u.katki, 30000 - 40000);
  assert.equal(h.katki, 10000 - 30000);
});

test('maliyet kaydı olmayan görevli personel uyarı verir ve 0 sayılır; pasif ve verisiz personel listeye girmez', () => {
  const r = hesaplaKarlilik({ ...temel, maliyetler: [maliyet('u1', 40000)],
    personeller: [...personeller, { id: 'p', full_name: 'Pasif Kişi', staff_type: 'isyeri_hekimi', is_active: false, archived_at: 'x' }] });
  assert.ok(r.uyarilar.some((u) => u.includes('Hekim Bir') && u.includes('maliyet kaydı yok')));
  assert.equal(r.personel.some((p) => p.id === 'p'), false);
  assert.equal(r.personel.find((p) => p.id === 'h1').toplam, 0);
});

test('vergi tahmini: kâr varsa orana göre, zararda 0', () => {
  const r = hesaplaKarlilik({ ...temel, maliyetler: [maliyet('u1', 1000), maliyet('h1', 1000)] });
  assert.equal(r.isletme.vergiOncesiKar, 38000); assert.equal(r.isletme.tahminiVergi, 9500); assert.equal(r.isletme.vergiSonrasiKar, 28500);
  const z = hesaplaKarlilik(temel);
  assert.equal(z.isletme.vergiOncesiKar, -30000); assert.equal(z.isletme.tahminiVergi, 0);
});

test('dagitimSatirlari: yalnız sıfırdan büyük satırlar', () => {
  const r = hesaplaKarlilik({ ...temel, faturalar: [fat('i1', 'f1', 100)], giderler: [gider('g1', 'k-kira', 90)] });
  assert.deepEqual(dagitimSatirlari(r.ortak[0]), [{ company_id: 'f1', amount: 90 }]);
});
