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
