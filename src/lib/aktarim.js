// OSGB 360 - Raporlar, CSV dışa aktarma kümeleri ve CSV içe aktarma doğrulaması (saf fonksiyonlar).
// Arayüz ve veri tabanından bağımsızdır; testleri tests/aktarim.test.js içindedir.
import { trKucuk, gunFarki } from './format.js';
import { vergiNoNormalize, epostaGecerli, telefonGecerli, webGecerli, guncelProfil, profilleriGrupla } from './veri.js';
import { ODEME_DURUMLARI, GIDER_TURU, tahsilatHaritasi, faturaDurumu, gecikmeKovasi } from './finans.js';
import { SOZLESME_DURUMLARI, bitisDurumu } from './ticari.js';

export const TEHLIKE_ADI = { az_tehlikeli: 'Az tehlikeli', tehlikeli: 'Tehlikeli', cok_tehlikeli: 'Çok tehlikeli' };
export const MUSTERI_ADI = { musteri: 'Müşteri', eski_musteri: 'Eski müşteri' };
export const IC_AKTARIM_SATIR_SINIRI = 2000;
export const IC_AKTARIM_BOYUT_SINIRI = 2 * 1024 * 1024; // bayt

const evetHayir = (b) => (b ? 'Evet' : 'Hayır');
const aktifler = (l) => (l ?? []).filter((x) => !x.archived_at);
const adHaritasi = (liste, alan = 'name') => new Map((liste ?? []).map((x) => [x.id, x[alan]]));

// ====================================================================== dışa aktarma kümeleri
/**
 * Her küme: { id, ad, modul, aciklama, basliklar, satirlar(veri) }.
 * Firma ve kişi kümelerinin başlıkları, içe aktarma şablonuyla birebir uyumludur (dışa aktar → düzenle → içe aktar).
 */
