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

## Aşama 10 kurulumu (günlük özet e-postası — yalnızca size)

Her sabah 08:00'de **yalnızca sizin e-posta adresinize** özet gider: vadesi geçmiş faturalar, 7 gün içinde vadesi gelenler, 90 gün içinde biten sözleşmeler, geciken görevler. Müşterilere hiçbir şey gönderilmez. Bildirilecek bir şey yoksa e-posta gönderilmez. Bu adımlar bir kez yapılır; menü adları Supabase arayüzünde zamanla değişebilir, bulamazsanız ekran görüntüsü gönderin.

1. **SQL:** Supabase > SQL Editor'de `supabase/10_asama10.sql` dosyasının tamamını çalıştırın ("Success" görmelisiniz).
2. **Resend hesabı:** resend.com'da **kendi e-posta adresinizle** ücretsiz hesap açın, API Keys bölümünden bir anahtar oluşturun (`re_...` ile başlar). Alan adı doğrulamadan yalnızca **Resend hesabınızın e-posta adresine** gönderebilirsiniz; bu işimiz için yeterlidir. Gönderen adres `onboarding@resend.dev` olduğundan ilk e-postalar istenmeyen klasörüne düşebilir; "spam değil" deyin.
3. **Gizli ayarlar:** Supabase > Edge Functions > Secrets bölümüne üç kayıt ekleyin:
   - `RESEND_API_KEY` = Resend anahtarınız
   - `OZET_ALICI` = özetin gideceği tek e-posta adresi (Resend hesabınızdakiyle aynı olmalı)
   - `OZET_CRON_SIRRI` = kendi ürettiğiniz uzun rastgele bir metin (en az 30 karakter; başka yere yazmayın)
4. **Fonksiyonu yükleyin:** Edge Functions > "Deploy a new function" > editörle; adı tam olarak `gunluk-ozet`; `supabase/functions/gunluk-ozet/index.ts` dosyasının içeriğini yapıştırıp Deploy edin. Fonksiyon ayarlarında **"Verify JWT"** seçeneğini **kapatın** (kimlik doğrulamayı fonksiyon kendisi yapar: ya gizli başlık ya da giriş yapmış yetkili kullanıcı).
5. **Test:** Uygulamada Sistem ayarları > "Günlük özet e-postası" kartında **Test e-postası gönder**'e basın. Gelen kutunuzda "[TEST]" ile başlayan e-posta görünmeli; kartta "Gönderildi" kaydı çıkar. Hata olursa kartta ve uyarıda nedeni yazar (ör. `OZET_ALICI tanımlı değil`).
6. **Zamanlama:** Database > Extensions'dan `pg_cron` ve `pg_net`'i açın. SQL Editor'de aşağıdakini **kendi değerlerinizle** çalıştırın (`BURAYA_SIRRI_YAZIN` = 3. adımdaki `OZET_CRON_SIRRI` ile aynı metin):

```sql
select vault.create_secret('BURAYA_SIRRI_YAZIN', 'ozet_cron_sirri');

select cron.schedule('osgb360-gunluk-ozet-1', '0 5 * * *', $$
  select net.http_post(
    url := 'https://hstvzdumaabqdwdzsbcx.supabase.co/functions/v1/gunluk-ozet',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-ozet-sirri', (select decrypted_secret from vault.decrypted_secrets where name = 'ozet_cron_sirri')),
    body := '{}'::jsonb) $$);

-- İsteğe bağlı yedek: ilk deneme başarısız olursa 09:00'da yeniden dener (başarılı gönderim varsa atlanır)
select cron.schedule('osgb360-gunluk-ozet-2', '0 6 * * *', $$
  select net.http_post(
    url := 'https://hstvzdumaabqdwdzsbcx.supabase.co/functions/v1/gunluk-ozet',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-ozet-sirri', (select decrypted_secret from vault.decrypted_secrets where name = 'ozet_cron_sirri')),
    body := '{}'::jsonb) $$);
```

Saatler UTC'dir; Türkiye UTC+3 olduğu için `0 5` = 08:00, `0 6` = 09:00. Kapatmak için: `select cron.unschedule('osgb360-gunluk-ozet-1');`

**Gizlilik notu:** Özette müşteri adları ve tutarlar bulunur ve e-posta Resend üzerinden geçer. Alıcı adresi ve anahtar kodda ya da GitHub'da değil, yalnızca Supabase gizli ayarlarındadır; uygulama bunları göstermez.

## Aşama 11 kurulumu (denetim kaydı ve yedekleme)

1. **SQL:** Supabase > SQL Editor'de `supabase/11_asama11.sql` dosyasının tamamını çalıştırın ("Success" görmelisiniz). Dosya güvenle yeniden çalıştırılabilir.
2. **Denetim kaydı:** menüde Yönetim > **Denetim kaydı**. Kim, neyi, ne zaman değiştirdi; tür, işlem, kullanıcı ve tarihe göre süzülür. Bir satırdaki "alan değişti" yazısına tıklayınca eski ve yeni değer görünür. Kayıtlar değiştirilemez ve silinemez.
3. **Yedekleme:** Yönetim > **Yedekleme** > "Yedeği indir". Tüm veriler tek bir `.json` dosyası olarak bilgisayarınıza iner. En az haftada bir alın; dosyayı bilgisayarınız dışında da (ör. şifreli bir bulut klasörü) saklayın.
4. **Yedeği doğrulama:** aynı sayfadaki "Yedek dosyasını doğrula" ile eski bir yedeğin bozulmadığını kontrol edebilirsiniz (veri yüklenmez, değişmez).

