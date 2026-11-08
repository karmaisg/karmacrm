// OSGB 360 - Yönetici paneli aylık özet hesapları (saf fonksiyonlar; kârlılık hesabını yeniden kullanır, ayrı bir hesap yöntemi yoktur).
import { hesaplaKarlilik, faturaAyi } from './karlilik.js';
import { aktifAyda, ayBitisi } from './operasyon.js';
import { firmaAylikIhtiyac } from './hesaplama.js';
import { profilleriGrupla, anaFirmaHaritasi } from './veri.js';
import { atamalariBagla } from './operasyon.js';

const ay7 = (d) => String(d).slice(0, 7);
const k2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const topla = (liste, f) => k2(liste.reduce((t, x) => t + (Number(f(x)) || 0), 0));

/** Seçili ay dahil geriye doğru n ayın 1'leri (eskiden yeniye). */
export function sonAylar(ay, n = 12) {
  const [y, m] = String(ay).slice(0, 7).split('-').map(Number); const l = [];
  for (let i = n - 1; i >= 0; i -= 1) { const t = new Date(Date.UTC(y, m - 1 - i, 1)); l.push(`${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-01`); }
  return l;
}

/**
 * @param veri  karlilik sayfasındaki girdiYukle çıktısı (seçili ay için)
 * @param tahsilatlar  tüm tahsilat kayıtları
 */
/**
 * İSG-Katip aylık çalışan verisi: [{ period, company_id, hazard_class, employee_count }] → ay → ana firma → [{ sinif, calisan }].
 * İstenen ayda aktarım yoksa, ondan önceki en son aktarım kullanılır; hiç yoksa null (profil verisine dönülür).
 */
export function katipAyHaritasi(katip, firmalar, ayBasiStr) {
  if (!katip?.length) return null;
  const anaMap = anaFirmaHaritasi(firmalar); const ay = String(ayBasiStr).slice(0, 7);
  const aylar = [...new Set(katip.map((x) => String(x.period).slice(0, 7)))].sort();
  const secilen = aylar.includes(ay) ? ay : [...aylar].reverse().find((a) => a < ay);
  if (!secilen) return null;
  const harita = new Map();
  for (const x of katip) {
    if (String(x.period).slice(0, 7) !== secilen) continue;
    const id = anaMap.get(x.company_id) ?? x.company_id;
    const l = harita.get(id) ?? []; const e = l.find((y) => y.sinif === x.hazard_class);
    if (e) e.calisan += Number(x.employee_count) || 0; else l.push({ sinif: x.hazard_class, calisan: Number(x.employee_count) || 0 });
    harita.set(id, l);
  }
  return harita;
}

