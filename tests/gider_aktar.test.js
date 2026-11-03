import test from 'node:test';
import assert from 'node:assert/strict';
import { giderTablosu, varsayilanKararlar, kararTamam, bekleyenSatirlar, giderPaketi, eklenecekOzet, yerineGecenler, anahtarOf } from '../src/lib/gider_aktar.js';
import { xlsxOku } from '../src/lib/xlsx.js';
import { giderSablonu, xlsxYaz } from '../src/lib/xlsxyaz.js';
import { hesaplaKarlilik, YONETIM_KATEGORI } from '../src/lib/karlilik.js';

const A = ['2026-01-01', '2026-02-01', '2026-03-01'].map((v) => `${v}T00:00:00`);
const TABLO = [
  ['Gider kalemi', ...A],
  ['Yönetime Ödenen', 1000, 1100, null],
  ['Personel Giderleri', 5000, 5000, 5000],
  ['Kira ve Aidat', 200, 200, 0],
  ['Vergi', 0, 50, null],
  ['Elektrik', null, null, null],
  ['TOPLAM', 6200, 6350, 5000],
];
const KAT = [{ id: 'k1', name: 'Kira' }, { id: 'k2', name: 'Kira ve Aidat' }, { id: 'kp', name: 'Uzman maaşları', is_payroll: true }, { id: 'ky', name: 'Yönetime ödenen', is_management_pay: true }];

test('tablo ayrıştırma: aylar, toplam satırı atlanır, negatif ve sayı olmayan', () => {
  const t = giderTablosu(TABLO);
  assert.deepEqual(t.aylar, ['2026-01-01', '2026-02-01', '2026-03-01']);
  assert.equal(t.satirlar.length, 5); assert.ok(t.uyarilar.some((u) => u.includes('toplam')));
  assert.equal(t.satirlar.find((s) => s.anahtar === 'kira ve aidat').toplam, 400);
  assert.equal(t.satirlar.find((s) => s.anahtar === 'elektrik').dolu, 0);
  const b = giderTablosu([['x', ...A], ['Kira', -5, 'abc', 10]]);
  assert.equal(b.satirlar[0].negatif, 1); assert.ok(b.hatalar.some((h) => h.includes('sayı değil')));
  assert.ok(giderTablosu([['a', 'b'], ['c', 1]]).hatalar[0].includes('Ay başlıkları'));
  assert.ok(giderTablosu([['x', ...A], ['Kira', 1], ['kira', 2]]).hatalar.some((h) => h.includes('birden çok')));
});

test('varsayılan kararlar: yönetim, personel atla, ad eşleşmesi, yeni kategori, hatırlanan eşleşme', () => {
  const t = giderTablosu(TABLO);
  const k = varsayilanKararlar(t.satirlar, { kategoriler: KAT });
  assert.equal(k['yonetime odenen'].islem, 'yonetim'); assert.equal(k['personel giderleri'].islem, 'atla');
  assert.equal(k['kira ve aidat'].kategori_id, 'k2');                   // tam ad
  assert.deepEqual(k.vergi.yeni, { ad: 'Vergi', tur: 'vergi' }); assert.equal(k.elektrik.yeni.tur, 'isletme');
  const h = varsayilanKararlar(t.satirlar, { kategoriler: KAT, harita: [{ row_key: 'kira ve aidat', action: 'kategori', category_id: 'k1' }, { row_key: 'vergi', action: 'atla' }] });
  assert.equal(h['kira ve aidat'].kategori_id, 'k1'); assert.equal(h.vergi.islem, 'atla');
  // maaş kategorisine otomatik eşleşmez
  assert.notEqual(varsayilanKararlar([{ etiket: 'Uzman maaşları', anahtar: anahtarOf('Uzman maaşları'), dolu: 1 }], { kategoriler: KAT })['uzman maaslari'].kategori_id, 'kp');
  assert.equal(kararTamam({ islem: 'kategori', kategori_id: null, yeni: { ad: ' ' } }), false);
  assert.equal(bekleyenSatirlar(t.satirlar, { ...k, kira_: 1, 'kira ve aidat': { islem: 'kategori', kategori_id: null, yeni: { ad: '' } } }).length, 1);
});

