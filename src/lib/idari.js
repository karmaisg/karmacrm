// OSGB 360 - İdari İşler: belge türleri, dosya doğrulama, süre durumu (saf fonksiyonlar).
export const OZLUK_BELGELERI = {
  ise_giris_bildirgesi: 'İşe giriş bildirgesi', kimlik: 'Kimlik belgesi', nufus_kayit: 'Nüfus kayıt örneği', ikametgah: 'İkametgâh belgesi',
  adli_sicil: 'Adli sicil belgesi', diploma: 'Diploma', sertifika: 'Sertifika', isg_egitimi: 'İSG eğitimi', saglik_raporu: 'Sağlık raporu',
};
export const BELGE_TURU = { ...OZLUK_BELGELERI, ruhsat: 'Ruhsat', trafik_sigortasi: 'Trafik sigortası', kasko: 'Kasko', bakim: 'Bakım', diger: 'Diğer' };
export const ARAC_KAYDI = { ruhsat: 'Ruhsat', trafik_sigortasi: 'Trafik sigortası', kasko: 'Kasko', bakim: 'Bakım', muayene: 'Muayene', diger: 'Diğer (ekstra veri)' };

export const AZAMI_BOYUT = 10 * 1024 * 1024;
export const IZINLI_TURLER = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
export const KABUL = '.pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp';

const UZANTI_TUR = { pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
/** Tarayıcı türü boş verirse uzantıdan çıkarılır. */
export const dosyaTuru = (f) => (IZINLI_TURLER[f?.type] ? f.type : UZANTI_TUR[String(f?.name ?? '').split('.').pop().toLowerCase()] ?? '');

/** Seçilen dosya için hata metni; geçerliyse null. */
export function dosyaDogrula(f) {
  if (!f || !f.size) return 'Bir dosya seçin.';
  if (!dosyaTuru(f)) return 'Yalnızca PDF veya resim (JPG, PNG, WEBP) yüklenebilir.';
  if (f.size > AZAMI_BOYUT) return 'Dosya 10 MB\'tan büyük olamaz.';
  return null;
}
export const boyutMetni = (b) => (b >= 1048576 ? `${(b / 1048576).toFixed(1).replace('.', ',')} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

/** Depolama yolu: "<kurum>/<kapsam>/<benzersiz>.<uzantı>" (ilk bölüm RLS için kurum kimliğidir). */
export const depoYolu = (kurum, kapsam, benzersiz, tur) => `${kurum}/${kapsam}/${benzersiz}.${IZINLI_TURLER[tur]}`;

/** Bitiş tarihine göre durum: gecmis | yakin (≤30 gün) | gecerli | yok. */
export function sureDurumu(bitis, bugun, uyariGun = 30) {
  if (!bitis) return { durum: 'yok', gun: null };
  const gun = Math.round((Date.parse(`${bitis}T00:00:00Z`) - Date.parse(`${bugun}T00:00:00Z`)) / 86400000);
  return { durum: gun < 0 ? 'gecmis' : gun <= uyariGun ? 'yakin' : 'gecerli', gun };
}

/** Plaka: boşluksuz, büyük harf (veri tabanındaki kuralla aynı). */
export const plakaDuzelt = (p) => String(p ?? '').replace(/\s+/g, '').toUpperCase();
export const plakaGecerli = (p) => /^[0-9A-Z]{3,15}$/.test(plakaDuzelt(p));