export function aylikOzet({ veri, tahsilatlar = [], yontem = 'teorik' }) {
  const ay = String(veri.ay).slice(0, 7); const ayBasi = `${ay}-01`; const r = hesaplaKarlilik({ ...veri, yontem });
  const i = r.isletme; const gider = k2(i.toplamGider); // = Giderler menüsünün KDV hariç toplamı (kurumlar vergisi kategorisi dahil)

  // tahsilat: ödeme tarihi seçili ayda olanlar (KDV dahil); alacak: seçili ayın faturalarının kalanı (KDV dahil)
  const aktifTahsilat = tahsilatlar.filter((p) => !p.archived_at);
  const tahsilat = topla(aktifTahsilat.filter((p) => ay7(p.paid_at) === ay), (p) => p.amount);
  const odenen = new Map(); for (const p of aktifTahsilat) odenen.set(p.invoice_id, (odenen.get(p.invoice_id) ?? 0) + Number(p.amount));
  const ayFaturalari = veri.faturalar.filter((f) => !f.archived_at && faturaAyi(f) === ay);
  const faturaTutari = (f) => Number(f.amount_incl_vat ?? Number(f.amount_excl_vat) + Number(f.vat_amount));
  const tahsilEdilmemis = k2(ayFaturalari.reduce((t, f) => t + Math.max(0, faturaTutari(f) - (odenen.get(f.id) ?? 0)), 0));

  // aktif firma = seçili ayda sözleşmesi geçerli müşteri
  const anaMap = anaFirmaHaritasi(veri.firmalar); const anaOf = (id) => anaMap.get(id) ?? id;
  const musteri = veri.firmalar.filter((f) => !f.archived_at && (f.customer_status ?? 'musteri') === 'musteri' && !f.parent_company_id);
  const sozlesmeli = new Set(veri.sozlesmeler.filter((c) => !c.archived_at && ['aktif', 'yenilendi', 'sona_erdi'].includes(c.status) && ay7(c.start_date) <= ay && ay7(c.end_date) >= ay).map((c) => anaOf(c.company_id)));
  const aktifFirmalar = musteri.filter((f) => sozlesmeli.has(f.id));

  const calisanlar = veri.personeller.filter((e) => e.is_active !== false && !e.archived_at);
  const uzman = calisanlar.filter((e) => e.staff_type === 'is_guvenligi_uzmani').length; const hekim = calisanlar.filter((e) => e.staff_type === 'isyeri_hekimi').length;

  // teorik / fiilî hizmet dakikası
  const harita = profilleriGrupla(veri.profiller, veri.firmalar); let uzmanDk = 0; let hekimDk = 0;
  const teorikFirma = new Map();
  for (const f of aktifFirmalar) {
    const s = firmaAylikIhtiyac({ profiller: harita.get(f.id) ?? [], kurallar: veri.kurallar, ay: ayBasi });
    const u = s.uzmanDakika ?? 0; const h = s.hekimDakika ?? 0; uzmanDk += u; hekimDk += h; teorikFirma.set(f.id, u + h);
  }
  const fiiliFirma = new Map(); let fiiliDk = 0;
  for (const z of veri.zaman) {
    if (z.archived_at || ay7(z.work_date) !== ay || !z.company_id) continue;
    const dk = Number(z.onsite_minutes ?? 0) + Number(z.reporting_minutes ?? 0); fiiliDk += dk; fiiliFirma.set(anaOf(z.company_id), (fiiliFirma.get(anaOf(z.company_id)) ?? 0) + dk);
  }

  // dikkat: personele atanmamış firma geliri
  const atanan = new Set(atamalariBagla(veri.atamalar, veri.firmalar).filter((a) => aktifAyda(a, ayBasi)).map((a) => a.company_id));
  const atanmamisGelir = k2(r.firmalar.filter((f) => f.id === null || !atanan.has(f.id)).reduce((t, f) => t + f.gelir, 0));

  // tehlike sınıfı dökümü
  const gelirFirma = new Map(r.firmalar.map((f) => [f.id, f.gelir])); const tehlike = {};
  for (const f of aktifFirmalar) {
    const profil = (harita.get(f.id) ?? []).find((p) => p.valid_from <= ayBitisi(ayBasi) && (!p.valid_to || p.valid_to >= ayBasi));
    const sinif = profil?.hazard_class; if (!sinif) continue;
    const t = (tehlike[sinif] ??= { sinif, firma: 0, gelir: 0, teorikDk: 0, fiiliDk: 0 });
    t.firma += 1; t.gelir = k2(t.gelir + (gelirFirma.get(f.id) ?? 0)); t.teorikDk += teorikFirma.get(f.id) ?? 0; t.fiiliDk += fiiliFirma.get(f.id) ?? 0;
  }

  // hizmet verilen firmalar: seçili ayda sözleşmesi geçerli olanlar + o ay faturası kesilenler.
  // Çalışan sayısı ve tehlike sınıfı o ayın profilinden; karma sınıflı firmada gelir, sınıfların çalışan sayısı oranında bölünür.
  const SINIFLAR = ['cok_tehlikeli', 'tehlikeli', 'az_tehlikeli'];
  const sinifToplam = Object.fromEntries(SINIFLAR.map((s) => [s, { sinif: s, gelir: 0, calisan: 0, firma: 0 }]));
  const katipAy = katipAyHaritasi(veri.katipAylik, veri.firmalar, ayBasi);
  let hizmetCalisan = 0; let siniflanamayanGelir = 0;
  for (const f of musteri) {
    const g = gelirFirma.get(f.id) ?? 0;
    if (!sozlesmeli.has(f.id) && !(g > 0)) continue;
    const profil = (harita.get(f.id) ?? []).find((p) => p.valid_from <= ayBitisi(ayBasi) && (!p.valid_to || p.valid_to >= ayBasi));
    const kp = katipAy?.get(f.id);      // İSG-Katip'teki o ay (veya önceki en son) aktarım, varsa esas alınır
    if (!kp && (!profil || !profil.hazard_class)) { siniflanamayanGelir += g; continue; }
    const parcalar = kp ?? (Array.isArray(profil.site_breakdown) && profil.site_breakdown.length > 1
      ? profil.site_breakdown.map((d) => ({ sinif: d.tehlike, calisan: Number(d.calisan) || 0 }))
      : [{ sinif: profil.hazard_class, calisan: Number(profil.employee_count) || 0 }]);
    const toplamCalisan = parcalar.reduce((t, x) => t + x.calisan, 0);
    hizmetCalisan += toplamCalisan;
    for (const x of parcalar) {
      const t = sinifToplam[x.sinif]; if (!t) continue;
      t.calisan += x.calisan; t.firma += 1;
      t.gelir += toplamCalisan > 0 ? (g * x.calisan) / toplamCalisan : (x.sinif === profil.hazard_class ? g : 0);
    }
  }
  const sinifGelir = SINIFLAR.map((s) => { const t = sinifToplam[s]; return { sinif: s, firma: t.firma, calisan: t.calisan, gelir: k2(t.gelir), kisiGelir: t.calisan > 0 ? k2(t.gelir / t.calisan) : null }; });
  const kisiGelir = hizmetCalisan > 0 ? k2(i.gelir / hizmetCalisan) : null;

  const firmalar = r.firmalar.filter((f) => f.id !== null);
  // Hesap dökümü (kutucuklara tıklayınca): Giderler menüsündeki kategori toplamları + kartlardan gelen kalemler
  const katMap = new Map((veri.kategoriler ?? []).map((k) => [k.id, k]));
  const kategoriToplam = new Map();
  for (const g of veri.giderler ?? []) {
    if (g.archived_at || ay7(g.expense_date) !== ay) continue;
    const e = kategoriToplam.get(g.category_id) ?? { k: 0, n: 0, ortak: 0, dogrudan: 0 }; e.k += Math.round(Number(g.amount_excl_vat) * 100); e.n += 1;
    if (g.cost_type === 'ortak') e.ortak += 1; else if (g.cost_type === 'personel') e.personel = (e.personel ?? 0) + 1; else e.dogrudan += 1; kategoriToplam.set(g.category_id, e);
  }
  const giderSatirlari = [...kategoriToplam].map(([id, e]) => {
    const k = katMap.get(id);
    const tur = k?.is_payroll || (e.personel ?? 0) > 0 ? 'Personel (Giderler menüsü / Excel)' : k?.is_income_tax ? 'Vergi kaydı (vergi öncesi kârı düşürmez)' : k?.is_management_pay ? 'Yönetime ödenen' : e.ortak >= e.dogrudan ? 'Ortak gider' : 'Doğrudan gider';
    return { ad: k?.name ?? 'Kategori', tur, kayit: e.n, tutar: k2(e.k / 100) };
  }).sort((a, b) => b.tutar - a.tutar);
  if (!(i.excelPersonel > 0) && i.personel > 0) giderSatirlari.push({ ad: 'Personel maliyeti (personel kartlarındaki aylık maliyet)', tur: 'Personel (kart)', kayit: null, tutar: i.personel });
  if (i.yonetimPersonel > 0 && ![...kategoriToplam.keys()].some((id) => katMap.get(id)?.is_management_pay)) giderSatirlari.push({ ad: 'Yönetim personeli maliyeti (personel kartlarındaki maliyet)', tur: 'Yönetim (kart)', kayit: null, tutar: i.yonetimPersonel });
  const giderFarki = k2(gider - giderSatirlari.reduce((t, x) => t + x.tutar, 0));
  if (Math.abs(giderFarki) >= 0.01) giderSatirlari.push({ ad: 'Diğer (firmaya/personele bağlanamayan kalemler)', tur: 'Ortak gider', kayit: null, tutar: giderFarki });
  const vergisizGelir = i.vergisizGelir; const matrah = k2(i.gelir - vergisizGelir - i.personel - i.dogrudan - i.ortakHavuz);
  const dokum = { giderSatirlari, gider, gelir: i.gelir, personel: i.personel, personelKaynak: i.excelPersonel > 0 ? 'excel' : 'kart', dogrudan: i.dogrudan, ortak: i.ortakHavuz, yonetim: i.yonetimPersonel, vergiKaydi: i.kayitliVergi,
    vergiOncesi: i.vergiOncesiKar, vergisizGelir, matrah, vergiOrani: Number(veri.vergiOrani ?? 25), vergi: i.tahminiVergi, vergiSonrasi: i.vergiSonrasiKar };
  return {
    ay: ayBasi, r, dokum,
    kpi: { gelir: i.gelir, tahsilat, tahsilEdilmemis, gider, personel: i.personel, excelPersonel: i.excelPersonel, vergiGider: i.kayitliVergi, dogrudan: i.dogrudan, ortak: i.ortakHavuz, vergiOncesi: i.vergiOncesiKar, vergi: i.tahminiVergi, vergiSonrasi: i.vergiSonrasiKar,
      hizmetCalisan, kisiGelir, siniflanamayanGelir: k2(siniflanamayanGelir), aktifFirma: aktifFirmalar.length, uzman, hekim, teorikDk: uzmanDk + hekimDk, uzmanDk, hekimDk, fiiliDk, dkGelir: fiiliDk > 0 ? k2(i.gelir / fiiliDk) : null, dkMaliyet: fiiliDk > 0 ? k2(gider / fiiliDk) : null },
    dikkat: { atanmamisGelir, dagitilmayanOrtak: i.ortakDagitilmayan, bosta: i.bosta },
    sinifGelir,
    tumFirmalar: [...firmalar].sort((a, b) => b.kar - a.kar).map((f) => ({ id: f.id, ad: f.ad, kar: f.kar })),
    enKarli: [...firmalar].sort((a, b) => b.kar - a.kar).slice(0, 5).map((f) => ({ id: f.id, ad: f.ad, kar: f.kar })),
    enDusuk: [...firmalar].sort((a, b) => a.kar - b.kar).slice(0, 5).map((f) => ({ id: f.id, ad: f.ad, kar: f.kar })),
    kapasite: r.personel.map((p) => ({ id: p.id, ad: p.ad, kapasite: p.kapasite, teorikDk: p.teorikDk, fiiliDk: p.fiiliDk, teorikOran: p.kapasite > 0 ? p.teorikDk / p.kapasite : null, fiiliOran: p.kapasite > 0 ? p.fiiliDk / p.kapasite : null }))
      .sort((a, b) => (b.teorikOran ?? -1) - (a.teorikOran ?? -1)),
    tehlike: ['az_tehlikeli', 'tehlikeli', 'cok_tehlikeli'].map((s) => tehlike[s]).filter(Boolean),
  };
}

