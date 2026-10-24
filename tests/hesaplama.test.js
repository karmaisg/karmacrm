// OSGB 360 - Hesaplama motoru testleri.  Çalıştırma:  node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  teorikDakika, firmaAylikIhtiyac, dagitPaylar, teorikDakikaMaliyeti, fiiliDakikaMaliyeti, kapasiteKullanimi,
  enBuyukKalanDagit, personelMaliyetiniDagit, kdvAyir, faturaBakiyesi, giderleriAyir, ortakGiderDagit,
  vergiSonrasiKar, teklifKarliligi, fiyatSenaryolari, hedefMarjliGelir, mukerrerleriBul, kurus,
} from '../src/lib/hesaplama.js';

// Kullanıcının mevcut parametreleri (service_time_rules ile aynı)
const KURALLAR = [
  ['is_guvenligi_uzmani', 'az_tehlikeli', 10], ['is_guvenligi_uzmani', 'tehlikeli', 20], ['is_guvenligi_uzmani', 'cok_tehlikeli', 40],
  ['isyeri_hekimi', 'az_tehlikeli', 5], ['isyeri_hekimi', 'tehlikeli', 10], ['isyeri_hekimi', 'cok_tehlikeli', 15],
].map(([staff_type, hazard_class, minutes_per_employee]) => ({ staff_type, hazard_class, minutes_per_employee, valid_from: '2000-01-01', valid_to: null }));

const yakin = (a, b, tol = 1e-4) => assert.ok(Math.abs(a - b) < tol, `${a} ≈ ${b} değil`);

test('Test 1: Tehlikeli sınıfta 30 çalışan -> uzman 600, hekim 300 dakika', () => {
  const g = { calisanSayisi: 30, tehlikeSinifi: 'tehlikeli', kurallar: KURALLAR, tarih: '2026-10-01' };
  assert.equal(teorikDakika({ ...g, personelTuru: 'is_guvenligi_uzmani' }).dakika, 600);
  assert.equal(teorikDakika({ ...g, personelTuru: 'isyeri_hekimi' }).dakika, 300);
});

test('Test 1b: diğer sınıflar da doğru (az: 10/5, çok: 40/15)', () => {
  const t = (sinif, tur) => teorikDakika({ calisanSayisi: 10, tehlikeSinifi: sinif, personelTuru: tur, kurallar: KURALLAR, tarih: '2026-10-01' }).dakika;
  assert.equal(t('az_tehlikeli', 'is_guvenligi_uzmani'), 100);
  assert.equal(t('az_tehlikeli', 'isyeri_hekimi'), 50);
  assert.equal(t('cok_tehlikeli', 'is_guvenligi_uzmani'), 400);
  assert.equal(t('cok_tehlikeli', 'isyeri_hekimi'), 150);
});

test('Kural yoksa hata fırlatmaz, eksik bilgi bildirir (uydurma sonuç yok)', () => {
  const r = teorikDakika({ calisanSayisi: 10, tehlikeSinifi: 'tehlikeli', personelTuru: 'isyeri_hekimi', kurallar: [], tarih: '2026-10-01' });
  assert.equal(r.dakika, null);
  assert.match(r.eksik, /geçerli süre kuralı yok/);
});

test('Test 2: 45.000 TL / 11.700 dk = 3,8462 TL', () => {
  yakin(teorikDakikaMaliyeti(45000, 11700), 3.8462, 5e-5);
  yakin(teorikDakikaMaliyeti(45000), 3.8462, 5e-5); // varsayılan kapasite 11.700
});

test('Test 3: Aynı müşteriye iki uzman atanırsa toplam süre iki kez sayılmaz', () => {
  const need = 600; // müşterinin toplam uzman ihtiyacı
  const r = dagitPaylar(need, [{ employee: 'U1', share_pct: 60 }, { employee: 'U2', share_pct: 40 }]);
  assert.equal(r.atanmisDakika, 600);
  assert.equal(r.atanmamisDakika, 0);
  assert.deepEqual(r.kisiler.map((k) => k.dakika), [360, 240]);
  // Paylar %100'ü aşarsa reddedilir (ikisi de %100 verilerek süre ikiye katlanamaz)
  assert.throws(() => dagitPaylar(need, [{ share_pct: 100 }, { share_pct: 100 }]), /%100/);
  // Eksik atamada kalan "atanmamış" olarak ayrı gösterilir
  const kismi = dagitPaylar(need, [{ share_pct: 70 }]);
  assert.equal(kismi.atanmisDakika, 420);
  assert.equal(kismi.atanmamisDakika, 180);
});

