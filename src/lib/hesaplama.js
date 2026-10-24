// OSGB 360 - Hesaplama motoru (saf fonksiyonlar, tarayıcıda ve Node'da çalışır)
//
// Bu dosya yalnızca YÖNETİM AMAÇLI tahminler üretir. Resmî muhasebe, vergi beyanı veya
// mevzuat hesabı yerine geçmez. Hizmet süresi parametreleri kullanıcının girdiği
// parametrelerdir; güncel mevzuata uygunluğu ayrıca doğrulanmalıdır.
//
// Tüm para hesapları kuruş (tam sayı) üzerinden yapılır; kayan nokta hatası birikmez.

export const VARSAYILAN_KAPASITE_DAKIKA = 11700;
export const VARSAYILAN_KURUMLAR_VERGISI_ORANI = 25; // yüzde

export const TEHLIKE_SINIFLARI = ['az_tehlikeli', 'tehlikeli', 'cok_tehlikeli'];
export const PERSONEL_TURLERI = ['is_guvenligi_uzmani', 'isyeri_hekimi'];

// ---------------------------------------------------------------- para yardımcıları
export const kurus = (tl) => Math.round((Number(tl) + Number.EPSILON) * 100);
export const tl = (k) => k / 100;
export const yuvarla2 = (x) => Math.round((Number(x) + Number.EPSILON) * 100) / 100;

// ---------------------------------------------------------------- tarih yardımcıları
const gunDizgesi = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10));

/** 'YYYY-MM-DD' karşılaştırması (ISO dizgeleri alfabetik sıralanır). */
export function tarihAraliginda(tarih, baslangic, bitis) {
  const t = gunDizgesi(tarih);
  return t >= gunDizgesi(baslangic) && (bitis == null || t <= gunDizgesi(bitis));
}

/** Verilen tarihte geçerli kaydı döndürür (valid_from / valid_to alanlarına göre). */
export function gecerliKayit(kayitlar, tarih) {
  const bulunan = kayitlar.filter((k) => tarihAraliginda(tarih, k.valid_from, k.valid_to ?? null));
  if (bulunan.length > 1) {
    throw new Error('Aynı tarihte birden fazla geçerli kayıt var (dönemler çakışıyor).');
  }
  return bulunan[0] ?? null;
}

// ---------------------------------------------------------------- 1) teorik hizmet süresi
/**
 * Teorik dakika = çalışan sayısı × (personel türü, tehlike sınıfı) için tanımlı dakika.
 * @param kurallar service_time_rules satırları: {staff_type, hazard_class, minutes_per_employee, valid_from, valid_to}
 */
export function teorikDakika({ calisanSayisi, tehlikeSinifi, personelTuru, kurallar, tarih }) {
  if (!Number.isFinite(calisanSayisi) || calisanSayisi < 0) throw new Error('Çalışan sayısı geçersiz.');
  const uygun = kurallar.filter((k) => k.staff_type === personelTuru && k.hazard_class === tehlikeSinifi);
  const kural = gecerliKayit(uygun, tarih);
  if (!kural) {
    return { dakika: null, eksik: `${personelTuru} / ${tehlikeSinifi} için ${gunDizgesi(tarih)} tarihinde geçerli süre kuralı yok.` };
  }
  return { dakika: calisanSayisi * Number(kural.minutes_per_employee), eksik: null };
}

/**
 * Firmanın belirli bir AY için toplam hizmet ihtiyacı.
 * Ayın 1'inde geçerli firma profili (çalışan sayısı + tehlike sınıfı) kullanılır; böylece sonraki
 * aylardaki değişiklikler geçmiş ayları etkilemez. (Ay ortasında değişim: bir sonraki ay yansır.)
 * Bu değer firmanın TOPLAM ihtiyacıdır; kişilere dağıtım ayrıca yapılır (dagitPaylar).
 */
export function firmaAylikIhtiyac({ profiller, kurallar, ay }) {
  const ayBasi = gunDizgesi(ay).slice(0, 7) + '-01';
  const profil = gecerliKayit(profiller, ayBasi);
  if (!profil) return { uzmanDakika: null, hekimDakika: null, profil: null, eksik: `${ayBasi} için firma profili yok.` };
  const girdi = { calisanSayisi: profil.employee_count, tehlikeSinifi: profil.hazard_class, kurallar, tarih: ayBasi };
  const uzman = teorikDakika({ ...girdi, personelTuru: 'is_guvenligi_uzmani' });
  const hekim = teorikDakika({ ...girdi, personelTuru: 'isyeri_hekimi' });
  return {
    uzmanDakika: uzman.dakika,
    hekimDakika: hekim.dakika,
    profil,
    eksik: [uzman.eksik, hekim.eksik].filter(Boolean).join(' ') || null,
  };
}

