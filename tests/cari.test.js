import test from 'node:test';
import assert from 'node:assert/strict';
import { tahsilatDagitimi, cariEkstre, cariYillari, cariExcel, tahsilatTarihiTahmini, donemMetni } from '../src/lib/cari.js';
import { xlsxOku } from '../src/lib/xlsx.js';

const F = (id, no, tarih, tutar, extra = {}) => ({ id, invoice_no: no, company_id: 'c1', invoice_date: tarih, amount_incl_vat: tutar, archived_at: null, ...extra });
const P = (id, inv, tarih, tutar, extra = {}) => ({ id, invoice_id: inv, paid_at: tarih, amount: tutar, archived_at: null, method: null, notes: null, ...extra });
const faturalar = [F('a', 'F1', '2026-03-31', 5500), F('b', 'F2', '2026-04-30', 6000), F('c', 'F3', '2026-05-30', 14000), F('x', 'X1', '2026-05-30', 999, { company_id: 'c2' }), F('z', 'Z', '2026-05-31', 1, { archived_at: '2026-06-01' })];
const tahsilatlar = [P('p1', 'a', '2026-05-07', 5500), P('p2', 'b', '2026-05-07', 6000), P('p3', 'c', '2026-06-01', 4000), P('pi', 'c', '2026-06-02', 50, { archived_at: 'x' }), P('px', 'x', '2026-05-30', 999)];
const kalemler = [{ invoice_id: 'a', description: 'Mart 2026 İSG hizmeti' }];

test('cariEkstre: fatura alacak, tahsilat borç; birikimli bakiye (örnek tablodaki gibi)', () => {
  const e = cariEkstre({ faturalar, tahsilatlar, kalemler, companyId: 'c1' });
  assert.equal(e.satirlar.length, 6);
  assert.deepEqual(e.satirlar.map((s) => [s.tarih, s.borc, s.alacak, s.bakiye]), [
    ['2026-03-31', 0, 5500, 5500], ['2026-04-30', 0, 6000, 11500], ['2026-05-07', 5500, 0, 6000], ['2026-05-07', 6000, 0, 0],
    ['2026-05-30', 0, 14000, 14000], ['2026-06-01', 4000, 0, 10000]]);
  assert.equal(e.toplamAlacak, 25500); assert.equal(e.toplamBorc, 15500); assert.equal(e.bakiye, 10000); assert.equal(e.durum, 'alacakli');
  assert.match(e.satirlar[0].aciklama, /Mart 2026 İSG hizmeti \(F1\)/);
  assert.match(e.satirlar[2].aciklama, /^Ödeme/);
});

test('cariEkstre: dönem seçimi devir hesaplar, aralık dışı hareket dahil edilmez', () => {
  const e = cariEkstre({ faturalar, tahsilatlar, kalemler, companyId: 'c1', baslangic: '2026-05-01', bitis: '2026-05-31' });
  assert.equal(e.devir, 11500);
  assert.deepEqual(e.satirlar.map((s) => s.bakiye), [6000, 0, 14000]);
  assert.equal(e.bakiye, 14000);
});

test('cariEkstre: aynı gün önce fatura sonra tahsilat; fazla tahsilat borçlu; kuruş hatası yok', () => {
  const e = cariEkstre({ faturalar: [F('a', 'F1', '2026-01-10', 0.1), F('b', 'F2', '2026-01-10', 0.2)], tahsilatlar: [P('p', 'a', '2026-01-10', 0.3)], companyId: 'c1' });
  assert.deepEqual(e.satirlar.map((s) => s.tur), ['fatura', 'fatura', 'tahsilat']);
  assert.equal(e.bakiye, 0); assert.equal(e.durum, 'kapali');
  const f = cariEkstre({ faturalar: [F('a', 'F1', '2026-01-10', 100)], tahsilatlar: [P('p', 'a', '2026-01-11', 150)], companyId: 'c1' });
  assert.equal(f.bakiye, -50); assert.equal(f.durum, 'borclu');
});

test('cariEkstre: tahsilat tarihi değişince ekstredeki yeri ve dönemi değişir; toplu işaretleme tahmini tarih uyarısı', () => {
  const t = [P('p', 'a', '2026-03-31', 5500, { method: 'Toplu işaretleme', notes: 'Toplu işaretleme (tarih bilinmiyor; fatura tarihi kullanıldı)' })];
  assert.equal(tahsilatTarihiTahmini(t[0]), true);
  let e = cariEkstre({ faturalar, tahsilatlar: t, companyId: 'c1', baslangic: '2026-01-01', bitis: '2026-04-15' });
  assert.equal(e.tahminiTarihliAdet, 1);
  assert.equal(e.satirlar.at(-1).bakiye, 0);
  assert.equal(e.satirlar.find((s) => s.tur === 'tahsilat').aciklama, 'Ödeme - F1 nolu fatura');
  e = cariEkstre({ faturalar, tahsilatlar: [{ ...t[0], paid_at: '2026-05-07', notes: null, method: 'Havale / EFT' }], companyId: 'c1', baslangic: '2026-01-01', bitis: '2026-04-15' });
  assert.equal(e.toplamBorc, 0); assert.equal(e.bakiye, 5500);
});

