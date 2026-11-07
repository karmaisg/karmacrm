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

test('Excel personel gideri esas alınır: kart maliyeti ayrıca eklenmez, kartlar yalnız paylaştırma oranıdır', () => {
  const r = hesaplaKarlilik({ ...temel, giderler: [gider('m', 'k-maas', 40000, { cost_type: 'dogrudan', employee_id: 'u1' }), gider('v', 'k-vergi', 1000)] });
  assert.equal(r.isletme.personel, 40000);                       // kartlardaki 70.000 değil, Giderler menüsündeki 40.000
  assert.equal(r.isletme.excelPersonel, 40000);
  const u = r.personel.find((p) => p.id === 'u1'); const h = r.personel.find((p) => p.id === 'h1');
  assert.equal(u.maliyet + h.maliyet, 40000); assert.equal(u.maliyet, 22857.14);   // 40.000 : 30.000 oranı
  assert.equal(r.isletme.kayitliVergi, 1000); assert.equal(r.isletme.ortakHavuz, 0);
  assert.equal(r.isletme.toplamGider, 41000);                    // Giderler menüsü toplamı (vergi kategorisi dahil)
  assert.equal(r.isletme.vergiOncesiKar, 40000 - 40000);
});

test('Excel personel gideri yoksa kart maliyetleri kullanılır', () => {
  const r = hesaplaKarlilik({ ...temel, giderler: [gider('v', 'k-vergi', 1000)] });
  assert.equal(r.isletme.personel, 70000); assert.equal(r.isletme.excelPersonel, 0); assert.equal(r.isletme.toplamGider, 71000);
});