/**
 * Firma toplam ihtiyacını atanmış kişilere paylarına göre böler.
 * Paylar toplamı %100'ü aşamaz; toplam asla ihtiyacın üstüne çıkmaz (mükerrer süre yok).
 * Atanmamış kısım "atanmamisDakika" olarak ayrıca gösterilir.
 */
export function dagitPaylar(toplamDakika, atamalar) {
  const payToplami = atamalar.reduce((t, a) => t + Number(a.share_pct), 0);
  if (payToplami > 100 + 1e-9) throw new Error(`Hizmet payları toplamı %100'ü aşıyor (%${payToplami}).`);
  // pay yüzdesi -> binde bir hassasiyet için tam sayı; kalan en büyük kalan yöntemiyle dağıtılır
  const agirliklar = atamalar.map((a) => Math.round(Number(a.share_pct) * 100)); // 60% -> 6000
  const dagitilacak = Math.round((toplamDakika * payToplami) / 100);
  const parcalar = enBuyukKalanDagit(dagitilacak, agirliklar);
  return {
    kisiler: atamalar.map((a, i) => ({ ...a, dakika: parcalar[i] })),
    atanmisDakika: parcalar.reduce((t, x) => t + x, 0),
    atanmamisDakika: toplamDakika - parcalar.reduce((t, x) => t + x, 0),
  };
}

// ---------------------------------------------------------------- 2) dakika maliyeti
export function teorikDakikaMaliyeti(aylikPersonelMaliyeti, kapasiteDakika = VARSAYILAN_KAPASITE_DAKIKA) {
  if (!(kapasiteDakika > 0)) return null;
  return aylikPersonelMaliyeti / kapasiteDakika;
}

/** Fiilî hizmet dakikası 0 ise hata vermez; null döner (arayüz "veri yok" gösterir). */
export function fiiliDakikaMaliyeti(aylikPersonelMaliyeti, fiiliHizmetDakikasi) {
  if (!(fiiliHizmetDakikasi > 0)) return null;
  return aylikPersonelMaliyeti / fiiliHizmetDakikasi;
}

export function kapasiteKullanimi(dakika, kapasiteDakika = VARSAYILAN_KAPASITE_DAKIKA) {
  if (!(kapasiteDakika > 0)) return null;
  return dakika / kapasiteDakika; // 1.0 = %100
}

// ---------------------------------------------------------------- 3) toplamı aşmayan dağıtım
/**
 * Bir tutarı (kuruş cinsinden TAM SAYI) ağırlıklara göre böler; parçaların toplamı tam olarak
 * `toplam`a eşit olur (en büyük kalan yöntemi). Toplam asla aşılmaz.
 */
export function enBuyukKalanDagit(toplamKurus, agirliklar) {
  if (!Number.isInteger(toplamKurus)) throw new Error('Toplam tam sayı (kuruş) olmalı.');
  const agirlikToplami = agirliklar.reduce((t, a) => t + a, 0);
  if (agirliklar.length === 0 || agirlikToplami <= 0) return agirliklar.map(() => 0);
  const hamlar = agirliklar.map((a) => (toplamKurus * a) / agirlikToplami);
  const tabanlar = hamlar.map(Math.floor);
  let kalan = toplamKurus - tabanlar.reduce((t, x) => t + x, 0);
  const sira = hamlar
    .map((h, i) => ({ i, artik: h - Math.floor(h) }))
    .sort((a, b) => b.artik - a.artik || a.i - b.i);
  for (let k = 0; k < kalan; k++) tabanlar[sira[k].i] += 1;
  return tabanlar;
}

/** Personel maliyetini (TL) müşterilere ağırlıklarına göre dağıtır; toplam = personel maliyeti. */
export function personelMaliyetiniDagit(aylikMaliyetTl, musteriAgirliklari) {
  const parcalar = enBuyukKalanDagit(kurus(aylikMaliyetTl), musteriAgirliklari.map((m) => m.agirlik));
  return musteriAgirliklari.map((m, i) => ({ ...m, maliyet: tl(parcalar[i]) }));
}

// ---------------------------------------------------------------- 4) KDV
/** Tutar + KDV modu + oran -> {haric, kdv, dahil} (TL). Modlar karıştırılmaz. */
export function kdvAyir(tutar, mod, oranYuzde) {
  const t = kurus(tutar);
  const oran = Number(oranYuzde);
  if (mod === 'kdv_dahil') {
    const haric = Math.round((t * 100) / (100 + oran));
    return { haric: tl(haric), kdv: tl(t - haric), dahil: tl(t) };
  }
  if (mod === 'kdv_haric') {
    const kdv = Math.round((t * oran) / 100);
    return { haric: tl(t), kdv: tl(kdv), dahil: tl(t + kdv) };
  }
  throw new Error(`Bilinmeyen KDV modu: ${mod}`);
}

