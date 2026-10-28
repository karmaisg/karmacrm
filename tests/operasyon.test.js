import test from 'node:test';
import assert from 'node:assert/strict';
import { aktifMi, ayBitisi, kapsamPayi, personelAyYuku, zamanOzeti, dolulukSeviyesi, sureMetni, zamanCakisiyor } from '../src/lib/operasyon.js';

const kurallar = [
  { staff_type: 'is_guvenligi_uzmani', hazard_class: 'tehlikeli', minutes_per_employee: 20, valid_from: '2020-01-01', valid_to: null },
  { staff_type: 'isyeri_hekimi', hazard_class: 'tehlikeli', minutes_per_employee: 10, valid_from: '2020-01-01', valid_to: null },
];
const profil = (c, n) => ({ company_id: c, employee_count: n, hazard_class: 'tehlikeli', valid_from: '2020-01-01', valid_to: null });
const harita = new Map([['f1', [profil('f1', 50)]], ['f2', [profil('f2', 10)]]]);
const atama = (id, c, e, tur, pay, bas = '2026-01-01', bit = null) => ({ id, company_id: c, employee_id: e, staff_type: tur, share_pct: pay, valid_from: bas, valid_to: bit, archived_at: null });

test('ayBitisi: ay sonu ve yıl sonu', () => {
  assert.equal(ayBitisi('2026-10-01'), '2026-10-31');
  assert.equal(ayBitisi('2026-02-15'), '2026-02-28');
  assert.equal(ayBitisi('2028-02-01'), '2028-02-29');
  assert.equal(ayBitisi('2026-12-01'), '2026-12-31');
});

test('aktifMi: sınırlar dahil, arşiv hariç', () => {
  const a = atama('a', 'f1', 'e1', 'is_guvenligi_uzmani', 100, '2026-05-01', '2026-05-31');
  assert.equal(aktifMi(a, '2026-05-01'), true);
  assert.equal(aktifMi(a, '2026-05-31'), true);
  assert.equal(aktifMi(a, '2026-06-01'), false);
  assert.equal(aktifMi(a, '2026-04-30'), false);
  assert.equal(aktifMi({ ...a, archived_at: 'x' }, '2026-05-10'), false);
});

test('kapsamPayi: yalnızca o gün yürürlükteki aynı türün payları toplanır', () => {
  const l = [atama('1', 'f1', 'e1', 'is_guvenligi_uzmani', 60), atama('2', 'f1', 'e2', 'is_guvenligi_uzmani', 30, '2026-03-01'), atama('3', 'f1', 'e3', 'isyeri_hekimi', 100)];
  assert.equal(kapsamPayi(l, 'f1', 'is_guvenligi_uzmani', '2026-02-01'), 60);
  assert.equal(kapsamPayi(l, 'f1', 'is_guvenligi_uzmani', '2026-03-01'), 90);
  assert.equal(kapsamPayi(l, 'f1', 'isyeri_hekimi', '2026-03-01'), 100);
  assert.equal(kapsamPayi(l, 'f2', 'isyeri_hekimi', '2026-03-01'), 0);
});

test('personelAyYuku: firma ihtiyacının payı kadar; iki kişinin toplamı ihtiyacı aşmaz', () => {
  // f1: 50 kişi x 20 dk = 1000 dk uzman ihtiyacı; e1 %60, e2 %40
  const l = [atama('1', 'f1', 'e1', 'is_guvenligi_uzmani', 60), atama('2', 'f1', 'e2', 'is_guvenligi_uzmani', 40), atama('3', 'f2', 'e1', 'is_guvenligi_uzmani', 100)];
  const e1 = personelAyYuku({ atamalar: l, employeeId: 'e1', profilHaritasi: harita, kurallar, ay: '2026-10-01' });
  const e2 = personelAyYuku({ atamalar: l, employeeId: 'e2', profilHaritasi: harita, kurallar, ay: '2026-10-01' });
  assert.equal(e1.dakika, 600 + 200);   // f1 %60 = 600; f2 10x20 = 200 %100
  assert.equal(e2.dakika, 400);
  assert.equal(e1.kalemler.length, 2);
});

