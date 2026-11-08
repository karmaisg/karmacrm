import test from 'node:test';
import assert from 'node:assert/strict';
import { sayiOku, yuzdeFiyata, fiyatYuzdeye, otomatikOrtalamalar, satirHesapla, toplamlar } from '../src/lib/butce.js';

const fat = (id, c, ay, haric, ekstra = {}) => ({ id, company_id: c, invoice_date: `${ay}-15`, amount_excl_vat: haric, vat_amount: haric * 0.2, ...ekstra });

test('sayiOku: Türkçe ve düz biçimler', () => {
  assert.equal(sayiOku('1.250,50'), 1250.5); assert.equal(sayiOku('1250.5'), 1250.5); assert.equal(sayiOku('₺ 2.000'), 2000);
  assert.equal(sayiOku(''), null); assert.equal(sayiOku('abc'), null); assert.equal(sayiOku('-5'), null);
});

test('yüzde ↔ fiyat dönüşümü iki yönlü', () => {
  assert.equal(yuzdeFiyata(1000, 25), 1250); assert.equal(fiyatYuzdeye(1000, 1250), 25);
  assert.equal(yuzdeFiyata(null, 25), null); assert.equal(fiyatYuzdeye(0, 100), null);
});

test('otomatik ortalama: yalnız önceki yılın "fatura" türü gelirleri, fatura kesilen ay sayısına bölünür; bağlı firma ana firmaya eklenir', () => {
  const firmalar = [{ id: 'a' }, { id: 'b', parent_company_id: 'a' }, { id: 'c' }];
  const m = otomatikOrtalamalar([
    fat('1', 'a', '2026-01', 1000), fat('2', 'a', '2026-02', 3000), fat('3', 'b', '2026-02', 1000),
    fat('4', 'a', '2025-12', 9999), fat('5', 'a', '2026-03', 500, { income_kind: 'spot' }), fat('6', 'a', '2026-04', 500, { archived_at: '2026-05-01' }),
    fat('7', 'c', '2026-05', 700, { service_period: '2026-06-01' }),
  ], firmalar, 2026);
  assert.equal(m.get('a').toplam, 5000); assert.equal(m.get('a').ay, 2); assert.equal(m.get('a').ortalama, 2500);
  assert.equal(m.get('c').ortalama, 700);                         // hizmet dönemi esas
  assert.ok(!m.has('b'));
});

test('satır hesabı: sabit fiyat; beklenen gelir = önceki ortalama × (1 + gerçekleşen artış oranı)', () => {
  const h = satirHesapla({ price_type: 'sabit', unit_price: 1000, accepted_price: 1200 }, 2000);
  assert.equal(h.oncekiAylik, 1000); assert.equal(h.ortalama, 2000); assert.equal(h.elle, false);
  assert.ok(Math.abs(h.artisOrani - 0.2) < 1e-9); assert.equal(h.artisTutari, 200); assert.equal(h.beklenen, 2400);
});

test('satır hesabı: kişi başı fiyat çalışan sayısıyla çarpılır; elle ortalama otomatiğin yerine geçer', () => {
  const h = satirHesapla({ price_type: 'kisi_basi', unit_price: 100, employee_count: 20, accepted_price: 110, prev_avg_income: 2500 }, 1800);
  assert.equal(h.oncekiAylik, 2000); assert.equal(h.ortalama, 2500); assert.equal(h.elle, true);
  assert.equal(h.artisTutari, 200); assert.equal(h.beklenen, 2750);
});

test('kabul edilen bedel yoksa beklenen gelir boş; sözleşme sona erdiyse 0', () => {
  assert.equal(satirHesapla({ unit_price: 1000 }, 2000).beklenen, null);
  assert.equal(satirHesapla({ unit_price: 1000, status: 'sona_erdi' }, 2000).beklenen, 0);
  assert.equal(satirHesapla({ unit_price: 1000, accepted_price: 1100 }, null).beklenen, null);   // ortalama bilinmiyor
});

test('toplamlar: karşılaştırılabilir firmalar üzerinden artış oranı; sona eren firma düşüş sayılır', () => {
  const a = satirHesapla({ unit_price: 1000, accepted_price: 1200 }, 2000);            // 2000 → 2400
  const b = satirHesapla({ unit_price: 500, status: 'sona_erdi' }, 1000);               // 1000 → 0
  const c = satirHesapla({ unit_price: 800 }, 1500);                                    // belirsiz
  const t = toplamlar([a, b, c]);
  assert.equal(t.ortalama, 4500); assert.equal(t.beklenen, 2400); assert.equal(t.oncekiFiyat, 2300);
  assert.equal(t.karsilastirilan, 2); assert.equal(t.belirsiz, 1);
  assert.ok(Math.abs(t.artisOrani - (2400 / 3000 - 1)) < 1e-9);
});
