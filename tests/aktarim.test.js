import test from 'node:test';
import assert from 'node:assert/strict';
import { csvUret, csvAyristir, csvTablo } from '../src/lib/csv.js';
import {
  VERI_KUMELERI, RAPORLAR, FIRMA_ALANLARI, KISI_ALANLARI, otomatikEsle, baslikAnahtari, firmaSatirlariniDogrula, kisiSatirlariniDogrula,
  dogrulamaOzeti, hataRaporu, tamSayiAyristir, tehlikeAyristir, evetHayirAyristir, SABLONLAR,
} from '../src/lib/aktarim.js';

const BUGUN = '2026-10-28';
const firmalar = [
  { id: 'f1', name: 'Alfa Gıda A.Ş.', tax_no: '1111111111', sector: 'Gıda', city: 'Ankara', customer_status: 'musteri', created_at: '2026-10-05T10:00:00Z', notes: '=EVIL()' },
  { id: 'f2', name: 'Beta İnşaat', tax_no: '2222222222', customer_status: 'musteri', created_at: '2026-09-05T10:00:00Z' },
  { id: 'f3', name: 'Gama Eski', tax_no: null, customer_status: 'eski_musteri', created_at: '2025-01-01T10:00:00Z' },
  { id: 'f4', name: 'Arşiv Ltd', tax_no: '4444444444', customer_status: 'musteri', archived_at: '2026-01-01T00:00:00Z', created_at: '2024-01-01T10:00:00Z' },
];
const profiller = [
  { company_id: 'f1', employee_count: 50, hazard_class: 'tehlikeli', valid_from: '2020-01-01', valid_to: null },
  { company_id: 'f2', employee_count: 30, hazard_class: 'cok_tehlikeli', valid_from: '2020-01-01', valid_to: null },
];
const kisiler = [{ id: 'k1', company_id: 'f1', full_name: 'Ayşe Yılmaz', email: 'ayse@alfa.com', is_decision_maker: true }];
const sozlesmeler = [
  { id: 's1', company_id: 'f1', start_date: '2026-01-01', end_date: '2026-12-31', status: 'aktif', expert_service: true, physician_service: false },
  { id: 's2', company_id: 'f2', start_date: '2025-11-15', end_date: '2026-11-15', status: 'aktif', expert_service: true, physician_service: true },
  { id: 's3', company_id: 'f3', start_date: '2024-01-01', end_date: '2025-01-01', status: 'sona_erdi' },
];
const faturalar = [
  { id: 'i1', company_id: 'f1', invoice_no: 'F-2026-0001', invoice_date: '2026-10-02', due_date: '2026-10-12', amount_excl_vat: 1000, vat_amount: 200 },
  { id: 'i2', company_id: 'f2', invoice_no: 'F-2026-0002', invoice_date: '2026-08-02', due_date: '2026-08-12', amount_excl_vat: 500, vat_amount: 100 },
  { id: 'i3', company_id: 'f2', invoice_no: 'F-2026-0003', invoice_date: '2026-10-20', due_date: '2026-11-20', amount_excl_vat: 100, vat_amount: 20 },
  { id: 'i4', company_id: 'f1', invoice_no: 'F-2026-0004', invoice_date: '2026-10-21', due_date: '2026-10-25', amount_excl_vat: 999, vat_amount: 0, archived_at: '2026-10-22T00:00:00Z' },
];
const tahsilatlar = [
  { id: 'p1', invoice_id: 'i1', amount: 200, paid_at: '2026-10-10' },
  { id: 'p2', invoice_id: 'i2', amount: 600, paid_at: '2026-10-11' },
  { id: 'p3', invoice_id: 'i3', amount: 50, paid_at: '2026-10-22', archived_at: '2026-10-23T00:00:00Z' },
];
const kategoriler = [{ id: 'c1', name: 'Kira' }, { id: 'c2', name: 'Yakıt' }];
const giderler = [
  { id: 'g1', category_id: 'c1', expense_date: '2026-10-03', amount_excl_vat: 3000, vat_amount: 600, cost_type: 'ortak', paid: true },
  { id: 'g2', category_id: 'c2', expense_date: '2026-10-09', amount_excl_vat: 400.1, vat_amount: 80.02, cost_type: 'dogrudan', company_id: 'f1', paid: false },
  { id: 'g3', category_id: 'c2', expense_date: '2026-09-09', amount_excl_vat: 111, vat_amount: 0, cost_type: 'ortak', paid: true },
  { id: 'g4', category_id: 'c1', expense_date: '2026-10-04', amount_excl_vat: 7, vat_amount: 0, cost_type: 'ortak', archived_at: '2026-10-05T00:00:00Z' },
];
const veri = { firmalar, profiller, kisiler, sozlesmeler, faturalar, tahsilatlar, giderler, kategoriler, bugun: BUGUN };