test('Test 3b: pay dağıtımı küsuratlı olsa da toplam ihtiyacı aşmaz', () => {
  const r = dagitPaylar(100, [{ share_pct: 33.33 }, { share_pct: 33.33 }, { share_pct: 33.34 }]);
  assert.ok(r.atanmisDakika <= 100);
  assert.equal(r.atanmisDakika + r.atanmamisDakika, 100);
});

test('Test 4: Bir uzman 5 müşteriye -> dağıtılan maliyet toplamı personel maliyetini aşmaz', () => {
  const musteriler = [3, 7, 11, 13, 17].map((agirlik, i) => ({ id: `M${i + 1}`, agirlik }));
  for (const maliyet of [45000, 45000.01, 33333.33, 100, 0.07]) {
    const dagitim = personelMaliyetiniDagit(maliyet, musteriler);
    const toplam = dagitim.reduce((t, m) => t + kurus(m.maliyet), 0);
    assert.equal(toplam, kurus(maliyet), `${maliyet} için toplam tam eşit olmalı`);
    assert.ok(toplam <= kurus(maliyet));
  }
});

test('Test 5: Kısmi tahsilatlarda kalan alacak doğru', () => {
  const fatura = { amount_excl_vat: 12000, vat_amount: 2400, due_date: '2026-09-30' };
  let r = faturaBakiyesi(fatura, [], '2026-10-23');
  assert.equal(r.kalan, 14400); assert.equal(r.durum, 'tahsil_edilmedi'); assert.equal(r.gecikmeGunu, 23);
  r = faturaBakiyesi(fatura, [{ amount: 5000 }, { amount: 3400 }], '2026-10-23');
  assert.equal(r.tahsilEdilen, 8400); assert.equal(r.kalan, 6000); assert.equal(r.durum, 'kismi_tahsilat');
  r = faturaBakiyesi(fatura, [{ amount: 5000 }, { amount: 3400 }, { amount: 6000 }], '2026-10-23');
  assert.equal(r.kalan, 0); assert.equal(r.durum, 'tahsil_edildi'); assert.equal(r.gecikmeGunu, 0);
  r = faturaBakiyesi(fatura, [{ amount: 15000 }], '2026-10-23');
  assert.equal(r.fazlaTahsilat, true); assert.equal(r.fazlaTutar, 600); // uyarı
  r = faturaBakiyesi({ ...fatura, flag: 'itirazli' }, [], '2026-10-23');
  assert.equal(r.durum, 'itirazli');
  // kuruşlu tutarlarda kayan nokta hatası yok
  const k = faturaBakiyesi({ amount_excl_vat: 0.1, vat_amount: 0.02, due_date: '2026-10-01' }, [{ amount: 0.1 }], '2026-10-23');
  assert.equal(k.kalan, 0.02);
});

test('Test 6: Doğrudan gider ortak havuza girmez (çift sayım yok)', () => {
  const giderler = [
    { cost_type: 'ortak', amount_excl_vat: 10000 },                          // kira
    { cost_type: 'dogrudan', company_id: 'A', amount_excl_vat: 3000 },       // A firmasına yakıt
  ];
  const r = giderleriAyir(giderler);
  assert.equal(r.ortakHavuz, 10000);           // 3.000 havuza eklenmedi
  assert.equal(r.dogrudanToplam, 3000);
  assert.equal(r.firmaBazliDogrudan.A, 3000);
  assert.equal(r.toplamGider, 13000);          // her tutar bir kez
  // Havuz dağıtılınca doğrudan gider tekrar düşülmez
  const d = ortakGiderDagit(r.ortakHavuz, [{ id: 'A', agirlik: 1 }, { id: 'B', agirlik: 1 }]);
  assert.equal(d.dagitim.reduce((t, x) => t + x.tutar, 0) + d.dagitilmamis, 10000);
  const aToplam = d.dagitim.find((x) => x.id === 'A').tutar + r.firmaBazliDogrudan.A;
  assert.equal(aToplam, 8000); // 5.000 ortak pay + 3.000 doğrudan
});

test('Test 6b: dağıtım ağırlığı yoksa tutar "dağıtılmamış" olarak ayrıca görünür', () => {
  const d = ortakGiderDagit(1000, [{ id: 'A', agirlik: 0 }]);
  assert.equal(d.dagitilmamis, 1000);
});

