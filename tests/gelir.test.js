import test from 'node:test';
import assert from 'node:assert/strict';
import { sayiOku, tarihOku, aciklamaAyristir, kalemleriCoz, gelirSatirlari, kdvOzeti, eslestir, varsayilanKararlar, bekleyenler, gelirPaketi, unutulanFaturalar } from '../src/lib/gelir.js';
import { xlsxOku } from '../src/lib/xlsx.js';
import { gelirSablonu, xlsxYaz, crc32 } from '../src/lib/xlsxyaz.js';

const BASLIK = ['Fatura No', 'Fatura Tarihi', 'Açıklama', 'Ücret', '%20 KDV', '%10 KDV', 'Toplam'];
const T = '2026-10-22T00:00:00';

test('sayı ve tarih okuma', () => {
  assert.equal(sayiOku('1.234,50'), 1234.5); assert.equal(sayiOku('1234.5'), 1234.5); assert.equal(sayiOku(12), 12); assert.equal(sayiOku(''), null); assert.equal(sayiOku(null), null);
  assert.equal(tarihOku('2026-10-22T00:00:00'), '2026-10-22'); assert.equal(tarihOku('22.10.2026'), '2026-10-22'); assert.equal(tarihOku('31.02.2026'), null); assert.equal(tarihOku(5), null);
});

test('açıklama: ay, aralık, eksik ay, ortada ay, yıl mantığı', () => {
  assert.deepEqual(aciklamaAyristir('Alfa Gıda (Eylül)', '2026-10-22'), { ad: 'Alfa Gıda', donem: '2026-09-01', donemNotu: null });
  assert.equal(aciklamaAyristir('Alfa (EKİM)', '2026-10-22').donem, '2026-10-01');
  assert.equal(aciklamaAyristir('Bide Gıda - Ataşe - (Ekim)', '2026-10-31').ad, 'Bide Gıda - Ataşe');
  assert.equal(aciklamaAyristir('X (Temmuz-Aralık)', '2026-10-22').donemNotu, 'aralik');
  assert.equal(aciklamaAyristir('X (Temmuz-Aralık)', '2026-10-22').donem, null);
  const yok = aciklamaAyristir('Klaus Sağlık tetkiki', '2026-10-22'); assert.equal(yok.donemNotu, 'yok'); assert.equal(yok.donem, '2026-10-01');
  assert.equal(aciklamaAyristir('Z Ekim', '2026-10-05').ad, 'Z');
  assert.equal(aciklamaAyristir('N (Ekim) kargo', '2026-10-05').ad, 'N kargo');
  assert.equal(aciklamaAyristir('Z (Aralık)', '2027-01-10').donem, '2026-12-01');
});

test('KDV: iki oran, tek oran, KDV yok, yanlış sütun, uyumsuzluk', () => {
  const iki = kalemleriCoz({ ucret: 1500, k20: 200, k10: 50, toplam: 1750 });
  assert.deepEqual(iki.kalemler.map((k) => [k.oran, k.haric, k.kdv]), [[20, 1000, 200], [10, 500, 50]]); assert.equal(iki.ortOran, 16.67); assert.equal(iki.uyari.length, 0);
  const b20 = kalemleriCoz({ ucret: 1000, k20: 200, k10: null, toplam: 1200 }); assert.equal(b20.kalemler.length, 1); assert.equal(b20.kalemler[0].oran, 20);
  const b10 = kalemleriCoz({ ucret: 1720, k20: null, k10: 172, toplam: 1892 }); assert.equal(b10.kalemler[0].oran, 10);
  const yok = kalemleriCoz({ ucret: 500, k20: null, k10: null, toplam: 500 }); assert.equal(yok.kalemler[0].oran, 0); assert.equal(yok.kdv, 0);
  const yanlis = kalemleriCoz({ ucret: 1000, k20: null, k10: 200, toplam: 1200 }); assert.equal(yanlis.kalemler[0].oran, 20); assert.equal(yanlis.uyari.length, 1);
  const tuhaf = kalemleriCoz({ ucret: 1000, k20: 150, k10: null, toplam: 1150 }); assert.equal(tuhaf.kalemler[0].oran, 15); assert.equal(tuhaf.uyari.length, 1);
  const fark = kalemleriCoz({ ucret: 1500, k20: 200, k10: 50, toplam: 1800 }); assert.ok(fark.uyari.some((u) => u.includes('Toplam')));
  const bosKdv = kalemleriCoz({ ucret: 100, k20: null, k10: null, toplam: 120 }); assert.ok(bosKdv.uyari.length >= 1);
});