test('paket ve özet: boş satırlar gitmez, atla eşleşme için gider, yönetim ayrı toplanır', () => {
  const t = giderTablosu(TABLO); const k = varsayilanKararlar(t.satirlar, { kategoriler: KAT });
  const p = giderPaketi({ dosya: 'g.xlsx', aylar: t.aylar, satirlar: t.satirlar, kararlar: k, kdvModu: 'kdv_dahil', kdvOrani: 20 });
  assert.equal(p.kdv_modu, 'kdv_dahil'); assert.equal(p.satirlar.length, 4);                 // elektrik (boş) yok
  assert.deepEqual(p.satirlar.find((s) => s.anahtar === 'personel giderleri').tutarlar, {});
  assert.equal(p.satirlar.find((s) => s.anahtar === 'kira ve aidat').kategori_id, 'k2');
  assert.deepEqual(p.satirlar.find((s) => s.anahtar === 'vergi').yeni_kategori, { ad: 'Vergi', tur: 'vergi' });
  const o = eklenecekOzet({ aylar: t.aylar, satirlar: t.satirlar, kararlar: k });
  assert.equal(o.ay['2026-02-01'].yonetim, 1100); assert.equal(o.ay['2026-02-01'].gider, 250); assert.equal(o.atlanan, 15000);
});

test('yerine geçenler: yalnızca Excel kaynaklı, arşivsiz, dosya aylarındaki kayıtlar', () => {
  const g = [{ import_id: 'i1', expense_date: '2026-01-01', amount_excl_vat: 100 }, { import_id: 'i1', expense_date: '2026-01-01', amount_excl_vat: 50.5 },
    { import_id: null, expense_date: '2026-01-01', amount_excl_vat: 999 }, { import_id: 'i1', expense_date: '2026-01-01', amount_excl_vat: 7, archived_at: 'x' }, { import_id: 'i1', expense_date: '2026-05-01', amount_excl_vat: 7 }];
  const y = yerineGecenler({ aylar: ['2026-01-01', '2026-02-01'], giderler: g });
  assert.equal(y.adet, 2); assert.equal(y.tutar, 150.5); assert.equal(y.ay['2026-01-01'].adet, 2);
});

test('boş şablon okunur: başlık + 12 ay, personel satırı yok', async () => {
  const x = await xlsxOku(giderSablonu(2026).buffer.slice(0));
  const t = giderTablosu(x.satirlar);
  assert.equal(t.aylar.length, 12); assert.equal(t.aylar[0], '2026-01-01'); assert.equal(t.aylar[11], '2026-12-01');
  assert.ok(t.satirlar.some((s) => s.anahtar === 'yonetime odenen')); assert.ok(!t.satirlar.some((s) => /personel/.test(s.anahtar)));
  assert.ok(t.satirlar.every((s) => s.dolu === 0));
  const r = await xlsxOku(xlsxYaz([{ ad: 'G', satirlar: [['Kalem', { t: 'tarih', v: '2026-03-01' }, { t: 'tarih', v: '2026-04-01' }], ['Kira', 10, 20]] }]).buffer.slice(0));
  assert.equal(giderTablosu(r.satirlar).satirlar[0].toplam, 30);
});

test('kârlılık: Excel "Yönetime ödenen" yönetim gideridir ve işaretli personel maliyetiyle çift sayılmaz', () => {
  const g = {
    ay: '2026-10-01', firmalar: [{ id: 'f1', name: 'Alfa' }],
    faturalar: [{ company_id: 'f1', amount_excl_vat: 10000, invoice_date: '2026-10-05', service_period: '2026-10-01' }],
    personeller: [{ id: 'e1', full_name: 'Yönetici Uzman', staff_type: 'is_guvenligi_uzmani', is_management: true, is_active: true, monthly_capacity_min: 11700 }],
    maliyetler: [{ employee_id: 'e1', valid_from: '2026-01-01', valid_to: null, gross_salary: 3000, employer_sgk: 600, other_benefits: 0, total_monthly_cost: 3600 }],
    kategoriler: [{ id: 'ky', name: 'Yönetime ödenen', is_management_pay: true }, { id: 'kk', name: 'Kira' }],
    giderler: [{ category_id: 'ky', expense_date: '2026-10-01', amount_excl_vat: 5000, cost_type: 'ortak' }, { category_id: 'kk', expense_date: '2026-10-01', amount_excl_vat: 1000, cost_type: 'ortak' }],
  };
  const r = hesaplaKarlilik(g);
  assert.equal(r.isletme.yonetimPersonel, 5000); assert.equal(r.isletme.ortakHavuz, 6000);
  assert.equal(r.ortak.find((x) => x.kategoriId === YONETIM_KATEGORI).havuz, 5000);
  assert.ok(r.uyarilar.some((u) => u.includes('çift sayılmaması')));
  assert.ok(!r.ortak.some((x) => x.kategoriId === 'ky'));
  // Excel tutarı yoksa eski davranış
  const r2 = hesaplaKarlilik({ ...g, giderler: [] }); assert.equal(r2.isletme.yonetimPersonel, 3600);
});
