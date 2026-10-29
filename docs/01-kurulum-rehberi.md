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


---

## Aşama 4 kurulumu (teklifler ve sözleşmeler)

1. Supabase > **SQL Editor** > **New query**.
2. `supabase/05_asama4.sql` dosyasının **tamamını** yapıştırıp **Run** deyin. Beklenen: "Success. No rows returned".
3. (Önce `04_asama3.sql` çalıştırılmış olmalıdır.) Dosya tekrar çalıştırılırsa zarar vermez.
4. GitHub'daki dosyaları yeni sürümle değiştirin (zip içindeki tüm klasörü yeniden yükleyin).

Bu dosya: teklif numarası (TKL-2026-0001), teklif durum geçiş kuralları (gönderilen teklifin fiyatı kilitlenir), teklif kopyalama, teklifi kabul edip sözleşmeye çevirme (indirim fiyata işlenir, fırsat "kazanıldı" olur), sözleşme dönemleri, aynı firmada tarih çakışan aktif sözleşmeyi engelleme, değiştirilemez fiyat geçmişi, sözleşme yenileme ve 90/60/30 gün yenileme görevi üretimini ekler.

Önemli: varsayılan yetki matrisinde **Satış** rolü teklifleri oluşturup düzenleyebilir ama sözleşmeleri yalnızca görüntüler. Teklifi kabul edip sözleşme oluşturmak için İşletme sahibi/Sistem yöneticisi kullanın ya da Kullanıcılar > Yetkiler ekranından Satış rolüne "sözleşme oluştur/düzenle" yetkisi verin.


---

## Aşama 5 kurulumu (uzman/hekim, görevlendirme, zaman takibi, kapasite)

1. Supabase > **SQL Editor** > **New query**.
2. `supabase/06_asama5.sql` dosyasının **tamamını** yapıştırıp **Run** deyin. Beklenen: "Success. No rows returned".
3. (Önce `05_asama4.sql` çalıştırılmış olmalıdır.) Dosya tekrar çalıştırılırsa zarar vermez.
4. GitHub'daki dosyaları yeni sürümle değiştirin (zip içindeki tüm klasörü yeniden yükleyin).

Bu dosya: görevlendirme hizmet payı denetiminin düzeltilmiş hali (ardışık dönemleri çakışıyormuş gibi saymaz), görevlendirmenin türünün personelle uyumu, başlamış görevlendirmenin payının geçmişi bozmaması (pay değişimi için yeni dönem açılır), açık görevlendirmesi olan personelin arşivlenememesi, zaman kaydında İstanbul saatine göre otomatik tarih, gelecek tarihli ve 24 saati aşan kaydın engellenmesi, uzman/hekim rolünün yalnızca kendi kayıtlarını görmesi, personel maliyet dönemi ve kullanıcı-personel bağlama fonksiyonlarını ekler.

Uzman veya hekimin kendi hesabıyla zaman girebilmesi için: Uzmanlar (veya İşyeri hekimleri) > personel sayfası > **Giriş hesabı** bölümünden personel kaydını kullanıcıya bağlayın.


---

## Aşama 6 kurulumu (faturalar, tahsilatlar, giderler)

1. Supabase > **SQL Editor** > **New query**.
2. `supabase/07_asama6.sql` dosyasının **tamamını** yapıştırıp **Run** deyin. Beklenen: "Success. No rows returned".
3. (Önce `06_asama5.sql` çalıştırılmış olmalıdır.) Dosya tekrar çalıştırılırsa zarar vermez.
4. GitHub'daki dosyaları yeni sürümle değiştirin (zip içindeki tüm klasörü yeniden yükleyin).

Bu dosya: fatura numarasını otomatik verme (F-2026-0001), vade/firma/sözleşme doğrulaması, bir sözleşme için bir hizmet dönemine tek fatura, tahsilatı olan faturanın arşivlenememesi, tahsilatta gelecek tarih engeli, fatura tamamen ödenince açık "tahsilat takibi" görevinin kapanması, gider kuralları (ortak gider firmaya bağlanmaz, doğrudan gider tam olarak bir firmaya ya da personele bağlanır, maaş kategorisi maaş yetkisi ister) ve `fatura_kaydet`, `donem_faturalari_olustur`, `tahsilat_gecikme_gorevleri`, `gider_kaydet` fonksiyonlarını ekler.

Kullanım: **Gelirler ve tahsilatlar** sayfasında "Aylık faturaları oluştur" ile aktif sözleşmelerin o ayki faturaları tek tıkla üretilir; kişi başı sözleşmelerde tutar, o tarihte geçerli çalışan sayısıyla hesaplanır. Vadesi geçen faturalar için giriş yapıldığında görev üretilir (Finans veya İşletme sahibi girişinde).

---

## Aşama 7 kurulumu (personel ve firma kârlılığı, ortak gider dağıtımı)

