import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { teklifAlanlari, bulunmaEki, rakam, docxUret, belgeXmlDoldur, dosyaAdi } from '../src/lib/isg_teklif_word.js';
import { zipDizini } from '../src/lib/xlsx.js';

const kisi = { ad: 'Egepoli Çelik Yapı Sistemleri İnşaat Met. San ve Tic. Ltd. Şti.', yetkili: 'Mustafa BAYINDIR', sehir: 'İzmir', ilce: 'Gaziemir' };
const teklif = { hazard_class: 'cok_tehlikeli', employee_count: 6, pricing: 'sabit_aylik', fixed_monthly_price: 7000, unit_price: null, vat_mode: 'kdv_haric', contract_end_date: '2026-12-31' };

test('alanlar: firma büyük harf, süreler tehlike sınıfına göre, sabit fiyat', () => {
  const a = teklifAlanlari(teklif, kisi);
  assert.equal(a.FIRMA, 'EGEPOLİ ÇELİK YAPI SİSTEMLERİ İNŞAAT MET. SAN VE TİC. LTD. ŞTİ.');
  assert.equal(a.SAYIN, 'Sayın Mustafa BAYINDIR');
  assert.equal(a.UCRET, 'aylık 7000 TL + KDV');
  assert.match(a.A_DEVAMI, /^’nin İzmir Gaziemir’de faaliyet gösteren toplam 6 personelin bulunduğu çok tehlikeli sınıfta yer alan işyeri/);
  assert.equal(a.UZMAN_SURESI, '(Çok tehlikeli sınıftaki işyeri için çalışan başına ayda en az 40 dakika)');
  assert.equal(a.HEKIM_SURESI, '(Çok tehlikeli sınıftaki işyeri için çalışan başına ayda en az 20 dakika)');
  assert.equal(a.SOZLESME_SATIRI, 'Sözleşme 31.12.2026 tarihine kadar yapılacak olup, yeni sözleşme dönemi fiyatları yıllık enflasyon ve asgari ücret artış tutarları göz önüne alınarak karşılıklı olarak belirlenecektir.');
  const t = teklifAlanlari({ ...teklif, hazard_class: 'tehlikeli' }, kisi); assert.match(t.UZMAN_SURESI, /Tehlikeli sınıftaki.*en az 20 dakika/); assert.match(t.HEKIM_SURESI, /en az 15 dakika/);
  const z = teklifAlanlari({ ...teklif, hazard_class: 'az_tehlikeli' }, kisi); assert.match(z.UZMAN_SURESI, /Az tehlikeli sınıftaki.*en az 10 dakika/); assert.match(z.HEKIM_SURESI, /en az 5 dakika/);
});
test('alanlar: kişi başı fiyat, KDV dahil, sözleşme tarihi yok, yer/yetkili eksik', () => {
  assert.equal(teklifAlanlari({ ...teklif, pricing: 'kisi_basi', unit_price: 150.5, fixed_monthly_price: null }, kisi).UCRET, 'kişi başı aylık 150,50 TL + KDV');
  assert.equal(teklifAlanlari({ ...teklif, vat_mode: 'kdv_dahil' }, kisi).UCRET, 'aylık 7000 TL (KDV dahil)');
  assert.equal(teklifAlanlari({ ...teklif, contract_end_date: null }, kisi).SOZLESME_SATIRI, null);
  const e = teklifAlanlari(teklif, { ad: 'Firma' }); assert.equal(e.SAYIN, 'Sayın Yetkili'); assert.match(e.A_DEVAMI, /^’nin faaliyet gösteren toplam 6/);
  assert.throws(() => teklifAlanlari({ ...teklif, hazard_class: null }, kisi)); assert.throws(() => teklifAlanlari({ ...teklif, fixed_monthly_price: null }, kisi));
});
test('bulunma eki, rakam, dosya adı', () => {
  assert.equal(bulunmaEki('Gaziemir'), 'Gaziemir’de'); assert.equal(bulunmaEki('Bayraklı'), 'Bayraklı’da'); assert.equal(bulunmaEki('Karşıyaka'), 'Karşıyaka’da');
  assert.equal(bulunmaEki('Aliağa'), 'Aliağa’da'); assert.equal(bulunmaEki('Torbalı'), 'Torbalı’da'); assert.equal(bulunmaEki('İzmir'), 'İzmir’de'); assert.equal(bulunmaEki('Kemalpaşa'), 'Kemalpaşa’da'); assert.equal(bulunmaEki('Bergama'), 'Bergama’da'); assert.equal(bulunmaEki('Bucak'), 'Bucak’ta');
  assert.equal(rakam(7000), '7000'); assert.equal(rakam(7000.5), '7000,50');
  assert.equal(dosyaAdi('EGEPOLİ ÇELİK A.Ş.'), 'egepoli-celik-a-s-is-sagligi-teklifi.docx'); assert.equal(dosyaAdi(''), 'teklif-is-sagligi-teklifi.docx');
});
test('docx üretimi: işaretler doluyor, sözleşme satırı isteğe göre kalkıyor, zip geçerli', async () => {
  const sablon = new Uint8Array(readFileSync(new URL('../src/assets/teklif_sablonu.docx', import.meta.url)));
  const oku = async (bayt) => { const d = zipDizini(bayt); return { d, xml: new TextDecoder().decode(await d.get('word/document.xml')()) }; };
  const metin = (xml) => [...xml.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((m) => m[1]).join('|');
  const dolu = await oku(await docxUret(sablon, teklifAlanlari(teklif, kisi)));
  const m = metin(dolu.xml);
  assert.ok(!m.includes('{{') && !m.includes('Gaziemir’de faaliyet gösteren toplam 6 personelin bulunduğu çok tehlikeli sınıfta yer alan') === false);
  assert.ok(m.includes('Sayın Mustafa BAYINDIR') && m.includes('aylık 7000 TL + KDV') && m.includes('Sözleşme 31.12.2026 tarihine kadar'));
  assert.equal((m.match(/EGEPOLİ ÇELİK YAPI SİSTEMLERİ İNŞAAT MET\. SAN VE TİC\. LTD\. ŞTİ\./g) ?? []).length, 3);
  assert.ok(dolu.xml.includes('<w:b/>') && /<w:r>(?:(?!<\/w:r>).)*<w:b\/>(?:(?!<\/w:r>).)*aylık 7000 TL \+ KDV/s.test(dolu.xml), 'fiyat kalın');
  assert.ok(dolu.d.has('word/media/image1.tiff') && dolu.d.has('word/footer1.xml') && dolu.d.has('[Content_Types].xml'));
  const kisiBasi = await oku(await docxUret(sablon, teklifAlanlari({ ...teklif, pricing: 'kisi_basi', unit_price: 125, contract_end_date: null }, { ...kisi, ad: 'A & B <Ltd>' })));
  const k = metin(kisiBasi.xml);
  assert.ok(k.includes('kişi başı aylık 125 TL + KDV') && !k.includes('Sözleşme ') && !k.includes('yıllık enflasyon') && k.includes('A &amp; B &lt;LTD&gt;'));
  assert.ok(k.includes('Aylık hizmet bedeli'));
  assert.throws(() => belgeXmlDoldur('<w:t>{{BILINMEYEN}}</w:t>', {}));
});
