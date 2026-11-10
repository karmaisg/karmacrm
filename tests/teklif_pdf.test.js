import test from 'node:test';
import assert from 'node:assert/strict';
import { pdfDogrula, pdfImzasiVar, baytBase64, base64Bayt, boyutMetni, PDF_AZAMI_BOYUT } from '../src/lib/teklif_pdf.js';

test('pdfDogrula: uzantı, boyut, boş dosya', () => {
  assert.equal(pdfDogrula({ name: 'Teklif.PDF', size: 1000 }), null);
  assert.match(pdfDogrula({ name: 'x.docx', size: 1000 }), /\.pdf/);
  assert.match(pdfDogrula({ name: 'x.pdf', size: PDF_AZAMI_BOYUT + 1 }), /3 MB/);
  assert.match(pdfDogrula({ name: 'x.pdf', size: 0 }), /seçin/); assert.match(pdfDogrula(null), /seçin/);
});
test('pdf imzası ve base64 gidiş-dönüş', () => {
  const b = new TextEncoder().encode('%PDF-1.7\nçğ'); assert.equal(pdfImzasiVar(b), true);
  assert.equal(pdfImzasiVar(new TextEncoder().encode('MZ....')), false); assert.equal(pdfImzasiVar(new Uint8Array(2)), false);
  assert.deepEqual(base64Bayt(baytBase64(b)), b);
  const buyuk = new Uint8Array(200000).map((_, i) => i % 251); assert.deepEqual(base64Bayt(baytBase64(buyuk)), buyuk);
});
test('boyut metni', () => { assert.equal(boyutMetni(500), '1 KB'); assert.equal(boyutMetni(2048), '2 KB'); assert.equal(boyutMetni(1572864), '1,5 MB'); });
