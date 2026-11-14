// OSGB 360 - Ziyaret Planlama: firma konumu, aylık uzman/hekim ziyaret durumu, filtre ve rota. Saf fonksiyonlar (arayüzden bağımsız test edilir).
import { aktifAyda, ayBitisi, firmaPasifMi, PERSONEL_TURU_KISA } from './operasyon.js';

export const ZIYARET_TURLERI = ['is_guvenligi_uzmani', 'isyeri_hekimi'];
/** Haritada tek rotaya sığan durak sayısı (Google Haritalar bağlantısı: 1 varış + en çok 9 ara durak). */
export const ROTA_AZAMI_DURAK = 10;

const temiz = (x) => String(x ?? '').trim();

/** Konum aramak için adres metni. İl veya ilçe yoksa (yalnızca açık adres) arama güvenilmez olacağından boş döner. */
export function adresSorgusu(f) {
  const adres = temiz(f.address); const ilce = temiz(f.district); const il = temiz(f.city);
  if (!il && !ilce) return '';
  return [adres, ilce, il, 'Türkiye'].filter(Boolean).join(', ');
}

/** 'yok' (konum yok) | 'guncel' | 'eski' (konum bulunduktan sonra adres değişmiş) | 'adres-eksik' (aranacak adres yok). */
export function konumDurumu(f) {
  const var_ = f.latitude !== null && f.latitude !== undefined && f.longitude !== null && f.longitude !== undefined;
  const sorgu = adresSorgusu(f);
  if (!var_) return sorgu ? 'yok' : 'adres-eksik';
  if (f.geo_source === 'manuel') return 'guncel';   // elle işaretlenen konum adres değişse de korunur
  return f.geo_query === sorgu ? 'guncel' : 'eski';
}

const ayIci = (tarih, ayBasi) => String(tarih ?? '').slice(0, 7) === String(ayBasi).slice(0, 7);

/**
 * Seçilen ay için her aktif firmanın uzman ve hekim ziyaret durumu.
 * Beklenen ziyaret: ayda o türden yürürlükte görevlendirme varsa (aylık uzman + hekim ziyareti).
 * Yapılan ziyaret: "Zaman ve ziyaret takibi"nde faaliyeti "Firma ziyareti" olan, o türden personelin, o ayki kaydı.
 * Plan: ziyaret planı tablosundaki (arşivsiz) kayıtlar; planlı tarih ay içindeyse sayılır.
 */
export function ayZiyaretDurumlari({ firmalar, atamalar, personel, zamanlar, planlar, ayBasi }) {
  const tur = new Map(personel.map((p) => [p.id, p.staff_type]));
  const ad = new Map(personel.map((p) => [p.id, p.full_name]));
  const atamaMap = new Map(); const ziyaretMap = new Map(); const planMap = new Map();
  const ekle = (m, k, v) => { if (!m.has(k)) m.set(k, []); m.get(k).push(v); };
  for (const a of atamalar) if (aktifAyda(a, ayBasi)) ekle(atamaMap, `${a.company_id}|${a.staff_type}`, a);
  for (const z of zamanlar) {
    if (z.archived_at || z.activity_type !== 'ziyaret' || !z.company_id || !ayIci(z.work_date, ayBasi)) continue;
    const t = tur.get(z.employee_id); if (t) ekle(ziyaretMap, `${z.company_id}|${t}`, z);
  }
  for (const p of planlar) if (!p.archived_at && ayIci(p.planned_date, ayBasi)) ekle(planMap, `${p.company_id}|${p.staff_type}`, p);
  const sonuc = new Map();
  for (const f of firmalar) {
    if (firmaPasifMi(f)) continue;
    const turler = {};
    for (const t of ZIYARET_TURLERI) {
      const k = `${f.id}|${t}`; const a = atamaMap.get(k) ?? []; const z = ziyaretMap.get(k) ?? []; const p = (planMap.get(k) ?? []).sort((x, y) => x.planned_date.localeCompare(y.planned_date));
      const gerekli = a.length > 0;
      const durum = z.length ? 'yapildi' : (!gerekli && !p.length ? 'gerekmez' : (p.length ? 'planli' : 'bekliyor'));
      turler[t] = { gerekli, durum, gorevliler: [...new Set(a.map((x) => ad.get(x.employee_id)).filter(Boolean))], gorevliIdler: [...new Set(a.map((x) => x.employee_id))],
        yapilan: z.length, sonZiyaret: z.map((x) => x.work_date).sort().at(-1) ?? null, planlar: p };
    }
    sonuc.set(f.id, { turler, ozet: firmaOzeti(turler) });
  }
  return sonuc;
}