1. Supabase > **SQL Editor** > **New query**.
2. `supabase/08_asama7.sql` dosyasının **tamamını** yapıştırıp **Run** deyin. Beklenen: "Success. No rows returned".
3. (Önce `06_asama5.sql` ve `07_asama6.sql` çalıştırılmış olmalıdır; sırayla 01, 03, 04, 05, 06, 07, 08.) Dosya tekrar çalıştırılırsa zarar vermez.
4. GitHub'daki dosyaları yeni sürümle değiştirin, tarayıcıda Ctrl+F5 yapın.

Kullanım: **Firma kârlılığı** ve **Personel kârlılığı** sayfaları aylık çalışır. Gelir, fatura hizmet dönemine göre KDV hariç alınır; personel maliyeti o ayın başında geçerli maliyet kaydından gelir. "Teorik" yöntem maliyeti görevlendirme payına, "fiili" yöntem girilen saha+rapor dakikasına göre firmalara dağıtır; kullanılmayan kısım "boşta kapasite" olarak firmalara yüklenmez. Ortak giderler kategori başına seçtiğiniz ölçüte göre (gelir oranı, fiili süre, müşteri/personel/ziyaret sayısı) dağıtılır; "Dağıtımı kaydet" ile o ayın değerleri dondurulur. Sayfalar maaş, gider ve fatura görüntüleme yetkilerini birlikte ister.

Bu sayılar yönetim tahminidir; resmî muhasebe veya vergi hesabı yerine geçmez. Maaş kategorisindeki giderler, personel maliyetiyle çift sayılmaması için hesaba katılmaz (uyarı çıkar).

---

## Aşama 8 kurulumu (raporlar, CSV dışa ve içe aktarma)

Aşama 8 için **Supabase'de çalıştıracağınız yeni SQL dosyası yoktur**; veri tabanında değişiklik yapılmaz.

1. GitHub'daki dosyaları yeni sürümle değiştirin (zip içindeki tüm klasörü yeniden yükleyin).
2. Tarayıcıda Ctrl+F5 yapın.

Kullanım:

- **Raporlar:** raporu ve (aylık raporlarda) ayı seçin; tablo ekranda görünür, "CSV indir" aynı tabloyu dosya olarak verir. Bir raporu görmek için o raporun kullandığı modüllerin (firma, sözleşme, fatura, gider) görüntüleme izni gerekir.
- **Veri içe/dışa aktarma > Dışa aktar:** firma, kişi, sözleşme, fatura, tahsilat ve giderler CSV olarak iner. Dosya Excel'de çift tıklayınca doğru açılır (Türkçe karakterler ve noktalı virgül ayırıcı).
- **İçe aktar:** önce "Boş şablonu indir" ile sütun başlıklarını görün; dosyanızı seçin, sütunları eşleştirin, önizlemeyi kontrol edin ve "kaydı aktar"a basın. Hatalı satırlar ve kayıtlı firmayla aynı vergi numarası/adı olan satırlar (mükerrer) aktarılmaz; bunları ayrı CSV olarak indirebilirsiniz.
- Excel (.xlsx) dosyasını doğrudan okumuyoruz: Excel'de **Farklı kaydet > CSV UTF-8 (virgülle ayrılmış)** seçin.
- İçe aktarma izni: Veri içe/dışa aktarma modülünde "oluşturma" izni ve aktarılacak modülde (firma veya kişi) oluşturma izni gerekir. Varsayılan olarak yalnızca işletme sahibi ve sistem yöneticisi bu izne sahiptir.
- Toplu aktarımın geri alma düğmesi yoktur; yanlış eklenen kayıtlar tek tek arşivlenebilir. Büyük dosyalardan önce 2-3 satırlık deneme dosyasıyla deneyin.

---

## Aşama 9 kurulumu (sistem ayarları)

1. Supabase > **SQL Editor** > **New query**.
2. `supabase/09_asama9.sql` dosyasının **tamamını** yapıştırıp **Run** deyin. Beklenen: "Success. No rows returned".
3. (Önce 01, 03, 04, 05, 06, 07 ve 08 numaralı dosyalar çalıştırılmış olmalıdır.) Dosya tekrar çalıştırılırsa zarar vermez.
4. GitHub'daki dosyaları yeni sürümle değiştirin, tarayıcıda Ctrl+F5 yapın.

Kullanım: **Sistem ayarları** sayfasında dört genel parametre (aylık kapasite, kurumlar vergisi oranı, kâr marjı eşiği, varsayılan KDV oranı) ve altı hizmet süresi kuralı (uzman/hekim × az tehlikeli/tehlikeli/çok tehlikeli, çalışan başına dakika) değiştirilir. Her değişiklik, seçtiğiniz ayın 1'inden itibaren geçerli olur; geçmiş aylar eski değerle kalır ve **geçmiş aya değişiklik yapılamaz**. "Bu ay" seçerseniz bu ayın rakamları da değişir; çoğu zaman "gelecek ay" daha güvenlidir.

Varsayılan olarak yalnızca işletme sahibi ve sistem yöneticisi bu sayfayı görür ve değiştirir. Başka bir role görüntüleme izni verirseniz sayfa salt okunur açılır.

Bu aşamada değiştirilemeyenler: sözleşme yenileme uyarı günleri (90/60/30 sabittir) ve e-posta/SMS gönderimi (henüz yok; ayrı bir karar gerektirir).
