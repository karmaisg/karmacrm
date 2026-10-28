// OSGB 360 - Aylık firma ve personel kârlılığı. Saf fonksiyon (arayüzden bağımsız test edilir).
//
// YÖNETİM AMAÇLI tahmindir; muhasebe, vergi beyanı veya mevzuat hesabı yerine geçmez.
//
// Ay bazında hesap (ay = 'YYYY-MM-01'):
//  Gelir          : o aya ait (hizmet dönemi, yoksa fatura tarihi) faturaların KDV HARİÇ tutarı
//  Personel maliyeti: personelin ayın 1'inde geçerli aylık maliyeti (+ personele bağlı doğrudan giderler)
//     "teorik"  : firmaya düşen teorik dakika x (maliyet / kapasite); kullanılmayan kapasite "boşta maliyet" olur
//     "fiili"   : firmada fiilen harcanan hizmet dakikası oranında; kayıt yoksa maliyetin tamamı "boşta" kalır
//  Doğrudan gider : firmaya bağlı doğrudan giderler
//  Ortak gider    : kategori havuzu, kategorinin dağıtım ölçütüne göre firmalara bölünür (toplamı aşmaz)
//  Çift sayım yok : maaş kategorisindeki giderler dahil edilmez (maliyet personel kartından gelir),
//                   kurumlar vergisi kategorisi gider sayılmaz (vergi tahmininde ayrıca ele alınır).
import { gecerliKayit, enBuyukKalanDagit, vergiSonrasiKar, kurus, tl } from './hesaplama.js';
import { aktifMi, personelAyYuku } from './operasyon.js';
import { profilleriGrupla } from './veri.js';

export const DAGITIM_OLCUTLERI = {
  gelir_orani: 'Gelir oranı', fiili_sure: 'Fiilî hizmet süresi', musteri_sayisi: 'Müşteri sayısı (eşit)',
  personel_sayisi: 'Çalışan sayısı', ziyaret_sayisi: 'Ziyaret sayısı',
};
export const VARSAYILAN_OLCUT = 'gelir_orani';
export const MALIYET_YONTEMLERI = { teorik: 'Kapasiteye göre (teorik süre)', fiili: 'Fiilî çalışma süresine göre' };

const ay7 = (d) => String(d).slice(0, 7);
export const faturaAyi = (f) => ay7(f.service_period ?? f.invoice_date);
const gecerliVeyaNull = (liste, tarih) => { try { return gecerliKayit(liste, tarih); } catch { return null; } };
const topla = (m, k, v) => { m.set(k, (m.get(k) ?? 0) + v); };

/**
 * @returns {{firmalar, personel, ortak, isletme, uyarilar}} tüm tutarlar TL
 */
