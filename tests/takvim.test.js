import test from 'node:test';
import assert from 'node:assert/strict';
import { ayIzgarasi, ogeGunleri, olaylariUret, kalanGunMetni, ayEkle, ayinSonu, gunlereGore } from '../src/lib/takvim.js';

test('ızgara: pazartesi başlar, tam haftalar, ayı kapsar', () => {
  const h = ayIzgarasi('2026-11-15'); // 1 Kasım 2026 pazar
  assert.equal(h[0][0], '2026-10-26'); assert.equal(h[0][6], '2026-11-01'); assert.ok(h.every((x) => x.length === 7));
  assert.ok(h.flat().includes('2026-11-30')); assert.equal(ayIzgarasi('2027-02-01').length, 4);
});
test('yıllık tekrar: her yıl aynı gün; 29 Şubat artık olmayan yılda 28 Şubat; başlangıçtan önce ve bitişten sonra yok', () => {
  const o = { recurrence: 'yillik', start_date: '2024-02-29', end_date: '2027-12-31' };
  assert.deepEqual(ogeGunleri(o, '2023-01-01', '2028-12-31'), ['2024-02-29', '2025-02-28', '2026-02-28', '2027-02-28']);
  assert.deepEqual(ogeGunleri({ recurrence: 'yillik', start_date: '2025-11-10' }, '2026-11-01', '2026-11-30'), ['2026-11-10']);
  assert.deepEqual(ogeGunleri({ recurrence: 'yillik', start_date: '2025-11-10' }, '2026-12-01', '2027-10-31'), []);
  assert.deepEqual(ogeGunleri({ recurrence: 'yillik', start_date: '2025-11-10' }, '2025-01-01', '2026-12-31'), ['2025-11-10', '2026-11-10']);
});
test('ay yardımcıları', () => { assert.equal(ayEkle('2026-12-15', 1), '2027-01-01'); assert.equal(ayinSonu('2028-02-10'), '2028-02-29'); assert.equal(ayinSonu('2026-04-02'), '2026-04-30'); });
test('aylık tekrar: 31. gün kısa aylarda ayın sonuna, bitiş tarihine uyar', () => {
  const o = { recurrence: 'aylik', start_date: '2026-01-31', end_date: '2026-04-15' };
  assert.deepEqual(ogeGunleri(o, '2026-01-01', '2026-12-31'), ['2026-01-31', '2026-02-28', '2026-03-31']);
  assert.deepEqual(ogeGunleri({ recurrence: 'aylik', start_date: '2026-03-10' }, '2026-02-01', '2026-04-30'), ['2026-03-10', '2026-04-10']);
  assert.deepEqual(ogeGunleri({ recurrence: 'yok', start_date: '2026-03-10' }, '2026-03-01', '2026-03-31'), ['2026-03-10']);
  assert.deepEqual(ogeGunleri({ recurrence: 'yok', start_date: '2026-03-10' }, '2026-04-01', '2026-04-30'), []);
});
test('olaylar: tamamlama, görev son/hatırlatma, arşiv ve kapalı görev dışarıda', () => {
  const ogeler = [{ id: 'a', title: 'Ödeme', recurrence: 'aylik', start_date: '2026-01-05', kind: 'odeme', amount: 100 }, { id: 'b', title: 'Eski', recurrence: 'yok', start_date: '2026-02-05', archived_at: 'x' }];
  const o = olaylariUret({ ogeler, tamamlamalar: [{ item_id: 'a', occurrence_date: '2026-02-05' }],
    gorevler: [{ id: 't1', title: 'G', status: 'acik', due_at: '2026-02-10T09:00:00Z', remind_at: '2026-02-08T21:30:00Z' }, { id: 't2', title: 'K', status: 'tamamlandi', due_at: '2026-02-10T09:00:00Z' }], bas: '2026-02-01', bit: '2026-02-28' });
  assert.equal(o.filter((x) => x.baslik === 'Ödeme')[0].tamam, true);
  assert.equal(o.filter((x) => x.baslik === 'G').length, 2); assert.equal(o.filter((x) => x.baslik === 'K').length, 0); assert.equal(o.filter((x) => x.baslik === 'Eski').length, 0);
  assert.equal(o.find((x) => x.kaynak === 'gorev_hatirlatma').tarih, '2026-02-09');   // 21:30 UTC = ertesi gün 00:30 İstanbul
  assert.equal(gunlereGore(o).get('2026-02-05').length, 1);
});
test('kalan gün metni', () => { assert.equal(kalanGunMetni(0), 'bugün'); assert.equal(kalanGunMetni(1), 'yarın'); assert.equal(kalanGunMetni(3), '3 gün kaldı'); assert.equal(kalanGunMetni(-2), '2 gün önce'); });
