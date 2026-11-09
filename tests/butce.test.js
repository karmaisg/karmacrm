import test from 'node:test';
import assert from 'node:assert/strict';
import { sayiOku, yuzdeFiyata, fiyatYuzdeye, otomatikOrtalamalar, satirHesapla, toplamlar, personelSatiri, personelToplamlari, kategoriEsle, giderOrtalamalari } from '../src/lib/butce.js';

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

import { talepFiyati, talepYuzdesi, giderlerHesapla, karDurumu, VARSAYILAN_GIDERLER } from '../src/lib/butce.js';

test('fiyat türü değişirse artış AYLIK tutar üzerinden hesaplanır (sabit → kişi başı)', () => {
  const s = { price_type: 'sabit', unit_price: 2000, employee_count: 20, next_price_type: 'kisi_basi' };
  assert.equal(talepFiyati(s, 10), 110);                 // 2200 / 20 kişi
  assert.equal(talepYuzdesi(s, 110), 10);
  const h = satirHesapla({ ...s, accepted_price: 110 }, 2000);
  assert.equal(h.kabulAylik, 2200); assert.ok(Math.abs(h.artisOrani - 0.1) < 1e-9); assert.equal(h.artisTutari, 200); assert.equal(h.beklenen, 2200);
});

test('beklenen aylık gelir elle girilebilir ve hesaplananın yerine geçer', () => {
  const h = satirHesapla({ unit_price: 1000, accepted_price: 1200, expected_manual: 5555 }, 2000);
  assert.equal(h.beklenen, 5555); assert.equal(h.beklenenElle, true);
  assert.equal(satirHesapla({ expected_manual: 100, status: 'sona_erdi' }, 2000).beklenen, 100);
});

test('gider tablosu: kalem artışı iki yönlü, personel altındaki isimler kalemi toplar, ağırlıklı ortalama', () => {
  const s = [
    { id: 'k', name: 'Ofis Kirası', prev_avg_expense: 10000, increase_pct: 30 },
    { id: 's', name: 'Su', prev_avg_expense: 1000, next_avg_expense: 1500 },
    { id: 'p', name: 'Personel Giderleri', is_personnel: true },
    { id: 'p1', parent_id: 'p', name: 'Ali Veli', prev_avg_expense: 20000, increase_pct: 50 },
    { id: 'p2', parent_id: 'p', name: 'Ayşe Can', prev_avg_expense: 10000 },
    { id: 'b', name: 'Boş' },
  ];
  const r = giderlerHesapla(s);
  assert.equal(r.satirlar.get('k').next, 13000); assert.equal(r.satirlar.get('s').pct, 50);
  assert.equal(r.satirlar.get('p').prev, 30000); assert.equal(r.satirlar.get('p').next, 40000); assert.equal(r.satirlar.get('p').toplamli, true);
  assert.equal(r.oncekiToplam, 41000 + 0); assert.equal(r.sonrakiToplam, 13000 + 1500 + 40000);
  assert.ok(Math.abs(r.agirlikliArtis - ((54500 / 41000 - 1) * 100)) < 1e-9);
});

test('kâr durumu: beklenen aylık gelir − gelecek yıl aylık gider; önceki yılla karşılaştırma', () => {
  const k = karDurumu({ beklenen: 100000, ortalama: 90000 }, { sonrakiToplam: 60000, oncekiToplam: 55000 });
  assert.equal(k.aylikKar, 40000); assert.equal(k.yillikKar, 480000); assert.equal(k.oncekiKar, 35000); assert.equal(k.marj, 0.4);
  assert.equal(VARSAYILAN_GIDERLER.length, 20); assert.equal(VARSAYILAN_GIDERLER[1], 'Personel Giderleri');
});