test('cariYillari ve donemMetni', () => {
  assert.deepEqual(cariYillari([F('a', 'F', '2025-12-31', 1), F('b', 'G', '2026-01-01', 1)], [P('p', 'a', '2027-02-01', 1)], 'c1'), ['2027', '2026', '2025']);
  assert.equal(donemMetni('2026-01-01', '2026-12-31'), '01.01.2026 - 31.12.2026');
  assert.equal(donemMetni('', ''), 'Tüm dönem');
});

test('cariExcel: geçerli xlsx; başlık bloğu, tablo, toplam ve banka bilgisi', async () => {
  const e = cariEkstre({ faturalar, tahsilatlar, kalemler, companyId: 'c1' });
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
  const bayt = cariExcel({ firma: { name: 'DALYANKÖY TURİZM', tax_no: '2690404760', tax_office: 'ÇEŞME VD', address: 'DALYAN MAH.', city: 'İzmir', district: 'Çeşme', phone: '', email: '' }, yetkili: 'Ali', ekstre: e, logoBayt: png });
  const sayfa = await xlsxOku(bayt.buffer.slice(bayt.byteOffset, bayt.byteOffset + bayt.byteLength));
  const duz = JSON.stringify(sayfa);
  for (const beklenen of ['FİRMA ÜNVANI', 'DALYANKÖY TURİZM', 'ÇEŞME VD', 'TARİH', 'BORÇ', 'ALACAK', 'BAKİYE', 'AÇIKLAMA', 'ALACAKLI', 'BANKA HESAP BİLGİLERİMİZ', 'TR39 0001']) assert.ok(duz.includes(beklenen), beklenen);
  assert.ok(Buffer.from(bayt).includes(Buffer.from('xl/media/image1.png')), 'logo gömülü');
});

test('tahsilatDagitimi: eski faturadan başlar, kısmi kalan hesaplanır, fazla tutar artan olur', () => {
  const fat = [F('b', 'N2', '2026-02-01', 5000), F('a', 'N1', '2026-01-01', 5000), F('x', 'XX', '2026-01-01', 100, { company_id: 'c2' }), F('z', 'Z', '2025-01-01', 9, { archived_at: 'x' })];
  const r = tahsilatDagitimi({ faturalar: fat, tahsilatlar: [], companyId: 'c1', tutar: 7500 });
  assert.deepEqual(r.dagitim.map((d) => [d.fatura.invoice_no, d.tutar, d.kismi, d.kalanSonra]), [['N1', 5000, false, 0], ['N2', 2500, true, 2500]]);
  assert.equal(r.artan, 0); assert.equal(r.acik, 10000);
  const k = tahsilatDagitimi({ faturalar: fat, tahsilatlar: [P('p', 'a', '2026-03-01', 1000)], companyId: 'c1', tutar: 4100 });
  assert.deepEqual(k.dagitim.map((d) => [d.fatura.invoice_no, d.tutar, d.kismi]), [['N1', 4000, false], ['N2', 100, true]]);
  assert.equal(tahsilatDagitimi({ faturalar: fat, tahsilatlar: [], companyId: 'c1', tutar: 10000.5 }).artan, 0.5);
});

test('cariEkstre: firma tahsilatı tek satır; açıklamada fatura no ve kısmi', () => {
  const fat = [F('a', 'N1', '2026-01-01', 5000), F('b', 'N2', '2026-02-01', 5000)];
  const tah = [P('p1', 'a', '2026-03-01', 5000, { group_id: 'g', method: 'Havale / EFT', notes: 'dekont' }), P('p2', 'b', '2026-03-01', 2500, { group_id: 'g', method: 'Havale / EFT', notes: 'dekont' })];
  const e = cariEkstre({ faturalar: fat, tahsilatlar: tah, companyId: 'c1' });
  assert.equal(e.satirlar.length, 3);
  const o = e.satirlar[2];
  assert.equal(o.borc, 7500); assert.equal(o.grup, 'g'); assert.equal(o.kayitlar.length, 2);
  assert.equal(o.aciklama, 'Ödeme - Havale / EFT - dekont - N1 nolu fatura, N2 nolu fatura (kısmi)');
  assert.equal(e.bakiye, 2500);
  // sonradan kalan ödenince ilk ödeme "kısmi" olarak kalır, ikincisi tam
  const e2 = cariEkstre({ faturalar: fat, tahsilatlar: [...tah, P('p3', 'b', '2026-04-01', 2500)], companyId: 'c1' });
  assert.match(e2.satirlar[2].aciklama, /N2 nolu fatura \(kısmi\)$/);
  assert.match(e2.satirlar[3].aciklama, /N2 nolu fatura$/);
  assert.equal(e2.bakiye, 0);
});
