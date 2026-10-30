// OSGB 360 - Denetim kaydı: ham kaydı okunur Türkçe özete çevirir (saf fonksiyonlar). Testler: tests/denetim.test.js
// Veri tabanı (audit_logs) kimin neyi ne zaman değiştirdiğini zaten yazar; bu dosya yalnızca gösterimi hazırlar.
import { tarih } from './format.js';

export const TABLO_ADLARI = {
  companies: 'Firma', company_profiles: 'Firma profili', contacts: 'Kişi', leads: 'Potansiyel müşteri', sales_opportunities: 'Satış fırsatı',
  opportunity_stage_history: 'Fırsat aşama geçmişi', activities: 'Görüşme', tasks: 'Görev', offers: 'Teklif', offer_items: 'Teklif kalemi',
  contracts: 'Sözleşme', contract_prices: 'Sözleşme fiyatı', employees: 'Personel', employee_costs: 'Personel maliyeti', assignments: 'Görevlendirme',
  time_entries: 'Zaman kaydı', invoices: 'Fatura', invoice_items: 'Fatura kalemi', payments: 'Tahsilat', expenses: 'Gider',
  expense_categories: 'Gider kategorisi', allocation_rules: 'Dağıtım kuralı', overhead_allocations: 'Ortak gider dağıtımı',
  settings: 'Ayar', service_time_rules: 'Hizmet süresi kuralı', users: 'Kullanıcı', role_permissions: 'Yetki', attachments: 'Ek dosya',
  notifications: 'Bildirim', outbound_messages: 'Giden mesaj', yedek: 'Yedek',
};
export const tabloAdi = (t) => TABLO_ADLARI[t] ?? t;

export const ALAN_ADLARI = {
  name: 'Ad', full_name: 'Ad soyad', title: 'Başlık', email: 'E-posta', phone: 'Telefon', tax_no: 'Vergi no', tax_office: 'Vergi dairesi',
  address: 'Adres', city: 'Şehir', status: 'Durum', stage: 'Aşama', priority: 'Öncelik', note: 'Not', notes: 'Notlar', description: 'Açıklama',
  amount: 'Tutar', amount_excl_vat: 'Tutar (KDV hariç)', vat_amount: 'KDV', vat_rate: 'KDV oranı', invoice_no: 'Fatura no', offer_no: 'Teklif no',
  invoice_date: 'Fatura tarihi', due_date: 'Vade', due_at: 'Son tarih', paid_at: 'Ödeme tarihi', start_date: 'Başlangıç', end_date: 'Bitiş',
  valid_from: 'Geçerlilik başı', valid_to: 'Geçerlilik sonu', archived_at: 'Arşiv tarihi', is_active: 'Aktif', flag: 'Tahsilat işareti',
  employee_count: 'Çalışan sayısı', hazard_class: 'Tehlike sınıfı', staff_type: 'Personel türü', gross_salary: 'Brüt maaş', employer_sgk: 'İşveren SGK',
  other_benefits: 'Diğer yan haklar', total_monthly_cost: 'Aylık toplam maliyet', unit_price: 'Birim fiyat', fixed_monthly_price: 'Sabit aylık fiyat',
  discount_pct: 'İskonto %', pricing: 'Fiyatlandırma', key: 'Anahtar', value: 'Değer', can_view: 'Görüntüleme', can_create: 'Oluşturma',
  can_edit: 'Düzenleme', can_archive: 'Arşivleme', module: 'Modül', role_id: 'Rol', minutes_per_employee: 'Çalışan başına dakika',
  company_id: 'Firma', employee_id: 'Personel', contract_id: 'Sözleşme', invoice_id: 'Fatura', offer_id: 'Teklif', category_id: 'Kategori',
  start_at: 'Başlangıç zamanı', end_at: 'Bitiş zamanı', minutes: 'Dakika', kind: 'Tür', source: 'Kaynak', loss_reason: 'Kayıp nedeni',
  expense_date: 'Gider tarihi', period: 'Dönem', completed_at: 'Tamamlanma', tablo_sayisi: 'Tablo sayısı', satir_sayisi: 'Satır sayısı', dosya: 'Dosya',
};
export const alanAdi = (a) => ALAN_ADLARI[a] ?? a.replace(/_/g, ' ');

const GURULTU = new Set(['id', 'organization_id', 'created_at', 'updated_at', 'created_by', 'updated_by']);
const ISIM_ALANLARI = ['name', 'full_name', 'title', 'invoice_no', 'offer_no', 'key'];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TARIH = /^\d{4}-\d{2}-\d{2}$/;
const ZAMAN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
const SAYI = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 2 });