// ---------------------------------------------------------------- 5) fatura ve tahsilat
export function faturaBakiyesi(fatura, tahsilatlar, bugun = new Date()) {
  const dahil = kurus(fatura.amount_incl_vat ?? Number(fatura.amount_excl_vat) + Number(fatura.vat_amount));
  const tahsil = tahsilatlar.reduce((t, p) => t + kurus(p.amount), 0);
  const kalan = dahil - tahsil;
  const gecikme = Math.max(0, Math.floor((Date.parse(gunDizgesi(bugun)) - Date.parse(gunDizgesi(fatura.due_date))) / 86400000));
  let durum;
  if (fatura.flag === 'itirazli' || fatura.flag === 'takip_gerekiyor') durum = fatura.flag;
  else if (tahsil >= dahil) durum = 'tahsil_edildi';
  else if (tahsil > 0) durum = 'kismi_tahsilat';
  else durum = 'tahsil_edilmedi';
  return {
    faturaTutari: tl(dahil),
    tahsilEdilen: tl(tahsil),
    kalan: tl(kalan),
    fazlaTahsilat: tahsil > dahil, // uyarı için (engellemez)
    fazlaTutar: tahsil > dahil ? tl(tahsil - dahil) : 0,
    durum,
    gecikmeGunu: kalan > 0 ? gecikme : 0,
  };
}

// ---------------------------------------------------------------- 6) giderler
/**
 * Giderleri doğrudan / ortak olarak ayırır. Ortak havuz YALNIZCA 'ortak' giderlerden oluşur;
 * doğrudan giderler ayrıca firma/personele yazılır ve havuza girmez (çift sayım yok).
 * Tutarlar KDV HARİÇ alınır (KDV gider/gelir değildir).
 */
export function giderleriAyir(giderler) {
  const dogrudan = giderler.filter((g) => g.cost_type === 'dogrudan');
  const ortak = giderler.filter((g) => g.cost_type === 'ortak');
  const topla = (liste) => liste.reduce((t, g) => t + kurus(g.amount_excl_vat), 0);
  const firmaBazli = {};
  for (const g of dogrudan) {
    if (!g.company_id) continue;
    firmaBazli[g.company_id] = (firmaBazli[g.company_id] ?? 0) + kurus(g.amount_excl_vat);
  }
  return {
    dogrudanToplam: tl(topla(dogrudan)),
    ortakHavuz: tl(topla(ortak)),
    toplamGider: tl(topla(dogrudan) + topla(ortak)),
    firmaBazliDogrudan: Object.fromEntries(Object.entries(firmaBazli).map(([k, v]) => [k, tl(v)])),
  };
}

/** Ortak gider havuzunu ağırlıklarına göre firmalara dağıtır; dağıtılmamış tutarı ayrıca verir. */
export function ortakGiderDagit(havuzTl, firmaAgirliklari) {
  const havuz = kurus(havuzTl);
  const agirlikToplami = firmaAgirliklari.reduce((t, f) => t + f.agirlik, 0);
  if (agirlikToplami <= 0) return { dagitim: firmaAgirliklari.map((f) => ({ ...f, tutar: 0 })), dagitilmamis: tl(havuz) };
  const parcalar = enBuyukKalanDagit(havuz, firmaAgirliklari.map((f) => f.agirlik));
  return {
    dagitim: firmaAgirliklari.map((f, i) => ({ ...f, tutar: tl(parcalar[i]) })),
    dagitilmamis: tl(havuz - parcalar.reduce((t, x) => t + x, 0)),
  };
}

// ---------------------------------------------------------------- 7) vergi sonrası tahmini kâr
/**
 * Basitleştirilmiş YÖNETİM tahmini. Resmî vergi hesabı değildir.
 *  - Vergi öncesi kâr = gelir − gider (KDV hariç). 'Kurumlar vergisi' kategorisindeki giderler
 *    zaten giderlere yazılmışsa gider toplamından çıkarılır; böylece vergi ikinci kez düşülmez.
 *  - Negatif kârda vergi 0'dır.
 */
export function vergiSonrasiKar({ gelir, giderler, kurumlarVergisiOrani = VARSAYILAN_KURUMLAR_VERGISI_ORANI, kayitliKurumlarVergisi = 0 }) {
  const gelirK = kurus(gelir);
  const giderK = kurus(giderler) - kurus(kayitliKurumlarVergisi); // kayıtlı vergiyi tekrar sayma
  const vergiOncesiK = gelirK - giderK;
  const vergiK = vergiOncesiK > 0 ? Math.round((vergiOncesiK * Number(kurumlarVergisiOrani)) / 100) : 0;
  return {
    vergiOncesiKar: tl(vergiOncesiK),
    tahminiVergi: tl(vergiK),
    vergiSonrasiKar: tl(vergiOncesiK - vergiK),
    not: 'Basitleştirilmiş yönetim tahminidir; vergiye esas kazanç farklı olabilir.',
  };
}

