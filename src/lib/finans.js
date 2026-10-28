// OSGB 360 - Fatura, tahsilat ve gider yardımcıları. Saf fonksiyonlar (arayüzden bağımsız test edilir).
// Tutarlar kuruş (tam sayı) üzerinden toplanır; kayan nokta hatası oluşmaz.
import { faturaBakiyesi, giderleriAyir } from './hesaplama.js';

export const ODEME_DURUMLARI = {
  tahsil_edilmedi: 'Tahsil edilmedi', kismi_tahsilat: 'Kısmi tahsilat', tahsil_edildi: 'Tahsil edildi', itirazli: 'İtirazlı', takip_gerekiyor: 'Takip gerekiyor',
};
export const ODEME_TON = { tahsil_edilmedi: 'neutral', kismi_tahsilat: 'info', tahsil_edildi: 'success', itirazli: 'danger', takip_gerekiyor: 'warning' };
export const GIDER_TURU = { dogrudan: 'Doğrudan', ortak: 'Ortak' };
export const ODEME_YONTEMLERI = ['Havale / EFT', 'Nakit', 'Kredi kartı', 'Çek / senet', 'Diğer'];

const kurus = (x) => Math.round(Number(x ?? 0) * 100);
const tl = (k) => k / 100;
const aktifler = (l) => l.filter((x) => !x.archived_at);

/** Tahsilatları fatura numarasına göre gruplar (iptal edilmişler hariç). */
export function tahsilatHaritasi(tahsilatlar) {
  const h = new Map();
  for (const p of aktifler(tahsilatlar)) { if (!h.has(p.invoice_id)) h.set(p.invoice_id, []); h.get(p.invoice_id).push(p); }
  return h;
}

/** Bir faturanın bakiyesi, durumu ve gecikmesi. gecikmis: kalan var ve vade geçmiş. */
export function faturaDurumu(fatura, tahsilatlar, bugunStr) {
  const b = faturaBakiyesi(fatura, tahsilatlar, bugunStr);
  return { ...b, gecikmis: b.kalan > 0 && b.gecikmeGunu > 0 };
}

/** Yaşlandırma kovası: vadesi gelmemiş / 1-30 / 31-60 / 61-90 / 90+ gün. */
export function gecikmeKovasi(gun) {
  if (!(gun > 0)) return 'guncel';
  if (gun <= 30) return 'g30';
  if (gun <= 60) return 'g60';
  if (gun <= 90) return 'g90';
  return 'g90p';
}

/** Tahsilat özeti (panel ve tahsilat sayfası). Arşivdeki fatura ve tahsilatlar hariç. */
export function finansOzeti(faturalar, tahsilatlar, bugunStr) {
  const harita = tahsilatHaritasi(tahsilatlar);
  const o = { faturaAdedi: 0, toplamFatura: 0, toplamTahsil: 0, toplamKalan: 0, gecikmisKalan: 0, gecikmisAdet: 0, itirazliKalan: 0, itirazliAdet: 0, fazlaTahsilatAdet: 0, buAyTahsilat: 0,
    yaslandirma: { guncel: 0, g30: 0, g60: 0, g90: 0, g90p: 0 }, firmaKalan: {} };
  let fatura = 0; let tahsil = 0; let kalanT = 0; let gec = 0; let itiraz = 0; let buAy = 0;
  const ay = String(bugunStr).slice(0, 7);
  const kova = { guncel: 0, g30: 0, g60: 0, g90: 0, g90p: 0 }; const firma = {};
  for (const f of aktifler(faturalar)) {
    const d = faturaDurumu(f, harita.get(f.id) ?? [], bugunStr);
    o.faturaAdedi += 1;
    fatura += kurus(d.faturaTutari); tahsil += kurus(d.tahsilEdilen);
    if (d.fazlaTahsilat) o.fazlaTahsilatAdet += 1;
    if (d.kalan > 0) {
      kalanT += kurus(d.kalan);
      kova[gecikmeKovasi(d.gecikmeGunu)] += kurus(d.kalan);
      firma[f.company_id] = (firma[f.company_id] ?? 0) + kurus(d.kalan);
      if (d.gecikmis) { gec += kurus(d.kalan); o.gecikmisAdet += 1; }
      if (d.durum === 'itirazli') { itiraz += kurus(d.kalan); o.itirazliAdet += 1; }
    }
  }
  for (const p of aktifler(tahsilatlar)) if (String(p.paid_at).slice(0, 7) === ay) buAy += kurus(p.amount);
  o.toplamFatura = tl(fatura); o.toplamTahsil = tl(tahsil); o.toplamKalan = tl(kalanT); o.gecikmisKalan = tl(gec); o.itirazliKalan = tl(itiraz); o.buAyTahsilat = tl(buAy);
  for (const k of Object.keys(kova)) o.yaslandirma[k] = tl(kova[k]);
  for (const [k, v] of Object.entries(firma)) o.firmaKalan[k] = tl(v);
  return o;
}

/** Seçilen aya ait gider özeti (arşivdekiler hariç). KDV hariç tutar esas alınır; ödenmemiş tutar KDV dahildir. */
export function giderOzeti(giderler, ayBasiStr) {
  const ay = String(ayBasiStr).slice(0, 7);
  const liste = aktifler(giderler).filter((g) => String(g.expense_date).slice(0, 7) === ay);
  const a = giderleriAyir(liste);
  let dahil = 0; let odenmemis = 0; const kategori = {};
  for (const g of liste) {
    dahil += kurus(g.amount_incl_vat ?? Number(g.amount_excl_vat) + Number(g.vat_amount));
    if (!g.paid) odenmemis += kurus(g.amount_incl_vat ?? Number(g.amount_excl_vat) + Number(g.vat_amount));
    kategori[g.category_id] = (kategori[g.category_id] ?? 0) + kurus(g.amount_excl_vat);
  }
  return { adet: liste.length, ...a, dahilToplam: tl(dahil), odenmemisDahil: tl(odenmemis),
    kategoriBazli: Object.fromEntries(Object.entries(kategori).map(([k, v]) => [k, tl(v)])) };
}