test('tüm dışa aktarma kümelerinde her satır başlık sayısı kadar sütun içerir', () => {
  for (const k of VERI_KUMELERI) {
    const satirlar = k.satirlar(veri);
    assert.ok(satirlar.length > 0, k.id);
    for (const s of satirlar) assert.equal(s.length, k.basliklar.length, `${k.id}: ${s.join('|')}`);
  }
});

test('fatura dışa aktarımı: tahsilat/kalan/durum doğru, arşivli fatura "Arşivde" işaretli', () => {
  const k = VERI_KUMELERI.find((x) => x.id === 'faturalar'); const s = k.satirlar(veri);
  const i1 = s.find((r) => r[0] === 'F-2026-0001'); // 1200 - 200 = 1000 kalan, vade 12 Ekim → 16 gün
  assert.deepEqual([i1[7], i1[8], i1[9], i1[10], i1[11]], [1200, 200, 1000, 'Tahsil edilmedi'.replace('Tahsil edilmedi', 'Kısmi tahsilat'), 16]);
  const i2 = s.find((r) => r[0] === 'F-2026-0002'); // 600 - 600 = 0, fazla yok
  assert.deepEqual([i2[9], i2[10], i2[11]], [0, 'Tahsil edildi', 0]);
  assert.equal(s.find((r) => r[0] === 'F-2026-0004')[12], 'Arşivde');
  const i3 = s.find((r) => r[0] === 'F-2026-0003'); // iptal edilen tahsilat sayılmaz
  assert.equal(i3[9], 120);
});

test('dışa aktarılan CSV formül enjeksiyonuna karşı güvenlidir', () => {
  const k = VERI_KUMELERI.find((x) => x.id === 'firmalar');
  const csv = csvUret(k.basliklar, k.satirlar(veri));
  const { satirlar } = csvAyristir(csv);
  const alfa = satirlar.find((r) => r[0] === 'Alfa Gıda A.Ş.');
  assert.equal(alfa[13], "'=EVIL()");
});

test('firma dışa aktar → içe aktar gidiş-dönüşü: tüm başlıklar eşleşir, aynı firmalar mükerrer çıkar, boş kurumda hepsi hazır', () => {
  const k = VERI_KUMELERI.find((x) => x.id === 'firmalar');
  const { satirlar } = csvAyristir(csvUret(k.basliklar, k.satirlar(veri)));
  const { basliklar, kayitlar } = csvTablo(satirlar);
  const esleme = otomatikEsle(basliklar, FIRMA_ALANLARI);
  assert.equal(esleme.filter(Boolean).length, 14, 'Kayıt durumu hariç tüm sütunlar eşleşmeli');
  assert.equal(esleme[basliklar.indexOf('Kayıt durumu')], '');
  const ayni = firmaSatirlariniDogrula({ kayitlar, esleme, mevcutFirmalar: firmalar });
  const durumlar = Object.fromEntries(ayni.map((x, i) => [kayitlar[i].hucreler[0], x.durum]));
  assert.deepEqual(durumlar, { 'Alfa Gıda A.Ş.': 'mukerrer', 'Arşiv Ltd': 'hazir', 'Beta İnşaat': 'mukerrer', 'Gama Eski': 'mukerrer' });
  const bos = firmaSatirlariniDogrula({ kayitlar, esleme, mevcutFirmalar: [] });
  assert.deepEqual(dogrulamaOzeti(bos), { toplam: 4, hazir: 4, mukerrer: 0, hata: 0 });
  const alfa = bos.find((s) => s.firma.name === 'Alfa Gıda A.Ş.');
  assert.deepEqual(alfa.profil, { calisanSayisi: 50, tehlike: 'tehlikeli' });
  assert.equal(alfa.firma.customer_status, 'musteri');
  assert.equal(bos.find((s) => s.firma.name === 'Gama Eski').firma.customer_status, 'eski_musteri');
});