// ---------------------------------------------------------------- 8) teklif kârlılığı
/**
 * Teklif hesabı. Gelir KDV HARİÇ esas alınır; KDV dahil girilen fiyat önce ayrıştırılır.
 * @param g.fiyatlama 'kisi_basi' | 'sabit_aylik'
 * @param g.birimFiyat kişi başı aylık (fiyatlama=kisi_basi)
 * @param g.sabitFiyat aylık sabit (fiyatlama=sabit_aylik)
 */
export function teklifKarliligi(g) {
  const {
    fiyatlama, birimFiyat = 0, sabitFiyat = 0, calisanSayisi = 0,
    kdvModu = 'kdv_haric', kdvOrani = 20, indirimYuzde = 0,
    uzmanMaliyeti = 0, hekimMaliyeti = 0, ulasimDigerMaliyet = 0,
    marjEsigiYuzde = 20,
  } = g;
  const brut = fiyatlama === 'kisi_basi' ? Number(birimFiyat) * calisanSayisi : Number(sabitFiyat);
  const indirimli = yuvarla2(brut * (1 - Number(indirimYuzde) / 100));
  const kdv = kdvAyir(indirimli, kdvModu, kdvOrani);
  const gelir = kdv.haric;
  const maliyet = tl(kurus(uzmanMaliyeti) + kurus(hekimMaliyeti) + kurus(ulasimDigerMaliyet));
  const katki = yuvarla2(gelir - maliyet);
  const marj = gelir > 0 ? katki / gelir : null;
  return {
    aylikGelirKdvHaric: gelir,
    kdvTutari: kdv.kdv,
    aylikToplamKdvDahil: kdv.dahil,
    toplamMaliyet: maliyet,
    katkiKari: katki,
    katkiMarji: marj, // 0.25 = %25; gelir 0 ise null
    esikAltinda: marj !== null && marj * 100 < marjEsigiYuzde,
    uyari: marj !== null && marj * 100 < marjEsigiYuzde
      ? `Katkı kârı marjı (%${(marj * 100).toFixed(1)}) belirlenen eşiğin (%${marjEsigiYuzde}) altında.`
      : null,
  };
}

/** Hedef marjı koruyan aylık KDV HARİÇ gelir. */
export function hedefMarjliGelir(toplamMaliyet, hedefMarjYuzde) {
  if (hedefMarjYuzde >= 100) return null;
  return yuvarla2(toplamMaliyet / (1 - hedefMarjYuzde / 100));
}

/** Mevcut fiyat / %5 indirimli fiyat / hedef marjı koruyan fiyat karşılaştırması. */
export function fiyatSenaryolari(g, { hedefMarjYuzde = g.marjEsigiYuzde ?? 20, ekIndirimYuzde = 5 } = {}) {
  const mevcut = teklifKarliligi(g);
  const indirimli = teklifKarliligi({ ...g, indirimYuzde: 100 - (100 - (g.indirimYuzde ?? 0)) * (1 - ekIndirimYuzde / 100) });
  const hedefGelir = hedefMarjliGelir(mevcut.toplamMaliyet, hedefMarjYuzde);
  return { mevcut, indirimli, hedefMarj: { hedefMarjYuzde, gerekenAylikGelirKdvHaric: hedefGelir } };
}

// ---------------------------------------------------------------- 9) vergi numarası normalizasyonu / mükerrer kontrolü
export const vergiNoTemizle = (v) => String(v ?? '').replace(/\D/g, '');

/**
 * İçe aktarılacak satırlarda mükerrer kontrolü: (a) mevcut kayıtlarla, (b) dosyanın kendi içinde.
 * Anahtar: vergi numarası (varsa); yoksa büyük/küçük harf ve boşluktan bağımsız firma adı.
 */
export function mukerrerleriBul(yeniSatirlar, mevcutKayitlar) {
  const anahtar = (r) => {
    const vn = vergiNoTemizle(r.tax_no);
    return vn ? `vn:${vn}` : `ad:${String(r.name ?? '').toLocaleLowerCase('tr-TR').replace(/\s+/g, ' ').trim()}`;
  };
  const mevcut = new Set(mevcutKayitlar.map(anahtar));
  const gorulen = new Set();
  return yeniSatirlar.map((r, i) => {
    const k = anahtar(r);
    let durum = 'yeni';
    if (mevcut.has(k)) durum = 'mevcut_kayitla_cakisiyor';
    else if (gorulen.has(k)) durum = 'dosya_icinde_tekrar';
    gorulen.add(k);
    return { satir: i + 1, anahtar: k, durum };
  });
}
