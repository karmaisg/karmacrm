# Kurulum rehberi (Supabase + GitHub)

Bu rehber kod bilmeden izlenebilir. Her adımın sonunda ne görmeniz gerektiği yazılıdır.
Adım 1–7 Aşama 1'de yapıldı. **Aşama 2 için yalnızca "Aşama 2 kurulumu" bölümünü (en altta) uygulayın.**

> **Güvenlik kuralı:** Supabase'in iki anahtarı vardır.
> - `anon public` anahtarı tarayıcı kodunda durabilir. Veriyi koruyan şey bu anahtarın gizli olması değil, veri tabanındaki erişim kurallarıdır (RLS).
> - `service_role` anahtarı **her şeyi açar**. Hiçbir zaman GitHub'a, dosyaya, ekran görüntüsüne veya sohbete yapıştırmayın. Bana da göndermeyin.

---

## Adım 1 — GitHub deposunu oluşturun

1. GitHub'da `karmaisg` alanına girin, **New repository** deyin.
2. Ad: `karmacrm`.
3. **README, .gitignore, license eklemeyin** (boş kalsın). Benim hazırladığım dosyalar yüklenecek.
4. Public mi Private mı:
   - **Public:** GitHub Pages ile ücretsiz yayımlanır. Depoda gizli bilgi ve müşteri verisi **olmayacak**; veriler Supabase'de durur. Kod herkese açık olur.
   - **Private:** Kod gizli kalır, ancak GitHub Pages ile yayımlamak için ücretli GitHub planı gerekebilir. Güncel koşulu GitHub'ın kendi sayfasından kontrol edin.
5. Oluşturunca bana haber verin; deponun bağlantısını yazın.

Beklenen sonuç: Boş bir `karmaisg/karmacrm` deposu.

## Adım 2 — Supabase projesini açın

1. https://supabase.com adresinde hesap açın (GitHub ile giriş yapabilirsiniz).
2. **New project** deyin. Ad: `osgb360`.
3. **Database password** alanına güçlü bir şifre yazın ve bir şifre yöneticisine kaydedin. Kaybederseniz sıfırlanır, ama not alın.
4. Bölge: size en yakın Avrupa bölgesi (örn. Frankfurt).
5. Plan: **Free** (geliştirme için onayladınız).
6. Proje hazır olana kadar birkaç dakika bekleyin.

Beklenen sonuç: Projenin kontrol paneli açılır.

