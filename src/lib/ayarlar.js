// OSGB 360 - Sistem ayarları: tanımlar, değer doğrulama, tarihçe (saf fonksiyonlar). Testler: tests/ayarlar.test.js
// Veri tabanı kuralları (09_asama9.sql) aynı sınırları uygular; buradaki kontroller yalnızca anlaşılır mesaj içindir.
import { PERSONEL_TURLERI, TEHLIKE_SINIFLARI } from './hesaplama.js';

export const AYAR_TANIMLARI = [
  { anahtar: 'kapasite_dakika', etiket: 'Aylık kapasite', birim: 'dk', min: 60, max: 44640, tamSayi: true, varsayilan: 11700,
    aciklama: 'Bir uzman veya hekimin ayda ayırabileceği toplam dakika (11.700 dk = 195 saat). Kapasite analizi ve kârlılıkta kullanılır.' },
  { anahtar: 'kurumlar_vergisi_orani', etiket: 'Kurumlar vergisi oranı', birim: '%', min: 0, max: 100, tamSayi: false, varsayilan: 25,
    aciklama: 'İşletme sonucunda tahmini vergi için kullanılır; resmî beyan veya vergi hesabı yerine geçmez.' },
  { anahtar: 'marj_esigi_yuzde', etiket: 'Kâr marjı eşiği', birim: '%', min: 0, max: 100, tamSayi: false, varsayilan: 20,
    aciklama: 'Teklifin kâr marjı bu oranın altına düşerse uyarı verilir.' },
  { anahtar: 'varsayilan_kdv_orani', etiket: 'Varsayılan KDV oranı', birim: '%', min: 0, max: 100, tamSayi: false, varsayilan: 20,
    aciklama: 'Yeni teklif ve sözleşmede önerilen KDV oranı.' },
];
export const ayarTanimi = (anahtar) => AYAR_TANIMLARI.find((t) => t.anahtar === anahtar);

export const KURAL_MIN = 0;
export const KURAL_MAX = 600;
export const ayBasiDizge = (iso) => `${String(iso).slice(0, 7)}-01`;

/** "22,5", "22.5", "11.700" → sayı; anlaşılmazsa NaN. Nokta, ancak 3'erli gruplarsa binlik ayırıcı sayılır. */
export function sayiAyristir(metin) {
  const s = String(metin ?? '').trim().replace(/\s+/g, '');
  if (!s) return NaN;
  if (/^\d{1,3}(\.\d{3})+$/.test(s)) return Number(s.replace(/\./g, ''));
  if (/^\d+([.,]\d+)?$/.test(s)) return Number(s.replace(',', '.'));
  return NaN;
}

/** Ayar değerini doğrular. Dönüş: { deger } ya da { hata }. */
export function ayarDogrula(tanim, metin) {
  const n = sayiAyristir(metin);
  if (Number.isNaN(n)) return { hata: `${tanim.etiket} bir sayı olmalıdır.` };
  if (n < tanim.min || n > tanim.max) return { hata: `${tanim.etiket} ${tanim.min} ile ${tanim.max} arasında olmalıdır.` };
  if (tanim.tamSayi && !Number.isInteger(n)) return { hata: `${tanim.etiket} tam sayı olmalıdır.` };
  return { deger: n };
}

export function kuralDakikaDogrula(metin) {
  const n = sayiAyristir(metin);
  if (Number.isNaN(n)) return { hata: 'Çalışan başına dakika bir sayı olmalıdır.' };
  if (n < KURAL_MIN || n > KURAL_MAX) return { hata: `Çalışan başına dakika ${KURAL_MIN} ile ${KURAL_MAX} arasında olmalıdır.` };
  return { deger: n };
}

/** Bugünden başlayarak ay başları: bu ay, gelecek ay, ... (varsayılan 13 seçenek). */
export function baslangicSecenekleri(bugunStr, adet = 13) {
  const [y, m] = String(bugunStr).split('-').map(Number);
  return Array.from({ length: adet }, (_, i) => { const t = new Date(Date.UTC(y, m - 1 + i, 1)); return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-01`; });
}

/**
 * Bir ayarın durumu: şu an geçerli değer (yoksa varsayılan), ileride başlayacak ilk değer, tüm geçmiş (yeniden eskiye).
 * ayarlar: settings satırları ({key, value, valid_from}).
 */
export function ayarDurumu(ayarlar, tanim, bugunStr) {
  const satirlar = (ayarlar ?? []).filter((a) => a.key === tanim.anahtar).sort((a, b) => String(b.valid_from).localeCompare(String(a.valid_from)));
  const gecerli = satirlar.find((a) => String(a.valid_from).slice(0, 10) <= bugunStr);
  const planli = satirlar.filter((a) => String(a.valid_from).slice(0, 10) > bugunStr).pop() ?? null;
  return {
    gecerli: gecerli ? { deger: Number(gecerli.value), baslangic: String(gecerli.valid_from).slice(0, 10), varsayilan: false } : { deger: tanim.varsayilan, baslangic: null, varsayilan: true },
    planli: planli ? { deger: Number(planli.value), baslangic: String(planli.valid_from).slice(0, 10) } : null,
    gecmis: satirlar.map((a) => ({ deger: Number(a.value), baslangic: String(a.valid_from).slice(0, 10) })),
  };
}

const kuralGecerliMi = (k, t) => k.valid_from <= t && (!k.valid_to || k.valid_to >= t);

/** Hizmet süresi kuralları: her (personel türü, tehlike sınıfı) için bugünkü ve planlanan kural. */
export function kuralDurumlari(kurallar, bugunStr) {
  const sonuc = {};
  for (const tur of PERSONEL_TURLERI) {
    for (const t of TEHLIKE_SINIFLARI) {
      const l = (kurallar ?? []).filter((k) => k.staff_type === tur && k.hazard_class === t).sort((a, b) => String(b.valid_from).localeCompare(String(a.valid_from)));
      const gecerli = l.find((k) => kuralGecerliMi(k, bugunStr)) ?? null;
      const planli = l.filter((k) => k.valid_from > bugunStr).pop() ?? null;
      sonuc[`${tur}|${t}`] = { gecerli, planli, adet: l.length };
    }
  }
  return sonuc;
}

/** Ayar ve kural değişikliklerini tek listede, başlangıç tarihine göre yeniden eskiye birleştirir. */
export function degisiklikGecmisi(ayarlar, kurallar, { turAdi, tehlikeAdi }) {
  const l = [];
  for (const a of ayarlar ?? []) {
    const t = ayarTanimi(a.key); if (!t) continue;
    l.push({ tur: 'ayar', anahtar: a.key, ad: t.etiket, deger: Number(a.value), birim: t.birim, baslangic: String(a.valid_from).slice(0, 10), bitis: null, not: null });
  }
  for (const k of kurallar ?? []) {
    l.push({ tur: 'kural', ad: `${turAdi[k.staff_type] ?? k.staff_type} · ${tehlikeAdi[k.hazard_class] ?? k.hazard_class}`, deger: Number(k.minutes_per_employee), birim: 'dk/çalışan', baslangic: k.valid_from, bitis: k.valid_to ?? null, not: k.note ?? null });
  }
  return l.sort((a, b) => b.baslangic.localeCompare(a.baslangic) || a.ad.localeCompare(b.ad, 'tr'));
}
