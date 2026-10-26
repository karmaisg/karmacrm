// OSGB 360 - Potansiyel müşteri puanlaması ve satış hunisi yardımcıları (saf fonksiyonlar, arayüzden bağımsız).
// Puan 0-100 arasıdır ve her bileşeni görünür: kullanıcı "neden bu puan?" sorusunu yanıtlayabilir.
// Ağırlıklar varsayılandır; Aşama 10'da ayarlardan değiştirilebilir hâle getirilecek.
import { teorikDakika } from './hesaplama.js';

export const KAYNAKLAR = {
  tavsiye: 'Tavsiye', google_web: 'Google / web sitesi', telefon: 'Telefon', saha_ziyareti: 'Saha ziyareti',
  sosyal_medya: 'Sosyal medya', reklam: 'Reklam', etkinlik: 'Etkinlik', diger: 'Diğer',
};
export const KAYNAK_PUANI = {
  tavsiye: 20, saha_ziyareti: 15, telefon: 12, google_web: 12, etkinlik: 12, sosyal_medya: 8, reklam: 8, diger: 5,
};
export const ONCELIKLER = { dusuk: 'Düşük', orta: 'Orta', yuksek: 'Yüksek', kritik: 'Kritik' };
export const ONCELIK_SIRASI = ['dusuk', 'orta', 'yuksek', 'kritik'];

export const ASAMALAR = {
  yeni_aday: 'Yeni aday',
  ilk_temas_bekleniyor: 'İlk temas bekleniyor',
  ilk_gorusme_yapildi: 'İlk görüşme yapıldı',
  ihtiyac_analizi_yapildi: 'İhtiyaç analizi yapıldı',
  teklif_hazirlaniyor: 'Teklif hazırlanıyor',
  teklif_gonderildi: 'Teklif gönderildi',
  pazarlik: 'Pazarlık',
  kazanildi: 'Kazanıldı',
  kaybedildi: 'Kaybedildi',
  ertelendi: 'Ertelendi',
};
export const ASAMA_SIRASI = Object.keys(ASAMALAR);
export const ACIK_ASAMALAR = ASAMA_SIRASI.filter((a) => !['kazanildi', 'kaybedildi', 'ertelendi'].includes(a));
export const KAYIP_NEDENLERI = {
  fiyat: 'Fiyat', rakip: 'Rakip firma', karar_degisti: 'Karar değişti', hizmet_bolgesi: 'Hizmet bölgesi dışında',
  zamanlama: 'Zamanlama', ihtiyac_kalmadi: 'İhtiyaç kalmadı', diger: 'Diğer',
};
export const GOREV_TURLERI = {
  potansiyel_arama: 'Potansiyel müşteri araması', teklif_takibi: 'Teklif takibi', musteri_ziyareti: 'Müşteri ziyareti',
  sozlesme_yenileme: 'Sözleşme yenileme', tahsilat_takibi: 'Tahsilat takibi', musteri_sikayeti: 'Müşteri şikâyeti',
  fiyat_guncelleme: 'Fiyat güncelleme', diger: 'Diğer',
};
export const GOREV_DURUMLARI = { acik: 'Açık', devam_ediyor: 'Devam ediyor', tamamlandi: 'Tamamlandı', iptal: 'İptal' };
export const GORUSME_TURLERI = {
  gorusme: 'Görüşme', arama: 'Telefon araması', eposta: 'E-posta', ziyaret: 'Ziyaret', not: 'Not', sikayet: 'Şikâyet', cozum: 'Çözüm',
};

const calisanPuani = (n) => {
  if (n === null || n === undefined) return null;
  if (n <= 0) return 0;
  if (n < 10) return 5;
  if (n < 50) return 15;
  if (n < 250) return 25;
  return 30;
};
const TEHLIKE_PUANI = { az_tehlikeli: 5, tehlikeli: 12, cok_tehlikeli: 20 };
const gelirPuani = (g) => {
  if (g === null || g === undefined) return null;
  if (g <= 0) return 0;
  if (g < 5000) return 5;
  if (g < 15000) return 15;
  if (g < 30000) return 22;
  return 30;
};