export const VERI_KUMELERI = [
  {
    id: 'firmalar', ad: 'Firmalar', modul: 'companies', aciklama: 'Firma bilgileri, güncel çalışan sayısı ve tehlike sınıfı.',
    basliklar: ['Firma adı', 'Vergi no', 'Sektör', 'İl', 'İlçe', 'Adres', 'Telefon', 'E-posta', 'Web sitesi', 'Mevcut OSGB', 'Müşteri durumu', 'Çalışan sayısı', 'Tehlike sınıfı', 'Notlar', 'Kayıt durumu'],
    satirlar: ({ firmalar, profiller, bugun }) => {
      const h = profilleriGrupla(profiller ?? []);
      return [...firmalar].sort((a, b) => String(a.name).localeCompare(String(b.name), 'tr')).map((f) => {
        const p = guncelProfil(h.get(f.id), bugun);
        return [f.name, f.tax_no, f.sector, f.city, f.district, f.address, f.phone, f.email, f.website, f.current_provider,
          MUSTERI_ADI[f.customer_status] ?? f.customer_status, p ? p.employee_count : null, p ? TEHLIKE_ADI[p.hazard_class] : null, f.notes, f.archived_at ? 'Arşivde' : 'Aktif'];
      });
    },
  },
  {
    id: 'kisiler', ad: 'Kişiler', modul: 'contacts', aciklama: 'Firma yetkilileri ve iletişim bilgileri.',
    basliklar: ['Ad soyad', 'Firma', 'Firma vergi no', 'Unvan', 'Telefon', 'E-posta', 'Karar verici', 'Notlar', 'Kayıt durumu'],
    satirlar: ({ kisiler, firmalar }) => {
      const f = new Map(firmalar.map((x) => [x.id, x]));
      return kisiler.filter((k) => k.company_id).map((k) => [k.full_name, f.get(k.company_id)?.name, f.get(k.company_id)?.tax_no, k.title, k.phone, k.email,
        evetHayir(k.is_decision_maker), k.notes, k.archived_at ? 'Arşivde' : 'Aktif']);
    },
  },
  {
    id: 'sozlesmeler', ad: 'Sözleşmeler', modul: 'contracts', aciklama: 'Sözleşme dönemleri, durum ve hizmet kapsamı.',
    basliklar: ['Firma', 'Başlangıç', 'Bitiş', 'Durum', 'Uzman hizmeti', 'Hekim hizmeti', 'Ödeme koşulları', 'Yenileme koşulları', 'Bitişe kalan gün', 'Kayıt durumu'],
    satirlar: ({ sozlesmeler, firmalar, bugun }) => {
      const f = adHaritasi(firmalar);
      return sozlesmeler.map((c) => [f.get(c.company_id), c.start_date, c.end_date, SOZLESME_DURUMLARI[c.status] ?? c.status,
        evetHayir(c.expert_service), evetHayir(c.physician_service), c.payment_terms, c.renewal_terms,
        c.status === 'aktif' ? gunFarki(bugun, c.end_date) : null, c.archived_at ? 'Arşivde' : 'Aktif']);
    },
  },
  {
    id: 'faturalar', ad: 'Faturalar', modul: 'invoices', aciklama: 'Faturalar, tahsil edilen ve kalan tutarlar (KDV dahil/hariç).',
    basliklar: ['Fatura no', 'Firma', 'Fatura tarihi', 'Vade tarihi', 'Hizmet dönemi', 'KDV hariç', 'KDV', 'KDV dahil', 'Tahsil edilen', 'Kalan', 'Durum', 'Gecikme (gün)', 'Kayıt durumu'],
    satirlar: ({ faturalar, tahsilatlar, firmalar, bugun }) => {
      const f = adHaritasi(firmalar); const h = tahsilatHaritasi(tahsilatlar ?? []);
      return faturalar.map((x) => {
        const d = faturaDurumu(x, h.get(x.id) ?? [], bugun);
        return [x.invoice_no, f.get(x.company_id), x.invoice_date, x.due_date, x.service_period, Number(x.amount_excl_vat), Number(x.vat_amount), d.faturaTutari, d.tahsilEdilen, d.kalan,
          ODEME_DURUMLARI[d.durum], d.gecikmeGunu, x.archived_at ? 'Arşivde' : 'Aktif'];
      });
    },
  },
  {
    id: 'tahsilatlar', ad: 'Tahsilatlar', modul: 'invoices', aciklama: 'Faturalara girilen tahsilat kayıtları.',
    basliklar: ['Fatura no', 'Firma', 'Tahsilat tarihi', 'Tutar (KDV dahil)', 'Ödeme yöntemi', 'Not', 'Kayıt durumu'],
    satirlar: ({ tahsilatlar, faturalar, firmalar }) => {
      const fa = new Map(faturalar.map((x) => [x.id, x])); const fi = adHaritasi(firmalar);
      return (tahsilatlar ?? []).map((p) => { const x = fa.get(p.invoice_id); return [x?.invoice_no, fi.get(x?.company_id), p.paid_at, Number(p.amount), p.method, p.notes, p.archived_at ? 'İptal' : 'Aktif']; });
    },
  },
  {
    id: 'giderler', ad: 'Giderler', modul: 'expenses', aciklama: 'Gider kayıtları; maaş kategorisi yalnızca maaş yetkisi olanlara görünür.',
    basliklar: ['Tarih', 'Kategori', 'Tür', 'Firma', 'KDV hariç', 'KDV', 'KDV dahil', 'Ödendi', 'Açıklama', 'Kayıt durumu'],
    satirlar: ({ giderler, kategoriler, firmalar }) => {
      const k = adHaritasi(kategoriler); const f = adHaritasi(firmalar);
      return giderler.map((g) => [g.expense_date, k.get(g.category_id), GIDER_TURU[g.cost_type] ?? g.cost_type, f.get(g.company_id), Number(g.amount_excl_vat), Number(g.vat_amount),
        Number(g.amount_excl_vat) + Number(g.vat_amount), evetHayir(g.paid), g.description, g.archived_at ? 'Arşivde' : 'Aktif']);
    },
  },
];

// ====================================================================== raporlar
const topla = (l) => Math.round(l.reduce((t, x) => t + Math.round(Number(x) * 100), 0)) / 100;
const aydaMi = (iso, ay) => String(iso ?? '').slice(0, 7) === String(ay).slice(0, 7);

/**
 * Raporlar: { id, ad, aciklama, modul[], aylik, uret(veri, ay) → {basliklar, satirlar, toplam?, ozet?} }
 * toplam: tablonun altında gösterilen toplam satırı (satirlar ile aynı sütun sayısında).
 */