const TABLO = [BASLIK,
  ['EFT-1', T, 'Alfa Gıda (Ekim)', 1500, 200, 50, 1750],
  ['EFT-2', T, 'Beta Teknik (Ekim)', 1000, 200, null, 1200],
  ['EFT-3', T, 'UKEM (Ekim)', 100, null, 10, 110],
  ['EFT-4', T, 'Bilinmeyen Boya (Ekim)', 400, 80, null, 480],
  ['EFT-5', T, 'Alfa Gıdaa (Ekim)', 400, 80, null, 480],
  ['', null, null, null, null, null, null],
  ['EFT-6', 'dün', 'Hatalı Tarih', 10, null, null, 10],
  ['EFT-7', T, 'Sıfır Tutar', 0, null, null, 0],
  ['EFT-1', T, 'Alfa Gıda (Ekim)', 10, null, null, 10]];

test('tablo ayrıştırma: satırlar, hatalar, tekrar, boş satır', () => {
  const { satirlar, hatalar } = gelirSatirlari(TABLO);
  assert.equal(satirlar.length, 6); assert.equal(hatalar.length, 2);
  assert.ok(hatalar.some((h) => h.includes('tarih'))); assert.ok(hatalar.some((h) => h.includes('Ücret')));
  assert.equal(satirlar[0].ortOran, 16.67); assert.equal(satirlar[5].tekrar, true);
  const oz = kdvOzeti(satirlar.filter((s) => !s.tekrar)); assert.equal(oz.adet, 5); assert.equal(oz.oranlar[20].kdv, 560); assert.equal(oz.oranlar[10].kdv, 60); assert.equal(oz.kdv, 620);
});

test('başlık bulunamazsa veya sütun eksikse anlaşılır hata', () => {
  assert.match(gelirSatirlari([['a', 'b']]).hatalar[0], /Başlık/);
  assert.match(gelirSatirlari([['Fatura No', 'Açıklama', 'Ücret']]).hatalar[0], /Fatura Tarihi/);
  const r = gelirSatirlari([['Rapor başlığı'], [], BASLIK, ['E1', T, 'Alfa (Ekim)', 100, 20, null, 120]]); assert.equal(r.satirlar.length, 1);
});

const FIRMALAR = [
  { id: 'f1', name: 'Alfa Gıda San. ve Tic. A.Ş.', customer_status: 'musteri' }, { id: 'f2', name: 'Beta Teknik Ltd. Şti.', customer_status: 'musteri' },
  { id: 'f3', name: 'Gama İnşaat', customer_status: 'musteri' }, { id: 'f4', name: 'Eski Firma', customer_status: 'eski_musteri' }, { id: 'f5', name: 'Arşiv Firma', customer_status: 'musteri', archived_at: '2026-01-01' }];
const SITELER = [{ id: 's1', company_id: 'f2', site_name: 'BETA ŞUBE', invoice_alias: 'UKEM' }];

test('eşleştirme: tam, işyeri takma adı, güçlü, olası, yok, kayıtlı alias', () => {
  const { satirlar } = gelirSatirlari(TABLO); const e = eslestir(satirlar, { firmalar: FIRMALAR, siteler: SITELER, aliaslar: [{ alias_key: 'bilinmeyen boya', company_id: 'f3', site_id: null }] });
  const al = (ad) => e.find((x) => x.ad === ad);
  assert.equal(al('Alfa Gıda').durum, 'tam'); assert.equal(al('Alfa Gıda').firma_id, 'f1');
  assert.equal(al('Beta Teknik').durum, 'tam');
  assert.equal(al('UKEM').durum, 'isyeri'); assert.equal(al('UKEM').firma_id, 'f2'); assert.equal(al('UKEM').site_id, 's1');
  assert.equal(al('Bilinmeyen Boya').durum, 'kayitli'); assert.equal(al('Bilinmeyen Boya').firma_id, 'f3');
  assert.ok(['guclu', 'olasi'].includes(al('Alfa Gıdaa').durum)); assert.equal(al('Alfa Gıdaa').adaylar[0].firma_id, 'f1');
  const yok = eslestir(gelirSatirlari([BASLIK, ['E', T, 'Zzz Kuyumculuk (Ekim)', 10, 2, null, 12]]).satirlar, { firmalar: FIRMALAR });
  assert.equal(yok[0].durum, 'yok'); assert.equal(yok[0].firma_id, null);
  assert.equal(eslestir(gelirSatirlari([BASLIK, ['E', T, 'Arşiv Firma (Ekim)', 10, 2, null, 12]]).satirlar, { firmalar: FIRMALAR })[0].durum, 'yok');
});

