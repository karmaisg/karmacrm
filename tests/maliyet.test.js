import test from 'node:test';
import assert from 'node:assert/strict';
import { sgkPrimi, sgkOrani, toplamMaliyet, maliyetHesapla, kayitToplami } from '../src/lib/maliyet.js';

test('SGK primi: emekli %32,25, emekli değil %38,75 (brüt üzerinden)', () => {
  assert.equal(sgkPrimi(100000, false), 38750); assert.equal(sgkPrimi(100000, true), 32250);
  assert.equal(sgkPrimi(40000, false), 15500); assert.equal(sgkPrimi(40000, true), 12900);
  assert.equal(sgkPrimi(0, false), 0); assert.equal(sgkPrimi(null, true), 0); assert.equal(sgkPrimi('abc', false), 0);
  assert.equal(sgkPrimi(33333.33, false), 12916.67);      // iki ondalığa yuvarlanır
  assert.ok(Math.abs(sgkOrani(true) - 0.3225) < 1e-12 && Math.abs(sgkOrani(false) - 0.3875) < 1e-12);
});

test('toplam maliyet = net + SGK + elden; hiçbiri zorunlu değil', () => {
  assert.equal(toplamMaliyet({ net: 30000, sgk: 15500, elden: 5000 }), 50500);
  assert.equal(toplamMaliyet({ sgk: 1234.56 }), 1234.56);
  assert.equal(toplamMaliyet({}), 0);
});

test('form girdisi: SGK boşsa otomatik, doluysa elle; boş alanlar 0', () => {
  let x = maliyetHesapla({ brut: '40000', net: '30000', emekli: false, sgk: '', elden: '5000' });
  assert.deepEqual([x.sgk, x.sgkElle, x.toplam], [15500, false, 50500]);
  x = maliyetHesapla({ brut: '40000', net: '30000', emekli: true, sgk: '', elden: '' });
  assert.deepEqual([x.sgk, x.toplam], [12900, 42900]);
  x = maliyetHesapla({ brut: '', net: '', emekli: false, sgk: '2000,50', elden: '' });     // maaş yok, yalnızca SGK
  assert.deepEqual([x.sgk, x.sgkElle, x.toplam], [2000.5, true, 2000.5]);
  x = maliyetHesapla({ brut: '40000', net: '30000', emekli: false, sgk: '0', elden: '' });  // 0 yazılırsa SGK yok (elle)
  assert.deepEqual([x.sgk, x.sgkElle, x.toplam], [0, true, 30000]);
  x = maliyetHesapla({}); assert.equal(x.toplam, 0);
});

test('kayıt toplamı: yeni sürüm net+SGK+elden, eski sürüm brüt+SGK+diğer', () => {
  assert.equal(kayitToplami({ cost_version: 2, net_salary: 30000, employer_sgk: 15500, cash_paid: 5000, gross_salary: 40000 }), 50500);
  assert.equal(kayitToplami({ cost_version: 1, gross_salary: 50000, employer_sgk: 12000, other_benefits: 3000 }), 65000);
});
