import test from 'node:test';
import assert from 'node:assert/strict';
import { xlsxOku } from '../src/lib/xlsx.js';
import { butceExcel } from '../src/lib/butce_excel.js';
import { toplamlar, satirHesapla } from '../src/lib/butce.js';

const dek = (bayt) => bayt.buffer.slice(bayt.byteOffset, bayt.byteOffset + bayt.byteLength);
const gelirler = [
  { ad: 'Alfa Ltd', durum: 'kabul', tur: 'sabit', birim: 1000, adet: 0, aylik: 1000, ortalama: 2000, yuzde: 20, yeniTur: 'sabit', talepFiyat: 1200, kabul: 1200, artisOrani: 0.2, artisTutari: 200, beklenen: 2400, not: 'Müdürle görüşüldü' },
  { ad: 'Beta Ltd', durum: 'sona_erdi', tur: 'kisi_basi', birim: 100, adet: 10, aylik: 1000, ortalama: 1500, yuzde: null, yeniTur: 'kisi_basi', talepFiyat: null, kabul: null, artisOrani: null, artisTutari: null, beklenen: 0, not: '' },
];
const giderler = [
  { ad: 'Ofis Kirası', prev: 10000, pct: 30, next: 13000 },
  { ad: 'Personel Giderleri', prev: 30000, pct: 33.33, next: 40000, toplamli: true },
  { ad: 'Ali Veli', cocuk: true, prev: 20000, pct: 50, next: 30000 },
  { ad: 'Ayşe Can', cocuk: true, prev: 10000, pct: 0, next: 10000 },
];

test('bütçe Excel: başlıklar, tablolar, toplamlar ve kâr durumu bulunur; dosya geçerli .xlsx', async () => {
  const gt = toplamlar([satirHesapla({ unit_price: 1000, accepted_price: 1200 }, 2000), satirHesapla({ unit_price: 1000, status: 'sona_erdi' }, 1500)]);
  const bayt = butceExcel({ yil: 2027, gelirler, giderler, gelirToplam: gt, tarih: '08.11.2026' });
  assert.ok(bayt instanceof Uint8Array && bayt.length > 2000);
  const sayfa = await xlsxOku(dek(bayt));
  const metin = JSON.stringify(sayfa);
  for (const beklenen of ['YILLIK BÜTÇE 2027', 'GELİRLER TABLOSU', 'GİDERLER TABLOSU', 'KÂR DURUMU', 'Alfa Ltd', 'Beta Ltd', 'TOPLAM GİDER', 'Ali Veli', 'Sabit fiyat', 'Kişi başı fiyat', 'Kabul edildi', 'Sözleşme sona erdi']) assert.ok(metin.includes(beklenen), `eksik: ${beklenen}`);
});

test('bütçe Excel: toplamlar ve kâr canlı formül, önbellekli değerlerle', async () => {
  const gt = toplamlar([]);
  const bayt = butceExcel({ yil: 2027, gelirler, giderler, gelirToplam: gt, tarih: 'x' });
  const { TextDecoder: _ } = globalThis; void _;
  const zip = Buffer.from(bayt).toString('latin1');
  const xml = zip.slice(zip.indexOf('<worksheet'), zip.indexOf('</worksheet>'));
  assert.match(xml, /<f>SUM\(E6:E7\)<\/f><v>2000<\/v>/);              // aylık hizmet fiyatı toplamı
  assert.match(xml, /<f>SUM\(M6:M7\)<\/f><v>2400<\/v>/);              // beklenen aylık gelir toplamı
  assert.match(xml, /<f>SUM\(B\d+:B\d+\)<\/f><v>30000<\/v>/);         // personel kalemi = altındaki isimlerin toplamı
  assert.match(xml, /<f>B\d+\+B\d+<\/f><v>40000<\/v>/);               // toplam gider (önceki)
  assert.match(xml, /<f>M\d+<\/f><v>2400<\/v>/);                      // kâr tablosu gelir
  assert.match(xml, /<f>C\d+-C\d+<\/f><v>-50600<\/v>/);               // kâr = 2.400 − 53.000
  assert.match(xml, /<pane xSplit="1"/);                              // firma sütunu dondurulmuş
  assert.ok(!/<c [^>]*><f><\/f>/.test(xml));
});

test('Excel: Personel Gider Tablosu bölümü ve "Personel Giderleri" kalemi tabloya bağlanır', () => {
  const bayt = butceExcel({ yil: 2027, gelirler: [], giderler: [{ ad: 'Personel Giderleri', toplamli: true, prev: 42000, pct: 33.33, next: 56000 }],
    personel: [{ ad: 'Ali Veli', prevNet: 20000, prevSgk: 8000, pct: 50, nextNet: 30000, nextSgk: 12000 }, { ad: 'Ayşe', prevNet: 10000, prevSgk: 4000, pct: null, nextNet: 10000, nextSgk: 4000 }],
    gelirToplam: { artisOrani: null }, tarih: '01.01.2027' });
  const zip = Buffer.from(bayt).toString('latin1');
  const xml = zip.slice(zip.indexOf('<worksheet'), zip.indexOf('</worksheet>'));
  assert.match(xml, /<f>SUM\(D\d+:D\d+\)<\/f><v>42000<\/v>/);       // personel toplam gider (önceki)
  assert.match(xml, /<f>SUM\(H\d+:H\d+\)<\/f><v>56000<\/v>/);       // personel toplam gider (sonraki)
  assert.match(xml, /<f>D\d+<\/f><v>42000<\/v>/);                      // Giderler → Personel Giderleri satırı personel tablosuna bağlı
  assert.match(xml, /<f>H\d+<\/f><v>56000<\/v>/);
  assert.ok(zip.includes('PERSONEL G') && zip.includes('Ali Veli'));
});