test('kararlar ve paket: bekleyen, yeni firma, yoksay, alias, tekrar satır dışarıda', () => {
  const { satirlar } = gelirSatirlari([...TABLO, ['EFT-8', T, 'Zzz Kuyumculuk (Ekim)', 10, 2, null, 12], ['EFT-9', T, 'Zzz Kuyumculuk (Eylül)', 10, 2, null, 12]]);
  const e = eslestir(satirlar, { firmalar: FIRMALAR, siteler: SITELER }); const k = varsayilanKararlar(e);
  const bek = bekleyenler(e, k).map((x) => x.ad); assert.ok(bek.includes('Zzz Kuyumculuk')); assert.ok(!bek.includes('Alfa Gıda'));
  k['zzz kuyumculuk'] = { tur: 'yeni', yeniAd: '  ' }; assert.ok(bekleyenler(e, k).some((x) => x.ad === 'Zzz Kuyumculuk'));
  k['zzz kuyumculuk'] = { tur: 'yeni', yeniAd: 'Zzz Kuyumculuk Ltd' };
  const bo = e.find((x) => x.ad === 'Bilinmeyen Boya'); k[bo.anahtar] = { tur: 'yoksay' };
  for (const x of bekleyenler(e, k)) k[x.anahtar] = { tur: 'esle', firma_id: x.adaylar[0].firma_id, site_id: null };
  assert.equal(bekleyenler(e, k).length, 0);
  const p = gelirPaketi({ satirlar, eslesmeler: e, kararlar: k, dosyaAdi: 'a.xlsx', vadeGun: 15 });
  assert.equal(p.vade_gun, 15); assert.equal(p.yeni_firmalar.length, 1); assert.equal(p.yeni_firmalar[0].ad, 'Zzz Kuyumculuk Ltd');
  const nolar = p.faturalar.map((f) => f.no); assert.ok(!nolar.includes('EFT-4')); assert.equal(nolar.filter((n) => n === 'EFT-1').length, 1);
  assert.equal(p.faturalar.filter((f) => f.yeni_firma).length, 2); assert.ok(p.faturalar.find((f) => f.no === 'EFT-8').alias_key);
  assert.equal(p.faturalar.find((f) => f.no === 'EFT-1').alias_key, undefined);
  assert.equal(p.faturalar.find((f) => f.no === 'EFT-3').site_id, 's1');
  assert.equal(p.faturalar.find((f) => f.no === 'EFT-1').kalemler.length, 2);
});

test('unutulan fatura: ana dönem, sözleşme, sistemdeki fatura, arşiv/eski müşteri', () => {
  const { satirlar } = gelirSatirlari(TABLO.slice(0, 4)); const e = eslestir(satirlar, { firmalar: FIRMALAR, siteler: SITELER }); const k = varsayilanKararlar(e);
  const soz = (id, bas = '2026-01-01', bit = '2026-12-31', status = 'aktif') => ({ company_id: id, start_date: bas, end_date: bit, status });
  const sozlesmeler = [soz('f1'), soz('f2'), soz('f3'), soz('f4'), soz('f5'), { ...soz('f3'), archived_at: 'x' }];
  const r = unutulanFaturalar({ satirlar, eslesmeler: e, kararlar: k, firmalar: FIRMALAR, sozlesmeler, faturalar: [] });
  assert.deepEqual(r.firmalar.map((x) => x.firma_id), ['f3']); assert.equal(r.donemler[0], '2026-10-01');
  const r2 = unutulanFaturalar({ satirlar, eslesmeler: e, kararlar: k, firmalar: FIRMALAR, sozlesmeler, faturalar: [{ company_id: 'f3', invoice_date: '2026-10-03', service_period: null }] });
  assert.equal(r2.firmalar.length, 0);
  const r3 = unutulanFaturalar({ satirlar, eslesmeler: e, kararlar: k, firmalar: FIRMALAR, sozlesmeler: [soz('f3', '2026-11-01')], faturalar: [] });
  assert.equal(r3.firmalar.length, 0);
  const r4 = unutulanFaturalar({ satirlar, eslesmeler: e, kararlar: k, firmalar: FIRMALAR, sozlesmeler, faturalar: [{ company_id: 'f3', invoice_date: '2026-10-03', service_period: '2026-09-01' }] });
  assert.equal(r4.firmalar.length, 1);
  assert.equal(unutulanFaturalar({ satirlar: satirlar.slice(0, 1), eslesmeler: e, kararlar: k, firmalar: FIRMALAR, sozlesmeler, faturalar: [] }).firmalar.length, 0);
});

