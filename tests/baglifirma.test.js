import test from 'node:test';
import assert from 'node:assert/strict';
import { profilleriGrupla, anaFirmaHaritasi } from '../src/lib/veri.js';
import { atamalariBagla, ayAtamalari } from '../src/lib/operasyon.js';

const p = (c, n, h, vf, vt = null) => ({ id: `${c}-${vf}`, company_id: c, employee_count: n, hazard_class: h, valid_from: vf, valid_to: vt });
const firmalar = [{ id: 'A' }, { id: 'B', parent_company_id: 'A' }, { id: 'C', parent_company_id: 'A' }, { id: 'D' }];

test('anaFirmaHaritasi: bağlı → ana', () => {
  assert.deepEqual([...anaFirmaHaritasi(firmalar)], [['B', 'A'], ['C', 'A']]);
});

test('profilleriGrupla: bağlı firmaların çalışan sayısı ve tehlike sınıfları ana firmada toplanır', () => {
  const h = profilleriGrupla([p('A', 10, 'az_tehlikeli', '2026-01-01'), p('B', 5, 'tehlikeli', '2026-01-01'), p('C', 3, 'az_tehlikeli', '2026-01-01'), p('D', 7, 'tehlikeli', '2026-01-01')], firmalar);
  assert.ok(!h.has('B') && !h.has('C'));
  const a = h.get('A')[0];
  assert.equal(a.employee_count, 18);
  assert.equal(a.hazard_class, 'tehlikeli');
  assert.equal(a.site_breakdown.length, 2);
  assert.equal(h.get('D')[0].employee_count, 7);
});

test('profilleriGrupla: bağlanmamışsa eskisi gibi', () => {
  const h = profilleriGrupla([p('A', 10, 'az_tehlikeli', '2026-01-01')], [{ id: 'A' }]);
  assert.equal(h.get('A')[0].employee_count, 10);
});

test('atamalariBagla + ayAtamalari: payların toplamı %100\'ü aşarsa oranlanır; pasif bağlı firma düşer', () => {
  const at = (id, c, pay) => ({ id, company_id: c, employee_id: 'u', staff_type: 'is_guvenligi_uzmani', share_pct: pay, valid_from: '2026-01-01', valid_to: null });
  const fl = [{ id: 'A' }, { id: 'B', parent_company_id: 'A' }, { id: 'C', parent_company_id: 'A', customer_status: 'eski_musteri' }];
  const l = atamalariBagla([at('1', 'A', 60), at('2', 'B', 60), at('3', 'C', 60)], fl);
  assert.equal(l.length, 2);
  assert.ok(l.every((x) => x.company_id === 'A'));
  const s = ayAtamalari(l, '2026-10-01');
  assert.equal(s.reduce((t, x) => t + x.share_pct, 0), 100);
});
