// OSGB 360 - Aylık gider Excel'i (satır = gider kalemi, sütun = ay): ayrıştırma, kategori eşleştirme, yerine geçme önizlemesi.
// Saf fonksiyonlar. Personel maliyeti (maaş/SGK) bu dosyadan alınmaz; "Yönetime ödenen" yönetim personeli maliyetidir.
import { trKucukAscii, adBenzerligi } from './katip.js';
import { sayiOku, tarihOku } from './gelir.js';

const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
export const anahtarOf = (s) => trKucukAscii(s).replace(/[^a-z0-9]+/g, ' ').trim();
const AY_ADI = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
export const ayEtiketi = (a) => `${AY_ADI[Number(a.slice(5, 7)) - 1]} ${a.slice(0, 4)}`;

/** Dosyada kalem adı olarak tanınan, gider sayılmayan satırlar. */
const TOPLAM = /(^| )(toplam|genel toplam|total)( |$)/;
export const SABLON_KALEMLERI = ['Şirket Açılış Giderleri', 'Yönetime Ödenen', 'Vergi', '3th Party Ödeme', 'Kira ve Aidat', 'Araç Masrafları', 'Elektrik', 'Su', 'Doğal Gaz',
  'Cep telefonu', 'İnternet / Telefon', 'Kırtasiye Giderleri', 'Ofis Genel Giderler', 'Ofis Mobilya', 'Elektronik', 'Reklam, Pzarlama, Web', 'Avukatlık Giderleri',
  'Muhasebe Giderleri', 'Yeme ve İçme', 'KKD Giderleri', 'Diğer Giderler'];

/** Tablo -> { aylar:['2026-01-01',...], satirlar:[{etiket, anahtar, tutarlar:{ay:n}, toplam, dolu, negatif}], uyarilar, hatalar } */
export function giderTablosu(tablo) {
  const bi = tablo.findIndex((s) => (s ?? []).filter((h) => tarihOku(h)).length >= 2);
  if (bi < 0) return { aylar: [], satirlar: [], uyarilar: [], hatalar: ['Ay başlıkları bulunamadı. İlk satırda 01.01.2026, 01.02.2026 gibi ay (tarih) sütunları olmalıdır.'] };
  const baslik = tablo[bi]; const sutunlar = [];
  baslik.forEach((h, i) => { const t = tarihOku(h); if (t) sutunlar.push({ i, ay: `${t.slice(0, 7)}-01` }); });
  const aylar = []; const gorulen = new Set(); const uyarilar = []; const hatalar = [];
  for (const s of sutunlar) { if (gorulen.has(s.ay)) hatalar.push(`${ayEtiketi(s.ay)} birden çok sütunda var.`); gorulen.add(s.ay); aylar.push(s.ay); }
  const etiketSutunu = Math.max(0, Math.min(...sutunlar.map((s) => s.i)) - 1);
  const satirlar = []; const anahtarlar = new Set();
  for (let r = bi + 1; r < tablo.length; r++) {
    const s = tablo[r] ?? []; const etiket = String(s[etiketSutunu] ?? '').replace(/\s+/g, ' ').trim();
    if (!etiket) continue;
    const anahtar = anahtarOf(etiket);
    if (TOPLAM.test(anahtar)) { uyarilar.push(`"${etiket}" satırı toplam satırı olduğu için atlandı.`); continue; }
    if (anahtarlar.has(anahtar)) { hatalar.push(`"${etiket}" kalemi dosyada birden çok satırda var; satırları birleştirin.`); continue; }
    anahtarlar.add(anahtar);
    const tutarlar = {}; let negatif = 0; let toplam = 0; let dolu = 0;
    for (const c of sutunlar) {
      const h = s[c.i]; const n = sayiOku(h);
      if (h !== null && h !== undefined && String(h).trim() !== '' && n === null) hatalar.push(`${etiket} / ${ayEtiketi(c.ay)}: "${h}" sayı değil.`);
      if (n === null || n === 0) continue;
      if (n < 0) { negatif += 1; uyarilar.push(`${etiket} / ${ayEtiketi(c.ay)}: negatif tutar (${n}) aktarılmaz.`); continue; }
      tutarlar[c.ay] = r2(n); toplam += n; dolu += 1;
    }
    satirlar.push({ etiket, anahtar, tutarlar, toplam: r2(toplam), dolu, negatif });
  }
  if (!satirlar.length) hatalar.push('Gider kalemi satırı bulunamadı.');
  return { aylar, satirlar, uyarilar, hatalar };
}

/**
 * Her satır için öneri. Daha önce onaylanan eşleşme (harita) önceliklidir.
 * karar: { islem: 'kategori'|'yonetim'|'atla', kategori_id: uuid|null, yeni: {ad, tur}|null }
 */
