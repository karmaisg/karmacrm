// İSG-Katip aktarımı: Excel okuma, işyeri gruplama, ad eşleştirme, karar/özet, değişiklik uyarıları, uygulama paketi.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { xlsxOku, excelTarihi } from '../src/lib/xlsx.js';
import {
  katipSatirlari, isyerleriniGrupla, adBenzerligi, adayFirmalar, adSozcukleri, birimleriHazirla, kararCoz, firmaOzetleri, excelDisiFirmalar,
  degisiklikler, oncekiOzet, profilFarklari, uygulamaPaketi, personelTuru, tehlikeSinifi, trKucukAscii, ESIK,
} from '../src/lib/katip.js';

const oku = async (ad) => katipSatirlari((await xlsxOku(fs.readFileSync(new URL(`./fixtures/${ad}`, import.meta.url)))).satirlar);
const F = (id, name, ek = {}) => ({ id, name, customer_status: 'musteri', archived_at: null, ...ek });

test('xlsx okuyucu: örnek dosya (paylaşılan metinler, tarihler), bozuk dosya ve tarih serisi', async () => {
  const t = await xlsxOku(fs.readFileSync(new URL('./fixtures/katip_ornek.xlsx', import.meta.url)));
  assert.equal(t.sayfa, 'İSG Hizmet Sözleşme Süreçleri L'); assert.equal(t.satirlar.length, 9);
  assert.equal(t.satirlar[0][5], 'Görevlendirilen Kişi Ad Soyad'); assert.equal(t.satirlar[1][5], 'AYŞE UZMAN');
  assert.match(String(t.satirlar[1][19]), /^2026-10-01T09:00:00/);
  assert.equal(excelTarihi(46296.5), '2026-10-01T12:00:00');
  await assert.rejects(() => xlsxOku(new Uint8Array([1, 2, 3, 4])), /Excel/);
  await assert.rejects(() => xlsxOku(new TextEncoder().encode('a,b\n1,2\n'.repeat(20))), /Excel/);
});

test('katipSatirlari: örnek dosya, eksik sütun, bozuk satırlar, devam etmeyen sözleşme', async () => {
  const r = await oku('katip_ornek.xlsx');
  assert.equal(r.hata, null); assert.equal(r.kayitlar.length, 8);
  const k = r.kayitlar[0];
  assert.equal(k.personelTuru, 'is_guvenligi_uzmani'); assert.equal(k.tehlike, 'tehlikeli'); assert.equal(k.tc, '10000000146'); assert.equal(k.baslangic, '2026-10-01'); assert.equal(k.onaylayan, 'MEHMET YETKİLİ');
  assert.equal(r.kayitlar[7].personelTuru, 'is_guvenligi_uzmani');
  assert.equal(katipSatirlari([['a', 'b'], [1, 2]]).hata.includes('Eksik sütunlar'), true);
  assert.equal(katipSatirlari([]).hata !== null, true);
  const basliklar = ['Görevlendirilen Kişi Ad Soyad', 'Görevlendirilen Kişi Sertifika Tipi', 'Çalışma Süresi', 'Hizmet Alan İşyeri Unvanı', 'Hizmet Alan İşyeri SGK/DETSİS No', 'Hizmet Alan İşyeri Çalışan Sayısı', 'Hizmet Alan İşyeri Tehlike Sınıfı', 'Sözleşme Statüsü'];
  const iyi = ['X Y', 'İşyeri Hekimliği Sertifikası', 10, 'Firma', '12345678901234567890', 5, 'Az Tehlikeli', 'Sözleşme Devam Ediyor'];
  const t = katipSatirlari([basliklar, iyi, ['', 'Bilinmez', 10, 'Firma', '12345678901234567890', 5, 'Az Tehlikeli', ''], ['X Y', 'İşyeri Hekimliği Sertifikası', 10, 'Firma', 12345, 5, 'Az Tehlikeli', ''],
    ['X Y', 'İşyeri Hekimliği Sertifikası', 10, 'Firma', '12345678901234567890', -2, 'Az Tehlikeli', ''], [...iyi.slice(0, 7), 'Sözleşme Sonlandırıldı'], [null, null]]);
  assert.equal(t.kayitlar.length, 1); assert.equal(t.atlanan, 4); assert.equal(t.uyarilar.length, 4);
  assert.ok(t.uyarilar.some((u) => u.includes('devam etmiyor')));
  assert.equal(personelTuru('Diğer Sağlık Personeli Sertifikası'), 'diger_saglik'); assert.equal(personelTuru('C Sınıfı İş Güvenliği Uzmanlığı Sertifikası'), 'is_guvenligi_uzmani'); assert.equal(personelTuru('x'), null);
  assert.equal(tehlikeSinifi('Çok Tehlikeli'), 'cok_tehlikeli'); assert.equal(tehlikeSinifi('Az Tehlikeli'), 'az_tehlikeli'); assert.equal(tehlikeSinifi('Tehlikeli'), 'tehlikeli'); assert.equal(tehlikeSinifi('?'), null);
  assert.equal(trKucukAscii('İĞNE ÇÖZÜM ışık'), 'igne cozum isik');
});