/** Tek bir değeri insanın okuyacağı metne çevirir. */
export function degerMetni(v) {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'boolean') return v ? 'Evet' : 'Hayır';
  if (typeof v === 'number') return SAYI.format(v);
  if (typeof v === 'object') { const j = JSON.stringify(v); return j.length > 80 ? `${j.slice(0, 77)}…` : j; }
  const s = String(v);
  if (UUID.test(s)) return `kayıt …${s.slice(-6)}`;
  if (TARIH.test(s)) return tarih(s);
  if (ZAMAN.test(s)) { const d = new Date(s); if (!Number.isNaN(d.getTime())) return `${tarih(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`)} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; }
  if (/^[a-z0-9]+(_[a-z0-9]+)+$/.test(s)) return s.replace(/_/g, ' ');
  return s.length > 80 ? `${s.slice(0, 77)}…` : s;
}

const nesne = (x) => (x && typeof x === 'object' && !Array.isArray(x) ? x : {});
const ayniMi = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** Kaydın içinden okunur bir ad seçer; yoksa "Tablo …son6". */
export function kayitAdi(tablo, veri, kayitId = null) {
  const v = nesne(veri);
  for (const a of ISIM_ALANLARI) if (typeof v[a] === 'string' && v[a].trim()) return v[a].trim();
  if (tablo === 'payments' && v.amount !== undefined) return `${SAYI.format(Number(v.amount))} TL tahsilat`;
  if (tablo === 'role_permissions' && v.module) return `${v.module} yetkisi`;
  const id = String(kayitId ?? v.id ?? '');
  return id ? `${tabloAdi(tablo)} …${id.slice(-6)}` : tabloAdi(tablo);
}

/** UPDATE: yalnızca değişen alanlar; INSERT: dolu alanlar (en çok `sinir`). Gürültü alanları (id, tarihler) atlanır. */
export function degisiklikler(satir, sinir = 12) {
  const eski = nesne(satir.old_data); const yeni = nesne(satir.new_data);
  const alanlar = [...new Set([...Object.keys(eski), ...Object.keys(yeni)])].filter((a) => !GURULTU.has(a));
  let liste;
  if (satir.action === 'UPDATE') liste = alanlar.filter((a) => !ayniMi(eski[a], yeni[a])).map((a) => ({ alan: a, ad: alanAdi(a), eski: degerMetni(eski[a]), yeni: degerMetni(yeni[a]) }));
  else liste = alanlar.filter((a) => yeni[a] !== null && yeni[a] !== undefined && yeni[a] !== '').map((a) => ({ alan: a, ad: alanAdi(a), eski: null, yeni: degerMetni(yeni[a]) }));
  return { liste: liste.slice(0, sinir), fazla: Math.max(0, liste.length - sinir) };
}

/** "Eklendi / Güncellendi / Arşivlendi / Arşivden çıkarıldı / Yedek alındı" */
export function islemEtiketi(satir) {
  if (satir.action === 'BACKUP') return 'Yedek alındı';
  if (satir.action === 'INSERT') return 'Eklendi';
  if (satir.action === 'UPDATE') {
    const e = nesne(satir.old_data); const y = nesne(satir.new_data);
    if (!e.archived_at && y.archived_at) return 'Arşivlendi';
    if (e.archived_at && !y.archived_at) return 'Arşivden çıkarıldı';
    return 'Güncellendi';
  }
  return satir.action;
}
export const ISLEM_TONU = { Eklendi: 'success', Güncellendi: 'info', Arşivlendi: 'warning', 'Arşivden çıkarıldı': 'info', 'Yedek alındı': 'success' };

/** Süzgeç tarihlerini (YYYY-MM-DD, Türkiye saati) ISO sınırlarına çevirir. */
export function tarihSiniri(baslangic, bitis) {
  const gecerli = (s) => typeof s === 'string' && TARIH.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));
  return {
    bas: gecerli(baslangic) ? `${baslangic}T00:00:00+03:00` : null,
    bit: gecerli(bitis) ? `${bitis}T23:59:59.999+03:00` : null,
    hata: gecerli(baslangic) && gecerli(bitis) && baslangic > bitis ? 'Başlangıç tarihi bitiş tarihinden sonra olamaz.' : null,
  };
}

export const KAYIT_ID_DESENI = UUID;