export const RAPORLAR = [
  {
    id: 'yonetici-ozeti', ad: 'Aylık yönetici özeti', moduller: ['companies', 'contracts', 'invoices', 'expenses'], aylik: true, paraSatirlari: [4, 5, 6, 7, 9],
    aciklama: 'Seçilen ayın firma, sözleşme, fatura, tahsilat ve gider rakamları.',
    uret: ({ firmalar, sozlesmeler, faturalar, tahsilatlar, giderler, bugun }, ay) => {
      const ayBit = `${String(ay).slice(0, 7)}-31`;
      const aktifSoz = aktifler(sozlesmeler).filter((c) => c.status === 'aktif' && c.start_date <= ayBit && c.end_date >= `${String(ay).slice(0, 7)}-01`);
      const f = aktifler(faturalar).filter((x) => aydaMi(x.invoice_date, ay));
      const t = aktifler(tahsilatlar).filter((p) => aydaMi(p.paid_at, ay));
      const g = aktifler(giderler).filter((x) => aydaMi(x.expense_date, ay));
      const h = tahsilatHaritasi(tahsilatlar ?? []);
      const gecikmis = aktifler(faturalar).map((x) => faturaDurumu(x, h.get(x.id) ?? [], bugun)).filter((d) => d.gecikmis);
      return {
        basliklar: ['Gösterge', 'Değer'],
        satirlar: [
          ['Aktif firma sayısı (bugün)', aktifler(firmalar).filter((x) => x.customer_status === 'musteri').length],
          ['Ay içinde eklenen firma', aktifler(firmalar).filter((x) => aydaMi(x.created_at, ay)).length],
          ['Ayda geçerli aktif sözleşme', aktifSoz.length],
          ['Kesilen fatura adedi', f.length],
          ['Kesilen fatura toplamı (KDV hariç)', topla(f.map((x) => x.amount_excl_vat))],
          ['Kesilen fatura toplamı (KDV dahil)', topla(f.map((x) => Number(x.amount_excl_vat) + Number(x.vat_amount)))],
          ['Ay içinde tahsil edilen (KDV dahil)', topla(t.map((p) => p.amount))],
          ['Vadesi geçmiş açık alacak (bugün, KDV dahil)', topla(gecikmis.map((d) => d.kalan))],
          ['Vadesi geçmiş fatura adedi (bugün)', gecikmis.length],
          ['Ay gideri (KDV hariç)', topla(g.map((x) => x.amount_excl_vat))],
        ],
      };
    },
  },
  {
    id: 'yaslandirma', ad: 'Tahsilat yaşlandırma', moduller: ['companies', 'invoices'], aylik: false, paraSutunlari: [2, 3, 4, 5, 6, 7],
    aciklama: 'Firma bazında açık alacak ve vade gecikmesine göre dağılım (bugünün tarihine göre, KDV dahil).',
    uret: ({ firmalar, faturalar, tahsilatlar, bugun }) => {
      const ad = adHaritasi(firmalar); const h = tahsilatHaritasi(tahsilatlar ?? []); const por = new Map();
      for (const x of aktifler(faturalar)) {
        const d = faturaDurumu(x, h.get(x.id) ?? [], bugun);
        if (!(d.kalan > 0)) continue;
        const k = gecikmeKovasi(d.gecikmeGunu);
        if (!por.has(x.company_id)) por.set(x.company_id, { guncel: 0, g30: 0, g60: 0, g90: 0, g90p: 0, adet: 0 });
        por.get(x.company_id)[k] += Math.round(d.kalan * 100); por.get(x.company_id).adet += 1;
      }
      const satirlar = [...por.entries()].map(([id, o]) => [ad.get(id) ?? 'Firma', o.adet, o.guncel / 100, o.g30 / 100, o.g60 / 100, o.g90 / 100, o.g90p / 100,
        (o.guncel + o.g30 + o.g60 + o.g90 + o.g90p) / 100]).sort((a, b) => b[7] - a[7]);
      const s = (i) => topla(satirlar.map((r) => r[i]));
      return { basliklar: ['Firma', 'Açık fatura', 'Vadesi gelmemiş', '1-30 gün', '31-60 gün', '61-90 gün', '90+ gün', 'Toplam açık'], satirlar,
        toplam: ['Toplam', satirlar.reduce((t, r) => t + r[1], 0), s(2), s(3), s(4), s(5), s(6), s(7)] };
    },
  },
  {
    id: 'sozlesme-bitis', ad: 'Sözleşme bitiş ve yenileme', moduller: ['companies', 'contracts'], aylik: false,
    aciklama: 'Aktif sözleşmeler, bitişe kalan güne göre sıralı. 90 gün ve altı uyarı verir.',
    uret: ({ firmalar, sozlesmeler, bugun }) => {
      const ad = adHaritasi(firmalar);
      const satirlar = aktifler(sozlesmeler).filter((c) => c.status === 'aktif').map((c) => ({ c, b: bitisDurumu(c, bugun) }))
        .sort((a, b) => a.b.gun - b.b.gun)
        .map(({ c, b }) => [ad.get(c.company_id), c.start_date, c.end_date, b.gun, b.seviye === 'gecmis' ? 'Süresi geçmiş' : b.seviye === 'kritik' ? '30 gün içinde' : b.esik ? `${b.esik} gün içinde` : 'Normal', c.renewal_terms]);
      return { basliklar: ['Firma', 'Başlangıç', 'Bitiş', 'Kalan gün', 'Uyarı', 'Yenileme koşulları'], satirlar };
    },
  },
  {
    id: 'portfoy', ad: 'Müşteri portföyü', moduller: ['companies'], aylik: false,
    aciklama: 'Aktif müşterilerin tehlike sınıfına göre firma ve çalışan sayıları (bugün geçerli kayıtlarla).',
    uret: ({ firmalar, profiller, bugun }) => {
      const h = profilleriGrupla(profiller ?? []); const por = { az_tehlikeli: [0, 0], tehlikeli: [0, 0], cok_tehlikeli: [0, 0] }; let bilinmeyen = 0;
      for (const f of aktifler(firmalar).filter((x) => x.customer_status === 'musteri')) {
        const p = guncelProfil(h.get(f.id), bugun);
        if (!p) { bilinmeyen += 1; continue; }
        por[p.hazard_class][0] += 1; por[p.hazard_class][1] += Number(p.employee_count);
      }
      const satirlar = Object.entries(por).map(([k, [n, c]]) => [TEHLIKE_ADI[k], n, c]);
      if (bilinmeyen) satirlar.push(['Çalışan/tehlike bilgisi girilmemiş', bilinmeyen, null]);
      return { basliklar: ['Tehlike sınıfı', 'Firma sayısı', 'Toplam çalışan'], satirlar,
        toplam: ['Toplam', satirlar.reduce((t, r) => t + r[1], 0), satirlar.reduce((t, r) => t + (r[2] ?? 0), 0)] };
    },
  },
  {
    id: 'gider-kategori', ad: 'Gider dağılımı (kategori)', moduller: ['expenses'], aylik: true, paraSutunlari: [2, 3, 4],
    aciklama: 'Seçilen ayın giderleri kategori bazında (KDV hariç ve dahil).',
    uret: ({ giderler, kategoriler }, ay) => {
      const k = adHaritasi(kategoriler); const por = new Map();
      for (const g of aktifler(giderler).filter((x) => aydaMi(x.expense_date, ay))) {
        const o = por.get(g.category_id) ?? { adet: 0, haric: 0, kdv: 0 };
        o.adet += 1; o.haric += Math.round(Number(g.amount_excl_vat) * 100); o.kdv += Math.round(Number(g.vat_amount) * 100); por.set(g.category_id, o);
      }
      const satirlar = [...por.entries()].map(([id, o]) => [k.get(id) ?? 'Kategori', o.adet, o.haric / 100, o.kdv / 100, (o.haric + o.kdv) / 100]).sort((a, b) => b[2] - a[2]);
      return { basliklar: ['Kategori', 'Kayıt', 'KDV hariç', 'KDV', 'KDV dahil'], satirlar,
        toplam: ['Toplam', satirlar.reduce((t, r) => t + r[1], 0), topla(satirlar.map((r) => r[2])), topla(satirlar.map((r) => r[3])), topla(satirlar.map((r) => r[4]))] };
    },
  },
];