export function hesaplaKarlilik(g) {
  const {
    ay, firmalar = [], profiller = [], kurallar = [], kapasiteVarsayilan = 11700, atamalar = [], personeller = [], maliyetler = [], zaman = [],
    faturalar = [], giderler = [], kategoriler = [], sozlesmeler = [], dagitimKurallari = [], kayitliDagitim = [],
    yontem = 'teorik', uzmanGelirPayi = 50, vergiOrani = 25,
  } = g;
  const ayAnahtar = ay7(ay);
  const uyarilar = [];
  const firmaAdi = new Map(firmalar.map((f) => [f.id, f.name]));
  const profilHaritasi = profilleriGrupla(profiller);
  const katMap = new Map(kategoriler.map((k) => [k.id, k]));

  // ---- gelir
  const gelir = new Map(); const faturaAdet = new Map();
  for (const f of faturalar) {
    if (f.archived_at || faturaAyi(f) !== ayAnahtar) continue;
    topla(gelir, f.company_id, kurus(f.amount_excl_vat)); topla(faturaAdet, f.company_id, 1);
  }

  // ---- zaman kayıtları (hizmet = saha + rapor)
  const fiiliKisiFirma = new Map(); const fiiliFirma = new Map(); const ziyaret = new Map(); const fiiliKisi = new Map();
  for (const z of zaman) {
    if (z.archived_at || ay7(z.work_date) !== ayAnahtar || !z.company_id) continue;
    const dk = Number(z.onsite_minutes ?? 0) + Number(z.reporting_minutes ?? 0);
    topla(fiiliKisiFirma, `${z.employee_id}|${z.company_id}`, dk); topla(fiiliFirma, z.company_id, dk); topla(fiiliKisi, z.employee_id, dk);
    if (z.activity_type === 'ziyaret') topla(ziyaret, z.company_id, 1);
  }

  // ---- giderlerin sınıflandırılması
  const havuz = new Map(); const dogrudanFirma = new Map(); const dogrudanKisi = new Map();
  let vergiK = 0; let maasAtlanan = 0;
  for (const x of giderler) {
    if (x.archived_at || ay7(x.expense_date) !== ayAnahtar) continue;
    const kat = katMap.get(x.category_id); const k = kurus(x.amount_excl_vat);
    if (kat?.is_payroll) { maasAtlanan += 1; continue; }
    if (kat?.is_income_tax) { vergiK += k; continue; }
    if (x.cost_type === 'ortak') topla(havuz, x.category_id, k);
    else if (x.company_id) topla(dogrudanFirma, x.company_id, k);
    else if (x.employee_id) topla(dogrudanKisi, x.employee_id, k);
    else uyarilar.push('Bir doğrudan gider firmaya veya personele bağlı değil; hesaba katılmadı.');
  }
  if (maasAtlanan) uyarilar.push(`Maaş kategorisindeki ${maasAtlanan} gider kaydı hesaba katılmadı: personel maliyeti personel kartındaki maliyet dönemlerinden alınır (çift sayımı önlemek için).`);

  // ---- personel maliyeti dağıtımı
  const firmaPersonelK = new Map(); const personel = [];
  for (const e of personeller) {
    const atamaVar = atamalar.some((a) => a.employee_id === e.id && aktifMi(a, ayAnahtar + '-01'));
    const kayitVar = [...fiiliKisiFirma.keys()].some((k) => k.startsWith(`${e.id}|`));
    const maliyetKaydi = gecerliVeyaNull(maliyetler.filter((c) => c.employee_id === e.id), `${ayAnahtar}-01`);
    const dogrudanK = dogrudanKisi.get(e.id) ?? 0;
    if ((e.archived_at || e.is_active === false) && !maliyetKaydi && !atamaVar && !kayitVar && !dogrudanK) continue;
    if (!maliyetKaydi && (atamaVar || kayitVar)) uyarilar.push(`${e.full_name} için ${ayAnahtar} döneminde geçerli maliyet kaydı yok; maliyeti 0 sayıldı.`);
    const maliyetK = maliyetKaydi ? kurus(maliyetKaydi.total_monthly_cost ?? Number(maliyetKaydi.gross_salary) + Number(maliyetKaydi.employer_sgk) + Number(maliyetKaydi.other_benefits)) : 0;
    const toplamK = maliyetK + dogrudanK;
    const kapasite = Number(e.monthly_capacity_min) > 0 ? Number(e.monthly_capacity_min) : kapasiteVarsayilan;

    let kalemler = []; let teorikDk = 0; let eksik = false;
    const yuk = personelAyYuku({ atamalar, employeeId: e.id, profilHaritasi, kurallar, ay: `${ayAnahtar}-01` });
    for (const k of yuk.kalemler) {
      if (k.dakika === null) { eksik = true; uyarilar.push(`${e.full_name} / ${firmaAdi.get(k.atama.company_id) ?? 'firma'}: teorik süre hesaplanamadı (${k.eksik}).`); continue; }
      kalemler.push({ companyId: k.atama.company_id, dakika: k.dakika }); teorikDk += k.dakika;
    }
    const fiiliDk = fiiliKisi.get(e.id) ?? 0;
    let agirliklar; let bostaAgirlik;
    if (yontem === 'fiili') {
      kalemler = [...fiiliKisiFirma.entries()].filter(([k, v]) => k.startsWith(`${e.id}|`) && v > 0).map(([k, v]) => ({ companyId: k.split('|')[1], dakika: v }));
      agirliklar = kalemler.map((k) => k.dakika); bostaAgirlik = 0;
    } else {
      agirliklar = kalemler.map((k) => k.dakika); bostaAgirlik = Math.max(0, kapasite - teorikDk);
    }
    const toplamAgirlik = agirliklar.reduce((t, x) => t + x, 0) + bostaAgirlik;
    let parcalar; let bostaK;
    if (toplamAgirlik <= 0) { parcalar = agirliklar.map(() => 0); bostaK = toplamK; }
    else { const p = enBuyukKalanDagit(toplamK, [...agirliklar, bostaAgirlik]); bostaK = p.pop(); parcalar = p; }
    const firmaPay = kalemler.map((k, i) => ({ companyId: k.companyId, dakika: k.dakika, maliyetK: parcalar[i] }));
    for (const fp of firmaPay) topla(firmaPersonelK, fp.companyId, fp.maliyetK);
    personel.push({ id: e.id, ad: e.full_name, tur: e.staff_type, maliyetK, dogrudanK, toplamK, kapasite, teorikDk, fiiliDk, doluluk: kapasite > 0 ? teorikDk / kapasite : null, firmaPay, bostaK, eksik, gelirPayiK: 0, gelirKalemleri: [] });
  }

  // ---- personel gelir payı (görevlendirme esaslı; yaklaşık)
  const personelMap = new Map(personel.map((p) => [p.id, p]));
  const ayBasi = `${ayAnahtar}-01`;
  for (const [firmaId, gelirK] of gelir) {
    if (!(gelirK > 0)) continue;
    const aktifler = atamalar.filter((a) => a.company_id === firmaId && aktifMi(a, ayBasi) && personelMap.has(a.employee_id));
    const turler = [...new Set(aktifler.map((a) => a.staff_type))];
    if (!turler.length) continue;
    const uzmanAgirlik = turler.length === 2 ? uzmanGelirPayi / 100 : 1;
    for (const a of aktifler) {
      const turAgirlik = turler.length === 1 ? 1 : (a.staff_type === 'is_guvenligi_uzmani' ? uzmanAgirlik : 1 - uzmanAgirlik);
      const pay = Math.round((gelirK * turAgirlik * Number(a.share_pct)) / 100);
      const p = personelMap.get(a.employee_id);
      p.gelirPayiK += pay; p.gelirKalemleri.push({ companyId: firmaId, gelirK: pay });
    }
  }

  // ---- ortak gider dağıtımı
  const adaylar = new Set();
  for (const f of firmalar) {
    if (f.archived_at) continue;
    const sozlesmeli = sozlesmeler.some((c) => c.company_id === f.id && !c.archived_at && ['aktif', 'yenilendi', 'sona_erdi'].includes(c.status)
      && ay7(c.start_date) <= ayAnahtar && ay7(c.end_date) >= ayAnahtar);
    if ((gelir.get(f.id) ?? 0) > 0 || sozlesmeli) adaylar.add(f.id);
  }
  const olcutAgirligi = (olcut, id) => {
    if (olcut === 'gelir_orani') return gelir.get(id) ?? 0;
    if (olcut === 'musteri_sayisi') return 1;
    if (olcut === 'fiili_sure') return fiiliFirma.get(id) ?? 0;
    if (olcut === 'ziyaret_sayisi') return ziyaret.get(id) ?? 0;
    if (olcut === 'personel_sayisi') return gecerliVeyaNull(profilHaritasi.get(id) ?? [], ayBasi)?.employee_count ?? 0;
    return 0;
  };
  const ortak = []; const firmaOrtakK = new Map();
  for (const [katId, havuzK] of havuz) {
    const kat = katMap.get(katId);
    const kural = gecerliVeyaNull(dagitimKurallari.filter((r) => r.category_id === katId), ayBasi);
    const olcut = DAGITIM_OLCUTLERI[kural?.basis] ? kural.basis : VARSAYILAN_OLCUT;
    if (kural && !DAGITIM_OLCUTLERI[kural.basis]) uyarilar.push(`${kat?.name ?? 'Kategori'}: "${kural.basis}" ölçütü henüz hesaplanamıyor; gelir oranı kullanıldı.`);
    const kayitli = kayitliDagitim.filter((r) => !r.archived_at && r.category_id === katId && ay7(r.period) === ayAnahtar && r.company_id);
    const dagitim = new Map(); let dagitilmayanK; let kaydedilmis = false;
    if (kayitli.length) {
      kaydedilmis = true;
      for (const r of kayitli) topla(dagitim, r.company_id, kurus(r.amount));
      dagitilmayanK = havuzK - [...dagitim.values()].reduce((t, x) => t + x, 0);
    } else {
      const ids = [...adaylar];
      const w = ids.map((id) => olcutAgirligi(olcut, id));
      if (w.reduce((t, x) => t + x, 0) > 0) {
        const p = enBuyukKalanDagit(havuzK, w); ids.forEach((id, i) => { if (p[i]) dagitim.set(id, p[i]); }); dagitilmayanK = 0;
      } else { dagitilmayanK = havuzK; uyarilar.push(`${kat?.name ?? 'Kategori'}: dağıtım ölçütüne (${DAGITIM_OLCUTLERI[olcut]}) göre dağıtılacak firma bulunamadı; tutar dağıtılmadı.`); }
    }
    for (const [id, v] of dagitim) topla(firmaOrtakK, id, v);
    ortak.push({ kategoriId: katId, ad: kat?.name ?? 'Kategori', olcut, kaydedilmis, havuzK, dagitimK: Object.fromEntries(dagitim), dagitilmayanK });
  }

  // ---- firma satırları
  const idler = new Set([...gelir.keys(), ...firmaPersonelK.keys(), ...dogrudanFirma.keys(), ...firmaOrtakK.keys(), ...adaylar]);
  const firmaSatirlari = [...idler].map((id) => {
    const gK = gelir.get(id) ?? 0; const pK = firmaPersonelK.get(id) ?? 0; const dK = dogrudanFirma.get(id) ?? 0; const oK = firmaOrtakK.get(id) ?? 0;
    const katkiK = gK - pK - dK; const karK = katkiK - oK;
    return { id, ad: firmaAdi.get(id) ?? 'Firma', faturaAdet: faturaAdet.get(id) ?? 0, gelir: tl(gK), personel: tl(pK), dogrudan: tl(dK), katki: tl(katkiK), ortak: tl(oK), kar: tl(karK), marj: gK > 0 ? Math.round((karK / gK) * 1000) / 10 : null, _k: { gK, pK, dK, oK, karK } };
  }).sort((a, b) => b.kar - a.kar || String(a.ad).localeCompare(String(b.ad), 'tr'));

  // ---- işletme toplamı
  const gelirToplamK = [...gelir.values()].reduce((t, x) => t + x, 0);
  const personelToplamK = personel.reduce((t, p) => t + p.toplamK, 0);
  const bostaK = personel.reduce((t, p) => t + p.bostaK, 0);
  const dogrudanToplamK = [...dogrudanFirma.values()].reduce((t, x) => t + x, 0);
  const ortakHavuzK = [...havuz.values()].reduce((t, x) => t + x, 0);
  const ortakDagitilanK = ortak.reduce((t, o) => t + Object.values(o.dagitimK).reduce((a, b) => a + b, 0), 0);
  const vergiOncesiK = gelirToplamK - personelToplamK - dogrudanToplamK - ortakHavuzK;
  const vergi = vergiSonrasiKar({ gelir: tl(gelirToplamK), giderler: tl(personelToplamK + dogrudanToplamK + ortakHavuzK + vergiK), kurumlarVergisiOrani: vergiOrani, kayitliKurumlarVergisi: tl(vergiK) });

  if (!gelirToplamK && !personelToplamK) uyarilar.push('Seçilen ay için gelir veya personel maliyeti verisi yok.');
  return {
    firmalar: firmaSatirlari,
    personel: personel.map((p) => ({ ...p, maliyet: tl(p.maliyetK), dogrudan: tl(p.dogrudanK), toplam: tl(p.toplamK), bosta: tl(p.bostaK), gelirPayi: tl(p.gelirPayiK), katki: tl(p.gelirPayiK - p.toplamK),
      marj: p.gelirPayiK > 0 ? Math.round(((p.gelirPayiK - p.toplamK) / p.gelirPayiK) * 1000) / 10 : null,
      firmaPay: p.firmaPay.map((f) => ({ ...f, maliyet: tl(f.maliyetK), ad: firmaAdi.get(f.companyId) ?? 'Firma' })),
      gelirKalemleri: p.gelirKalemleri.map((f) => ({ ...f, gelir: tl(f.gelirK), ad: firmaAdi.get(f.companyId) ?? 'Firma' })) }))
      .sort((a, b) => b.katki - a.katki || String(a.ad).localeCompare(String(b.ad), 'tr')),
    ortak: ortak.map((o) => ({ ...o, havuz: tl(o.havuzK), dagitilmayan: tl(o.dagitilmayanK), dagitim: Object.fromEntries(Object.entries(o.dagitimK).map(([k, v]) => [k, tl(v)])) })),
    isletme: { gelir: tl(gelirToplamK), personel: tl(personelToplamK), personelFirmalara: tl(personelToplamK - bostaK), bosta: tl(bostaK), dogrudan: tl(dogrudanToplamK), ortakHavuz: tl(ortakHavuzK),
      ortakDagitilan: tl(ortakDagitilanK), ortakDagitilmayan: tl(ortakHavuzK - ortakDagitilanK), vergiOncesiKar: tl(vergiOncesiK), tahminiVergi: vergi.tahminiVergi, vergiSonrasiKar: vergi.vergiSonrasiKar,
      kayitliVergi: tl(vergiK), marj: gelirToplamK > 0 ? Math.round((vergiOncesiK / gelirToplamK) * 1000) / 10 : null },
    uyarilar: [...new Set(uyarilar)],
  };
}

/** Kaydedilecek dağıtım satırları: kategori için {company_id, amount}. Toplam havuzu aşmaz. */
export function dagitimSatirlari(ortakKalem) {
  return Object.entries(ortakKalem.dagitim).filter(([, v]) => v > 0).map(([company_id, amount]) => ({ company_id, amount }));
}
