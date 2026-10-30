import test from 'node:test';
import assert from 'node:assert/strict';
import { tabloAdi, alanAdi, degerMetni, kayitAdi, degisiklikler, islemEtiketi, tarihSiniri } from '../src/lib/denetim.js';

test('tablo ve alan adları Türkçe; bilinmeyenler okunur kalır', () => {
  assert.equal(tabloAdi('invoices'), 'Fatura'); assert.equal(tabloAdi('yeni_tablo'), 'yeni_tablo');
  assert.equal(alanAdi('gross_salary'), 'Brüt maaş'); assert.equal(alanAdi('some_new_field'), 'some new field');
});

test('değer metni: boş, mantıksal, sayı, tarih, kimlik, kod, uzun metin', () => {
  assert.equal(degerMetni(null), '—'); assert.equal(degerMetni(''), '—');
  assert.equal(degerMetni(true), 'Evet'); assert.equal(degerMetni(false), 'Hayır');
  assert.equal(degerMetni(1234.5), '1.234,5');
  assert.equal(degerMetni('2026-10-29'), '29.10.2026');
  assert.equal(degerMetni('0a1b2c3d-0000-4000-8000-1234567890ab'), 'kayıt …7890ab');
  assert.equal(degerMetni('az_tehlikeli'), 'az tehlikeli');
  assert.equal(degerMetni('x'.repeat(200)).length, 78);
  assert.equal(degerMetni({ a: 1 }), '{"a":1}');
  assert.match(degerMetni('2026-10-29T10:30:00+03:00'), /^\d{2}\.\d{2}\.\d{4} \d{2}:\d{2}$/);
});

test('kayıt adı: ad/başlık/fatura no; tahsilatta tutar; yoksa kısa kimlik', () => {
  assert.equal(kayitAdi('companies', { name: ' Alfa Gıda ' }), 'Alfa Gıda');
  assert.equal(kayitAdi('invoices', { invoice_no: 'F-12' }), 'F-12');
  assert.equal(kayitAdi('payments', { amount: 1500 }), '1.500 TL tahsilat');
  assert.equal(kayitAdi('role_permissions', { module: 'settings' }), 'settings yetkisi');
  assert.equal(kayitAdi('tasks', { id: 'abcdef123456' }), 'Görev …123456');
  assert.equal(kayitAdi('tasks', null, 'zzzzzz999'), 'Görev …zzz999');
});

test('değişiklikler: UPDATE yalnızca değişeni, gürültüyü atlar; INSERT dolu alanları verir; sınır uygulanır', () => {
  const g = degisiklikler({ action: 'UPDATE',
    old_data: { id: 'a', name: 'Alfa', city: 'Ankara', updated_at: '1', is_active: true },
    new_data: { id: 'a', name: 'Alfa', city: 'İzmir', updated_at: '2', is_active: false } });
  assert.deepEqual(g.liste.map((x) => [x.ad, x.eski, x.yeni]), [['Şehir', 'Ankara', 'İzmir'], ['Aktif', 'Evet', 'Hayır']]);
  const i = degisiklikler({ action: 'INSERT', old_data: null, new_data: { id: 'a', organization_id: 'o', name: 'Beta', note: null, city: '' } });
  assert.deepEqual(i.liste.map((x) => [x.ad, x.eski, x.yeni]), [['Ad', null, 'Beta']]);
  const cok = degisiklikler({ action: 'INSERT', new_data: Object.fromEntries(Array.from({ length: 20 }, (_, k) => [`f${k}`, k + 1])) }, 5);
  assert.equal(cok.liste.length, 5); assert.equal(cok.fazla, 15);
  assert.deepEqual(degisiklikler({ action: 'UPDATE', old_data: { a: 1 }, new_data: { a: 1 } }).liste, []);
});

test('işlem etiketi: arşivleme ve geri alma ayrı gösterilir', () => {
  assert.equal(islemEtiketi({ action: 'INSERT' }), 'Eklendi');
  assert.equal(islemEtiketi({ action: 'UPDATE', old_data: { archived_at: null }, new_data: { archived_at: '2026-10-01T00:00:00Z' } }), 'Arşivlendi');
  assert.equal(islemEtiketi({ action: 'UPDATE', old_data: { archived_at: '2026-10-01T00:00:00Z' }, new_data: { archived_at: null } }), 'Arşivden çıkarıldı');
  assert.equal(islemEtiketi({ action: 'UPDATE', old_data: { a: 1 }, new_data: { a: 2 } }), 'Güncellendi');
  assert.equal(islemEtiketi({ action: 'BACKUP' }), 'Yedek alındı');
});

test('tarih sınırı: Türkiye saatiyle gün başı/sonu; ters aralık ve geçersiz tarih yakalanır', () => {
  assert.deepEqual(tarihSiniri('2026-10-01', '2026-10-31'), { bas: '2026-10-01T00:00:00+03:00', bit: '2026-10-31T23:59:59.999+03:00', hata: null });
  assert.equal(tarihSiniri('2026-10-31', '2026-10-01').hata, 'Başlangıç tarihi bitiş tarihinden sonra olamaz.');
  assert.deepEqual(tarihSiniri('', 'abc'), { bas: null, bit: null, hata: null });
  assert.equal(tarihSiniri('2026-13-45', null).bas, null);
});