// ====================================================================== içe aktarma: sütun eşleştirme
/** Başlık karşılaştırması için: küçük harf, aksan/boşluk/noktalama yok (Türkçe karakterler ASCII'ye iner). */
export const baslikAnahtari = (s) => trKucuk(s).replace(/ı/g, 'i').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');

export const FIRMA_ALANLARI = [
  { alan: 'name', etiket: 'Firma adı', zorunlu: true, takma: ['Firma adı', 'Firma', 'Unvan', 'Şirket', 'Şirket adı', 'Müşteri', 'Ad'] },
  { alan: 'tax_no', etiket: 'Vergi no', takma: ['Vergi no', 'Vergi numarası', 'VKN', 'Vergi kimlik no', 'TC/VKN'] },
  { alan: 'sector', etiket: 'Sektör', takma: ['Sektör', 'Faaliyet alanı'] },
  { alan: 'city', etiket: 'İl', takma: ['İl', 'Şehir'] },
  { alan: 'district', etiket: 'İlçe', takma: ['İlçe'] },
  { alan: 'address', etiket: 'Adres', takma: ['Adres'] },
  { alan: 'phone', etiket: 'Telefon', takma: ['Telefon', 'Tel', 'Cep'] },
  { alan: 'email', etiket: 'E-posta', takma: ['E-posta', 'Eposta', 'Email', 'Mail'] },
  { alan: 'website', etiket: 'Web sitesi', takma: ['Web sitesi', 'Web', 'Website', 'Site'] },
  { alan: 'current_provider', etiket: 'Mevcut OSGB', takma: ['Mevcut OSGB', 'Mevcut sağlayıcı'] },
  { alan: 'customer_status', etiket: 'Müşteri durumu', takma: ['Müşteri durumu'] },
  { alan: 'employee_count', etiket: 'Çalışan sayısı', takma: ['Çalışan sayısı', 'Çalışan', 'Personel sayısı'] },
  { alan: 'hazard_class', etiket: 'Tehlike sınıfı', takma: ['Tehlike sınıfı', 'Tehlike'] },
  { alan: 'notes', etiket: 'Notlar', takma: ['Notlar', 'Not', 'Açıklama'] },
];

