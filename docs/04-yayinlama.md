# Yayınlama (GitHub Pages)

Uygulama derleme gerektirmez; dosyalar olduğu gibi yayımlanır.

1. Bu klasördeki tüm dosyaları `karmaisg/karmacrm` deposunun ana dalına (`main`) yükleyin (GitHub'da **Add file > Upload files**, ya da Git ile push).
2. Depoda **Settings > Pages**: **Source:** *Deploy from a branch*, **Branch:** `main`, klasör `/ (root)`. Kaydedin.
3. 1–2 dakika sonra adres hazır olur: `https://karmaisg.github.io/karmacrm/`
4. Supabase'de **Authentication > URL Configuration** içine bu adresi yazın (bkz. kurulum rehberi, Aşama 2 kurulumu, B).

## Güvenlik notları
- `src/config.js` içinde yalnızca **anon** anahtar bulunur. `service_role` anahtarını hiçbir dosyaya yazmayın.
- `index.html` içindeki İçerik Güvenliği Politikası (CSP) yalnızca kendi dosyalarınıza, jsDelivr'e (Supabase kütüphanesi) ve Supabase adresinize izin verir. Supabase projesinin adresi değişirse `index.html` ve `src/config.js` birlikte güncellenmelidir.
- Depo Public ise kod herkese açıktır; müşteri verisi depoda değil Supabase'dedir ve erişimi RLS kurallarıyla sınırlıdır.

## Sorun giderme
- Beyaz sayfa: tarayıcıda F12 > Console'daki kırmızı hatayı bana iletin.
- "Gerekli kütüphane yüklenemedi": internet bağlantısı veya jsDelivr erişimi; yenileyin.
- Giriş yapıyor ama "Hesabınız kuruma tanımlı değil": kullanıcının `users` tablosunda kaydı yoktur (Kullanıcılar > Kullanıcı ekle).