test('işyerlerini sicile göre gruplar; çelişkili bilgi uyarı üretir', async () => {
  const { isyerleri, uyarilar } = isyerleriniGrupla((await oku('katip_ornek.xlsx')).kayitlar);
  assert.equal(isyerleri.length, 5); assert.equal(uyarilar.length, 0);
  const alfa = isyerleri.filter((i) => i.unvan.startsWith('ALFA')); assert.equal(alfa.length, 2);
  assert.deepEqual(alfa.map((i) => i.tehlike).sort(), ['az_tehlikeli', 'cok_tehlikeli']);
  const kayit = (c, t) => ({ sicil: 'S1234', unvan: 'A', calisan: c, tehlike: t, il: null, onaylayan: null });
  const c = isyerleriniGrupla([kayit(5, 'tehlikeli'), kayit(6, 'tehlikeli'), kayit(5, 'az_tehlikeli'), kayit(5, 'tehlikeli')]);
  assert.equal(c.isyerleri[0].calisan, 5); assert.equal(c.uyarilar.length, 2);
});

test('ad eşleştirme: hukuki ekler, kısaltma, yazım hatası, marka kapısı', () => {
  assert.equal(adBenzerligi('Seterm Teknik A.Ş.', 'SETERM TEKNİK ANONİM ŞİRKETİ'), 1);
  assert.ok(adBenzerligi('DRY CLEANING İZMİR CENTER KURU TEM.TURİZM GIDA SAN.VE TİC.A.Ş.', 'DRY CLEANING İZMİR CENTER KURU TEMİZLEME TURİZM GIDA SANAYİ VE TİCARET ANONİM ŞİRKETİ') >= ESIK.guclu);
  assert.ok(adBenzerligi('EGEPOLİ ÇELİK YAPI SİSTEMLERİ İNŞ.MET.SAN.VE TİC.A.Ş.', 'EGEPOLİ ÇELİK YAPI SİSTEMLERİ İNŞ.METAL SAN.VE TİC.A.Ş.') >= ESIK.guclu);
  const s = adBenzerligi('SETERM TEKNİK ANONİM ŞİRKETİ', 'SETERM SERVİS LİMİTED ŞİRKETİ'); assert.ok(s >= ESIK.olasi && s < ESIK.guclu, `seterm ${s}`);
  assert.ok(adBenzerligi('RA RA TURİZM GIDA İNŞAAT SANAYİ VE TİCARET ANONİM ŞİRKETİ', 'PADOVA TURİZM GIDA İNŞAAT SANAYİ VE TİCARET ANONİM ŞİRKETİ') < ESIK.olasi, 'yalnızca sektör sözcükleri benzeyen firmalar eşleşmez');
  assert.ok(adBenzerligi('ALİ ONAR', 'ALİ OĞUZ DEMİR') < ESIK.olasi);
  assert.equal(adBenzerligi('', 'X'), 0);
  assert.deepEqual(adSozcukleri('Alfa Gıda A.Ş.').map((x) => x.s), ['alfa', 'gida']);
  const aday = adayFirmalar('SETERM SERVİS A.Ş.', [F('1', 'Seterm Teknik'), F('2', 'Başka Firma'), F('3', 'Seterm Teknik Eski', { archived_at: '2026-01-01' })]);
  assert.equal(aday[0].firma.id, '1'); assert.ok(!aday.some((a) => a.firma.id === '2'));
});

async function senaryo(firmalar, siteler = []) {
  const { isyerleri } = isyerleriniGrupla((await oku('katip_ornek.xlsx')).kayitlar);
  return { isyerleri, birimler: birimleriHazirla({ isyerleri, firmalar, siteler }), firmalar };
}