/** Firmanın ay özeti: 'tamam' (beklenen tüm ziyaretler yapıldı) | 'kismi' | 'eksik' | 'gerekmez' (bu ay beklenen ziyaret yok). */
export function firmaOzeti(turler) {
  const gerekli = Object.values(turler).filter((t) => t.gerekli);
  if (!gerekli.length) return 'gerekmez';
  const yapilan = gerekli.filter((t) => t.durum === 'yapildi').length;
  return yapilan === gerekli.length ? 'tamam' : (yapilan > 0 ? 'kismi' : 'eksik');
}
export const OZET_ETIKETI = { tamam: 'Tamamlandı', kismi: 'Kısmen yapıldı', eksik: 'Ziyaret bekliyor', gerekmez: 'Bu ay beklenen ziyaret yok' };
export const DURUM_ETIKETI = { yapildi: 'Yapıldı', planli: 'Planlandı', bekliyor: 'Bekliyor', gerekmez: 'Yok' };
export const OZET_RENGI = { tamam: '#16a34a', kismi: '#f59e0b', eksik: '#dc2626', gerekmez: '#6b7280' };

/** Tablo satırları: firma + konum durumu + ay durumu. */
export function ziyaretSatirlari({ firmalar, durumlar }) {
  return firmalar.filter((f) => durumlar.has(f.id)).map((f) => ({ firma: f, ...durumlar.get(f.id), konum: konumDurumu(f) }))
    .sort((a, b) => a.firma.name.localeCompare(b.firma.name, 'tr'));
}

/** Süzgeç: il, ilçe, görevli personel, ay özeti, konum durumu, arama. Boş değer = süzme. */
export function filtrele(satirlar, { il = '', ilce = '', gorevli = '', ozet = '', konum = '', ara = '' } = {}) {
  const q = temiz(ara).toLocaleLowerCase('tr');
  return satirlar.filter((s) => {
    if (il && temiz(s.firma.city) !== il) return false;
    if (ilce && temiz(s.firma.district) !== ilce) return false;
    if (gorevli && !ZIYARET_TURLERI.some((t) => s.turler[t].gorevliIdler.includes(gorevli))) return false;
    if (ozet && s.ozet !== ozet) return false;
    if (konum === 'yok' && !['yok', 'adres-eksik'].includes(s.konum)) return false;
    if (konum === 'var' && !['guncel', 'eski'].includes(s.konum)) return false;
    if (q && !`${s.firma.name} ${s.firma.district ?? ''} ${s.firma.city ?? ''} ${s.firma.address ?? ''}`.toLocaleLowerCase('tr').includes(q)) return false;
    return true;
  });
}

/** Seçeneklerde kullanılacak ayrık il / ilçe değerleri (Türkçe sıralı). */
export function ayrikDegerler(firmalar, alan) {
  return [...new Set(firmalar.map((f) => temiz(f[alan])).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'tr'));
}

export function mesafeKm(a, b) {
  const r = (x) => (x * Math.PI) / 180; const R = 6371;
  const dLat = r(b.latitude - a.latitude); const dLng = r(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(r(a.latitude)) * Math.cos(r(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** En yakın komşu sırası: ilk firmadan başlar, her adımda en yakın bir sonrakini seçer. (Kesin en kısa rota değil; Google rotayı yine optimize edebilir.) */
export function yakinSiraya(firmalar) {
  const kalan = firmalar.filter((f) => f.latitude != null && f.longitude != null); if (kalan.length < 3) return kalan;
  const sira = [kalan.shift()];
  while (kalan.length) {
    const son = sira.at(-1); let en = 0;
    kalan.forEach((f, i) => { if (mesafeKm(son, f) < mesafeKm(son, kalan[en])) en = i; });
    sira.push(kalan.splice(en, 1)[0]);
  }
  return sira;
}

/** Google Haritalar çok duraklı yol tarifi bağlantısı (anahtar gerekmez; başlangıç noktası olarak cihazın konumu kullanılır). */
export function rotaBaglantisi(firmalar, { sirala = true } = {}) {
  const konumlu = firmalar.filter((f) => f.latitude != null && f.longitude != null);
  const sirali = sirala ? yakinSiraya(konumlu) : konumlu;
  const kullanilan = sirali.slice(0, ROTA_AZAMI_DURAK);
  if (!kullanilan.length) return { url: null, kullanilan: [], atlanan: firmalar.length };
  const nokta = (f) => `${Number(f.latitude).toFixed(6)},${Number(f.longitude).toFixed(6)}`;
  const varis = kullanilan.at(-1); const ara = kullanilan.slice(0, -1);
  const p = new URLSearchParams({ api: '1', travelmode: 'driving', destination: nokta(varis) });
  if (ara.length) p.set('waypoints', ara.map(nokta).join('|'));
  return { url: `https://www.google.com/maps/dir/?${p.toString()}`, kullanilan, atlanan: firmalar.length - kullanilan.length };
}

export const turEtiketi = (t) => PERSONEL_TURU_KISA[t] ?? t;
export { ayBitisi };
