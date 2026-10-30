# Veri modeli (Aşama 1)

Şema dosyası: `supabase/01_sema.sql`. İsteğinizdeki 27 tablonun tamamı vardır; ayrıca ihtiyaç nedeniyle 6 yardımcı tablo eklendi (aşağıda işaretli). Toplam 33 tablo.

## Temel kurallar

| Kural | Nasıl uygulanıyor |
|---|---|
| Tek işletme, ileride SaaS | Her tabloda `organization_id` var; erişim RLS ile kuruma bağlı |
| Silme yok, arşiv var | `archived_at` / `archived_by`; `delete` yetkisi herkesten alındı |
| Geçmiş raporlar bozulmasın | Çalışan sayısı + tehlike sınıfı (`company_profiles`), personel maliyeti (`employee_costs`), sözleşme fiyatı (`contract_prices`), süre kuralları (`service_time_rules`), dağıtım kuralları (`allocation_rules`) `valid_from/valid_to` ile tarihçeli; **dönemlerin çakışması veri tabanı tarafından engellenir** |
| Para | `numeric(14,2)`; KDV hariç / KDV / KDV dahil ayrı sütun (dahil tutar otomatik hesaplanır) |
| Dakika ve dönem | Dakika `integer`; ay dönemleri `date` (ayın 1'i, kontrol kısıtı var) |
| Mükerrer firma | Vergi numarası bazlı benzersizlik (arşivlenmemiş kayıtlar için) |
| Mükerrer süre | `assignments.share_pct`: aynı firma + hizmet türü + dönemde paylar toplamı %100'ü aşamaz. Firmanın **toplam ihtiyacı** hesaplanır, tabloda **kişi payı** tutulur |
| Mükerrer gider | Ortak gider dağıtım havuzu yalnızca `cost_type = 'ortak'` giderlerden oluşur; dağıtılan toplam havuzu aşamaz |
| Zaman çakışması | Aynı personelin iki zaman kaydı çakışamaz (veri tabanı kısıtı) |
| Sözleşme ≠ resmî görevlendirme | Sözleşme tarihleri `contracts`'ta, resmî görevlendirme tarihleri `assignments.official_*` alanlarında ayrı tutulur |
| Gerçek gönderim | `outbound_messages`: durum, deneme sayısı, hata kaydı; gönderilmeden "gönderildi" yazılamaz |

## Tablolar

**Kurum ve erişim:** `organizations`, `roles`, `role_permissions`, `users`, `audit_logs`, `settings`

**Müşteri ve satış:** `companies`, `company_profiles` *(yardımcı: çalışan sayısı/tehlike sınıfı geçmişi)*, `contacts`, `leads`, `sales_opportunities`, `opportunity_stage_history` *(yardımcı: aşama değişikliği tarihi ve kullanıcısı)*, `activities`, `tasks`

**Teklif ve sözleşme:** `offers`, `offer_items`, `contracts`, `contract_prices`

**Personel ve hizmet süresi:** `employees`, `employee_costs`, `assignments`, `service_time_rules`, `time_entries`

**Gelir ve gider:** `invoices`, `invoice_items`, `payments`, `expenses`, `expense_categories`, `allocation_rules` *(yardımcı: dağıtım kuralı geçmişi)*, `overhead_allocations`

**Diğer:** `attachments`, `notifications`, `outbound_messages` *(yardımcı: e-posta/SMS/WhatsApp gönderim kaydı)*

**Görünüm (hesaplanır, saklanmaz):** `invoice_balances` (kalan alacak, tahsilat durumu, gecikme günü)

Bu 5 tablo/görünüm dışındaki "yardımcı" ihtiyaçlar (ör. firma ve kişi arasındaki ilişki) mevcut tablolarla karşılandı.

## Yabancı anahtar ilişkileri (otomatik üretildi)

`tablo.sütun -> hedef tablo` (her tabloda ayrıca `organization_id -> organizations` vardır)

```
activities.company_id -> companies
activities.contact_id -> contacts
activities.lead_id -> leads
activities.opportunity_id -> sales_opportunities
allocation_rules.category_id -> expense_categories
assignments.company_id -> companies
assignments.employee_id -> employees
attachments.company_id -> companies
attachments.contract_id -> contracts
attachments.offer_id -> offers
companies.responsible_user -> users
company_profiles.company_id -> companies
contacts.company_id -> companies
contacts.lead_id -> leads
contract_prices.contract_id -> contracts
contracts.company_id -> companies
contracts.offer_id -> offers
contracts.owner_user -> users
contracts.previous_contract_id -> contracts
employee_costs.employee_id -> employees
expenses.category_id -> expense_categories
expenses.company_id -> companies
expenses.employee_id -> employees
invoice_items.invoice_id -> invoices
invoices.company_id -> companies
invoices.contract_id -> contracts
leads.converted_company_id -> companies
leads.sales_owner -> users
notifications.user_id -> users
offer_items.offer_id -> offers
offers.company_id -> companies
offers.lead_id -> leads
offers.opportunity_id -> sales_opportunities
opportunity_stage_history.opportunity_id -> sales_opportunities
outbound_messages.approved_by -> users
outbound_messages.company_id -> companies
overhead_allocations.category_id -> expense_categories
overhead_allocations.company_id -> companies
overhead_allocations.employee_id -> employees
payments.invoice_id -> invoices
role_permissions.role_id -> roles
sales_opportunities.company_id -> companies
sales_opportunities.lead_id -> leads
sales_opportunities.owner_user -> users
tasks.assignee -> users
tasks.company_id -> companies
tasks.lead_id -> leads
time_entries.company_id -> companies
time_entries.employee_id -> employees
users.employee_id -> employees
users.role_id -> roles
```

## Henüz veri tabanında olmayanlar (bilinçli)

- **Müşteri puanlama formülü** (Aşama 3): `leads.score` ve `score_details` alanları hazır; formül ve ağırlıklar ayarlardan gelecek.
- **Kişi/firma bazlı fiilî maliyet hesabı** veri tabanında değil, hesaplama motorunda (`src/lib/hesaplama.js`) yapılır; raporlar bu motoru kullanacak.
- **Dosya depolama kovası** (Supabase Storage) ve kova erişim kuralları Aşama 4'te (belgeler ile birlikte) kurulacak.

## Aşama 2 ile eklenenler

- Fonksiyonlar: `firma_olustur`, `firma_profili_ekle` (çalışan sayısı/tehlike sınıfı dönemleri; açık dönemi başlangıçtan bir gün önce kapatır), `kullanici_ekle`, `kurum_kullanicilari`.
- `app.check_same_org` tetikleyicisi: firma-sorumlu kullanıcı, firma profili ve kişi kayıtları başka kurumun kaydına bağlanamaz. Diğer tablolara Aşama 10'da eklenecek.
- Denetim: `users` ve `role_permissions` değişiklikleri `audit_logs` içine yazılır.

## Aşama 3 ile eklenenler

- Fonksiyonlar: `potansiyel_olustur` (aday + yetki varsa ilk fırsat), `potansiyel_firmaya_donustur` (tek işlemde firma, ilk çalışan dönemi, yetkili kişi; kişi/fırsat/görüşme/görev taşıma; açık fırsatlar "kazanıldı").
- Tetikleyiciler: fırsat kapanış tarihi ve kayıp nedeni temizliği, görev tamamlanma tarihi, görüşme eklenince adayın son temas tarihi, kurumlar arası bağlantı koruması (aday, fırsat, görüşme, görev).
- Aşama geçmişi (`opportunity_stage_history`) her taşımada kullanıcı ve zamanla otomatik yazılır; "kaybedildi" için kayıp nedeni zorunludur.
- Potansiyel müşteri puanı (0-100): firma büyüklüğü 30 + tehlike sınıfı 20 + kaynak 20 + tahmini gelir 30. Ağırlıklar şimdilik kodda sabittir (`src/lib/puanlama.js`); Aşama 10'da ayarlardan değiştirilebilir olacak. Girilmeyen bilgi 0 puan sayılır ve "veri eksik" işaretlenir.

## Aşama 4 ile eklenenler

- Tablolar (01_sema'da vardı, 05'te kurallandı): `offers`, `offer_items`, `contracts`, `contract_prices`.
- Teklif durumları: taslak → onay bekliyor/gönderildi → görüşülüyor → kabul/ret/süresi doldu. Gönderildikten sonra fiyat alanları kilitlidir; değişiklik için kopyalanır.
- Sözleşme: aynı firmada tarihleri çakışan iki aktif sözleşme olamaz (veri tabanı kısıtı). Sona eren/feshedilen sözleşme değiştirilemez. Fiyat geçmişi silinmez, yalnızca yeni dönem eklenir.
- Fonksiyonlar: `teklif_kopyala`, `teklif_kabul_et`, `sozlesme_olustur`, `sozlesme_yenile`, `sozlesme_fiyat_ekle`, `sozlesme_yenileme_gorevleri`.
- Yenileme uyarıları: bitişe 90/60/30 gün kala her eşik için bir görev üretilir (tekrar üretilmez). Giriş yapıldığında çalışır.

## Aşama 5 ile eklenenler

- Tablolar (01_sema'da vardı, 06'da kurallandı): `employees`, `employee_costs`, `assignments`, `time_entries`.
- Görevlendirme: firma + personel + hizmet türü + pay (%) + dönem. Aynı firmada aynı hizmet türünün payları HER ANDA toplam %100'ü aşamaz. Başlamış görevlendirmenin payı değişmez; `gorevlendirme_degistir` eski dönemi kapatıp yeni payla yeni dönem açar.
- Teorik yük: personelin ayın 1'inde yürürlükteki görevlendirme payları x firmanın o ayki teorik hizmet ihtiyacı (firma profili kuralıyla aynı: ay içinde başlayan kayıt bir sonraki ay yansır).
- Zaman kaydı: başlangıç/bitiş, dakika kırılımı (saha, yol, bekleme, rapor, idari); aynı personelde çakışma veri tabanı kısıtıyla engellenir; `work_date` başlangıçtan (İstanbul saati) otomatik atanır.
- Uzman/hekim rolü (`uzman_hekim`): yalnızca kendi zaman kayıtlarını ve görevlendirmelerini görür; personel kaydı kullanıcıya `personel_kullanici_bagla` ile bağlanır.
- Personel maliyeti (`employee_costs`) yalnızca maaş (`payroll`) yetkisi olanlarca görülür; `personel_listesi` ad, tür ve kapasiteyi (hassas olmayan alanlar) diğer operasyon rollerine açar.


## Aşama 6 ile eklenenler

- Tablolar (01_sema'da vardı, 07'de kurallandı): `invoices`, `invoice_items`, `payments`, `expense_categories`, `expenses`; `invoice_balances` görünümü bakiyeyi hesaplar (saklanmaz).
- Tutarlar: faturada KDV hariç + KDV = KDV dahil (veri tabanı hesaplar). Tahsilat tutarı KDV dahildir; bir faturaya birden çok kısmi tahsilat girilebilir. Fazla tahsilat engellenmez, uyarı olarak gösterilir. Tahsilat iptal edilirse (arşiv) toplamdan çıkar.
- Fatura numarası boşsa `F-<yıl>-<sıra>` otomatik verilir; aynı sözleşme + hizmet dönemi için tek (arşivde olmayan) fatura kesilebilir.
- Tahsil durumu: tahsil edilmedi / kısmi / tahsil edildi (hesaplanır); itirazlı ve takip gerekiyor elle işaretlenir. Vade gecikmesi İstanbul gününe göre hesaplanır.
- Gider: KDV hariç tutar esas alınır (kâr hesabı için). Ortak gider firmaya/personele bağlanmaz; doğrudan gider tam olarak birine bağlanır. Ortak giderin dağıtımı Aşama 7'de yapılır; dağıtımı yapılmış havuz, dağıtılan tutarın altına düşürülemez.
- Maaş/personel maliyeti kategorisindeki giderler yalnızca maaş (`payroll`) yetkisi olanlarca görülür, eklenir ve değiştirilir.

## Aşama 7 ile eklenenler

- Yeni tablo yok; `allocation_rules` (ortak gider ölçütü, tarihçeli) ve `overhead_allocations` (kaydedilmiş dağıtım) kullanılır. Aynı dönem + kategori + firma için tek aktif dağıtım satırı vardır.
- `dagitim_olcutu_ayarla`: ölçütü ayın 1'inden itibaren değiştirir, eski kuralı bir gün öncesinde kapatır.
- `ortak_gider_dagitimini_kaydet`: bir dönem ve kategori için firma bazlı dağıtımı kaydeder; toplam, ortak gider havuzunu aşamaz.
- `karlilik_girdileri(ay)`: görevlendirme/zaman gibi doğrudan okuma yetkisi olmayan finans rolü için, kârlılık hesabında gereken asgari alanları döndürür (yalnızca firma veya personel kârlılığı görüntüleme yetkisiyle).
- Hesap tarayıcıda yapılır (`src/lib/karlilik.js`); veri tabanına hesaplanmış kâr yazılmaz, yalnızca kaydedilen ortak gider dağıtımı saklanır.

## Aşama 8 ile eklenenler

- Veri tabanında değişiklik yoktur. Raporlar ve dışa aktarma, tarayıcıda kullanıcının görebildiği kayıtlardan hazırlanır (RLS aynen geçerlidir).
- İçe aktarma mevcut işlemleri kullanır: firmalar `firma_olustur` (çalışan sayısı + tehlike sınıfı varsa ilk dönem kaydıyla), kişiler doğrudan `contacts` ekleme. Böylece tüm kurallar, denetim kaydı ve yetki kontrolleri veri tabanında yine uygulanır.
- Mükerrer kuralı: aktif bir firmayla aynı vergi numarası ya da aynı ad (büyük/küçük harf ve boşluk fark etmez) atlanır; arşivdeki firmayla aynı vergi numarası yalnızca uyarıdır. Kişilerde aynı firmada aynı e-posta ya da aynı ad soyad atlanır.
- CSV dosyalarında formül enjeksiyonuna karşı metin hücreleri `=`, `+`, `-`, `@` ile başlıyorsa başına `'` konur.

## Aşama 9 ile eklenenler

- Yeni tablo yok; `settings` ve `service_time_rules` (01_sema'da vardı) artık yalnızca fonksiyonlarla değiştirilir.
- `ayar_kaydet(anahtar, değer, geçerlilik)`: yalnızca dört sayısal ayar (kapasite_dakika, kurumlar_vergisi_orani, marj_esigi_yuzde, varsayilan_kdv_orani) kabul edilir; aralık denetlenir (kapasite 60-44.640 tam sayı, oranlar 0-100). Tarih ayın 1'i olmalı ve bu aydan önce olamaz. Aynı tarihe tekrar kayıt değeri düzeltir.
- `hizmet_suresi_kurali_ekle(personel türü, tehlike, dakika, geçerlilik, not)`: açık kural bir gün önce kapatılır, yenisi açılır; dakika 0-600; sonradan başlayan kural varken öne eklenemez; aynı dakika girilirse değişiklik yapılmaz. Çakışma ayrıca veri tabanı dışlama kısıtıyla da engellenir.
- İkisi de "settings" modülünde oluşturma + düzenleme izni ister; okuma kurumdaki tüm kullanıcılara açıktır (hesaplamalar için).

## Aşama 10 ile eklenenler

- `email_digest_log`: günlük özet gönderim kaydı (kurum, gün, tür `gunluk`/`test`, durum `gonderildi`/`atlandi`/`hata`, ayrıntı). Yalnızca "settings" görüntüleme izni olanlar okur; kimse tarayıcıdan yazamaz (yazma yalnızca Edge Function'dan). Aynı kurum için günde en çok bir başarılı `gunluk` kaydı olabilir (benzersiz indeks) — aynı gün ikinci e-postayı veri tabanı da engeller.
- `gunluk_ozet(kurum)`: özet verisini üretir (vadesi geçmiş faturalar, 7 gün içinde vadesi gelenler, 90 gün içinde biten sözleşmeler, geciken görevler; listeler en çok 10 satır, sayılar tümünü kapsar). Yalnızca `service_role` çağırabilir; tarayıcıdan çağrılamaz.
- E-posta gönderimi `supabase/functions/gunluk-ozet/index.ts` Edge Function'ındadır; alıcı yalnızca `OZET_ALICI` gizli ayarından gelir (tek adres).

## Aşama 11 ile eklenenler

- Yeni tablo yok. `audit_logs` (01_sema'dan beri tetikleyicilerle dolar) artık bir ekrandan okunur.
- Denetim kaydı okuma izni daraltıldı: "Kullanıcılar" görüntüleme izni **ve** kaydın ait olduğu modülün görüntüleme izni gerekir (`app.audit_modul(tablo)` eşlemesi). Böylece yetkisi devredilen biri maaş (`employee_costs` → `payroll`) değişikliklerini göremez.
- `app.tam_yetkili()`: 21 modülün hepsinde görüntüleme izni var mı. `yedek_kaydi(tablo_sayisi, satir_sayisi, dosya)` yalnızca buna sahip kullanıcıya çalışır ve denetim kaydına `yedek / BACKUP` satırı yazar (içerik değil, yalnızca sayılar). Tarayıcıdan `audit_logs`'a yazmanın tek yolu budur; güncelleme ve silme kapalıdır.
- Yedek dosyası (JSON, sürüm 1): `uygulama`, `surum`, `olusturma`, `kurum`, `sayilar`, `toplam_satir`, `eksik_tablolar`, `ozet_sha256` (tüm tablo verisinin SHA-256 özeti) ve `tablolar`. Doğrulama özeti yeniden hesaplar; dosya değişmişse ya da bozulmuşsa yakalar.
- Denetim kaydı yalnızca ekleme ve güncellemeyi içerir; fiziksel silme zaten kapalı olduğundan "silme" arşivleme olarak (güncelleme) görünür.

## Aşama 12 ile eklenenler

- `offer_shares`: teklif başına müşteri bağlantıları (anahtarın **SHA-256 özeti** `token_hash`, son geçerlilik, iptal, görüntüleme sayacı, müşteri yanıtı ve notu). Bir teklif için iptal edilmemiş en çok bir bağlantı vardır. Girişsiz kullanıcı tabloya hiç erişemez; girişli kullanıcı yalnızca okur ve `token_hash` sütununu okuyamaz. Denetim kaydına `token_hash` yazılmaz.
- Sahip fonksiyonları (giriş + "Teklifler" düzenleme izni): `teklif_baglantisi_olustur(teklif, gün, not)` anahtarı **bir kez** döndürür; `teklif_baglantisi_iptal(teklif)`.
- Müşteri fonksiyonları (girişsiz çağrılabilir, yalnızca izinli alanları döndürür): `teklif_paylasim_goruntule(anahtar)` ve `teklif_paylasim_yanitla(anahtar, karar, ad, not)`. Geçersiz, süresi dolmuş, iptal edilmiş, arşivlenmiş teklif bağlantıları birbirinden ayırt edilemez ("geçersiz"). Yanıt teklif durumunu **değiştirmez**; `offer_share:<id>` kaynaklı yüksek öncelikli bir görev üretir (mükerrer olmaz).
- Bağlantılar yedek dosyasına **girmez** (gizli anahtar özeti içerir; geri yüklemede zaten yeniden oluşturulur).
