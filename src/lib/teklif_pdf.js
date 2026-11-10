// OSGB 360 - Teklif PDF'i: seçilen dosyanın doğrulanması ve base64 ↔ bayt dönüşümleri (tarayıcıda).
export const PDF_AZAMI_BOYUT = 3 * 1024 * 1024; // bayt; veritabanı sınırıyla aynı

/** Dosya seçimi için hata metni; sorun yoksa null. İçerik imzası ("%PDF-") ayrıca pdfImzasiVar ile denetlenir. */
export function pdfDogrula(dosya) {
  if (!dosya || !dosya.name || dosya.size === 0) return 'Bir PDF dosyası seçin.';
  if (!/\.pdf$/i.test(dosya.name)) return 'Yalnızca .pdf dosyası yüklenebilir.';
  if (dosya.size > PDF_AZAMI_BOYUT) return 'PDF en çok 3 MB olabilir. Dosyayı küçültüp tekrar deneyin.';
  return null;
}
export const pdfImzasiVar = (bayt) => bayt.length >= 5 && bayt[0] === 0x25 && bayt[1] === 0x50 && bayt[2] === 0x44 && bayt[3] === 0x46 && bayt[4] === 0x2d;

export function baytBase64(bayt) {
  let s = ''; for (let i = 0; i < bayt.length; i += 0x8000) s += String.fromCharCode(...bayt.subarray(i, i + 0x8000));
  return btoa(s);
}
export function base64Bayt(metin) {
  const s = atob(String(metin ?? '')); const b = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i); return b;
}
export const boyutMetni = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1).replace('.', ',')} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
