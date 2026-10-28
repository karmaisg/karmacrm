// OSGB 360 - Tarayıcıdan dosya indirme (Blob). CSP: blob adresine yönlendirme/indirme script veya bağlantı kuralına takılmaz.
import { csvUret } from '../lib/csv.js';
import { trKucuk } from '../lib/format.js';

const ASCII = { ç: 'c', ğ: 'g', ı: 'i', ö: 'o', ş: 's', ü: 'u' };
/** Dosya adında güvenli parça: küçük harf, Türkçe karakterler ASCII, boşluk → tire. */
export const dosyaAdiParcasi = (s) => trKucuk(s).replace(/[çğıöşü]/g, (c) => ASCII[c]).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'dosya';

export function dosyaIndir(ad, metin, tur = 'text/csv;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([metin], { type: tur }));
  const a = document.createElement('a');
  a.href = url; a.download = ad; a.rel = 'noopener';
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export function csvIndir(adParcasi, basliklar, satirlar, tarihStr) {
  const ad = `${dosyaAdiParcasi(adParcasi)}-${tarihStr}.csv`;
  dosyaIndir(ad, csvUret(basliklar, satirlar));
  return ad;
}
