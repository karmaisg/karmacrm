// OSGB 360 - Müşteri teklif bağlantısı: saf yardımcılar (adres, fiyat özeti, yanıt doğrulama). Testler: tests/musteri.test.js
// Müşteriye gösterilen her şey veri tabanı fonksiyonunun (teklif_paylasim_goruntule) döndürdüğü izinli alanlardan hesaplanır;
// maliyet/kâr gibi iç bilgiler bu tarafa hiç gelmez.
import { teklifHesabi } from './ticari.js';
import { kdvAyir, yuvarla2 } from './hesaplama.js';

export const TOKEN_DESENI = /^[0-9a-f]{64}$/;
export const SURE_SECENEKLERI = [7, 14, 30, 60, 90];

/** '#/t/<anahtar>' adresinden anahtarı çıkarır (biçimi bozuksa da döner; geçerlilik ayrıca denetlenir). Müşteri adresi değilse null. */
export function musteriAnahtari(hash) {
  const m = /^#\/t\/([^/?#]*)$/.exec(String(hash ?? ''));
  return m ? m[1] : null;
}

/** Anahtar adres çubuğunun # kısmındadır: sunucuya, günlüklere ve yönlendiren (Referer) başlığına hiç gitmez. */
export const baglantiAdresi = (token, konum) => `${konum.origin}${konum.pathname}#/t/${token}`;

const TL = new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY', minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const tl = (n) => TL.format(Number(n ?? 0));

/** Müşteri sayfasındaki fiyat tablosu. KDV, indirim ve ek kalem toplamları kuruş hassasiyetiyle hesaplanır. */
export function teklifOzeti(p) {
  const fiyatlama = p.fiyatlama === 'ozel' ? (p.birim_fiyat !== null && p.birim_fiyat !== undefined ? 'kisi_basi' : 'sabit_aylik') : p.fiyatlama;
  const calisan = Number(p.calisan_sayisi ?? 0);
  const brut = yuvarla2(fiyatlama === 'kisi_basi' ? Number(p.birim_fiyat ?? 0) * calisan : Number(p.sabit_fiyat ?? 0));
  const h = teklifHesabi({ pricing: p.fiyatlama, unit_price: p.birim_fiyat, fixed_monthly_price: p.sabit_fiyat, employee_count: calisan,
    vat_mode: p.kdv_modu, vat_rate: p.kdv_orani, discount_pct: p.indirim });
  const indirimYuzde = Number(p.indirim ?? 0);
  const kalemler = (p.kalemler ?? []).map((k) => {
    const tutar = yuvarla2(Number(k.miktar) * Number(k.birim_fiyat));
    const v = kdvAyir(tutar, k.kdv_modu, Number(k.kdv_orani));
    return { aciklama: k.aciklama, miktar: Number(k.miktar), birimFiyat: Number(k.birim_fiyat), kdvModu: k.kdv_modu, kdvOrani: Number(k.kdv_orani), haric: v.haric, kdv: v.kdv, dahil: v.dahil };
  });
  const topla = (a) => yuvarla2(kalemler.reduce((t, k) => t + k[a], 0));
  return {
    fiyatlama, calisan, birimFiyat: p.birim_fiyat === null || p.birim_fiyat === undefined ? null : Number(p.birim_fiyat),
    brut, kdvModu: p.kdv_modu, kdvOrani: Number(p.kdv_orani), indirimYuzde, indirimTutari: yuvarla2(brut - brut * (1 - indirimYuzde / 100)),
    aylikHaric: h.aylikGelirKdvHaric, aylikKdv: h.kdvTutari, aylikDahil: h.aylikToplamKdvDahil,
    kalemler, kalemHaric: topla('haric'), kalemKdv: topla('kdv'), kalemDahil: topla('dahil'),
  };
}

/** Müşterinin yanıt formu doğrulaması (veri tabanı aynı kuralları ayrıca uygular). */
export function yanitDogrula({ ad, not }) {
  const temiz = String(ad ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (temiz.length < 2) return { hata: { ad: 'Lütfen adınızı ve soyadınızı yazın.' } };
  if (temiz.length > 80) return { hata: { ad: 'Ad soyad en çok 80 karakter olabilir.' } };
  const n = String(not ?? '').trim();
  if (n.length > 500) return { hata: { not: 'Notunuz en çok 500 karakter olabilir.' } };
  return { ad: temiz, not: n || null };
}

/** Teklif sahibi tarafında bağlantının durumu. */
export function baglantiDurumu(s, simdi = new Date()) {
  if (!s) return { ad: 'yok', metin: 'Bağlantı yok' };
  if (s.revoked_at) return { ad: 'iptal', metin: 'İptal edildi' };
  if (new Date(s.expires_at).getTime() <= simdi.getTime()) return { ad: 'doldu', metin: 'Süresi doldu' };
  return { ad: 'aktif', metin: 'Aktif' };
}