export const KISI_ALANLARI = [
  { alan: 'full_name', etiket: 'Ad soyad', zorunlu: true, takma: ['Ad soyad', 'Adı soyadı', 'Kişi', 'İsim', 'Yetkili'] },
  { alan: 'company', etiket: 'Firma (ad)', zorunlu: false, takma: ['Firma', 'Firma adı', 'Şirket'] },
  { alan: 'company_tax_no', etiket: 'Firma vergi no', takma: ['Firma vergi no', 'Vergi no', 'VKN'] },
  { alan: 'title', etiket: 'Unvan', takma: ['Unvan', 'Görev', 'Pozisyon'] },
  { alan: 'phone', etiket: 'Telefon', takma: ['Telefon', 'Tel', 'Cep'] },
  { alan: 'email', etiket: 'E-posta', takma: ['E-posta', 'Eposta', 'Email', 'Mail'] },
  { alan: 'is_decision_maker', etiket: 'Karar verici', takma: ['Karar verici'] },
  { alan: 'notes', etiket: 'Notlar', takma: ['Notlar', 'Not', 'Açıklama'] },
];

export const ICE_AKTARIM_TURLERI = {
  firmalar: { ad: 'Firmalar', modul: 'companies', alanlar: FIRMA_ALANLARI },
  kisiler: { ad: 'Kişiler', modul: 'contacts', alanlar: KISI_ALANLARI },
};

/** Başlıklara göre otomatik eşleştirme. Dönüş: başlık sırasına göre alan adı (ya da '' = aktarılmaz). Bir alan yalnızca bir sütunla eşlenir. */
export function otomatikEsle(basliklar, alanlar) {
  const kullanilan = new Set(); const sonuc = [];
  const tablo = new Map();
  for (const a of alanlar) for (const t of a.takma) { const k = baslikAnahtari(t); if (!tablo.has(k)) tablo.set(k, a.alan); }
  for (const b of basliklar) {
    const alan = tablo.get(baslikAnahtari(b));
    if (alan && !kullanilan.has(alan)) { sonuc.push(alan); kullanilan.add(alan); } else sonuc.push('');
  }
  return sonuc;
}

/** Eşlemeye göre bir satırı { alan: değer } nesnesine çevirir. */
export const satirNesnesi = (hucreler, esleme) => {
  const o = {};
  esleme.forEach((alan, i) => { if (alan) o[alan] = String(hucreler[i] ?? '').trim(); });
  return o;
};

// ====================================================================== içe aktarma: değer ayrıştırma
const boslukSadele = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const adAnahtari = (s) => trKucuk(boslukSadele(s));

export function tehlikeAyristir(v) {
  const k = baslikAnahtari(v);
  if (!k) return null;
  if (['aztehlikeli', 'az'].includes(k)) return 'az_tehlikeli';
  if (['tehlikeli'].includes(k)) return 'tehlikeli';
  if (['coktehlikeli', 'cok'].includes(k)) return 'cok_tehlikeli';
  return undefined; // tanınmadı
}
export function musteriDurumuAyristir(v) {
  const k = baslikAnahtari(v);
  if (!k) return 'musteri';
  if (k === 'musteri') return 'musteri';
  if (['eskimusteri', 'eski'].includes(k)) return 'eski_musteri';
  return undefined;
}
export function evetHayirAyristir(v) {
  const k = baslikAnahtari(v);
  if (!k) return false;
  if (['evet', 'e', '1', 'true', 'x', 'var', 'yes'].includes(k)) return true;
  if (['hayir', 'h', '0', 'false', 'yok', 'no'].includes(k)) return false;
  return undefined;
}
/** Tam sayı ayrıştırma ("1.250" → 1250). Ondalık/negatif/harf → undefined. Boş → null. */
export function tamSayiAyristir(v) {
  const s = boslukSadele(v);
  if (!s) return null;
  if (!/^\d{1,3}(\.\d{3})+$|^\d+$/.test(s)) return undefined;
  const n = Number(s.replace(/\./g, ''));
  return Number.isSafeInteger(n) ? n : undefined;
}