test('Test 7: KDV dahil / hariç karışmaz', () => {
  assert.deepEqual(kdvAyir(1200, 'kdv_dahil', 20), { haric: 1000, kdv: 200, dahil: 1200 });
  assert.deepEqual(kdvAyir(1000, 'kdv_haric', 20), { haric: 1000, kdv: 200, dahil: 1200 });
  // Aynı sayı iki modda farklı sonuç verir
  assert.notEqual(kdvAyir(1000, 'kdv_dahil', 20).haric, kdvAyir(1000, 'kdv_haric', 20).haric);
  // Teklifte gelir her zaman KDV HARİÇtir: 1.200 TL KDV dahil = 1.000 TL gelir
  const dahilTeklif = teklifKarliligi({ fiyatlama: 'sabit_aylik', sabitFiyat: 1200, kdvModu: 'kdv_dahil', kdvOrani: 20 });
  const haricTeklif = teklifKarliligi({ fiyatlama: 'sabit_aylik', sabitFiyat: 1000, kdvModu: 'kdv_haric', kdvOrani: 20 });
  assert.equal(dahilTeklif.aylikGelirKdvHaric, 1000);
  assert.equal(haricTeklif.aylikGelirKdvHaric, 1000);
  assert.equal(dahilTeklif.kdvTutari, 200);
  assert.throws(() => kdvAyir(100, 'karisik', 20));
});

test('Test 8: Fiilî hizmet dakikası 0 iken hata yok', () => {
  assert.equal(fiiliDakikaMaliyeti(45000, 0), null);
  assert.equal(fiiliDakikaMaliyeti(45000, -5), null);
  yakin(fiiliDakikaMaliyeti(45000, 9000), 5);
  assert.equal(kapasiteKullanimi(0), 0);
});

test('Test 9: Çalışan sayısı sonraki ay değişince geçmiş aylar bozulmaz', () => {
  const profiller = [
    { employee_count: 30, hazard_class: 'tehlikeli', valid_from: '2026-01-01', valid_to: '2026-03-31' },
    { employee_count: 45, hazard_class: 'tehlikeli', valid_from: '2026-04-01', valid_to: null },
  ];
  const ay = (a) => firmaAylikIhtiyac({ profiller, kurallar: KURALLAR, ay: a });
  assert.equal(ay('2026-01-15').uzmanDakika, 600);
  assert.equal(ay('2026-03-31').uzmanDakika, 600);
  assert.equal(ay('2026-04-01').uzmanDakika, 900);
  assert.equal(ay('2026-10-10').hekimDakika, 450);
  // Yeni bir profil eklemek (örn. Kasım'dan itibaren 60 çalışan) geçmişi değiştirmez
  const sonra = [...profiller.slice(0, 1), { ...profiller[1], valid_to: '2026-10-31' }, { employee_count: 60, hazard_class: 'cok_tehlikeli', valid_from: '2026-11-01', valid_to: null }];
  const ay2 = (a) => firmaAylikIhtiyac({ profiller: sonra, kurallar: KURALLAR, ay: a });
  assert.equal(ay2('2026-10-01').uzmanDakika, 900);
  assert.equal(ay2('2026-11-01').uzmanDakika, 2400);
  assert.equal(ay2('2026-01-01').uzmanDakika, ay('2026-01-01').uzmanDakika);
  // Profil yoksa uydurma değer üretilmez
  assert.equal(firmaAylikIhtiyac({ profiller: [], kurallar: KURALLAR, ay: '2026-10-01' }).uzmanDakika, null);
  // Çakışan profil dönemleri sessizce kabul edilmez
  assert.throws(() => firmaAylikIhtiyac({ profiller: [profiller[1], { ...profiller[1] }], kurallar: KURALLAR, ay: '2026-10-01' }), /çakışıyor/);
});

test('Test 9b: Kural (parametre) değişince eski aylar eski kuralla hesaplanır', () => {
  const kurallar = [
    ...KURALLAR.map((k) => (k.staff_type === 'is_guvenligi_uzmani' && k.hazard_class === 'tehlikeli' ? { ...k, valid_to: '2026-06-30' } : k)),
    { staff_type: 'is_guvenligi_uzmani', hazard_class: 'tehlikeli', minutes_per_employee: 25, valid_from: '2026-07-01', valid_to: null },
  ];
  const t = (tarih) => teorikDakika({ calisanSayisi: 30, tehlikeSinifi: 'tehlikeli', personelTuru: 'is_guvenligi_uzmani', kurallar, tarih }).dakika;
  assert.equal(t('2026-06-30'), 600);
  assert.equal(t('2026-07-01'), 750);
});

test('Test 10: Negatif kârda negatif vergi çıkmaz', () => {
  const zarar = vergiSonrasiKar({ gelir: 100000, giderler: 130000 });
  assert.equal(zarar.vergiOncesiKar, -30000);
  assert.equal(zarar.tahminiVergi, 0);
  assert.equal(zarar.vergiSonrasiKar, -30000);
  const kar = vergiSonrasiKar({ gelir: 200000, giderler: 100000 });
  assert.equal(kar.tahminiVergi, 25000);          // %25
  assert.equal(kar.vergiSonrasiKar, 75000);
  const ozel = vergiSonrasiKar({ gelir: 200000, giderler: 100000, kurumlarVergisiOrani: 20 });
  assert.equal(ozel.tahminiVergi, 20000);
  const sifir = vergiSonrasiKar({ gelir: 0, giderler: 0 });
  assert.equal(sifir.tahminiVergi, 0);
});

