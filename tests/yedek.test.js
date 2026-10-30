import test from 'node:test';
import assert from 'node:assert/strict';
import { yedekPaketi, yedekDogrula, yedekYasi, yedekDosyaAdi, YEDEK_TABLOLARI } from '../src/lib/yedek.js';

const tablolar = () => Object.fromEntries(YEDEK_TABLOLARI.map((t) => [t.ad, []])) && { ...Object.fromEntries(YEDEK_TABLOLARI.map((t) => [t.ad, []])), companies: [{ id: 'a', name: 'Alfa Gıda' }, { id: 'b', name: 'Beta "İnşaat"' }], payments: [{ id: 'p', amount: 12.5 }] };

test('yedek paketi: sayılar, toplam, özet ve dosya adı', async () => {
  const p = await yedekPaketi(tablolar(), { kurum: 'Karma OSGB', simdi: new Date(2026, 9, 30, 11, 5) });
  assert.equal(p.dosyaAdi, 'osgb360-yedek-2026-10-30-1105.json');
  assert.equal(p.tabloSayisi, YEDEK_TABLOLARI.length); assert.equal(p.satirSayisi, 3);
  const j = JSON.parse(p.metin);
  assert.equal(j.uygulama, 'osgb360'); assert.equal(j.sayilar.companies, 2); assert.equal(j.toplam_satir, 3); assert.match(j.ozet_sha256, /^[0-9a-f]{64}$/);
  assert.equal(j.tablolar.companies[1].name, 'Beta "İnşaat"');
});

test('doğrulama: sağlam yedek geçer, Türkçe karakterler bozulmaz', async () => {
  const p = await yedekPaketi(tablolar());
  const d = await yedekDogrula(p.metin);
  assert.equal(d.gecerli, true, d.hatalar.join('|')); assert.equal(d.toplamSatir, 3); assert.deepEqual(d.uyarilar, []);
  assert.equal(d.tablolar.find((x) => x.ad === 'companies').adet, 2);
});

test('doğrulama: içerik değiştirilmişse, satır silinmişse, bozuk JSON veya yabancı dosya ise reddeder', async () => {
  const p = JSON.parse((await yedekPaketi(tablolar())).metin);
  const degismis = structuredClone(p); degismis.tablolar.payments[0].amount = 99999;
  assert.match((await yedekDogrula(JSON.stringify(degismis))).hatalar.join(' '), /SHA-256/);
  const eksik = structuredClone(p); eksik.tablolar.companies.pop();
  const e = await yedekDogrula(JSON.stringify(eksik)); assert.equal(e.gecerli, false); assert.match(e.hatalar.join(' '), /companies/);
  assert.match((await yedekDogrula('{bozuk')).hatalar[0], /geçerli bir JSON değil/);
  assert.match((await yedekDogrula('{"a":1}')).hatalar[0], /yedek dosyası değil/);
  assert.match((await yedekDogrula(JSON.stringify({ ...p, surum: 9 }))).hatalar[0], /Desteklenmeyen/);
  assert.match((await yedekDogrula(JSON.stringify({ ...p, tablolar: [] }))).hatalar[0], /tablo verisi yok/);
  assert.match((await yedekDogrula('')).hatalar[0], /JSON/);
});

test('doğrulama: eksik tablo ve okunamayan tablo uyarı verir ama geçersiz saymaz', async () => {
  const t = tablolar(); delete t.audit_logs;
  const d = await yedekDogrula((await yedekPaketi(t, { eksik: ['audit_logs'] })).metin);
  assert.equal(d.gecerli, true); assert.equal(d.uyarilar.length, 2); assert.match(d.uyarilar.join(' '), /audit_logs/);
});

test('yedek yaşı: gün sayısı; hiç yoksa null', () => {
  const simdi = new Date('2026-10-30T12:00:00Z');
  assert.equal(yedekYasi(null, simdi), null); assert.equal(yedekYasi('bozuk', simdi), null);
  assert.equal(yedekYasi('2026-10-30T08:00:00Z', simdi), 0); assert.equal(yedekYasi('2026-10-20T12:00:00Z', simdi), 10); assert.equal(yedekYasi('2026-11-02T00:00:00Z', simdi), 0);
  assert.equal(yedekDosyaAdi(new Date(2026, 0, 5, 9, 7)), 'osgb360-yedek-2026-01-05-0907.json');
});