test('personel satırı: artış oranı net maaş ve SGK\'ya uygulanır; sonraki tutar girilmişse o esas alınır', () => {
  const a = personelSatiri({ prev_net: 20000, prev_sgk: 8000, increase_pct: 50 });
  assert.equal(a.prevToplam, 28000); assert.equal(a.nextNet, 30000); assert.equal(a.nextSgk, 12000); assert.equal(a.nextToplam, 42000);
  const b = personelSatiri({ prev_net: 10000, prev_sgk: 4000, next_net: 15000, next_sgk: 6000 });
  assert.equal(b.nextToplam, 21000); assert.equal(b.pct, 50);
  assert.equal(personelSatiri({}).prevToplam, null);
});
test('personel toplamları ve Giderler tablosundaki "Personel Giderleri" kalemi personel tablosundan gelir', () => {
  const liste = [{ prev_net: 20000, prev_sgk: 8000, increase_pct: 50 }, { prev_net: 10000, prev_sgk: 4000 }];   // ikincide sonraki yıl boş → önceki ile aynı
  const t = personelToplamlari(liste);
  assert.equal(t.adet, 2); assert.equal(t.prevToplam, 42000); assert.equal(t.nextToplam, 56000); assert.equal(t.nextNet, 40000); assert.equal(t.nextSgk, 16000);
  assert.ok(Math.abs(t.pct - 33.33) < 1e-9);
  const g = giderlerHesapla([{ id: 'p', name: 'Personel Giderleri', is_personnel: true, prev_avg_expense: 5 }, { id: 'k', name: 'Kira', prev_avg_expense: 1000, next_avg_expense: 1300 }], liste);
  assert.equal(g.satirlar.get('p').prev, 42000); assert.equal(g.satirlar.get('p').next, 56000); assert.equal(g.satirlar.get('p').toplamli, true);
  assert.equal(g.oncekiToplam, 43000); assert.equal(g.sonrakiToplam, 57300);
  const bos = giderlerHesapla([{ id: 'p', name: 'Personel Giderleri', is_personnel: true, prev_avg_expense: 5 }], []);   // personel yoksa elle girilen değer sürer
  assert.equal(bos.satirlar.get('p').prev, 5);
});
test('kategori eşleştirme: ad/anahtar sözcük, kayıtlı eşleşme öncelikli, personel kategorisi hariç', () => {
  const kalemler = [{ id: 'k1', name: 'Elektrik' }, { id: 'k2', name: 'Su' }, { id: 'k3', name: 'Ofis Kirası' }, { id: 'k4', name: 'SGK Giderleri' }, { id: 'kp', name: 'Personel Giderleri', is_personnel: true }, { id: 'k5', name: 'Sigorta', category_ids: ['c9'] }];
  const e = kategoriEsle(kalemler, [{ id: 'c1', name: 'Elektrik faturası' }, { id: 'c2', name: 'Su' }, { id: 'c3', name: 'Kira' }, { id: 'c4', name: 'Maaşlar', nature: 'personel' },
    { id: 'c5', name: 'Suç' }, { id: 'c6', name: 'SGK primi', nature: 'sgk' }, { id: 'c9', name: 'Kasko' }, { id: 'c7', name: 'Bilinmeyen' }]);
  assert.equal(e.get('c1'), 'k1'); assert.equal(e.get('c2'), 'k2'); assert.equal(e.get('c3'), 'k3'); assert.equal(e.get('c6'), 'k4'); assert.equal(e.get('c9'), 'k5');
  assert.equal(e.has('c4'), false); assert.equal(e.has('c5'), false); assert.equal(e.has('c7'), false);
});
test('giderlerden ortalama: arşivsiz harcamalar, o yıl gider girilen ay sayısına bölünür', () => {
  const h = (c, ay, t, ex = {}) => ({ category_id: c, expense_date: `${ay}-10`, amount_excl_vat: t, ...ex });
  const harcama = [h('a', '2026-01', 1000), h('a', '2026-02', 1000), h('b', '2026-03', 600), h('a', '2026-03', 500, { archived_at: '2026-04-01' }), h('a', '2025-12', 9999)];
  const o = giderOrtalamalari(harcama, 2026, new Map([['k1', ['a']], ['k2', ['a', 'b']], ['k3', []]]));
  assert.equal(o.get('k1').ay, 3); assert.equal(o.get('k1').ortalama, 666.67); assert.equal(o.get('k2').ortalama, 866.67); assert.equal(o.get('k3').ortalama, 0);
  assert.equal(giderOrtalamalari([], 2026, new Map([['k', ['a']]])).get('k').ortalama, null);
});
