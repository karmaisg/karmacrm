import test from 'node:test';
import assert from 'node:assert/strict';
import { adresSorgusu, konumDurumu, ayZiyaretDurumlari, firmaOzeti, ziyaretSatirlari, filtrele, ayrikDegerler, mesafeKm, yakinSiraya, rotaBaglantisi, ROTA_AZAMI_DURAK } from '../src/lib/ziyaret.js';

const f = (id, ad, ek = {}) => ({ id, name: ad, customer_status: 'musteri', city: 'İzmir', district: 'Gaziemir', address: 'Sarnıç Mah. 1. Sk. No:5', latitude: null, longitude: null, ...ek });
test('adres sorgusu ve konum durumu', () => {
  assert.equal(adresSorgusu(f('1', 'A')), 'Sarnıç Mah. 1. Sk. No:5, Gaziemir, İzmir, Türkiye');
  assert.equal(adresSorgusu({ address: 'Sadece sokak' }), '');
  assert.equal(adresSorgusu({ city: 'Manisa' }), 'Manisa, Türkiye');
  assert.equal(konumDurumu(f('1', 'A')), 'yok'); assert.equal(konumDurumu({ name: 'B' }), 'adres-eksik');
  const q = adresSorgusu(f('1', 'A'));
  assert.equal(konumDurumu(f('1', 'A', { latitude: 38.4, longitude: 27.1, geo_query: q, geo_source: 'google' })), 'guncel');
  assert.equal(konumDurumu(f('1', 'A', { latitude: 38.4, longitude: 27.1, geo_query: 'eski adres', geo_source: 'google' })), 'eski');
  assert.equal(konumDurumu(f('1', 'A', { latitude: 38.4, longitude: 27.1, geo_query: 'eski adres', geo_source: 'manuel' })), 'guncel');
});

