// OSGB 360 - Menü ve modül tanımları.
// Menü, projenin 21 modülünü içerir. Henüz yapılmamış modüller "Aşama N" etiketiyle görünür.

/** Yetki matrisindeki modüller (veri tabanındaki role_permissions.module değerleri). */
export const MODUL_ADLARI = {
  dashboard: 'Yönetici paneli',
  crm: 'CRM ve potansiyel müşteriler',
  companies: 'Firmalar ve müşteri kartları',
  contacts: 'Kişiler ve iletişim geçmişi',
  opportunities: 'Satış fırsatları',
  offers: 'Teklifler',
  contracts: 'Sözleşmeler ve yenilemeler',
  staff: 'Uzman ve hekim kayıtları',
  assignments: 'Görevlendirmeler',
  time: 'Zaman ve ziyaret takibi',
  invoices: 'Gelirler ve tahsilatlar',
  expenses: 'Giderler',
  payroll: 'Maaş ve personel maliyeti (hassas)',
  staff_profit: 'Personel kârlılığı',
  company_profit: 'Firma kârlılığı',
  capacity: 'Kapasite analizi',
  reports: 'Raporlar',
  tasks: 'Hatırlatmalar ve görevler',
  import_export: 'Veri içe/dışa aktarma',
  users: 'Kullanıcılar ve yetkiler',
  settings: 'Sistem ayarları',
};

export const MODUL_SIRASI = Object.keys(MODUL_ADLARI);

export const ROL_SIRASI = ['sistem_yoneticisi', 'isletme_sahibi', 'satis', 'operasyon', 'finans', 'uzman_hekim'];

export const ROL_ADLARI = {
  sistem_yoneticisi: 'Sistem yöneticisi',
  isletme_sahibi: 'İşletme sahibi',
  satis: 'Satış sorumlusu',
  operasyon: 'Operasyon sorumlusu',
  finans: 'Finans sorumlusu',
  uzman_hekim: 'Uzman / hekim',
};

export const AYRICALIKLI_ROLLER = ['sistem_yoneticisi', 'isletme_sahibi'];

export const GRUPLAR = [
  { id: 'genel', ad: 'Genel' },
  { id: 'satis', ad: 'Satış' },
  { id: 'operasyon', ad: 'Operasyon' },
  { id: 'finans', ad: 'Finans' },
  { id: 'yonetim', ad: 'Yönetim' },
];

/**
 * id: adres (#/id), modul: yetki modülü, yapildi: ekranı hazır mı, asama: hangi aşamada gelecek.
 */
export const MENU = [
  { id: 'panel', grup: 'genel', modul: 'dashboard', ad: 'Yönetici paneli', simge: 'layout', yapildi: true },
  { id: 'firmalar', grup: 'genel', modul: 'companies', ad: 'Firmalar', simge: 'building', yapildi: true },
  { id: 'kisiler', grup: 'genel', modul: 'contacts', ad: 'Kişiler', simge: 'contact', yapildi: true },

  { id: 'crm', grup: 'satis', modul: 'crm', ad: 'CRM ve potansiyel müşteriler', simge: 'target', yapildi: true },
  { id: 'firsatlar', grup: 'satis', modul: 'opportunities', ad: 'Satış fırsatları', simge: 'kanban', yapildi: true },
  { id: 'teklifler', grup: 'satis', modul: 'offers', ad: 'Teklifler', simge: 'file', yapildi: true,
    aciklama: 'Kişi başı veya sabit fiyatlı teklifler, anlık kârlılık hesabı ve PDF çıktısı.' },
  { id: 'sozlesmeler', grup: 'satis', modul: 'contracts', ad: 'Sözleşmeler ve yenilemeler', simge: 'contract', yapildi: true,
    aciklama: 'Sözleşme dönemleri, fiyat geçmişi ve 90/60/30 gün yenileme uyarıları.' },

  { id: 'uzmanlar', grup: 'operasyon', modul: 'staff', ad: 'Uzmanlar', simge: 'shield', yapildi: true,
    aciklama: 'İş güvenliği uzmanı kayıtları, kapasite ve maliyet bilgisi.' },
  { id: 'hekimler', grup: 'operasyon', modul: 'staff', ad: 'İşyeri hekimleri', simge: 'pulse', yapildi: true,
    aciklama: 'İşyeri hekimi kayıtları, kapasite ve maliyet bilgisi.' },
  { id: 'gorevlendirmeler', grup: 'operasyon', modul: 'assignments', ad: 'Görevlendirmeler', simge: 'briefcase', yapildi: true,
    aciklama: 'Uzman ve hekimlerin firmalara görevlendirmesi, hizmet payları ve yürürlük tarihleri.' },
  { id: 'zaman', grup: 'operasyon', modul: 'time', ad: 'Zaman ve ziyaret takibi', simge: 'clock', yapildi: true,
    aciklama: 'Fiilî çalışma, yol ve bekleme süreleri; zaman çakışması kontrolü.' },
  { id: 'kapasite', grup: 'operasyon', modul: 'capacity', ad: 'Kapasite analizi', simge: 'gauge', yapildi: true,
    aciklama: 'Teorik yük ve fiilî süreye göre uzman ve hekim doluluk oranları.' },
  { id: 'gorevler', grup: 'operasyon', modul: 'tasks', ad: 'Hatırlatmalar ve görevler', simge: 'checksq', yapildi: true },

  { id: 'tahsilat', grup: 'finans', modul: 'invoices', ad: 'Gelirler ve tahsilatlar', simge: 'wallet', yapildi: true,
    aciklama: 'Faturalar, kısmi tahsilatlar, vade ve gecikme takibi.' },
  { id: 'giderler', grup: 'finans', modul: 'expenses', ad: 'Giderler', simge: 'receipt', yapildi: true,
    aciklama: 'Doğrudan ve ortak giderler; KDV hariç ve dahil tutarlar.' },
  { id: 'personel-karlilik', grup: 'finans', modul: 'staff_profit', ad: 'Personel kârlılığı', simge: 'trend', asama: 7,
    aciklama: 'Uzman ve hekim bazında gelir, maliyet ve katkı kârı.' },
  { id: 'firma-karlilik', grup: 'finans', modul: 'company_profit', ad: 'Firma kârlılığı', simge: 'bars', asama: 7,
    aciklama: 'Firma bazında katkı kârı, ortak gider payı ve vergi öncesi kâr katkısı.' },

  { id: 'raporlar', grup: 'yonetim', modul: 'reports', ad: 'Raporlar', simge: 'bars', asama: 8,
    aciklama: 'Aylık yönetici raporu ve Excel/CSV dışa aktarımları.' },
  { id: 'aktarim', grup: 'yonetim', modul: 'import_export', ad: 'Veri içe/dışa aktarma', simge: 'upload', asama: 8,
    aciklama: 'Excel ve CSV içe aktarma: sütun eşleştirme, önizleme ve mükerrer kayıt kontrolü.' },
  { id: 'kullanicilar', grup: 'yonetim', modul: 'users', ad: 'Kullanıcılar ve yetkiler', simge: 'lock', yapildi: true },
  { id: 'ayarlar', grup: 'yonetim', modul: 'settings', ad: 'Sistem ayarları', simge: 'settings', asama: null,
    aciklama: 'Hizmet süresi parametreleri, kâr marjı eşiği, vergi oranı ve gider dağıtım kuralları.' },
];

export const menuOgesi = (id) => MENU.find((m) => m.id === id);
