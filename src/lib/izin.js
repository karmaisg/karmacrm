// OSGB 360 - Yıllık izin hakkı hesabı (saf fonksiyonlar). İşe başlama tarihi esas alınır; hak, her tam çalışma yılının
// tamamlandığı yıldönümünde doğar (ilk hak 1 yıl çalıştıktan sonra).
//   Hizmet süresi 1–5 yıl (5 dahil): 14 iş günü · 5–15 yıl (15 hariç): 20 iş günü · 15 yıl ve üzeri: 26 iş günü.
//   Hak edildiği tarihte 18 yaşından küçük veya 50 yaşında/üzerinde olan personele yılda en az 20 iş günü verilir.
const utc = (iso) => new Date(`${iso}T00:00:00Z`);
const dizge = (d) => d.toISOString().slice(0, 10);
const r1 = (n) => Math.round(n * 10) / 10;

export const YAS_ALT = 18;      // bu yaştan küçüklere en az 20 gün
export const YAS_UST = 50;      // bu yaş ve üzerine en az 20 gün (4857 sayılı Kanun md. 53)
export const MIN_GUN_YAS_KURALI = 20;

/** Başlangıç tarihinin n. yıldönümü (29 Şubat → artık olmayan yıllarda 28 Şubat). */
export function yilEkle(iso, n) {
  const d = utc(iso); const ay = d.getUTCMonth(); const gun = d.getUTCDate(); const y = d.getUTCFullYear() + n;
  const son = new Date(Date.UTC(y, ay + 1, 0)).getUTCDate();
  return dizge(new Date(Date.UTC(y, ay, Math.min(gun, son))));
}

/** Verilen tarihte tamamlanmış yaş. */
export function yasHesapla(dogum, tarihi) {
  if (!dogum) return null;
  let y = Number(tarihi.slice(0, 4)) - Number(dogum.slice(0, 4));
  if (tarihi.slice(5) < dogum.slice(5)) y -= 1;
  return y;
}

/** n tam yıl çalışma sonrası temel yıllık izin günü. */
export const temelGun = (n) => (n >= 15 ? 26 : n > 5 ? 20 : 14);

/** Hafta içi (pzt–cum) iş günü sayısı; resmî tatiller hesaba katılmaz, formda elle düzeltilebilir. */
export function isGunuSayisi(bas, bit) {
  if (!bas || !bit || bit < bas) return 0;
  let n = 0; const son = utc(bit);
  for (let d = utc(bas); d <= son; d.setUTCDate(d.getUTCDate() + 1)) { const g = d.getUTCDay(); if (g !== 0 && g !== 6) n += 1; }
  return n;
}

/**
 * @param {{baslangic: string|null, dogum?: string|null, ayrilis?: string|null, izinler?: {days:number|string}[], bugun: string}} p
 * @returns yıllar: her çalışma yılı için hak, kullanılan (en eski haktan başlayarak düşülür) ve kalan; sonraki hak; toplamlar.
 */
export function izinHakki({ baslangic, dogum = null, ayrilis = null, izinler = [], bugun }) {
  const uyarilar = [];
  if (!baslangic) return { gecerli: false, uyarilar: ['İşe başlama tarihi girilmemiş; izin hakkı hesaplanamaz.'], yillar: [], toplamHak: 0, toplamKullanilan: 0, kalan: 0, fazla: 0, sonraki: null, calismaYili: 0 };
  if (!dogum) uyarilar.push('Doğum tarihi girilmemiş; 18 yaş altı ve 50 yaş üstü için 20 gün kuralı uygulanamadı.');
  const yillar = [];
  for (let n = 1; n <= 80; n++) {
    const hakTarihi = yilEkle(baslangic, n);
    if (hakTarihi > bugun || (ayrilis && hakTarihi > ayrilis)) break;
    const yas = yasHesapla(dogum, hakTarihi); const temel = temelGun(n);
    const yasKurali = yas !== null && (yas < YAS_ALT || yas >= YAS_UST) && temel < MIN_GUN_YAS_KURALI;
    yillar.push({ no: n, donemBas: yilEkle(baslangic, n - 1), donemBit: dizge(new Date(utc(hakTarihi).getTime() - 86400000)), hakTarihi,
      hakGun: yasKurali ? MIN_GUN_YAS_KURALI : temel, temel, yasKurali, yas, kullanilan: 0, kalan: 0 });
  }
  let kullanilacak = r1(izinler.reduce((t, i) => t + (Number(i.days) || 0), 0)); const toplamKullanilan = kullanilacak;
  for (const y of yillar) { const k = r1(Math.min(y.hakGun, kullanilacak)); y.kullanilan = k; y.kalan = r1(y.hakGun - k); kullanilacak = r1(kullanilacak - k); }
  const toplamHak = r1(yillar.reduce((t, y) => t + y.hakGun, 0));
  let sonraki = null;
  if (!ayrilis || yilEkle(baslangic, yillar.length + 1) <= ayrilis) {
    const n = yillar.length + 1; const t = yilEkle(baslangic, n); const yas = yasHesapla(dogum, t); const temel = temelGun(n);
    sonraki = { no: n, tarih: t, gun: yas !== null && (yas < YAS_ALT || yas >= YAS_UST) && temel < MIN_GUN_YAS_KURALI ? MIN_GUN_YAS_KURALI : temel };
  }
  if (kullanilacak > 0) uyarilar.push(`Hak edilenden ${kullanilacak} gün fazla izin kullanılmış (gelecek yıllık haktan düşülecektir).`);
  const calisma = Math.floor((Date.parse(`${ayrilis && ayrilis < bugun ? ayrilis : bugun}T00:00:00Z`) - Date.parse(`${baslangic}T00:00:00Z`)) / 86400000 / 365.25);
  return { gecerli: true, uyarilar, yillar, toplamHak, toplamKullanilan, kalan: r1(toplamHak - toplamKullanilan), fazla: kullanilacak, sonraki, calismaYili: Math.max(0, calisma) };
}
