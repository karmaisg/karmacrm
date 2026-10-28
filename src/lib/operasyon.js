// OSGB 360 - Personel, görevlendirme, zaman ve kapasite yardımcıları. Saf fonksiyonlar (arayüzden bağımsız test edilir).
import { firmaAylikIhtiyac, dagitPaylar } from './hesaplama.js';
import { gunEkle } from './format.js';

export const PERSONEL_TURU = { is_guvenligi_uzmani: 'İş güvenliği uzmanı', isyeri_hekimi: 'İşyeri hekimi' };
export const PERSONEL_TURU_KISA = { is_guvenligi_uzmani: 'Uzman', isyeri_hekimi: 'Hekim' };
export const FAALIYET = {
  ziyaret: 'Firma ziyareti', risk_degerlendirme: 'Risk değerlendirmesi', egitim: 'Eğitim', muayene: 'Sağlık muayenesi',
  rapor: 'Raporlama', toplanti: 'Toplantı / kurul', yol: 'Yol', idari: 'İdari iş', diger: 'Diğer',
};

/** Görevlendirme verilen günde yürürlükte mi (arşivdekiler sayılmaz). */
export const aktifMi = (a, tarih) => !a.archived_at && a.valid_from <= tarih && (!a.valid_to || a.valid_to >= tarih);

export const ayBasiDizge = (iso) => `${String(iso).slice(0, 7)}-01`;
/** Ayın son günü ('2026-10-01' -> '2026-10-31'). */
export function ayBitisi(ay) {
  const [y, m] = String(ay).slice(0, 7).split('-').map(Number);
  const sonraki = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
  return gunEkle(sonraki, -1);
}

/** Bir firmada, hizmet türü ve gün için toplam görevlendirme payı (%). */
export function kapsamPayi(atamalar, companyId, staffType, tarih) {
  return atamalar.filter((a) => a.company_id === companyId && a.staff_type === staffType && aktifMi(a, tarih))
    .reduce((t, a) => t + Number(a.share_pct), 0);
}

/**
 * Bir personelin belirli ay için teorik yükü: ayın 1'inde yürürlükte olan görevlendirmelerinin payı kadar,
 * firmaların teorik hizmet ihtiyacından düşen dakika. Firma payları dagitPaylar ile bölünür (toplam ihtiyacı aşmaz).
 * Ay içinde başlayan görevlendirme bir sonraki ay yansır (firma profili kuralıyla aynı).
 */
export function personelAyYuku({ atamalar, employeeId, profilHaritasi, kurallar, ay }) {
  const gun = ayBasiDizge(ay);
  const benimkiler = atamalar.filter((a) => a.employee_id === employeeId && aktifMi(a, gun));
  const kalemler = [];
  let toplam = 0;
  for (const a of benimkiler) {
    const ihtiyac = firmaAylikIhtiyac({ profiller: profilHaritasi.get(a.company_id) ?? [], kurallar, ay: gun });
    const toplamIhtiyac = a.staff_type === 'is_guvenligi_uzmani' ? ihtiyac.uzmanDakika : ihtiyac.hekimDakika;
    if (toplamIhtiyac === null || toplamIhtiyac === undefined) { kalemler.push({ atama: a, dakika: null, eksik: ihtiyac.eksik || 'Hizmet süresi hesaplanamadı.' }); continue; }
    const ayniFirma = atamalar.filter((x) => x.company_id === a.company_id && x.staff_type === a.staff_type && aktifMi(x, gun));
    const dagilim = dagitPaylar(toplamIhtiyac, ayniFirma);
    const benim = dagilim.kisiler.find((k) => k.id === a.id);
    kalemler.push({ atama: a, dakika: benim.dakika, eksik: null });
    toplam += benim.dakika;
  }
  return { dakika: toplam, kalemler, eksikVar: kalemler.some((k) => k.dakika === null) };
}

/** Zaman kayıtlarının toplamları (arşivdekiler hariç). hizmet = saha + raporlama. */
export function zamanOzeti(kayitlar) {
  const t = { toplam: 0, saha: 0, yol: 0, bekleme: 0, rapor: 0, idari: 0, hizmet: 0, adet: 0 };
  for (const k of kayitlar) {
    if (k.archived_at) continue;
    t.adet += 1;
    t.toplam += Number(k.total_minutes ?? 0);
    t.saha += Number(k.onsite_minutes); t.yol += Number(k.travel_minutes); t.bekleme += Number(k.waiting_minutes);
    t.rapor += Number(k.reporting_minutes); t.idari += Number(k.admin_minutes);
  }
  t.hizmet = t.saha + t.rapor;
  return t;
}

/** Doluluk durumu: oran (1.0 = %100) -> 'bos' | 'normal' | 'dolu' | 'asiri'. */
export function dolulukSeviyesi(oran) {
  if (oran === null || oran === undefined) return 'bilinmiyor';
  if (oran > 1) return 'asiri';
  if (oran >= 0.9) return 'dolu';
  if (oran < 0.5) return 'bos';
  return 'normal';
}

/** Dakikayı '2 sa 30 dk' biçimine çevirir. */
export function sureMetni(dk) {
  const d = Math.round(Number(dk) || 0);
  if (d <= 0) return '0 dk';
  const sa = Math.floor(d / 60); const dk2 = d % 60;
  return [sa ? `${sa} sa` : '', dk2 ? `${dk2} dk` : ''].filter(Boolean).join(' ');
}

/** Aynı personelin kayıtları arasında çakışma var mı? (istemci ön kontrolü; asıl denetim veri tabanında) */
export function zamanCakisiyor(kayitlar, employeeId, baslangicIso, bitisIso, haricId = null) {
  const b1 = new Date(baslangicIso).getTime(); const b2 = new Date(bitisIso).getTime();
  return kayitlar.find((k) => !k.archived_at && k.employee_id === employeeId && k.id !== haricId
    && new Date(k.start_at).getTime() < b2 && new Date(k.end_at).getTime() > b1) ?? null;
}