const ALAN_SINIRI = { name: 200, tax_no: 30, sector: 120, city: 80, district: 80, address: 500, phone: 25, email: 200, website: 300, current_provider: 150, notes: 2000, full_name: 200, title: 120 };
const bos = (v) => (v === '' || v === undefined ? null : v);

// ====================================================================== içe aktarma: firmalar
/**
 * Firma satırlarını doğrular. Dönüş her satır için:
 *  { satirNo, durum: 'hazir'|'hata'|'mukerrer', hatalar:[], uyarilar:[], nedenMukerrer?, firma, profil }
 * - hata: aktarılamaz; mukerrer: atlanır (kayıtlı firmayla ya da dosyadaki önceki satırla aynı vergi no / ad).
 * Mevcut firmalarda arşivde aynı vergi numarası varsa yalnızca uyarı verilir (aktarılabilir).
 */
export function firmaSatirlariniDogrula({ kayitlar, esleme, mevcutFirmalar }) {
  const aktifVergi = new Map(); const aktifAd = new Map(); const arsivVergi = new Map();
  for (const f of mevcutFirmalar) {
    const vn = vergiNoNormalize(f.tax_no);
    if (f.archived_at) { if (vn) arsivVergi.set(vn, f); continue; }
    if (vn) aktifVergi.set(vn, f);
    aktifAd.set(adAnahtari(f.name), f);
  }
  const dosyaVergi = new Map(); const dosyaAd = new Map();
  return kayitlar.map((k) => {
    const v = satirNesnesi(k.hucreler, esleme);
    const hatalar = []; const uyarilar = [];
    if (k.fazla) uyarilar.push('Satırda başlıktan fazla sütun var; fazlası yok sayıldı.');
    const ad = boslukSadele(v.name);
    if (!ad) hatalar.push('Firma adı boş.');
    else if (ad.length > ALAN_SINIRI.name) hatalar.push(`Firma adı ${ALAN_SINIRI.name} karakterden uzun.`);
    for (const a of ['sector', 'city', 'district', 'address', 'current_provider', 'notes']) if ((v[a] ?? '').length > ALAN_SINIRI[a]) hatalar.push(`${FIRMA_ALANLARI.find((x) => x.alan === a).etiket} çok uzun (en fazla ${ALAN_SINIRI[a]} karakter).`);
    const vn = vergiNoNormalize(v.tax_no);
    if (vn && vn.length > ALAN_SINIRI.tax_no) hatalar.push('Vergi no çok uzun.');
    if (vn && /^\d+$/.test(vn) && ![10, 11].includes(vn.length)) uyarilar.push(`Vergi no ${vn.length} haneli (vergi no 10, T.C. kimlik no 11 hane olmalıdır).`);
    if (v.email && !epostaGecerli(v.email)) hatalar.push('E-posta adresi geçersiz.');
    if (v.phone && !telefonGecerli(v.phone)) hatalar.push('Telefon numarası geçersiz.');
    if (v.website && !webGecerli(v.website)) hatalar.push('Web sitesi adresi geçersiz.');
    const durum = musteriDurumuAyristir(v.customer_status);
    if (durum === undefined) hatalar.push('Müşteri durumu "Müşteri" veya "Eski müşteri" olmalıdır.');
    const sayi = tamSayiAyristir(v.employee_count);
    if (sayi === undefined) hatalar.push('Çalışan sayısı 0 veya pozitif bir tam sayı olmalıdır.');
    const tehlike = tehlikeAyristir(v.hazard_class);
    if (tehlike === undefined) hatalar.push('Tehlike sınıfı "Az tehlikeli", "Tehlikeli" veya "Çok tehlikeli" olmalıdır.');
    if (sayi !== null && sayi !== undefined && !tehlike && tehlike !== undefined) hatalar.push('Çalışan sayısı girildiyse tehlike sınıfı da girilmelidir.');
    if (tehlike && (sayi === null)) uyarilar.push('Tehlike sınıfı çalışan sayısı olmadan kaydedilmez; yok sayıldı.');

    let mukerrerNeden = null;
    if (!hatalar.length) {
      if (vn && aktifVergi.has(vn)) mukerrerNeden = `Bu vergi numarası "${aktifVergi.get(vn).name}" firmasında kayıtlı.`;
      else if (ad && aktifAd.has(adAnahtari(ad))) mukerrerNeden = `"${aktifAd.get(adAnahtari(ad)).name}" adında aktif firma kayıtlı.`;
      else if (vn && dosyaVergi.has(vn)) mukerrerNeden = `Aynı vergi numarası dosyada ${dosyaVergi.get(vn)}. satırda da var.`;
      else if (dosyaAd.has(adAnahtari(ad))) mukerrerNeden = `Aynı firma adı dosyada ${dosyaAd.get(adAnahtari(ad))}. satırda da var.`;
      else {
        if (vn) dosyaVergi.set(vn, k.satirNo);
        dosyaAd.set(adAnahtari(ad), k.satirNo);
        if (vn && arsivVergi.has(vn)) uyarilar.push(`Aynı vergi numarası arşivdeki "${arsivVergi.get(vn).name}" firmasında var; yine de yeni kayıt olarak eklenecek.`);
      }
    }
    const firma = hatalar.length ? null : {
      name: ad, tax_no: bos(vn), sector: bos(boslukSadele(v.sector)), city: bos(boslukSadele(v.city)), district: bos(boslukSadele(v.district)),
      address: bos(boslukSadele(v.address)), phone: bos(boslukSadele(v.phone)), email: bos(boslukSadele(v.email)), website: bos(boslukSadele(v.website)),
      current_provider: bos(boslukSadele(v.current_provider)), customer_status: durum, responsible_user: null, notes: bos(boslukSadele(v.notes)),
    };
    const profil = !hatalar.length && sayi !== null && tehlike ? { calisanSayisi: sayi, tehlike } : null;
    return { satirNo: k.satirNo, durum: hatalar.length ? 'hata' : mukerrerNeden ? 'mukerrer' : 'hazir', hatalar, uyarilar, nedenMukerrer: mukerrerNeden, firma, profil };
  });
}

