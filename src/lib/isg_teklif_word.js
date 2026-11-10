// OSGB 360 - İSG hizmeti teklifini Word (.docx) olarak üretir: firmanın örnek teklif şablonundaki işaretli alanlar doldurulur.
// Şablon: src/assets/teklif_sablonu.docx (tools/sablon_hazirla.py ile örnek belgeden üretilir). Her şey tarayıcıda yapılır.
import { zipDizini } from './xlsx.js';
import { crc32 } from './xlsxyaz.js';

/** Tehlike sınıfına göre çalışan başına aylık en az süre (dakika) — 6331 sayılı Kanun / İSG Hizmetleri Yönetmeliği. */
export const SURE_DAKIKA = {
  az_tehlikeli: { uzman: 10, hekim: 5, ad: 'Az tehlikeli' },
  tehlikeli: { uzman: 20, hekim: 15, ad: 'Tehlikeli' },
  cok_tehlikeli: { uzman: 40, hekim: 20, ad: 'Çok tehlikeli' },
};

const BUYUK = (s) => String(s ?? '').trim().toLocaleUpperCase('tr-TR');
const KUCUK = (s) => String(s ?? '').trim().toLocaleLowerCase('tr-TR');

/** "Gaziemir" → "Gaziemir’de", "Bayraklı" → "Bayraklı’da", "Çiğli" → "Çiğli’de" (bulunma eki). */
export function bulunmaEki(ad) {
  const s = String(ad ?? '').trim(); if (!s) return '';
  const k = KUCUK(s); const sesliler = [...k].filter((c) => 'aeıioöuü'.includes(c));
  const kalin = ['a', 'ı', 'o', 'u'].includes(sesliler[sesliler.length - 1]);
  const sert = 'çfhkpsşt'.includes(k[k.length - 1]);
  return `${s}’${sert ? 't' : 'd'}${kalin ? 'a' : 'e'}`;
}

/** 7000 → "7000"; 7000.5 → "7000,50". Şablondaki örnekteki gibi binlik ayracı yok. */
export function rakam(n) {
  const x = Number(n); if (!Number.isFinite(x)) return '';
  return Number.isInteger(x) ? String(x) : x.toFixed(2).replace('.', ',');
}
const tarihYaz = (iso) => { const [y, m, d] = String(iso).slice(0, 10).split('-'); return `${d}.${m}.${y}`; };

/**
 * Teklif ve firma/aday bilgisinden şablon alanlarını üretir (düz metin; XML kaçışı yazarken yapılır).
 * @param o teklif satırı; @param kisi {ad, yetkili, sehir, ilce} firma veya adaydan.
 */
export function teklifAlanlari(o, kisi) {
  const sure = SURE_DAKIKA[o.hazard_class]; if (!sure) throw new Error('Tehlike sınıfı seçilmemiş.');
  const kisiBasi = o.pricing === 'kisi_basi';
  const fiyat = kisiBasi ? o.unit_price : o.fixed_monthly_price;
  if (fiyat === null || fiyat === undefined || fiyat === '') throw new Error('Teklifte fiyat girilmemiş.');
  const firma = BUYUK(kisi.ad);
  const yer = [kisi.sehir, kisi.ilce].map((x) => String(x ?? '').trim()).filter(Boolean);
  const yerMetni = yer.length ? `${yer.slice(0, -1).join(' ')}${yer.length > 1 ? ' ' : ''}${bulunmaEki(yer[yer.length - 1])} ` : '';
  const dahil = o.vat_mode === 'kdv_dahil';
  const ucret = `${kisiBasi ? 'kişi başı aylık' : 'aylık'} ${rakam(fiyat)} TL ${dahil ? '(KDV dahil)' : '+ KDV'}`;
  const sozlesme = o.contract_end_date
    ? `Sözleşme ${tarihYaz(o.contract_end_date)} tarihine kadar yapılacak olup, yeni sözleşme dönemi fiyatları yıllık enflasyon ve asgari ücret artış tutarları göz önüne alınarak karşılıklı olarak belirlenecektir.` : null;
  return {
    SAYIN: `Sayın ${String(kisi.yetkili ?? '').trim() || 'Yetkili'}`,
    FIRMA: firma,
    A_DEVAMI: `’nin ${yerMetni}faaliyet gösteren toplam ${Number(o.employee_count)} personelin bulunduğu ${KUCUK(sure.ad)} sınıfta yer alan işyeri için iş sağlığı ve güvenliği hizmetlerinin yürütülmesi hakkında açıklama ve teklif raporudur.`,
    UZMAN_SURESI: `(${sure.ad} sınıftaki işyeri için çalışan başına ayda en az ${sure.uzman} dakika)`,
    HEKIM_SURESI: `(${sure.ad} sınıftaki işyeri için çalışan başına ayda en az ${sure.hekim} dakika)`,
    UCRET: ucret,
    SOZLESME_SATIRI: sozlesme,
  };
}