test('birimler: güçlü eşleşme, birleştirme sorusu, yeni firma, kalıcı eşleşme', async () => {
  const firmalar = [F('f1', 'Seterm Teknik Ticaret A.Ş.'), F('f2', 'Alfa Gıda'), F('f3', 'Eski Müşteri Ltd')];
  const { birimler } = await senaryo(firmalar);
  const b = (ad) => birimler.find((x) => x.unvan.startsWith(ad));
  const alfa = b('ALFA'); assert.equal(alfa.isyerleri.length, 2, 'aynı unvanlı iki sicil tek birim'); assert.equal(alfa.calisan, 48);
  assert.equal(alfa.karar.tip, 'esle'); assert.equal(alfa.karar.firmaId, 'f2');
  assert.equal(b('SETERM TEKNİK').karar.firmaId, 'f1');
  const servis = b('SETERM SERVİS'); assert.equal(servis.soru, true, 'Seterm Servis için soru sorulur'); assert.equal(servis.karar.tip, 'esle'); assert.equal(servis.karar.firmaId, 'f1');
  assert.equal(b('YENİ FİRMA').karar.tip, 'yeni');
  // sistemde hiç yoksa Excel içinde benzer unvanlar birleştirme sorusu üretir
  const bos = birimleriHazirla({ isyerleri: (await senaryo([])).isyerleri, firmalar: [], siteler: [] });
  const ikili = bos.filter((x) => x.unvan.startsWith('SETERM')); assert.equal(ikili.length, 2);
  const bagli = ikili.find((x) => x.karar.tip === 'birlestir'); const hedef = ikili.find((x) => x !== bagli);
  assert.ok(bagli && bagli.soru === true); assert.equal(hedef.karar.tip, 'yeni');
  assert.equal(kararCoz(bos, bagli.anahtar).tip, 'yeni');
  assert.equal(kararCoz(bos, bagli.anahtar).ref, kararCoz(bos, hedef.anahtar).ref, 'iki birim aynı yeni firmada');
  // kalıcı eşleşme: sicil daha önce başka (fatura) firmaya bağlanmış
  const k = await senaryo(firmalar, [{ sgk_no: '22222222222222222222222222', company_id: 'f3', archived_at: null }]);
  const kb = k.birimler.find((x) => x.unvan.startsWith('SETERM SERVİS')); assert.equal(kb.kayitliFirmaId, 'f3'); assert.equal(kb.soru, false); assert.equal(kb.karar.firmaId, 'f3');
});

test('firma özetleri: çalışan toplamı, karma tehlike, excel dışı firmalar, profil farkı', async () => {
  const firmalar = [F('f1', 'Seterm Teknik Ticaret A.Ş.'), F('f2', 'Alfa Gıda'), F('f3', 'Eski Müşteri Ltd'), F('f4', 'Arşivli', { archived_at: '2025-01-01' }), F('f5', 'Eski Firma', { customer_status: 'eski_musteri' })];
  const { birimler } = await senaryo(firmalar);
  const oz = firmaOzetleri({ birimler, firmalar });
  const alfa = oz.find((o) => o.firmaId === 'f2'); assert.equal(alfa.calisan, 48); assert.equal(alfa.isyerleri.length, 2); assert.equal(alfa.enYuksek, 'cok_tehlikeli'); assert.deepEqual(alfa.tehlikeler.sort(), ['az_tehlikeli', 'cok_tehlikeli']);
  assert.equal(oz.find((o) => o.firmaId === 'f1').calisan, 30, 'Seterm Teknik + Servis birleşti');
  assert.deepEqual(excelDisiFirmalar({ firmalar, ozetler: oz }).map((f) => f.id), ['f3']);
  const fark = profilFarklari({ ozetler: oz, profilHaritasi: new Map([['f2', { employee_count: 40, hazard_class: 'az_tehlikeli' }], ['f1', { employee_count: 30, hazard_class: 'tehlikeli' }]]) });
  assert.deepEqual(fark.map((x) => x.firmaId), ['f2']);
  // yoksay
  birimler.find((x) => x.unvan.startsWith('YENİ')).karar = { tip: 'yoksay' };
  assert.equal(firmaOzetleri({ birimler, firmalar }).some((o) => o.yeni), false);
});

