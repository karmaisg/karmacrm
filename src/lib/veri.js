// OSGB 360 - Arayüz için küçük veri yardımcıları (tarihçeli kayıtlar, ayarlar, doğrulama).
import { gecerliKayit, VARSAYILAN_KAPASITE_DAKIKA, vergiNoTemizle } from './hesaplama.js';
import { trKucuk, safeUrl } from './format.js';

const gunKaydir = (iso, n) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const profilParcalari = (p) => (Array.isArray(p.site_breakdown) && p.site_breakdown.length > 1
  ? p.site_breakdown.map((d) => ({ tehlike: d.tehlike, calisan: Number(d.calisan) }))
  : [{ tehlike: p.hazard_class, calisan: Number(p.employee_count) }]);
const TEHLIKE_SIRA = { az_tehlikeli: 1, tehlikeli: 2, cok_tehlikeli: 3 };

/** Bağlı firma → ana firma kimliği. */
export function anaFirmaHaritasi(firmalar) {
  return new Map((firmalar ?? []).filter((f) => f.parent_company_id).map((f) => [f.id, f.parent_company_id]));
}

/** Ana firmanın ve bağlı firmalarının profil zaman çizgilerini birleştirir (çalışan sayıları toplanır, her tehlike sınıfı ayrı tutulur). */
function birlesikProfiller(anaListe, bagliListeler, firmaId) {
  const listeler = [anaListe, ...bagliListeler].filter((l) => l?.length);
  const kirilim = [...new Set(listeler.flatMap((l) => l.map((p) => String(p.valid_from).slice(0, 10))))].sort();
  const sonuc = [];
  kirilim.forEach((b, i) => {
    const gecerli = listeler.map((l) => l.find((p) => String(p.valid_from).slice(0, 10) <= b && (!p.valid_to || String(p.valid_to).slice(0, 10) >= b))).filter(Boolean);
    if (!gecerli.length) return;
    const toplam = new Map();
    for (const p of gecerli) for (const x of profilParcalari(p)) toplam.set(x.tehlike, (toplam.get(x.tehlike) ?? 0) + x.calisan);
    let siniflar = [...toplam.entries()];
    if (siniflar.some(([, n]) => n > 0)) siniflar = siniflar.filter(([, n]) => n > 0);
    const tehlike = siniflar.reduce((m, [h]) => (!m || TEHLIKE_SIRA[h] > TEHLIKE_SIRA[m] ? h : m), null);
    const calisan = siniflar.reduce((t, [, n]) => t + n, 0);
    sonuc.push({ id: `grup:${firmaId}:${b}`, company_id: firmaId, employee_count: calisan, hazard_class: tehlike,
      site_breakdown: siniflar.length > 1 ? siniflar.sort(([a], [c]) => a.localeCompare(c)).map(([h, n]) => ({ tehlike: h, calisan: n })) : null,
      valid_from: b, valid_to: kirilim[i + 1] ? gunKaydir(kirilim[i + 1], -1) : null, birlesik: true });
  });
  return sonuc;
}

/**
 * Firma kimliğine göre profil listeleri. `firmalar` verilirse bağlı firmaların (parent_company_id) çalışan sayısı ve tehlike sınıfı
 * ana firmanın profiline eklenir ve bağlı firmaların kendi kayıtları haritadan çıkarılır (aynı yük iki kez sayılmaz).
 */
export function profilleriGrupla(profiller, firmalar = null) {
  const harita = new Map();
  for (const p of profiller) {
    if (!harita.has(p.company_id)) harita.set(p.company_id, []);
    harita.get(p.company_id).push(p);
  }
  const ana = firmalar ? anaFirmaHaritasi(firmalar) : null;
  if (!ana?.size) return harita;
  const cocuklar = new Map();
  for (const [c, a] of ana) { if (!cocuklar.has(a)) cocuklar.set(a, []); cocuklar.get(a).push(c); }
  for (const [anaId, liste] of cocuklar) harita.set(anaId, birlesikProfiller(harita.get(anaId), liste.map((c) => harita.get(c)), anaId));
  for (const c of ana.keys()) harita.delete(c);
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