const xmlKac = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** document.xml içindeki işaretleri doldurur; sözleşme tarihi yoksa ilgili satır ve boşluğu kaldırır. */
export function belgeXmlDoldur(xml, alanlar) {
  let x = xml;
  if (alanlar.SOZLESME_SATIRI === null || alanlar.SOZLESME_SATIRI === undefined) {
    const p = '<w:p(?: [^>]*)?>(?:(?!<w:p[ >])[\\s\\S])*?';
    x = x.replace(new RegExp(`${p}\\{\\{SOZLESME_SATIRI\\}\\}(?:(?!<w:p[ >])[\\s\\S])*?</w:p>`), '')
      .replace(new RegExp(`${p}\\{\\{SOZLESME_BOSLUK\\}\\}(?:(?!<w:p[ >])[\\s\\S])*?</w:p>`), '');
  }
  x = x.replace(/\{\{SOZLESME_BOSLUK\}\}/g, '');
  x = x.replace(/\{\{([A-Z_]+)\}\}/g, (m, k) => (k in alanlar && alanlar[k] !== null ? xmlKac(alanlar[k]) : m));
  if (/\{\{[A-Z_]+\}\}/.test(x)) throw new Error('Şablonda doldurulmamış alan kaldı.');
  return x;
}

const kodla = new TextEncoder();
/** Sıkıştırmasız (stored) zip yazar. dosyalar: [[ad, Uint8Array]] */
export function zipYaz(dosyalar) {
  const parcalar = []; const dizin = []; let konum = 0;
  const yaz = (b) => { parcalar.push(b); konum += b.length; };
  for (const [ad, veri] of dosyalar) {
    const a = kodla.encode(ad); const crc = crc32(veri);
    const y = new Uint8Array(30); const v = new DataView(y.buffer);
    v.setUint32(0, 0x04034b50, true); v.setUint16(4, 20, true); v.setUint16(6, 0x0800, true);
    v.setUint32(14, crc, true); v.setUint32(18, veri.length, true); v.setUint32(22, veri.length, true); v.setUint16(26, a.length, true);
    dizin.push({ a, crc, boy: veri.length, konum }); yaz(y); yaz(a); yaz(veri);
  }
  const bas = konum;
  for (const { a, crc, boy, konum: k } of dizin) {
    const m = new Uint8Array(46); const v = new DataView(m.buffer);
    v.setUint32(0, 0x02014b50, true); v.setUint16(4, 20, true); v.setUint16(6, 20, true); v.setUint16(8, 0x0800, true);
    v.setUint32(16, crc, true); v.setUint32(20, boy, true); v.setUint32(24, boy, true); v.setUint16(28, a.length, true); v.setUint32(42, k, true);
    yaz(m); yaz(a);
  }
  const son = new Uint8Array(22); const sv = new DataView(son.buffer);
  sv.setUint32(0, 0x06054b50, true); sv.setUint16(8, dizin.length, true); sv.setUint16(10, dizin.length, true);
  sv.setUint32(12, konum - bas, true); sv.setUint32(16, bas, true); yaz(son);
  const c = new Uint8Array(konum); let o = 0; for (const p of parcalar) { c.set(p, o); o += p.length; }
  return c;
}

/** Şablon baytlarından, alanlar doldurulmuş .docx baytlarını üretir. */
export async function docxUret(sablonBayt, alanlar) {
  const dizin = zipDizini(sablonBayt); const dosyalar = [];
  for (const [ad, oku] of dizin) {
    if (ad.endsWith('/')) continue;
    let veri = await oku();
    if (ad === 'word/document.xml') veri = kodla.encode(belgeXmlDoldur(new TextDecoder('utf-8').decode(veri), alanlar));
    dosyalar.push([ad, veri]);
  }
  dosyalar.sort((a, b) => (a[0] === '[Content_Types].xml' ? -1 : b[0] === '[Content_Types].xml' ? 1 : 0));
  return zipYaz(dosyalar);
}

export const DOCX_TURU = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const ASCII = { ç: 'c', ğ: 'g', ı: 'i', ö: 'o', ş: 's', ü: 'u' };
/** Güvenli dosya adı (ASCII): "Egepoli Çelik A.Ş." → "egepoli-celik-a-s-is-sagligi-teklifi.docx". */
export const dosyaAdi = (firma) => `${KUCUK(firma ?? '').replace(/[çğıöşü]/g, (c) => ASCII[c]).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'teklif'}-is-sagligi-teklifi.docx`;