test('değişiklikler: çalışan, tehlike, görevli, süre, kişi, yeni ve ayrılan işyeri', async () => {
  const eski = (await senaryo([])).isyerleri;
  const yeni = isyerleriniGrupla((await oku('katip_ornek_ikinci.xlsx')).kayitlar).isyerleri;
  const onceki = [];
  for (const i of eski) for (const s of i.satirlar) onceki.push({ sgk_no: i.sicil, site_name: i.unvan, employee_count: i.calisan, hazard_class: i.tehlike, approver_name: s.onaylayan, staff_type: s.personelTuru, cert_no: s.sertNo, person_name: s.ad, minutes_per_month: s.dakika });
  const d = degisiklikler({ isyerleri: yeni, onceki });
  const var_ = (tur, parca) => d.some((x) => x.tur === tur && (!parca || x.mesaj.includes(parca)));
  assert.ok(var_('calisan', '20 → 25')); assert.ok(var_('tehlike', 'Az tehlikeli → Tehlikeli')); assert.ok(var_('gorevli', 'ÖZBEY') || var_('gorevli', 'HASAN HEKİM'));
  assert.ok(var_('gorevli', 'YENİ HEKİM')); assert.ok(var_('kisi', 'NURAY YETKİLİ → YENİ YETKİLİ')); assert.ok(var_('ayrildi'));
  assert.equal(d.find((x) => x.tur === 'ayrildi').onem, 'yuksek'); assert.equal(d[0].onem, 'yuksek', 'önemliler başta');
  // değişiklik yoksa boş; ilk yüklemede (önceki yok) boş
  assert.deepEqual(degisiklikler({ isyerleri: eski, onceki }), []);
  assert.deepEqual(degisiklikler({ isyerleri: eski, onceki: [] }), []);
  // süre değişimi ve yeni işyeri
  const kopya = eski.map((i) => ({ ...i, satirlar: i.satirlar.map((s) => ({ ...s, dakika: s.dakika + 10 })) }));
  assert.ok(degisiklikler({ isyerleri: kopya, onceki }).some((x) => x.tur === 'sure'));
  assert.ok(degisiklikler({ isyerleri: eski, onceki: onceki.filter((o) => o.sgk_no !== '44444444444444444444444444') }).some((x) => x.tur === 'yeni_isyeri'));
  assert.equal(oncekiOzet(onceki).size, 5);
});

test('uygulama paketi: yeni firma ref, işyeri-firma bağları, TC yalnızca paket satırında, tekrarlı kişi yok, yoksayılan hariç', async () => {
  const firmalar = [F('f1', 'Seterm Teknik Ticaret A.Ş.'), F('f2', 'Alfa Gıda')];
  const { birimler } = await senaryo(firmalar);
  const paket = uygulamaPaketi({ donem: '2026-10-01', dosyaAdi: 'a.xlsx', birimler, firmalar, pasif: ['f9'], mevcutKisiler: [{ company_id: 'f2', full_name: 'cem sahibi' }] });
  assert.equal(paket.isyerleri.length, 5); assert.equal(paket.satirlar.length, 8);
  assert.equal(paket.yeni_firmalar.length, 1); assert.equal(paket.yeni_firmalar[0].ad, 'YENİ FİRMA LTD. ŞTİ.');
  const y = paket.isyerleri.find((i) => i.sicil === '44444444444444444444444444'); assert.equal(y.firma_ref, paket.yeni_firmalar[0].ref); assert.equal(y.firma_id, null);
  assert.equal(paket.isyerleri.find((i) => i.sicil === '22222222222222222222222222').firma_id, 'f1');
  assert.deepEqual(paket.kisiler.map((k) => k.ad).sort(), ['DENİZ KARA', 'MEHMET YETKİLİ', 'NURAY YETKİLİ'], 'mevcut kişi (cem sahibi) tekrar eklenmez');
  assert.deepEqual(paket.pasif, ['f9']); assert.equal(paket.satirlar[0].tc, '10000000146');
  birimler.find((x) => x.unvan.startsWith('YENİ')).karar = { tip: 'yoksay' };
  const p2 = uygulamaPaketi({ donem: '2026-10-01', dosyaAdi: 'a.xlsx', birimler, firmalar });
  assert.equal(p2.yeni_firmalar.length, 0); assert.equal(p2.isyerleri.length, 4); assert.equal(p2.satirlar.length, 7);
});
