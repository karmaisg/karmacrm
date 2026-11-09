// OSGB 360 - Yıllık bütçe hesapları (saf fonksiyonlar). Tutarlar KDV HARİÇ.
import { faturaAyi } from './karlilik.js';
import { anaFirmaHaritasi } from './veri.js';

export const DURUMLAR = {
  kabul: 'Kabul edildi',
  gorusme_bilgi_yok: 'Görüşme yapıldı – bilgi verilemedi',
  bilgi_verildi: 'Bilgi verildi – dönüş bekleniyor',
  sona_erdi: 'Sözleşme sona erdi',
};
/** Firma ünvanı rengi: kabul → yeşil, sona erdi → kırmızı, diğer görüşme durumları → turuncu. */
export const DURUM_RENGI = { kabul: 'yesil', sona_erdi: 'kirmizi', gorusme_bilgi_yok: 'turuncu', bilgi_verildi: 'turuncu' };
export const FIYAT_TURU = { sabit: 'Sabit fiyat', kisi_basi: 'Kişi başı fiyat' };

const k2 = (x) => Math.round(Number(x) * 100) / 100;
export const sayiMi = (x) => x !== null && x !== undefined && x !== '' && Number.isFinite(Number(x));

/** "1.250,50" veya "1250.5" gibi girişi sayıya çevirir; boş/geçersiz → null. */
export function sayiOku(metin, eksiVar = false) {
  let s = String(metin ?? '').trim().replace(/[₺\s]/g, '');
  if (!s) return null;
  if (s.includes(',') || /^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');   // 1.250,50 ve 2.000 → Türkçe biçim
  const n = Number(s);
  return Number.isFinite(n) && (eksiVar || n >= 0) ? n : null;
}

export const yuzdeFiyata = (birim, yuzde) => (sayiMi(birim) && sayiMi(yuzde) ? k2(Number(birim) * (1 + Number(yuzde) / 100)) : null);
export const fiyatYuzdeye = (birim, fiyat) => (sayiMi(birim) && Number(birim) > 0 && sayiMi(fiyat) ? k2((Number(fiyat) / Number(birim) - 1) * 100) : null);

/**
 * Önceki yılın kesilmiş aylık faturalarından firma başına ortalama aylık gelir.
 * Yalnızca "fatura" türü gelirler (spot ve elden gelirler dışarıda); bağlı firmalar ana firmaya eklenir.
 * Ortalama = toplam (KDV hariç) / fatura kesilen ay sayısı.
 */
export function otomatikOrtalamalar(faturalar, firmalar, yil) {
  const ana = anaFirmaHaritasi(firmalar);
  const toplam = new Map();
  for (const f of faturalar ?? []) {
    if (f.archived_at || (f.income_kind ?? 'fatura') !== 'fatura') continue;
    const ay = faturaAyi(f); if (!ay || ay.slice(0, 4) !== String(yil)) continue;
    const id = ana.get(f.company_id) ?? f.company_id;
    const e = toplam.get(id) ?? { kurus: 0, aylar: new Set() };
    e.kurus += Math.round(Number(f.amount_excl_vat) * 100); e.aylar.add(ay); toplam.set(id, e);
  }
  return new Map([...toplam].map(([id, e]) => [id, { toplam: e.kurus / 100, ay: e.aylar.size, ortalama: e.aylar.size ? k2(e.kurus / 100 / e.aylar.size) : null }]));
}

/** Fiyat türüne göre aylık çarpan: sabit → 1, kişi başı → çalışan sayısı. */
const carpan = (tur, adet) => (tur === 'kisi_basi' ? adet : 1);

/**
 * Tek satırın hesaplanan alanları. satir = budget_lines kaydı (veya boş {}), oto = otomatik ortalama (sayı/null).
 * Fiyat türü gelecek yıl için değişebilir (ör. sabit → kişi başı); artış oranları AYLIK tutarlar üzerinden hesaplanır.
 */
export function satirHesapla(satir = {}, oto = null) {
  const tur = satir.price_type ?? 'sabit';
  const yeniTur = satir.next_price_type ?? tur;
  const adet = sayiMi(satir.employee_count) ? Number(satir.employee_count) : 0;
  const birim = sayiMi(satir.unit_price) ? Number(satir.unit_price) : null;
  const oncekiAylik = birim === null || (tur === 'kisi_basi' && !adet) ? null : k2(birim * carpan(tur, adet));
  const elle = sayiMi(satir.prev_avg_income);
  const ortalama = elle ? Number(satir.prev_avg_income) : (sayiMi(oto) ? Number(oto) : null);
  const kabul = sayiMi(satir.accepted_price) ? Number(satir.accepted_price) : null;
  const yeniCarpan = carpan(yeniTur, adet);
  const kabulAylik = kabul === null || !yeniCarpan ? null : k2(kabul * yeniCarpan);
  const artisOrani = kabulAylik !== null && oncekiAylik !== null && oncekiAylik > 0 ? kabulAylik / oncekiAylik - 1 : null;   // kesir
  const artisTutari = kabulAylik !== null && oncekiAylik !== null ? k2(kabulAylik - oncekiAylik) : null;                      // aylık fark
  const beklenenElle = sayiMi(satir.expected_manual);
  let beklenen = null;
  if (beklenenElle) beklenen = Number(satir.expected_manual);
  else if (satir.status === 'sona_erdi') beklenen = 0;
  else if (ortalama !== null && artisOrani !== null) beklenen = k2(ortalama * (1 + artisOrani));
  return { tur, yeniTur, adet, birim, oncekiAylik, ortalama, elle, kabul, kabulAylik, artisOrani, artisTutari, beklenen, beklenenElle };
}

/** Talep edilen artış yüzdesine karşılık gelen fiyat (gelecek yılın fiyat türünde; aylık tutar üzerinden). */
export function talepFiyati(satir, yuzde) {
  const h = satirHesapla(satir); const c = carpan(h.yeniTur, h.adet);
  if (h.oncekiAylik === null || !c || !sayiMi(yuzde)) return null;
  return k2((h.oncekiAylik * (1 + Number(yuzde) / 100)) / c);
}
/** Talep edilen fiyata karşılık gelen artış yüzdesi. */
export function talepYuzdesi(satir, fiyat) {
  const h = satirHesapla(satir); const c = carpan(h.yeniTur, h.adet);
  if (h.oncekiAylik === null || !(h.oncekiAylik > 0) || !c || !sayiMi(fiyat)) return null;
  return k2((((Number(fiyat) * c) / h.oncekiAylik) - 1) * 100);
}

// ---------------------------------------------------------------- gider tablosu
export const VARSAYILAN_GIDERLER = [
  'Yönetime Ödenen', 'Personel Giderleri', 'SGK Giderleri', 'Stopaj', 'Kurumlar', '3th Party Ödeme', 'Ofis Kirası', 'Araç Masrafları',
  'Elektrik', 'Su', 'Doğal Gaz', 'İnternet / Telefon', 'Kırtasiye Giderleri', 'Ofis Genel Giderler', 'Elektronik',
  'Reklam, Pazarlama, Web', 'Muhasebe Giderleri', 'Yemek&İçme', 'Diğer Giderler', 'KREDİ ÖDEMESİ',
];

/** Bir gider satırının önceki / artış / sonraki değerleri (kendi alanlarından). */
export function giderSatiri(s) {
  const prev = sayiMi(s.prev_avg_expense) ? Number(s.prev_avg_expense) : null;
  let next = sayiMi(s.next_avg_expense) ? Number(s.next_avg_expense) : null;
  if (next === null && prev !== null && sayiMi(s.increase_pct)) next = k2(prev * (1 + Number(s.increase_pct) / 100));
  const pct = sayiMi(s.increase_pct) ? Number(s.increase_pct) : (next !== null && prev !== null && prev > 0 ? k2((next / prev - 1) * 100) : null);
  return { prev, pct, next };
}

/**
 * Tüm gider satırları (bir yılın) → satır başına değerler ve toplamlar.
 * "Personel Giderleri" altında personel varsa kalem, personellerin toplamıdır. Sonraki yıl tutarı boşsa
 * kalem önceki yıl tutarıyla aynı sayılır (artış yok). Ağırlıklı artış = Σ sonraki / Σ önceki − 1.
 */
export function giderlerHesapla(satirlar, personel = null) {
  const cocuk = new Map();
  for (const s of satirlar) if (s.parent_id) cocuk.set(s.parent_id, [...(cocuk.get(s.parent_id) ?? []), s]);
  const etkin = (v) => (v.next ?? v.prev ?? 0);
  const harita = new Map(); let prevK = 0; let nextK = 0;
  for (const s of satirlar.filter((x) => !x.parent_id)) {
    const ch = cocuk.get(s.id) ?? [];
    let v;
    if (ch.length) {
      const cv = ch.map(giderSatiri); for (let i = 0; i < ch.length; i++) harita.set(ch[i].id, cv[i]);
      const prev = cv.some((x) => x.prev !== null) ? k2(cv.reduce((t, x) => t + (x.prev ?? 0), 0)) : null;
      const next = k2(cv.reduce((t, x) => t + etkin(x), 0));
      v = { prev, next: prev === null && !cv.some((x) => x.next !== null) ? null : next, pct: null, toplamli: true };
      v.pct = v.prev > 0 && v.next !== null ? k2((v.next / v.prev - 1) * 100) : null;
    } else if (s.is_personnel && personel && personel.length) {
      const t = personelToplamlari(personel);                       // Personel Gider Tablosu → "Personel Giderleri" kalemi
      v = { prev: t.prevToplam, next: t.nextToplam, pct: t.pct, toplamli: true };
    } else v = { ...giderSatiri(s), toplamli: false };
    harita.set(s.id, v);
    prevK += Math.round((v.prev ?? 0) * 100); nextK += Math.round(etkin(v) * 100);
  }
  return { satirlar: harita, oncekiToplam: prevK / 100, sonrakiToplam: nextK / 100, agirlikliArtis: prevK > 0 ? (nextK / prevK - 1) * 100 : null };
}

// ---------------------------------------------------------------- personel gider tablosu
const nz = (x) => (sayiMi(x) ? Number(x) : null);
/** Tek personelin değerleri. Artış oranı net maaş ve SGK'ya birlikte uygulanır; sonraki yıl tutarı girilmişse o esas alınır. */
export function personelSatiri(p) {
  const prevNet = nz(p.prev_net); const prevSgk = nz(p.prev_sgk); const oran = nz(p.increase_pct);
  const prevToplam = prevNet === null && prevSgk === null ? null : k2((prevNet ?? 0) + (prevSgk ?? 0));
  const turet = (onceki, dogrudan) => (dogrudan !== null ? dogrudan : (onceki !== null && oran !== null ? k2(onceki * (1 + oran / 100)) : null));
  const nextNet = turet(prevNet, nz(p.next_net)); const nextSgk = turet(prevSgk, nz(p.next_sgk));
  const nextToplam = nextNet === null && nextSgk === null ? null : k2((nextNet ?? 0) + (nextSgk ?? 0));
  const pct = oran !== null ? oran : (nextToplam !== null && prevToplam > 0 ? k2((nextToplam / prevToplam - 1) * 100) : null);
  return { prevNet, prevSgk, prevToplam, pct, nextNet, nextSgk, nextToplam };
}
/** Tüm personel toplamı. Sonraki yıl tutarı boş olan personelde önceki yıl tutarı sürer. Artış = Σ sonraki / Σ önceki − 1. */
export function personelToplamlari(liste) {
  let pn = 0; let ps = 0; let nn = 0; let ns = 0;
  for (const x of liste ?? []) {
    const v = personelSatiri(x);
    pn += Math.round((v.prevNet ?? 0) * 100); ps += Math.round((v.prevSgk ?? 0) * 100);
    nn += Math.round((v.nextNet ?? v.prevNet ?? 0) * 100); ns += Math.round((v.nextSgk ?? v.prevSgk ?? 0) * 100);
  }
  const prevToplam = (pn + ps) / 100; const nextToplam = (nn + ns) / 100;
  return { adet: (liste ?? []).length, prevNet: pn / 100, prevSgk: ps / 100, prevToplam, nextNet: nn / 100, nextSgk: ns / 100, nextToplam, pct: prevToplam > 0 ? k2((nextToplam / prevToplam - 1) * 100) : null };
}

// ---------------------------------------------------------------- Giderler kategorileri ↔ bütçe kalemleri
const sade = (m) => ` ${String(m ?? '').toLocaleLowerCase('tr').replace(/ı/g, 'i').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim()} `;
/** Hazır kalemlere karşılık gelen anahtar sözcükler (kategori adında geçerse eşleşir). */
export const ESLEME_ANAHTARLARI = {
  'Yönetime Ödenen': ['yonetim', 'ortak cari', 'ortaklara'], 'SGK Giderleri': ['sgk', 'sigorta prim'], 'Stopaj': ['stopaj'],
  'Kurumlar': ['kurumlar', 'vergi', 'damga'], '3th Party Ödeme': ['3th', 'third party', 'taseron', 'dis hizmet', 'hizmet alim'],
  'Ofis Kirası': ['kira'], 'Araç Masrafları': ['arac', 'yakit', 'akaryakit', 'otopark', 'kasko', 'hgs', 'ogs'],
  'Elektrik': ['elektrik'], 'Su': ['su'], 'Doğal Gaz': ['dogal gaz', 'dogalgaz'], 'İnternet / Telefon': ['internet', 'telefon', 'gsm'],
  'Kırtasiye Giderleri': ['kirtasiye', 'toner'], 'Ofis Genel Giderler': ['ofis', 'temizlik', 'aidat'], 'Elektronik': ['elektronik', 'bilgisayar', 'yazilim', 'donanim'],
  'Reklam, Pazarlama, Web': ['reklam', 'pazarlama', 'web', 'tanitim', 'sosyal medya'], 'Muhasebe Giderleri': ['muhasebe', 'mali musavir'],
  'Yemek&İçme': ['yemek', 'icme', 'mutfak', 'ikram'], 'KREDİ ÖDEMESİ': ['kredi', 'taksit', 'faiz'], 'Diğer Giderler': ['diger'],
};
/**
 * Kategori → kalem önerisi. Önce ad birebir/içerik eşleşmesi, sonra anahtar sözcükler. Personel kalemi ve personel türündeki kategoriler hariçtir.
 * Dönüş: Map(kategoriId → kalemId). Kayıtlı eşleşme (kalem.category_ids) her zaman önceliklidir.
 */
export function kategoriEsle(kalemler, kategoriler) {
  const sonuc = new Map(); const uygun = kalemler.filter((k) => !k.parent_id && !k.is_personnel);
  for (const k of uygun) for (const id of k.category_ids ?? []) if (!sonuc.has(id)) sonuc.set(id, k.id);
  for (const c of kategoriler) {
    if (sonuc.has(c.id) || String(c.default_cost_type ?? '') === 'personel' || c.nature === 'personel' || c.is_payroll) continue;
    const ad = sade(c.name);
    let bulunan = uygun.find((k) => sade(k.name) === ad);
    bulunan ??= uygun.find((k) => k.name === ({ sgk: 'SGK Giderleri', stopaj: 'Stopaj', vergi: 'Kurumlar' })[c.nature]);
    bulunan ??= uygun.find((k) => { const kn = sade(k.name).trim(); return kn.length > 3 && (ad.includes(` ${kn} `) || sade(k.name).includes(ad) && ad.trim().length > 3); });
    bulunan ??= uygun.find((k) => (ESLEME_ANAHTARLARI[k.name] ?? []).some((a) => ad.includes(` ${a} `) || (a.length > 3 && ad.includes(a))));
    if (bulunan) sonuc.set(c.id, bulunan.id);
  }
  return sonuc;
}
/**
 * Önceki yıl aylık ortalama gider: kalemin kategorilerindeki (arşivsiz) harcamaların KDV hariç toplamı ÷ o yıl içinde
 * herhangi bir gider girilmiş ay sayısı (en çok 12). Dönüş: Map(kalemId → { toplam, ay, ortalama }).
 */
export function giderOrtalamalari(harcamalar, yil, kalemKategorileri) {
  const aylar = new Set(); const kategoriToplam = new Map();
  for (const h of harcamalar ?? []) {
    if (h.archived_at || String(h.expense_date ?? '').slice(0, 4) !== String(yil)) continue;
    aylar.add(String(h.expense_date).slice(0, 7));
    kategoriToplam.set(h.category_id, (kategoriToplam.get(h.category_id) ?? 0) + Math.round(Number(h.amount_excl_vat) * 100));
  }
  const ay = Math.min(12, aylar.size); const sonuc = new Map();
  for (const [kalemId, idler] of kalemKategorileri) {
    const kurus = [...new Set(idler)].reduce((t, id) => t + (kategoriToplam.get(id) ?? 0), 0);
    sonuc.set(kalemId, { toplam: kurus / 100, ay, ortalama: ay ? k2(kurus / 100 / ay) : null });
  }
  return sonuc;
}

/** Kâr durumu: gelecek yıl beklenen aylık gelir − gelecek yıl aylık gider (önceki yıl karşılaştırmasıyla). */
export function karDurumu(gelir, gider) {
  const aylikKar = k2(gelir.beklenen - gider.sonrakiToplam);
  const oncekiKar = k2(gelir.ortalama - gider.oncekiToplam);
  return {
    aylikGelir: gelir.beklenen, aylikGider: gider.sonrakiToplam, aylikKar, yillikKar: k2(aylikKar * 12),
    marj: gelir.beklenen > 0 ? aylikKar / gelir.beklenen : null,
    oncekiGelir: gelir.ortalama, oncekiGider: gider.oncekiToplam, oncekiKar,
  };
}

/** Tablo altı toplamları. satirlar: satirHesapla çıktıları. */
export function toplamlar(hesaplar) {
  let oncekiFiyat = 0; let ortalama = 0; let beklenen = 0; let kOnceki = 0; let kBeklenen = 0; let belli = 0; let belirsiz = 0;
  for (const h of hesaplar) {
    if (h.oncekiAylik !== null) oncekiFiyat += Math.round(h.oncekiAylik * 100);
    if (h.ortalama !== null) ortalama += Math.round(h.ortalama * 100);
    if (h.beklenen !== null) beklenen += Math.round(h.beklenen * 100);
    if (h.beklenen !== null && h.ortalama !== null) { kOnceki += Math.round(h.ortalama * 100); kBeklenen += Math.round(h.beklenen * 100); belli += 1; } else belirsiz += 1;
  }
  return {
    oncekiFiyat: oncekiFiyat / 100, ortalama: ortalama / 100, beklenen: beklenen / 100,
    artisOrani: kOnceki > 0 ? kBeklenen / kOnceki - 1 : null,   // yalnızca beklenen geliri hesaplanabilen firmalar üzerinden
    karsilastirilan: belli, belirsiz,
  };
}
