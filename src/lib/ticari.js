// OSGB 360 - Teklif ve sözleşme yardımcıları (etiketler, durum geçişleri, fiyat özeti). Saf fonksiyonlar.
import { teklifKarliligi, kdvAyir, yuvarla2 } from './hesaplama.js';
import { gunFarki } from './format.js';

export const FIYATLAMA = { kisi_basi: 'Kişi başı (aylık)', sabit_aylik: 'Sabit aylık', ozel: 'Özel' };
export const KDV_MODU = { kdv_haric: 'KDV hariç', kdv_dahil: 'KDV dahil' };

export const TEKLIF_DURUMLARI = {
  taslak: 'Taslak', onay_bekliyor: 'Onay bekliyor', gonderildi: 'Gönderildi', gorusuluyor: 'Görüşülüyor',
  kabul_edildi: 'Kabul edildi', reddedildi: 'Reddedildi', suresi_doldu: 'Süresi doldu',
};
export const TEKLIF_TON = { taslak: 'neutral', onay_bekliyor: 'warning', gonderildi: 'info', gorusuluyor: 'info', kabul_edildi: 'success', reddedildi: 'danger', suresi_doldu: 'neutral' };
/** Veri tabanındaki geçiş kurallarının aynası (asıl denetim veri tabanındadır). */
export const TEKLIF_GECISLERI = {
  taslak: ['onay_bekliyor', 'gonderildi'],
  onay_bekliyor: ['taslak', 'gonderildi'],
  gonderildi: ['gorusuluyor', 'reddedildi', 'suresi_doldu'],
  gorusuluyor: ['gonderildi', 'reddedildi', 'suresi_doldu'],
  suresi_doldu: ['gonderildi', 'reddedildi'],
  kabul_edildi: [], reddedildi: [],
};
export const teklifKilitli = (durum) => !['taslak', 'onay_bekliyor'].includes(durum);
export const kabulEdilebilir = (durum) => ['gonderildi', 'gorusuluyor'].includes(durum);

export const SOZLESME_DURUMLARI = { taslak: 'Taslak', aktif: 'Aktif', yenilendi: 'Yenilendi', sona_erdi: 'Sona erdi', feshedildi: 'Feshedildi' };
export const SOZLESME_TON = { taslak: 'neutral', aktif: 'success', yenilendi: 'info', sona_erdi: 'neutral', feshedildi: 'danger' };

/** Teklif satırından aylık hesap (KDV hariç gelir, katkı kârı, marj). */
export function teklifHesabi(o, marjEsigiYuzde = 20) {
  const fiyatlama = o.pricing === 'ozel' ? (o.unit_price !== null && o.unit_price !== undefined ? 'kisi_basi' : 'sabit_aylik') : o.pricing;
  return teklifKarliligi({
    fiyatlama, birimFiyat: Number(o.unit_price ?? 0), sabitFiyat: Number(o.fixed_monthly_price ?? 0), calisanSayisi: Number(o.employee_count ?? 0),
    kdvModu: o.vat_mode, kdvOrani: Number(o.vat_rate ?? 20), indirimYuzde: Number(o.discount_pct ?? 0),
    uzmanMaliyeti: Number(o.est_expert_cost ?? 0), hekimMaliyeti: Number(o.est_physician_cost ?? 0), ulasimDigerMaliyet: Number(o.est_travel_other_cost ?? 0),
    marjEsigiYuzde,
  });
}

/** Sözleşme fiyat satırından, verilen çalışan sayısıyla aylık KDV hariç tutar. */
export function fiyatAylikHaric(p, calisan = 0) {
  const brut = p.pricing === 'kisi_basi' ? Number(p.unit_price ?? 0) * Number(calisan) : Number(p.fixed_monthly_price ?? p.unit_price ?? 0);
  return kdvAyir(yuvarla2(brut), p.vat_mode, Number(p.vat_rate)).haric;
}

/** Bugünde geçerli fiyat dönemi (yoksa null). */
export function guncelFiyat(fiyatlar, bugun) {
  return fiyatlar.find((p) => p.valid_from <= bugun && (!p.valid_to || p.valid_to >= bugun)) ?? null;
}

/** Sözleşme bitişine kalan gün ve uyarı eşiği (90/60/30). Aktif olmayan için null. */
export function bitisDurumu(c, bugun) {
  if (c.status !== 'aktif') return null;
  const gun = gunFarki(bugun, c.end_date);
  if (gun < 0) return { gun, seviye: 'gecmis', esik: null };
  const esik = gun <= 30 ? 30 : gun <= 60 ? 60 : gun <= 90 ? 90 : null;
  return { gun, seviye: esik === 30 ? 'kritik' : esik ? 'yaklasiyor' : 'normal', esik };
}
