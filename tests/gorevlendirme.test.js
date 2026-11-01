import test from 'node:test';
import assert from 'node:assert/strict';
import { gorevlendirmeOnerisi, gorevlendirmePaketi } from '../src/lib/gorevlendirme.js';

// Basit kural: uzman az tehlikeli 10 dk/çalışan, hekim 5 dk/çalışan (ay başı 2026-10-01)
const kurallar = ['is_guvenligi_uzmani', 'isyeri_hekimi'].flatMap((t) => ['az_tehlikeli', 'tehlikeli', 'cok_tehlikeli'].map((h) => ({
  staff_type: t, hazard_class: h, minutes_per_employee: t === 'isyeri_hekimi' ? 5 : 10, min_minutes: 0, valid_from: '2020-01-01', valid_to: null, is_active: true })));
const veri = () => ({
  satirlar: [
    { site_id: 's1', staff_type: 'is_guvenligi_uzmani', cert_type: 'A Sınıfı', cert_no: 'U1', person_name: 'Ali Uzman', minutes_per_month: 300, contract_id: 'C1', start_date: '2026-01-01' },
    { site_id: 's1', staff_type: 'isyeri_hekimi', cert_type: 'İşyeri Hekimi', cert_no: 'H1', person_name: 'Hale Hekim', minutes_per_month: 100, contract_id: 'C2', start_date: '2026-01-01' },
    { site_id: 's1', staff_type: 'diger_saglik', cert_no: 'D1', person_name: 'Sema DSP', minutes_per_month: 50, contract_id: 'C3' },
  ],
  siteler: [{ id: 's1', company_id: 'f1' }], firmalar: [{ id: 'f1', name: 'Alfa' }],
  profilHaritasi: new Map([['f1', [{ valid_from: '2026-01-01', valid_to: null, employee_count: 50, hazard_class: 'az_tehlikeli' }]]]),
  kurallar, calisanlar: [], atamalar: [], tarih: '2026-10-01',
});
test('yeni firma: pay = dakika / ihtiyaç, yeni personel önerilir, DSP atlanır', () => {
  const o = gorevlendirmeOnerisi(veri());
  const t = o.firmalar[0].turler;
  assert.equal(t[0].ihtiyac, 500); assert.equal(t[0].satirlar[0].pay, 60); assert.equal(t[0].satirlar[0].islem, 'ekle');
  assert.equal(t[1].satirlar[0].pay, 40);   // hekim ihtiyacı 250 dk
  assert.equal(o.yeniKisiler.length, 2); assert.equal(o.atlanan.length, 1);
});
test('sertifika no ile eşleşir; adla eşleşen personele sertifika bağlanır', () => {
  const v = veri(); v.calisanlar = [{ id: 'e1', full_name: 'ALİ UZMAN', staff_type: 'is_guvenligi_uzmani', certificate_no: null }, { id: 'e2', full_name: 'Başka Ad', staff_type: 'isyeri_hekimi', certificate_no: 'H1' }];
  const o = gorevlendirmeOnerisi(v);
  assert.equal(o.firmalar[0].turler[0].satirlar[0].kisi.empId, 'e1'); assert.deepEqual(o.baglar, [{ employee_id: 'e1', sertifika_no: 'U1' }]);
  assert.equal(o.firmalar[0].turler[1].satirlar[0].kisi.empId, 'e2'); assert.equal(o.yeniKisiler.length, 0);
});
test('mevcut pay aynıysa değişmez; farklıysa değişir; Katip\'te olmayan biter ve uyarı verir', () => {
  const v = veri(); v.calisanlar = [{ id: 'e1', full_name: 'Ali Uzman', staff_type: 'is_guvenligi_uzmani', certificate_no: 'U1' }, { id: 'e3', full_name: 'Eski Uzman', staff_type: 'is_guvenligi_uzmani' }];
  v.atamalar = [{ id: 'a1', company_id: 'f1', employee_id: 'e1', staff_type: 'is_guvenligi_uzmani', share_pct: 50, valid_from: '2026-01-01', valid_to: null },
    { id: 'a3', company_id: 'f1', employee_id: 'e3', staff_type: 'is_guvenligi_uzmani', share_pct: 50, valid_from: '2026-01-01', valid_to: null }];
  const o = gorevlendirmeOnerisi(v); const t = o.firmalar[0].turler[0];
  assert.equal(t.satirlar[0].islem, 'degistir'); assert.equal(t.bitenler[0].ad, 'Eski Uzman'); assert.ok(t.uyarilar.some((u) => u.includes('değişikliği')));
  v.atamalar[0].share_pct = 60; v.atamalar.pop();
  assert.equal(gorevlendirmeOnerisi(v).firmalar[0].turler[0].satirlar[0].islem, 'degismedi');
});
test('süre toplamı ihtiyacı aşarsa oranlanır ve toplam %100\'ü geçmez', () => {
  const v = veri(); v.satirlar = [{ ...v.satirlar[0], minutes_per_month: 400 }, { ...v.satirlar[0], cert_no: 'U2', person_name: 'Veli', minutes_per_month: 400 }];
  const t = gorevlendirmeOnerisi(v).firmalar[0].turler[0];
  assert.ok(t.satirlar.reduce((s, x) => s + x.pay, 0) <= 100); assert.ok(t.uyarilar[0].includes('oranlandı'));
});
test('ihtiyaç hesaplanamazsa firma atlanır, paket boş kalır', () => {
  const v = veri(); v.profilHaritasi = new Map();
  const o = gorevlendirmeOnerisi(v); assert.ok(o.firmalar[0].turler[0].atla);
  assert.equal(gorevlendirmePaketi(o, new Set(['f1']), 'i1').islemler.length, 0);
});
test('paket sırası: bitir, azalt, artır, ekle; yalnız seçili firmalar ve kullanılan kişiler', () => {
  const v = veri(); v.calisanlar = [{ id: 'e1', full_name: 'Ali Uzman', staff_type: 'is_guvenligi_uzmani', certificate_no: 'U1' }, { id: 'e3', full_name: 'Eski', staff_type: 'is_guvenligi_uzmani' }];
  v.atamalar = [{ id: 'a1', company_id: 'f1', employee_id: 'e1', staff_type: 'is_guvenligi_uzmani', share_pct: 10, valid_from: '2026-01-01' }, { id: 'a3', company_id: 'f1', employee_id: 'e3', staff_type: 'is_guvenligi_uzmani', share_pct: 90, valid_from: '2026-01-01' }];
  const o = gorevlendirmeOnerisi(v); const p = gorevlendirmePaketi(o, new Set(['f1']), 'i1');
  assert.deepEqual(p.islemler.map((x) => x.islem + (x.assignment_id ?? '')), ['bitira3', 'degistira1', 'ekle']);
  assert.equal(p.kisiler.length, 1); assert.equal(p.kisiler[0].ad, 'Hale Hekim');
  assert.equal(gorevlendirmePaketi(o, new Set(), 'i1').islemler.length, 0);
});
