# Rol - yetki matrisi (Aşama 1 taslağı)

Bu tablo `supabase/01_sema.sql` içindeki varsayılan yetkilerle **birebir aynıdır** (veri tabanından üretildi).
Yetkiler veri tabanında `role_permissions` tablosunda durur ve ileride **Kullanıcılar ve Yetkiler** ekranından değiştirilebilir.

**Kısaltmalar:** **G** = Görüntüle, **O** = Oluştur, **D** = Düzenle, **A** = Arşivle (silme yok), **—** = erişim yok

| Modül | Sistem yöneticisi | İşletme sahibi | Satış sorumlusu | Operasyon sorumlusu | Finans sorumlusu | Uzman / hekim |
|---|:-:|:-:|:-:|:-:|:-:|:-:|
| Yönetici Paneli | GODA | GODA | G | G | G | — |
| CRM ve Potansiyel Müşteriler | GODA | GODA | GODA | — | — | — |
| Firmalar ve Müşteri Kartları | GODA | GODA | GOD | GOD | G | G |
| Kişiler ve İletişim Geçmişi | GODA | GODA | GODA | GOD | — | — |
| Satış Fırsatları | GODA | GODA | GODA | — | — | — |
| Teklifler | GODA | GODA | GODA | — | — | — |
| Sözleşmeler ve Yenilemeler | GODA | GODA | G | G | G | — |
| Uzman ve Hekim Kayıtları | GODA | GODA | — | GOD | G | — |
| Görevlendirmeler | GODA | GODA | — | GODA | — | G |
| Zaman ve Ziyaret Takibi | GODA | GODA | — | GODA | — | GOD |
| Gelirler ve Tahsilatlar | GODA | GODA | — | — | GODA | — |
| Giderler | GODA | GODA | — | — | GODA | — |
| Maaş ve Personel Maliyeti (hassas) | GODA | GODA | — | — | GOD | — |
| Personel Kârlılığı | GODA | GODA | — | — | G | — |
| Firma Kârlılığı | GODA | GODA | — | — | GOD | — |
| Kapasite Analizi | GODA | GODA | G | G | — | — |
| Raporlar | GODA | GODA | G | G | G | — |
| Hatırlatmalar ve Görevler | GODA | GODA | GODA | GODA | GOD | GOD |
| Veri İçe/Dışa Aktarma | GODA | GODA | G | G | GO | — |
| Kullanıcılar ve Yetkiler | GODA | GODA | — | — | — | — |
| Sistem Ayarları | GODA | GODA | — | — | — | — |

## Güvenlik kuralları

- Yetkiler **veri tabanında (RLS)** uygulanır. Arayüzde buton gizlemek tek başına güvenlik sayılmaz.
- **Maaş ve personel maliyeti** (`employee_costs` tablosu ve "maaş/SGK" gider kategorileri) yalnızca *Maaş ve Personel Maliyeti* yetkisi olanlara görünür.
- Satış sorumlusu müşteri ve teklif kayıtlarını görür; fatura, gider ve maaşları **görmez**.
- Hiçbir rol kayıt **silemez**; yalnızca *Arşivle* yetkisi olan roller arşivleyebilir ve arşivleyen kullanıcı kaydedilir.
- Denetim kayıtları (`audit_logs`) değiştirilemez ve silinemez.
- Her kullanıcı yalnızca kendi kurumunun verisini görür (SaaS'a geçişte kurumlar birbirinden ayrı kalır).

## Bilinen sınırlamalar (sonraki aşamalarda ele alınacak)

1. **"Yalnızca kendi kayıtlarını gör" kuralı henüz yok.** Uzman/hekim kullanıcısı, yetkisi olan modüllerde (zaman kayıtları, görevler, firmalar) kurumdaki **tüm** kayıtları görür. Kendi görevlendirmesi dışındaki firmaları gizleme kuralı Aşama 5'te eklenecek.
2. **Yönetici panelinde parça bazlı yetki** (ör. satışçıya tahsilat kartlarını gizleme) panel yazılırken (Aşama 8) uygulanacak. Veri tabanı zaten bu verileri satışçıya vermiyor.

## Aşama 2 ile eklenen korumalar (veri tabanında zorlanır)

- Kullanıcı kendi rolünü ve aktiflik durumunu değiştiremez (kilitlenme önlemi).
- İşletme sahibi ve Sistem yöneticisi rollerini yalnızca bu iki roldeki kullanıcılar atayabilir/değiştirebilir.
- Bu iki rolün yetki matrisi arayüzden veya API'den değiştirilemez; diğer dört rolün matrisi "Kullanıcılar ve yetkiler > Yetki matrisi"nden düzenlenir ve her değişiklik denetim kaydına yazılır.
- Arşivleme ve arşivden çıkarma "arşivle" yetkisi gerektirir; arşiv alanları elle bozulamaz.