test('Test 10b: Giderlere önceden yazılmış kurumlar vergisi ikinci kez düşülmez', () => {
  // Giderler 125.000 TL, bunun 25.000 TL'si zaten "Kurumlar vergisi" olarak kayıtlı
  const r = vergiSonrasiKar({ gelir: 200000, giderler: 125000, kayitliKurumlarVergisi: 25000 });
  assert.equal(r.vergiOncesiKar, 100000);   // vergi giderden arındırılarak hesaplandı
  assert.equal(r.tahminiVergi, 25000);
  assert.equal(r.vergiSonrasiKar, 75000);
});

test('Teklif kârlılığı: kişi başı fiyat, marj eşiği uyarısı ve senaryolar', () => {
  const g = {
    fiyatlama: 'kisi_basi', birimFiyat: 500, calisanSayisi: 30, kdvModu: 'kdv_haric', kdvOrani: 20,
    uzmanMaliyeti: 6000, hekimMaliyeti: 3000, ulasimDigerMaliyet: 1000, marjEsigiYuzde: 20,
  };
  const r = teklifKarliligi(g);
  assert.equal(r.aylikGelirKdvHaric, 15000);
  assert.equal(r.toplamMaliyet, 10000);
  assert.equal(r.katkiKari, 5000);
  yakin(r.katkiMarji, 1 / 3);
  assert.equal(r.esikAltinda, false);
  const s = fiyatSenaryolari(g);
  assert.equal(s.indirimli.aylikGelirKdvHaric, 14250);  // %5 indirim
  assert.equal(s.hedefMarj.gerekenAylikGelirKdvHaric, 12500); // %20 marj için 10.000 / 0,8
  const dusuk = teklifKarliligi({ ...g, indirimYuzde: 30 });   // 10.500 gelir, 500 kâr -> %4,8
  assert.equal(dusuk.esikAltinda, true);
  assert.match(dusuk.uyari, /eşiğin/);
  // Gelir 0 ise bölme hatası yok
  assert.equal(teklifKarliligi({ ...g, birimFiyat: 0 }).katkiMarji, null);
  assert.equal(hedefMarjliGelir(10000, 100), null);
});

test('enBuyukKalanDagit: toplam her zaman tam eşit', () => {
  for (let n = 0; n < 200; n++) {
    const toplam = Math.floor(Math.random() * 1e7);
    const agirliklar = Array.from({ length: 1 + (n % 9) }, () => 1 + Math.floor(Math.random() * 100));
    const p = enBuyukKalanDagit(toplam, agirliklar);
    assert.equal(p.reduce((t, x) => t + x, 0), toplam);
    assert.ok(p.every((x) => x >= 0));
  }
  assert.deepEqual(enBuyukKalanDagit(100, []), []);
  assert.deepEqual(enBuyukKalanDagit(100, [0, 0]), [0, 0]);
});

test('Test 12 (motor kısmı): Aynı dosya tekrar aktarılınca mükerrerler yakalanır', () => {
  const mevcut = [{ name: 'Atlas Yapı', tax_no: '1111111111' }];
  const dosya = [
    { name: 'Atlas Yapı A.Ş.', tax_no: '111 111 1111' },   // vergi no aynı (boşluklu yazım)
    { name: 'Yeni Firma', tax_no: '3333333333' },
    { name: 'yeni  firma', tax_no: '3333333333' },        // dosya içinde tekrar
    { name: 'İSİMLİ  Firma', tax_no: '' },
    { name: 'isimli firma', tax_no: '' },                  // vergi no yok: ada göre (TR harf duyarsız)
  ];
  const r = mukerrerleriBul(dosya, mevcut);
  assert.deepEqual(r.map((x) => x.durum), ['mevcut_kayitla_cakisiyor', 'yeni', 'dosya_icinde_tekrar', 'yeni', 'dosya_icinde_tekrar']);
  // Aynı dosya ikinci kez, ilk aktarımdan sonra:
  const ilkAktarimSonrasi = [...mevcut, { name: 'Yeni Firma', tax_no: '3333333333' }, { name: 'İSİMLİ  Firma', tax_no: '' }];
  const ikinci = mukerrerleriBul(dosya, ilkAktarimSonrasi);
  assert.ok(ikinci.every((x) => x.durum !== 'yeni'), 'ikinci aktarımda hiçbir satır "yeni" olmamalı');
});
