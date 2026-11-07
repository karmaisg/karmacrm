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
export function aylikOzet({ veri, tahsilatlar = [], yontem = 'teorik' }) {
  const ay = String(veri.ay).slice(0, 7); const ayBasi = `${ay}-01`; const r = hesaplaKarlilik({ ...veri, yontem });
  const i = r.isletme; const gider = k2(i.personel + i.dogrudan + i.ortakHavuz);

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
  let hizmetCalisan = 0; let siniflanamayanGelir = 0;
  for (const f of musteri) {
    const g = gelirFirma.get(f.id) ?? 0;
    if (!sozlesmeli.has(f.id) && !(g > 0)) continue;
    const profil = (harita.get(f.id) ?? []).find((p) => p.valid_from <= ayBitisi(ayBasi) && (!p.valid_to || p.valid_to >= ayBasi));
    if (!profil || !profil.hazard_class) { siniflanamayanGelir += g; continue; }
    const parcalar = Array.isArray(profil.site_breakdown) && profil.site_breakdown.length > 1
      ? profil.site_breakdown.map((d) => ({ sinif: d.tehlike, calisan: Number(d.calisan) || 0 }))
      : [{ sinif: profil.hazard_class, calisan: Number(profil.employee_count) || 0 }];
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
  return {
    ay: ayBasi, r,
    kpi: { gelir: i.gelir, tahsilat, tahsilEdilmemis, gider, personel: i.personel, dogrudan: i.dogrudan, ortak: i.ortakHavuz, vergiOncesi: i.vergiOncesiKar, vergi: i.tahminiVergi, vergiSonrasi: i.vergiSonrasiKar,
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
    return { ay, gelir: i.gelir, gider: k2(i.personel + i.dogrudan + i.ortakHavuz), vergiOncesi: i.vergiOncesiKar, vergiSonrasi: i.vergiSonrasiKar };
  });
}