test('otomatik eşleştirme Türkçe/aksanlı/farklı yazımlı başlıkları tanır, bir alan bir sütuna eşlenir', () => {
  assert.equal(baslikAnahtari('Çalışan Sayısı'), 'calisansayisi');
  assert.equal(baslikAnahtari('E-POSTA'), 'eposta');
  assert.equal(baslikAnahtari('İL'), 'il');
  const e = otomatikEsle(['ŞİRKET', 'VKN', 'Şehir', 'il', 'E-Posta', 'Bilinmeyen', 'TEHLİKE'], FIRMA_ALANLARI);
  assert.deepEqual(e, ['name', 'tax_no', 'city', '', 'email', '', 'hazard_class']);
});

test('firma doğrulama: zorunlu ad, geçersiz e-posta/telefon/web, yanlış sayı ve sınıf, eksik çift', () => {
  const kay = (h) => ({ satirNo: 2, hucreler: h });
  const esleme = ['name', 'tax_no', 'email', 'phone', 'website', 'employee_count', 'hazard_class', 'customer_status'];
  const d = (h) => firmaSatirlariniDogrula({ kayitlar: [kay(h)], esleme, mevcutFirmalar: [] })[0];
  assert.match(d(['', '', '', '', '', '', '', '']).hatalar[0], /Firma adı boş/);
  assert.ok(d(['X', '', 'abc', '', '', '', '', '']).hatalar.some((x) => /E-posta/.test(x)));
  assert.ok(d(['X', '', '', '12', '', '', '', '']).hatalar.some((x) => /Telefon/.test(x)));
  assert.ok(d(['X', '', '', '', 'javascript:alert(1)', '', '', '']).hatalar.some((x) => /Web sitesi/.test(x)));
  assert.ok(d(['X', '', '', '', '', '12,5', 'Tehlikeli', '']).hatalar.some((x) => /tam sayı/.test(x)));
  assert.ok(d(['X', '', '', '', '', '-3', 'Tehlikeli', '']).hatalar.some((x) => /tam sayı/.test(x)));
  assert.ok(d(['X', '', '', '', '', '10', '', '']).hatalar.some((x) => /tehlike sınıfı da girilmelidir/.test(x)));
  assert.ok(d(['X', '', '', '', '', '10', 'Süper', '']).hatalar.some((x) => /Tehlike sınıfı/.test(x)));
  assert.ok(d(['X', '', '', '', '', '', '', 'pasif']).hatalar.some((x) => /Müşteri durumu/.test(x)));
  const iyi = d(['X Ltd', '123.456.789-0', 'a@b.co', '0312 123 45 67', 'ornek.com', '1.250', 'çok tehlikeli', 'eski müşteri']);
  assert.equal(iyi.durum, 'hazir');
  assert.equal(iyi.firma.tax_no, '1234567890');
  assert.deepEqual(iyi.profil, { calisanSayisi: 1250, tehlike: 'cok_tehlikeli' });
  assert.equal(iyi.firma.customer_status, 'eski_musteri');
  assert.ok(d(['X', '12345', '', '', '', '', '', '']).uyarilar.some((x) => /5 haneli/.test(x)));
  assert.ok(d(['X', '', '', '', '', '', 'Tehlikeli', '']).uyarilar.some((x) => /yok sayıldı/.test(x)));
});

