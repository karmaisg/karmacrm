// OSGB 360 - Cari hesap ekstresi (saf fonksiyonlar). Testler: tests/cari.test.js
// Faturalar ALACAK, tahsilatlar BORÇ hanesine yazılır; bakiye = birikimli alacak - borç (pozitif: firmadan alacağımız var).
// Tutarlar KDV dahildir. Arşivdeki fatura ve iptal edilmiş tahsilatlar hesaba katılmaz. Kuruş (tam sayı) üzerinden toplanır.
import { xlsxYaz } from './xlsxyaz.js';
import { ayAdi } from './format.js';

// Excel altındaki banka bilgisi (satırlar). Değişirse buradan güncellenir.
export const BANKA_BILGISI = [
  'Türkiye Ziraat Bankası Osmangazi - Bayraklı / İzmir Şubesi',
  'Müşteri Adı: KARMA ORTAK SAĞLIK GÜVENLİK BİRİMİ',
  'IBAN No: TR39 0001 0021 3797 5442 7250 01',
];

const kurus = (x) => Math.round(Number(x ?? 0) * 100);
const tl = (k) => k / 100;
const TOPLU_NOT = 'tarih bilinmiyor';

/** Toplu işaretlemeyle (gerçek tarihi bilinmeden) girilmiş tahsilat mı? */
export const tahsilatTarihiTahmini = (p) => String(p.notes ?? '').includes(TOPLU_NOT);

/** Firmanın cari hareketlerinin geçtiği yıllar (yeniden eskiye). */
export function cariYillari(faturalar, tahsilatlar, companyId) {
  const set = new Set();
  const ids = new Set();
  for (const f of faturalar) if (!f.archived_at && f.company_id === companyId) { set.add(String(f.invoice_date).slice(0, 4)); ids.add(f.id); }
  for (const p of tahsilatlar) if (!p.archived_at && ids.has(p.invoice_id)) set.add(String(p.paid_at).slice(0, 4));
  return [...set].sort().reverse();
}

function faturaAciklama(f, kalemler) {
  const ad = [...new Set(kalemler.filter((k) => k.invoice_id === f.id).map((k) => String(k.description ?? '').trim()).filter(Boolean))].join(', ');
  const metin = ad || (f.service_period ? `${ayAdi(f.service_period)} hizmeti` : 'Fatura');
  return `${metin} (${f.invoice_no})`;
}

/**
 * Firmanın ekstresi. baslangic/bitis: 'YYYY-MM-DD' (dahil) ya da boş (sınırsız).
 * Dönem öncesi hareketler "devir" olarak tek satırda özetlenir; bakiye devirden başlar.
 */
export function cariEkstre({ faturalar, tahsilatlar, kalemler = [], companyId, baslangic = '', bitis = '' }) {
  const fat = faturalar.filter((f) => !f.archived_at && f.company_id === companyId);
  const faturaMap = new Map(fat.map((f) => [f.id, f]));
  const hareketler = [];
  for (const f of fat) hareketler.push({ tur: 'fatura', tarih: String(f.invoice_date), alacak: kurus(f.amount_incl_vat), borc: 0, aciklama: faturaAciklama(f, kalemler), kayit: f });
  for (const p of tahsilatlar) {
    if (p.archived_at || !faturaMap.has(p.invoice_id)) continue;
    const f = faturaMap.get(p.invoice_id);
    const parca = ['Ödeme', p.method && p.method !== 'Toplu işaretleme' ? p.method : '', p.notes && !tahsilatTarihiTahmini(p) ? p.notes : ''].filter(Boolean);
    hareketler.push({ tur: 'tahsilat', tarih: String(p.paid_at), borc: kurus(p.amount), alacak: 0, aciklama: `${parca.join(' - ')} (${f.invoice_no})`, kayit: p, tahmini: tahsilatTarihiTahmini(p) });
  }
  // aynı gün: önce fatura, sonra tahsilat
  hareketler.sort((a, b) => a.tarih.localeCompare(b.tarih) || (a.tur === b.tur ? 0 : a.tur === 'fatura' ? -1 : 1) || String(a.aciklama).localeCompare(String(b.aciklama), 'tr'));

  let devirK = 0;
  const donem = [];
  for (const h of hareketler) {
    if (baslangic && h.tarih < baslangic) { devirK += h.alacak - h.borc; continue; }
    if (bitis && h.tarih > bitis) continue;
    donem.push(h);
  }
  let bakiye = devirK; let toplamBorc = 0; let toplamAlacak = 0;
  const satirlar = donem.map((h) => {
    bakiye += h.alacak - h.borc; toplamBorc += h.borc; toplamAlacak += h.alacak;
    return { tur: h.tur, tarih: h.tarih, borc: tl(h.borc), alacak: tl(h.alacak), bakiye: tl(bakiye), aciklama: h.aciklama, kayit: h.kayit, tahmini: !!h.tahmini };
  });
  return {
    devir: tl(devirK), satirlar, toplamBorc: tl(toplamBorc), toplamAlacak: tl(toplamAlacak), bakiye: tl(bakiye),
    durum: bakiye > 0 ? 'alacakli' : bakiye < 0 ? 'borclu' : 'kapali',
    tahminiTarihliAdet: donem.filter((h) => h.tahmini).length,
  };
}

