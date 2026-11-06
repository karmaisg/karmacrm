import test from 'node:test';
import assert from 'node:assert/strict';
import { aylikOzet, aylikSeri, sonAylar } from '../src/lib/yonetim.js';

const veri = {
  ay: '2026-10-01',
  firmalar: [{ id: 'f1', name: 'Alfa', customer_status: 'musteri' }, { id: 'f2', name: 'Beta', customer_status: 'musteri' }, { id: 'f3', name: 'Eski', customer_status: 'eski_musteri' }],
  profiller: [{ company_id: 'f1', employee_count: 50, hazard_class: 'tehlikeli', valid_from: '2020-01-01', valid_to: null }, { company_id: 'f2', employee_count: 25, hazard_class: 'az_tehlikeli', valid_from: '2020-01-01', valid_to: null }],
  kurallar: [{ staff_type: 'is_guvenligi_uzmani', hazard_class: 'tehlikeli', minutes_per_employee: 20, valid_from: '2020-01-01', valid_to: null }, { staff_type: 'isyeri_hekimi', hazard_class: 'tehlikeli', minutes_per_employee: 10, valid_from: '2020-01-01', valid_to: null },
    { staff_type: 'is_guvenligi_uzmani', hazard_class: 'az_tehlikeli', minutes_per_employee: 10, valid_from: '2020-01-01', valid_to: null }, { staff_type: 'isyeri_hekimi', hazard_class: 'az_tehlikeli', minutes_per_employee: 5, valid_from: '2020-01-01', valid_to: null }],
  sozlesmeler: [{ company_id: 'f1', status: 'aktif', start_date: '2026-01-01', end_date: '2026-12-31', archived_at: null }, { company_id: 'f2', status: 'aktif', start_date: '2026-10-15', end_date: '2027-10-14', archived_at: null }],
  personeller: [{ id: 'u1', full_name: 'Uzman', staff_type: 'is_guvenligi_uzmani', monthly_capacity_min: 2000, is_active: true }, { id: 'h1', full_name: 'Hekim', staff_type: 'isyeri_hekimi', monthly_capacity_min: 1000, is_active: true }],
  atamalar: [{ id: 'a1', company_id: 'f1', employee_id: 'u1', staff_type: 'is_guvenligi_uzmani', share_pct: 100, valid_from: '2026-01-01', valid_to: null, archived_at: null }],
  maliyetler: [{ employee_id: 'u1', total_monthly_cost: 40000, valid_from: '2020-01-01', valid_to: null }, { employee_id: 'h1', total_monthly_cost: 30000, valid_from: '2020-01-01', valid_to: null }],
  faturalar: [
    { id: 'i1', company_id: 'f1', amount_excl_vat: 20000, vat_amount: 4000, invoice_date: '2026-10-10', service_period: null, archived_at: null },
    { id: 'i2', company_id: 'f2', amount_excl_vat: 10000, vat_amount: 2000, invoice_date: '2026-10-12', service_period: null, archived_at: null },
    { id: 'i0', company_id: 'f1', amount_excl_vat: 5000, vat_amount: 1000, invoice_date: '2026-09-10', service_period: null, archived_at: null }],
  giderler: [], kategoriler: [], dagitimKurallari: [], kayitliDagitim: [],
  zaman: [{ employee_id: 'u1', company_id: 'f1', work_date: '2026-10-05', activity_type: 'ziyaret', onsite_minutes: 100, reporting_minutes: 20, archived_at: null }],
  kapasiteVarsayilan: 11700, vergiOrani: 25,
};
const tahsilatlar = [{ invoice_id: 'i1', paid_at: '2026-10-20', amount: 10000, archived_at: null }, { invoice_id: 'i0', paid_at: '2026-10-02', amount: 6000, archived_at: null }, { invoice_id: 'i2', paid_at: '2026-09-20', amount: 500, archived_at: null }];

test('sonAylar: seçili ay dahil geriye 12 ay, eskiden yeniye', () => {
  const l = sonAylar('2026-02-01', 12); assert.equal(l.length, 12); assert.equal(l[0], '2025-03-01'); assert.equal(l[11], '2026-02-01');
});

test('aylık özet: gelir, tahsilat (ödeme tarihine göre), alacak (ayın faturaları), gider ve kâr', () => {
  const o = aylikOzet({ veri, tahsilatlar }); const k = o.kpi;
  assert.equal(k.gelir, 30000);
  assert.equal(k.tahsilat, 16000);                      // 10.000 (i1) + 6.000 (i0, Eylül faturası ama ödeme Ekim'de)
  assert.equal(k.tahsilEdilmemis, 14000 + 11500 - 0);   // i1: 24.000-10.000 ; i2: 12.000-500
  assert.equal(k.gider, 70000); assert.equal(k.vergiOncesi, -40000); assert.equal(k.vergi, 0); assert.equal(k.vergiSonrasi, -40000);
  assert.equal(k.aktifFirma, 2); assert.equal(k.uzman, 1); assert.equal(k.hekim, 1);
  assert.equal(k.fiiliDk, 120); assert.equal(k.dkGelir, 250); assert.equal(k.dkMaliyet, Math.round((70000 / 120) * 100) / 100);
});

test('teorik dakika: ay içinde başlayan sözleşmeli firma o aya dahil; tehlike sınıfı dökümü', () => {
  const o = aylikOzet({ veri, tahsilatlar }); const k = o.kpi;
  assert.equal(k.uzmanDk, 50 * 20 + 25 * 10); assert.equal(k.hekimDk, 50 * 10 + 25 * 5); assert.equal(k.teorikDk, 1250 + 625);
  assert.deepEqual(o.tehlike.map((t) => [t.sinif, t.firma, t.gelir, t.teorikDk, t.fiiliDk]), [['az_tehlikeli', 1, 10000, 375, 0], ['tehlikeli', 1, 20000, 1500, 120]]);
});

test('dikkat: görevlendirilmemiş firmanın geliri; en kârlı ve en düşük kârlı sıralaması', () => {
  const o = aylikOzet({ veri, tahsilatlar });
  assert.equal(o.dikkat.atanmamisGelir, 10000);         // yalnızca Beta'ya kimse atanmamış
  assert.equal(o.enKarli.length, 2); assert.ok(o.enKarli[0].kar >= o.enKarli[1].kar); assert.ok(o.enDusuk[0].kar <= o.enDusuk[1].kar);
  assert.equal(o.kapasite[0].ad, 'Uzman');
});

test('12 aylık seri: gelir yalnız ilgili ayda; vergi öncesi = gelir - gider', () => {
  const s = aylikSeri({ veri }); assert.equal(s.length, 12);
  const ekim = s[11]; const eylul = s[10]; assert.equal(ekim.ay, '2026-10-01'); assert.equal(ekim.gelir, 30000); assert.equal(eylul.gelir, 5000);
  for (const m of s) assert.equal(Math.round((m.gelir - m.gider) * 100) / 100, m.vergiOncesi);
});