test('toplam gider, Giderler menüsünün KDV hariç toplamına eşit: bağlanmamış doğrudan gider ortak havuza girer', () => {
  const g = [gider('m', 'k-maas', 40000), gider('d', 'k-ortak', 500, { cost_type: 'dogrudan' }), gider('o', 'k-ortak', 300), gider('v', 'k-vergi', 1000)];
  const r = hesaplaKarlilik({ ...temel, giderler: g });
  assert.equal(r.isletme.toplamGider, 40000 + 500 + 300 + 1000);
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

test('yönetim gideri işaretli personelin maliyeti firmalara değil, ortak gider havuzuna yazılır', async () => {
  const { hesaplaKarlilik, YONETIM_KATEGORI } = await import('../src/lib/karlilik.js');
  const g = {
    ay: '2026-10-01', firmalar: [{ id: 'f1', name: 'Alfa' }],
    faturalar: [{ company_id: 'f1', amount_excl_vat: 10000, invoice_date: '2026-10-05', service_period: '2026-10-01' }],
    personeller: [{ id: 'e1', full_name: 'Sekreter', staff_type: null, role_kind: 'sekreter', is_management: true, is_active: true, monthly_capacity_min: 11700 },
      { id: 'e2', full_name: 'Uzman', staff_type: 'is_guvenligi_uzmani', is_management: false, is_active: true, monthly_capacity_min: 11700 }],
    maliyetler: [{ employee_id: 'e1', valid_from: '2026-01-01', valid_to: null, gross_salary: 3000, employer_sgk: 600, other_benefits: 0, total_monthly_cost: 3600 },
      { employee_id: 'e2', valid_from: '2026-01-01', valid_to: null, gross_salary: 5000, employer_sgk: 1000, other_benefits: 0, total_monthly_cost: 6000 }],
  };
  const r = hesaplaKarlilik(g);
  assert.equal(r.isletme.yonetimPersonel, 3600);
  assert.equal(r.isletme.personel, 6000);            // yalnızca yönetim dışı personel
  assert.equal(r.isletme.ortakHavuz, 3600);
  const o = r.ortak.find((x) => x.kategoriId === YONETIM_KATEGORI);
  assert.ok(o.sanal); assert.equal(o.dagitim.f1, 3600);   // tek firma: tamamı ona
  assert.equal(r.firmalar.find((f) => f.id === 'f1').ortak, 3600);
  assert.equal(r.isletme.vergiOncesiKar, 10000 - 6000 - 3600);
  assert.equal(r.personel.find((p) => p.id === 'e1'), undefined);     // yönetim personeli kârlılık listesinde yok
  assert.deepEqual(r.yonetimPersonel.map((p) => p.id), ['e1']);
});

test('ayrılış tarihinden sonraki aylarda personel kârlılığında ve maliyette yer almaz; ayrılış ayında yer alır', () => {
  const ayrilan = { id: 'u2', full_name: 'Ayrılan', staff_type: 'is_guvenligi_uzmani', monthly_capacity_min: 1000, is_active: false, end_date: '2026-09-15' };
  const mal = [...maliyetler, maliyet('u2', 20000)];
  let r = hesaplaKarlilik({ ...temel, personeller: [...personeller, ayrilan], maliyetler: mal });                 // ekim: ayrılıştan sonra
  assert.equal(r.personel.find((p) => p.id === 'u2'), undefined); assert.equal(r.isletme.personel, 70000);
  r = hesaplaKarlilik({ ...temel, ay: '2026-09-01', personeller: [...personeller, ayrilan], maliyetler: mal, faturalar: [] });   // eylül: ayrılış ayı
  assert.ok(r.personel.find((p) => p.id === 'u2'));
});

test('KDV 0 spot iş ve elden gelir vergi tahminine dahil edilmez; kâra ve gelire dahildir', () => {
  const ek = [fat('s1', null, 1000, '2026-10-10', { income_kind: 'spot', vat_amount: 0 }), fat('s2', null, 500, '2026-10-11', { income_kind: 'elden', vat_amount: 0 }), fat('s3', null, 400, '2026-10-12', { income_kind: 'spot', vat_amount: 80 })];
  const buyuk = [...faturalar, fat('big', 'f1', 100000)];   // vergiye tabi kâr oluşsun
  const a = hesaplaKarlilik({ ...temel, faturalar: buyuk }); const b = hesaplaKarlilik({ ...temel, faturalar: [...buyuk, ...ek] });
  assert.equal(b.isletme.gelir, a.isletme.gelir + 1900);
  assert.equal(b.isletme.vergisizGelir, 1500);
  assert.equal(b.isletme.vergiOncesiKar, a.isletme.vergiOncesiKar + 1900);
  // vergi, yalnızca vergiye tabi 400 TL'lik artıştan hesaplanır (varsayılan %25)
  assert.equal(Math.round((b.isletme.tahminiVergi - a.isletme.tahminiVergi) * 100) / 100, 100);
  assert.equal(b.isletme.vergiSonrasiKar, Math.round((b.isletme.vergiOncesiKar - b.isletme.tahminiVergi) * 100) / 100);
  assert.equal(b.firmalar.find((f) => f.id === null).ad, 'Firma dışı işler'); assert.equal(b.firmalar.find((f) => f.id === null).gelir, 1900);
});

test('ay içinde başlayan görevlendirme ve maliyet dönemi o aya dahil edilir (tam ay)', () => {
  const geç = [atama('g1', 'f1', 'u1', 'is_guvenligi_uzmani', 100)].map((a) => ({ ...a, valid_from: '2026-10-15' }));
  const mal = [{ employee_id: 'u1', total_monthly_cost: 40000, valid_from: '2026-10-10', valid_to: null }];
  const r = hesaplaKarlilik({ ...temel, atamalar: geç, maliyetler: mal, personeller: [personeller[0]] });
  const u = r.personel.find((p) => p.id === 'u1');
  assert.equal(u.maliyet, 40000); assert.equal(u.teorikDk, 1000); assert.ok(u.gelirPayi > 0);          // 1000 dk = 50 çalışan x 20 dk
  assert.equal(r.firmalar.find((f) => f.id === 'f1').personel > 0, true);
});

test('ayrılış tarihi girilmemiş pasif personel hiç listelenmez', () => {
  const pasif = { id: 'u3', full_name: 'Pasif', staff_type: 'is_guvenligi_uzmani', monthly_capacity_min: 1000, is_active: false, end_date: null };
  const r = hesaplaKarlilik({ ...temel, personeller: [...personeller, pasif], maliyetler: [...maliyetler, maliyet('u3', 9999)] });
  assert.equal(r.personel.find((p) => p.id === 'u3'), undefined);
});

test('bağlı firma: gelir, çalışan ve görevlendirme ana firmada tek firma gibi toplanır', () => {
  // f2 ve f3, f1'e bağlı: f1 = 50+25+25 = 100 çalışan; uzman ihtiyacı 2000 dk
  const bagli = firmalar.map((f) => (f.id === 'f1' ? f : { ...f, parent_company_id: 'f1' }));
  const r = hesaplaKarlilik({ ...temel, firmalar: bagli });
  const satirlar = r.firmalar.filter((f) => f.id !== null);
  assert.equal(satirlar.length, 1);
  assert.equal(satirlar[0].id, 'f1');
  assert.match(satirlar[0].ad, /\+2 bağlı firma/);
  assert.equal(satirlar[0].gelir, 40000);
  // toplam kâr bağlanmadan aynı kalır (yalnız satırlar birleşir)
  const ayri = hesaplaKarlilik(temel);
  assert.equal(r.isletme.gelir, ayri.isletme.gelir);
  assert.equal(r.isletme.personel, ayri.isletme.personel);
});

test('bağlı firma: pasif bağlı firmanın çalışan sayısı ana firmaya eklenir', () => {
  const bagli = [{ id: 'f1', name: 'Alfa' }, { id: 'f2', name: 'Beta', parent_company_id: 'f1', customer_status: 'eski_musteri' }];
  const r = hesaplaKarlilik({ ...temel, firmalar: bagli, profiller: [profil('f1', 50), profil('f2', 25)], faturalar: [fat('i1', 'f1', 20000), fat('i2', 'f2', 10000)],
    atamalar: [atama('a1', 'f1', 'u1', 'is_guvenligi_uzmani', 100), atama('a2', 'f2', 'u1', 'is_guvenligi_uzmani', 100)] });
  const f1 = r.firmalar.find((f) => f.id === 'f1');
  assert.equal(f1.gelir, 30000);
  assert.ok(!r.firmalar.some((f) => f.id === 'f2'));
});