// ====================================================================== içe aktarma: kişiler
/**
 * Kişi satırlarını doğrular. Firma önce vergi no ile, yoksa ad ile (aktif firmalar arasında) bulunur.
 * Aynı firmada aynı e-posta (varsa) ya da aynı ad soyad zaten kayıtlıysa 'mukerrer' sayılır.
 */
export function kisiSatirlariniDogrula({ kayitlar, esleme, mevcutFirmalar, mevcutKisiler }) {
  const aktifFirmalar = mevcutFirmalar.filter((f) => !f.archived_at);
  const vergiyeGore = new Map(); const adaGore = new Map(); const adCakisan = new Set();
  for (const f of aktifFirmalar) {
    const vn = vergiNoNormalize(f.tax_no); if (vn) vergiyeGore.set(vn, f);
    const a = adAnahtari(f.name); if (adaGore.has(a)) adCakisan.add(a); else adaGore.set(a, f);
  }
  const anahtarlar = new Set();
  const kisiAnahtari = (cid, ad, eposta) => (eposta ? `${cid}|e|${trKucuk(eposta)}` : `${cid}|a|${adAnahtari(ad)}`);
  for (const k of mevcutKisiler.filter((x) => !x.archived_at && x.company_id)) { anahtarlar.add(kisiAnahtari(k.company_id, k.full_name, k.email)); anahtarlar.add(`${k.company_id}|a|${adAnahtari(k.full_name)}`); }
  const dosya = new Map();
  return kayitlar.map((k) => {
    const v = satirNesnesi(k.hucreler, esleme);
    const hatalar = []; const uyarilar = [];
    if (k.fazla) uyarilar.push('Satırda başlıktan fazla sütun var; fazlası yok sayıldı.');
    const ad = boslukSadele(v.full_name);
    if (!ad) hatalar.push('Ad soyad boş.'); else if (ad.length > ALAN_SINIRI.full_name) hatalar.push('Ad soyad çok uzun.');
    if ((v.title ?? '').length > ALAN_SINIRI.title) hatalar.push('Unvan çok uzun.');
    if ((v.notes ?? '').length > ALAN_SINIRI.notes) hatalar.push('Not çok uzun.');
    if (v.email && !epostaGecerli(v.email)) hatalar.push('E-posta adresi geçersiz.');
    if (v.phone && !telefonGecerli(v.phone)) hatalar.push('Telefon numarası geçersiz.');
    const karar = evetHayirAyristir(v.is_decision_maker);
    if (karar === undefined) hatalar.push('Karar verici "Evet" veya "Hayır" olmalıdır.');

    let firma = null;
    const vn = vergiNoNormalize(v.company_tax_no); const fa = boslukSadele(v.company);
    if (!vn && !fa) hatalar.push('Firma bilgisi yok (firma adı ya da vergi no gerekir).');
    else if (vn && vergiyeGore.has(vn)) firma = vergiyeGore.get(vn);
    else if (vn && !fa) hatalar.push(`${vn} vergi numaralı aktif firma bulunamadı.`);
    else if (fa) {
      const a = adAnahtari(fa);
      if (adCakisan.has(a)) hatalar.push(`"${fa}" adında birden çok firma var; vergi no sütunu ekleyin.`);
      else if (adaGore.has(a)) firma = adaGore.get(a);
      else hatalar.push(`"${fa}" adında aktif firma bulunamadı (önce firmaları aktarın).`);
    }

    let mukerrerNeden = null;
    if (!hatalar.length) {
      const eAnahtar = v.email ? kisiAnahtari(firma.id, ad, v.email) : null; const aAnahtar = `${firma.id}|a|${adAnahtari(ad)}`;
      if (eAnahtar && anahtarlar.has(eAnahtar)) mukerrerNeden = `Bu e-posta "${firma.name}" firmasında kayıtlı.`;
      else if (anahtarlar.has(aAnahtar)) mukerrerNeden = `"${ad}" "${firma.name}" firmasında zaten kayıtlı.`;
      else if (eAnahtar && dosya.has(eAnahtar)) mukerrerNeden = `Aynı e-posta dosyada ${dosya.get(eAnahtar)}. satırda da var.`;
      else if (dosya.has(aAnahtar)) mukerrerNeden = `Aynı kişi dosyada ${dosya.get(aAnahtar)}. satırda da var.`;
      else { if (eAnahtar) dosya.set(eAnahtar, k.satirNo); dosya.set(aAnahtar, k.satirNo); }
    }
    const kisi = hatalar.length ? null : {
      company_id: firma.id, full_name: ad, title: bos(boslukSadele(v.title)), phone: bos(boslukSadele(v.phone)), email: bos(boslukSadele(v.email)),
      is_decision_maker: karar === true, notes: bos(boslukSadele(v.notes)),
    };
    return { satirNo: k.satirNo, durum: hatalar.length ? 'hata' : mukerrerNeden ? 'mukerrer' : 'hazir', hatalar, uyarilar, nedenMukerrer: mukerrerNeden, kisi, firmaAdi: firma?.name ?? fa };
  });
}

