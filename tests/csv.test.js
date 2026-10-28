import test from 'node:test';
import assert from 'node:assert/strict';
import { csvAyristir, csvUret, csvTablo, ayiracBul, guvenliMetin, hucreMetni, BOM } from '../src/lib/csv.js';

test('ayırıcı otomatik bulunur', () => {
  assert.equal(ayiracBul('a;b;c\n1;2;3'), ';');
  assert.equal(ayiracBul('a,b,c\n1,2,3'), ',');
  assert.equal(ayiracBul('a\tb\tc'), '\t');
  assert.equal(ayiracBul('"a;b",c\n1,2'), ',', 'tırnak içindeki ; sayılmaz');
  assert.equal(ayiracBul('tek'), ';');
});

test('BOM, CRLF, tırnaklı alan ve alan içi satır sonu okunur', () => {
  const m = `${BOM}Ad;Not\r\n"Alfa; Ltd";"iki\nsatır"\r\n"Tırnak ""içi""";x\r\n`;
  const { ayirac, satirlar } = csvAyristir(m);
  assert.equal(ayirac, ';');
  assert.deepEqual(satirlar, [['Ad', 'Not'], ['Alfa; Ltd', 'iki\nsatır'], ['Tırnak "içi"', 'x']]);
});

test('boş satırlar atlanır; son satırda satır sonu olmasa da okunur; eksik hücre boş kalır', () => {
  const { satirlar } = csvAyristir('a,b,c\n\n1,2\n,,\n3,4,5');
  assert.deepEqual(satirlar, [['a', 'b', 'c'], ['1', '2'], ['3', '4', '5']]);
});

test('kapanmamış tırnak hata verir', () => {
  assert.throws(() => csvAyristir('a;b\n"x;y'), /kapatılmamış tırnak/);
});

test('yazılan CSV tekrar okununca aynı veriyi verir (gidiş-dönüş)', () => {
  const bas = ['Firma', 'Not', 'Tutar'];
  const sat = [['Alfa; Ltd', 'iki\nsatır "tırnaklı"', 1234.5], ['Beta', ' boşluklu ', 0], ['Çğüşıİ', '', null]];
  const m = csvUret(bas, sat);
  assert.ok(m.startsWith(BOM));
  assert.ok(m.includes('\r\n'));
  const { satirlar } = csvAyristir(m);
  assert.deepEqual(satirlar[0], bas);
  assert.deepEqual(satirlar[1], ['Alfa; Ltd', 'iki\nsatır "tırnaklı"', '1234,5']);
  assert.deepEqual(satirlar[2], ['Beta', ' boşluklu ', '0']);
  assert.deepEqual(satirlar[3], ['Çğüşıİ', '', '']);
});

test('formül enjeksiyonu engellenir; negatif sayı bozulmaz', () => {
  for (const k of ['=1+1', '+90555', '-2+3', '@SUM(A1)', '\tx', '\rx']) assert.equal(guvenliMetin(k)[0], "'", k);
  assert.equal(guvenliMetin('Alfa'), 'Alfa');
  assert.equal(hucreMetni(-12.5), '-12,5');
  assert.equal(hucreMetni('=HYPERLINK("x")'), '"\'=HYPERLINK(""x"")"');
  assert.equal(hucreMetni(true), 'Evet');
  assert.equal(hucreMetni(NaN), '');
});

test('virgül ayırıcıda ondalık nokta kalır', () => {
  assert.equal(hucreMetni(1.5, ','), '1.5');
  assert.equal(csvUret(['a', 'b'], [[1.5, 'x,y']], ',').includes('1.5,"x,y"'), true);
});

test('csvTablo: satır numaraları dosyadaki numaradır; fazla sütun işaretlenir', () => {
  const { satirlar } = csvAyristir('Ad;Şehir\nAlfa;Ankara\nBeta;İzmir;fazla');
  const { basliklar, kayitlar } = csvTablo(satirlar);
  assert.deepEqual(basliklar, ['Ad', 'Şehir']);
  assert.equal(kayitlar[0].satirNo, 2);
  assert.equal(kayitlar[1].satirNo, 3);
  assert.equal(kayitlar[0].fazla, false);
  assert.equal(kayitlar[1].fazla, true);
  assert.deepEqual(csvTablo([]), { basliklar: [], kayitlar: [] });
});