**Ücretsiz planın sınırları (kurulum sırasında Supabase'in güncel sayfasından doğrulayın):**
- Uzun süre kullanılmayan ücretsiz projeler duraklatılabilir.
- Otomatik yedekleme sınırlı ya da yok olabilir.
- Gerçek müşteri ve finans verisiyle canlıya geçmeden önce ücretli plana geçmeyi ve yedekleme ayarını birlikte değerlendireceğiz. Siz onaylamadan hiçbir ücretli plan açılmaz.

## Adım 3 — Şemayı yükleyin

1. Sol menüden **SQL Editor** → **New query**.
2. Depodaki `supabase/01_sema.sql` dosyasının **tamamını** kopyalayıp yapıştırın.
3. **Run** deyin.

Beklenen sonuç: Alt kısımda "Success. No rows returned". Kırmızı hata çıkarsa ekran görüntüsünü bana gönderin (anahtar içermediğinden emin olun).

Bu dosya 33 tablo, erişim kuralları (RLS), denetim kaydı ve tarihçe kısıtlarını kurar. **Bir kez** çalıştırılır; tekrar çalıştırmayın.

## Adım 4 — Kendi kullanıcınızı oluşturun

1. **Authentication → Users → Add user → Create new user**.
2. Kendi e-postanızı ve güçlü bir şifre girin. **Auto Confirm User** kutusunu işaretleyin.
3. Oluşan satırdaki **User UID** değerini kopyalayın (uzun bir kod: `xxxxxxxx-xxxx-...`).

## Adım 5 — İlk kurulum betiğini çalıştırın

1. Depodaki `supabase/02_ilk_kurulum.sql` dosyasını açın.
2. Yalnızca şu satırlardaki değerleri düzenleyin: `v_kullanici_id` (Adım 4'teki UID), `v_sirket_adi`, `v_ad_soyad`, `v_eposta`.
3. SQL Editor'da yeni sorguya yapıştırıp **Run** deyin.

Beklenen sonuç: "Kurulum tamam" mesajı. Bu sizi **İşletme sahibi** rolüyle kaydeder; 6 rol, yetki matrisi, hizmet süresi parametreleri ve 17 gider kategorisi hazır gelir.

Betik ikinci kez çalıştırılırsa "Kurulum zaten yapılmış" diyerek durur; verinizi bozmaz.

## Adım 6 — Kimlik doğrulama ayarları

1. **Authentication → Sign In / Providers** (ya da *Settings*) bölümünde **Allow new users to sign up** seçeneğini **kapatın**. Tek işletme için kullanıcıları siz ekleyeceksiniz.
2. **Authentication → URL Configuration** bölümünde **Site URL** alanına ileride yayımlayacağımız adresi yazacağız (`https://karmaisg.github.io/karmacrm/`). Şimdilik boş bırakabilirsiniz.

## Adım 7 — İki bilgiyi bana iletin

**Project Settings → API** sayfasından:

- **Project URL** (`https://....supabase.co`)
- **anon public** anahtarı

Bu ikisi tarayıcı kodunda durabilir; bana yazabilirsiniz. **`service_role` anahtarını göndermeyin.**

---

## Kurulumun doğru olduğunu nasıl anlarım?

SQL Editor'da şu sorguyu çalıştırın:

```sql
select
  (select count(*) from roles)              as roller,        -- 6 olmalı
  (select count(*) from role_permissions)   as yetki_satiri,  -- 126 olmalı
  (select count(*) from service_time_rules) as sure_kurali,   -- 6 olmalı
  (select count(*) from expense_categories) as gider_kategori; -- 17 olmalı
```

## Yedekleme (şimdiden alışkanlık edinin)

- Ücretsiz planda otomatik yedeğe güvenmeyin. Önemli bir veri girişinden önce **Database → Backups** bölümünü kontrol edin.
- Aşama 8'de her rapor Excel/CSV olarak dışa aktarılabilecek; bu da ikinci bir yedek olur.
- Aşama 8'deki içe aktarma, mevcut kayıtların üzerine yazmadan önce otomatik yedek alacak şekilde tasarlanacak.


---

## Aşama 2 kurulumu (giriş ekranı ve firma/kişi ekranları için)

### A) 03_asama2.sql dosyasını çalıştırın (bir kez)

1. Supabase > **SQL Editor** > **New query**.
2. `supabase/03_asama2.sql` dosyasının **tamamını** yapıştırıp **Run** deyin.
3. Beklenen sonuç: "Success. No rows returned". Dosya tekrar çalıştırılırsa zarar vermez, ama gerekmez.

Bu dosya: firma ve ilk çalışan kaydını tek işlemde oluşturan, çalışan sayısı dönemini kapatıp yenisini açan, kullanıcı ekleyen fonksiyonları; kendi rolünüzü değiştirmenizi, İşletme sahibi/Sistem yöneticisi yetkilerini bozmanızı ve başka kuruma ait kayıt bağlamayı engelleyen korumaları ekler.

### B) Adres ayarları (şifre sıfırlama bağlantısı için)

**Authentication > URL Configuration**:
- **Site URL:** `https://karmaisg.github.io/karmacrm/`
- **Redirect URLs** listesine aynı adresi ekleyin.

### C) Yeni kullanıcı nasıl eklenir?

Tarayıcıdaki uygulama güvenlik nedeniyle giriş hesabı **oluşturamaz**. İki adım:
1. Supabase > **Authentication > Users > Add user > Create new user** (e-posta + şifre, **Auto Confirm User** işaretli).
2. Uygulamada **Kullanıcılar ve yetkiler > Kullanıcı ekle**: aynı e-postayı, ad soyadı ve rolü yazın.

Hesabı Supabase'de açmadan 2. adımı yaparsanız "hesabı bulunamadı" uyarısı alırsınız.


---

## Aşama 3 kurulumu (CRM, satış fırsatları, görüşmeler, görevler)

1. Supabase > **SQL Editor** > **New query**.
2. `supabase/04_asama3.sql` dosyasının **tamamını** yapıştırıp **Run** deyin. Beklenen: "Success. No rows returned".
3. (Önce `03_asama2.sql` çalıştırılmış olmalıdır.) Dosya tekrar çalıştırılırsa zarar vermez.
4. GitHub'daki dosyaları yeni sürümle değiştirin (zip içindeki tüm klasörü yeniden yükleyin).

Bu dosya: potansiyel müşteri + ilk satış fırsatını tek işlemde oluşturan fonksiyon, potansiyel müşteriyi firmaya dönüştüren fonksiyon (kişi, görüşme, fırsat ve görevleri firmaya taşır), fırsat kapanış/kayıp nedeni ve görev tamamlanma tarihlerini otomatik tutan tetikleyiciler, son temas tarihinin otomatik güncellenmesi ve kurumlar arası bağlantı korumalarını ekler.