/** Önizleme özeti: hazır / mükerrer / hatalı adetleri. */
export const dogrulamaOzeti = (sonuclar) => ({
  toplam: sonuclar.length,
  hazir: sonuclar.filter((s) => s.durum === 'hazir').length,
  mukerrer: sonuclar.filter((s) => s.durum === 'mukerrer').length,
  hata: sonuclar.filter((s) => s.durum === 'hata').length,
});

/** Aktarılamayan (hatalı + mükerrer) satırların CSV'si için başlık ve satırlar. */
export function hataRaporu(sonuclar, kayitlar, basliklar) {
  const harita = new Map(kayitlar.map((k) => [k.satirNo, k.hucreler]));
  const satirlar = sonuclar.filter((s) => s.durum !== 'hazir').map((s) => [s.satirNo, s.durum === 'hata' ? 'Hata' : 'Mükerrer', s.durum === 'hata' ? s.hatalar.join(' ') : s.nedenMukerrer, ...(harita.get(s.satirNo) ?? [])]);
  return { basliklar: ['Satır', 'Durum', 'Açıklama', ...basliklar], satirlar };
}

/** Boş içe aktarma şablonu (başlık + örnek satır). */
export const SABLONLAR = {
  firmalar: { basliklar: FIRMA_ALANLARI.map((a) => a.etiket), ornek: ['Örnek Gıda A.Ş.', '1234567890', 'Gıda', 'Ankara', 'Çankaya', 'Örnek Mah. 1. Sok. No:1', '0312 000 00 00', 'info@ornek.com', 'https://ornek.com', '', 'Müşteri', 50, 'Tehlikeli', ''] },
  kisiler: { basliklar: ['Ad soyad', 'Firma', 'Firma vergi no', 'Unvan', 'Telefon', 'E-posta', 'Karar verici', 'Notlar'], ornek: ['Ayşe Yılmaz', 'Örnek Gıda A.Ş.', '1234567890', 'İK Müdürü', '0555 000 00 00', 'ayse@ornek.com', 'Evet', ''] },
};
