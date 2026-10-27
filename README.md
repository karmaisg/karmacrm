# OSGB 360 (karmacrm)

OSGB işletmesi için CRM, teklif, sözleşme, hizmet süresi ve kârlılık yazılımı.
Tek işletme için çalışır; veri modeli ileride SaaS'a geçişe hazırdır (her tabloda `organization_id`).

> Bu yazılım **yönetim amaçlı analiz** yapar. Resmî muhasebe, vergi beyannamesi veya mevzuat hesabı yerine geçmez.
> Hizmet süresi parametreleri işletme sahibinin tanımladığı değerlerdir; güncel mevzuata uygunluğu ayrıca doğrulanmalıdır.

## Durum

| Aşama | Konu | Durum |
|---|---|---|
| 1 | Mimari, veri modeli, hesaplama motoru | Tamam, onaylandı |
| 2 | Giriş, roller, firma kartları, kişiler | Tamam, onaylandı |
| 3 | CRM, potansiyel müşteri, satış fırsatları, görüşmeler, görevler | Tamam |
| 4 | Teklifler (canlı kârlılık), sözleşmeler, fiyat geçmişi, yenileme uyarıları | **Tamam, onayınızı bekliyor** |
| 5–10 | Personel ve görevlendirme, gelir/gider, kârlılık, panel, yapay zekâ, yayın | Planlandı |

## Mimari

| Katman | Seçim |
|---|---|
| Arayüz | Düz HTML + CSS + JavaScript (ES modülleri), Türkçe, derleme adımı yok |
| Yayın | GitHub Pages (yalnızca statik dosya) |
| Veri tabanı | Supabase PostgreSQL |
| Giriş | Supabase Auth (kayıt kapalı, kullanıcıları işletme sahibi ekler) |
| Yetki | Row Level Security: kurallar veri tabanındadır, butonları gizlemek güvenlik sayılmaz |
| Gizli işlemler | Supabase Edge Functions (yapay zekâ anahtarı, e-posta/SMS) — Aşama 9 |

## Klasörler

```
karmacrm/
├─ index.html                Uygulama girişi (CSP burada)
├─ supabase/
│  ├─ 01_sema.sql            Tablolar, RLS, denetim, tarihçe kısıtları (33 tablo)
│  ├─ 02_ilk_kurulum.sql     İlk kurum + ilk kullanıcı (bir kez)
│  ├─ 03_asama2.sql          Aşama 2 fonksiyonları ve korumaları (bir kez)
│  ├─ 04_asama3.sql          Aşama 3: CRM, fırsat, görev fonksiyonları (bir kez)
│  └─ 05_asama4.sql          Aşama 4: teklif, sözleşme kuralları ve fonksiyonları (bir kez)
├─ src/
│  ├─ main.js                Açılış, oturum, yönlendirme
│  ├─ config.js              Supabase adresi ve anon anahtarı (gizli değildir)
│  ├─ modules.js             Menü ve modül tanımları
│  ├─ lib/                   api.js (Supabase), hesaplama.js, ticari.js, format.js, veri.js, router.js
│  ├─ pages/                 auth, panel, firmalar, firma, kisiler, kullanicilar, crm, firsatlar, gorevler, gorusmeler, teklifler, sozlesmeler, placeholder
│  ├─ ui/                    components.js, shell.js (kenar menü/üst çubuk/arama), icons.js
│  └─ styles/                tokens.css, app.css
├─ tests/
│  ├─ hesaplama.test.js      Motor testleri (Node)
│  ├─ db_tests.sql, db_tests_asama2.sql, db_tests_asama3.sql, db_tests_asama4.sql   Veri tabanı testleri (PostgreSQL)
│  ├─ ui/                    Arayüz testleri (Playwright + sahte Supabase istemcisi)
│  ├─ supabase_stub.sql      Yalnızca yerel test için Supabase taklidi
│  └─ db_test_cikti*.txt     Son DB test çıktıları
└─ docs/                     Kurulum, yayın, yetki matrisi, veri modeli
```

## Testleri çalıştırma

Motor testleri (Node 18+):

```
npm test
```

Veri tabanı testleri yerel bir PostgreSQL 16 gerektirir (Supabase'e dokunmaz):

```
psql -d osgb -f tests/supabase_stub.sql
psql -d osgb -f supabase/01_sema.sql
psql -d osgb -f supabase/03_asama2.sql
psql -d osgb -f supabase/04_asama3.sql
psql -d osgb -f supabase/05_asama4.sql
psql -d osgb -f tests/db_tests.sql
psql -d osgb -f tests/db_tests_asama2.sql
psql -d osgb -f tests/db_tests_asama3.sql
psql -d osgb -f tests/db_tests_asama4.sql
```

Arayüz testleri (Node + Playwright; gerçek Supabase'e bağlanmaz, sahte istemci kullanır):

```
node tests/ui/ui.test.mjs
```

## Gizli bilgiler

`.env` dosyaları ve `*.xlsx / *.csv` dosyaları `.gitignore` ile dışarıda tutulur. `service_role` ve yapay zekâ anahtarları
hiçbir koşulda depoya girmez.