test('firma mükerrer: kayıtlı vergi no / ad, dosya içi tekrar; arşivdeki yalnızca uyarı', () => {
  const kayitlar = [
    { satirNo: 2, hucreler: ['Yeni Firma', '1111111111'] },        // vergi no Alfa'da var
    { satirNo: 3, hucreler: ['beta   İNŞAAT', ''] },                // ad aynı (büyük/küçük, boşluk, İ)
    { satirNo: 4, hucreler: ['Delta', '5555555555'] },              // hazır
    { satirNo: 5, hucreler: ['Delta Kopya', '5555555555'] },        // dosyada aynı vergi no
    { satirNo: 6, hucreler: ['DELTA', ''] },                        // dosyada aynı ad
    { satirNo: 7, hucreler: ['Yeni Arşivli', '4444444444'] },       // arşivde var → hazır + uyarı
  ];
  const r = firmaSatirlariniDogrula({ kayitlar, esleme: ['name', 'tax_no'], mevcutFirmalar: firmalar });
  assert.deepEqual(r.map((x) => x.durum), ['mukerrer', 'mukerrer', 'hazir', 'mukerrer', 'mukerrer', 'hazir']);
  assert.match(r[0].nedenMukerrer, /Alfa Gıda/);
  assert.match(r[3].nedenMukerrer, /4\. satırda/);
  assert.match(r[4].nedenMukerrer, /4\. satırda/);
  assert.ok(r[5].uyarilar.some((x) => /arşivdeki/.test(x)));
  assert.deepEqual(dogrulamaOzeti(r), { toplam: 6, hazir: 2, mukerrer: 4, hata: 0 });
});

test('kişi doğrulama: firma vergi no veya adla bulunur; bulunamayan, belirsiz ad ve mükerrer kişi', () => {
  const ikiAyni = [...firmalar, { id: 'f9', name: 'Beta İnşaat', tax_no: '9999999999', customer_status: 'musteri' }];
  const kay = (n, h) => ({ satirNo: n, hucreler: h });
  const esleme = ['full_name', 'company', 'company_tax_no', 'email', 'is_decision_maker'];
  const r = kisiSatirlariniDogrula({
    kayitlar: [
      kay(2, ['Veli Demir', 'Alfa Gıda A.Ş.', '', 'veli@alfa.com', 'Evet']),     // hazır, firma adıyla
      kay(3, ['Can Aksoy', '', '1111111111', '', '']),                          // hazır, vergi noyla
      kay(4, ['Ayşe Yılmaz', 'Alfa Gıda A.Ş.', '', 'ayse@alfa.com', '']),        // kayıtlı
      kay(5, ['Yeni Kişi', 'Olmayan Ltd', '', '', '']),                         // firma yok
      kay(6, ['Belirsiz', 'Beta İnşaat', '', '', '']),                          // iki firma aynı ad
      kay(7, ['Veli Demir', 'Alfa Gıda A.Ş.', '', 'veli@alfa.com', '']),        // dosyada tekrar
      kay(8, ['Kötü', 'Alfa Gıda A.Ş.', '', 'kotu', 'belki']),                  // hata
      kay(9, ['Arşivde Firma', 'Arşiv Ltd', '', '', '']),                       // arşiv firma sayılmaz
      kay(10, ['', 'Alfa Gıda A.Ş.', '', '', '']),                              // ad yok
      kay(11, ['Firmasız', '', '', '', '']),                                    // firma bilgisi yok
    ],
    esleme, mevcutFirmalar: ikiAyni, mevcutKisiler: kisiler,
  });
  assert.deepEqual(r.map((x) => x.durum), ['hazir', 'hazir', 'mukerrer', 'hata', 'hata', 'mukerrer', 'hata', 'hata', 'hata', 'hata']);
  assert.equal(r[0].kisi.company_id, 'f1'); assert.equal(r[0].kisi.is_decision_maker, true);
  assert.equal(r[1].kisi.company_id, 'f1');
  assert.match(r[4].hatalar[0], /birden çok firma/);
  assert.match(r[3].hatalar[0], /bulunamadı/);
  assert.match(r[8].hatalar[0], /Ad soyad boş/);
  assert.match(r[9].hatalar[0], /Firma bilgisi yok/);
});