export function varsayilanKararlar(satirlar, { kategoriler = [], harita = [] } = {}) {
  const hMap = new Map(harita.map((h) => [h.row_key, h]));
  const uygun = kategoriler.filter((k) => !k.is_payroll && !k.is_management_pay);
  const kararlar = {};
  for (const s of satirlar) {
    const h = hMap.get(s.anahtar);
    if (h?.action === 'yonetim') { kararlar[s.anahtar] = { islem: 'yonetim', kategori_id: null, yeni: null }; continue; }
    if (h?.action === 'atla') { kararlar[s.anahtar] = { islem: 'atla', kategori_id: null, yeni: null }; continue; }
    if (h?.action === 'kategori' && uygun.some((k) => k.id === h.category_id)) { kararlar[s.anahtar] = { islem: 'kategori', kategori_id: h.category_id, yeni: null }; continue; }
    if (/yonetime odenen/.test(s.anahtar) || /^yonetim odeme/.test(s.anahtar)) { kararlar[s.anahtar] = { islem: 'yonetim', kategori_id: null, yeni: null }; continue; }
    if (/^personel( giderleri| gideri| maliyet)/.test(s.anahtar)) { kararlar[s.anahtar] = { islem: 'atla', kategori_id: null, yeni: null }; continue; }
    const tam = uygun.find((k) => anahtarOf(k.name) === s.anahtar);
    if (tam) { kararlar[s.anahtar] = { islem: 'kategori', kategori_id: tam.id, yeni: null }; continue; }
    const en = uygun.map((k) => ({ k, skor: adBenzerligi(s.etiket, k.name) })).filter((x) => x.skor >= 0.85).sort((a, b) => b.skor - a.skor)[0];
    if (en) { kararlar[s.anahtar] = { islem: 'kategori', kategori_id: en.k.id, yeni: null }; continue; }
    kararlar[s.anahtar] = { islem: 'kategori', kategori_id: null, yeni: { ad: s.etiket, tur: s.anahtar === 'vergi' ? 'vergi' : 'isletme' } };
  }
  return kararlar;
}

/** Satır karara göre eksiksiz mi? (kategori seçilmiş veya yeni kategori adı dolu) */
export function kararTamam(k) {
  if (!k) return false;
  if (k.islem === 'yonetim' || k.islem === 'atla') return true;
  return !!k.kategori_id || !!String(k.yeni?.ad ?? '').trim();
}
export const bekleyenSatirlar = (satirlar, kararlar) => satirlar.filter((s) => s.dolu > 0 && !kararTamam(kararlar[s.anahtar]));

/** Sunucuya giden paket. Boş (tüm ayları 0) satırlar gönderilmez; "atla" satırlar eşleşmeyi hatırlatmak için gönderilir. */
export function giderPaketi({ dosya, aylar, satirlar, kararlar, kdvModu = 'kdv_haric', kdvOrani = 20 }) {
  const gidecek = [];
  for (const s of satirlar) {
    const k = kararlar[s.anahtar]; if (!k) continue;
    if (k.islem === 'atla') { gidecek.push({ anahtar: s.anahtar, etiket: s.etiket, islem: 'atla', tutarlar: {} }); continue; }
    if (!s.dolu) continue;
    const p = { anahtar: s.anahtar, etiket: s.etiket, islem: k.islem, tutarlar: s.tutarlar };
    if (k.islem === 'kategori') { if (k.kategori_id) p.kategori_id = k.kategori_id; else p.yeni_kategori = { ad: String(k.yeni.ad).trim(), tur: k.yeni.tur === 'vergi' ? 'vergi' : 'isletme' }; }
    gidecek.push(p);
  }
  return { dosya: dosya ?? null, aylar, kdv_modu: kdvModu, kdv_orani: kdvOrani, satirlar: gidecek };
}

/** Önizleme: ay bazında eklenecek tutar (atlananlar hariç), yönetime ödenen ayrı. */
export function eklenecekOzet({ aylar, satirlar, kararlar }) {
  const ay = Object.fromEntries(aylar.map((a) => [a, { gider: 0, yonetim: 0, adet: 0 }]));
  let atlanan = 0;
  for (const s of satirlar) {
    const k = kararlar[s.anahtar]; if (!k) continue;
    if (k.islem === 'atla') { atlanan += s.toplam; continue; }
    for (const [a, n] of Object.entries(s.tutarlar)) { ay[a][k.islem === 'yonetim' ? 'yonetim' : 'gider'] += n; ay[a].adet += 1; }
  }
  for (const a of aylar) { ay[a].gider = r2(ay[a].gider); ay[a].yonetim = r2(ay[a].yonetim); }
  return { ay, atlanan: r2(atlanan) };
}

/** Yerine geçme: dosyadaki aylar için sistemde zaten bulunan Excel kaynaklı (arşivde olmayan) gider kayıtları. */
export function yerineGecenler({ aylar, giderler }) {
  const set = new Set(aylar); const ay = {};
  for (const g of giderler) {
    if (!g.import_id || g.archived_at) continue;
    const a = `${String(g.expense_date).slice(0, 7)}-01`; if (!set.has(a)) continue;
    const x = (ay[a] ??= { adet: 0, tutar: 0 }); x.adet += 1; x.tutar = r2(x.tutar + Number(g.amount_excl_vat));
  }
  const adet = Object.values(ay).reduce((t, x) => t + x.adet, 0); const tutar = r2(Object.values(ay).reduce((t, x) => t + x.tutar, 0));
  return { ay, adet, tutar };
}