export const CARI_DURUM = { alacakli: 'ALACAKLI', borclu: 'BORÇLU', kapali: 'KAPALI' };
export const trTarih = (iso) => (iso ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}` : '');
export const donemMetni = (baslangic, bitis) => (baslangic || bitis ? `${baslangic ? trTarih(baslangic) : 'başlangıç'} - ${bitis ? trTarih(bitis) : 'bugün'}` : 'Tüm dönem');

/** Ekteki örnek biçimde Excel (.xlsx) üretir. firma: companies satırı; yetkili: metin; logoBayt: PNG baytları (isteğe bağlı). */
export function cariExcel({ firma, yetkili = '', ekstre, baslangic = '', bitis = '', logoBayt = null, logoOran = 640 / 464 }) {
  const e = (v) => ({ st: 'etiket', v });
  const d = (v) => ({ st: 'deger', v: v ?? '' });
  const bos = { st: 'deger', v: '' };
  const satirlar = [
    [e('FİRMA ÜNVANI'), d(firma.name), bos, bos, bos, null],
    [e('VERGİ NO'), d(firma.tax_no), bos, bos, bos],
    [e('VERGİ DAİRESİ'), d(firma.tax_office), bos, bos, bos],
    [e('ADRES'), d([firma.address, [firma.district, firma.city].filter(Boolean).join(' / ')].filter(Boolean).join(' ')), bos, bos, bos],
    [e('TELEFON'), d(firma.phone), bos, bos, bos],
    [e('YETKİLİ'), d(yetkili), bos, bos, bos],
    [e('E-POSTA'), d(firma.email), bos, bos, bos],
    [{ st: 'kalin', v: `Dönem: ${donemMetni(baslangic, bitis)}` }],
    [],
    [{ st: 'baslik', v: 'TARİH' }, { st: 'baslik', v: 'BORÇ' }, { st: 'baslik', v: 'ALACAK' }, { st: 'baslik', v: 'BAKİYE' }, { st: 'baslik', v: 'AÇIKLAMA' }],
  ];
  if (ekstre.devir !== 0) {
    satirlar.push([{ st: 'tarih', v: baslangic || '' }, { st: 'sayi', v: ekstre.devir < 0 ? -ekstre.devir : 0 }, { st: 'kirmizi', v: ekstre.devir > 0 ? ekstre.devir : 0 }, { st: 'sayi', v: ekstre.devir }, { st: 'italik', v: 'Önceki dönemden devir' }]);
  }
  for (const s of ekstre.satirlar) {
    satirlar.push([{ st: 'tarih', v: s.tarih }, { st: 'sayi', v: s.borc }, { st: 'kirmizi', v: s.alacak }, { st: 'sayi', v: s.bakiye }, { st: 'italik', v: s.aciklama }]);
  }
  satirlar.push([]);
  satirlar.push([{ st: 'topEtiket', v: '' }, { st: 'topSayi', v: ekstre.toplamBorc }, { st: 'topKirmizi', v: ekstre.toplamAlacak }, { st: 'topSayi', v: ekstre.bakiye }, { st: 'topEtiket', v: CARI_DURUM[ekstre.durum] }]);
  satirlar.push([], []);
  satirlar.push([{ st: 'buyuk', v: 'BANKA HESAP BİLGİLERİMİZ' }]);
  for (const b of BANKA_BILGISI) satirlar.push([{ st: 'orta', v: b }]);
  const sonBanka = satirlar.length;
  const birlesik = [];
  for (let r = 1; r <= 7; r++) birlesik.push(`B${r}:E${r}`);
  birlesik.push(`A${sonBanka - BANKA_BILGISI.length}:E${sonBanka - BANKA_BILGISI.length}`);
  for (let i = 0; i < BANKA_BILGISI.length; i++) birlesik.push(`A${sonBanka - BANKA_BILGISI.length + 1 + i}:E${sonBanka - BANKA_BILGISI.length + 1 + i}`);
  const sayfa = { ad: 'Cari ekstre', satirlar, genislikler: [14, 15, 15, 15, 62, 3, 34], birlesik };
  if (logoBayt) sayfa.resim = { bayt: logoBayt, kol: 6, satir: 0, solPx: 10, ustPx: 6, genislikPx: Math.round(140 * logoOran), yukseklikPx: 140 };
  return xlsxYaz([sayfa]);
}