test('hata raporu: yalnızca hatalı ve mükerrer satırları, açıklama ve özgün hücrelerle verir', () => {
  const kayitlar = [{ satirNo: 2, hucreler: ['', 'x'] }, { satirNo: 3, hucreler: ['Alfa Gıda A.Ş.', ''] }, { satirNo: 4, hucreler: ['Yeni', ''] }];
  const r = firmaSatirlariniDogrula({ kayitlar, esleme: ['name', 'tax_no'], mevcutFirmalar: firmalar });
  const h = hataRaporu(r, kayitlar, ['Firma adı', 'Vergi no']);
  assert.deepEqual(h.basliklar, ['Satır', 'Durum', 'Açıklama', 'Firma adı', 'Vergi no']);
  assert.equal(h.satirlar.length, 2);
  assert.deepEqual(h.satirlar.map((s) => [s[0], s[1]]), [[2, 'Hata'], [3, 'Mükerrer']]);
});

test('değer ayrıştırıcılar', () => {
  assert.equal(tamSayiAyristir('1.250'), 1250); assert.equal(tamSayiAyristir('12'), 12); assert.equal(tamSayiAyristir(''), null);
  for (const k of ['1,5', '-1', 'abc', '1.25', '1e3']) assert.equal(tamSayiAyristir(k), undefined, k);
  assert.equal(tehlikeAyristir('AZ TEHLİKELİ'), 'az_tehlikeli'); assert.equal(tehlikeAyristir('Çok Tehlikeli'), 'cok_tehlikeli'); assert.equal(tehlikeAyristir(''), null); assert.equal(tehlikeAyristir('x'), undefined);
  assert.equal(evetHayirAyristir('EVET'), true); assert.equal(evetHayirAyristir('Hayır'), false); assert.equal(evetHayirAyristir(''), false); assert.equal(evetHayirAyristir('belki'), undefined);
});

test('şablonlar kendi doğrulayıcımızdan hatasız geçer', () => {
  const f = SABLONLAR.firmalar; const e = otomatikEsle(f.basliklar, FIRMA_ALANLARI);
  assert.equal(e.filter(Boolean).length, FIRMA_ALANLARI.length);
  const r = firmaSatirlariniDogrula({ kayitlar: [{ satirNo: 2, hucreler: f.ornek.map(String) }], esleme: e, mevcutFirmalar: [] });
  assert.equal(r[0].durum, 'hazir', r[0].hatalar.join(' '));
  const k = SABLONLAR.kisiler; const ek = otomatikEsle(k.basliklar, KISI_ALANLARI);
  assert.equal(ek.filter(Boolean).length, KISI_ALANLARI.length);
  const orn = { id: 'x', name: 'Örnek Gıda A.Ş.', tax_no: '1234567890' };
  const rk = kisiSatirlariniDogrula({ kayitlar: [{ satirNo: 2, hucreler: k.ornek.map(String) }], esleme: ek, mevcutFirmalar: [orn], mevcutKisiler: [] });
  assert.equal(rk[0].durum, 'hazir', rk[0].hatalar.join(' '));
});

const rapor = (id, ay = '2026-10-01') => RAPORLAR.find((r) => r.id === id).uret(veri, ay);

