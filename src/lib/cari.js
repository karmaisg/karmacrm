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

/**
 * Firma bazında tahsilatı açık faturalara dağıtır: fatura tarihi eskiden yeniye (sonra fatura no).
 * Dönüş: { dagitim: [{ fatura, tutar, kismi, kalanSonra }], artan (açık bakiyeyi aşan tutar), acik (toplam açık bakiye) }
 * Sunucudaki firma_tahsilati_gir fonksiyonuyla aynı sırayı kullanır (önizleme için).
 */
export function tahsilatDagitimi({ faturalar, tahsilatlar, companyId, tutar }) {
  const odenen = new Map();
  for (const p of tahsilatlar) if (!p.archived_at) odenen.set(p.invoice_id, (odenen.get(p.invoice_id) ?? 0) + kurus(p.amount));
  const acikFaturalar = faturalar.filter((f) => !f.archived_at && f.company_id === companyId)
    .map((f) => ({ f, acik: kurus(f.amount_incl_vat) - (odenen.get(f.id) ?? 0) })).filter((x) => x.acik > 0)
    .sort((a, b) => String(a.f.invoice_date).localeCompare(String(b.f.invoice_date)) || String(a.f.invoice_no).localeCompare(String(b.f.invoice_no), 'tr') || String(a.f.id).localeCompare(String(b.f.id)));
  let kalan = kurus(tutar); const dagitim = [];
  for (const { f, acik } of acikFaturalar) {
    if (kalan <= 0) break;
    const pay = Math.min(acik, kalan);
    dagitim.push({ fatura: f, tutar: tl(pay), kismi: pay < acik, kalanSonra: tl(acik - pay) });
    kalan -= pay;
  }
  return { dagitim, artan: tl(Math.max(kalan, 0)), acik: tl(acikFaturalar.reduce((t, x) => t + x.acik, 0)) };
}

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
  // Tahsilatlar: aynı grup (firma tahsilatı) ve aynı tarihte olanlar tek ödeme satırında toplanır.
  const aktifTah = tahsilatlar.filter((p) => !p.archived_at && faturaMap.has(p.invoice_id));
  // Fatura bazında birikimli ödeme: bir tahsilat sonrası fatura hâlâ kalanlı ise "kısmi"
  const kumulatif = new Map();
  const faturaBazli = new Map();
  for (const p of aktifTah) { if (!faturaBazli.has(p.invoice_id)) faturaBazli.set(p.invoice_id, []); faturaBazli.get(p.invoice_id).push(p); }
  for (const liste of faturaBazli.values()) {
    liste.sort((a, b) => String(a.paid_at).localeCompare(String(b.paid_at)) || String(a.created_at ?? '').localeCompare(String(b.created_at ?? '')) || String(a.id).localeCompare(String(b.id)));
    let t = 0; for (const p of liste) { t += kurus(p.amount); kumulatif.set(p.id, t); }
  }
  const gruplar = new Map();
  for (const p of aktifTah) {
    const anahtar = p.group_id ? `g:${p.group_id}:${p.paid_at}` : `t:${p.id}`;
    if (!gruplar.has(anahtar)) gruplar.set(anahtar, []);
    gruplar.get(anahtar).push(p);
  }
  for (const liste of gruplar.values()) {
    liste.sort((a, b) => String(faturaMap.get(a.invoice_id).invoice_date).localeCompare(String(faturaMap.get(b.invoice_id).invoice_date)) || String(faturaMap.get(a.invoice_id).invoice_no).localeCompare(String(faturaMap.get(b.invoice_id).invoice_no), 'tr'));
    const tahmini = liste.some(tahsilatTarihiTahmini);
    const yontem = liste.find((p) => p.method && p.method !== 'Toplu işaretleme')?.method ?? '';
    const not = liste.find((p) => p.notes && !tahsilatTarihiTahmini(p))?.notes ?? '';
    const kalemler = liste.map((p) => { const f = faturaMap.get(p.invoice_id); const kismi = (kumulatif.get(p.id) ?? 0) < kurus(f.amount_incl_vat); return `${f.invoice_no} nolu fatura${kismi ? ' (kısmi)' : ''}`; });
    const bas = ['Ödeme', yontem, not].filter(Boolean).join(' - ');
    hareketler.push({ tur: 'tahsilat', tarih: String(liste[0].paid_at), borc: liste.reduce((t, p) => t + kurus(p.amount), 0), alacak: 0, aciklama: `${bas} - ${kalemler.join(', ')}`,
      kayit: liste[0], kayitlar: liste, grup: liste[0].group_id ?? null, tahmini });
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
    return { tur: h.tur, tarih: h.tarih, borc: tl(h.borc), alacak: tl(h.alacak), bakiye: tl(bakiye), aciklama: h.aciklama, kayit: h.kayit, kayitlar: h.kayitlar ?? [h.kayit], grup: h.grup ?? null, tahmini: !!h.tahmini };
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
    [{ st: 'buyuk', v: 'CARİ HESAP TABLOSU' }],
    [],
    [e('FİRMA ÜNVANI'), d(firma.name), bos, bos],
    [e('VERGİ NO'), d(firma.tax_no), bos, bos],
    [e('VERGİ DAİRESİ'), d(firma.tax_office), bos, bos],
    [e('ADRES'), d([firma.address, [firma.district, firma.city].filter(Boolean).join(' / ')].filter(Boolean).join(' ')), bos, bos],
    [e('TELEFON'), d(firma.phone), bos, bos],
    [e('YETKİLİ'), d(yetkili), bos, bos],
    [e('E-POSTA'), d(firma.email), bos, bos],
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
  const bankaBas = sonBanka - BANKA_BILGISI.length; // başlık satırı (1 tabanlı)
  const birlesik = ['A1:E1'];
  for (let r = 3; r <= 9; r++) birlesik.push(`B${r}:D${r}`); // firma bilgileri değerleri
  for (let r = bankaBas; r <= sonBanka; r++) birlesik.push(`A${r}:E${r}`);
  // sütunlar: A tarih, B-D tutarlar, E açıklama (geniş). Logo: E sütununun içinde, firma bilgileri kutusunun sağında (sayfa dışına taşmaz).
  const sayfa = { ad: 'Cari ekstre', satirlar, genislikler: [14, 18, 18, 18, 70], birlesik, satirYuksekligi: { 0: 26 } };
  if (logoBayt) sayfa.resim = { bayt: logoBayt, kol: 4, satir: 2, solPx: 150, ustPx: 2, genislikPx: Math.round(130 * logoOran), yukseklikPx: 130 };
  return xlsxYaz([sayfa]);
}
