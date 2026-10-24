# OSGB 360 (karmacrm)

OSGB işletmesi için CRM, teklif, sözleşme, hizmet süresi ve kârlılık yazılımı.
Tek işletme için çalışır; veri modeli ileride SaaS'a geçişe hazırdır (her tabloda `organization_id`).

> Bu yazılım **yönetim amaçlı analiz** yapar. Resmî muhasebe, vergi beyannamesi veya mevzuat hesabı yerine geçmez.
> Hizmet süresi parametreleri işletme sahibinin tanımladığı değerlerdir; güncel mevzuata uygunluğu ayrıca doğrulanmalıdır.

## Durum

| Aşama | Konu | Durum |
|---|---|---|
| 1 | Mimari, veri modeli, hesaplama motoru | **Tamam, onayınızı bekliyor** |
| 2 | Giriş, roller, firma kartları, kişiler | Sırada |
| 3–10 | CRM, teklif, sözleşme, personel, gelir/gider, kârlılık, panel, yapay zekâ, yayın | Planlandı |

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
├─ supabase/
│  ├─ 01_sema.sql            Tablolar, RLS, denetim, tarihçe kısıtları (33 tablo)
│  └─ 02_ilk_kurulum.sql     İlk kurum + ilk kullanıcı (bir kez çalıştırılır)
├─ src/
│  ├─ lib/hesaplama.js       Hesaplama motoru (saf fonksiyonlar, arayüzden bağımsız)
│  └─ styles/tokens.css      Tasarım değişkenleri (Gurizon CRM görünümü)
├─ tests/
│  ├─ hesaplama.test.js      Motor testleri (Node)
│  ├─ db_tests.sql           Veri tabanı testleri (PostgreSQL)
│  ├─ supabase_stub.sql      Yalnızca yerel test için Supabase taklidi
│  └─ db_test_cikti.txt      Son DB test çıktısı
└─ docs/
   ├─ 01-kurulum-rehberi.md  Adım adım Supabase/GitHub kurulumu
   ├─ 02-yetki-matrisi.md    6 rol × 21 modül
   └─ 03-veri-modeli.md      Tablolar, ilişkiler, kurallar
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
psql -d osgb -f tests/db_tests.sql
```

## Gizli bilgiler

`.env` dosyaları ve `*.xlsx / *.csv` dosyaları `.gitignore` ile dışarıda tutulur. `service_role` ve yapay zekâ anahtarları
hiçbir koşulda depoya girmez.
