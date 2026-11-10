import test from 'node:test';
import assert from 'node:assert/strict';
import { maasHesapla, maasToplamlari } from '../src/lib/idari.js';

test('maaş hesaplayıcı: diğer = net maaş − banka; banka girilmemişse diğer yok', () => {
  assert.deepEqual(maasHesapla(35000, 28075.5), { net: 35000, banka: 28075.5, diger: 6924.5, asim: false });
  assert.equal(maasHesapla('35000.10', '0.20').diger, 34999.9);          // kayan nokta hatası olmaz
  assert.equal(maasHesapla(35000, null).diger, null); assert.equal(maasHesapla(35000, '').diger, null);
  assert.equal(maasHesapla(35000, 0).diger, 35000);
  assert.equal(maasHesapla(1000, 1500).diger, -500); assert.equal(maasHesapla(1000, 1500).asim, true);
  assert.equal(maasHesapla(null, 100).diger, null);
});
test('maaş toplamları: diğer yalnızca banka girilmiş satırlardan', () => {
  const t = maasToplamlari([{ net_salary: 30000, bank_amount: 20000 }, { net_salary: 25000.5, bank_amount: 25000.5 }, { net_salary: 10000, bank_amount: null }]);
  assert.deepEqual(t, { adet: 3, net: 65000.5, banka: 45000.5, diger: 10000, girilen: 2, artiToplam: 10000, eksiToplam: 0 });
  const k = maasToplamlari([{ net_salary: 1000, bank_amount: 400 }, { net_salary: 1000, bank_amount: 1500 }, { net_salary: 500, bank_amount: 700.5 }, { net_salary: 800, bank_amount: 800 }]);
  assert.equal(k.artiToplam, 600); assert.equal(k.eksiToplam, -700.5); assert.equal(k.diger, -100.5);
  assert.deepEqual(maasToplamlari([]), { adet: 0, net: 0, banka: 0, diger: 0, girilen: 0, artiToplam: 0, eksiToplam: 0 });
});