/**
 * Puan = firma büyüklüğü (0-30) + tehlike sınıfı (0-20) + kaynak (0-20) + tahmini aylık gelir (0-30).
 * Girilmeyen bilgi 0 puan alır ve "veri eksik" olarak işaretlenir (puan, olduğundan yüksek gösterilmez).
 */
export function potansiyelPuani({ employee_count: calisan, hazard_class: tehlike, source: kaynak, est_monthly_revenue: gelir }) {
  const sayi = (v) => (v === '' || v === null || v === undefined ? null : Number(v));
  const parcalar = [
    { id: 'buyukluk', ad: 'Firma büyüklüğü', max: 30, puan: calisanPuani(sayi(calisan)),
      aciklama: sayi(calisan) === null ? 'Çalışan sayısı girilmedi' : `${sayi(calisan)} çalışan` },
    { id: 'tehlike', ad: 'Tehlike sınıfı', max: 20, puan: tehlike ? TEHLIKE_PUANI[tehlike] ?? 0 : null,
      aciklama: tehlike ? 'Tehlike sınıfı yükseldikçe hizmet süresi ve gelir potansiyeli artar' : 'Tehlike sınıfı seçilmedi' },
    { id: 'kaynak', ad: 'Kaynak', max: 20, puan: kaynak ? KAYNAK_PUANI[kaynak] ?? 0 : null,
      aciklama: kaynak ? `${KAYNAKLAR[kaynak] ?? kaynak}: kaynağın dönüşüm gücü` : 'Kaynak seçilmedi' },
    { id: 'gelir', ad: 'Tahmini aylık gelir', max: 30, puan: gelirPuani(sayi(gelir)),
      aciklama: sayi(gelir) === null ? 'Tahmini gelir girilmedi' : 'Aylık tahmini gelir basamağı' },
  ].map((p) => ({ ...p, eksik: p.puan === null, puan: p.puan ?? 0 }));
  const puan = parcalar.reduce((t, p) => t + p.puan, 0);
  return { puan, azami: parcalar.reduce((t, p) => t + p.max, 0), parcalar, eksikVar: parcalar.some((p) => p.eksik) };
}

export const puanSinifi = (p) => (p === null || p === undefined ? 'yok' : p >= 70 ? 'yuksek' : p >= 40 ? 'orta' : 'dusuk');

/** Tahmini toplam hizmet süresi (uzman + hekim, dakika). Kural bulunamazsa null. */
export function tahminiHizmetDakikasi({ calisan, tehlike, kurallar, tarih }) {
  if (calisan === null || calisan === undefined || calisan === '' || !tehlike) return null;
  const n = Number(calisan);
  if (!Number.isFinite(n) || n < 0) return null;
  const uzman = teorikDakika({ calisanSayisi: n, tehlikeSinifi: tehlike, personelTuru: 'is_guvenligi_uzmani', kurallar, tarih });
  const hekim = teorikDakika({ calisanSayisi: n, tehlikeSinifi: tehlike, personelTuru: 'isyeri_hekimi', kurallar, tarih });
  if (uzman.dakika === null || hekim.dakika === null) return null;
  return uzman.dakika + hekim.dakika;
}

/** Huni özeti: açık fırsat sayısı ve beklenen aylık gelir toplamı (aşama bazında). */
export function huniOzeti(firsatlar) {
  const ozet = Object.fromEntries(ASAMA_SIRASI.map((a) => [a, { adet: 0, tutar: 0 }]));
  for (const f of firsatlar) {
    if (f.archived_at || !ozet[f.stage]) continue;
    ozet[f.stage].adet += 1;
    ozet[f.stage].tutar += Number(f.expected_monthly ?? 0);
  }
  const acik = ACIK_ASAMALAR.reduce((t, a) => ({ adet: t.adet + ozet[a].adet, tutar: t.tutar + ozet[a].tutar }), { adet: 0, tutar: 0 });
  return { asamalar: ozet, acik };
}

/** Takip tarihi durumu: gecikmiş / bugün / yaklaşan / yok. bugun: 'YYYY-MM-DD'. */
export function takipDurumu(tarih, bugun) {
  if (!tarih) return 'yok';
  const t = String(tarih).slice(0, 10);
  if (t < bugun) return 'gecikmis';
  if (t === bugun) return 'bugun';
  return 'yaklasan';
}
