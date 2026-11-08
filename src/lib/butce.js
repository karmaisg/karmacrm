// OSGB 360 - Yıllık bütçe hesapları (saf fonksiyonlar). Tutarlar KDV HARİÇ.
import { faturaAyi } from './karlilik.js';
import { anaFirmaHaritasi } from './veri.js';

export const DURUMLAR = {
  kabul: 'Kabul edildi',
  gorusme_bilgi_yok: 'Görüşme yapıldı – bilgi verilemedi',
  bilgi_verildi: 'Bilgi verildi – dönüş bekleniyor',
  sona_erdi: 'Sözleşme sona erdi',
};
/** Firma ünvanı rengi: kabul → yeşil, sona erdi → kırmızı, diğer görüşme durumları → turuncu. */
export const DURUM_RENGI = { kabul: 'yesil', sona_erdi: 'kirmizi', gorusme_bilgi_yok: 'turuncu', bilgi_verildi: 'turuncu' };
export const FIYAT_TURU = { sabit: 'Sabit fiyat', kisi_basi: 'Kişi başı fiyat' };

const k2 = (x) => Math.round(Number(x) * 100) / 100;
export const sayiMi = (x) => x !== null && x !== undefined && x !== '' && Number.isFinite(Number(x));

/** "1.250,50" veya "1250.5" gibi girişi sayıya çevirir; boş/geçersiz → null. */
export function sayiOku(metin, eksiVar = false) {
  let s = String(metin ?? '').trim().replace(/[₺\s]/g, '');
  if (!s) return null;
  if (s.includes(',') || /^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');   // 1.250,50 ve 2.000 → Türkçe biçim
  const n = Number(s);
  return Number.isFinite(n) && (eksiVar || n >= 0) ? n : null;
}

export const yuzdeFiyata = (birim, yuzde) => (sayiMi(birim) && sayiMi(yuzde) ? k2(Number(birim) * (1 + Number(yuzde) / 100)) : null);
export const fiyatYuzdeye = (birim, fiyat) => (sayiMi(birim) && Number(birim) > 0 && sayiMi(fiyat) ? k2((Number(fiyat) / Number(birim) - 1) * 100) : null);

/**
 * Önceki yılın kesilmiş aylık faturalarından firma başına ortalama aylık gelir.
 * Yalnızca "fatura" türü gelirler (spot ve elden gelirler dışarıda); bağlı firmalar ana firmaya eklenir.
 * Ortalama = toplam (KDV hariç) / fatura kesilen ay sayısı.
 */
export function otomatikOrtalamalar(faturalar, firmalar, yil) {
  const ana = anaFirmaHaritasi(firmalar);
  const toplam = new Map();
  for (const f of faturalar ?? []) {
    if (f.archived_at || (f.income_kind ?? 'fatura') !== 'fatura') continue;
    const ay = faturaAyi(f); if (!ay || ay.slice(0, 4) !== String(yil)) continue;
    const id = ana.get(f.company_id) ?? f.company_id;
    const e = toplam.get(id) ?? { kurus: 0, aylar: new Set() };
    e.kurus += Math.round(Number(f.amount_excl_vat) * 100); e.aylar.add(ay); toplam.set(id, e);
  }
  return new Map([...toplam].map(([id, e]) => [id, { toplam: e.kurus / 100, ay: e.aylar.size, ortalama: e.aylar.size ? k2(e.kurus / 100 / e.aylar.size) : null }]));
}

/** Tek satırın hesaplanan alanları. satir = budget_lines kaydı (veya boş {}), oto = otomatik ortalama (sayı/null). */
export function satirHesapla(satir = {}, oto = null) {
  const tur = satir.price_type ?? 'sabit';
  const adet = tur === 'kisi_basi' ? (sayiMi(satir.employee_count) ? Number(satir.employee_count) : 0) : 1;
  const birim = sayiMi(satir.unit_price) ? Number(satir.unit_price) : null;
  const oncekiAylik = birim === null ? null : k2(birim * adet);
  const elle = sayiMi(satir.prev_avg_income);
  const ortalama = elle ? Number(satir.prev_avg_income) : (sayiMi(oto) ? Number(oto) : null);
  const kabul = sayiMi(satir.accepted_price) ? Number(satir.accepted_price) : null;
  const artisOrani = kabul !== null && birim !== null && birim > 0 ? kabul / birim - 1 : null;       // kesir
  const artisTutari = kabul !== null && birim !== null ? k2((kabul - birim) * adet) : null;           // aylık fark
  let beklenen = null;
  if (satir.status === 'sona_erdi') beklenen = 0;
  else if (ortalama !== null && artisOrani !== null) beklenen = k2(ortalama * (1 + artisOrani));
  return { tur, adet, birim, oncekiAylik, ortalama, elle, kabul, artisOrani, artisTutari, beklenen };
}

/** Tablo altı toplamları. satirlar: satirHesapla çıktıları. */
export function toplamlar(hesaplar) {
  let oncekiFiyat = 0; let ortalama = 0; let beklenen = 0; let kOnceki = 0; let kBeklenen = 0; let belli = 0; let belirsiz = 0;
  for (const h of hesaplar) {
    if (h.oncekiAylik !== null) oncekiFiyat += Math.round(h.oncekiAylik * 100);
    if (h.ortalama !== null) ortalama += Math.round(h.ortalama * 100);
    if (h.beklenen !== null) beklenen += Math.round(h.beklenen * 100);
    if (h.beklenen !== null && h.ortalama !== null) { kOnceki += Math.round(h.ortalama * 100); kBeklenen += Math.round(h.beklenen * 100); belli += 1; } else belirsiz += 1;
  }
  return {
    oncekiFiyat: oncekiFiyat / 100, ortalama: ortalama / 100, beklenen: beklenen / 100,
    artisOrani: kOnceki > 0 ? kBeklenen / kOnceki - 1 : null,   // yalnızca beklenen geliri hesaplanabilen firmalar üzerinden
    karsilastirilan: belli, belirsiz,
  };
}