/** Son n ay için gelir, gider ve kâr serisi. Aylık toplamlar görevlendirmeden bağımsız olduğundan zaman/atama verisi gerekmez. */
export function aylikSeri({ veri, n = 12, yontem = 'teorik' }) {
  return sonAylar(veri.ay, n).map((ay) => {
    const r = hesaplaKarlilik({ ...veri, ay, atamalar: [], zaman: [], kayitliDagitim: [], yontem });
    const i = r.isletme;
    return { ay, gelir: i.gelir, gider: k2(i.toplamGider), vergiOncesi: i.vergiOncesiKar, vergiSonrasi: i.vergiSonrasiKar };
  });
}

/**
 * Aylık hizmet verilen personel (çalışan) sayısı: o ayda sözleşmesi geçerli müşteri firmaların, o ayki profildeki çalışan sayıları.
 * Dönen: { aylar, toplam:[n], firmalar:[{ id, ad, degerler:[n] }] } (bağlı firmalar ana firmada toplanır).
 */
export function personelSeri({ firmalar, profiller, sozlesmeler, aylar, katip = [] }) {
  const anaMap = anaFirmaHaritasi(firmalar); const anaOf = (id) => anaMap.get(id) ?? id;
  const harita = profilleriGrupla(profiller, firmalar);
  const musteri = firmalar.filter((f) => !f.archived_at && (f.customer_status ?? 'musteri') === 'musteri' && !f.parent_company_id);
  const SIN = ['cok_tehlikeli', 'tehlikeli', 'az_tehlikeli'];
  const satirlar = musteri.map((f) => ({ id: f.id, ad: f.name, degerler: [], siniflar: Object.fromEntries(SIN.map((x) => [x, []])) }));
  const toplam = []; const toplamSinif = Object.fromEntries(SIN.map((x) => [x, []]));
  for (const a of aylar) {
    const ay = ay7(a); const bas = `${ay}-01`;
    const soz = new Set(sozlesmeler.filter((c) => !c.archived_at && ['aktif', 'yenilendi', 'sona_erdi'].includes(c.status) && ay7(c.start_date) <= ay && ay7(c.end_date) >= ay).map((c) => anaOf(c.company_id)));
    let t = 0; const ts = Object.fromEntries(SIN.map((x) => [x, 0]));
    const kay = katipAyHaritasi(katip, firmalar, bas);   // İSG-Katip aktarımı varsa o ayın (yoksa önceki en son aktarımın) verisi
    for (const s of satirlar) {
      let n = 0; const sn = Object.fromEntries(SIN.map((x) => [x, 0]));
      if (kay) {
        for (const x of kay.get(s.id) ?? []) { n += x.calisan; if (x.sinif in sn) sn[x.sinif] += x.calisan; }
      } else if (soz.has(s.id)) {
        const p = (harita.get(s.id) ?? []).find((x) => x.valid_from <= ayBitisi(bas) && (!x.valid_to || x.valid_to >= bas));
        n = Number(p?.employee_count) || 0;
        const parcalar = Array.isArray(p?.site_breakdown) && p.site_breakdown.length > 1 ? p.site_breakdown.map((d) => ({ sinif: d.tehlike, calisan: Number(d.calisan) || 0 })) : (p ? [{ sinif: p.hazard_class, calisan: n }] : []);
        for (const x of parcalar) if (x.sinif in sn) sn[x.sinif] += x.calisan;
      }
      s.degerler.push(n); t += n;
      for (const x of SIN) { s.siniflar[x].push(sn[x]); ts[x] += sn[x]; }
    }
    toplam.push(t); for (const x of SIN) toplamSinif[x].push(ts[x]);
  }
  return { aylar, toplam, siniflar: toplamSinif, firmalar: satirlar.filter((s) => s.degerler.some((n) => n > 0)).sort((x, y) => x.ad.localeCompare(y.ad, 'tr')) };
}
