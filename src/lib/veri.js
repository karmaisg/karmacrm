// OSGB 360 - Arayüz için küçük veri yardımcıları (tarihçeli kayıtlar, ayarlar, doğrulama).
import { gecerliKayit, VARSAYILAN_KAPASITE_DAKIKA, vergiNoTemizle } from './hesaplama.js';
import { trKucuk, safeUrl } from './format.js';

export function profilleriGrupla(profiller) {
  const harita = new Map();
  for (const p of profiller) {
    if (!harita.has(p.company_id)) harita.set(p.company_id, []);
    harita.get(p.company_id).push(p);
  }
  return harita;
}

/** Verilen tarihte geçerli çalışan/tehlike kaydı; yoksa (veya dönemler çakışıyorsa) null. */
export function guncelProfil(liste, tarih) {
  if (!liste?.length) return null;
  try { return gecerliKayit(liste, tarih); } catch { return null; }
}

/** Ayar değeri: anahtar için tarihte geçerli (en yeni başlangıçlı) satırın değeri; yoksa varsayılan. */
export function ayarDegeri(ayarlar, anahtar, tarih, varsayilan) {
  const adaylar = (ayarlar ?? [])
    .filter((a) => a.key === anahtar && String(a.valid_from).slice(0, 10) <= tarih)
    .sort((a, b) => String(b.valid_from).localeCompare(String(a.valid_from)));
  return adaylar.length ? adaylar[0].value : varsayilan;
}

export const kapasiteDakika = (ayarlar, tarih) => {
  const v = Number(ayarDegeri(ayarlar, 'kapasite_dakika', tarih, VARSAYILAN_KAPASITE_DAKIKA));
  return v > 0 ? v : VARSAYILAN_KAPASITE_DAKIKA;
};

// ---------------------------------------------------------------- doğrulama
const EPOSTA = /^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/;

export const epostaGecerli = (v) => EPOSTA.test(String(v).trim());

export function telefonGecerli(v) {
  const s = String(v).trim();
  if (!/^[\d\s()+\-.]{7,25}$/.test(s)) return false;
  return s.replace(/\D/g, '').length >= 7;
}

export const webGecerli = (v) => safeUrl(v) !== null;

/** Vergi no: yalnızca rakam/boşluk/nokta/tire içeriyorsa rakamlara indirilir; aksi hâlde yazıldığı gibi (kurum tanımlayıcısı). */
export function vergiNoNormalize(v) {
  const s = String(v ?? '').trim();
  if (!s) return '';
  return /^[\d\s.\-]+$/.test(s) ? vergiNoTemizle(s) : s;
}

export const bosIseNull = (v) => {
  const s = String(v ?? '').trim();
  return s === '' ? null : s;
};

const adAnahtari = (ad) => trKucuk(ad).replace(/\s+/g, ' ').trim();

/** Mükerrer kontrolü: aynı vergi numaralı veya aynı adlı firmalar. kendiId düzenlenen firmayı dışlar. */
export function mukerrerFirmalar(firmalar, { vergiNo, ad, kendiId = null }) {
  const vn = vergiNoNormalize(vergiNo);
  const anahtar = adAnahtari(ad);
  const digerleri = firmalar.filter((f) => f.id !== kendiId);
  return {
    vergiNoAktif: vn ? digerleri.find((f) => !f.archived_at && f.tax_no && vergiNoNormalize(f.tax_no) === vn) ?? null : null,
    vergiNoArsiv: vn ? digerleri.find((f) => f.archived_at && f.tax_no && vergiNoNormalize(f.tax_no) === vn) ?? null : null,
    adAktif: anahtar ? digerleri.find((f) => !f.archived_at && adAnahtari(f.name) === anahtar) ?? null : null,
  };
}