test('boş şablon: okunur, başlıklar ayrıştırıcıyla uyumlu; yazıcı tarih ve sayıyı korur', async () => {
  const b = gelirSablonu(); const o = await xlsxOku(b);
  assert.deepEqual(o.satirlar[0], BASLIK); assert.equal(o.satirlar.length, 1);
  assert.equal(gelirSatirlari(o.satirlar).hatalar.length, 0);
  const t = await xlsxOku(xlsxYaz([{ ad: 'A', satirlar: [BASLIK, ['E1', { t: 'tarih', v: '2026-10-05' }, 'Ç & <Ö> "ş"', 100, 20, null, 120]] }]));
  assert.equal(t.satirlar[1][1], '2026-10-05T00:00:00'); assert.equal(t.satirlar[1][2], 'Ç & <Ö> "ş"');
  const g = gelirSatirlari(t.satirlar); assert.equal(g.satirlar.length, 1); assert.equal(g.satirlar[0].tarih, '2026-10-05');
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
});

import { firmaPasifMi, aktifFirmaAtamalari, personelAyYuku } from '../src/lib/operasyon.js';
test('pasif firma: arşivli veya eski müşteri; atamaları yük hesabından çıkarılır, süzme yoksa aynen döner', () => {
  assert.equal(firmaPasifMi({ customer_status: 'musteri' }), false); assert.equal(firmaPasifMi({ customer_status: 'eski_musteri' }), true); assert.equal(firmaPasifMi({ archived_at: 'x', customer_status: 'musteri' }), true); assert.equal(firmaPasifMi(null), false);
  const at = [{ id: 'a1', company_id: 'f1' }, { id: 'a2', company_id: 'f2' }, { id: 'a3', company_id: 'f3' }];
  const f = [{ id: 'f1', customer_status: 'musteri' }, { id: 'f2', customer_status: 'eski_musteri' }, { id: 'f3', customer_status: 'musteri', archived_at: 'x' }];
  assert.deepEqual(aktifFirmaAtamalari(at, f).map((a) => a.id), ['a1']);
  assert.equal(aktifFirmaAtamalari(at, []), at); assert.equal(aktifFirmaAtamalari(at, undefined), at);
  const profil = new Map([['f1', [{ valid_from: '2026-01-01', valid_to: null, employee_count: 30, hazard_class: 'tehlikeli' }]], ['f2', [{ valid_from: '2026-01-01', valid_to: null, employee_count: 30, hazard_class: 'tehlikeli' }]]]);
  const kurallar = [{ staff_type: 'is_guvenligi_uzmani', hazard_class: 'tehlikeli', minutes_per_employee: 12, valid_from: '2000-01-01', valid_to: null }, { staff_type: 'isyeri_hekimi', hazard_class: 'tehlikeli', minutes_per_employee: 6, valid_from: '2000-01-01', valid_to: null }];
  const atamalar = [{ id: 'x1', employee_id: 'e', company_id: 'f1', staff_type: 'is_guvenligi_uzmani', share_pct: 100, valid_from: '2026-01-01', valid_to: null }, { id: 'x2', employee_id: 'e', company_id: 'f2', staff_type: 'is_guvenligi_uzmani', share_pct: 100, valid_from: '2026-01-01', valid_to: null }];
  const hepsi = personelAyYuku({ atamalar, employeeId: 'e', profilHaritasi: profil, kurallar, ay: '2026-03-01' });
  const aktif = personelAyYuku({ atamalar: aktifFirmaAtamalari(atamalar, f), employeeId: 'e', profilHaritasi: profil, kurallar, ay: '2026-03-01' });
  assert.ok(hepsi.dakika > 0 && aktif.dakika === hepsi.dakika / 2, `${hepsi.dakika} / ${aktif.dakika}`);
});