test('personelAyYuku: ay içinde başlayan görevlendirme o ay sayılmaz, bitmiş olan sayılmaz', () => {
  const l = [atama('1', 'f1', 'e1', 'is_guvenligi_uzmani', 100, '2026-10-15'), atama('2', 'f2', 'e1', 'is_guvenligi_uzmani', 100, '2026-01-01', '2026-09-30')];
  assert.equal(personelAyYuku({ atamalar: l, employeeId: 'e1', profilHaritasi: harita, kurallar, ay: '2026-10-01' }).dakika, 0);
  assert.equal(personelAyYuku({ atamalar: l, employeeId: 'e1', profilHaritasi: harita, kurallar, ay: '2026-11-01' }).dakika, 1000);
});

test('personelAyYuku: firma profili yoksa eksik işaretlenir, toplam 0 sayılır', () => {
  const l = [atama('1', 'fX', 'e1', 'isyeri_hekimi', 100)];
  const r = personelAyYuku({ atamalar: l, employeeId: 'e1', profilHaritasi: harita, kurallar, ay: '2026-10-01' });
  assert.equal(r.dakika, 0); assert.equal(r.eksikVar, true);
});

test('zamanOzeti: arşivdekiler hariç, hizmet = saha + rapor', () => {
  const k = [
    { total_minutes: 180, onsite_minutes: 120, travel_minutes: 30, waiting_minutes: 10, reporting_minutes: 20, admin_minutes: 0 },
    { total_minutes: 60, onsite_minutes: 0, travel_minutes: 0, waiting_minutes: 0, reporting_minutes: 0, admin_minutes: 60 },
    { total_minutes: 500, onsite_minutes: 500, travel_minutes: 0, waiting_minutes: 0, reporting_minutes: 0, admin_minutes: 0, archived_at: 'x' },
  ];
  const o = zamanOzeti(k);
  assert.deepEqual([o.adet, o.toplam, o.saha, o.yol, o.bekleme, o.rapor, o.idari, o.hizmet], [2, 240, 120, 30, 10, 20, 60, 140]);
});

test('dolulukSeviyesi ve sureMetni', () => {
  assert.equal(dolulukSeviyesi(1.2), 'asiri'); assert.equal(dolulukSeviyesi(1), 'dolu'); assert.equal(dolulukSeviyesi(0.95), 'dolu');
  assert.equal(dolulukSeviyesi(0.6), 'normal'); assert.equal(dolulukSeviyesi(0.2), 'bos'); assert.equal(dolulukSeviyesi(null), 'bilinmiyor');
  assert.equal(sureMetni(150), '2 sa 30 dk'); assert.equal(sureMetni(60), '1 sa'); assert.equal(sureMetni(0), '0 dk'); assert.equal(sureMetni(45), '45 dk');
});

test('zamanCakisiyor: bitiş=başlangıç çakışma sayılmaz; arşiv ve başka personel sayılmaz', () => {
  const k = [{ id: 'a', employee_id: 'e1', start_at: '2026-10-01T09:00:00Z', end_at: '2026-10-01T12:00:00Z' },
    { id: 'b', employee_id: 'e2', start_at: '2026-10-01T13:00:00Z', end_at: '2026-10-01T15:00:00Z' },
    { id: 'c', employee_id: 'e1', start_at: '2026-10-01T16:00:00Z', end_at: '2026-10-01T17:00:00Z', archived_at: 'x' }];
  assert.ok(zamanCakisiyor(k, 'e1', '2026-10-01T11:00:00Z', '2026-10-01T13:00:00Z'));
  assert.equal(zamanCakisiyor(k, 'e1', '2026-10-01T12:00:00Z', '2026-10-01T13:00:00Z'), null);
  assert.equal(zamanCakisiyor(k, 'e1', '2026-10-01T13:00:00Z', '2026-10-01T15:00:00Z'), null);
  assert.equal(zamanCakisiyor(k, 'e1', '2026-10-01T16:00:00Z', '2026-10-01T17:00:00Z'), null);
  assert.equal(zamanCakisiyor(k, 'e1', '2026-10-01T09:30:00Z', '2026-10-01T10:00:00Z', 'a'), null);
});