**Bilmeniz gerekenler**
- Supabase ücretsiz planında otomatik yedek **yoktur**; bu ekran sizin tek yedeğinizdir. Ücretli planda günlük yedek vardır (ayrıntı: Supabase fiyatlandırma sayfası).
- Yedek dosyası maaşlar ve müşteri bilgileri içerir. Başkalarıyla paylaşmayın, e-postayla göndermeyin.
- Kullanıcı giriş şifreleri yedekte yoktur (Supabase Auth'ta ayrı tutulur).
- Bu ekran **geri yüklemez**. Veri kaybı olursa yedek dosyasını saklayıp destek alın; yanlış bir geri yükleme güncel kayıtları ezebilir.
- Tam yedek yalnızca tüm modülleri görebilen kullanıcıya (işletme sahibi, sistem yöneticisi) açıktır; aksi halde yedek eksik veri içerirdi.

## Aşama 12 kurulumu (müşteriye teklif bağlantısı)

Teklifi müşteriye giriş gerektirmeyen gizli bir bağlantıyla gösterirsiniz; müşteri teklifi görür, yazdırır ve **Kabul ediyorum / Kabul etmiyorum** yanıtı verebilir. **Sistem müşteriye hiçbir e-posta veya mesaj göndermez**; bağlantıyı siz kopyalayıp WhatsApp, e-posta vb. ile iletirsiniz.

1. **SQL:** Supabase > SQL Editor'de `supabase/12_asama12.sql` dosyasının tamamını çalıştırın ("Success" görmelisiniz). Güvenle yeniden çalıştırılabilir. Başka kurulum adımı yoktur.
2. **Bağlantı oluşturma:** bir teklifi açın, teklifi **"Müşteriye gönder"** yapın (taslakta bağlantı oluşturulamaz). Sayfanın altındaki **Müşteri bağlantısı** kartında "Bağlantı oluştur"a basın, süreyi (7–90 gün) ve istersen müşteriye kısa bir not seçin.
3. **Bağlantıyı kopyalayın:** açılan pencerede bağlantı **yalnızca o an** gösterilir (güvenlik için sistemde yalnızca özeti saklanır). Kopyalamayı unutursanız yeni bağlantı oluşturun; eskisi kapanır.
4. **Müşteri yanıtı:** müşteri yanıt verince teklif sayfasındaki kartta "Müşteri yanıtı: KABUL/RED" (ad, zaman, not) görünür ve **Görevler**'e yüksek öncelikli bir görev eklenir (günlük özet e-postasında da çıkar). Teklif durumu ve sözleşme **kendiliğinden değişmez**: müşteriyle görüştükten sonra "Sözleşme oluştur" ya da "Reddedildi" işlemini siz yaparsınız.
5. **İptal:** kartın "Bağlantıyı iptal et" düğmesi bağlantıyı hemen kapatır. Teklif arşivlenirse, süre dolarsa veya yeni bağlantı oluşturulursa eski bağlantı da kapanır.

**Güvenlik özeti**
- Bağlantıdaki anahtar 64 karakterdir ve tahmin edilemez; adresin `#` sonrasındadır, yani sunucu kayıtlarına ve yönlendiren (Referer) bilgisine girmez. Bağlantıya sahip olan herkes teklifi görebilir; yalnızca güvendiğiniz kişiye gönderin.
- Müşteriye yalnızca fiyat, kalem, firma adı, geçerlilik ve sizin yazdığınız not gösterilir. **Maliyet tahmini, kâr marjı, iç açıklama ve hazırlayan kişi asla gösterilmez** (veri tabanı bu alanları hiç döndürmez).
- Müşteri yalnızca bir kez yanıt verebilir; sonradan değiştirmek için sizinle iletişime geçmesi istenir.
- Müşterinin yanıtı ön bilgi niteliğindedir; hizmet sözleşmesini yine kendi süreçlerinizle düzenleyip imzalatın.

**Not:** Teklif sayfasındaki "Yazdır / PDF" artık kârlılık, fiyat senaryoları ve bağlantı kartını yazdırmaz (eskiden iç kârlılık da çıktıya girerdi). Müşteriye PDF göndermek isterseniz bağlantıyı açıp oradan "Yazdır / PDF" kullanın.

## Aşama 12.1 kurulumu (yanıt geldiğinde e-posta + takip)

Müşteri teklifi kabul ya da reddettiğinde **yalnızca size** e-posta gelir (müşteriye hiçbir şey gitmez). Ayrıca Teklifler listesinde ve panelde yanıt durumu görünür.

1. **SQL:** Supabase > SQL Editor'de `supabase/13_asama13.sql` dosyasını çalıştırın ("Success"). Yeniden çalıştırılabilir.
2. **Edge Function'ı güncelleyin:** Supabase > Edge Functions > `gunluk-ozet` > kodu, güncel `supabase/functions/gunluk-ozet/index.ts` içeriğiyle değiştirip **Deploy** edin (adı ve "Verify JWT" kapalı ayarı aynı kalır).
3. **Fonksiyon adresini kaydedin (bir kez):** SQL Editor'de şunu çalıştırın. Zaten kayıtlıysa "duplicate key" hatası verir; sorun değildir.
   `select vault.create_secret('https://hstvzdumaabqdwdzsbcx.supabase.co/functions/v1/gunluk-ozet', 'ozet_fonksiyon_adresi');`
   (`ozet_cron_sirri` gizli kaydı Aşama 10'da zaten oluşturulmuştu; pg_net eklentisi de oradan açıktır.)
4. **Deneme:** bir teklifin bağlantısını kendiniz açıp yanıt verin; birkaç saniye içinde e-posta gelmelidir. Sistem ayarları > özet günlüğünde "Teklif yanıtı" satırı görünür. E-posta gelmezse müşteri yanıtı yine de kaydedilir ve Görevler'e düşer; günlükteki hata satırına bakın.

**Takip nasıl yapılır?** (1) e-posta, (2) Görevler'de yüksek öncelikli görev, (3) Teklifler listesinde "Müşteri KABUL etti / reddetti — işleyin" rozeti ve **Yanıt bekleyen / Yanıt geldi (işlenmedi)** filtreleri, (4) panelde "Yanıt geldi, işlenmedi" sayacı. Teklif durumu bilerek kendiliğinden değişmez; görüştükten sonra siz "Sözleşme oluştur" veya "Reddedildi" yaparsınız, rozet de o zaman kalkar.

**Bilinen sınırlar:** e-posta Resend'in kısıtına tabidir (kendi alan adınızı doğrulamadıkça yalnızca Resend hesap adresinize gider); Supabase projesi duraklatılmışsa e-posta gitmez; yanıt e-postası gitmezse otomatik yeniden denenmez (günlükte "hata" görünür).

## Aşama 13 kurulumu (İSG-Katip Excel aktarımı: işyeri/sicil, çalışan sayısı, görevli bilgisi)

İSG-Katip'ten aldığınız **"İSG Hizmet Sözleşme Süreçleri"** Excel'ini (.xlsx) ara ara yüklersiniz. Sistem o aya ait firma çalışan sayılarını, tehlike sınıflarını, görevli uzman/hekimi ve onaylayan kişiyi okur; firma adlarını sistemdeki firmalarla eşleştirir ve **bir önceki yüklemeye göre değişiklikleri size uyarı olarak gösterir.**

1. **SQL:** Supabase > SQL Editor'de `supabase/14_asama13_katip.sql` dosyasını çalıştırın ("Success"). Yeniden çalıştırılabilir. (Önce 13_asama13.sql çalıştırılmış olmalı.) Başka kurulum adımı yoktur; Excel tarayıcıda okunur, CSV'ye çevirmeniz gerekmez.
2. **Yükleme:** menüde **Yönetim > İSG-Katip aktarımı**. Dönem (ay) seçin, Excel dosyasını seçin. Hiçbir şey siz "Aktarımı uygula" demeden yazılmaz.
3. **Ekrandaki bölümler**
   - *Önceki yüklemeye göre değişiklikler:* çalışan sayısı, tehlike sınıfı (hizmet sürelerini etkiler), görevli uzman/hekim, çalışma süresi, firma kişisi (onaylayan), yeni işyeri ve dosyada artık olmayan işyeri. Önemli olanlar (görevli, tehlike sınıfı, ayrılan işyeri) işaretlenir.
   - *Eşleştirme soruları:* Excel'deki unvan sistemdekiyle birebir aynı değilse (ör. "Seterm Teknik" varken Excel'de "Seterm Servis" de varsa) her biri için sorulur: sistemdeki bir firmaya bağla / aynı dosyadaki benzer unvanla **birleştir** (çalışan sayıları toplanır) / yeni firma oluştur / aktarma. Sistem; "A.Ş.", "Ltd. Şti." gibi ekleri, kısaltmaları (TEM. = TEMİZLEME) ve küçük yazım farklarını yok sayarak benzerlik puanı verir.
   - *Excel'de var, sistemde yok:* yeni firma olarak eklenecekler listelenir (adını düzeltebilir ya da "aktarma" diyebilirsiniz).
   - *Sistemde var, Excel'de yok:* aktif müşteri firmalar listelenir; sözleşmesi bitmişse **"Eski müşteri yap"** ile pasife alırsınız (hiçbir şey silinmez).
   - *Firma bazında sonuç:* her firmanın toplam çalışan sayısı ve tehlike sınıfları.
4. **Bir firmanın birden çok işyeri (sicil):** her SGK/DETSİS sicil numarası ayrı bir işyeridir; hepsi aynı firmaya bağlanırsa çalışan sayıları toplanır ve toplu fatura bu firmaya kesilir. **Fatura edilen firma Excel'deki unvandan farklıysa** (A firmasına fatura kesiyorsunuz ama Katip'te B adına atama var) sicili A firmasına bağlayın. Bu eşleşme kaydedilir; bir sonraki yüklemede aynı sicil için tekrar sorulmaz. Sayfanın altındaki **İşyerleri ve sicil numaraları** tablosundan istediğiniz zaman değiştirebilirsiniz.
5. **Farklı tehlike sınıflı işyerleri:** aynı firmanın işyerleri farklı tehlike sınıfındaysa (ör. 40 çalışan az tehlikeli + 8 çalışan çok tehlikeli) firma kartı toplam çalışan sayısını ve en yüksek sınıfı gösterir, ancak **uzman/hekim hizmet süresi her işyerinin kendi sınıfına göre ayrı hesaplanıp toplanır** (kapasite, yük ve firma sayfalarındaki "aylık ihtiyaç" dahil).
6. **Firma kartı:** uygulanınca her firmanın çalışan sayısı/tehlike sınıfı seçtiğiniz ayın başından itibaren güncellenir; eski değerler geçmişte kalır (geçmiş ay hesapları bozulmaz). Dosyada olmayan işyerleri silinmez, "Dosyada yok" olarak pasife alınır.
7. **Onaylayan kişi:** Excel'deki "Onaylayan Kişi Ad Soyad" firmanın **Kişiler** listesine "İSG-Katip onaylayan" unvanıyla eklenir (aynı ad varsa tekrar eklenmez). Değişirse yükleme ekranında uyarı çıkar.
8. **TC kimlik numaraları** görevli kişi kaydında saklanır ve yalnızca maaş (payroll) yetkisi olan kullanıcılar (işletme sahibi, sistem yöneticisi, finans) görür. Yükleme satırlarını (kim hangi firmada kaç dakika) personel izni olanlar görür.