const personel = [{ id: 'u1', full_name: 'Uzman Ali', staff_type: 'is_guvenligi_uzmani' }, { id: 'h1', full_name: 'Hekim Veli', staff_type: 'isyeri_hekimi' }];
const atama = (c, e, t, ek = {}) => ({ company_id: c, employee_id: e, staff_type: t, share_pct: 100, valid_from: '2026-01-01', valid_to: null, archived_at: null, ...ek });
const zaman = (c, e, tarih, ek = {}) => ({ company_id: c, employee_id: e, work_date: tarih, activity_type: 'ziyaret', archived_at: null, ...ek });
test('aylık ziyaret durumu: uzman ve hekim ayrı, plan ve yapıldı', () => {
  const firmalar = [f('a', 'A'), f('b', 'B'), f('c', 'C'), f('d', 'D'), f('p', 'Pasif', { customer_status: 'eski_musteri' })];
  const atamalar = [atama('a', 'u1', 'is_guvenligi_uzmani'), atama('a', 'h1', 'isyeri_hekimi'), atama('b', 'u1', 'is_guvenligi_uzmani'), atama('b', 'h1', 'isyeri_hekimi'), atama('c', 'u1', 'is_guvenligi_uzmani', { valid_to: '2026-09-30' }), atama('p', 'u1', 'is_guvenligi_uzmani')];
  const zamanlar = [zaman('a', 'u1', '2026-11-05'), zaman('a', 'h1', '2026-11-12'), zaman('b', 'u1', '2026-11-03'), zaman('b', 'u1', '2026-10-30'),
    zaman('b', 'h1', '2026-11-04', { activity_type: 'yol' }), zaman('b', 'h1', '2026-11-04', { archived_at: 'x' }), zaman('d', 'u1', '2026-11-10')];
  const planlar = [{ company_id: 'b', staff_type: 'isyeri_hekimi', planned_date: '2026-11-20', archived_at: null, id: 'p1' }, { company_id: 'b', staff_type: 'isyeri_hekimi', planned_date: '2026-12-02', archived_at: null }];
  const d = ayZiyaretDurumlari({ firmalar, atamalar, personel, zamanlar, planlar, ayBasi: '2026-11-01' });
  assert.equal(d.has('p'), false, 'pasif firma yok');
  assert.equal(d.get('a').ozet, 'tamam');
  assert.equal(d.get('a').turler.is_guvenligi_uzmani.sonZiyaret, '2026-11-05');
  assert.equal(d.get('b').ozet, 'kismi'); assert.equal(d.get('b').turler.is_guvenligi_uzmani.yapilan, 1);
  assert.equal(d.get('b').turler.isyeri_hekimi.durum, 'planli'); assert.equal(d.get('b').turler.isyeri_hekimi.planlar.length, 1);
  assert.equal(d.get('c').ozet, 'gerekmez'); assert.equal(d.get('c').turler.is_guvenligi_uzmani.durum, 'gerekmez');
  assert.equal(d.get('d').ozet, 'gerekmez', 'görevlendirmesi olmayan firma: beklenen ziyaret yok (yapılan ziyaret durumu değiştirmez)');
  assert.equal(d.get('d').turler.is_guvenligi_uzmani.durum, 'yapildi');
  assert.deepEqual(d.get('a').turler.is_guvenligi_uzmani.gorevliler, ['Uzman Ali']);
  assert.equal(firmaOzeti({ x: { gerekli: true, durum: 'bekliyor' }, y: { gerekli: true, durum: 'planli' } }), 'eksik');
});
test('süzgeç, ayrık değerler', () => {
  const firmalar = [f('a', 'Ege Çelik'), f('b', 'Bergama Gıda', { district: 'Bergama' }), f('c', 'Ankara Yapı', { city: 'Ankara', district: 'Çankaya', latitude: 39.9, longitude: 32.8, geo_query: 'x', geo_source: 'manuel' })];
  const atamalar = [atama('a', 'u1', 'is_guvenligi_uzmani'), atama('b', 'h1', 'isyeri_hekimi')];
  const satirlar = ziyaretSatirlari({ firmalar, durumlar: ayZiyaretDurumlari({ firmalar, atamalar, personel, zamanlar: [], planlar: [], ayBasi: '2026-11-01' }) });
  assert.deepEqual(satirlar.map((s) => s.firma.name), ['Ankara Yapı', 'Bergama Gıda', 'Ege Çelik']);
  assert.deepEqual(filtrele(satirlar, { il: 'İzmir' }).map((s) => s.firma.id), ['b', 'a']);
  assert.deepEqual(filtrele(satirlar, { ilce: 'Bergama' }).map((s) => s.firma.id), ['b']);
  assert.deepEqual(filtrele(satirlar, { gorevli: 'u1' }).map((s) => s.firma.id), ['a']);
  assert.deepEqual(filtrele(satirlar, { ozet: 'eksik' }).map((s) => s.firma.id), ['b', 'a']);
  assert.deepEqual(filtrele(satirlar, { konum: 'var' }).map((s) => s.firma.id), ['c']);
  assert.deepEqual(filtrele(satirlar, { konum: 'yok' }).map((s) => s.firma.id), ['b', 'a']);
  assert.deepEqual(filtrele(satirlar, { ara: 'çelik' }).map((s) => s.firma.id), ['a']);
  assert.deepEqual(ayrikDegerler(firmalar, 'city'), ['Ankara', 'İzmir']);
});
test('mesafe ve rota bağlantısı', () => {
  const izmir = { latitude: 38.4237, longitude: 27.1428 }; const ankara = { latitude: 39.9334, longitude: 32.8597 };
  assert.ok(Math.abs(mesafeKm(izmir, ankara) - 520) < 15);
  const k = (id, la, lo) => ({ id, latitude: la, longitude: lo });
  const sira = yakinSiraya([k('a', 38.40, 27.10), k('uzak', 40.0, 30.0), k('yakin', 38.41, 27.11), k('orta', 38.7, 27.5)]);
  assert.deepEqual(sira.map((x) => x.id), ['a', 'yakin', 'orta', 'uzak']);
  const r = rotaBaglantisi([k('a', 38.4, 27.1), k('b', 38.5, 27.2), { id: 'konumsuz' }], { sirala: false });
  assert.equal(r.url, 'https://www.google.com/maps/dir/?api=1&travelmode=driving&destination=38.500000%2C27.200000&waypoints=38.400000%2C27.100000'); assert.equal(r.kullanilan.length, 2);
  const cok = Array.from({ length: 14 }, (_, i) => k(`f${i}`, 38 + i / 100, 27)); const rc = rotaBaglantisi(cok);
  assert.equal(rc.kullanilan.length, ROTA_AZAMI_DURAK); assert.equal(rc.atlanan, 4);
  assert.equal(rotaBaglantisi([{ id: 'x' }]).url, null);
});