test('aylık yönetici özeti rakamları', () => {
  const s = Object.fromEntries(rapor('yonetici-ozeti').satirlar);
  assert.equal(s['Aktif firma sayısı (bugün)'], 2);                      // f1, f2 (f3 eski, f4 arşiv)
  assert.equal(s['Ay içinde eklenen firma'], 1);                         // f1
  assert.equal(s['Ayda geçerli aktif sözleşme'], 2);
  assert.equal(s['Kesilen fatura adedi'], 2);                            // i1, i3 (i4 arşiv, i2 ağustos)
  assert.equal(s['Kesilen fatura toplamı (KDV hariç)'], 1100);
  assert.equal(s['Kesilen fatura toplamı (KDV dahil)'], 1320);
  assert.equal(s['Ay içinde tahsil edilen (KDV dahil)'], 800);           // p1+p2, iptal p3 hariç
  assert.equal(s['Vadesi geçmiş açık alacak (bugün, KDV dahil)'], 1000); // i1: 1000 kalan, vade geçti
  assert.equal(s['Vadesi geçmiş fatura adedi (bugün)'], 1);
  assert.equal(s['Ay gideri (KDV hariç)'], 3400.1);
});

test('tahsilat yaşlandırma: kovalara dağılım ve toplam', () => {
  const r = rapor('yaslandirma');
  assert.equal(r.satirlar.length, 2);
  const alfa = r.satirlar.find((x) => x[0] === 'Alfa Gıda A.Ş.');   // 1000, 16 gün → 1-30
  assert.deepEqual(alfa.slice(1), [1, 0, 1000, 0, 0, 0, 1000]);
  const beta = r.satirlar.find((x) => x[0] === 'Beta İnşaat');       // i2 tamamen ödendi; i3 120 vadesi gelmemiş
  assert.deepEqual(beta.slice(1), [1, 120, 0, 0, 0, 0, 120]);
  assert.deepEqual(r.toplam, ['Toplam', 2, 120, 1000, 0, 0, 0, 1120]);
  assert.ok(r.satirlar[0][7] >= r.satirlar[1][7], 'büyükten küçüğe sıralı');
});

test('sözleşme bitiş raporu: yalnızca aktifler, kalan güne göre sıralı, uyarı etiketi', () => {
  const r = rapor('sozlesme-bitis');
  assert.deepEqual(r.satirlar.map((x) => x[0]), ['Beta İnşaat', 'Alfa Gıda A.Ş.']);
  assert.equal(r.satirlar[0][3], 18);               // 15 Kasım - 28 Ekim
  assert.equal(r.satirlar[0][4], '30 gün içinde');
  assert.equal(r.satirlar[1][4], '90 gün içinde');
});

test('müşteri portföyü ve gider kategori raporu', () => {
  const p = rapor('portfoy');
  assert.deepEqual(p.satirlar, [['Az tehlikeli', 0, 0], ['Tehlikeli', 1, 50], ['Çok tehlikeli', 1, 30]]);
  assert.deepEqual(p.toplam, ['Toplam', 2, 80]);
  const g = rapor('gider-kategori');
  assert.deepEqual(g.satirlar, [['Kira', 1, 3000, 600, 3600], ['Yakıt', 1, 400.1, 80.02, 480.12]]);
  assert.deepEqual(g.toplam, ['Toplam', 2, 3400.1, 680.02, 4080.12]);
  assert.equal(RAPORLAR.find((r) => r.id === 'gider-kategori').uret(veri, '2026-08-01').satirlar.length, 0);
});

test('boş veriyle raporlar ve dışa aktarma kümeleri hata vermez', () => {
  const bos = { firmalar: [], profiller: [], kisiler: [], sozlesmeler: [], faturalar: [], tahsilatlar: [], giderler: [], kategoriler: [], bugun: BUGUN };
  for (const r of RAPORLAR) { const o = r.uret(bos, '2026-10-01'); assert.ok(o.basliklar.length); for (const s of o.satirlar) assert.equal(s.length, o.basliklar.length); if (o.toplam) assert.equal(o.toplam.length, o.basliklar.length); }
  for (const k of VERI_KUMELERI) assert.deepEqual(k.satirlar(bos), []);
});