**Bilinen sınırlar (Aşama 13):** görevli kişiler ve süreler bu aşamada yalnızca "o günkü görüntü" olarak saklanır ve karşılaştırılır; uzman/hekim kayıtlarının ve **Görevlendirmeler** sayfasının bu verilerle otomatik güncellenmesi Aşama 14'tür. Excel'deki sütun başlıkları değişirse (zorunlu: görevli adı, sertifika tipi, çalışma süresi, hizmet alan unvan/sicil/çalışan sayısı/tehlike sınıfı) sistem eksik sütunları açıkça söyler. Fatura ve gider Excel formları sonraki aşamalardadır.

## Aşama 14 kurulumu (Katip görevlendirmelerini Uzmanlar/Hekimler ve Görevlendirmeler'e yansıtma)

Excel'i yükleyip aktardıktan sonra **İSG-Katip aktarımı** sayfasında **"Görevlendirmeleri güncelle"** kartı çıkar. Sistem Katip'teki görevli uzman/hekimleri personelinize bağlar, her firma için hizmet payını (kişinin Katip süresi ÷ firmanın o ayki teorik ihtiyacı) önerir. **Siz onaylamadan hiçbir kayıt yazılmaz.**

1. **SQL:** Supabase > SQL Editor'de `supabase/15_asama14.sql` dosyasını çalıştırın ("Success"). Yeniden çalıştırılabilir. (Önce 14_asama13_katip.sql çalıştırılmış olmalı.)
2. **Personel eşleşmesi:** önce sertifika numarasına, yoksa ada bakılır. Adla eşleşen personelin sertifika numarası kaydedilir (sonraki yüklemelerde numarayla bulunur). Hiç eşleşmeyen kişi için **yeni personel** önerilir (tür, sertifika tipi ve numarasıyla).
3. **Öneri türleri:** *Yeni görevlendirme*, *Pay değişiyor* (eski dönem bir gün öncesinde kapanır, yeni pay yeni dönem olarak açılır; geçmiş aylar bozulmaz), *Görevlendirme biter* (Katip'te artık görünmeyen kişi), *Değişmiyor*.
4. **Uyarılar (⚠):** uzman/hekim değişikliği, Katip sürelerinin teorik ihtiyacı aşması (paylar %100'e oranlanır) veya karşılamaması, hesaplanamayan firmalar (çalışan sayısı/tehlike sınıfı eksik). Karma tehlike sınıflı firmalarda ihtiyaç her işyerinin sınıfına göre hesaplanır.
5. **Seçim ve onay:** her firmanın yanındaki kutuyla hangi firmaların uygulanacağını seçersiniz; "gözden geçirdim" kutusunu işaretleyip uygularsınız. Hepsi tek işlemde yazılır; hata olursa hiçbir şey değişmez.
6. **Sınırlar:** "Diğer sağlık personeli" (DSP) satırları görevlendirmeye aktarılmaz. Geçerlilik tarihi yüklemenin dönem başıdır. Katip'te hiç görevlisi olmayan bir tür (ör. hekim yok) için mevcut görevlendirmelere dokunulmaz.

## Aşama 15 kurulumu (personel rolleri, yönetim gideri, işyeri takma adı)

1. **SQL:** Supabase > SQL Editor'de `supabase/16_asama15.sql` dosyasını çalıştırın ("Success"). Yeniden çalıştırılabilir. (Önce 14 ve 15 numaralı dosyalar çalıştırılmış olmalı.)
2. **Diğer personel:** menüde **Operasyon > Diğer personel**. Diğer sağlık personeli, satın alma, satış, sekreter, temizlik, yönetim ve "Diğer" (unvanı siz yazarsınız) eklenir. Maaş/maliyet bilgisi uzman ve hekimlerdeki gibi personel sayfasından girilir.
3. **Yönetim gideri işareti:** her personel formunda (uzman ve hekim dahil) bulunur. İşaretliyse kişinin maliyeti firma kârlılığına değil **genel (ortak) gidere** yazılır; görevlendirmesi olsa bile. Firma kârlılığı sayfasında "Yönetim personeli maliyeti" adıyla ortak gider olarak, firmaların gelir oranına göre dağıtılır. Diğer personelde varsayılan olarak işaretlidir; işaretsiz bırakırsanız (ör. DSP) maliyet hiçbir firmaya yazılmaz, "dağıtılmamış" kalır.
4. **İşyeri takma adı:** firma kartında yeni **İşyerleri** sekmesi (ve İSG-Katip sayfasındaki işyeri tablosu). "Fatura adı" alanına faturada geçen adı (ör. UKEM) yazın; işyerine ayrı fatura kesiliyorsa "Ayrı fatura" kutusunu işaretleyin. Fatura Excel'i aşamasında bu adlar tanınacaktır.
5. **Kapasite analizi:** son İSG-Katip yüklemesindeki aylık süre "Katip'te bildirilen" sütununda teorik yükün yanında görünür. Uzmanlar, İşyeri hekimleri ve Görevlendirmeler sayfalarındaki firma sayısı ve teorik yük, Aşama 14'te görevlendirmeleri onayladığınızda güncellenir.
6. **Sınırlar:** diğer personel firmalara görevlendirilmez ve zaman kaydı girmez; işyerleri yalnızca İSG-Katip'ten gelir (elle işyeri eklenmez); zaman takibinde Katip'ten aktarılacak ayrı bir veri yoktur.

## Aşama 16 kurulumu (elle işyeri, Takvim, günlük e-postada "Bugün Yapılacaklar" ve "Yaklaşan Program")

1. **SQL:** Supabase > SQL Editor'de `supabase/17_asama16.sql` dosyasını çalıştırın ("Success"). Yeniden çalıştırılabilir. (10, 14, 15 ve 16 numaralı dosyalar önce çalıştırılmış olmalı.)
2. **Edge Function'ı yeniden yükleyin:** Supabase > Edge Functions > `gunluk-ozet` > kodu `supabase/functions/gunluk-ozet/index.ts` ile değiştirip **Deploy** edin (Aşama 10 ve 12.1'de yaptığınız gibi). Bunu yapmazsanız e-posta eski biçimde gelir. Gizli ayarlar ve zamanlama aynı kalır.
3. **Elle işyeri:** İSG-Katip'ten gelmeyen (elle açtığınız) firmanın kartında **İşyerleri** sekmesi > **İşyeri ekle**. İşyeri adı, fatura adı (ör. UKEM), çalışan sayısı, tehlike sınıfı ve "ayrı fatura" işareti girilir. Elle girilen işyeri Katip yüklemesinde pasife alınmaz ve firma kartındaki çalışan sayısına katılmaz (o sayıyı firma kartından siz yönetirsiniz).
4. **Takvim:** menüde **Operasyon > Takvim**. Ay görünümünde bir güne tıklayınca o günün işleri altta listelenir.
   - **Yeni kayıt:** başlık, tür (ödeme / hatırlatma), tarih, tekrar (tek seferlik / her ay), isteğe bağlı bitiş, tutar, firma, not. "Her ay" seçilirse ilk tarihin günü her ay tekrarlanır; o gün olmayan aylarda (ör. 31) ayın son gününe düşer.
   - **Yapıldı işareti:** kutuyu işaretleyin; tekrarlayan kayıtlarda yalnızca o ayı kapatır.
   - **Görevler otomatik işlenir:** Hatırlatmalar ve görevler sayfasında girdiğiniz son tarih ve hatırlatma zamanı takvimde ayrı ayrı görünür; görev tamamlanınca takvimden düşer.
5. **Günlük e-posta:** bugüne ait yapılmamış işler **"Bugün Yapılacaklar"**, yarından başlayarak 3 günün işleri **"Yaklaşan Program"** başlığıyla, tarih ve "N gün kaldı" bilgisiyle e-postanın en üstünde gelir. Eski "görev" bölümü artık yalnızca **gecikmiş** görevleri gösterir (bugünküler Bugün Yapılacaklar'dadır). Bildirilecek hiçbir şey yoksa e-posta yine gönderilmez.
6. **Yetki:** Takvim, "Hatırlatmalar ve görevler" yetkisini kullanır (görmek / eklemek / düzenlemek).
7. **Sınırlar:** Tekrar yalnızca "her ay"dır (haftalık/yıllık yok). Saat bilgisi tutulmaz, yalnızca gün. Takvimden görev oluşturulmaz; görevler kendi sayfasında girilir.

## Aşama 17 kurulumu (aylık gelir Excel'i, spot / elden gelir)

1. **SQL:** Supabase > SQL Editor'de `supabase/18_asama17.sql` dosyasını çalıştırın ("Success"). Yeniden çalıştırılabilir. (Önceki dosyalar, özellikle 07 ve 14, çalışmış olmalı.) Edge Function'a dokunulmaz.
2. **Şablon:** menüde **Yönetim > Veri içe/dışa aktarma** sayfasının altındaki **Aylık gelir (fatura) Excel'i** kartı. **Boş şablonu indir (.xlsx)** başlık satırını ve kısa bir yönergeyi verir. Sizin dosyanızdaki sütunlar aynıdır: Fatura No, Fatura Tarihi, Açıklama, Ücret (KDV hariç), %20 KDV, %10 KDV, Toplam. KDV sütunlarına **oran değil KDV tutarı** yazılır.
3. **Yükleme:** dosyayı seçin. Hiçbir şey siz onaylamadan yazılmaz. Ekranda şunlar çıkar:
   - Toplam matrah, KDV (%20 ve %10 ayrı) ve **ortalama KDV** (KDV ÷ matrah). Her faturanın kendi ortalaması da satırında görünür. İki oranlı faturada iki kalem oluşur (%20 matrahı = %20 KDV ÷ 0,20; %10 matrahı = %10 KDV ÷ 0,10).
   - **Firma eşleştirme:** Açıklamadaki ad (parantezdeki ay çıkarılır) önce daha önce onayladığınız eşleşmelerle, sonra firma/işyeri takma adlarıyla (ör. UKEM), sonra firma adıyla karşılaştırılır. "Güçlü benzerlik" olanlar kendiliğinden seçilir ama listede görünür; "olası" ve "bulunamadı" olanlar için **firma seçmeniz**, **yeni firma oluşturmanız** ("+ Yeni firma oluştur") ya da satırı **aktarmamanız** gerekir; bu seçimler yapılmadan **aktarılamaz**. Elle seçtiğiniz eşleşme hatırlanır; sonraki ay aynı ad sorulmaz.
   - **Hizmet dönemi** parantezdeki aydan alınır ("(Eylül)"); ay yoksa fatura ayı, "(Temmuz-Aralık)" gibi aralıksa boş bırakılır (satırda uyarı yazar).
   - **Vade:** Excel'de olmadığı için fatura tarihine eklenen gün sayısı (varsayılan 30) girilir.
   - **Uyarılar:** KDV sütunu ile tutar uyuşmazsa (ör. %10 sütununa %20'lik tutar yazılmışsa) tutara göre düzeltilir ve satırda yazılır; Ücret + KDV ile Toplam farklıysa, tarih okunamıyorsa veya tutar yoksa uyarılır / satır aktarılmaz; aynı numara sistemde varsa "zaten kayıtlı — atlanır".
   - **Faturası unutulmuş olabilecek firmalar:** dosyanın ana hizmet döneminde (satırların en az %20'sini oluşturan ay) aktif sözleşmesi olan, ama ne sistemde ne bu dosyada faturası bulunan firmalar listelenir. Aynı uyarı aktarımdan sonra da gösterilir.
4. **Spot iş ve elden ödeme:** **Gelirler ve tahsilatlar > Gelir ekle**. Gelir türü *Spot iş* ise ne olduğunu yazar, KDV oranını ve tutarın KDV hariç/dahil olduğunu seçersiniz. *Elden ödeme* seçilirse KDV hesaplanmaz (KDV yok) ve "tahsil edildi" kutusu işaretli gelir; kayıt, ödeme yöntemi "Elden" olan bir tahsilatla kapanır. Fatura numarası boşsa otomatik verilir.
5. **Fatura detayı:** gelir türünü, ortalama KDV'yi ve iki oranlı faturalarda oran kırılımını gösterir.
6. **Yetki:** Excel yüklemek için Gelirler ve tahsilatlar'da *ekleme* ve Veri içe/dışa aktarma'da *ekleme* yetkisi gerekir; yeni firma oluşturmak için ayrıca Firmalar'da *ekleme* yetkisi.
7. **Sınırlar:** Yalnızca %20 / %10 / KDV'siz sütunları tanınır (başka oran ayrı sütunla desteklenmez, tuhaf oran uyarı ile işlenir). Tek seferde en çok 1.000 satır. Elden/spot gelirler Excel'le değil elle girilir. Tahsilat, bu aktarımda kendiliğinden oluşmaz (Excel'de ödeme bilgisi yok). "Unutulan fatura" kontrolü yalnızca aktif sözleşmesi olan firmaları kapsar. Gerçek bir Supabase üzerinde RLS davranışı bu ortamda denenemedi (yerel PostgreSQL'de denendi).

## Aşama 18 kurulumu (firmayı kalıcı silme, pasif firma kuralı)

1. **SQL:** Supabase > SQL Editor'de `supabase/19_asama18.sql` dosyasını çalıştırın ("Success"). Yeniden çalıştırılabilir. Edge Function'a dokunulmaz.
2. **Pasife al / Aktif et:** firma kartında **Pasife al** (firmayı "eski müşteri" yapar). Pasif firmada tüm kayıtlar durur; ama
   - aylık toplu faturada (Gelirler ve tahsilatlar > Aylık faturaları oluştur) yer almaz, yani sonraki aya otomatik gelir eklenmez;
   - görevlendirmeleri uzman/hekim teorik yükünde ve Kapasite analizinde sayılmaz (uzmanın saati harcanmış görünmez);
   - yeni görevlendirme ve yeni zaman kaydı için firma listesinde çıkmaz.
   **Aktif et** ile her şey eski haline döner. Arşivlenen firma da pasif sayılır.
3. **Firmayı sil (kalıcı):** firma kartında kırmızı **Firmayı sil** düğmesi, yalnızca **işletme sahibi** ve **sistem yöneticisi** görür. Firma adını aynen yazmadan çalışmaz. Firmanın TÜM kayıtları (kişiler, fırsatlar, görüşmeler, teklifler, sözleşmeler, faturalar ve tahsilatlar, görevlendirmeler, zaman kayıtları, giderler, işyerleri, takvim kayıtları, görevler) geri alınamaz biçimde silinir. Hangi kaydın silindiği Denetim kaydında görünür. **Silmeden önce Yedekleme sayfasından yedek alın.** Kayıtları saklamak istiyorsanız silmeyin, Pasife al'ı kullanın.
4. **Sınırlar:** Kârlılık hesabı geçmiş ayları bozmamak için değiştirilmedi: pasife alınan firmanın eski aylardaki gelir/maliyeti aynen kalır. Pasife alma tarihi tutulmaz; firma "eski müşteri" olduğu andan itibaren yukarıdaki kurallar uygulanır. Silme sonrası yüklenmiş dosya (ek) varsa depolamadaki dosya silinmez (şu an ek yükleme ekranı yoktur).

## Aşama 19 kurulumu (aylık gider Excel aktarımı)

1. **SQL:** Supabase > SQL Editor'de `supabase/20_asama19.sql` dosyasını çalıştırın ("Success"). Yeniden çalıştırılabilir.
2. **Şablon:** Veri içe/dışa aktarma sayfasında "Aylık gider Excel'i" kartından **Boş şablonu indir**. Satır = gider kalemi, sütun = ay (01.01.2026 gibi tarih hücresi). Tutarlar aylık toplamdır; boş/0 hücre aktarılmaz.
3. **Yükleme:** Dosyayı seçin. Her kalem için kategori önerilir (aynı ada sahip kategori; yoksa "+ Yeni kategori"; **Yönetime Ödenen** otomatik "Yönetime ödenen"e; **Personel Giderleri** otomatik yeni "Personel Giderleri" (personel/maaş türü) kategorisine gider ve gider olarak alınır). Onayladığınız eşleşmeler hatırlanır, sonraki ayda sorulmaz. "Vergi" satırı varsayılan olarak yeni bir **gelir vergisi** kategorisi olur (kâr-sonrası hesapta kullanılır); isterseniz başka kategori seçin.
4. **KDV:** Dosyadaki tutarlar varsayılan olarak **KDV hariç** kabul edilir. KDV dahilse "KDV dahil" ve oranı seçin; tutar hariç + KDV olarak ayrılır.
5. **Yerine geçme:** Her yükleme, dosyadaki aylar için daha önce **Excel'den aktarılmış** kayıtların yerine geçer; eski kayıtlar silinmez, **arşivlenir**. Elle girilen giderlere dokunulmaz. Dosyada olmayan aylara dokunulmaz. Hepsi tek işlemde yazılır, hata olursa hiçbir şey değişmez.
6. **Yönetime ödenen:** Yönetim olarak işaretli uzman/hekim maliyetidir. Firma kârlılığında yönetim giderine yazılır ve o ay için, işaretli personelin kart maliyetinin yerine geçer (çift sayılmaz). O ay Excel'de yönetime ödenen yoksa eski hesap (personel kartı) sürer.
7. **Personel giderleri:** Dosyadaki "Personel Giderleri" toplam satırı gider olarak alınır (Giderler sayfasında ve gider toplamlarında görünür). Firma kârlılığında personel kartındaki maliyetle çift sayılmaması için hesaba katılmaz; kişi bazlı personel maliyeti (personel kârlılığı) ayrıca, sonraki aşamada girilecektir.
8. **Sınırlar:** Geçmiş ödenmiş sayılır (içinde bulunulan aydan önceki aylar "ödendi"). Negatif tutarlar aktarılmaz (uyarı verilir). Kategoriye göre ortak gider dağıtımı daha önce kaydedilmiş bir ay yeniden yüklenirse dağıtım havuzu denetimi arşivlemeyi reddedebilir; önce o ayın dağıtımını sıfırlayın.

### Tek seferlik: faturaları toplu "tahsil edildi" yapma
1. Yedek alın (Yedekleme sayfası).
2. Supabase > SQL Editor'de `supabase/21_toplu_tahsilat_tek_sefer.sql` dosyasını **bir kez** çalıştırın.
3. Dosyadaki 245 numara "tahsil edilmeyen" listesidir; EAR-/EFT- ile başlayan diğer tüm faturalar bakiyesi kadar tahsilatla kapatılır. Tahsilat tarihi bilinmediğinden fatura tarihi yazılır ve not alanına "Toplu işaretleme" eklenir. EAR-/EFT- dışı (elle kesilmiş) faturalara dokunulmaz. Çalıştırma sonunda sonuç tablosu çıkar: işaretlenen fatura sayısı/tutarı, kalan açık fatura, listede olup sistemde bulunamayan numara sayısı.
4. Sonradan fatura yükleyip dosyayı tekrar çalıştırmayın (yeni faturalar da tahsil edilmiş olur).

### Logo
Logo dosyaları `assets/` klasöründedir: `logo.png` (simge, menü), `logo-tam.png` (simge + yazı, giriş ekranı), `favicon.png`, `favicon-32.png` ve `apple-touch-icon.png` (sekme simgesi, yalnızca simge). Değiştirmek için aynı adlarla dosya koymak yeterlidir. Not: tam logo beyaz zemin için hazırlanmıştır; koyu temada giriş kartı açık renkli kalır.

## Aşama 20 kurulumu (personel bazlı maliyet)

1. **SQL:** Supabase > SQL Editor'de `supabase/22_asama20.sql` dosyasını çalıştırın ("Success"). Yeniden çalıştırılabilir. Eski maliyet kayıtları aynen korunur (toplamları eskisi gibi brüt + SGK + diğer kalır).
2. **Kullanım:** Uzman / hekim / diğer personel kartında **Aylık maliyet > Yeni dönem**. Alanlar: Geçerlilik başlangıcı, Net maaş, Brüt maaş, Personel emekli, SGK primi, Elden verilen. Hiçbiri (başlangıç hariç) zorunlu değildir.
3. **SGK primi** boş bırakılırsa brüt maaştan otomatik hesaplanır: emekli ise brüt × (%2,25 + %30) = %32,25; emekli değilse brüt × (%2,25 + %21 + %12,5 + %3) = %38,75. Maaş girmeden yalnızca SGK primi girmek için SGK alanına tutarı yazın (elle girilen SGK, "elle" etiketiyle gösterilir).
4. **İşverene toplam maliyet** = net maaş + SGK primi + elden verilen. Form, yazarken sonucu gösterir.
5. **Geçerlilik:** Yeni başlangıç girilince kayıt o tarihten sonraki aylara, başka bir başlangıç girilene kadar aynı hesapla devam eder; önceki dönem bir gün öncesinde kapanır. Geçmişe araya dönem girilirse kapsayan dönem bölünür, sonraki dönemler korunur. Aynı başlangıç tarihi yeniden girilirse o dönem güncellenir.
6. **Not:** Kârlılık, personel kartındaki bu toplamı kullanır. Excel'deki "Personel Giderleri" toplam gider satırı ayrıca gider olarak alınır ve firma kârlılığında çift sayılmaz. SGK oranları kodda sabittir; oranlar değişirse bildirin.


## Aşama 21 kurulumu (İdari İşler ve yıllık takvim tekrarı)

1. **SQL:** Supabase > SQL Editor'de `supabase/23_asama21.sql` dosyasını çalıştırın ("Success"). Yeniden çalıştırılabilir. Dosya; yeni tabloları (izinler, araçlar, araç kayıtları, belgeler), `idari-belgeler` adlı **özel** depolama kovasını ve takvimdeki "Her yıl" tekrarını kurar.
2. **Depolama kontrolü:** Supabase > Storage içinde `idari-belgeler` kovasının göründüğünü doğrulayın (Private, en çok 10 MB; PDF/JPG/PNG/WEBP). Görünmüyorsa kovayı aynı adla elle oluşturup SQL'i yeniden çalıştırın. Ücretsiz planda toplam depolama 1 GB'dır.
3. **Yetki:** İdari İşler menüsü (Finans altında) varsayılan olarak yalnızca Sistem yöneticisi ve İşletme sahibi tarafından görülür. Diğer roller için Kullanıcılar ve yetkiler > Yetki matrisi'nde "İdari işler" satırını açabilirsiniz.
4. **Özlük belgeleri:** Personel seçilir; işe giriş bildirgesi, kimlik, nüfus kayıt örneği, ikametgâh, adli sicil, diploma, sertifika, İSG eğitimi, sağlık raporu için "Yükle" kullanılır. "Başka belge" ile adını kendiniz yazdığınız belge eklenir. Belgeler silinmez, arşivlenir.
5. **Personel izinleri:** Hesap için personel kartında **İşe başlama** ve **Doğum tarihi** dolu olmalıdır. Hak, işe başlama tarihinin her yıldönümünde doğar (ilk hak 1 yıl sonra): 1–5 yıl (5 dahil) 14, 5–15 yıl 20, 15 yıl ve üzeri 26 iş günü; hak edildiği tarihte 18 yaşından küçük veya 50 yaşında/üzerinde olanlara en az 20 gün. Kullanılan izin en eski haktan düşülür. İzin eklerken gün sayısı hafta içi günlerden otomatik gelir; resmî tatil varsa elle düzeltin.
6. **Şirket araçları:** Plaka ve marka ile araç tanımlanır; ruhsat, trafik sigortası, kasko, bakım, muayene ve "Diğer" (ekstra veri: ad + ek bilgi) kayıtları ile belgeleri girilir. Bitiş tarihi 30 günden az kalan kayıtlar sarı, geçenler kırmızı işaretlenir.
7. **Şirket belgeleri:** Ad (zorunlu), tarih ve açıklama ile PDF veya resim yüklenir.
8. **Takvim:** Kayıt girerken Tekrar > **Her yıl** seçilebilir (29 Şubat kayıtları artık olmayan yıllarda ayın son gününe düşer).

## Aşama 22 kurulumu (firma dışı spot işler, kârlılık düzeltmeleri)

1. **SQL:** Supabase > SQL Editor'de `supabase/24_asama22.sql` dosyasını çalıştırın ("Success"). Yeniden çalıştırılabilir. Faturalar tablosunda firma alanı boş bırakılabilir hale gelir ve `gelir_kalemi_ekle` fonksiyonu yenilenir.
2. **Firma dışı spot iş:** Gelirler ve tahsilatlar > Gelir ekle'de Firma alanını "Firma dışı iş" bırakın; işin adını (sağlık raporu, risk analizi, sözleşme, eğitim vb.) ve isterseniz müşteri adını yazın. Listede "(firma dışı)" ibaresiyle görünür.
3. **KDV 0 kuralı:** KDV oranı 0 girilen spot işler ve elden ödemeler faturasız paradır; gelire ve vergi öncesi kâra dahildir ama **tahmini kurumlar vergisi hesabına dahil edilmez**. Kârlılık sayfasında "KDV 0 gelir ... vergiye dahil değil" notu görünür.
4. **Personel kârlılığı:** Yönetim olarak işaretli personel listede görünmez (maliyeti yönetim giderine yansımaya devam eder). Ayrılış tarihinden sonraki aylarda personel hiç gösterilmez; ayrılış ayı dahildir.
5. **Uzman ve Hekimler:** Aya ait teorik yük dakika olarak gösterilir (örn. 1.050 dk).

## Aşama 23 (kârlılık hesap detayları ve ay içi başlangıç) — SQL gerekmez

- **Hesap detayı:** Firma kârlılığında "Toplam maliyet", "Vergi öncesi kâr" ve "Vergi sonrası (tahmini)" kutucuklarına, Personel kârlılığında "Boşta kapasite maliyeti" kutucuğuna tıklayınca hesabın adım adım dökümü açılır.
- **Ay içinde başlayan:** Bir firma, görevlendirme, firma profili veya personel maliyet dönemi ayın herhangi bir gününde başlarsa o aya tam ay olarak dahil edilir (daha önce yalnızca ayın 1'inde başlayanlar giriyordu). Bu kural Uzmanlar/Hekimler sayfasındaki teorik yükü ve Kapasite sayfasını da etkiler.
- **Pasif personel:** Ayrılış tarihi girilmemiş pasif personel Personel kârlılığında hiç listelenmez; ayrılış tarihi girilmişse ayrılış ayına kadar görünür.

## Aşama 24 (Yönetici paneli aylık finans özeti) — SQL gerekmez

- **Yönetici paneli** üstünde "Aylık finans özeti" bölümü: ay seçicisi (son 24 ay, varsayılan içinde bulunulan ay), gelir/tahsilat/alacak/gider/vergi öncesi–sonrası kâr/aktif firma/uzman-hekim/dakika kutucukları, "Dikkat" uyarıları, son 12 ay gelir-gider ve kâr grafikleri, en kârlı/en düşük kârlı müşteriler, kapasite kullanımı ve tehlike sınıfı tablosu.
- Rakamlar Firma/Personel kârlılığı sayfalarıyla aynı hesaptan gelir; geçmiş ay grafikleri teorik yöntemle hesaplanır.
- Bölüm yalnızca kârlılık, bordro, gider ve fatura görüntüleme yetkisi olanlara görünür; diğer roller eski portföy panelini görür.

## Aşama 24.1 (tahsilat düzenleme) — SQL gerekmez

- Fatura detayındaki Tahsilatlar listesinde her satırda kalem (düzenle) düğmesi vardır; tahsilat **tarihi ve tutarı** (ayrıca yöntem ve not) değiştirilebilir. Fatura düzenleme yetkisi gerekir; değişiklik denetim kaydına işlenir.
- Tarih gelecekte olamaz; tutar sıfırdan büyük olmalıdır. Önizleme, kaydın kendi eski tutarını kalana geri ekleyerek hesaplar. İptal edilmiş tahsilat düzenlenemez; tahsilatın bağlı olduğu fatura değiştirilemez.

## Aşama 25 (Cari hesap) — `supabase/25_asama25.sql` çalıştırılmalı

1. Supabase → SQL Editor'de `25_asama25.sql` dosyasını çalıştırın (firmalara isteğe bağlı "vergi dairesi" alanı ekler; tekrar çalıştırılabilir).
2. **Finans → Cari hesap:** firma ve dönem (yıl / tüm dönem / tarih aralığı) seçilir. Faturalar **alacak**, tahsilatlar **borç** hanesine yazılır (KDV dahil); bakiye birikimli hesaplanır, bakiye pozitifse "ALACAKLI" görünür. Dönem başından önceki hareketler "Önceki dönemden devir" satırıyla özetlenir.
3. **Excel olarak indir:** ekteki örnek biçimde (firma bilgileri bloğu, Karma logosu, Tarih/Borç/Alacak/Bakiye/Açıklama tablosu, toplam satırı, banka bilgileri) `.xlsx` üretir. Banka bilgisi `src/lib/cari.js` içindeki `BANKA_BILGISI` listesindedir; değişirse oradan güncellenir.
4. **Tahsilat tarihi düzeltme:** Cari ekstresinde tahsilat satırındaki kalem simgesi (veya fatura detayından) tarih/tutarı değiştirir; ekstre, Gelirler ve tahsilatlar ("son tahsilat" bilgisi) ve tüm raporlar yeni tarihi kullanır. Toplu işaretlemeyle (tarihi bilinmeden, fatura tarihiyle) girilmiş tahsilatlar "Tarih tahmini" etiketiyle gösterilir; gerçek tarihi girilince etiket kalkar.
5. Firma formuna **Vergi dairesi** alanı eklendi (Excel başlığında kullanılır). Yetkili kişi, firmanın ilk kişisinden alınır.

## Aşama 26 (Firma bazında tahsilat) — `supabase/26_asama26.sql` çalıştırılmalı

1. Supabase → SQL Editor'de `26_asama26.sql` dosyasını çalıştırın (tahsilatlara grup alanı ve `firma_tahsilati_gir` fonksiyonunu ekler; tekrar çalıştırılabilir).
2. **Tahsilat gir:** Firma kartı → Faturalar sekmesi veya Finans → Cari hesap sayfasındaki "Tahsilat gir" düğmesi. Tarih ve tutar girilir; tutar, açık faturalara **fatura tarihi eskiden yeniye** dağıtılır. Örnek: 5.000 TL'lik iki açık faturaya 7.500 TL → 1. fatura tahsil edildi, 2. fatura 2.500 TL kısmi, kalan 2.500 TL. Dağıtım, kaydetmeden önce önizlenir. Tutar firmanın açık bakiyesini aşamaz.
3. **Cari ekstre:** Ödemenin tamamı tek borç satırında görünür; açıklamada karşıladığı faturalar yazılır, tam karşılanmayan faturada "(kısmi)" belirtilir. Satırdaki kalem simgesiyle tarih/yöntem/not düzenlenir, çöp kutusuyla tahsilat iptal edilir (tutarı değiştirmek için iptal edip yeniden girin).
4. Tek fatura için tahsilat (fatura detayı) eskisi gibi çalışır; tarih ve tutar düzenlenebilir.
5. **Excel:** başlık "CARİ HESAP TABLOSU", logo firma bilgileri kutusunun sağında ve sayfa içinde; sayfa A4'e sığacak şekilde ayarlıdır.
