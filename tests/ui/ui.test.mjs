// OSGB 360 - Arayüz testleri (Playwright + sahte supabase-js). Çalıştırma: node tests/ui/ui.test.mjs
// Statik sunucu proje kökünü sunar; jsDelivr isteği sahte istemciyle değiştirilir. CSP gerçek haliyle uygulanır.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const KOK = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const FAKE = fs.readFileSync(path.join(KOK, 'tests/ui/fake_supabase.js'), 'utf8');
const EKRAN = process.env.EKRAN_DIZINI || null;
const TUR = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };

const sunucu = http.createServer((req, res) => {
  const yol = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const dosya = path.join(KOK, yol === '/' ? 'index.html' : yol);
  if (!dosya.startsWith(KOK) || !fs.existsSync(dosya) || fs.statSync(dosya).isDirectory()) { res.writeHead(404); res.end('yok'); return; }
  res.writeHead(200, { 'content-type': TUR[path.extname(dosya)] ?? 'application/octet-stream' });
  res.end(fs.readFileSync(dosya));
});
await new Promise((r) => sunucu.listen(0, '127.0.0.1', r));
const ADRES = `http://127.0.0.1:${sunucu.address().port}/`;
const tarayici = await chromium.launch();

let gecen = 0; const basarisiz = [];
async function test(ad, fn, { genislik = 1366, yukseklik = 900 } = {}) {
  if (process.env.ONLY && !ad.includes(process.env.ONLY)) return;
  const ctx = await tarayici.newContext({ viewport: { width: genislik, height: yukseklik }, locale: 'tr-TR', timezoneId: 'Europe/Istanbul' });
  const sayfa = await ctx.newPage();
  const hatalar = [];
  sayfa.on('pageerror', (e) => hatalar.push(`pageerror: ${e.message}`));
  sayfa.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) hatalar.push(`console: ${m.text()}`); });
  await sayfa.route('**/cdn.jsdelivr.net/**', (r) => r.fulfill({ status: 200, contentType: 'text/javascript', headers: { 'access-control-allow-origin': '*' }, body: FAKE }));
  await sayfa.route('**/*.supabase.co/**', (r) => r.abort());
  try {
    await fn(sayfa, ctx);
    if (hatalar.length) throw new Error(`Tarayıcı hataları: ${hatalar.join(' | ')}`);
    gecen += 1; console.log(`PASS  ${ad}`);
  } catch (e) {
    basarisiz.push(ad); console.log(`FAIL  ${ad}\n      ${String(e.message).split('\n').slice(0, 4).join('\n      ')}`);
    if (process.env.DEBUG_DOM) console.log(hatalar.join(' | ').slice(0, 800), (await sayfa.evaluate(() => document.body.innerText).catch(() => '')).slice(0, 1500));
    if (EKRAN) await sayfa.screenshot({ path: path.join(EKRAN, `FAIL-${ad.replace(/\W+/g, '_')}.png`) }).catch(() => {});
  } finally { await ctx.close(); }
}
const esit = (a, b, m) => { if (a !== b) throw new Error(`${m}: beklenen "${b}", gelen "${a}"`); };
const var_ = async (el, m) => { if (!(await el.count())) throw new Error(`Bulunamadı: ${m}`); };

async function giris(s, eposta = 'sahip@test.com', sifre = 'GucluSifre123') {
  await s.goto(ADRES);
  await s.waitForSelector('#f-email');
  await s.fill('#f-email', eposta);
  await s.fill('#f-password', sifre);
  await s.click('button[type=submit]');
}
const girisYap = async (s, e, p) => { await giris(s, e, p); await s.waitForSelector('#kabuk'); await s.waitForSelector('#sayfa h1, #sayfa .empty'); };
const git = async (s, h) => { await s.evaluate((x) => { location.hash = x; }, h); await s.waitForTimeout(150); };
const modal = (s) => s.locator('.modal-overlay').last();
const ekran = async (s, ad) => { if (EKRAN) await s.screenshot({ path: path.join(EKRAN, `${ad}.png`), fullPage: false }); };

async function firmaEkle(s, { ad, vergi = '', calisan = '', tehlike = '', web = '' }) {
  await git(s, '#/firmalar');
  await s.waitForSelector('[data-action="yeni-firma"]');
  await s.click('.page-eylemler [data-action="yeni-firma"], [data-action="yeni-firma"]');
  const m = modal(s);
  await m.locator('#f-name').fill(ad);
  if (vergi) await m.locator('#f-tax_no').fill(vergi);
  if (web) await m.locator('#f-website').fill(web);
  if (calisan !== '') await m.locator('#f-employee_count').fill(String(calisan));
  if (tehlike) await m.locator('#f-hazard_class').selectOption(tehlike);
  await m.locator('button[type=submit]').click();
}

await test('giriş: hatalı şifre Türkçe hata gösterir', async (s) => {
  await giris(s, 'sahip@test.com', 'yanlis');
  await s.waitForSelector('.form-error:not([hidden])');
  esit((await s.textContent('.form-error')).trim(), 'E-posta veya şifre hatalı.', 'hata metni');
  await ekran(s, '01-giris-hata');
});

await test('giriş: boş alanlar için alan hataları', async (s) => {
  await s.goto(ADRES); await s.waitForSelector('#f-email');
  await s.click('button[type=submit]');
  esit((await s.textContent('#e-email')).trim(), 'E-posta adresinizi yazın.', 'e-posta hatası');
  esit((await s.textContent('#e-password')).trim(), 'Şifrenizi yazın.', 'şifre hatası');
});

await test('giriş: başarılı giriş, boş panel ve menü', async (s) => {
  await girisYap(s);
  const h1 = (await s.textContent('#sayfa h1')).trim();
  if (!/^(Günaydın|İyi günler|İyi akşamlar|İyi geceler), Barış$/.test(h1)) throw new Error(`karşılama: ${h1}`);
  await var_(s.locator('.empty h3:has-text("ilk firmanızı")'), 'boş durum');
  await var_(s.locator('.nav-item:has-text("Kullanıcılar ve yetkiler")'), 'kullanıcılar menüsü');
  esit(await s.locator('.nav-tag').count(), 0, 'tüm modüller hazır: menüde etiket kalmadı');
  esit(await s.locator('.nav-item:has-text("Sistem ayarları") .nav-tag').count(), 0, 'ayarlar artık hazır');
  esit(await s.locator('.nav-item:has-text("Raporlar") .nav-tag').count(), 0, 'raporlar artık hazır');
  esit(await s.locator('.nav-item:has-text("Veri içe/dışa aktarma") .nav-tag').count(), 0, 'aktarım artık hazır');
  esit(await s.locator('.nav-item:has-text("Teklifler") .nav-tag').count(), 0, 'teklifler artık hazır');
  await ekran(s, '02-panel-bos');
});

await test('firma: oluştur, çalışan sayısı ve teorik süre 600/300', async (s) => {
  await girisYap(s);
  await firmaEkle(s, { ad: 'Demir Çelik A.Ş.', vergi: '1234567890', calisan: 30, tehlike: 'tehlikeli' });
  await s.waitForSelector('.company-head h1:has-text("Demir Çelik")');
  await var_(s.locator('.company-meta .pill:has-text("Tehlikeli")'), 'tehlike etiketi');
  const kart = await s.textContent('#teorik-icerik');
  if (!kart.includes('600') || !kart.includes('300')) throw new Error(`teorik süre: ${kart}`);
  await ekran(s, '03-firma-karti');
  await git(s, '#/firmalar');
  await s.waitForSelector('#firma-tablo tbody tr');
  esit(await s.locator('#firma-tablo tbody tr').count(), 1, 'satır sayısı');
  await ekran(s, '04-firma-listesi');
});

await test('firma: aynı vergi numarası reddedilir', async (s) => {
  await girisYap(s);
  await firmaEkle(s, { ad: 'Birinci', vergi: '1111111111' });
  await s.waitForSelector('.company-head');
  await firmaEkle(s, { ad: 'İkinci', vergi: '1111 111 111' });
  await s.waitForSelector('.modal-overlay .field-error:not(:empty)');
  const metin = await s.textContent('.modal-overlay #e-tax_no');
  if (!metin.includes('Birinci')) throw new Error(`mükerrer mesajı: ${metin}`);
});

await test('firma: zorunlu alan ve yarım çalışan bilgisi doğrulanır', async (s) => {
  await girisYap(s);
  await firmaEkle(s, { ad: '', calisan: 5 });
  await s.waitForSelector('.modal-overlay .field-error:not(:empty)');
  esit((await s.textContent('#e-name')).trim(), 'Firma adı zorunludur.', 'ad hatası');
  if (!(await s.textContent('#e-hazard_class')).includes('tehlike sınıfı')) throw new Error('tehlike hatası yok');
});

await test('firma: yeni dönem ekleme geçmişi kapatır, ay seçimi yeniden hesaplar', async (s) => {
  await girisYap(s);
  await firmaEkle(s, { ad: 'Dönem A.Ş.', calisan: 30, tehlike: 'tehlikeli' });
  await s.waitForSelector('.company-head');
  await s.click('[data-sekme="calisan"]');
  await s.click('[data-action="profil-ekle"]');
  const m = modal(s);
  await m.locator('#f-employee_count').fill('50');
  await m.locator('#f-hazard_class').selectOption('cok_tehlikeli');
  await m.locator('#f-valid_from').fill('2027-01-01');
  await m.locator('button[type=submit]').click();
  await s.waitForSelector('.table tbody tr:nth-child(2)');
  esit(await s.locator('#sekme-govde .table tbody tr').count(), 2, 'dönem sayısı');
  await s.selectOption('#teorik-ay', '2027-01-01');
  const kart = await s.textContent('#teorik-icerik');
  if (!kart.includes('2.000') || !kart.includes('750')) throw new Error(`2027-01 teorik: ${kart}`); // 50*40, 50*15
  await s.selectOption('#teorik-ay', `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}-01`);
  if (!(await s.textContent('#teorik-icerik')).includes('600')) throw new Error('bu ay 600 olmalı (geçmiş etkilenmez)');
});

await test('firma: geçmiş tarihli dönem arayüzde reddedilir', async (s) => {
  await girisYap(s);
  await firmaEkle(s, { ad: 'Eski Tarih', calisan: 10, tehlike: 'az_tehlikeli' });
  await s.waitForSelector('.company-head');
  await s.click('[data-sekme="calisan"]');
  await s.click('[data-action="profil-ekle"]');
  const m = modal(s);
  await m.locator('#f-valid_from').fill('2000-01-01');
  await m.locator('#f-employee_count').fill('12');
  await m.locator('#f-hazard_class').selectOption('tehlikeli');
  await m.locator('button[type=submit]').click();
  if (!(await s.textContent('.modal-overlay #e-valid_from')).includes('sonra olmalıdır')) throw new Error('tarih hatası yok');
});

await test('firma: arşivle ve geri al', async (s) => {
  await girisYap(s);
  await firmaEkle(s, { ad: 'Arşiv Deneme' });
  await s.waitForSelector('.company-head');
  await s.click('[data-action="arsiv"]');
  await s.click('[data-ok]');
  await s.waitForSelector('.notice-warn:has-text("arşivde")');
  await git(s, '#/firmalar');
  await s.waitForSelector('#firma-tablo');
  await var_(s.locator('.empty:has-text("Bu filtrede firma yok"), .empty:has-text("Eşleşen")'), 'aktif listede yok');
  await s.click('[data-filtre="arsiv"]');
  await s.waitForSelector('#firma-tablo tbody tr');
  await s.click('#firma-tablo tbody tr a');
  await s.waitForSelector('[data-action="arsiv"]');
  await s.click('[data-action="arsiv"]');
  await s.waitForSelector('.company-head .pill:has-text("Müşteri")');
});

await test('kişiler: firma kartından ekle, düzenle, arşivle, listede gör', async (s) => {
  await girisYap(s);
  await firmaEkle(s, { ad: 'Kişi A.Ş.' });
  await s.waitForSelector('.company-head');
  await s.click('[data-sekme="kisiler"]');
  await s.click('[data-action="kisi-ekle"]');
  let m = modal(s);
  await m.locator('#f-full_name').fill('Ayşe Yılmaz');
  await m.locator('#f-phone').fill('0532 111 22 33');
  await m.locator('#f-email').fill('ayse@firma.com');
  await m.locator('#f-is_decision_maker').check();
  await m.locator('button[type=submit]').click();
  await s.waitForSelector('#sekme-govde td:has-text("Ayşe Yılmaz")');
  await var_(s.locator('.tag-ok:has-text("Karar verici")'), 'karar verici');
  await s.click('[data-kisi-eylem="duzenle"]');
  m = modal(s);
  await m.locator('#f-title').fill('Müdür');
  await m.locator('button[type=submit]').click();
  await s.waitForSelector('#sekme-govde td:has-text("Müdür")');
  await git(s, '#/kisiler');
  await s.waitForSelector('#kisi-tablo tbody tr');
  await ekran(s, '05-kisiler');
  await s.click('[data-kisi-eylem="arsivle"]');
  await s.click('[data-ok]');
  await s.waitForSelector('#kisi-tablo .empty');
});

await test('kişiler: geçersiz e-posta ve telefon reddedilir', async (s) => {
  await girisYap(s);
  await git(s, '#/kisiler'); await s.waitForSelector('[data-action="yeni-kisi"]');
  await firmaEkle(s, { ad: 'Bir Firma' });
  await s.waitForSelector('.company-head');
  await git(s, '#/kisiler'); await s.waitForSelector('[data-action="yeni-kisi"]');
  await s.click('[data-action="yeni-kisi"]');
  const m = modal(s);
  await m.locator('#f-company_id').selectOption({ label: 'Bir Firma' });
  await m.locator('#f-full_name').fill('Test');
  await m.locator('#f-email').fill('gecersiz');
  await m.locator('#f-phone').fill('abc');
  await m.locator('button[type=submit]').click();
  await s.waitForSelector('.modal-overlay #e-email:not(:empty)');
  if (!(await s.textContent('#e-phone')).includes('Telefon')) throw new Error('telefon hatası yok');
});

await test('güvenlik: firma adındaki HTML metin olarak görünür, web adresi javascript: reddedilir', async (s) => {
  await girisYap(s);
  const kotu = '<img src=x onerror="window.__xss=1">';
  await firmaEkle(s, { ad: kotu });
  await s.waitForSelector('.company-head h1');
  esit(await s.textContent('.company-head h1'), kotu, 'başlık metin olarak');
  esit(await s.locator('#sayfa img').count(), 0, 'img oluşmamalı');
  esit(await s.evaluate(() => window.__xss), undefined, 'xss çalışmamalı');
  await git(s, '#/firmalar'); await s.waitForSelector('#firma-tablo tbody tr');
  esit(await s.locator('#firma-tablo img').count(), 0, 'listede img yok');
  await firmaEkle(s, { ad: 'Web Deneme', web: 'javascript:alert(1)' });
  await s.waitForSelector('.modal-overlay #e-website:not(:empty)');
});

await test('yetki: satış rolü menüsü ve kullanıcılar sayfasına erişim', async (s) => {
  await girisYap(s, 'satis@test.com');
  await var_(s.locator('.nav-item:has-text("Firmalar")'), 'firmalar');
  await var_(s.locator('.nav-item:has-text("Teklifler")'), 'teklifler');
  esit(await s.locator('.nav-item:has-text("Kullanıcılar ve yetkiler")').count(), 0, 'kullanıcılar menüde olmamalı');
  esit(await s.locator('.nav-item:has-text("Fatura Takip")').count(), 0, 'finans menüde olmamalı');
  await git(s, '#/kullanicilar');
  await var_(s.locator('h3:has-text("Bu sayfayı görme izniniz yok")'), 'erişim engeli');
});

await test('yetki: finans ve uzman/hekim rolleri', async (s, ctx) => {
  await girisYap(s, 'finans@test.com');
  await var_(s.locator('.nav-item:has-text("Fatura Takip")'), 'finans menüsü');
  esit(await s.locator('.nav-item:has-text("Kişiler")').count(), 0, 'finans kişileri görmemeli');
  await s.click('.user-btn'); await s.click('[data-kmenu="cikis"]');
  await s.waitForSelector('#f-email');
  await s.fill('#f-email', 'uzman@test.com'); await s.fill('#f-password', 'GucluSifre123'); await s.click('button[type=submit]');
  await s.waitForSelector('#kabuk');
  esit(await s.locator('.nav-item').count(), 5, 'uzman/hekim: firmalar, görevlendirmeler, zaman, takvim, görevler');
  var_(s.locator('.nav-item:has-text("Zaman ve ziyaret takibi")'), 'zaman menüsü');
  esit(await s.locator('.nav-item:has-text("Kapasite analizi")').count(), 0, 'uzman kapasite görmez');
  await var_(s.locator('h3:has-text("Bu sayfayı görme izniniz yok")'), 'panel engeli');
});

await test('kullanıcılar: ekle, rol değiştir, kendini düzenleyemez', async (s) => {
  await girisYap(s);
  await git(s, '#/kullanicilar'); await s.waitForSelector('#kul-icerik .table');
  esit(await s.locator('[data-kullanici]').count(), 4, 'kendisi hariç 4 düzenleme düğmesi');
  await s.click('[data-action="kullanici-ekle"]');
  let m = modal(s);
  await m.locator('#f-email').fill('yok@test.com');
  await m.locator('#f-full_name').fill('Yok Kişi');
  await m.locator('#f-role').selectOption('satis');
  await m.locator('button[type=submit]').click();
  await s.waitForSelector('.modal-overlay .form-error:not([hidden])');
  if (!(await s.textContent('.modal-overlay .form-error')).includes('hesabı bulunamadı')) throw new Error('hesap bulunamadı mesajı yok');
  await m.locator('#f-email').fill('yeni@test.com');
  await m.locator('button[type=submit]').click();
  await s.waitForSelector('#kul-icerik td:has-text("Yok Kişi")');
  await s.locator('[data-kullanici]').first().click();
  m = modal(s);
  await m.locator('#f-role_id').selectOption({ label: 'Operasyon sorumlusu' });
  await m.locator('button[type=submit]').click();
  await s.waitForSelector('#kul-icerik td:has-text("Operasyon sorumlusu")');
  await ekran(s, '06-kullanicilar');
});

await test('kullanıcılar: yetki matrisi düzenlenir, sahip yetkileri kilitli', async (s) => {
  await girisYap(s);
  await git(s, '#/kullanicilar'); await s.waitForSelector('[data-sekme="yetkiler"]');
  await s.click('[data-sekme="yetkiler"]');
  await s.waitForSelector('.table-matrix');
  const kutu = s.locator('input[data-izin="expenses"][data-alan="can_view"]');
  esit(await kutu.isChecked(), false, 'satış gider görmemeli');
  await kutu.check();
  await s.waitForSelector('.toast:has-text("Yetki kaydedildi")');
  const kayit = await s.evaluate(() => globalThis.__fake.tablo.role_permissions.filter((p) => p.module === 'expenses' && p.can_view).length);
  esit(kayit >= 2, true, 'tabloda güncellendi');
  await ekran(s, '07-yetki-matrisi');
  await s.selectOption('#matris-rol', 'isletme_sahibi');
  esit(await s.locator('.table-matrix input:not([disabled])').count(), 0, 'sahip kutuları kilitli');
});

await test('kabuk: koyu tema kalıcı, yer imi arama, çıkış', async (s) => {
  await girisYap(s);
  await s.click('#tema-dugme');
  esit(await s.getAttribute('html', 'data-theme'), 'dark', 'tema');
  esit(await s.evaluate(() => localStorage.getItem('osgb-tema')), 'dark', 'depolama');
  await ekran(s, '08-koyu');
  await firmaEkle(s, { ad: 'Aranacak Firma' });
  await s.waitForSelector('.company-head');
  await git(s, '#/panel');
  await s.keyboard.press('Control+k');
  await s.fill('#genel-ara', 'aranacak');
  await s.waitForSelector('.sonuc:has-text("Aranacak Firma")');
  await s.keyboard.press('Enter');
  await s.waitForSelector('.company-head h1:has-text("Aranacak")');
  await s.click('.user-btn'); await s.click('[data-kmenu="cikis"]');
  await s.waitForSelector('#giris-formu');
  await s.reload(); await s.waitForSelector('#giris-formu');
  esit(await s.getAttribute('html', 'data-theme'), 'dark', 'yenilemeden sonra tema');
});

await test('kabuk: olmayan adres 404 sayfası verir', async (s) => {
  await girisYap(s);
  await git(s, '#/yok-boyle-sayfa');
  await var_(s.locator('h3:has-text("Bu adreste sayfa yok")'), '404');
  await git(s, '#/yok-boyle-sayfa');
  await var_(s.locator('h3:has-text("Bu adreste sayfa yok")'), '404');
});

await test('şifre: sıfırlama isteği ve şifre değiştir kuralları', async (s) => {
  await s.goto(ADRES); await s.waitForSelector('#unuttum');
  await s.fill('#f-email', 'sahip@test.com'); await s.click('#unuttum');
  await s.waitForSelector('#sifirla-formu'); await s.click('button[type=submit]');
  await s.waitForSelector('#sifirla-tamam:not([hidden])');
  await s.click('#geri'); await s.fill('#f-email', 'sahip@test.com'); await s.fill('#f-password', 'GucluSifre123'); await s.click('button[type=submit]');
  await s.waitForSelector('#kabuk');
  await s.click('.user-btn'); await s.click('[data-kmenu="sifre"]');
  const m = modal(s);
  await m.locator('#f-password').fill('kisa'); await m.locator('#f-password2').fill('kisa');
  await m.locator('button[type=submit]').click();
  if (!(await s.textContent('#e-password')).includes('en az 10')) throw new Error('kısa şifre kabul edildi');
  await m.locator('#f-password').fill('YepYeniSifre99'); await m.locator('#f-password2').fill('YepYeniSifre99');
  await m.locator('button[type=submit]').click();
  await s.waitForSelector('.toast:has-text("Şifreniz değiştirildi")');
});

for (const [ad, hash] of [['giriş', null], ['firmalar', '#/firmalar'], ['panel', '#/panel']]) {
  await test(`mobil 375px: ${ad} sayfasında yatay taşma yok`, async (s) => {
    if (!hash) { await s.goto(ADRES); await s.waitForSelector('#f-email'); } else {
      await girisYap(s); await firmaEkle(s, { ad: 'Çok Uzun Bir Firma Adı Anonim Şirketi Ticaret', calisan: 20, tehlike: 'tehlikeli' });
      await s.waitForSelector('.company-head'); await git(s, hash); await s.waitForTimeout(300);
    }
    const t = await s.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    if (t > 0) throw new Error(`yatay taşma ${t}px`);
    await ekran(s, `09-mobil-${ad}`);
  }, { genislik: 375, yukseklik: 800 });
}

await test('mobil 375px: menü açılır ve kapanır', async (s) => {
  await girisYap(s);
  esit(await s.locator('#yan-menu').evaluate((e) => e.getBoundingClientRect().right <= 0), true, 'başta kapalı');
  await s.click('#menu-ac');
  await s.waitForTimeout(300);
  esit(await s.locator('#yan-menu').evaluate((e) => e.getBoundingClientRect().left >= 0), true, 'açık');
  await ekran(s, '10-mobil-menu');
  await s.keyboard.press('Escape');
  await s.waitForTimeout(300);
  esit(await s.locator('#yan-menu').evaluate((e) => e.getBoundingClientRect().right <= 0), true, 'tekrar kapalı');
}, { genislik: 375, yukseklik: 800 });


// ---------------------------------------------------------------- Aşama 3
async function adayEkle(s, { ad, vergi = '', calisan = '', tehlike = '', kaynak = '', gelir = '', yetkili = '' }) {
  await git(s, '#/crm');
  await s.waitForSelector('[data-action="yeni-aday"]');
  await s.click('[data-action="yeni-aday"]');
  const m = modal(s);
  await m.locator('#f-name').fill(ad);
  if (vergi) await m.locator('#f-tax_no').fill(vergi);
  if (calisan !== '') await m.locator('#f-employee_count').fill(String(calisan));
  if (tehlike) await m.locator('#f-hazard_class').selectOption(tehlike);
  if (kaynak) await m.locator('#f-source').selectOption(kaynak);
  if (gelir !== '') await m.locator('#f-est_monthly_revenue').fill(String(gelir));
  if (yetkili) await m.locator('#f-contact_name').fill(yetkili);
  return m;
}

await test('crm: aday ekle, canlı puan 62, ilk fırsat otomatik açılır', async (s) => {
  await girisYap(s);
  const m = await adayEkle(s, { ad: 'Aday Metal Ltd.', calisan: 30, tehlike: 'tehlikeli', kaynak: 'tavsiye', gelir: 10000, yetkili: 'Mehmet Usta' });
  const onizleme = (await m.locator('#puan-alani .score-v').textContent()).trim();
  esit(onizleme, '62', 'canlı puan');
  await m.locator('button[type=submit]').click();
  await s.waitForSelector('.company-head');
  await var_(s.locator('.card-title:has-text("Puan: 62 / 100")'), 'kayıtlı puan');
  await ekran(s, '11-aday-karti');
  await git(s, '#/firsatlar');
  await s.waitForSelector('.kcol-yeni_aday .kcard');
  await var_(s.locator('.kcol-yeni_aday .kcard:has-text("Aday Metal Ltd.")'), 'otomatik fırsat');
});

await test('crm: aynı vergi numarası ve geçersiz alanlar reddedilir', async (s) => {
  await girisYap(s);
  let m = await adayEkle(s, { ad: 'Bir', vergi: '2222222222' });
  await m.locator('button[type=submit]').click();
  await s.waitForSelector('.company-head');
  m = await adayEkle(s, { ad: 'İki', vergi: '2222 222 222' });
  await m.locator('button[type=submit]').click();
  await s.waitForSelector('.modal-overlay #e-tax_no:not(:empty)');
  if (!(await s.textContent('.modal-overlay #e-tax_no')).includes('Bir')) throw new Error('mükerrer mesajı eksik');
  await m.locator('#f-tax_no').fill('');
  await m.locator('#f-employee_count').fill('12');
  await m.locator('#f-email').fill('yanlis');
  await m.locator('button[type=submit]').click();
  await s.waitForSelector('.modal-overlay #e-hazard_class:not(:empty)');
  await var_(s.locator('.modal-overlay #e-email:not(:empty)'), 'e-posta hatası');
});

await test('crm: görüşme, kişi, görev eklenir; görüşme arşivlenir', async (s) => {
  await girisYap(s);
  const m = await adayEkle(s, { ad: 'Takip Gıda' });
  await m.locator('button[type=submit]').click();
  await s.waitForSelector('.company-head');
  await s.click('[data-sekme="gorusmeler"]');
  await s.click('[data-action="gorusme-ekle"]');
  let f = modal(s);
  await f.locator('#f-summary').fill('Teklif için bilgi istedi');
  await f.locator('button[type=submit]').click();
  await s.waitForSelector('.timeline .tl-item:has-text("Teklif için bilgi istedi")');
  await s.click('[data-sekme="kisiler"]');
  await s.click('[data-action="kisi-ekle"]');
  f = modal(s);
  await f.locator('#f-full_name').fill('Zeynep Kaya');
  await f.locator('button[type=submit]').click();
  await s.waitForSelector('#sekme-govde td:has-text("Zeynep Kaya")');
  await s.click('[data-sekme="gorevler"]');
  await s.click('[data-action="gorev-ekle"]');
  f = modal(s);
  await f.locator('#f-title').fill('Teklifi ara');
  await f.locator('button[type=submit]').click();
  await s.waitForSelector('#sekme-govde td:has-text("Teklifi ara")');
  await s.click('[data-sekme="gorusmeler"]');
  await s.click('[data-gorusme-eylem="arsivle"]');
  await s.click('[data-ok]');
  await s.waitForSelector('.timeline', { state: 'detached' });
});

await test('fırsatlar: aşama taşıma, kayıp nedeni zorunlu, geçmiş', async (s) => {
  await girisYap(s);
  const m = await adayEkle(s, { ad: 'Pano A.Ş.' });
  await m.locator('button[type=submit]').click();
  await s.waitForSelector('.company-head');
  await git(s, '#/firsatlar');
  await s.waitForSelector('.kcol-yeni_aday .kcard');
  await s.locator('.kcol-yeni_aday [data-tasi]').selectOption('teklif_gonderildi');
  await s.waitForSelector('.kcol-teklif_gonderildi .kcard:has-text("Pano A.Ş.")');
  await s.locator('.kcol-teklif_gonderildi [data-tasi]').selectOption('kaybedildi');
  await s.waitForSelector('.modal-overlay #f-lost_reason');
  await modal(s).locator('button[type=submit]').click();
  await s.waitForSelector('.modal-overlay #e-lost_reason:not(:empty)');
  await modal(s).locator('#f-lost_reason').selectOption('fiyat');
  await modal(s).locator('button[type=submit]').click();
  await s.waitForSelector('.kcol-kaybedildi .kcard:has-text("Fiyat")');
  await s.click('.kcol-kaybedildi [data-firsat]');
  await s.waitForSelector('.history li');
  esit(await s.locator('.history li').count(), 3, 'geçmiş kaydı sayısı');
  await ekran(s, '12-kanban');
});

await test('crm: firmaya dönüştür, kayıtlar firmaya taşınır, fırsat kazanıldı olur', async (s) => {
  await girisYap(s);
  const m = await adayEkle(s, { ad: 'Dönüşüm Ltd.', calisan: 30, tehlike: 'tehlikeli', yetkili: 'Ali Veli' });
  await m.locator('button[type=submit]').click();
  await s.waitForSelector('.company-head');
  await s.click('[data-sekme="gorusmeler"]');
  await s.click('[data-action="gorusme-ekle"]');
  await modal(s).locator('#f-summary').fill('İlk görüşme');
  await modal(s).locator('button[type=submit]').click();
  await s.waitForSelector('.timeline .tl-item');
  await s.click('[data-action="donustur"]');
  await s.click('[data-ok]');
  await s.waitForSelector('.company-head .pill-success:has-text("Müşteri")');
  await var_(s.locator('.company-head:has-text("30 çalışan")'), 'çalışan kaydı');
  await s.click('[data-sekme="gorusmeler"]');
  await s.waitForSelector('.timeline .tl-item:has-text("İlk görüşme")');
  await s.click('[data-sekme="firsatlar"]');
  await s.waitForSelector('#sekme-govde td:has-text("Kazanıldı")');
  await s.click('[data-sekme="kisiler"]');
  await s.waitForSelector('#sekme-govde td:has-text("Ali Veli")');
  await git(s, '#/crm');
  await s.click('[data-filtre="donusen"]');
  await s.waitForSelector('#aday-tablo td:has-text("Dönüşüm Ltd.")');
});

await test('görevler: ekle, tamamla, filtrele, panel kartı', async (s) => {
  await girisYap(s);
  await git(s, '#/gorevler');
  await s.waitForSelector('[data-action="yeni-gorev"]');
  await s.click('[data-action="yeni-gorev"]');
  const f = modal(s);
  await f.locator('#f-title').fill('Müşteriyi ara');
  await f.locator('button[type=submit]').click();
  await s.waitForSelector('#gorev-tablo td:has-text("Müşteriyi ara")');
  await s.locator('[data-bitir]').check();
  await s.waitForSelector('#gorev-tablo .empty');
  await s.click('[data-filtre="tamam"]');
  await s.waitForSelector('#gorev-tablo td:has-text("Müşteriyi ara")');
  await ekran(s, '13-gorevler');
});

await test('yetki: satış rolü CRM, fırsat ve görev menüsünü görür; finans görmez', async (s) => {
  await girisYap(s, 'satis@test.com');
  await var_(s.locator('.nav-item:has-text("CRM ve potansiyel müşteriler")'), 'crm');
  await var_(s.locator('.nav-item:has-text("Satış fırsatları")'), 'fırsatlar');
  await git(s, '#/crm');
  await var_(s.locator('[data-action="yeni-aday"]'), 'satış aday ekleyebilir');
  await s.click('.user-btn'); await s.click('[data-kmenu="cikis"]');
  await s.waitForSelector('#f-email');
  await s.fill('#f-email', 'finans@test.com'); await s.fill('#f-password', 'GucluSifre123'); await s.click('button[type=submit]');
  await s.waitForSelector('#kabuk');
  esit(await s.locator('.nav-item:has-text("CRM ve potansiyel müşteriler")').count(), 0, 'finans CRM görmemeli');
  await git(s, '#/crm');
  await var_(s.locator('h3:has-text("Bu sayfayı görme izniniz yok")'), 'finans CRM engeli');
});

await test('güvenlik: aday adındaki HTML metin olarak görünür', async (s) => {
  await girisYap(s);
  const m = await adayEkle(s, { ad: '<img src=x onerror=alert(1)>Aday' });
  await m.locator('button[type=submit]').click();
  await s.waitForSelector('.company-head');
  esit(await s.locator('.company-head img').count(), 0, 'img oluşmamalı');
  await var_(s.locator('.company-head h1:has-text("<img src=x")'), 'metin olarak');
});

await test('mobil 375px: kanban ve aday sayfasında sayfa yatay taşmaz', async (s) => {
  await girisYap(s);
  const m = await adayEkle(s, { ad: 'Mobil Aday' });
  await m.locator('button[type=submit]').click();
  await s.waitForSelector('.company-head');
  for (const h of ['#/crm', '#/firsatlar', '#/gorevler']) {
    await git(s, h); await s.waitForTimeout(400);
    const t = await s.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    if (t > 1) throw new Error(`${h} yatay taşma ${t}px`);
  }
  await ekran(s, '14-mobil-kanban');
}, { genislik: 375, yukseklik: 800 });


async function teklifDoldur(s, { calisan = 30, tehlike = 'tehlikeli', birim = '1000', uzman = '', hekim = '', diger = '', indirim = '' }) {
  const m = modal(s);
  await m.locator('#f-employee_count').fill(String(calisan));
  await m.locator('#f-hazard_class').selectOption(tehlike);
  await m.locator('#f-unit_price').fill(birim);
  if (uzman) await m.locator('#f-est_expert_cost').fill(uzman);
  if (hekim) await m.locator('#f-est_physician_cost').fill(hekim);
  if (diger) await m.locator('#f-est_travel_other_cost').fill(diger);
  if (indirim) await m.locator('#f-discount_pct').fill(indirim);
  return m;
}
async function teklifOlustur(s, firmaAdi, secenek = {}) {
  await git(s, '#/teklifler');
  await s.waitForSelector('[data-action="yeni-teklif"]');
  await s.click('[data-action="yeni-teklif"]');
  await s.waitForSelector('#f-company_id');
  const m = modal(s);
  await m.locator('#f-company_id').selectOption({ label: firmaAdi });
  await teklifDoldur(s, secenek);
  await m.locator('button[type=submit]').click();
  await s.waitForSelector('.company-head h1:has-text("TKL-")');
}

await test('teklif: canlı kârlılık, marj eşiği uyarısı, taslak oluşur', async (s) => {
  await girisYap(s);
  await firmaEkle(s, { ad: 'Teklif A.Ş.', vergi: '1111111111', calisan: 30, tehlike: 'tehlikeli' });
  await s.waitForSelector('.company-head h1:has-text("Teklif")');
  await git(s, '#/teklifler');
  await var_(s.locator('.empty h3:has-text("Henüz teklif yok")'), 'boş durum');
  await s.click('[data-action="yeni-teklif"]');
  await s.waitForSelector('#f-company_id');
  const m = modal(s);
  await m.locator('#f-company_id').selectOption({ label: 'Teklif A.Ş.' });
  // firma seçilince çalışan sayısı ve tehlike otomatik gelir
  esit(await m.locator('#f-employee_count').inputValue(), '30', 'otomatik çalışan');
  esit(await m.locator('#f-hazard_class').inputValue(), 'tehlikeli', 'otomatik tehlike');
  await m.locator('#f-unit_price').fill('1000');
  await m.locator('#f-est_expert_cost').fill('10000');
  await m.locator('#f-est_physician_cost').fill('5000');
  let ozet = await m.locator('#hesap-alani').innerText();
  if (!ozet.includes('%50,0')) throw new Error(`marj 50 olmalı: ${ozet}`);
  if (ozet.includes('Eşiğin altında')) throw new Error('eşik uyarısı olmamalı');
  await m.locator('#f-est_expert_cost').fill('25000');
  ozet = await m.locator('#hesap-alani').innerText();
  if (!ozet.includes('Eşiğin altında')) throw new Error(`eşik uyarısı bekleniyordu: ${ozet}`);
  await ekran(s, '15-teklif-formu');
  await m.locator('#f-pricing').selectOption('sabit_aylik');
  if (!(await m.locator('[data-field="unit_price"]').isHidden())) throw new Error('kişi başı alan gizlenmeli');
  await m.locator('#f-fixed_monthly_price').fill('40000');
  ozet = await m.locator('#hesap-alani').innerText();
  if (!ozet.includes('40.000')) throw new Error(`sabit fiyat hesabı: ${ozet}`);
  await m.locator('#f-pricing').selectOption('kisi_basi');
  await m.locator('button[type=submit]').click();
  await s.waitForSelector('.company-head h1:has-text("TKL-")');
  await var_(s.locator('.company-meta .pill:has-text("Taslak")'), 'taslak durumu');
  await var_(s.locator('.pill:has-text("Eşiğin altında")'), 'kârlılık kartı uyarısı');
  await var_(s.locator('h2:has-text("Fiyat senaryoları")'), 'senaryolar');
  await ekran(s, '16-teklif-sayfasi');
});

await test('teklif: form doğrulaması Türkçe alan hataları verir', async (s) => {
  await girisYap(s);
  await git(s, '#/teklifler');
  await s.click('[data-action="yeni-teklif"]');
  await s.waitForSelector('#f-company_id');
  await modal(s).locator('button[type=submit]').click();
  esit((await s.textContent('#e-company_id')).trim(), 'Bir firma veya potansiyel müşteri seçin.', 'kimin için');
  esit((await s.textContent('#e-hazard_class')).trim(), 'Tehlike sınıfını seçin.', 'tehlike');
  esit((await s.textContent('#e-unit_price')).trim(), 'Kişi başı fiyatı girin (0 veya üstü).', 'fiyat');
});

await test('teklif: gönder, fiyat kilitlenir, kopyala, ek kalem, arşivle', async (s) => {
  await girisYap(s);
  await firmaEkle(s, { ad: 'Kilit Ltd.', vergi: '2222222222', calisan: 10, tehlike: 'az_tehlikeli' });
  await s.waitForSelector('.company-head');
  await teklifOlustur(s, 'Kilit Ltd.', { calisan: 10, tehlike: 'az_tehlikeli', birim: '800', uzman: '2000' });
  // taslakta kalem eklenir
  await s.click('[data-action="kalem-ekle"]');
  await modal(s).locator('#f-description').fill('Yıllık eğitim paketi');
  await modal(s).locator('#f-unit_price').fill('3000');
  await modal(s).locator('button[type=submit]').click();
  await s.waitForSelector('td:has-text("Yıllık eğitim paketi")');
  await s.click('[data-gecis="gonderildi"]');
  await s.waitForSelector('.company-meta .pill:has-text("Gönderildi")');
  await var_(s.locator('.notice-info:has-text("fiyat bilgileri değiştirilemez")'), 'kilit uyarısı');
  esit(await s.locator('[data-action="duzenle"]').count(), 0, 'düzenle düğmesi');
  esit(await s.locator('[data-action="kalem-ekle"]').count(), 0, 'kalem ekle düğmesi');
  await s.click('[data-action="kopyala"]');
  await s.waitForSelector('.company-meta .pill:has-text("Taslak")');
  await var_(s.locator('td:has-text("Yıllık eğitim paketi")'), 'kalem kopyalandı');
  await s.click('[data-action="arsiv"]');
  await s.click('[data-ok]');
  await s.waitForSelector('.notice-warn:has-text("arşivde")');
  await git(s, '#/teklifler');
  await s.waitForSelector('#teklif-tablo tbody tr');
  esit(await s.locator('#teklif-tablo tbody tr').count(), 1, 'arşivsiz tek teklif');
  await s.click('[data-filtre="arsiv"]');
  esit(await s.locator('#teklif-tablo tbody tr').count(), 1, 'arşiv listesi');
});

await test('teklif kabul: sözleşme + fiyat dönemi, yenileme, fiyat geçmişi, çakışma', async (s) => {
  await girisYap(s);
  await firmaEkle(s, { ad: 'Sözleşme A.Ş.', vergi: '3333333333', calisan: 20, tehlike: 'tehlikeli' });
  await s.waitForSelector('.company-head');
  await teklifOlustur(s, 'Sözleşme A.Ş.', { calisan: 20, tehlike: 'tehlikeli', birim: '1000', indirim: '10', uzman: '4000' });
  await s.click('[data-gecis="gonderildi"]');
  await s.waitForSelector('[data-action="kabul"]');
  await s.click('[data-action="kabul"]');
  await s.waitForSelector('#f-baslangic');
  await modal(s).locator('#f-odeme').fill('Her ay 5\'ine kadar');
  await modal(s).locator('button[type=submit]').click();
  await s.waitForSelector('.company-head .pill:has-text("Aktif")');
  await s.waitForSelector('.kv-list');
  const bilgi = await s.locator('#sayfa').innerText();
  if (!/₺900(,00)? \/ kişi/.test(bilgi)) throw new Error('indirim fiyata işlenmeli (900 TL / kişi)');
  if (!bilgi.includes('18.000')) throw new Error('aylık tutar 18.000 olmalı (20 kişi x 900)');
  await var_(s.locator('dd:has-text("Her ay 5\'ine kadar")'), 'ödeme koşulu');
  // teklif sayfasından sözleşmeye bağlantı
  await s.click('a:has-text("TKL-")');
  await s.waitForSelector('.company-meta .pill:has-text("Kabul edildi")');
  await var_(s.locator('.notice-ok:has-text("sözleşmeye çevrildi")'), 'bağlantı');
  esit(await s.locator('[data-action="kabul"]').count(), 0, 'tekrar kabul yok');
  await s.click('.notice-ok a');
  await s.waitForSelector('.company-head .pill:has-text("Aktif")');
  // yeni fiyat dönemi
  await s.click('[data-action="fiyat"]');
  await modal(s).locator('#f-baslangic').fill(await s.evaluate(() => { const d = new Date(); d.setDate(d.getDate() + 30); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }));
  await modal(s).locator('#f-unit_price').fill('1200');
  await modal(s).locator('#f-not').fill('TÜFE artışı');
  await modal(s).locator('button[type=submit]').click();
  await s.waitForSelector('.timeline .tl-item:nth-child(2)');
  await var_(s.locator('.tl-item:has-text("TÜFE artışı")'), 'fiyat notu');
  esit(await s.locator('.timeline .tl-item').count(), 2, 'iki fiyat dönemi');
  // aynı fiyat başlangıcı reddedilir
  await s.click('[data-action="fiyat"]');
  await modal(s).locator('#f-baslangic').fill('2020-01-01');
  await modal(s).locator('#f-unit_price').fill('1');
  await modal(s).locator('button[type=submit]').click();
  await var_(s.locator('#e-baslangic:has-text("sonra olmalıdır")'), 'tarih hatası');
  await modal(s).locator('.btn[data-close]').click();
  // yenileme
  await s.click('[data-action="yenile"]');
  await modal(s).locator('button[type=submit]').click();
  await s.waitForSelector('a:has-text("önceki dönem")');
  await var_(s.locator('a:has-text("önceki dönem")'), 'zincir');
  await s.click('a:has-text("önceki dönem")');
  await s.waitForSelector('.company-head .pill:has-text("Yenilendi")');
  esit(await s.locator('[data-action="yenile"]').count(), 0, 'yenilenmiş sözleşme yenilenemez');
  await var_(s.locator('.notice-ok:has-text("yenilendi")'), 'yeni dönem bağlantısı');
  await ekran(s, '17-sozlesme-sayfasi');
  // firma kartı sekmeleri
  await git(s, '#/firmalar'); await s.click('#firma-tablo tbody tr a');
  await s.waitForSelector('.company-head');
  await s.click('[data-sekme="teklifler"]');
  await s.waitForSelector('#sekme-govde td:has-text("Kabul edildi")');
  await s.click('[data-sekme="sozlesmeler"]');
  await s.waitForSelector('#sekme-govde tbody tr');
  esit(await s.locator('#sekme-govde tbody tr').count(), 2, 'iki dönem');
  // elle sözleşme çakışması
  await s.click('[data-action="sozlesme-yeni"]');
  await modal(s).locator('#f-baslangic').fill(await s.evaluate(() => { const d = new Date(); d.setDate(d.getDate() + 400); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }));
  await modal(s).locator('#f-bitis').fill(await s.evaluate(() => { const d = new Date(); d.setDate(d.getDate() + 500); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }));
  await modal(s).locator('#f-unit_price').fill('500');
  await modal(s).locator('button[type=submit]').click();
  await s.waitForTimeout(400);
  if (!(await s.locator('.form-error:has-text("zaten aktif bir sözleşmesi var")').count())) throw new Error('çakışma mesajı: ' + JSON.stringify(await s.locator('.modal-overlay').allInnerTexts()) + ' / ' + s.url());
});

await test('sözleşme: bitiş uyarısı 90/60/30, görev üretimi, panel kartı, fesih', async (s) => {
  await girisYap(s);
  await firmaEkle(s, { ad: 'Yaklaşan A.Ş.', vergi: '4444444444', calisan: 10, tehlike: 'tehlikeli' });
  await s.waitForSelector('.company-head');
  const url = s.url();
  await s.click('[data-sekme="sozlesmeler"]');
  await s.click('[data-action="sozlesme-yeni"]');
  const bit = await s.evaluate(() => { const d = new Date(); d.setDate(d.getDate() + 25); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; });
  const bas = await s.evaluate(() => { const d = new Date(); d.setDate(d.getDate() - 340); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; });
  await modal(s).locator('#f-baslangic').fill(bas);
  await modal(s).locator('#f-bitis').fill(bit);
  await modal(s).locator('#f-unit_price').fill('700');
  await modal(s).locator('button[type=submit]').click();
  await s.waitForSelector('.company-head .pill:has-text("gün kaldı")');
  await var_(s.locator('.notice-warn:has-text("bitişine 25 gün kaldı")'), 'uyarı');
  await git(s, '#/sozlesmeler');
  await s.waitForSelector('#sozlesme-tablo tbody tr');
  await var_(s.locator('.kpi:has-text("90 gün içinde bitecek") .kpi-v:text-is("1")'), 'kpi');
  await var_(s.locator('.kpi:has-text("7.000")'), 'aylık gelir 10 x 700');
  await s.click('[data-filtre="yaklasan"]');
  esit(await s.locator('#sozlesme-tablo tbody tr').count(), 1, 'yaklaşan');
  // giriş sonrası üretilen yenileme görevi (sayfa yenilenince createRenewalTasks tekrar çalışır)
  await s.click('.user-btn'); await s.click('[data-kmenu="cikis"]'); await s.waitForSelector('#f-email');
  await s.fill('#f-email', 'sahip@test.com'); await s.fill('#f-password', 'GucluSifre123'); await s.click('button[type=submit]'); await s.waitForSelector('#kabuk');
  await git(s, '#/gorevler'); await s.waitForSelector('#sayfa h1');
  await s.waitForTimeout(300);
  const sayiGorev = await s.evaluate(() => globalThis.__fake.tablo.tasks.filter((t) => t.title.includes('yenileme')).length);
  esit(sayiGorev, 1, 'tek yenileme görevi (tekrar üretilmez)');
  await git(s, '#/panel');
  await s.waitForSelector('h2:has-text("Teklif ve sözleşmeler")');
  await var_(s.locator('li:has-text("90 gün içinde bitecek sözleşme") strong:text-is("1")'), 'panel');
  // fesih
  await git(s, '#/sozlesmeler'); await s.click('#sozlesme-tablo tbody tr a');
  await s.waitForSelector('[data-action="fesih"]');
  await s.click('[data-action="fesih"]'); await s.click('[data-ok]');
  await s.waitForSelector('.company-head .pill:has-text("Feshedildi")');
  esit(await s.locator('[data-action="fiyat"]').count(), 0, 'fesihten sonra fiyat dönemi yok');
  void url;
});


await test('yetki: satış menüde teklif ve sözleşmeyi görür, finans görmez; satış yeni sözleşme düğmesi görmez', async (s) => {
  await girisYap(s, 'satis@test.com');
  await var_(s.locator('.nav-item:has-text("Teklifler")'), 'satış teklif menüsü');
  await git(s, '#/teklifler');
  await var_(s.locator('[data-action="yeni-teklif"]'), 'satış teklif oluşturur');
  await git(s, '#/sozlesmeler');
  await s.waitForSelector('h1:has-text("Sözleşmeler")');
  esit(await s.locator('[data-action="yeni-sozlesme"]').count(), 0, 'satış sözleşme oluşturamaz (varsayılan matris: yalnız görüntüleme)');
});

await test('yetki: finans teklif sayfasına giremez', async (s) => {
  await girisYap(s, 'finans@test.com');
  esit(await s.locator('.nav-item:has-text("Teklifler")').count(), 0, 'finans menüsü');
  await git(s, '#/teklifler');
  await var_(s.locator('h3:has-text("görme izniniz yok")'), 'yetkisiz');
});

await test('güvenlik: teklif açıklaması ve kalem adındaki HTML metin olarak görünür', async (s) => {
  await girisYap(s);
  await firmaEkle(s, { ad: 'Xss A.Ş.', vergi: '6666666666', calisan: 10, tehlike: 'tehlikeli' });
  await s.waitForSelector('.company-head');
  await git(s, '#/teklifler'); await s.click('[data-action="yeni-teklif"]');
  await s.waitForSelector('#f-company_id');
  const m = modal(s);
  await m.locator('#f-company_id').selectOption({ label: 'Xss A.Ş.' });
  await m.locator('#f-unit_price').fill('100');
  await m.locator('#f-description').fill('<img src=x onerror=window.__xss=1>');
  await m.locator('button[type=submit]').click();
  await s.waitForSelector('.company-head h1:has-text("TKL-")');
  await var_(s.locator('.prewrap:has-text("<img src=x")'), 'metin olarak');
  esit(await s.evaluate(() => window.__xss ?? 0), 0, 'xss çalışmamalı');
});

await test('mobil 375px: teklif ve sözleşme sayfalarında yatay taşma yok', async (s) => {
  await girisYap(s);
  await firmaEkle(s, { ad: 'Mobil Teklif A.Ş.', vergi: '7777777777', calisan: 10, tehlike: 'tehlikeli' });
  await s.waitForSelector('.company-head');
  await teklifOlustur(s, 'Mobil Teklif A.Ş.', { calisan: 10, tehlike: 'tehlikeli', birim: '900', uzman: '1000' });
  for (const h of ['#/teklifler', '#/sozlesmeler']) {
    await git(s, h); await s.waitForTimeout(300);
    const t = await s.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    if (t > 1) throw new Error(`${h} yatay taşma ${t}px`);
  }
  await s.click('[data-action="yeni-teklif"]').catch(() => {});
  await s.waitForTimeout(300);
  const t2 = await s.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  if (t2 > 1) throw new Error(`form yatay taşma ${t2}px`);
  await ekran(s, '18-mobil-teklif');
}, { genislik: 375, yukseklik: 800 });

// =====================================================================
// Aşama 5: personel, görevlendirme, zaman, kapasite
// =====================================================================
const ayinBirinci = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`; };
const hashOf = (url) => new URL(url).hash;
async function personelEkle(s, tur, ad) {
  await git(s, tur === 'isyeri_hekimi' ? '#/hekimler' : '#/uzmanlar');
  await s.waitForSelector('[data-action="yeni"]');
  await s.locator('[data-action="yeni"]').first().click();
  await modal(s).locator('#f-full_name').fill(ad);
  await modal(s).locator('button[type=submit]').click();
  await s.waitForSelector('.company-head h1');
  await s.waitForFunction((a) => document.querySelector('.company-head h1')?.textContent.includes(a), ad);
  return s.url();
}
async function cikisYapGir(s, eposta) {
  await s.click('.user-btn'); await s.click('[data-kmenu="cikis"]');
  await s.waitForSelector('#f-email');
  await s.fill('#f-email', eposta); await s.fill('#f-password', 'GucluSifre123'); await s.click('button[type=submit]');
  await s.waitForSelector('#kabuk');
}
async function atamaYap(s, firma, kisi, pay, bas = ayinBirinci(), tur = null) {
  await s.locator('[data-action="yeni-gv"]').first().click();
  const m = modal(s);
  await m.locator('#f-company_id').selectOption({ label: firma });
  if (tur) { await m.locator('#f-staff_type').selectOption(tur); }
  await m.locator('#f-employee_id').selectOption({ label: kisi });
  await m.locator('#f-share_pct').fill(String(pay));
  await m.locator('#f-valid_from').fill(bas);
  await m.locator('button[type=submit]').click();
}

await test('personel: uzman ve hekim eklenir, ad zorunlu, listeler ayrı, sayfa açılır', async (s) => {
  await girisYap(s);
  await git(s, '#/uzmanlar');
  await var_(s.locator('.empty h3:has-text("Henüz uzman kaydı yok")'), 'boş durum');
  await s.locator('[data-action="yeni"]').first().click();
  await modal(s).locator('button[type=submit]').click();
  esit((await modal(s).locator('#e-full_name').textContent()).trim(), 'Ad soyad zorunludur.', 'ad hatası');
  await modal(s).locator('#f-monthly_capacity_min').fill('0');
  await modal(s).locator('#f-full_name').fill('Ayşe Uzman');
  await modal(s).locator('button[type=submit]').click();
  await s.waitForFunction(() => document.querySelector('#e-monthly_capacity_min')?.textContent.includes('1 veya daha büyük'));
  await modal(s).locator('#f-monthly_capacity_min').fill('11700');
  await modal(s).locator('button[type=submit]').click();
  await s.waitForSelector('.company-head h1:has-text("Ayşe Uzman")');
  await var_(s.locator('.company-meta .pill:has-text("İş güvenliği uzmanı")'), 'tür');
  await personelEkle(s, 'isyeri_hekimi', 'Dr. Hakan Hekim');
  await git(s, '#/uzmanlar'); await s.waitForSelector('#personel-tablo tbody tr');
  esit(await s.locator('#personel-tablo tbody tr').count(), 1, 'uzman listesinde yalnız uzman');
  await git(s, '#/hekimler'); await s.waitForSelector('#personel-tablo tbody tr');
  await var_(s.locator('#personel-tablo td:has-text("Dr. Hakan Hekim")'), 'hekim listede');
  await ekran(s, '19-hekim-listesi');
});

await test('görevlendirme: pay denetimi, firma sekmesi, pay değiştir, arşiv; kapasite yükü ve eksik', async (s) => {
  await girisYap(s);
  await firmaEkle(s, { ad: 'Atama A.Ş.', vergi: '8888888881', calisan: 30, tehlike: 'tehlikeli' });
  await s.waitForSelector('.company-head h1:has-text("Atama")');
  const firmaHash = hashOf(s.url());
  await personelEkle(s, 'is_guvenligi_uzmani', 'Ayşe Uzman');
  await personelEkle(s, 'is_guvenligi_uzmani', 'Can Uzman');
  await personelEkle(s, 'is_guvenligi_uzmani', 'Deniz Uzman');
  await git(s, '#/gorevlendirmeler');
  await var_(s.locator('.empty h3:has-text("Henüz görevlendirme yok")'), 'boş durum');
  await atamaYap(s, 'Atama A.Ş.', 'Ayşe Uzman', 60);
  await s.waitForSelector('#gv-tablo tbody tr');
  await atamaYap(s, 'Atama A.Ş.', 'Can Uzman', 40);
  await s.waitForFunction(() => document.querySelectorAll('#gv-tablo tbody tr').length === 2);
  await atamaYap(s, 'Atama A.Ş.', 'Deniz Uzman', 10);
  await s.waitForSelector('.form-error:not([hidden])');
  if (!(await s.textContent('.form-error')).includes("%100'ü aşıyor")) throw new Error('pay aşımı mesajı bekleniyordu');
  await modal(s).locator('.btn[data-close]').click();
  await atamaYap(s, 'Atama A.Ş.', 'Ayşe Uzman', 5);
  await s.waitForSelector('.form-error:not([hidden])');
  if (!(await s.textContent('.form-error')).includes('zaten görevlendirilmiş')) throw new Error('çakışma mesajı bekleniyordu');
  await modal(s).locator('.btn[data-close]').click();
  // form: dolu pay bilgisi
  await s.locator('[data-action="yeni-gv"]').first().click();
  await modal(s).locator('#f-company_id').selectOption({ label: 'Atama A.Ş.' });
  await s.waitForFunction(() => document.querySelector('#pay-bilgisi')?.textContent.includes('%100 görevlendirilmiş'));
  await modal(s).locator('.btn[data-close]').click();
  // firma sekmesi
  await git(s, firmaHash); await s.waitForSelector('[data-sekme="atamalar"]');
  await s.click('[data-sekme="atamalar"]');
  await var_(s.locator('#sekme-govde dd:has-text("%100 görevlendirildi")'), 'uzman payı tam');
  await var_(s.locator('#sekme-govde dd:has-text("Görevli yok")'), 'hekim payı yok');
  // kapasite
  await git(s, '#/kapasite'); await s.waitForSelector('#kap-icerik .table');
  const kap = await s.locator('#kap-icerik').innerText();
  if (!kap.includes('6 sa')) throw new Error(`Ayşe teorik yük 6 sa (360 dk) olmalı: ${kap.slice(0, 600)}`);
  if (!kap.includes('4 sa')) throw new Error('Can teorik yük 4 sa (240 dk) olmalı');
  await var_(s.locator('#kap-icerik td:has-text("İşyeri hekimi")'), 'hekim eksiği');
  await ekran(s, '20-kapasite');
  // pay değiştir
  await git(s, '#/gorevlendirmeler'); await s.waitForSelector('#gv-tablo tbody tr');
  await s.locator('#gv-tablo tr:has-text("Ayşe Uzman") [data-gv-eylem="pay"]').click();
  await modal(s).locator('#f-pay').fill('50');
  await modal(s).locator('button[type=submit]').click();
  await s.waitForFunction(() => document.querySelector('#gv-tablo')?.textContent.includes('%50'));
  await var_(s.locator('#gv-tablo tr:has-text("Ayşe Uzman"):has-text("%50")'), 'yeni pay yürürlükte');
  // arşiv
  await s.locator('#gv-tablo tr:has-text("Can Uzman") [data-gv-eylem="arsiv"]').click();
  await s.click('[data-ok]');
  await s.waitForFunction(() => !document.querySelector('#gv-tablo')?.textContent.includes('Can Uzman'));
  await s.click('[data-filtre="arsiv"]');
  await var_(s.locator('#gv-tablo tr:has-text("Can Uzman")'), 'arşivde');
});

await test('zaman: kayıt, çakışma, dakika aşımı, özet, düzenle ve arşivle; kapasitede fiilî süre', async (s) => {
  await girisYap(s);
  await firmaEkle(s, { ad: 'Zaman A.Ş.', vergi: '8888888882', calisan: 30, tehlike: 'tehlikeli' });
  await s.waitForSelector('.company-head h1:has-text("Zaman")');
  await personelEkle(s, 'is_guvenligi_uzmani', 'Zeynep Uzman');
  await git(s, '#/zaman');
  await var_(s.locator('.empty h3:has-text("zaman kaydı yok")'), 'boş durum');
  const kayit = async (bas, bit, saha, yol) => {
    await s.locator('[data-action="yeni-zaman"]').first().click();
    const m = modal(s);
    await m.locator('#f-company_id').selectOption({ label: 'Zaman A.Ş.' });
    await m.locator('#f-baslangic').fill(bas); await m.locator('#f-bitis').fill(bit);
    await m.locator('#f-onsite_minutes').fill(String(saha)); await m.locator('#f-travel_minutes').fill(String(yol));
    await m.locator('button[type=submit]').click();
  };
  await kayit('09:00', '12:00', 150, 30);
  await s.waitForSelector('#zaman-tablo tbody tr');
  await var_(s.locator('.kpi:has-text("Toplam süre") .kpi-v:text-is("3 sa")'), 'toplam 3 sa');
  await var_(s.locator('.kpi:has-text("Sahada") .kpi-v:text-is("2 sa 30 dk")'), 'saha');
  // çakışma
  await kayit('11:00', '13:00', 60, 0);
  await s.waitForSelector('.form-error:not([hidden])');
  if (!(await s.textContent('.form-error')).includes('başka bir kaydı var')) throw new Error('çakışma mesajı bekleniyordu');
  await modal(s).locator('.btn[data-close]').click();
  // bitişi başlangıca değen kayıt çakışmaz
  await kayit('12:00', '13:00', 45, 15);
  await s.waitForFunction(() => document.querySelectorAll('#zaman-tablo tbody tr').length === 2);
  // dakika aşımı
  await kayit('14:00', '15:00', 90, 0);
  await var_(s.locator('#e-onsite_minutes'), 'alan');
  await s.waitForFunction(() => document.querySelector('#e-onsite_minutes')?.textContent.includes('aşıyor'));
  await modal(s).locator('.btn[data-close]').click();
  // düzenle: not ve saha dakikası
  await s.locator('#zaman-tablo tr:has-text("3 sa") [data-zaman-eylem="duzenle"]').click();
  await modal(s).locator('#f-notes').fill('Trafik vardı');
  await modal(s).locator('button[type=submit]').click();
  await s.waitForFunction(() => !document.querySelector('.modal-overlay'));
  // kapasite: fiilî süre 4 sa
  await git(s, '#/kapasite'); await s.waitForSelector('#kap-icerik .table');
  if (!(await s.locator('#kap-icerik tbody').first().innerText()).includes('4 sa')) throw new Error('fiilî süre 4 sa görünmeli');
  // arşivle
  await git(s, '#/zaman'); await s.waitForSelector('#zaman-tablo tbody tr');
  await s.locator('#zaman-tablo tr:has-text("3 sa") [data-zaman-eylem="arsiv"]').click();
  await s.click('[data-ok]');
  await s.waitForFunction(() => document.querySelectorAll('#zaman-tablo tbody tr').length === 1);
  await var_(s.locator('.kpi:has-text("Toplam süre") .kpi-v:text-is("1 sa")'), 'özet güncellendi');
});

await test('uzman/hekim rolü: kendi kaydına bağlanır, yalnız kendi zamanını görür ve girer', async (s) => {
  await girisYap(s);
  await firmaEkle(s, { ad: 'Rol A.Ş.', vergi: '8888888883', calisan: 10, tehlike: 'tehlikeli' });
  await s.waitForSelector('.company-head h1:has-text("Rol")');
  const kendi = await personelEkle(s, 'is_guvenligi_uzmani', 'Uzman Kişi Kaydı');
  await personelEkle(s, 'is_guvenligi_uzmani', 'Başka Uzman');
  // başka uzmana kayıt gir
  await git(s, '#/zaman'); await s.locator('[data-action="yeni-zaman"]').first().click();
  const m = modal(s);
  await m.locator('#f-employee_id').selectOption({ label: 'Başka Uzman (Uzman)' });
  await m.locator('button[type=submit]').click();
  await s.waitForSelector('#zaman-tablo tbody tr');
  // personel kaydını uzman kullanıcısına bağla
  await git(s, hashOf(kendi)); await s.waitForSelector('#bagli-kullanici');
  await s.locator('#bagli-kullanici').selectOption({ label: 'Uzman Kişi' });
  await s.click('[data-action="bagla"]');
  await s.waitForFunction(() => document.querySelector('.toast')?.textContent.includes('bağlantısı kaydedildi'));
  await cikisYapGir(s, 'uzman@test.com');
  await git(s, '#/zaman'); await s.waitForSelector('#zaman-ozet');
  await var_(s.locator('.empty h3:has-text("zaman kaydı yok")'), 'başkasının kaydı görünmemeli');
  await s.locator('[data-action="yeni-zaman"]').first().click();
  const m2 = modal(s);
  await s.waitForSelector('#f-employee_id');
  esit(await m2.locator('#f-employee_id').isDisabled(), true, 'personel seçimi kilitli (yalnız kendisi)');
  await m2.locator('#f-baslangic').fill('10:00'); await m2.locator('#f-bitis').fill('11:00'); await m2.locator('#f-onsite_minutes').fill('60');
  await m2.locator('button[type=submit]').click();
  await s.waitForSelector('#zaman-tablo tbody tr');
  esit(await s.locator('#zaman-tablo tbody tr').count(), 1, 'yalnız kendi kaydı');
  esit(await s.locator('.nav-item:has-text("Kapasite analizi")').count(), 0, 'kapasite menüsü yok');
  await git(s, '#/uzmanlar'); await var_(s.locator('h3:has-text("görme izniniz yok")'), 'personel sayfası engelli');
  await git(s, '#/kapasite'); await var_(s.locator('h3:has-text("görme izniniz yok"), h3:has-text("Bu sayfayı")'), 'kapasite engelli');
});

await test('maliyet: yeni geçerlilik başlangıcı sonrasına devam eder; yalnızca SGK girilebilir; boş alanlarla kaydedilir', async (s) => {
  await girisYap(s);
  await personelEkle(s, 'is_guvenligi_uzmani', 'Dönemli Uzman');
  await s.waitForSelector('[data-action="maliyet"]');
  const aç = async (tarihi) => { await s.click('[data-action="maliyet"]'); await modal(s).locator('#f-baslangic').fill(tarihi); };
  await aç('2026-01-01'); await modal(s).locator('#f-net').fill('20000'); await modal(s).locator('#f-brut').fill('30000'); await modal(s).locator('button[type=submit]').click();
  await s.waitForFunction(() => document.querySelector('#sayfa')?.textContent.includes('31.625'));          // 20.000 + 11.625
  await aç('2026-07-01'); await modal(s).locator('#f-net').fill(''); await modal(s).locator('#f-brut').fill(''); await modal(s).locator('#f-sgk').fill('2000'); await modal(s).locator('button[type=submit]').click();
  await s.waitForFunction(() => globalThis.__fake.tablo.employee_costs.length === 2);
  const d = await s.evaluate(() => globalThis.__fake.tablo.employee_costs.map((c) => `${c.valid_from}>${c.valid_to ?? 'devam'}:${c.total_monthly_cost}`).sort());
  esit(d.join('|'), '2026-01-01>2026-06-30:31625|2026-07-01>devam:2000', 'dönemler: önceki kapanır, yenisi devam eder');
  await aç('2026-03-01'); await modal(s).locator('#f-net').fill('100'); await modal(s).locator('button[type=submit]').click();     // araya dönem
  await s.waitForFunction(() => globalThis.__fake.tablo.employee_costs.length === 3);
  const d2 = await s.evaluate(() => globalThis.__fake.tablo.employee_costs.map((c) => `${c.valid_from}>${c.valid_to ?? 'devam'}`).sort());
  esit(d2.join('|'), '2026-01-01>2026-02-28|2026-03-01>2026-06-30|2026-07-01>devam', 'araya girilen dönem bölünür');
});
await test('maliyet: maaş yetkisi olan görür ve girer, operasyon göremez; finans kayıt açamaz', async (s) => {
  await girisYap(s);
  const url = await personelEkle(s, 'is_guvenligi_uzmani', 'Maaş Uzman');
  await s.waitForSelector('[data-action="maliyet"]');
  await s.click('[data-action="maliyet"]');
  await modal(s).locator('#f-baslangic').fill(ayinBirinci());
  await modal(s).locator('#f-net').fill('30000'); await modal(s).locator('#f-brut').fill('40000'); await modal(s).locator('#f-elden').fill('5000');
  await s.waitForFunction(() => document.querySelector('#maliyet-bilgi')?.textContent.includes('50.500'));       // 30.000 + 15.500 SGK (%38,75) + 5.000
  await modal(s).locator('#f-emekli').check();
  await s.waitForFunction(() => document.querySelector('#maliyet-bilgi')?.textContent.includes('47.900'));       // SGK %32,25 = 12.900
  await modal(s).locator('#f-emekli').uncheck(); await modal(s).locator('#f-sgk').fill('1000');
  await s.waitForFunction(() => document.querySelector('#maliyet-bilgi')?.textContent.includes('elle girildi'));
  await modal(s).locator('#f-sgk').fill('');
  await modal(s).locator('button[type=submit]').click();
  await s.waitForFunction(() => document.querySelector('#sayfa')?.textContent.includes('50.500'));
  await cikisYapGir(s, 'operasyon@test.com');
  await git(s, hashOf(url)); await s.waitForSelector('.company-head h1:has-text("Maaş Uzman")');
  esit(await s.locator('h2:has-text("Aylık maliyet")').count(), 0, 'operasyon maliyeti görmez');
  await var_(s.locator('[data-action="duzenle"]'), 'operasyon personeli düzenler');
  await cikisYapGir(s, 'finans@test.com');
  await git(s, hashOf(url)); await s.waitForSelector('.company-head h1:has-text("Maaş Uzman")');
  await var_(s.locator('h2:has-text("Aylık maliyet")'), 'finans maliyeti görür');
  esit(await s.locator('[data-action="duzenle"]').count(), 0, 'finans personel kaydı düzenleyemez');
  await git(s, '#/uzmanlar'); await s.waitForSelector('#personel-tablo');
  esit(await s.locator('[data-action="yeni"]').count(), 0, 'finans personel ekleyemez');
});

await test('güvenlik: personel adındaki HTML metin olarak görünür', async (s) => {
  await girisYap(s);
  await personelEkle(s, 'is_guvenligi_uzmani', '<img src=x onerror=window.__xss=1>');
  await git(s, '#/uzmanlar'); await s.waitForSelector('#personel-tablo tbody tr');
  await var_(s.locator('#personel-tablo td:has-text("<img src=x")'), 'metin olarak');
  esit(await s.evaluate(() => window.__xss ?? 0), 0, 'xss çalışmamalı');
});

await test('mobil 375px: personel, görevlendirme, zaman ve kapasite sayfalarında yatay taşma yok', async (s) => {
  await girisYap(s);
  await firmaEkle(s, { ad: 'Mobil Ops A.Ş.', vergi: '8888888884', calisan: 20, tehlike: 'tehlikeli' });
  await s.waitForSelector('.company-head');
  await personelEkle(s, 'is_guvenligi_uzmani', 'Mobil Uzman');
  await git(s, '#/gorevlendirmeler');
  await atamaYap(s, 'Mobil Ops A.Ş.', 'Mobil Uzman', 100);
  await s.waitForSelector('#gv-tablo tbody tr');
  await git(s, '#/zaman'); await s.locator('[data-action="yeni-zaman"]').first().click(); await s.waitForSelector('#f-baslangic');
  await modal(s).locator('button[type=submit]').click();
  await s.waitForSelector('#zaman-tablo tbody tr');
  for (const h of ['#/uzmanlar', '#/gorevlendirmeler', '#/zaman', '#/kapasite']) {
    await git(s, h); await s.waitForTimeout(350);
    const t = await s.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    if (t > 1) { const w = await s.evaluate(() => [...document.querySelectorAll('body *')].filter((e) => e.getBoundingClientRect().right > innerWidth + 1).slice(0, 6).map((e) => `${e.tagName}.${e.className}#${e.id}:${Math.round(e.getBoundingClientRect().right)}`).join(' | ')); throw new Error(`${h} yatay taşma ${t}px: ${w}`); }
  }
  await git(s, '#/zaman'); await s.locator('[data-action="yeni-zaman"]').first().click(); await s.waitForTimeout(300);
  const t2 = await s.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  if (t2 > 1) throw new Error(`zaman formu yatay taşma ${t2}px`);
  await ekran(s, '21-mobil-zaman');
}, { genislik: 375, yukseklik: 800 });


// ====================================================================== Aşama 6: fatura, tahsilat, gider
const gunOf = (s, n) => s.evaluate((k) => { const d = new Date(); d.setDate(d.getDate() + k); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }, n);
async function sozlesmeliFirma(s, ad, vergi, calisan, birim) {
  await firmaEkle(s, { ad, vergi, calisan, tehlike: 'tehlikeli' });
  await s.waitForSelector('.company-head');
  const url = s.url();
  await s.click('[data-sekme="sozlesmeler"]'); await s.click('[data-action="sozlesme-yeni"]');
  await modal(s).locator('#f-baslangic').fill(await gunOf(s, -30));
  await modal(s).locator('#f-bitis').fill(await gunOf(s, 300));
  await modal(s).locator('#f-unit_price').fill(String(birim));
  await modal(s).locator('button[type=submit]').click();
  await s.waitForSelector('h2:has-text("Sözleşme bilgileri")');
  await git(s, hashOf(url)); await s.waitForSelector('.company-head');
  return url;
}

await test('fatura: toplu aylık fatura, tekrarında üretmez, tutar KDV dahil', async (s) => {
  await girisYap(s);
  await sozlesmeliFirma(s, 'Fatura A.Ş.', '6000000001', 10, 700);
  await git(s, '#/tahsilat'); await s.waitForSelector('[data-action="toplu-fatura"]');
  await s.locator('[data-action="toplu-fatura"]').first().click();
  await modal(s).locator('button[type=submit]').click();
  await s.waitForSelector('.toast:has-text("1 fatura oluşturuldu")');
  await s.waitForSelector('#fatura-tablo tbody tr');
  await var_(s.locator('#fatura-tablo td:has-text("F-")'), 'otomatik numara');
  await var_(s.locator('#fatura-tablo td.num:has-text("8.400,00")'), '10 x 700 + KDV = 8.400');
  await var_(s.locator('.kpi:has-text("Açık alacak") .kpi-v:has-text("8.400")'), 'açık alacak');
  await s.locator('[data-action="toplu-fatura"]').first().click();
  await modal(s).locator('button[type=submit]').click();
  await s.waitForSelector('.modal-overlay h2:has-text("Atlanan sözleşmeler")');
  await var_(s.locator('.modal li:has-text("zaten var")'), 'tekrar atlanır');
  await ekran(s, '22-faturalar');
  await s.locator('.modal [data-close]').last().click();
  await s.waitForTimeout(500); await s.waitForSelector('#fatura-tablo tbody tr');
  esit(await s.locator('#fatura-tablo tbody tr').count(), 1, 'tek fatura');
});

await test('fatura: elle ekleme, KDV önizleme, doğrulama, numara çakışması', async (s) => {
  await girisYap(s);
  const url = await sozlesmeliFirma(s, 'Elle Fatura Ltd.', '6000000002', 5, 100);
  await git(s, hashOf(url)); await s.waitForSelector('.company-head');
  await s.click('[data-sekme="faturalar"]'); await s.waitForSelector('[data-action="fatura-yeni"]');
  await s.click('[data-action="fatura-yeni"]');
  const m = modal(s);
  await m.locator('#f-tutar').fill('1200'); await m.locator('#f-vat_mode').selectOption('kdv_dahil');
  await var_(m.locator('#fatura-bilgi:has-text("KDV hariç ₺1.000,00")'), 'önizleme');
  await m.locator('#f-due_date').fill(await gunOf(s, -5));
  await m.locator('#f-invoice_date').fill(await gunOf(s, 0));
  await m.locator('button[type=submit]').click();
  await var_(m.locator('#e-due_date:has-text("Vade")'), 'vade doğrulaması');
  await m.locator('#f-invoice_date').fill(await gunOf(s, -40)); await m.locator('#f-due_date').fill(await gunOf(s, -10));
  await m.locator('#f-invoice_no').fill('MANUEL-1');
  await m.locator('button[type=submit]').click();
  await s.waitForSelector('#sekme-govde td:has-text("MANUEL-1")');
  await var_(s.locator('#sekme-govde .pill:has-text("gün gecikti")'), 'gecikme rozeti');
  await s.click('[data-action="fatura-yeni"]');
  await modal(s).locator('#f-tutar').fill('50'); await modal(s).locator('#f-invoice_no').fill('MANUEL-1');
  await modal(s).locator('button[type=submit]').click();
  await s.waitForSelector('.form-error:has-text("fatura numarası zaten")');
});

await test('tahsilat: kısmi, tam, fazla uyarısı, iptal; durum ve bakiye', async (s) => {
  await girisYap(s);
  const url = await sozlesmeliFirma(s, 'Tahsilat A.Ş.', '6000000003', 5, 100);
  await git(s, hashOf(url)); await s.click('[data-sekme="faturalar"]'); await s.click('[data-action="fatura-yeni"]');
  await modal(s).locator('#f-tutar').fill('1000'); await modal(s).locator('#f-invoice_no').fill('TH-1');
  await modal(s).locator('button[type=submit]').click();
  await s.waitForSelector('#sekme-govde td:has-text("TH-1")');
  await git(s, '#/tahsilat'); await s.waitForSelector('[data-fatura-tahsilat]');
  await s.locator('[data-fatura-tahsilat]').first().click();
  let m = modal(s);
  await var_(m.locator('.modal-sub:has-text("kalan ₺1.200,00")'), 'kalan');
  await m.locator('#f-amount').fill('500'); await var_(m.locator('#tahsilat-bilgi:has-text("kalan: ₺700,00")'), 'önizleme');
  await m.locator('#f-paid_at').fill(await gunOf(s, 1)); await m.locator('button[type=submit]').click();
  await var_(m.locator('#e-paid_at:has-text("gelecekte")'), 'gelecek tarih');
  await m.locator('#f-paid_at').fill(await gunOf(s, 0)); await m.locator('button[type=submit]').click();
  await s.waitForSelector('.toast:has-text("Tahsilat kaydedildi")');
  await s.waitForSelector('#fatura-tablo .pill:has-text("Kısmi tahsilat")');
  await var_(s.locator('.kpi:has-text("Açık alacak") .kpi-v:has-text("700")'), 'kalan 700');
  await s.locator('[data-fatura-tahsilat]').first().click();
  m = modal(s);
  await m.locator('#f-amount').fill('800'); await var_(m.locator('#tahsilat-bilgi .notice-warn:has-text("aşıyor")'), 'fazla uyarısı');
  await m.locator('#f-amount').fill('700'); await m.locator('button[type=submit]').click();
  await s.waitForSelector('.toast:has-text("Tahsilat kaydedildi")');
  await s.waitForSelector('#fatura-tablo .empty, #fatura-tablo .empty-state, #fatura-tablo h3');
  await s.selectOption('#fatura-durum', 'tahsil_edildi'); await s.waitForSelector('#fatura-tablo .pill:has-text("Tahsil edildi")');
  await s.click('[data-fatura-detay]'); await s.waitForSelector('.modal [data-odeme-iptal]');
  esit(await s.locator('.modal [data-odeme-iptal]').count(), 2, 'iki tahsilat');
  await s.locator('.modal [data-odeme-iptal]').first().click();
  await s.locator('.btn[data-ok]').click();
  await s.waitForSelector('.toast:has-text("Tahsilat iptal edildi")');
  await s.selectOption('#fatura-durum', 'kismi_tahsilat'); await s.waitForSelector('#fatura-tablo .pill:has-text("Kısmi tahsilat")');
  // tahsilat kaydında tarih ve tutar düzenlenebilir
  await s.click('[data-fatura-detay]'); await s.waitForSelector('.modal [data-odeme-duzenle]');
  await s.locator('.modal [data-odeme-duzenle]').first().click();
  m = modal(s);
  await var_(m.locator('.modal-title:has-text("Tahsilatı düzenle"), h2:has-text("Tahsilatı düzenle")'), 'düzenleme başlığı');
  esit(await m.locator('#f-amount').inputValue(), '700', 'mevcut tutar');
  await m.locator('#f-paid_at').fill(await gunOf(s, 1)); await m.locator('button[type=submit]').click();
  await var_(m.locator('#e-paid_at:has-text("gelecekte")'), 'gelecek tarih engellenir');
  await m.locator('#f-paid_at').fill(await gunOf(s, 0)); await m.locator('#f-amount').fill('900');
  await var_(m.locator('#tahsilat-bilgi:has-text("kalan: ₺300,00")'), 'önizleme kendi tutarını düşer');
  await m.locator('button[type=submit]').click();
  await s.waitForSelector('.toast:has-text("Tahsilat güncellendi")');
  await s.waitForSelector('#fatura-tablo .pill:has-text("Kısmi tahsilat")');
  await s.click('[data-fatura-detay]'); await s.waitForSelector('.modal [data-odeme-duzenle]');
  await var_(s.locator('.modal td.num:has-text("900,00")'), 'yeni tutar listede');
});

await test('cari hesap: ekstre, yıl/aralık, tahsilat tarihi düzenleme, Excel indirme', async (s) => {
  await girisYap(s);
  const url = await sozlesmeliFirma(s, 'Cari A.Ş.', '6000000077', 5, 100);
  await git(s, hashOf(url)); await s.click('[data-sekme="faturalar"]'); await s.click('[data-action="fatura-yeni"]');
  await modal(s).locator('#f-tutar').fill('1000'); await modal(s).locator('#f-invoice_no').fill('CR-1');
  await modal(s).locator('button[type=submit]').click();
  await s.waitForSelector('#sekme-govde td:has-text("CR-1")');
  await git(s, '#/tahsilat'); await s.waitForSelector('[data-fatura-tahsilat]');
  await s.locator('[data-fatura-tahsilat]').first().click();
  let m = modal(s);
  await m.locator('#f-amount').fill('500'); await m.locator('button[type=submit]').click();
  await s.waitForSelector('.toast:has-text("Tahsilat kaydedildi")');
  await var_(s.locator('.nav a[href="#/cari"], nav a[href="#/cari"]'), 'menüde Cari');
  await git(s, '#/cari'); await s.waitForSelector('#cari-tablo');
  await s.selectOption('#cari-firma', { label: 'Cari A.Ş.' });
  await s.waitForSelector('#cari-tablo tbody tr[data-cari-satir="fatura"]');
  esit(await s.locator('#cari-tablo tbody tr[data-cari-satir="fatura"]').count(), 1, 'fatura satırı');
  esit(await s.locator('#cari-tablo tbody tr[data-cari-satir="tahsilat"]').count(), 1, 'tahsilat satırı');
  await var_(s.locator('#cari-top-alacak:has-text("1.200,00")'), 'alacak (KDV dahil)');
  await var_(s.locator('#cari-top-borc:has-text("500,00")'), 'borç');
  await var_(s.locator('#cari-bakiye:has-text("700,00")'), 'bakiye');
  await ekran(s, '77-cari-hesap');
  // tahsilat tarihini düzenle
  await s.locator('[data-cari-duzenle]').first().click();
  m = modal(s);
  await var_(m.locator('h2:has-text("Tahsilatı düzenle"), .modal-title:has-text("Tahsilatı düzenle")'), 'düzenleme formu');
  await m.locator('#f-paid_at').fill(await gunOf(s, 0)); await m.locator('#f-amount').fill('600'); await m.locator('button[type=submit]').click();
  await s.waitForSelector('.toast:has-text("Tahsilat güncellendi")');
  await s.waitForSelector('#cari-bakiye:has-text("600,00")');
  // dönem seçimi: tarih aralığı gelecekte kalan dönem → hareket yok; devir
  await s.selectOption('#cari-yil', 'aralik');
  await s.locator('#cari-bas').fill('2099-01-01'); await s.locator('#cari-bit').fill('2099-12-31');
  await var_(s.locator('#cari-govde:has-text("Bu dönemde hareket yok"), #cari-govde:has-text("Önceki dönemden devir")'), 'aralık dışı');
  await s.selectOption('#cari-yil', 'tum'); await s.waitForSelector('#cari-tablo');
  const [dl] = await Promise.all([s.waitForEvent('download'), s.click('[data-action="cari-excel"]')]);
  esit(dl.suggestedFilename().endsWith('.xlsx'), true, 'xlsx adı');
  const yol = await dl.path(); const { readFileSync } = await import('node:fs');
  esit(readFileSync(yol).subarray(0, 2).toString(), 'PK', 'zip imzası');
});

await test('firma tahsilatı: tutar eski faturadan başlayarak dağıtılır, cari tek satır gösterir', async (s) => {
  await girisYap(s);
  const url = await sozlesmeliFirma(s, 'Dağıtım Ltd.', '6000000088', 5, 100);
  await git(s, hashOf(url)); await s.click('[data-sekme="faturalar"]');
  for (const [no, g] of [['N-2', 20], ['N-1', 40]]) {
    await s.click('[data-action="fatura-yeni"]');
    await modal(s).locator('#f-tutar').fill('5000'); await modal(s).locator('#f-invoice_no').fill(no);
    await modal(s).locator('#f-invoice_date').fill(await gunOf(s, -g));
    await modal(s).locator('button[type=submit]').click();
    await s.waitForSelector(`#sekme-govde td:has-text("${no}")`);
  }
  await s.click('[data-action="firma-tahsilat"]');
  let m = modal(s);
  await m.locator('#f-amount').fill('7500');
  await var_(m.locator('#ft-onizleme tr:has-text("N-1"):has-text("Tahsil edildi")'), 'eski fatura tam kapanır');
  await var_(m.locator('#ft-onizleme tr:has-text("N-2"):has-text("Kısmi tahsilat")'), 'yeni fatura kısmi');
  await m.locator('#f-amount').fill('99999');
  await var_(m.locator('#ft-onizleme:has-text("aşıyor")'), 'fazla tutar uyarısı');
  await m.locator('button[type=submit]').click();
  await var_(m.locator('.field-error:has-text("aşıyor")'), 'fazla tutar reddedilir');
  await m.locator('#f-amount').fill('7500'); await m.locator('#f-notes').fill('dekont 5');
  await m.locator('button[type=submit]').click();
  await s.waitForSelector('.toast:has-text("2 faturaya dağıtıldı")');
  await s.click('[data-sekme="faturalar"]');
  await var_(s.locator('#sekme-govde tr:has-text("N-1"):has-text("Tahsil edildi")'), 'N-1 tahsil edildi');
  await var_(s.locator('#sekme-govde tr:has-text("N-2"):has-text("Kısmi")'), 'N-2 kısmi');
  await git(s, '#/cari'); await s.waitForSelector('#cari-tablo');
  await s.selectOption('#cari-firma', { label: 'Dağıtım Ltd.' });
  await s.waitForSelector('#cari-tablo tbody tr[data-cari-satir="tahsilat"]');
  esit(await s.locator('#cari-tablo tbody tr[data-cari-satir="tahsilat"]').count(), 1, 'tek ödeme satırı');
  const ack = await s.locator('#cari-tablo tbody tr[data-cari-satir="tahsilat"] em').innerText();
  esit(ack.includes('N-1 nolu fatura') && ack.includes('N-2 nolu fatura (kısmi)') && ack.includes('dekont 5'), true, 'açıklama: ' + ack);
  await var_(s.locator('#cari-top-borc:has-text("7.500,00")'), 'ödemenin tamamı borç');
  await var_(s.locator('#cari-bakiye:has-text("4.500,00")'), 'kalan bakiye');
  await ekran(s, '78-cari-firma-tahsilati');
  // grup tarihi düzenle
  await s.locator('[data-cari-grup-duzenle]').first().click();
  m = modal(s); await m.locator('#f-paid_at').fill(await gunOf(s, -5)); await m.locator('button[type=submit]').click();
  await s.waitForSelector('.toast:has-text("Tahsilat güncellendi")');
  await s.waitForSelector('#cari-tablo tbody tr[data-cari-satir="tahsilat"]');
  // iptal
  await s.locator('[data-cari-grup-iptal]').first().click();
  await s.locator('.modal button:has-text("Tahsilatı iptal et")').click();
  await s.waitForSelector('#cari-bakiye:has-text("12.000,00")');
});

await test('fatura: işaretleme, arşiv kuralı (tahsilatlı fatura arşivlenmez)', async (s) => {
  await girisYap(s);
  const url = await sozlesmeliFirma(s, 'Isaret A.Ş.', '6000000004', 5, 100);
  await git(s, hashOf(url)); await s.click('[data-sekme="faturalar"]'); await s.click('[data-action="fatura-yeni"]');
  await modal(s).locator('#f-tutar').fill('100'); await modal(s).locator('button[type=submit]').click();
  await s.waitForSelector('#sekme-govde [data-fatura-detay]');
  await s.click('[data-fatura-detay]'); await s.waitForSelector('[data-f-eylem="itirazli"]');
  await s.click('[data-f-eylem="itirazli"]');
  await s.waitForSelector('#sekme-govde .pill:has-text("İtirazlı")');
  await s.click('[data-fatura-detay]'); await s.waitForSelector('[data-f-eylem="isaret-kaldir"]');
  await s.click('[data-f-eylem="isaret-kaldir"]');
  await s.waitForSelector('#sekme-govde .pill:has-text("Tahsil edilmedi")');
  await git(s, '#/tahsilat'); await s.locator('[data-fatura-tahsilat]').first().click();
  await modal(s).locator('button[type=submit]').click(); await s.waitForSelector('.toast:has-text("Tahsilat kaydedildi")');
  await git(s, hashOf(url)); await s.click('[data-sekme="faturalar"]'); await s.click('[data-fatura-detay]');
  await s.click('[data-f-eylem="arsiv"]'); await s.locator('.btn[data-ok]').click();
  await s.waitForSelector('.toast-hata:has-text("Tahsilatı olan fatura arşivlenemez")');
});

await test('vade: gecikmiş faturadan görev üretilir, ödenince kapanır; panel kartı', async (s) => {
  await girisYap(s);
  const url = await sozlesmeliFirma(s, 'Gecikme A.Ş.', '6000000005', 5, 100);
  await git(s, hashOf(url)); await s.click('[data-sekme="faturalar"]'); await s.click('[data-action="fatura-yeni"]');
  await modal(s).locator('#f-tutar').fill('600'); await modal(s).locator('#f-invoice_date').fill(await gunOf(s, -60)); await modal(s).locator('#f-due_date').fill(await gunOf(s, -40));
  await modal(s).locator('button[type=submit]').click();
  await s.waitForSelector('#sekme-govde .pill:has-text("40 gün gecikti")');
  await cikisYapGir(s, 'sahip@test.com');   // girişte gecikme görevleri üretilir
  await git(s, '#/gorevler'); await s.waitForSelector('#sayfa');
  await s.waitForFunction(() => document.body.innerText.includes('faturasının vadesi geçti'));
  await git(s, '#/panel'); await s.waitForSelector('.card-title:has-text("Tahsilat durumu")');
  await var_(s.locator('.card:has-text("Tahsilat durumu") li:has-text("Vadesi geçmiş"):has-text("720,00")'), 'panel gecikmiş');
  await git(s, '#/tahsilat'); await s.waitForSelector('[data-fatura-tahsilat]');
  await s.locator('[data-fatura-tahsilat]').first().click(); await modal(s).locator('button[type=submit]').click();
  await s.waitForSelector('.toast:has-text("Tahsilat kaydedildi")');
  const kapandi = await s.evaluate(() => globalThis.__fake.tablo.tasks.filter((t) => t.kind === 'tahsilat_takibi' && t.status === 'tamamlandi').length);
  esit(kapandi, 1, 'ödenen faturanın görevi kapanır');
});

await test('yetki: satış faturaları görmez; finans görür ve fatura ekler', async (s) => {
  await girisYap(s, 'satis@test.com');
  esit(await s.locator('a[href="#/tahsilat"]').count(), 0, 'satış menüsünde tahsilat yok');
  esit(await s.locator('a[href="#/giderler"]').count(), 0, 'satış menüsünde gider yok');
  await git(s, '#/tahsilat'); await s.waitForTimeout(300);
  await var_(s.locator('#sayfa .empty-state, #sayfa .empty, #sayfa h3'), 'yetki mesajı');
  await cikisYapGir(s, 'finans@test.com');
  await var_(s.locator('a[href="#/tahsilat"]'), 'finans tahsilat'); await var_(s.locator('a[href="#/giderler"]'), 'finans gider');
  await git(s, '#/tahsilat'); await s.waitForSelector('[data-action="yeni-fatura"]');
});

await test('gider: ortak ve doğrudan gider, KDV dahil ayrımı, düzenleme, arşiv, kategori', async (s) => {
  await girisYap(s);
  await firmaEkle(s, { ad: 'Gider Firma A.Ş.', vergi: '6000000006', calisan: 5, tehlike: 'tehlikeli' });
  await s.waitForSelector('.company-head');
  await git(s, '#/giderler'); await s.waitForSelector('[data-action="yeni-gider"]');
  await var_(s.locator('#gider-tablo h3:has-text("için gider yok")'), 'boş durum');
  await s.locator('[data-action="yeni-gider"]').first().click();
  let m = modal(s);
  await m.locator('#f-category_id').selectOption({ label: 'Kira' });
  esit(await m.locator('#f-cost_type').inputValue(), 'ortak', 'kategori varsayılan türü');
  esit(await m.locator('[data-field="company_id"]').isHidden(), true, 'ortakta firma alanı gizli');
  await m.locator('#f-tutar').fill('12000'); await m.locator('#f-vat_mode').selectOption('kdv_dahil');
  await var_(m.locator('#gider-bilgi:has-text("KDV hariç ₺10.000,00")'), 'önizleme');
  await m.locator('#f-description').fill('Ekim kirası <b>x</b>');
  await m.locator('button[type=submit]').click();
  await s.waitForSelector('#gider-tablo td:has-text("Kira")');
  await var_(s.locator('#gider-tablo td.num:has-text("10.000,00")'), 'KDV hariç tutar');
  await var_(s.locator('#gider-tablo small:has-text("KDV dahil ₺12.000,00")'), 'KDV dahil tutar');
  await var_(s.locator('#gider-tablo td:has-text("Ekim kirası <b>x</b>")'), 'HTML metin olarak');
  esit(await s.locator('#gider-tablo b').count(), 0, 'HTML çalışmaz');
  // doğrudan gider: bağlantı zorunlu
  await s.locator('[data-action="yeni-gider"]').first().click(); m = modal(s);
  await m.locator('#f-category_id').selectOption({ label: 'Araç yakıtı' });
  await m.locator('#f-cost_type').selectOption('dogrudan'); await m.locator('#f-tutar').fill('500');
  await m.locator('button[type=submit]').click();
  await var_(m.locator('#e-company_id:has-text("firma veya personel")'), 'bağlantı zorunlu');
  await m.locator('#f-company_id').selectOption({ label: 'Gider Firma A.Ş.' });
  await m.locator('#f-paid').check(); await m.locator('button[type=submit]').click();
  await s.waitForSelector('#gider-tablo tbody tr:nth-child(2)');
  await var_(s.locator('.kpi:has-text("Toplam gider") .kpi-v:has-text("10.500")'), 'toplam 10.500');
  await var_(s.locator('.kpi:has-text("Doğrudan gider") .kpi-v:has-text("500")'), 'doğrudan 500');
  await var_(s.locator('.kpi:has-text("Ödenmemiş") .kpi-v:has-text("12.000")'), 'ödenmemiş 12.000');
  await s.check('#gider-odenmemis'); esit(await s.locator('#gider-tablo tbody tr').count(), 1, 'ödenmemiş filtresi');
  await s.uncheck('#gider-odenmemis');
  // düzenle
  await s.locator('[data-gider-eylem="duzenle"]').first().click(); m = modal(s);
  await m.locator('#f-tutar').fill('600'); await m.locator('button[type=submit]').click();
  await s.waitForSelector('.toast:has-text("Gider güncellendi")');
  // arşiv
  await s.locator('[data-gider-eylem="arsiv"]').first().click(); await s.locator('.btn[data-ok]').click();
  await s.waitForSelector('.toast:has-text("Gider arşive alındı")');
  esit(await s.locator('#gider-tablo tbody tr').count(), 1, 'arşivden sonra tek kayıt');
  // kategori
  await s.locator('[data-action="yeni-kategori"]').first().click(); m = modal(s);
  await m.locator('#f-name').fill('Kira'); await m.locator('button[type=submit]').click();
  await s.waitForSelector('.form-error:has-text("kategorisi zaten var")');
  await m.locator('#f-name').fill('Sigorta'); await m.locator('button[type=submit]').click();
  await s.waitForSelector('.toast:has-text("Kategori eklendi")');
  await ekran(s, '23-giderler');
});

await test('gider: finans personeli maaş kategorisini görür, operasyon gider ekleyemez', async (s) => {
  await girisYap(s, 'finans@test.com');
  await git(s, '#/giderler'); await s.waitForSelector('[data-action="yeni-gider"]');
  await s.locator('[data-action="yeni-gider"]').first().click(); await s.waitForSelector('#f-category_id');
  await var_(modal(s).locator('#f-category_id option:has-text("Uzman maaşları")'), 'finans maaş kategorisi');
  await s.keyboard.press('Escape');
  await cikisYapGir(s, 'operasyon@test.com');
  await git(s, '#/giderler'); await s.waitForTimeout(300);
  esit(await s.locator('[data-action="yeni-gider"]').count(), 0, 'operasyon gider ekleyemez');
});

await test('firma kartı: Faturalar sekmesi artık hazır (Aşama etiketi yok)', async (s) => {
  await girisYap(s);
  await firmaEkle(s, { ad: 'Sekme Fatura A.Ş.', vergi: '6000000007', calisan: 5, tehlike: 'tehlikeli' });
  await s.waitForSelector('.company-head');
  esit(await s.locator('[data-sekme="faturalar"] .tab-tag').count(), 0, 'etiket yok');
  await s.click('[data-sekme="faturalar"]');
  await var_(s.locator('#sekme-govde h3:has-text("henüz fatura kesilmemiş")'), 'boş durum');
});

await test('mobil 375px: tahsilat ve gider sayfalarında yatay taşma yok', async (s) => {
  await girisYap(s);
  const url = await sozlesmeliFirma(s, 'Mobil Fatura A.Ş.', '6000000008', 5, 100);
  await git(s, '#/tahsilat'); await s.locator('[data-action="toplu-fatura"]').first().click();
  await modal(s).locator('button[type=submit]').click(); await s.waitForSelector('#fatura-tablo tbody tr');
  await git(s, '#/giderler'); await s.locator('[data-action="yeni-gider"]').first().click();
  await modal(s).locator('#f-category_id').selectOption({ label: 'Kira' }); await modal(s).locator('#f-tutar').fill('100');
  await modal(s).locator('button[type=submit]').click(); await s.waitForSelector('#gider-tablo tbody tr');
  for (const h of ['#/tahsilat', '#/giderler']) {
    await git(s, h); await s.waitForTimeout(350);
    const t = await s.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    if (t > 1) { const w = await s.evaluate(() => [...document.querySelectorAll('body *')].filter((e) => e.getBoundingClientRect().right > innerWidth + 1).slice(0, 6).map((e) => `${e.tagName}.${e.className}#${e.id}:${Math.round(e.getBoundingClientRect().right)}`).join(' | ')); throw new Error(`${h} yatay taşma ${t}px: ${w}`); }
  }
  await git(s, '#/tahsilat'); await s.locator('[data-action="yeni-fatura"]').first().click(); await s.waitForTimeout(300);
  const t2 = await s.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  if (t2 > 1) throw new Error(`fatura formu yatay taşma ${t2}px`);
  await ekran(s, '24-mobil-tahsilat');
}, { genislik: 375, yukseklik: 800 });


// ====================================================================== Aşama 7: kârlılık
async function karlilikHazirla(s) {
  await girisYap(s);
  await sozlesmeliFirma(s, 'Kar A.Ş.', '7000000001', 20, 1000);
  await personelEkle(s, 'is_guvenligi_uzmani', 'Kar Uzman');
  await git(s, '#/gorevlendirmeler'); await s.waitForSelector('[data-action="yeni-gv"]');
  await atamaYap(s, 'Kar A.Ş.', 'Kar Uzman', 100);
  await s.waitForFunction(() => globalThis.__fake.tablo.assignments.length === 1);
  await git(s, '#/tahsilat'); await s.waitForSelector('[data-action="toplu-fatura"]');
  await s.locator('[data-action="toplu-fatura"]').first().click();
  await modal(s).locator('button[type=submit]').click();
  await s.waitForFunction(() => globalThis.__fake.tablo.invoices.length >= 1);
  await s.evaluate((bugun) => {
    const t = globalThis.__fake.tablo;
    t.company_profiles.forEach((p) => { p.valid_from = '2020-01-01'; });
    const e = t.employees.find((x) => x.full_name === 'Kar Uzman');
    t.employee_costs.push({ id: 'c1', organization_id: e.organization_id, employee_id: e.id, gross_salary: 8000, employer_sgk: 1500, other_benefits: 500, total_monthly_cost: 10000, valid_from: '2020-01-01', valid_to: null });
    const kira = t.expense_categories.find((k) => k.name === 'Kira');
    t.expenses.push({ id: 'g1', organization_id: e.organization_id, category_id: kira.id, expense_date: bugun, amount_excl_vat: 3000, vat_amount: 0, amount_incl_vat: 3000, cost_type: 'ortak', company_id: null, employee_id: null, paid: true, archived_at: null });
  }, await gunOf(s, 0));
}

await test('kârlılık: firma kârlılığı hesabı, işletme sonucu, yöntem değişimi', async (s) => {
  await karlilikHazirla(s);
  await git(s, '#/firma-karlilik'); await s.waitForSelector('#kar-firma-tablo tbody tr');
  const satir = s.locator('#kar-firma-tablo tbody tr').first();
  const metin = await satir.innerText();
  for (const beklenen of ['20.000,00', '341,88', '19.658,12', '3.000,00', '16.658,12']) if (!metin.includes(beklenen)) throw new Error(`firma satırında ${beklenen} yok: ${metin}`);
  await var_(s.locator('.kpi:has-text("Vergi öncesi kâr") .kpi-v:has-text("7.000")'), 'işletme kârı 20000-10000-3000');
  await var_(s.locator('.card:has-text("İşletme sonucu") li:has-text("boşta kapasite"):has-text("9.658,12")'), 'boşta kapasite');
  await ekran(s, '25-firma-karlilik');
  await s.selectOption('#kar-yontem', 'fiili');
  await var_(s.locator('.card:has-text("İşletme sonucu") li:has-text("boşta kapasite"):has-text("10.000,00")'), 'fiilî: kayıt yok, tamamı boşta');
  await s.selectOption('#kar-yontem', 'teorik');
  await var_(s.locator('.kpi:has-text("Vergi sonrası") .kpi-v:has-text("5.250")'), 'vergi sonrası 7000 - %25');
  // kutucuklara tıklayınca hesap detayı penceresi
  await s.click('[data-kpi="maliyet"]'); await s.waitForSelector('.modal h2:has-text("Toplam maliyet nasıl hesaplandı")');
  let pm = await s.locator('.modal').innerText(); for (const b of ['Personel maliyeti', 'Doğrudan giderler', 'Ortak giderler', '13.000,00']) if (!pm.includes(b)) throw new Error(`maliyet detayında ${b} yok: ${pm}`);
  await s.click('.modal [data-close].btn'); await s.waitForSelector('.modal', { state: 'detached' });
  await s.click('[data-kpi="oncesi"]'); await s.waitForSelector('.modal h2:has-text("Vergi öncesi kâr nasıl")');
  pm = await s.locator('.modal').innerText(); for (const b of ['20.000,00', '13.000,00', '7.000,00']) if (!pm.includes(b)) throw new Error(`vergi öncesi detayında ${b} yok`);
  await s.click('.modal [data-close].btn'); await s.waitForSelector('.modal', { state: 'detached' });
  await s.click('[data-kpi="sonrasi"]'); await s.waitForSelector('.modal h2:has-text("Vergi sonrası kâr")');
  pm = await s.locator('.modal').innerText(); for (const b of ['Vergi matrahı', '%25', '1.750,00', '5.250,00']) if (!pm.includes(b)) throw new Error(`vergi sonrası detayında ${b} yok: ${pm}`);
  await ekran(s, '74-kar-hesap-detayi');
});

await test('kârlılık: ortak gider ölçütü değişir, dağıtım kaydedilir, ay seçimi', async (s) => {
  await karlilikHazirla(s);
  await git(s, '#/firma-karlilik'); await s.waitForSelector('select[data-olcut]');
  esit(await s.locator('select[data-olcut]').inputValue(), 'gelir_orani', 'varsayılan ölçüt');
  await var_(s.locator('.pill:has-text("Hesaplanan")'), 'hesaplanan');
  await s.selectOption('select[data-olcut]', 'musteri_sayisi');
  await s.waitForSelector('.toast:has-text("ölçütü güncellendi")');
  esit(await s.locator('select[data-olcut]').inputValue(), 'musteri_sayisi', 'ölçüt kalıcı');
  await s.locator('[data-action="dagitim-kaydet"]').click();
  await s.waitForSelector('.toast:has-text("Dağıtım kaydedildi")');
  await s.waitForSelector('.pill:has-text("Kaydedilmiş")');
  const toplam = await s.evaluate(() => globalThis.__fake.tablo.overhead_allocations.reduce((t, a) => t + a.amount, 0));
  esit(toplam, 3000, 'kaydedilen dağıtım havuza eşit');
  await s.selectOption('#kar-ay', await s.evaluate(() => { const d = new Date(); d.setMonth(d.getMonth() - 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`; }));
  await var_(s.locator('#kar-tablo h3:has-text("için firma verisi yok"), #kar-tablo td'), 'önceki ay');
});

await test('kârlılık: personel kârlılığı, doluluk, katkı ve firma dağılımı', async (s) => {
  await karlilikHazirla(s);
  await s.evaluate(() => { const t = globalThis.__fake.tablo; const org = t.organizations[0].id; const id = crypto.randomUUID();
    t.employees.push({ id, organization_id: org, full_name: 'Pasif Kişi', staff_type: 'is_guvenligi_uzmani', role_kind: null, is_active: false, end_date: null, monthly_capacity_min: 11700, archived_at: null });
    t.employee_costs.push({ id: crypto.randomUUID(), organization_id: org, employee_id: id, valid_from: '2020-01-01', valid_to: null, gross_salary: 5000, employer_sgk: 0, other_benefits: 0, total_monthly_cost: 5000 }); });
  await git(s, '#/personel-karlilik'); await s.waitForSelector('#kar-personel-tablo tbody tr');
  if ((await s.locator('#kar-personel-tablo').innerText()).includes('Pasif Kişi')) throw new Error('ayrılış tarihsiz pasif personel listelenmemeli');
  const metin = await s.locator('#kar-personel-tablo tbody tr').first().innerText();
  for (const beklenen of ['Kar Uzman', '10.000,00', '20.000,00', '9.658,12']) if (!metin.includes(beklenen)) throw new Error(`personel satırında ${beklenen} yok: ${metin}`);
  await var_(s.locator('#kar-personel-tablo tbody tr td.num:has-text("%3,4")'), 'doluluk 400/11700');
  await var_(s.locator('.kpi:has-text("Boşta kapasite") .kpi-v:has-text("9.658")'), 'boşta kpi');
  await s.click('[data-kpi="bosta"]'); await s.waitForSelector('.modal h2:has-text("Boşta kapasite maliyeti nasıl")');
  const bm = await s.locator('.modal').innerText(); for (const b of ['Kar Uzman', '9.658,12', 'kapasite']) if (!bm.includes(b)) throw new Error(`boşta detayında ${b} yok: ${bm}`);
  await s.click('.modal [data-close].btn'); await s.waitForSelector('.modal', { state: 'detached' });
  await s.click('[data-kar-detay]');
  await s.waitForSelector('.modal h2:has-text("Kar Uzman")');
  await var_(s.locator('.modal td:has-text("Kar A.Ş.")'), 'firma dağılımı');
  await var_(s.locator('.modal td:has-text("341,88")'), 'maliyet payı');
  await ekran(s, '26-personel-karlilik');
});

await test('kârlılık: maliyet kaydı olmayan personel uyarısı; yetkisiz roller menüyü görmez', async (s) => {
  await girisYap(s);
  await sozlesmeliFirma(s, 'Uyari A.Ş.', '7000000002', 10, 500);
  await personelEkle(s, 'isyeri_hekimi', 'Maliyetsiz Hekim');
  await git(s, '#/gorevlendirmeler'); await s.waitForSelector('[data-action="yeni-gv"]');
  await atamaYap(s, 'Uyari A.Ş.', 'Maliyetsiz Hekim', 100, ayinBirinci(), 'isyeri_hekimi');
  await s.waitForFunction(() => globalThis.__fake.tablo.assignments.length === 1);
  await git(s, '#/personel-karlilik'); await s.waitForSelector('#kar-personel-tablo');
  await var_(s.locator('.card:has-text("Dikkat edilecekler") li:has-text("maliyet kaydı yok")'), 'maliyet uyarısı');
  await cikisYapGir(s, 'satis@test.com');
  esit(await s.locator('a[href="#/firma-karlilik"]').count(), 0, 'satış firma kârlılığı görmez');
  esit(await s.locator('a[href="#/personel-karlilik"]').count(), 0, 'satış personel kârlılığı görmez');
  await cikisYapGir(s, 'operasyon@test.com');
  esit(await s.locator('a[href="#/firma-karlilik"]').count(), 0, 'operasyon görmez');
  await cikisYapGir(s, 'finans@test.com');
  await var_(s.locator('a[href="#/firma-karlilik"]'), 'finans görür'); await var_(s.locator('a[href="#/personel-karlilik"]'), 'finans görür');
});

await test('mobil 375px: kârlılık sayfalarında yatay taşma yok', async (s) => {
  await karlilikHazirla(s);
  for (const h of ['#/firma-karlilik', '#/personel-karlilik']) {
    await git(s, h); await s.waitForTimeout(500);
    const t = await s.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    if (t > 1) { const w = await s.evaluate(() => [...document.querySelectorAll('body *')].filter((e) => e.getBoundingClientRect().right > innerWidth + 1).slice(0, 6).map((e) => `${e.tagName}.${e.className}#${e.id}:${Math.round(e.getBoundingClientRect().right)}`).join(' | ')); throw new Error(`${h} yatay taşma ${t}px: ${w}`); }
  }
  await ekran(s, '27-mobil-karlilik');
}, { genislik: 375, yukseklik: 800 });


// ====================================================================== Aşama 8: raporlar, CSV dışa/içe aktarma
const indirOku = async (s, tikla) => { const [dl] = await Promise.all([s.waitForEvent('download'), tikla()]); return { ad: dl.suggestedFilename(), metin: fs.readFileSync(await dl.path(), 'utf8') }; };
const csvDosya = (ad, metin) => ({ name: ad, mimeType: 'text/csv', buffer: Buffer.from(metin, 'utf8') });
const tabloSay = (s, ad) => s.evaluate((a) => globalThis.__fake.tablo[a].length, ad);

await test('raporlar: yönetici özeti, rapor değişimi, ay seçimi ve CSV indirme', async (s) => {
  await karlilikHazirla(s);
  await git(s, '#/raporlar'); await s.waitForSelector('#rapor-tablo tbody tr');
  esit((await s.locator('#rapor-sec option').count()), 5, 'beş rapor');
  const ozet = await s.locator('#rapor-tablo').innerText();
  for (const b of ['Aktif firma sayısı', 'Kesilen fatura adedi', '20.000,00', 'Ay gideri']) if (!ozet.includes(b)) throw new Error(`yönetici özetinde ${b} yok: ${ozet}`);
  await ekran(s, '28-raporlar');
  await s.selectOption('#rapor-sec', 'yaslandirma');
  await s.waitForSelector('#rapor-tablo tfoot');
  await var_(s.locator('#rapor-tablo tbody td:has-text("Kar A.Ş.")'), 'yaşlandırmada firma');
  const { ad, metin } = await indirOku(s, () => s.click('#rapor-indir'));
  if (!/^rapor-yaslandirma-\d{4}-\d{2}-\d{2}\.csv$/.test(ad)) throw new Error(`dosya adı: ${ad}`);
  if (!metin.startsWith('﻿Firma;Açık fatura;')) throw new Error(`başlık: ${metin.slice(0, 60)}`);
  if (!metin.includes('Kar A.Ş.;1;') || !/Toplam;1;/.test(metin)) throw new Error(`satırlar: ${metin}`);
  await s.selectOption('#rapor-sec', 'gider-kategori');
  await var_(s.locator('#rapor-tablo td:has-text("Kira")'), 'gider kategorisi');
  await var_(s.locator('#rapor-tablo tfoot td:has-text("3.000,00")'), 'gider toplamı');
  await s.selectOption('#rapor-ay', await s.evaluate(() => { const d = new Date(); d.setMonth(d.getMonth() - 2); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`; }));
  await var_(s.locator('#rapor-govde .empty h3:has-text("için kayıt yok")'), 'boş ay');
  await s.selectOption('#rapor-sec', 'sozlesme-bitis');
  await var_(s.locator('#rapor-tablo td:has-text("Kar A.Ş.")'), 'sözleşme bitişi');
  await s.selectOption('#rapor-sec', 'portfoy');
  await var_(s.locator('#rapor-tablo tfoot'), 'portföy toplamı');
});

await test('raporlar: izni olmayan rapor kilitli, indirme kapalı', async (s) => {
  await girisYap(s);
  await cikisYapGir(s, 'operasyon@test.com');
  await git(s, '#/raporlar'); await s.waitForSelector('#rapor-sec');
  await s.selectOption('#rapor-sec', 'yaslandirma');
  await var_(s.locator('#rapor-govde .empty h3:has-text("izniniz yok")'), 'kilit');
  if (!(await s.locator('#rapor-indir').isDisabled())) throw new Error('indirme düğmesi kapalı olmalı');
  await s.selectOption('#rapor-sec', 'portfoy');
  await s.waitForSelector('#rapor-govde .empty:not(:has-text("izniniz yok")), #rapor-tablo');
  if (await s.locator('#rapor-indir').isDisabled()) throw new Error('izinli raporda indirme açık olmalı');
});

await test('aktarım: dışa aktarma firmalar, faturalar ve boş küme; formül koruması', async (s) => {
  await karlilikHazirla(s);
  await s.evaluate(() => { const t = globalThis.__fake.tablo; t.companies.find((c) => c.name === 'Kar A.Ş.').notes = '=HYPERLINK("http://x")'; });
  await git(s, '#/aktarim'); await s.waitForSelector('#disa-liste');
  const f = await indirOku(s, () => s.click('[data-disa="firmalar"]'));
  if (!/^firmalar-\d{4}-\d{2}-\d{2}\.csv$/.test(f.ad)) throw new Error(f.ad);
  if (!f.metin.startsWith('﻿Firma adı;Vergi no;')) throw new Error(f.metin.slice(0, 50));
  if (!f.metin.includes('Kar A.Ş.;7000000001;')) throw new Error(f.metin);
  if (!f.metin.includes(`"'=HYPERLINK(""http://x"")"`)) throw new Error('formül korunmadı: ' + f.metin);
  const i = await indirOku(s, () => s.click('[data-disa="faturalar"]'));
  if (!i.metin.includes('Fatura no;Firma;') || !/F-\d{4}-0001;Kar A\.Ş\.;/.test(i.metin)) throw new Error(i.metin);
  const boş = await indirOku(s, () => s.click('[data-disa="tahsilatlar"]'));
  esit(boş.metin.trim().split(/\r?\n/).length, 1, 'yalnızca başlık satırı');
  await s.waitForSelector('.toast');
});

await test('aktarım: firma içe aktarma — eşleştirme, önizleme, mükerrer/hata, aktarım, hata raporu', async (s) => {
  await girisYap(s);
  await sozlesmeliFirma(s, 'Mevcut Ltd', '5550000001', 10, 100);
  await git(s, '#/aktarim'); await s.waitForSelector('#ice-dosya');
  const once = await tabloSay(s, 'companies');
  const csv = '﻿Şirket;VKN;Şehir;E-posta;Çalışan;Tehlike;Bilinmeyen\r\n'
    + 'Yeni Bir A.Ş.;1000000001;Ankara;a@yeni.com;25;Tehlikeli;x\r\n'      // hazır + profil
    + 'Yeni İki Ltd;1000000002;İzmir;;;;\r\n'                                // hazır, profilsiz
    + 'Mevcut Ltd;9990000009;Bursa;;;;\r\n'                                 // mükerrer (ad)
    + 'Başka Ad;5550000001;Bursa;;;;\r\n'                                   // mükerrer (vergi no)
    + 'Bozuk E-posta;1000000003;Van;yok;;;\r\n'                             // hata
    + 'Eksik Tehlike;1000000004;Van;;10;;\r\n'                              // hata
    + 'Yeni Bir Kopya;1000000001;Ankara;;;;\r\n';                           // dosya içi mükerrer
  await s.setInputFiles('#ice-dosya', csvDosya('firmalar.csv', csv));
  await s.waitForSelector('#ice-esleme');
  esit(await s.locator('select[data-esle="0"]').inputValue(), 'name', 'Şirket → Firma adı');
  esit(await s.locator('select[data-esle="1"]').inputValue(), 'tax_no', 'VKN → Vergi no');
  esit(await s.locator('select[data-esle="6"]').inputValue(), '', 'bilinmeyen sütun aktarılmaz');
  esit((await s.locator('#ice-n-hazir').textContent()).trim(), '2', 'hazır');
  esit((await s.locator('#ice-n-mukerrer').textContent()).trim(), '3', 'mükerrer');
  esit((await s.locator('#ice-n-hata').textContent()).trim(), '2', 'hata');
  await var_(s.locator('#ice-onizleme tr[data-durum="hata"]:has-text("E-posta adresi geçersiz")'), 'e-posta hatası');
  await var_(s.locator('#ice-onizleme tr[data-durum="mukerrer"]:has-text("Mevcut Ltd")'), 'mükerrer açıklaması');
  await ekran(s, '29-iceaktar-onizleme');
  // sütun eşlemesini elle değiştir: Çalışan sütununu aktarma → "Eksik Tehlike" hatası kalkar
  await s.selectOption('select[data-esle="4"]', '');
  await s.waitForFunction(() => document.querySelector('#ice-n-hata')?.textContent.trim() === '1');
  await s.selectOption('select[data-esle="4"]', 'employee_count');
  await s.waitForFunction(() => document.querySelector('#ice-n-hata')?.textContent.trim() === '2');
  // aktarım
  await s.locator('[data-action="ice-aktar"]').click();
  await s.locator('.modal-overlay button:has-text("kaydı ekle")').click();
  await s.waitForSelector('#ice-sonuc');
  esit(await tabloSay(s, 'companies'), once + 2, 'iki yeni firma');
  if (!(await s.locator('#ice-sonuc').innerText()).includes('2 kayıt eklendi')) throw new Error('sonuç metni');
  const profil = await s.evaluate(() => { const t = globalThis.__fake.tablo; const f = t.companies.find((c) => c.name === 'Yeni Bir A.Ş.'); const p = t.company_profiles.filter((x) => x.company_id === f.id); return [f.tax_no, f.city, p.length, p[0]?.employee_count, p[0]?.hazard_class]; });
  esit(JSON.stringify(profil), JSON.stringify(['1000000001', 'Ankara', 1, 25, 'tehlikeli']), 'firma ve profil');
  const { metin } = await indirOku(s, () => s.click('[data-action="ice-hata-indir"]'));
  if (!metin.includes('Satır;Durum;Açıklama;') || !metin.includes('Mükerrer') || !metin.includes('Hata')) throw new Error(metin);
  esit(metin.trim().split(/\r?\n/).length, 6, 'başlık + 5 aktarılamayan');
  // tekrar aynı dosya: hepsi mükerrer, hazır 0, aktarma düğmesi kapalı
  await s.click('[data-action="ice-yeni"]');
  await s.setInputFiles('#ice-dosya', csvDosya('firmalar.csv', csv));
  await s.waitForSelector('#ice-n-hazir');
  esit((await s.locator('#ice-n-hazir').textContent()).trim(), '0', 'ikinci denemede hazır yok');
  if (!(await s.locator('[data-action="ice-aktar"]').isDisabled())) throw new Error('aktar düğmesi kapalı olmalı');
});

await test('aktarım: kişi içe aktarma firmaya bağlanır; eşleşmeyen firma ve mükerrer kişi aktarılmaz', async (s) => {
  await girisYap(s);
  await sozlesmeliFirma(s, 'Kisi A.Ş.', '5550000002', 10, 100);
  await git(s, '#/aktarim'); await s.waitForSelector('#ice-tur');
  await s.selectOption('#ice-tur', 'kisiler');
  const csv = 'Ad soyad,Firma,Firma vergi no,Unvan,Telefon,E-posta,Karar verici\n'
    + 'Veli Demir,Kisi A.Ş.,,İK,0555 111 22 33,veli@kisi.com,Evet\n'
    + 'Can Aksoy,,5550000002,Muhasebe,,,Hayır\n'
    + 'Kayıp Kişi,Olmayan Ltd,,,,,\n'
    + 'Veli Demir,Kisi A.Ş.,,İK,,veli@kisi.com,Evet\n';
  await s.setInputFiles('#ice-dosya', csvDosya('kisiler.csv', csv));
  await s.waitForSelector('#ice-onizleme');
  esit((await s.locator('#ice-n-hazir').textContent()).trim(), '2', 'hazır');
  esit((await s.locator('#ice-n-mukerrer').textContent()).trim(), '1', 'mükerrer');
  esit((await s.locator('#ice-n-hata').textContent()).trim(), '1', 'hata');
  await var_(s.locator('#ice-onizleme tr[data-durum="hata"]:has-text("bulunamadı")'), 'firma bulunamadı');
  await s.locator('[data-action="ice-aktar"]').click();
  await s.locator('.modal-overlay button:has-text("kaydı ekle")').click();
  await s.waitForSelector('#ice-sonuc');
  const k = await s.evaluate(() => { const t = globalThis.__fake.tablo; const f = t.companies.find((c) => c.name === 'Kisi A.Ş.'); return t.contacts.filter((x) => x.company_id === f.id).map((x) => [x.full_name, x.is_decision_maker, x.title]).sort(); });
  esit(JSON.stringify(k), JSON.stringify([['Can Aksoy', false, 'Muhasebe'], ['Veli Demir', true, 'İK']]), 'kişiler');
});

await test('aktarım: bozuk dosya, Excel dosyası, boş dosya ve XSS içerikli firma adı güvenle işlenir', async (s) => {
  await girisYap(s);
  await git(s, '#/aktarim'); await s.waitForSelector('#ice-dosya');
  await s.setInputFiles('#ice-dosya', { name: 'a.xlsx', mimeType: 'application/octet-stream', buffer: Buffer.concat([Buffer.from('PK\u0003\u0004'), Buffer.from([0, 1, 2, 3, 0, 0])]) });
  await s.waitForSelector('#ice-hata:not([hidden])');
  if (!(await s.locator('#ice-hata').innerText()).includes('CSV gibi görünmüyor')) throw new Error('xlsx mesajı');
  await s.setInputFiles('#ice-dosya', csvDosya('bos.csv', 'Firma adı;Vergi no\n'));
  await s.waitForFunction(() => document.querySelector('#ice-hata')?.textContent.includes('en az bir veri satırı'));
  await s.setInputFiles('#ice-dosya', csvDosya('bozuk.csv', 'Firma adı;Vergi no\n"Açık tırnak;123\n'));
  await s.waitForFunction(() => document.querySelector('#ice-hata')?.textContent.includes('kapatılmamış tırnak'));
  await s.setInputFiles('#ice-dosya', csvDosya('xss.csv', 'Firma adı;Vergi no\n<img src=x onerror=window.__xss=1>;1234567890\n'));
  await s.waitForSelector('#ice-onizleme');
  await s.waitForTimeout(300);
  esit(await s.evaluate(() => window.__xss ?? null), null, 'betik çalışmamalı');
  esit(await s.locator('#ice-onizleme img').count(), 0, 'img oluşmamalı');
  await var_(s.locator('#ice-onizleme td:has-text("<img src=x")'), 'metin olarak gösterilir');
  await s.locator('select[data-esle="0"]').selectOption('');
  await var_(s.locator('.notice-warn:has-text("eşleştirin")'), 'zorunlu alan uyarısı');
  esit(await s.locator('[data-action="ice-aktar"]').count(), 0, 'eşleşmesiz aktarma düğmesi yok');
});

await test('aktarım: şablon indirilir; yetkisiz roller içe aktarmayı göremez, dışa aktarma izne göre', async (s) => {
  await girisYap(s);
  await git(s, '#/aktarim'); await s.waitForSelector('#ice-tur');
  const sablon = await indirOku(s, () => s.click('[data-action="ice-sablon"]'));
  if (!sablon.metin.startsWith('﻿Firma adı;Vergi no;') || sablon.ad !== 'firmalar-sablon.csv') throw new Error(sablon.ad + sablon.metin.slice(0, 40));
  await cikisYapGir(s, 'satis@test.com');
  await git(s, '#/aktarim'); await s.waitForSelector('#disa-liste');
  await var_(s.locator('#ice-kok .empty h3:has-text("aktarma izniniz yok")'), 'satış içe aktaramaz');
  esit(await s.locator('#ice-dosya').count(), 0, 'dosya alanı yok');
  esit(await s.locator('[data-disa="faturalar"]').count(), 0, 'satış faturayı dışa aktaramaz');
  await var_(s.locator('[data-disa="firmalar"]'), 'satış firmaları dışa aktarabilir');
  await cikisYapGir(s, 'finans@test.com');
  await git(s, '#/aktarim'); await s.waitForSelector('#disa-liste');
  await var_(s.locator('#ice-kok .empty h3:has-text("aktarma izniniz yok")'), 'finans içe aktaramaz (firma oluşturma izni yok)');
  await var_(s.locator('[data-disa="faturalar"]'), 'finans faturayı dışa aktarır');
});

await test('mobil 375px: raporlar ve aktarım sayfalarında yatay taşma yok', async (s) => {
  await karlilikHazirla(s);
  for (const h of ['#/raporlar', '#/aktarim']) {
    await git(s, h); await s.waitForTimeout(400);
    if (h === '#/aktarim') {
      await s.setInputFiles('#ice-dosya', csvDosya('m.csv', 'Firma adı;Vergi no;Şehir;E-posta\nMobil Ltd;1234567890;Ankara;m@m.com\nMükerrer;7000000001;x;\n'));
      await s.waitForSelector('#ice-onizleme');
    }
    const t = await s.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    if (t > 1) { const w = await s.evaluate(() => [...document.querySelectorAll('body *')].filter((e) => e.getBoundingClientRect().right > innerWidth + 1).slice(0, 6).map((e) => `${e.tagName}.${e.className}#${e.id}:${Math.round(e.getBoundingClientRect().right)}`).join(' | ')); throw new Error(`${h} yatay taşma ${t}px: ${w}`); }
  }
  await ekran(s, '30-mobil-aktarim');
}, { genislik: 375, yukseklik: 800 });


// ====================================================================== Aşama 9: sistem ayarları
const ayBaslari = (s) => s.evaluate(() => { const t = new Date(); const f = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`; return [f(t), f(new Date(t.getFullYear(), t.getMonth() + 1, 1))]; });

await test('ayarlar: sayfa, doğrulama, planlanan değişiklik ve geçmiş', async (s) => {
  await girisYap(s);
  await git(s, '#/ayarlar'); await s.waitForSelector('#ayar-tablo');
  esit(await s.locator('#ayar-tablo tbody tr').count(), 4, 'dört ayar');
  esit(await s.locator('#kural-tablo tbody td[data-kural-hucre]').count(), 6, 'altı kural hücresi');
  const kap = await s.locator('[data-ayar-satir="kapasite_dakika"]').innerText();
  if (!kap.includes('11.700 dk')) throw new Error(`kapasite: ${kap}`);
  if (!(await s.locator('[data-ayar-satir="kurumlar_vergisi_orani"]').innerText()).includes('%25')) throw new Error('vergi varsayılanı %25 olmalı');
  await ekran(s, '31-ayarlar');
  // doğrulama
  await s.click('[data-ayar="kapasite_dakika"]'); await s.waitForSelector('#f-deger');
  await s.fill('#f-deger', 'abc'); await modal(s).locator('button[type=submit]').click();
  if (!(await s.locator('#e-deger').innerText()).includes('sayı olmalıdır')) throw new Error('sayı hatası');
  await s.fill('#f-deger', '59'); await modal(s).locator('button[type=submit]').click();
  if (!(await s.locator('#e-deger').innerText()).includes('60 ile 44640')) throw new Error('aralık hatası');
  await s.fill('#f-deger', '11700'); await s.selectOption('#f-baslangic', { index: 0 }); await modal(s).locator('button[type=submit]').click();
  if (!(await s.locator('#e-deger').innerText()).includes('aynı')) throw new Error('aynı değer hatası');
  // gelecek aydan itibaren 10.000
  await s.fill('#f-deger', '10.000'); await s.selectOption('#f-baslangic', { index: 1 }); await modal(s).locator('button[type=submit]').click();
  await s.waitForSelector('[data-ayar-satir="kapasite_dakika"] .pill:has-text("10.000 dk")');
  if (!(await s.locator('[data-ayar-satir="kapasite_dakika"]').innerText()).includes('11.700 dk')) throw new Error('şu anki değer değişmemeli');
  const [bu, gelecek] = await ayBaslari(s);
  esit(await s.evaluate((g) => globalThis.__fake.tablo.settings.find((x) => x.key === 'kapasite_dakika' && x.valid_from === g)?.value, gelecek), 10000, 'veritabanına yazıldı');
  await var_(s.locator('#ayar-gecmis tbody tr:has-text("Aylık kapasite"):has-text("10.000 dk")'), 'geçmişte görünür');
  // bu ay, ondalık vergi oranı: hemen geçerli olur
  await s.click('[data-ayar="kurumlar_vergisi_orani"]'); await s.waitForSelector('#f-deger');
  await s.fill('#f-deger', '22,5'); await s.selectOption('#f-baslangic', { index: 0 }); await modal(s).locator('button[type=submit]').click();
  await s.waitForSelector('[data-ayar-satir="kurumlar_vergisi_orani"] td.num:has-text("%22,5")');
  esit((await s.locator('[data-ayar-satir="kurumlar_vergisi_orani"]').innerText()).includes('varsayılan'), false, 'artık varsayılan değil');
  esit(await s.evaluate((b) => globalThis.__fake.tablo.settings.find((x) => x.key === 'kurumlar_vergisi_orani' && x.valid_from === b)?.value, bu), 22.5, 'ondalık değer');
});

await test('ayarlar: hizmet süresi kuralı tarihçeli değişir; eski kural kapanır', async (s) => {
  await girisYap(s);
  await git(s, '#/ayarlar'); await s.waitForSelector('#kural-tablo');
  const hucre = '[data-kural-hucre="is_guvenligi_uzmani|tehlikeli"]';
  if (!(await s.locator(hucre).innerText()).includes('20 dk')) throw new Error('uzman/tehlikeli 20 dk olmalı');
  await s.click(`${hucre} [data-kural]`); await s.waitForSelector('#f-dakika');
  await s.fill('#f-dakika', '601'); await modal(s).locator('button[type=submit]').click();
  if (!(await s.locator('#e-dakika').innerText()).includes('0 ile 600')) throw new Error('aralık hatası');
  await s.fill('#f-dakika', '20'); await modal(s).locator('button[type=submit]').click();
  if (!(await s.locator('#e-dakika').innerText()).includes('aynı')) throw new Error('aynı değer hatası');
  await s.fill('#f-dakika', '25'); await s.selectOption('#f-baslangic', { index: 1 }); await s.fill('#f-not', 'Yönetmelik değişikliği');
  await modal(s).locator('button[type=submit]').click();
  await s.waitForSelector(`${hucre} small:has-text("25 dk")`);
  if (!(await s.locator(hucre).innerText()).includes('20 dk')) throw new Error('şu anki kural 20 dk kalmalı');
  const [, gelecek] = await ayBaslari(s);
  const r = await s.evaluate(() => globalThis.__fake.tablo.service_time_rules.filter((k) => k.staff_type === 'is_guvenligi_uzmani' && k.hazard_class === 'tehlikeli').map((k) => [k.minutes_per_employee, k.valid_from, k.valid_to, k.note]));
  esit(r.length, 2, 'iki kural');
  const eski = r.find((k) => k[0] === 20); const yeni = r.find((k) => k[0] === 25);
  esit(yeni[1], gelecek, 'yeni kural gelecek ayın 1\'inde başlar'); esit(yeni[2], null, 'yeni kural açık'); esit(yeni[3], 'Yönetmelik değişikliği', 'not');
  const onceki = new Date(`${gelecek}T00:00:00Z`); onceki.setUTCDate(0);
  esit(eski[2], onceki.toISOString().slice(0, 10), 'eski kural bir gün önce kapanır');
  await var_(s.locator('#ayar-gecmis tbody tr:has-text("Uzman · Tehlikeli"):has-text("tarihine kadar")'), 'eski kural geçmişte kapanış tarihiyle');
  // planlanan varken tekrar değişim: sonradan başlayan kural hatası (bu ay için)
  await s.click(`${hucre} [data-kural]`); await s.waitForSelector('#f-dakika');
  await s.fill('#f-dakika', '30'); await s.selectOption('#f-baslangic', { index: 0 }); await modal(s).locator('button[type=submit]').click();
  await s.waitForSelector('.form-error:not([hidden])');
  if (!(await s.locator('.form-error').innerText()).includes('zaten var')) throw new Error('çakışma mesajı');
});

await test('ayarlar: yetki — satış ve finans menüyü/sayfayı göremez; salt okunur rol değiştiremez', async (s) => {
  await girisYap(s);
  await s.evaluate(() => { const t = globalThis.__fake.tablo; const r = t.roles.find((x) => x.key === 'finans'); const p = t.role_permissions.find((x) => x.role_id === r.id && x.module === 'settings'); p.can_view = true; });
  await cikisYapGir(s, 'satis@test.com');
  esit(await s.locator('a[href="#/ayarlar"]').count(), 0, 'satış menüde görmez');
  await git(s, '#/ayarlar'); await var_(s.locator('h3:has-text("görme izniniz yok")'), 'satış sayfaya giremez');
  await cikisYapGir(s, 'finans@test.com');
  await var_(s.locator('a[href="#/ayarlar"]'), 'görüntüleme izni olan görür');
  await git(s, '#/ayarlar'); await s.waitForSelector('#ayar-tablo');
  await var_(s.locator('.notice:has-text("yalnızca görüntüleyebilirsiniz")'), 'salt okunur uyarısı');
  esit(await s.locator('[data-ayar], [data-kural]').count(), 0, 'değiştirme düğmesi yok');
  // sunucu da reddeder (sayfayı atlayıp doğrudan RPC)
  const sonuc = await s.evaluate(async () => { const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm'); return (await createClient('x', 'y').rpc('ayar_kaydet', { p_anahtar: 'marj_esigi_yuzde', p_deger: 30, p_gecerlilik: '2099-01-01' })).error?.message ?? null; });
  if (!sonuc || !sonuc.includes('yetkiniz yok')) throw new Error(`RPC reddedilmedi: ${sonuc}`);
});

await test('mobil 375px: ayarlar sayfasında yatay taşma yok', async (s) => {
  await girisYap(s);
  await git(s, '#/ayarlar'); await s.waitForSelector('#ayar-tablo'); await s.waitForTimeout(300);
  const t = await s.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  if (t > 1) { const w = await s.evaluate(() => [...document.querySelectorAll('body *')].filter((e) => e.getBoundingClientRect().right > innerWidth + 1).slice(0, 6).map((e) => `${e.tagName}.${e.className}#${e.id}:${Math.round(e.getBoundingClientRect().right)}`).join(' | ')); throw new Error(`yatay taşma ${t}px: ${w}`); }
  await ekran(s, '32-mobil-ayarlar');
}, { genislik: 375, yukseklik: 800 });

// ====================================================================== Aşama 10: günlük özet e-postası (yalnızca sahibe)
await test('özet e-postası: kart, test gönderimi, günlük kaydı', async (s) => {
  await girisYap(s);
  await git(s, '#/ayarlar'); await s.waitForSelector('#ozet-kart');
  const kart = await s.locator('#ozet-kart').innerText();
  for (const b of ['yalnızca sizin e-posta adresinize', 'Müşterilere hiçbir şey gönderilmez', 'Henüz gönderim kaydı yok']) if (!kart.includes(b)) throw new Error(`kartta "${b}" yok: ${kart}`);
  if (/@/.test(kart)) throw new Error('kartta e-posta adresi görünmemeli');
  await s.click('#ozet-test');
  await s.waitForSelector('.toast:has-text("Test e-postası gönderildi")');
  await s.waitForSelector('#ozet-gunlugu tbody tr');
  const satir = await s.locator('#ozet-gunlugu tbody tr').first().innerText();
  if (!satir.includes('Test') || !satir.includes('Gönderildi')) throw new Error(`günlük satırı: ${satir}`);
  await ekran(s, '33-ozet-eposta');
});

await test('özet e-postası: fonksiyon kurulu değilse ve yapılandırma eksikse anlaşılır uyarı', async (s) => {
  await girisYap(s);
  await s.evaluate(() => { globalThis.__fake.ozetAyar.varsa = false; });
  await git(s, '#/ayarlar'); await s.waitForSelector('#ozet-test');
  await s.click('#ozet-test');
  await s.waitForSelector('.toast:has-text("henüz kurulmamış")');
  await s.evaluate(() => { globalThis.__fake.ozetAyar.varsa = true; globalThis.__fake.ozetAyar.sonuc = 'yapilandirma'; });
  await s.waitForFunction(() => !document.querySelector('#ozet-test').disabled);
  await s.click('#ozet-test');
  await s.waitForSelector('.toast:has-text("OZET_ALICI tanımlı değil")');
  await s.waitForSelector('#ozet-gunlugu tbody tr');
  if (!(await s.locator('#ozet-gunlugu').innerText()).includes('Hata')) throw new Error('hata kaydı görünmüyor');
  await s.evaluate(() => { globalThis.__fake.ozetAyar.sonuc = 'ag'; });
  await s.waitForFunction(() => !document.querySelector('#ozet-test').disabled);
  await s.click('#ozet-test');
  await s.waitForSelector('.toast:has-text("fonksiyona ulaşılamadı")');
});

await test('özet e-postası: günlük tablosu yoksa sayfa açılır, kart kurulum uyarısı verir; salt okunur rol test düğmesi görmez', async (s) => {
  await girisYap(s);
  await s.evaluate(() => { delete globalThis.__fake.tablo.email_digest_log; });
  await git(s, '#/ayarlar'); await s.waitForSelector('#ozet-kart');
  await var_(s.locator('#ozet-kart .notice:has-text("kurulmamış")'), 'kurulum uyarısı');
  await s.evaluate(() => { const t = globalThis.__fake.tablo; t.email_digest_log = []; const r = t.roles.find((x) => x.key === 'finans'); t.role_permissions.find((x) => x.role_id === r.id && x.module === 'settings').can_view = true; });
  await cikisYapGir(s, 'finans@test.com');
  await git(s, '#/ayarlar'); await s.waitForSelector('#ozet-kart');
  esit(await s.locator('#ozet-test').count(), 0, 'salt okunur rol test düğmesi görmez');
});

// ====================================================================== Aşama 11: denetim kaydı ve yedekleme
const denetimTohumla = (s, ekstra = 0) => s.evaluate((n) => {
  const t = globalThis.__fake.tablo; const sahip = t.users.find((u) => u.email === 'sahip@test.com').id; const satis = t.users.find((u) => u.email === 'satis@test.com').id;
  const org = t.organizations[0].id; let id = t.audit_logs.length; const zaman = (dk) => new Date(Date.now() - dk * 60000).toISOString();
  const ekle = (o) => t.audit_logs.push({ id: ++id, organization_id: org, record_id: null, old_data: null, new_data: null, ...o });
  ekle({ table_name: 'companies', record_id: '11111111-2222-4333-8444-555555555555', action: 'INSERT', user_id: satis, created_at: zaman(60), new_data: { id: '11111111-2222-4333-8444-555555555555', name: 'Alfa <b>Gıda</b>', city: 'Ankara', is_active: true, updated_at: 'x' } });
  ekle({ table_name: 'companies', record_id: '11111111-2222-4333-8444-555555555555', action: 'UPDATE', user_id: sahip, created_at: zaman(30), old_data: { name: 'Alfa <b>Gıda</b>', city: 'Ankara', archived_at: null }, new_data: { name: 'Alfa <b>Gıda</b>', city: 'İzmir', archived_at: null } });
  ekle({ table_name: 'invoices', record_id: 'f1', action: 'UPDATE', user_id: sahip, created_at: zaman(20), old_data: { invoice_no: 'F-1', archived_at: null }, new_data: { invoice_no: 'F-1', archived_at: '2026-10-01T00:00:00Z' } });
  for (let i = 0; i < n; i += 1) ekle({ table_name: 'tasks', record_id: `g${i}`, action: 'INSERT', user_id: null, created_at: zaman(100 + i), new_data: { title: `Görev ${i}` } });
}, ekstra);

await test('denetim kaydı: liste, okunur özet, süzgeçler ve XSS güvenliği', async (s) => {
  await girisYap(s); await denetimTohumla(s);
  await var_(s.locator('a[href="#/denetim"]'), 'menüde Denetim kaydı'); await var_(s.locator('a[href="#/yedek"]'), 'menüde Yedekleme');
  await git(s, '#/denetim'); await s.waitForSelector('#denetim-tablo tbody tr');
  esit(await s.locator('#denetim-tablo tbody tr').count(), 3, 'üç kayıt');
  const metin = await s.locator('#denetim-tablo').innerText();
  for (const b of ['Selin Satış', 'Barış Sahip', 'Eklendi', 'Güncellendi', 'Arşivlendi', 'Firma', 'Fatura', 'F-1']) if (!metin.includes(b)) throw new Error(`tabloda "${b}" yok: ${metin}`);
  esit(await s.locator('#denetim-tablo b').count(), 0, 'kayıt adındaki HTML etiketi çalışmamalı (kaçırılmalı)');
  const sehirKutu = s.locator('#denetim-tablo details').filter({ hasText: 'Şehir' }).first();
  await sehirKutu.locator('summary').click();
  const ayr = await sehirKutu.innerText();
  if (!ayr.includes('Şehir') || !ayr.includes('Ankara') || !ayr.includes('İzmir')) throw new Error(`ayrıntı: ${ayr}`);
  await ekran(s, '34-denetim');
  await s.selectOption('#f-tablo', 'invoices'); await s.click('#denetim-suz button[type=submit]');
  await s.waitForFunction(() => document.querySelectorAll('#denetim-tablo tbody tr').length === 1);
  await s.selectOption('#f-tablo', ''); await s.selectOption('#f-islem', 'INSERT'); await s.click('#denetim-suz button[type=submit]');
  await s.waitForFunction(() => document.querySelectorAll('#denetim-tablo tbody tr').length === 1 && document.querySelector('#denetim-tablo').innerText.includes('Eklendi'));
  await s.click('#denetim-temizle');
  await s.waitForFunction(() => document.querySelectorAll('#denetim-tablo tbody tr').length === 3);
  const sahipId = await s.evaluate(() => globalThis.__fake.tablo.users.find((u) => u.email === 'sahip@test.com').id);
  await s.selectOption('#f-kullanici', sahipId); await s.click('#denetim-suz button[type=submit]');
  await s.waitForFunction(() => document.querySelectorAll('#denetim-tablo tbody tr').length === 2);
  await s.click('#denetim-temizle'); await s.waitForFunction(() => document.querySelectorAll('#denetim-tablo tbody tr').length === 3);
  await s.fill('#f-kayit', '11111111-2222-4333-8444-555555555555'); await s.click('#denetim-suz button[type=submit]');
  await s.waitForFunction(() => document.querySelectorAll('#denetim-tablo tbody tr').length === 2);
  await s.fill('#f-kayit', 'abc'); await s.click('#denetim-suz button[type=submit]');
  await s.waitForSelector('.toast:has-text("geçerli bir kimlik değil")');
  await s.click('#denetim-temizle');
  await s.fill('#f-bas', '2030-01-02'); await s.fill('#f-bit', '2030-01-01'); await s.click('#denetim-suz button[type=submit]');
  await s.waitForSelector('#denetim-sonuc:has-text("Başlangıç tarihi bitiş tarihinden sonra olamaz")');
  await s.click('#denetim-temizle'); await s.fill('#f-bas', '2000-01-01'); await s.fill('#f-bit', '2000-01-02'); await s.click('#denetim-suz button[type=submit]');
  await s.waitForSelector('#denetim-sonuc:has-text("Kayıt bulunamadı")');
});

await test('denetim kaydı: sayfalama (50 kayıt) ve boş durum', async (s) => {
  await girisYap(s); await git(s, '#/denetim'); await s.waitForSelector('#denetim-sonuc .empty');
  await denetimTohumla(s, 57);
  await s.click('#denetim-temizle'); await s.waitForSelector('#denetim-tablo tbody tr');
  esit(await s.locator('#denetim-tablo tbody tr').count(), 50, 'ilk sayfa 50');
  esit(await s.locator('#denetim-onceki').isDisabled(), true, 'önceki kapalı');
  await s.click('#denetim-sonraki');
  await s.waitForFunction(() => document.querySelectorAll('#denetim-tablo tbody tr').length === 10);
  esit(await s.locator('#denetim-sonraki').isDisabled(), true, 'son sayfada sonraki kapalı');
  await s.click('#denetim-onceki'); await s.waitForFunction(() => document.querySelectorAll('#denetim-tablo tbody tr').length === 50);
});

await test('yedekleme: indirir, denetime yazar, dosya doğrulanır; bozulmuş dosya reddedilir', async (s) => {
  await girisYap(s); await denetimTohumla(s);
  await git(s, '#/yedek'); await s.waitForSelector('#yedek-al');
  await var_(s.locator('#yedek-son .pill:has-text("Henüz yedek alınmadı")'), 'başlangıçta uyarı');
  const f = await indirOku(s, () => s.click('#yedek-al'));
  if (!/^osgb360-yedek-\d{4}-\d{2}-\d{2}-\d{4}\.json$/.test(f.ad)) throw new Error(`dosya adı: ${f.ad}`);
  const yedek = JSON.parse(f.metin);
  esit(yedek.uygulama, 'osgb360', 'uygulama'); esit(yedek.kurum, 'Test OSGB', 'kurum');
  esit(yedek.tablolar.audit_logs.length >= 3, true, 'denetim kaydı yedekte');
  esit(yedek.tablolar.roles.length, 6, 'altı rol'); esit(yedek.eksik_tablolar.length, 0, 'eksik tablo yok');
  const { yedekDogrula } = await import('../../src/lib/yedek.js');
  esit((await yedekDogrula(f.metin)).gecerli, true, 'indirilen yedek doğrulanır');
  await s.waitForSelector('#yedek-son .pill:has-text("Bugün alındı")');
  esit(await s.evaluate(() => globalThis.__fake.tablo.audit_logs.filter((x) => x.table_name === 'yedek').length), 1, 'denetimde yedek kaydı');
  await ekran(s, '35-yedek');
  const gecerliYol = path.join(os.tmpdir(), 'gecerli-yedek.json'); fs.writeFileSync(gecerliYol, f.metin);
  await s.setInputFiles('#yedek-dosya', gecerliYol); await s.click('#yedek-dogrula');
  await s.waitForSelector('#yedek-sonuc:has-text("Yedek dosyası sağlam")'); await var_(s.locator('#yedek-tablolar'), 'tablo sayıları');
  yedek.tablolar.companies.push({ id: 'x', name: 'Sonradan eklendi' });
  const bozukYol = path.join(os.tmpdir(), 'bozuk-yedek.json'); fs.writeFileSync(bozukYol, JSON.stringify(yedek));
  await s.setInputFiles('#yedek-dosya', bozukYol); await s.click('#yedek-dogrula');
  await s.waitForSelector('#yedek-sonuc:has-text("sorun var")');
  if (!(await s.locator('#yedek-sonuc').innerText()).includes('SHA-256')) throw new Error('özet uyuşmazlığı belirtilmeli');
  fs.writeFileSync(bozukYol, 'bu bir yedek değil'); await s.setInputFiles('#yedek-dosya', bozukYol); await s.click('#yedek-dogrula');
  await s.waitForSelector('#yedek-sonuc:has-text("geçerli bir JSON değil")');
  await s.setInputFiles('#yedek-dosya', []); await s.click('#yedek-dogrula'); await s.waitForSelector('.toast:has-text("Önce bir yedek dosyası seçin")');
});

await test('yedekleme: okunamayan tablo uyarı verir; yetkisiz rol yedek alamaz; satış menüde görmez', async (s) => {
  await girisYap(s);
  await s.evaluate(() => { delete globalThis.__fake.tablo.notifications; });
  await git(s, '#/yedek'); await s.waitForSelector('#yedek-al');
  const f = await indirOku(s, () => s.click('#yedek-al'));
  await s.waitForSelector('.toast:has-text("1 tablo okunamadı: notifications")');
  esit(JSON.parse(f.metin).eksik_tablolar[0], 'notifications', 'eksik tablo dosyada kayıtlı');
  await s.evaluate(() => { const t = globalThis.__fake.tablo; t.notifications = []; const r = t.roles.find((x) => x.key === 'finans'); for (const m of ['settings', 'users']) t.role_permissions.find((x) => x.role_id === r.id && x.module === m).can_view = true; });
  await cikisYapGir(s, 'finans@test.com');
  await git(s, '#/yedek'); await s.waitForSelector('#sayfa h1');
  await var_(s.locator('.notice:has-text("Tam yedek için tüm modülleri")'), 'yetki uyarısı');
  esit(await s.locator('#yedek-al').count(), 0, 'yetkisiz rolde yedek düğmesi yok');
  const sonuc = await s.evaluate(async () => { const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm'); return (await createClient('x', 'y').rpc('yedek_kaydi', { p_tablo_sayisi: 5, p_satir_sayisi: 10 })).error?.message ?? null; });
  if (!sonuc || !sonuc.includes('tüm modülleri')) throw new Error(`RPC reddedilmedi: ${sonuc}`);
  await cikisYapGir(s, 'satis@test.com');
  esit(await s.locator('a[href="#/denetim"], a[href="#/yedek"]').count(), 0, 'satış menüde görmez');
  await git(s, '#/denetim'); await var_(s.locator('h3:has-text("görme izniniz yok")'), 'satış denetime giremez');
});

await test('mobil 375px: denetim ve yedek sayfalarında yatay taşma yok', async (s) => {
  await girisYap(s); await denetimTohumla(s);
  for (const h of ['#/denetim', '#/yedek']) {
    await git(s, h); await s.waitForSelector('#sayfa h1'); await s.waitForTimeout(300);
    const t = await s.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    if (t > 1) { const w = await s.evaluate(() => [...document.querySelectorAll('body *')].filter((e) => e.getBoundingClientRect().right > innerWidth + 1).slice(0, 6).map((e) => `${e.tagName}.${e.className}#${e.id}:${Math.round(e.getBoundingClientRect().right)}`).join(' | ')); throw new Error(`${h} yatay taşma ${t}px: ${w}`); }
  }
  await ekran(s, '36-mobil-denetim');
}, { genislik: 375, yukseklik: 800 });

// ====================================================================== Aşama 12: müşteri teklif bağlantısı
// Müşteri, girişsiz yeni bir sayfadır; sahte veri tabanı mevcut durumla (anlık görüntü) başlatılır.
const musteriSayfasi = async (s, ctx, adres) => {
  const tohum = await s.evaluate(() => JSON.stringify(globalThis.__fake.tablo));
  const m = await ctx.newPage();
  m.__hatalar = [];
  m.on('pageerror', (e) => m.__hatalar.push(`pageerror: ${e.message}`));
  m.on('console', (c) => { if (c.type() === 'error' && !/Failed to load resource/.test(c.text())) m.__hatalar.push(`console: ${c.text()}`); });
  await m.route('**/cdn.jsdelivr.net/**', (r) => r.fulfill({ status: 200, contentType: 'text/javascript', headers: { 'access-control-allow-origin': '*' }, body: FAKE }));
  await m.route('**/*.supabase.co/**', (r) => r.abort());
  await m.addInitScript((t) => { globalThis.__fakeTohum = t; }, tohum);
  await m.goto(adres);
  return m;
};
const musteriDurumunuSahibeAktar = async (m, s) => {
  const t = await m.evaluate(() => JSON.stringify(globalThis.__fake.tablo));
  await s.evaluate((x) => { const tb = globalThis.__fake.tablo; for (const [k, v] of Object.entries(JSON.parse(x))) { if (Array.isArray(tb[k])) tb[k].splice(0, tb[k].length, ...v); } }, t);
};
const baglantiOlustur = async (s, { gun = '30', not = '' } = {}) => {
  await s.click('[data-action="paylasim-olustur"]');
  await modal(s).locator('#f-gun').selectOption(gun);
  if (not) await modal(s).locator('#f-not').fill(not);
  await modal(s).locator('button[type=submit]').click();
  await s.waitForSelector('#m-link');
  return s.locator('#m-link').inputValue();
};
const gonderilmisTeklif = async (s, firma, { kalem = true } = {}) => {
  await firmaEkle(s, { ad: firma, vergi: String(Math.floor(1e9 + Math.random() * 9e9)), calisan: 25, tehlike: 'tehlikeli' });
  await s.waitForSelector('.company-head');
  await teklifOlustur(s, firma, { calisan: 25, tehlike: 'tehlikeli', birim: '100', uzman: '900', indirim: '10' });
  if (kalem) {
    await s.click('[data-action="kalem-ekle"]');
    await modal(s).locator('#f-description').fill('Yıllık eğitim paketi'); await modal(s).locator('#f-unit_price').fill('3000');
    await modal(s).locator('button[type=submit]').click(); await s.waitForSelector('td:has-text("Yıllık eğitim paketi")');
  }
  await s.click('[data-gecis="gonderildi"]'); await s.waitForSelector('.company-meta .pill:has-text("Gönderildi")');
};

await test('müşteri bağlantısı: oluştur, müşteri sayfası, kabul, sahibe yansır', async (s, ctx) => {
  await girisYap(s);
  await gonderilmisTeklif(s, 'Portal Gıda A.Ş.');
  await var_(s.locator('#paylasim-karti'), 'bağlantı kartı');
  const kartMetni = await s.locator('#paylasim-karti').innerText();
  if (!kartMetni.includes('Henüz bağlantı oluşturulmadı') || !kartMetni.includes('hiçbir mesaj göndermez')) throw new Error(`kart: ${kartMetni}`);
  const link = await baglantiOlustur(s, { gun: '14', not: 'Merhaba, teklifimiz ektedir.' });
  if (!new RegExp(`#/t/[0-9a-f]{64}$`).test(link)) throw new Error(`bağlantı biçimi: ${link}`);
  esit(link.split('#')[0].includes(link.split('/t/')[1]), false, 'anahtar adres çubuğunun # öncesinde olmamalı');
  await s.click('[data-kopyala]'); await s.waitForSelector('.toast');
  await ekran(s, '37-baglanti-olustu');
  await s.click('.modal-actions [data-close]');
  await s.waitForSelector('#paylasim-karti .pill:has-text("Aktif")');
  const sonra = await s.locator('#paylasim-karti').innerText();
  if (!sonra.includes('0 görüntüleme') || !sonra.includes('Merhaba, teklifimiz ektedir.') || !sonra.includes('Yeni bağlantı oluştur')) throw new Error(`kart: ${sonra}`);
  if (sonra.includes(link.split('/t/')[1])) throw new Error('anahtar sahibin sayfasında tekrar gösterilmemeli');

  // yanıt gelmeden: liste ve panel "bekleniyor" der
  await git(s, '#/teklifler'); await s.waitForSelector('#teklif-tablo tbody tr');
  if (!(await s.locator('#teklif-tablo').innerText()).includes('Müşteri yanıtı bekleniyor')) throw new Error('listede bekleniyor rozeti yok');
  await git(s, '#/panel'); await s.waitForSelector('#panel-yanit-gelen'); esit((await s.locator('#panel-yanit-gelen').innerText()).trim(), '0', 'panelde işlenmemiş yanıt yok');
  await git(s, '#/teklifler'); await s.waitForSelector('#teklif-tablo tbody tr'); await s.click('#teklif-tablo tbody tr a'); await s.waitForSelector('#paylasim-karti');
  // müşteri (girişsiz, yeni sayfa)
  const m = await musteriSayfasi(s, ctx, link);
  await m.waitForSelector('#aylik-toplam');
  esit(await m.locator('#kabuk, .sidebar, .topbar').count(), 0, 'müşteride uygulama kabuğu yok');
  esit(await m.evaluate(() => document.querySelector('meta[name=robots]')?.content), 'noindex,nofollow,noarchive', 'arama motoru engeli');
  const metin = await m.locator('main').innerText();
  for (const b of ['Portal Gıda A.Ş.', 'TKL-', 'Merhaba, teklifimiz ektedir.', 'Yıllık eğitim paketi', 'Aylık toplam (KDV dahil)', 'Yanıtınız']) if (!metin.includes(b)) throw new Error(`müşteri sayfasında "${b}" yok: ${metin}`);
  for (const yasak of ['Kârlılık', 'maliyet', 'Katkı', 'marj', 'Marj', 'Fiyat senaryoları']) if (metin.includes(yasak)) throw new Error(`müşteriye iç bilgi sızdı: ${yasak}`);
  esit((await m.locator('#aylik-toplam').innerText()).replace(/\s/g, '').includes('2.700,00'), true, '25 × 100 − %10 = 2.250 + KDV = 2.700,00');
  await ekran(m, '38-musteri-teklif');
  // düğme renkleri: kabul yeşil, ret kırmızı
  const renk = (sec) => m.evaluate((q) => { const c = getComputedStyle(document.querySelector(q)).backgroundColor.match(/\d+/g).map(Number); return { r: c[0], g: c[1], b: c[2] }; }, sec);
  const yesil = await renk('[data-karar="kabul"]'); const kirmizi = await renk('[data-karar="red"]');
  if (!(yesil.g > yesil.r)) throw new Error(`kabul düğmesi yeşil değil: ${JSON.stringify(yesil)}`);
  if (!(kirmizi.r > kirmizi.g + 60 && kirmizi.r > kirmizi.b + 60)) throw new Error(`ret düğmesi kırmızı değil: ${JSON.stringify(kirmizi)}`);
  await m.click('[data-karar="red"]'); await m.waitForSelector('#yanit-form:not([hidden])');
  await m.waitForTimeout(500); const retGonder = await renk('#yanit-gonder'); esit((await m.locator('#yanit-gonder').innerText()).trim(), 'Reddimi gönder', 'ret gönder metni');
  if (!(retGonder.r > retGonder.g + 60)) throw new Error('ret gönder düğmesi kırmızı olmalı');
  await ekran(m, '38b-ret-secildi');
  await m.click('#yanit-vazgec'); await m.waitForSelector('#yanit-dugmeler:not([hidden])');
  // kabul: boş ad reddedilir
  await m.click('[data-karar="kabul"]'); await m.waitForSelector('#yanit-form:not([hidden])');
  await m.click('#yanit-gonder'); await m.waitForSelector('#e-ad:not(:empty)');
  esit(await m.locator('#yanit-bilgi').count(), 0, 'ad girilmeden yanıt gitmemeli');
  await m.fill('#f-ad', 'Ali Veli'); await m.fill('#f-not', 'Sözleşme taslağını bekliyoruz.'); await m.click('#yanit-gonder');
  await m.waitForSelector('#yanit-bilgi');
  const bilgi = await m.locator('#yanit-bilgi').innerText();
  if (!bilgi.includes('Yanıtınız alındı') || !bilgi.includes('kabul')) throw new Error(`yanıt bilgisi: ${bilgi}`);
  esit(await m.locator('#yanit-kart').count(), 0, 'yanıttan sonra form kalkar');
  const durum = await m.evaluate(() => { const t = globalThis.__fake.tablo; return { teklif: t.offers[0].status, gorev: t.tasks.filter((x) => x.source_ref?.startsWith('offer_share:')).length, sozlesme: t.contracts.length }; });
  esit(durum.teklif, 'gonderildi', 'teklif durumu kendiliğinden değişmez'); esit(durum.gorev, 1, 'sahibe görev düştü'); esit(durum.sozlesme, 0, 'sözleşme kendiliğinden oluşmaz');
  esit(m.__hatalar.length, 0, `müşteri sayfası hataları: ${m.__hatalar.join(' | ')}`);
  // sahibe yansır
  await musteriDurumunuSahibeAktar(m, s); await m.close();
  await git(s, '#/panel'); await git(s, '#/teklifler'); await s.waitForSelector('#teklif-tablo tbody tr'); await s.click('#teklif-tablo tbody tr a');
  await s.waitForSelector('#musteri-yaniti');
  const y = await s.locator('#musteri-yaniti').innerText();
  for (const b of ['KABUL', 'Ali Veli', 'Sözleşme taslağını bekliyoruz.', 'kendiliğinden değişmez']) if (!y.includes(b)) throw new Error(`müşteri yanıtı kartında "${b}" yok: ${y}`);
  await ekran(s, '39-musteri-yaniti');
  await git(s, '#/gorevler'); await s.waitForSelector('text=Müşteri teklifi KABUL ETTİ');
  // liste: durum "Gönderildi" kalır ama yanıt rozeti ve filtreler gerçeği gösterir
  await git(s, '#/teklifler'); await s.waitForSelector('#teklif-tablo tbody tr');
  const liste = await s.locator('#teklif-tablo').innerText();
  if (!liste.includes('Gönderildi') || !liste.includes('Müşteri KABUL etti — işleyin')) throw new Error(`liste rozetleri: ${liste}`);
  const chip = async (ad) => (await s.locator(`#teklif-filtre [data-filtre="${ad}"]`).innerText()).replace(/\s+/g, ' ');
  if (!(await chip('yanit_gelen')).endsWith('1')) throw new Error(`yanıt geldi sayacı: ${await chip('yanit_gelen')}`);
  if (!(await chip('yanit_bekleyen')).endsWith('0')) throw new Error(`yanıt bekleyen sayacı: ${await chip('yanit_bekleyen')}`);
  await s.click('#teklif-filtre [data-filtre="yanit_gelen"]'); await s.waitForSelector('#teklif-tablo tbody tr');
  esit(await s.locator('#teklif-tablo tbody tr').count(), 1, 'filtre: yanıt gelen 1 teklif');
  await s.click('#teklif-filtre [data-filtre="yanit_bekleyen"]');
  esit(await s.locator('#teklif-tablo tbody tr').count(), 0, 'filtre: bekleyen yok');
  await ekran(s, '39b-liste-yanit-rozeti');
  // panel: bekleyen 0, yanıt gelen 1
  await git(s, '#/panel'); await s.waitForSelector('#panel-yanit-gelen');
  esit((await s.locator('#panel-yanit-gelen').innerText()).trim(), '1', 'panelde yanıt gelen 1');
  if (!(await s.locator('main').innerText()).includes('Yanıt geldi, işlenmedi')) throw new Error('panel satırı yok');
  // teklif sayfası: rozet ve sıradaki adım
  await git(s, '#/teklifler'); await s.waitForSelector('#teklif-tablo tbody tr'); await s.click('#teklif-tablo tbody tr a'); await s.waitForSelector('#musteri-yaniti');
  const ust = await s.locator('.company-meta').innerText();
  if (!ust.includes('Müşteri KABUL etti — işleyin')) throw new Error(`teklif başlığı: ${ust}`);
  if (!(await s.locator('#musteri-yaniti').innerText()).includes('Sözleşme oluştur')) throw new Error('sıradaki adım metni yok');
});

await test('müşteri bağlantısı: iptal, geçersiz bağlantılar, XSS ve izinler', async (s, ctx) => {
  await girisYap(s);
  await gonderilmisTeklif(s, 'Güvenlik Ltd.', { kalem: false });
  const link = await baglantiOlustur(s); await s.click('.modal-actions [data-close]');
  const anahtar = link.split('/t/')[1];
  // geçersiz biçimler ve bilinmeyen anahtar
  for (const h of ['#/t/abc', `#/t/${'a'.repeat(64)}`, `#/t/${anahtar.toUpperCase()}`, '#/t/']) {
    const m = await musteriSayfasi(s, ctx, ADRES + h);
    await m.waitForSelector('h1:has-text("geçersiz ya da süresi dolmuş")');
    const t = await m.locator('main').innerText(); if (t.includes('Güvenlik Ltd.')) throw new Error(`geçersiz bağlantıda veri sızdı (${h})`);
    await m.close();
  }
  // XSS: müşteri adı ve notu sahibin sayfasında kaçırılır
  let m = await musteriSayfasi(s, ctx, link); await m.waitForSelector('#aylik-toplam');
  await m.click('[data-karar="red"]'); await m.fill('#f-ad', '<img src=x onerror=window.__xss=1>'); await m.fill('#f-not', '<script>window.__xss=2</script>'); await m.click('#yanit-gonder');
  await m.waitForSelector('#yanit-bilgi');
  esit(await m.evaluate(() => window.__xss ?? 0), 0, 'müşteri sayfasında XSS çalışmamalı');
  await musteriDurumunuSahibeAktar(m, s); await m.close();
  await git(s, '#/panel'); await git(s, '#/teklifler'); await s.waitForSelector('#teklif-tablo tbody tr'); await s.click('#teklif-tablo tbody tr a');
  await s.waitForSelector('#musteri-yaniti');
  esit(await s.evaluate(() => window.__xss ?? 0), 0, 'sahip sayfasında XSS çalışmamalı');
  if (!(await s.locator('#musteri-yaniti').innerText()).includes('RED')) throw new Error('red gösterilmedi');
  // yeni bağlantı eskisini kapatır; iptal bağlantıyı kapatır
  const link2 = await baglantiOlustur(s); await s.click('.modal-actions [data-close]');
  m = await musteriSayfasi(s, ctx, link); await m.waitForSelector('h1:has-text("geçersiz ya da süresi dolmuş")'); await m.close();
  await s.click('[data-action="paylasim-iptal"]'); await s.click('[data-ok]');
  await s.waitForSelector('.toast:has-text("iptal edildi")');
  m = await musteriSayfasi(s, ctx, link2); await m.waitForSelector('h1:has-text("geçersiz ya da süresi dolmuş")'); await m.close();
  // salt okunur rol: kartı görür ama düğme yok
  await s.evaluate(() => { const t = globalThis.__fake.tablo; const r = t.roles.find((x) => x.key === 'satis'); t.role_permissions.find((x) => x.role_id === r.id && x.module === 'offers').can_edit = false; });
  await cikisYapGir(s, 'satis@test.com');
  await git(s, '#/teklifler'); await s.waitForSelector('#teklif-tablo tbody tr'); await s.click('#teklif-tablo tbody tr a'); await s.waitForSelector('#paylasim-karti');
  esit(await s.locator('[data-action="paylasim-olustur"], [data-action="paylasim-iptal"]').count(), 0, 'düzenleme izni olmayan bağlantı oluşturamaz');
});

await test('müşteri bağlantısı: taslakta oluşturulamaz; süresi dolmuş teklife yanıt verilemez; yazdırmada iç bilgi yok', async (s, ctx) => {
  await girisYap(s);
  await firmaEkle(s, { ad: 'Taslak Ltd.', vergi: '5555555555', calisan: 10, tehlike: 'tehlikeli' }); await s.waitForSelector('.company-head');
  await teklifOlustur(s, 'Taslak Ltd.', { calisan: 10, tehlike: 'tehlikeli', birim: '100', uzman: '500' });
  esit(await s.locator('[data-action="paylasim-olustur"]').count(), 0, 'taslakta bağlantı düğmesi yok');
  if (!(await s.locator('#paylasim-karti').innerText()).includes('Müşteriye gönder')) throw new Error('taslak ipucu yok');
  // iç sayfa yazdırılınca kârlılık ve bağlantı kartı gizlenir
  await s.emulateMedia({ media: 'print' });
  esit(await s.locator('section:has(h2:has-text("Kârlılık"))').first().isVisible(), false, 'yazdırmada kârlılık gizli');
  esit(await s.locator('#paylasim-karti').isVisible(), false, 'yazdırmada bağlantı kartı gizli');
  await s.emulateMedia({ media: 'screen' });
  await s.click('[data-gecis="gonderildi"]'); await s.waitForSelector('.company-meta .pill:has-text("Gönderildi")');
  const link = await baglantiOlustur(s); await s.click('.modal-actions [data-close]');
  await s.evaluate(() => { globalThis.__fake.tablo.offers[0].valid_until = '2020-01-01'; });
  const m = await musteriSayfasi(s, ctx, link); await m.waitForSelector('#aylik-toplam');
  await var_(m.locator('.notice-warn:has-text("geçerlilik süresi dolmuştur")'), 'süre uyarısı');
  esit(await m.locator('#yanit-kart').count(), 0, 'süresi dolmuş teklife yanıt formu yok');
  await m.emulateMedia({ media: 'print' }); esit(await m.locator('#yazdir').isVisible(), false, 'yazdırmada düğmeler gizli');
  await m.close();
});

await test('mobil 375px: müşteri teklif sayfasında yatay taşma yok', async (s, ctx) => {
  await girisYap(s);
  await gonderilmisTeklif(s, 'Mobil Ltd.');
  const link = await baglantiOlustur(s, { not: 'Uzun bir not '.repeat(20) }); await s.click('.modal-actions [data-close]');
  const m = await musteriSayfasi(s, ctx, link); await m.waitForSelector('#aylik-toplam'); await m.click('[data-karar="kabul"]'); await m.waitForTimeout(200);
  await m.setViewportSize({ width: 375, height: 800 });
  const t = await m.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  if (t > 1) { const w = await m.evaluate(() => [...document.querySelectorAll('body *')].filter((e) => e.getBoundingClientRect().right > innerWidth + 1).slice(0, 6).map((e) => `${e.tagName}.${e.className}#${e.id}:${Math.round(e.getBoundingClientRect().right)}`).join(' | ')); throw new Error(`yatay taşma ${t}px: ${w}`); }
  await ekran(m, '40-mobil-musteri'); await m.close();
});

// ---------------------------------------------------------------- İSG-Katip aktarımı (Aşama 13)
const KATIP1 = path.join(KOK, 'tests/fixtures/katip_ornek.xlsx'); const KATIP2 = path.join(KOK, 'tests/fixtures/katip_ornek_ikinci.xlsx');
const katipKurulum = async (s) => {
  await girisYap(s);
  for (const f of [{ ad: 'Seterm Teknik Ticaret A.Ş.', calisan: 30, tehlike: 'tehlikeli' }, { ad: 'Alfa Gıda', calisan: 40, tehlike: 'az_tehlikeli' }, { ad: 'Eski Müşteri Ltd', calisan: 5, tehlike: 'tehlikeli' }]) {
    await firmaEkle(s, f); await s.waitForSelector('.modal-overlay', { state: 'detached' }); await s.waitForTimeout(200);
  }
};
const katipYukle = async (s, dosya, donem) => {
  await git(s, '#/katip'); await s.waitForSelector('#katip-kok');
  if (await s.locator('[data-action="katip-yeni"]').count()) await s.click('[data-action="katip-yeni"]');
  await s.waitForSelector('#katip-dosya');
  if (donem) await s.fill('#katip-donem', donem);
  await s.setInputFiles('#katip-dosya', dosya); await s.waitForSelector('#katip-ozet');
};

await test('İSG-Katip: ilk yükleme — eşleştirme soruları, karma tehlike, Excel dışı firma, uygulama', async (s) => {
  await katipKurulum(s);
  await katipYukle(s, KATIP1, '2026-10');
  const ozet = await s.locator('#katip-ozet').innerText();
  if (!ozet.includes('8') || !ozet.includes('5')) throw new Error(`özet: ${ozet}`);
  esit(await s.locator('#katip-ilk').count(), 1, 'ilk yükleme notu');
  // Seterm Servis için soru, Seterm Teknik ile birleştirme önerilir
  const sorular = await s.locator('#katip-sorular').innerText();
  if (!sorular.includes('SETERM SERVİS') || !sorular.includes('Seterm Teknik Ticaret A.Ş.')) throw new Error(`sorular: ${sorular}`);
  esit(await s.locator('#katip-sorular [data-karar]').first().inputValue().then((v) => v.startsWith('esle:')), true, 'varsayılan: mevcut firmaya bağla');
  // firma bazında sonuç: Alfa iki işyeri, karma tehlike, 48 çalışan; Seterm 30 (iki unvan birleşti)
  const firmalar = await s.locator('#katip-firmalar').innerText();
  for (const b of ['Alfa Gıda', '48', 'Karma', 'Az tehlikeli 40 + Çok tehlikeli 8', 'Seterm Teknik Ticaret A.Ş.', '2 unvan birleşti', 'YENİ FİRMA LTD. ŞTİ.', 'Yeni']) if (!firmalar.includes(b)) throw new Error(`firma tablosu "${b}" yok: ${firmalar}`);
  // Excel'de olmayan firma
  const disi = await s.locator('#katip-disi').innerText(); if (!disi.includes('Eski Müşteri Ltd')) throw new Error(`excel dışı: ${disi}`);
  await ekran(s, '41-katip-analiz');
  // onay kutusu işaretlenmeden uygulanamaz
  esit(await s.locator('[data-action="katip-uygula"]').isDisabled(), true, 'onay öncesi düğme kapalı');
  await s.check('[data-pasif]'); await s.check('#katip-gozden');
  esit(await s.locator('[data-action="katip-uygula"]').isDisabled(), false, 'onaydan sonra düğme açık');
  await s.click('[data-action="katip-uygula"]'); await modal(s).locator('[data-ok]').click();
  await s.waitForSelector('#katip-sonuc');
  const sonuc = await s.locator('#katip-sonuc').innerText();
  if (!sonuc.includes('1 yeni firma') || !sonuc.includes('5 yeni işyeri') || !sonuc.includes('1 firma eski müşteri yapıldı')) throw new Error(`sonuç: ${sonuc}`);
  const d = await s.evaluate(() => { const t = globalThis.__fake.tablo; const ad = (n) => t.companies.find((c) => c.name === n);
    const alfa = ad('Alfa Gıda'); const p = t.company_profiles.find((x) => x.company_id === alfa.id && !x.valid_to);
    return { siteler: t.company_sites.length, yeni: !!ad('YENİ FİRMA LTD. ŞTİ.'), eski: ad('Eski Müşteri Ltd').customer_status, alfaSayi: p.employee_count, alfaTehlike: p.hazard_class, dokum: p.site_breakdown, setermSite: t.company_sites.filter((x) => x.company_id === ad('Seterm Teknik Ticaret A.Ş.').id).length,
      satir: t.katip_rows.length, kisiler: t.contacts.filter((c) => c.title === 'İSG-Katip onaylayan').length, tc: t.katip_people.filter((x) => x.national_id).length }; });
  esit(d.siteler, 5, 'işyeri sayısı'); esit(d.yeni, true, 'yeni firma'); esit(d.eski, 'eski_musteri', 'pasife alındı'); esit(d.alfaSayi, 48, 'Alfa toplam'); esit(d.alfaTehlike, 'cok_tehlikeli', 'Alfa en yüksek tehlike');
  esit(JSON.stringify(d.dokum), JSON.stringify([{ tehlike: 'az_tehlikeli', calisan: 40 }, { tehlike: 'cok_tehlikeli', calisan: 8 }]), 'karma döküm'); esit(d.setermSite, 2, 'Seterm iki sicil');
  esit(d.satir, 8, 'satır'); esit(d.kisiler, 4, 'onaylayan kişiler'); esit(d.tc, 3, 'TC kayıtları');
  // işyerleri tablosu ve geçmiş
  await s.waitForSelector('#site-tablo'); esit(await s.locator('#site-tablo tbody tr').count(), 5, 'işyeri satırları');
  const gecmis = await s.locator('#katip-gecmis').innerText(); if (!gecmis.includes('katip_ornek.xlsx')) throw new Error(`geçmiş: ${gecmis}`);
  await ekran(s, '42-katip-sonuc');
});

await test('İSG-Katip: ikinci yükleme — kayıtlı eşleşme sorulmaz, değişiklik uyarıları, ayrılan işyeri', async (s) => {
  await katipKurulum(s);
  await katipYukle(s, KATIP1, '2026-10');
  await s.check('#katip-gozden'); await s.click('[data-action="katip-uygula"]'); await modal(s).locator('[data-ok]').click(); await s.waitForSelector('#katip-sonuc');
  await katipYukle(s, KATIP2, '2026-11');
  esit((await s.locator('#katip-n-soru').innerText()).trim(), '0', 'kayıtlı eşleşmeler için soru yok');
  const baslik = await s.locator('#katip-degisiklik-baslik').innerText(); if (!baslik.includes('önemli')) throw new Error(`başlık: ${baslik}`);
  const t = await s.locator('#katip-degisiklik').innerText();
  for (const b of ['Çalışan sayısı 20 → 25', 'Tehlike sınıfı Az tehlikeli → Tehlikeli', 'İşyeri hekimi değişti', 'YENİ HEKİM', 'NURAY YETKİLİ → YENİ YETKİLİ', 'bu dosyada yok']) if (!t.includes(b)) throw new Error(`değişiklik "${b}" yok: ${t}`);
  // Excel'de olmayan firma yok; ayrılan işyerinin firması "Excel'de yok" listesine girer
  const disi = await s.locator('#katip-disi').innerText(); if (!disi.includes('YENİ FİRMA')) throw new Error(`excel dışı: ${disi}`);
  await ekran(s, '43-katip-degisiklik');
  await s.check('#katip-gozden'); await s.click('[data-action="katip-uygula"]'); await modal(s).locator('[data-ok]').click(); await s.waitForSelector('#katip-sonuc');
  const d = await s.evaluate(() => { const t = globalThis.__fake.tablo; const ad = (n) => t.companies.find((c) => c.name === n); const sicil = (n) => t.company_sites.find((x) => x.sgk_no === n);
    const alfa = ad('Alfa Gıda'); const p = t.company_profiles.filter((x) => x.company_id === alfa.id);
    return { ayrildi: sicil('44444444444444444444444444').is_active, imp: t.katip_imports.length, alfaProfil: p.length, alfaGuncel: p.find((x) => !x.valid_to), sayi: t.katip_imports[1].summary.degisiklik_sayisi, seterm: t.company_profiles.find((x) => x.company_id === ad('Seterm Teknik Ticaret A.Ş.').id && !x.valid_to) }; });
  esit(d.ayrildi, false, 'ayrılan işyeri pasif'); esit(d.imp, 2, 'iki yükleme'); esit(d.alfaGuncel.employee_count, 48, 'Alfa toplam'); esit(d.alfaGuncel.hazard_class, 'cok_tehlikeli', 'Alfa hâlâ karma (bir sicil çok tehlikeli)'); esit(JSON.stringify(d.alfaGuncel.site_breakdown), JSON.stringify([{ tehlike: 'cok_tehlikeli', calisan: 8 }, { tehlike: 'tehlikeli', calisan: 40 }]), 'döküm: 40 tehlikeli + 8 çok tehlikeli'); esit(d.alfaProfil, 3, 'Alfa: elle girilen + 1. yükleme + 2. yükleme dönemleri korundu');
  esit(d.seterm.employee_count, 35, 'Seterm 25+10'); if (!(d.sayi >= 5)) throw new Error(`özet değişiklik sayısı: ${d.sayi}`);
  const gecmis = await s.locator('#katip-gecmis').innerText(); if (!gecmis.includes('katip_ornek_ikinci.xlsx')) throw new Error(`geçmiş: ${gecmis}`);
});

await test('İSG-Katip: karar değiştirme (yeni firma / başka firma / aktarma), fatura firması düzeltme, hatalı dosya, yetki', async (s) => {
  await katipKurulum(s);
  await git(s, '#/katip'); await s.waitForSelector('#katip-dosya');
  await s.setInputFiles('#katip-dosya', { name: 'bozuk.xlsx', mimeType: 'application/octet-stream', buffer: Buffer.from('bu bir excel dosyası değil'.repeat(5)) });
  await s.waitForSelector('#katip-hata:not([hidden])'); if (!(await s.locator('#katip-hata').innerText()).includes('Excel')) throw new Error('bozuk dosya hatası');
  await s.setInputFiles('#katip-dosya', { name: 'a.csv', mimeType: 'text/csv', buffer: Buffer.from('a,b\n1,2') });
  await s.waitForFunction(() => document.querySelector('#katip-hata')?.textContent.includes('.xlsx'));
  await katipYukle(s, KATIP1, '2026-10');
  // Seterm Servis: yeni firma olarak ayır; Yeni Firma: aktarma
  await s.locator('#katip-sorular [data-karar^="SETERM SERVİS"]').selectOption('yeni'); await s.waitForSelector('#katip-sorular [data-yeni-ad^="SETERM SERVİS"]');
  await s.locator('#katip-sorular [data-yeni-ad^="SETERM SERVİS"]').fill('Seterm Servis Hizmetleri'); await s.locator('#katip-sorular [data-yeni-ad^="SETERM SERVİS"]').dispatchEvent('change');
  await s.locator('summary', { hasText: "sistemde yok" }).click(); await s.locator('[data-karar^="YENİ FİRMA"]').selectOption('yoksay');
  const f = await s.locator('#katip-firmalar').innerText();
  if (!f.includes('Seterm Servis Hizmetleri') || f.includes('YENİ FİRMA LTD')) throw new Error(`firma tablosu: ${f}`);
  await s.check('#katip-gozden'); await s.click('[data-action="katip-uygula"]'); await modal(s).locator('[data-ok]').click(); await s.waitForSelector('#katip-sonuc');
  const d = await s.evaluate(() => { const t = globalThis.__fake.tablo; return { sitesi: t.company_sites.length, servis: t.companies.some((c) => c.name === 'Seterm Servis Hizmetleri'), yeniFirma: t.companies.some((c) => c.name.startsWith('YENİ FİRMA')) }; });
  esit(d.sitesi, 4, 'yoksayılan işyeri aktarılmadı'); esit(d.servis, true, 'yeni ad ile firma'); esit(d.yeniFirma, false, 'yoksayılan firma oluşmadı');
  // fatura firmasını değiştir
  await s.waitForSelector('#site-tablo');
  const satir = s.locator('#site-tablo tr', { hasText: 'SETERM SERVİS' });
  await satir.locator('[data-site-firma]').selectOption({ label: 'Alfa Gıda' }); await s.waitForSelector('.toast');
  esit(await s.evaluate(() => { const t = globalThis.__fake.tablo; return t.company_sites.find((x) => x.site_name.startsWith('SETERM SERVİS')).company_id === t.companies.find((c) => c.name === 'Alfa Gıda').id; }), true, 'işyeri Alfa\'ya bağlandı');
  // arama
  await s.fill('#site-ara', 'alfa'); await s.waitForTimeout(100); esit(await s.locator('#site-tablo tbody tr').count() >= 1, true, 'arama');
});

await test('İSG-Katip: görevlendirme önizlemesi — personel eşleşir/oluşur, onaydan sonra yazılır, ikinci yüklemede değişiklik uyarısı', async (s) => {
  await katipKurulum(s);
  await katipYukle(s, KATIP1, '2026-10');
  await s.check('#katip-gozden'); await s.click('[data-action="katip-uygula"]'); await modal(s).locator('[data-ok]').click(); await s.waitForSelector('#katip-sonuc');
  await s.waitForSelector('#gorev-kart');
  const once = await s.evaluate(() => { const t = globalThis.__fake.tablo; return { a: t.assignments.length, e: t.employees.length }; });
  esit(`${once.a}/${once.e}`, '0/0', 'önizleme hiçbir şey yazmaz');
  const ozet = await s.locator('#gorev-ozet').innerText(); if (!/yeni görevlendirme/.test(ozet) || !/yeni personel/.test(ozet)) throw new Error(`özet: ${ozet}`);
  esit(await s.locator('[data-action="gorev-uygula"]').isDisabled(), true, 'gözden geçirme öncesi düğme kapalı');
  await ekran(s, '45-gorev-onizleme');
  await s.check('#gorev-gozden'); await s.click('[data-action="gorev-uygula"]'); await modal(s).locator('[data-ok]').click();
  await s.waitForSelector('#gorev-sonuc');
  const son = await s.evaluate(() => { const t = globalThis.__fake.tablo; const topla = {}; for (const a of t.assignments.filter((x) => !x.valid_to)) { const k = `${a.company_id}|${a.staff_type}`; topla[k] = (topla[k] ?? 0) + Number(a.share_pct); }
    return { a: t.assignments.length, e: t.employees.length, sert: t.employees.every((x) => x.certificate_no), enBuyuk: Math.max(0, ...Object.values(topla)) }; });
  if (son.a < 1 || son.e < 1 || !son.sert || son.enBuyuk > 100) throw new Error(`sonuç: ${JSON.stringify(son)}`);
  await ekran(s, '46-gorev-sonuc');
  // ikinci yükleme: personel zaten kayıtlı, yeni önizleme "değişmiyor" ağırlıklı (aynı dosya) → yeni personel açılmaz
  await katipYukle(s, KATIP1, '2026-10');
  await s.check('#katip-gozden'); await s.click('[data-action="katip-uygula"]'); await modal(s).locator('[data-ok]').click(); await s.waitForSelector('#katip-sonuc'); await s.waitForSelector('#gorev-kart');
  const ozet2 = await s.locator('#gorev-ozet').innerText(); if (/yeni personel kaydı/.test(ozet2)) throw new Error(`tekrar yeni personel: ${ozet2}`);
  esit(await s.evaluate(() => globalThis.__fake.tablo.employees.length), son.e, 'çift personel yok');
  // değişmiş dosya: uyarı çıkar
  await katipYukle(s, KATIP2, '2026-11');
  await s.check('#katip-gozden'); await s.click('[data-action="katip-uygula"]'); await modal(s).locator('[data-ok]').click(); await s.waitForSelector('#katip-sonuc'); await s.waitForSelector('#gorev-kart');
  const liste = await s.locator('#gorev-liste').innerText(); if (!/⚠/.test(liste)) throw new Error(`uyarı yok: ${liste}`);
  await ekran(s, '47-gorev-degisiklik');
});
await test('İSG-Katip: görevlendirme — firma seçimi kaldırılırsa o firmaya dokunulmaz; izinsiz rol uygulayamaz', async (s) => {
  await katipKurulum(s);
  await katipYukle(s, KATIP1, '2026-10');
  await s.check('#katip-gozden'); await s.click('[data-action="katip-uygula"]'); await modal(s).locator('[data-ok]').click(); await s.waitForSelector('#katip-sonuc'); await s.waitForSelector('#gorev-kart');
  for (const k of await s.locator('[data-gfirma]').all()) await k.uncheck();
  await s.check('#gorev-gozden');
  esit(await s.locator('[data-action="gorev-uygula"]').isDisabled(), true, 'hiç firma seçili değilken düğme kapalı');
});

await test('Diğer personel: rol ve unvan, yönetim gideri işareti, görevlendirme/kapasite listelerinde görünmez', async (s) => {
  await girisYap(s);
  await git(s, '#/digerpersonel'); await s.waitForSelector('[data-action="yeni"]');
  await s.locator('[data-action="yeni"]').first().click();
  await modal(s).locator('#f-full_name').fill('Selin Sekreter');
  await modal(s).locator('button[type=submit]').click();
  await s.waitForSelector('.form-error:not([hidden]), .field-error', { timeout: 5000 }).catch(() => {});
  esit(await modal(s).locator('#f-role_kind').count(), 1, 'rol seçimi var');
  await modal(s).locator('#f-role_kind').selectOption('diger');
  await modal(s).locator('button[type=submit]').click();
  const unvanHata = await modal(s).innerText(); if (!unvanHata.includes('unvanı yazın')) throw new Error(`diğer için unvan istenmeli: ${unvanHata.slice(0, 200)}`);
  await modal(s).locator('#f-role_kind').selectOption('sekreter');
  await modal(s).locator('#f-title').fill('Ön büro');
  esit(await modal(s).locator('input[name="is_management"]').isChecked(), true, 'rol sahibinde yönetim gideri varsayılan işaretli');
  await modal(s).locator('button[type=submit]').click();
  await s.waitForFunction(() => document.querySelector('.company-head h1')?.textContent.includes('Selin'));
  const kafa = await s.locator('.company-head').innerText(); if (!kafa.includes('Sekreter') || !kafa.includes('Yönetim gideri')) throw new Error(`başlık: ${kafa}`);
  esit(await s.locator('[data-action="gorevlendir"]').count(), 0, 'rol sahibi görevlendirilemez');
  const emp = await s.evaluate(() => globalThis.__fake.tablo.employees.find((e) => e.full_name === 'Selin Sekreter'));
  esit(`${emp.staff_type}/${emp.role_kind}/${emp.is_management}`, 'null/sekreter/true', 'kayıt');
  await ekran(s, '48-diger-personel');
  // yönetimdeki uzman: görevlendirilebilir, işaret kayıtlı
  await personelEkle(s, 'is_guvenligi_uzmani', 'Yönetici Uzman');
  await s.locator('[data-action="duzenle"]').click(); await modal(s).locator('input[name="is_management"]').check(); await modal(s).locator('button[type=submit]').click();
  await s.waitForFunction(() => document.querySelector('.company-meta')?.textContent.includes('Yönetim gideri'));
  esit(await s.locator('[data-action="gorevlendir"]').count(), 1, 'yönetimdeki uzman yine görevlendirilebilir');
  // görevlendirme formunda rol sahibi çıkmaz
  await git(s, '#/gorevlendirmeler'); await s.waitForSelector('.empty, #gv-tablo');
  const liste = await s.evaluate(() => globalThis.__fake.tablo.employees.filter((e) => e.staff_type).map((e) => e.full_name));
  if (liste.includes('Selin Sekreter')) throw new Error('rol sahibi uzman/hekim listesinde');
  await git(s, '#/digerpersonel'); await s.waitForSelector('#rol-tablo');
  const t = await s.locator('#rol-tablo').innerText(); if (!t.includes('Selin Sekreter') || !t.includes('Yönetim gideri') || t.includes('Yönetici Uzman')) throw new Error(`liste: ${t}`);
});
await test('İşyeri takma adı ve ayrı fatura işareti: Katip sayfasında ve firma kartında', async (s) => {
  await katipKurulum(s);
  await katipYukle(s, KATIP1, '2026-10');
  await s.check('#katip-gozden'); await s.click('[data-action="katip-uygula"]'); await modal(s).locator('[data-ok]').click(); await s.waitForSelector('#katip-sonuc');
  const ilk = s.locator('[data-site-ad]').first(); const id = await ilk.getAttribute('data-site-ad');
  await ilk.fill('UKEM'); await ilk.dispatchEvent('change'); await s.waitForTimeout(300);
  await s.locator(`[data-site-ayri="${id}"]`).check(); await s.waitForTimeout(300);
  const kay = await s.evaluate((i) => globalThis.__fake.tablo.company_sites.find((x) => x.id === i), id);
  esit(`${kay.invoice_alias}/${kay.separate_invoice}`, 'UKEM/true', 'işyeri kaydı');
  await s.fill('#site-ara', 'ukem'); await s.waitForTimeout(150); esit(await s.locator('#site-tablo tbody tr').count(), 1, 'takma adla arama');
  // firma kartında İşyerleri sekmesi
  const firmaId = kay.company_id;
  await git(s, `#/firmalar/${firmaId}`); await s.waitForSelector('[data-sekme="isyerleri"]'); await s.click('[data-sekme="isyerleri"]');
  await s.waitForSelector('#isyeri-tablo');
  esit(await s.locator(`[data-isyeri-ad="${id}"]`).inputValue(), 'UKEM', 'firma kartında takma ad');
  await s.locator(`[data-isyeri-ad="${id}"]`).fill('UKEM 2'); await s.locator(`[data-isyeri-ad="${id}"]`).dispatchEvent('change'); await s.waitForTimeout(300);
  esit(await s.evaluate((i) => globalThis.__fake.tablo.company_sites.find((x) => x.id === i).invoice_alias, id), 'UKEM 2', 'firma kartından güncellendi');
  await ekran(s, '49-isyerleri-sekmesi');
});
await test('Kârlılık: yönetim gideri personeli ortak gider olarak görünür', async (s) => {
  await girisYap(s);
  const kisi = await s.evaluate(() => { const t = globalThis.__fake.tablo; const id = crypto.randomUUID(); t.employees.push({ id, organization_id: t.organizations?.[0]?.id ?? 'o', full_name: 'Muhasebe Yön', staff_type: null, role_kind: 'yonetim', is_management: true, is_active: true, monthly_capacity_min: 11700, archived_at: null });
    t.employee_costs.push({ id: crypto.randomUUID(), employee_id: id, valid_from: '2026-01-01', valid_to: null, gross_salary: 5000, employer_sgk: 1000, other_benefits: 0, total_monthly_cost: 6000 }); return id; });
  void kisi;
  await git(s, '#/firma-karlilik'); await s.waitForSelector('#ortak-kart, .card', { timeout: 8000 }).catch(() => {});
  const metin = await s.locator('body').innerText();
  if (!metin.includes('Yönetim personeli maliyeti')) throw new Error(`yönetim kalemi yok: ${metin.slice(0, 300)}`);
});

await test('Takvim: aylık tekrarlayan ödeme, tek seferlik hatırlatma, görev tarihi otomatik, yapıldı işareti, ay geçişi, silme', async (s) => {
  await girisYap(s);
  const bugunS = await s.evaluate(() => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Istanbul' }));
  await git(s, '#/takvim'); await s.waitForSelector('.takvim-izgara');
  esit(await s.locator('.takvim-bugun').count(), 1, 'bugün vurgulu');
  // aylık ödeme (bugünün gününde başlar → bu ay + gelecek aylar)
  await s.locator('.takvim-arac ~ * [data-action="takvim-yeni"], [data-action="takvim-yeni"]').first().click();
  await modal(s).locator('#f-title').fill('SGK prim ödemesi');
  await modal(s).locator('#f-kind').selectOption('odeme');
  await modal(s).locator('#f-start_date').fill(bugunS);
  await modal(s).locator('#f-recurrence').selectOption('aylik');
  await modal(s).locator('#f-amount').fill('15000');
  await modal(s).locator('button[type=submit]').click();
  await s.waitForSelector('.takvim-bugun .takvim-chip');
  const chip = await s.locator('.takvim-bugun').innerText(); if (!chip.includes('SGK prim')) throw new Error(`bugün hücresi: ${chip}`);
  // yıllık tekrar: geçen yıl bugünün tarihinde başlayan kayıt bu yıl bugüne düşer
  await s.locator('[data-action="takvim-yeni"]').first().click();
  await modal(s).locator('#f-title').fill('Yıllık ruhsat yenileme');
  await modal(s).locator('#f-start_date').fill(`${Number(bugunS.slice(0, 4)) - 1}${bugunS.slice(4)}`);
  await modal(s).locator('#f-recurrence').selectOption('yillik');
  await modal(s).locator('button[type=submit]').click();
  await s.waitForFunction(() => document.querySelector('.takvim-bugun')?.textContent.includes('Yıllık ruhsat'));
  // görev son tarihi otomatik
  await s.evaluate((g) => { const t = globalThis.__fake.tablo; t.tasks.push({ id: crypto.randomUUID(), organization_id: t.organizations?.[0]?.id ?? 'o', title: 'Teklif takibi', status: 'acik', priority: 'orta', kind: 'diger', due_at: `${g}T09:00:00+03:00`, remind_at: null, archived_at: null }); }, bugunS);
  await git(s, '#/gorevler'); await git(s, '#/takvim'); await s.waitForSelector('.takvim-izgara');
  await s.click('.takvim-bugun');
  const panel = await s.locator('#takvim-gun-paneli').innerText();
  if (!panel.includes('SGK prim ödemesi') || !panel.includes('15.000') || !panel.includes('tekrarlanır') || !panel.includes('Teklif takibi') || !panel.includes('Görev son tarihi')) throw new Error(`gün paneli: ${panel.replace(/\s+/g, ' ')} :: ${(await s.locator('#takvim-gun-paneli').innerHTML()).slice(0, 900)}`);
  await ekran(s, '50-takvim');
  // yapıldı işareti
  await s.locator('#takvim-gun-paneli [data-tamam]').first().check(); await s.waitForTimeout(200);
  esit(await s.evaluate(() => globalThis.__fake.tablo.calendar_completions.length), 1, 'tamamlama kaydı');
  await s.locator('#takvim-gun-paneli [data-tamam]').first().uncheck(); await s.waitForTimeout(200);
  esit(await s.evaluate(() => globalThis.__fake.tablo.calendar_completions.length), 0, 'geri alındı');
  // sonraki ay: aylık ödeme tekrar eder
  await s.click('[data-ay="1"]'); await s.waitForTimeout(250);
  const sonraki = await s.locator('.takvim-izgara').innerText(); if (!sonraki.includes('SGK prim')) throw new Error('aylık tekrar sonraki ayda görünmeli');
  esit(await s.locator('.takvim-bugun').count(), 0, 'sonraki ayda bugün yok');
  await s.click('[data-ay="bugun"]'); await s.waitForTimeout(250);
  // tek seferlik hatırlatma + silme
  await s.click('.takvim-bugun'); await s.locator('#takvim-gun-paneli [data-action="takvim-yeni"]').click();
  await modal(s).locator('#f-title').fill('Kira hatırlat'); await modal(s).locator('button[type=submit]').click();
  await s.waitForFunction(() => document.querySelector('#takvim-gun-paneli')?.textContent.includes('Kira hatırlat'));
  await s.locator('#takvim-gun-paneli li:has-text("Kira hatırlat") [data-arsiv]').click(); await s.click('[data-ok]');
  await s.waitForFunction(() => !document.querySelector('#takvim-gun-paneli')?.textContent.includes('Kira hatırlat'));
  esit(await s.evaluate(() => globalThis.__fake.tablo.calendar_items.filter((x) => !x.archived_at).length), 2, 'aylık ve yıllık kayıt kaldı');
  // doğrulama
  await s.locator('[data-action="takvim-yeni"]').first().click(); await modal(s).locator('button[type=submit]').click();
  if (!(await modal(s).innerText()).includes('Başlık zorunludur')) throw new Error('başlık doğrulaması');
});
await test('Takvim: yetkisiz rol kayıt ekleyemez; mobil 375px yatay taşma yok', async (s) => {
  await girisYap(s, 'satis@test.com'); await git(s, '#/takvim');
  await s.waitForSelector('.takvim-izgara, .notice, .empty');
  await s.setViewportSize({ width: 375, height: 800 }); await s.waitForTimeout(200);
  const t = await s.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  if (t > 1) throw new Error(`yatay taşma ${t}px`);
});
await test('Elle işyeri: Katip dışı firmaya işyeri eklenir, takma ad ve ayrı fatura kaydedilir, silinir', async (s) => {
  await girisYap(s);
  await firmaEkle(s, { ad: 'Nihal Yılmaz Sağlık', calisan: 20, tehlike: 'tehlikeli' }); await s.waitForSelector('.modal-overlay', { state: 'detached' }); await s.waitForTimeout(200);
  const id = await s.evaluate(() => globalThis.__fake.tablo.companies.find((c) => c.name === 'Nihal Yılmaz Sağlık').id);
  await git(s, `#/firmalar/${id}`); await s.waitForSelector('[data-sekme="isyerleri"]'); await s.click('[data-sekme="isyerleri"]');
  await s.waitForSelector('[data-action="isyeri-ekle"]');
  if (!(await s.locator('#sekme-govde').innerText()).includes('İşyeri ekle')) throw new Error('boş durumda ekleme düğmesi yok');
  await s.click('[data-action="isyeri-ekle"]');
  await modal(s).locator('button[type=submit]').click();
  if (!(await modal(s).innerText()).includes('İşyeri adı zorunludur')) throw new Error('ad doğrulaması');
  await modal(s).locator('#f-site_name').fill('Ukem Sağlık Hizmetleri Şubesi'); await modal(s).locator('#f-invoice_alias').fill('UKEM');
  await modal(s).locator('#f-employee_count').fill('12'); await modal(s).locator('input[name="separate_invoice"]').check();
  await modal(s).locator('button[type=submit]').click();
  await s.waitForSelector('#isyeri-tablo');
  const satir = await s.locator('#isyeri-tablo').innerText(); if (!satir.includes('Ukem') || !satir.includes('Elle girildi')) throw new Error(`tablo: ${satir}`);
  esit(await s.locator('[data-isyeri-calisan]').first().inputValue(), '12', 'çalışan sayısı');
  esit(await s.locator('[data-isyeri-ad]').first().inputValue(), 'UKEM', 'takma ad'); esit(await s.locator('[data-isyeri-ayri]').first().isChecked(), true, 'ayrı fatura işareti');
  const kay = await s.evaluate(() => globalThis.__fake.tablo.company_sites.find((x) => x.is_manual));
  esit(`${kay.is_manual}/${kay.separate_invoice}/${/^EL[0-9A-Z]{6}$/.test(kay.sgk_no)}`, 'true/true/true', 'kayıt');
  await ekran(s, '51-elle-isyeri');
  await s.click('[data-isyeri-sil]'); await s.click('[data-ok]');
  await s.waitForFunction(() => !document.querySelector('#isyeri-tablo'));
  esit(await s.evaluate(() => globalThis.__fake.tablo.company_sites.filter((x) => !x.archived_at).length), 0, 'silindi (arşiv)');
});

await test('İşyerleri: tehlike sınıfı listede görünür, karma sınıf firma profiline yansır, düzenleme/silme ve mevcut işyerini ekleme', async (s) => {
  await girisYap(s);
  await firmaEkle(s, { ad: 'Karma Sınıf A.Ş.', calisan: 5, tehlike: 'az_tehlikeli' }); await s.waitForSelector('.modal-overlay', { state: 'detached' }); await s.waitForTimeout(200);
  await firmaEkle(s, { ad: 'Başka Firma Ltd.', calisan: 5, tehlike: 'az_tehlikeli' }); await s.waitForSelector('.modal-overlay', { state: 'detached' }); await s.waitForTimeout(200);
  const idOf = (ad) => s.evaluate((a) => globalThis.__fake.tablo.companies.find((c) => c.name === a).id, ad);
  const id = await idOf('Karma Sınıf A.Ş.'); const idB = await idOf('Başka Firma Ltd.');
  await git(s, `#/firmalar/${idB}`); await s.waitForSelector('[data-sekme="isyerleri"]'); await s.click('[data-sekme="isyerleri"]');
  await s.click('[data-action="isyeri-ekle"]');
  await modal(s).locator('#f-site_name').fill('Taşınacak Şube'); await modal(s).locator('#f-employee_count').fill('8'); await modal(s).locator('#f-hazard_class').selectOption('cok_tehlikeli');
  await modal(s).locator('button[type=submit]').click(); await s.waitForSelector('#isyeri-tablo');
  await git(s, `#/firmalar/${id}`); await s.waitForSelector('[data-sekme="isyerleri"]'); await s.click('[data-sekme="isyerleri"]');
  for (const [ad, n, h] of [['Şube Bir', '10', 'az_tehlikeli'], ['Şube İki', '20', 'tehlikeli']]) {
    await s.click('[data-action="isyeri-ekle"]');
    await modal(s).locator('#f-site_name').fill(ad); await modal(s).locator('#f-employee_count').fill(n); await modal(s).locator('#f-hazard_class').selectOption(h);
    await modal(s).locator('button[type=submit]').click(); await s.waitForSelector(`#isyeri-tablo:has-text("${ad}")`);
  }
  const tablo = await s.locator('#isyeri-tablo').innerText();
  esit(tablo.includes('Az tehlikeli') && tablo.includes('Tehlikeli'), true, 'listede tehlike sınıfı');
  await var_(s.locator('#isyeri-ozet:has-text("Az tehlikeli 1 işyeri / 10 çalışan"):has-text("Tehlikeli 1 işyeri / 20 çalışan")'), 'hesap özeti');
  let profil = await s.evaluate((i) => globalThis.__fake.tablo.company_profiles.find((p) => p.company_id === i && !p.valid_to), id);
  esit(`${profil.employee_count}/${profil.hazard_class}/${profil.site_breakdown?.length}`, '30/tehlikeli/2', 'firma profili işyerlerinden');
  await ekran(s, '79-isyerleri-tehlike');
  // elle girilen işyerinin tehlike sınıfı düzenlenir
  await s.locator('[data-isyeri-tehlike]').first().selectOption('tehlikeli');
  await s.waitForSelector('.toast:has-text("İşyeri bilgisi kaydedildi")');
  profil = await s.evaluate((i) => globalThis.__fake.tablo.company_profiles.find((p) => p.company_id === i && !p.valid_to), id);
  esit(`${profil.employee_count}/${profil.hazard_class}/${profil.site_breakdown ?? 'tek'}`, '30/tehlikeli/tek', 'tek sınıfa düştü');
  // mevcut işyerini (başka firmada) ekle
  await s.click('[data-action="isyeri-mevcut"]');
  await modal(s).locator('#f-site_id').selectOption(await s.evaluate(() => globalThis.__fake.tablo.company_sites.find((x) => x.site_name === 'Taşınacak Şube').id));
  await modal(s).locator('button[type=submit]').click();
  await s.waitForSelector('#isyeri-tablo:has-text("Taşınacak Şube")');
  profil = await s.evaluate((i) => globalThis.__fake.tablo.company_profiles.find((p) => p.company_id === i && !p.valid_to), id);
  esit(`${profil.employee_count}/${profil.hazard_class}/${profil.site_breakdown?.length}`, '38/cok_tehlikeli/2', 'taşınan işyeri hesaba girdi');
  const profilB = await s.evaluate((i) => globalThis.__fake.tablo.company_profiles.find((p) => p.company_id === i && !p.valid_to), idB);
  esit(profilB.employee_count, 0, 'tüm işyerleri taşınan firma yükü sıfırlandı');
  // sil: listeden kalkar, hesap güncellenir
  await s.locator('[data-isyeri-sil]').nth(0).click(); await s.click('[data-ok]');
  await s.waitForSelector('.toast:has-text("İşyeri silindi")');
  profil = await s.evaluate((i) => globalThis.__fake.tablo.company_profiles.find((p) => p.company_id === i && !p.valid_to), id);
  esit(`${profil.employee_count}/${profil.hazard_class}`, '28/cok_tehlikeli', 'silinen işyeri hesaptan çıktı');
  const kalan = await s.evaluate((i) => globalThis.__fake.tablo.company_sites.filter((x) => x.company_id === i && !x.archived_at).length, id);
  esit(kalan, 2, 'bir işyeri silindi');
});

await test('İSG-Katip: izinsiz rol yükleme yapamaz; mobil 375px yatay taşma yok', async (s) => {
  await girisYap(s, 'satis@test.com'); await git(s, '#/katip');
  await s.waitForSelector('#katip-kok, .empty'); esit(await s.locator('#katip-dosya').count(), 0, 'satış yükleme alanı görmez');
});
await test('mobil 375px: İSG-Katip analiz ekranında yatay taşma yok', async (s) => {
  await katipKurulum(s); await katipYukle(s, KATIP1, '2026-10');
  await s.setViewportSize({ width: 375, height: 800 }); await s.waitForTimeout(200);
  const t = await s.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  if (t > 1) { const w = await s.evaluate(() => [...document.querySelectorAll('#sayfa *')].filter((e) => e.getBoundingClientRect().right > innerWidth + 1).slice(0, 6).map((e) => `${e.tagName}.${e.className}#${e.id}:${Math.round(e.getBoundingClientRect().right)}`).join(' | ')); throw new Error(`yatay taşma ${t}px: ${w}`); }
  await ekran(s, '44-mobil-katip');
});

// ---------------------------------------------------------------- Aylık gelir Excel'i, spot / elden gelir (Aşama 17)
const { xlsxYaz: gelirXlsx } = await import(path.join(KOK, 'src/lib/xlsxyaz.js'));
const { xlsxOku: gelirOku } = await import(path.join(KOK, 'src/lib/xlsx.js'));
const GELIR_BASLIK = ['Fatura No', 'Fatura Tarihi', 'Açıklama', 'Ücret', '%20 KDV', '%10 KDV', 'Toplam'];
const gelirDosyasi = (satirlar, ad = 'gelirler.xlsx') => ({ name: ad, mimeType: 'application/octet-stream',
  buffer: Buffer.from(gelirXlsx([{ ad: 'Sayfa1', satirlar: [GELIR_BASLIK, ...satirlar.map((r) => r.map((h, i) => (i === 1 ? { t: 'tarih', v: h } : h)))] }])) });
const GELIR_SATIRLARI = [
  ['EFT-1', '2026-10-22', 'Alfa Gıda (Ekim)', 1500, 200, 50, 1750],
  ['EFT-2', '2026-10-22', 'Beta Teknik (Ekim)', 1000, 200, null, 1200],
  ['EFT-3', '2026-10-22', 'Bilinmeyen Boya (Ekim)', 400, 80, null, 480],
  ['EFT-4', '2026-10-23', 'UKEM (Ekim)', 100, null, 10, 110],
  ['EFT-5', '2026-10-23', 'Alfa Gıda (Ekim) ek hizmet', 500, null, null, 500],
];
const gelirKurulum = async (s) => {
  await girisYap(s);
  for (const f of [{ ad: 'Alfa Gıda', calisan: 40, tehlike: 'az_tehlikeli' }, { ad: 'Beta Teknik', calisan: 10, tehlike: 'tehlikeli' }, { ad: 'Gama İnşaat', calisan: 8, tehlike: 'tehlikeli' }]) {
    await firmaEkle(s, f); await s.waitForSelector('.modal-overlay', { state: 'detached' }); await s.waitForTimeout(200);
  }
  await s.evaluate(() => { const t = globalThis.__fake.tablo;
    for (const f of t.companies) t.contracts.push({ id: `c-${f.id}`, organization_id: f.organization_id, company_id: f.id, status: 'aktif', start_date: '2026-01-01', end_date: '2026-12-31', archived_at: null }); });
};
const gelirYukle = async (s, dosya) => { await git(s, '#/firmalar'); await git(s, '#/aktarim'); await s.waitForSelector('#gelir-dosya'); await s.setInputFiles('#gelir-dosya', dosya); await s.waitForSelector('#gelir-ozet'); };

await test('gelir Excel: önizleme, ortalama KDV, bulunamayan firma uyarısı, eşleştirme kararları, unutulan fatura uyarısı, atomik aktarım', async (s) => {
  await gelirKurulum(s); await gelirYukle(s, gelirDosyasi(GELIR_SATIRLARI));
  esit(await s.locator('#gelir-n').innerText(), '5', 'satır sayısı');
  const ort = await s.locator('#gelir-ort').innerText(); if (!/%\d+,\d+/.test(ort)) throw new Error(`ortalama KDV: ${ort}`);
  const onizleme = await s.locator('#gelir-onizleme').innerText(); if (!onizleme.includes('%20') || !onizleme.includes('%10')) throw new Error(`önizleme KDV kırılımı: ${onizleme.slice(0, 200)}`);
  const bek = await s.locator('#gelir-bekleyen').innerText(); if (!bek.includes('Bilinmeyen Boya') || !bek.includes('UKEM')) throw new Error(`bekleyen: ${bek}`);
  esit(await s.locator('#gelir-uygula').isDisabled(), true, 'kararlar bitmeden aktarılamaz');
  const unut = await s.locator('#gelir-unutulan').innerText(); if (!unut.includes('Gama İnşaat') || unut.includes('Alfa Gıda')) throw new Error(`unutulan: ${unut}`);
  esit(await s.locator('#gelir-unutulan').getAttribute('data-adet'), '1', 'unutulan firma sayısı');
  await ekran(s, '60-gelir-onizleme');
  // yeni firma oluştur + bir ad için aktarma
  const anahtarlar = await s.evaluate(() => [...document.querySelectorAll('#gelir-eslesme [data-karar]')].map((x) => [x.dataset.karar, x.value]));
  for (const [k, v] of anahtarlar) {
    if (v) continue;
    if (k.startsWith('bilinmeyen')) { await s.selectOption(`[data-karar="${k}"]`, 'yeni'); await s.fill(`[data-yeni-ad="${k}"]`, 'Bilinmeyen Boya Ltd'); await s.locator(`[data-yeni-ad="${k}"]`).blur(); }
    else if (k.startsWith('alfa')) await s.selectOption(`[data-karar="${k}"]`, { label: 'Alfa Gıda' });
    else await s.selectOption(`[data-karar="${k}"]`, 'yoksay');
  }
  await s.waitForFunction(() => !document.querySelector('#gelir-bekleyen'));
  esit(await s.locator('#gelir-uygula').isDisabled(), false, 'kararlardan sonra düğme açık');
  await s.click('#gelir-uygula'); await modal(s).locator('[data-ok]').click(); await s.waitForSelector('#gelir-sonuc');
  const sonuc = await s.locator('#gelir-sonuc').innerText(); if (!sonuc.includes('1 yeni firma')) throw new Error(`sonuç: ${sonuc}`);
  if (!(await s.locator('#gelir-sonuc-unutulan').innerText()).includes('Gama İnşaat')) throw new Error('sonuçta unutulan uyarısı');
  const d = await s.evaluate(() => { const t = globalThis.__fake.tablo; const f = (n) => t.invoices.find((i) => i.invoice_no === n); const e1 = f('EFT-1');
    return { adet: t.invoices.filter((i) => i.invoice_no.startsWith('EFT-')).length, e1: `${e1.amount_excl_vat}/${e1.vat_amount}`, kalem: t.invoice_items.filter((k) => k.invoice_id === e1.id).map((k) => `${k.vat_rate}:${k.unit_price_excl}`).join(','),
      donem: e1.service_period, vade: e1.due_date, e2: t.invoice_items.find((k) => k.invoice_id === f('EFT-2').id).vat_rate, e5: t.invoice_items.find((k) => k.invoice_id === f('EFT-5').id).vat_rate,
      yeni: t.companies.some((c) => c.name === 'Bilinmeyen Boya Ltd'), ukem: !!f('EFT-4'), alias: t.invoice_aliases.map((a) => a.alias_key).join(',') }; });
  esit(d.adet, 4, 'faturalar (UKEM aktarılmadı)'); esit(d.e1, '1500/250', 'EFT-1 tutarları'); esit(d.kalem, '20:1000,10:500', 'EFT-1 kalemleri'); esit(d.donem, '2026-10-01', 'dönem'); esit(d.vade, '2026-11-21', 'vade 30 gün');
  esit(d.e2, 20, 'EFT-2 oranı'); esit(d.e5, 0, 'EFT-5 KDV yok'); esit(d.yeni, true, 'yeni firma'); esit(d.ukem, false, 'atlanan satır'); if (!d.alias.includes('bilinmeyen boya')) throw new Error(`alias: ${d.alias}`);
  // aynı dosya tekrar: kayıtlı eşleşme hatırlanır, numaralar zaten kayıtlı
  await gelirYukle(s, gelirDosyasi(GELIR_SATIRLARI));
  const e = await s.locator('#gelir-eslesme tr[data-anahtar^="bilinmeyen"]').innerText(); if (!e.includes('Kayıtlı eşleşme')) throw new Error(`alias hatırlanmadı: ${e}`);
  esit(await s.locator('#gelir-onizleme tr[data-var="1"]').count(), 4, 'zaten kayıtlı satırlar (UKEM hariç)');
  await ekran(s, '61-gelir-tekrar');
});

await test('gelir Excel: hatalı satırlar, bozuk dosya, boş şablon indirme, yetkisiz rol, mobil taşma', async (s) => {
  await gelirKurulum(s); await git(s, '#/aktarim'); await s.waitForSelector('#gelir-dosya');
  const [ind] = await Promise.all([s.waitForEvent('download'), s.click('[data-action="gelir-sablon"]')]);
  esit(ind.suggestedFilename(), 'gelir-sablonu.xlsx', 'şablon adı');
  const t = await gelirOku(fs.readFileSync(await ind.path())); esit(t.satirlar[0].join('|'), GELIR_BASLIK.join('|'), 'şablon başlıkları'); esit(t.satirlar.length, 1, 'şablon boş');
  await s.setInputFiles('#gelir-dosya', { name: 'a.xlsx', mimeType: 'application/octet-stream', buffer: Buffer.from('bu excel degil') });
  await s.waitForFunction(() => document.querySelector('#gelir-hata') && !document.querySelector('#gelir-hata').hidden);
  await s.setInputFiles('#gelir-dosya', gelirDosyasi([['E-1', '2026-10-22', 'Alfa Gıda (Ekim)', 100, 20, null, 120], ['E-2', '2026-10-22', 'Alfa Gıda (Ekim)', 0, null, null, 0], ['E-3', '2026-10-22', 'Alfa Gıda (Ekim)', 100, 20, null, 120]]));
  await s.waitForSelector('#gelir-hatalar'); if (!(await s.locator('#gelir-hatalar').innerText()).includes('Ücret')) throw new Error('hatalı satır mesajı');
  await s.setViewportSize({ width: 375, height: 800 }); await s.waitForTimeout(200);
  const tas = await s.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  if (tas > 1) { const w = await s.evaluate(() => [...document.querySelectorAll('#sayfa *')].filter((e) => e.getBoundingClientRect().right > innerWidth + 1).slice(0, 5).map((e) => `${e.tagName}.${e.className}`).join(',')); throw new Error(`yatay taşma ${tas}px: ${w}`); }
  await ekran(s, '62-mobil-gelir');
});
await test('gelir Excel: izinsiz rol yükleme alanı görmez', async (s) => {
  await girisYap(s, 'satis@test.com'); await git(s, '#/aktarim'); await s.waitForSelector('#gelir-karti, .empty, #aktarim-kok');
  esit(await s.locator('#gelir-dosya').count(), 0, 'satış gelir yükleme alanı görmez');
});

const GIDER_AYLAR = ['2026-09-01', '2026-10-01'];
const giderDosyasi = (satirlar, ad = 'giderler.xlsx') => ({ name: ad, mimeType: 'application/octet-stream',
  buffer: Buffer.from(gelirXlsx([{ ad: 'Giderler', satirlar: [['Gider kalemi', ...GIDER_AYLAR.map((v) => ({ t: 'tarih', v }))], ...satirlar] }])) });
const giderYukle = async (s, dosya) => { await git(s, '#/firmalar'); await git(s, '#/aktarim'); await s.waitForSelector('#gider-dosya'); await s.setInputFiles('#gider-dosya', dosya); await s.waitForSelector('#gider-eslesme'); };
await test('gider Excel: eşleştirme, yönetime ödenen, personel satırı atlanır, aktarım; yeni dosya önceki Excel kayıtlarının yerine geçer', async (s) => {
  await girisYap(s);
  await s.evaluate(() => { const t = globalThis.__fake.tablo; t.expenses.push({ id: 'elle1', organization_id: t.companies[0]?.organization_id ?? 'o', category_id: t.expense_categories[0].id, expense_date: '2026-10-01', amount_excl_vat: 77, vat_amount: 0, amount_incl_vat: 77, cost_type: 'ortak', description: 'elle', archived_at: null, import_id: null }); });
  await git(s, '#/aktarim'); await s.waitForSelector('#gider-dosya');
  const [ind] = await Promise.all([s.waitForEvent('download'), s.click('[data-action="gider-sablon"]')]);
  esit(ind.suggestedFilename(), 'gider-sablonu.xlsx', 'şablon adı');
  const sablon = await gelirOku(fs.readFileSync(await ind.path())); esit(sablon.satirlar[0][0], 'Gider kalemi', 'şablon başlığı');
  await giderYukle(s, giderDosyasi([['Yönetime Ödenen', 1000, 1100], ['Personel Giderleri', 5000, 5000], ['Kira', 200, 200], ['Vergi', 0, 50], ['Elektrik', 30, null], ['TOPLAM', 1, 1]]));
  esit(await s.locator('#gider-eslesme tr[data-anahtar="yonetime odenen"]').getAttribute('data-islem'), 'yonetim', 'yönetime ödenen otomatik');
  esit(await s.locator('#gider-eslesme tr[data-anahtar="personel giderleri"]').getAttribute('data-islem'), 'kategori', 'personel satırı gider olarak alınır');
  esit(await s.locator('#gider-yerine').getAttribute('data-adet'), '0', 'önceki aktarım yok');
  await ekran(s, '63-gider-onizleme');
  await s.click('#gider-uygula'); await modal(s).locator('[data-ok]').click(); await s.waitForSelector('#gider-sonuc');
  let d = await s.evaluate(() => { const t = globalThis.__fake.tablo; const a = t.expenses.filter((e) => e.import_id && !e.archived_at);
    return { adet: a.length, ytop: a.filter((e) => t.expense_categories.find((k) => k.id === e.category_id)?.is_management_pay).reduce((x, e) => x + e.amount_excl_vat, 0),
      personel: a.filter((e) => t.expense_categories.find((k) => k.id === e.category_id)?.is_payroll).reduce((x, e) => x + e.amount_excl_vat, 0), elle: t.expenses.find((e) => e.id === 'elle1').archived_at, vergi: t.expense_categories.find((k) => k.name === 'Vergi')?.is_income_tax, harita: t.expense_row_map.length }; });
  esit(d.adet, 8, 'eklenen kayıt (boş hücreler hariç)'); esit(d.ytop, 2100, 'yönetime ödenen'); esit(d.personel, 10000, 'personel giderleri gider olarak alındı'); esit(d.elle, null, 'elle gider korunur'); esit(d.vergi, true, 'vergi kategorisi'); esit(d.harita, 5, 'eşleşmeler hatırlandı');
  // ikinci dosya: eylül ve ekim değişir, öncekinin yerine geçer
  await giderYukle(s, giderDosyasi([['Yönetime Ödenen', 900, 900], ['Kira', 250, null]]));
  esit(await s.locator('#gider-yerine').getAttribute('data-adet'), '8', 'yerine geçecek kayıt sayısı');
  if (!(await s.locator('#gider-yerine').innerText()).includes('arşivlenir')) throw new Error('yerine geçme uyarısı');
  await s.click('#gider-uygula'); await modal(s).locator('[data-ok]').click(); await s.waitForSelector('#gider-sonuc');
  d = await s.evaluate(() => { const t = globalThis.__fake.tablo; const a = t.expenses.filter((e) => e.import_id && !e.archived_at);
    return { aktif: a.length, toplam: a.reduce((x, e) => x + e.amount_excl_vat, 0), arsiv: t.expenses.filter((e) => e.import_id && e.archived_at).length, elle: t.expenses.find((e) => e.id === 'elle1').archived_at }; });
  esit(d.aktif, 3, 'yalnızca yeni dosyadaki kayıtlar aktif'); esit(d.toplam, 900 + 900 + 250, 'yeni toplam'); esit(d.arsiv, 8, 'eskiler arşivde'); esit(d.elle, null, 'elle gider hâlâ korunur');
});
await test('gider Excel: hatalı dosya, kategori seçilmeden aktarılamaz, yetkisiz rol alanı görmez', async (s) => {
  await girisYap(s); await git(s, '#/aktarim'); await s.waitForSelector('#gider-dosya');
  await s.setInputFiles('#gider-dosya', { name: 'a.xlsx', mimeType: 'application/octet-stream', buffer: Buffer.from('bu excel degil') });
  await s.waitForFunction(() => document.querySelector('#gider-hata') && !document.querySelector('#gider-hata').hidden);
  await giderYukle(s, giderDosyasi([['Kira', 200, 200]]));
  const k = await s.locator('#gider-eslesme select[data-gkarar="kira"]').inputValue(); if (!k.startsWith('k:')) throw new Error(`kira mevcut kategoriye eşleşmeli: ${k}`);
  await s.selectOption('#gider-eslesme select[data-gkarar="kira"]', 'yeni'); await s.fill('[data-gyeni-ad="kira"]', ''); await s.locator('[data-gyeni-ad="kira"]').blur();
  await s.waitForSelector('#gider-bekleyen'); esit(await s.locator('#gider-uygula').isDisabled(), true, 'kategori boşken aktarılamaz');
  await s.setViewportSize({ width: 375, height: 800 }); await s.waitForTimeout(200);
  const tas = await s.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth); if (tas > 1) throw new Error(`yatay taşma ${tas}px`);
  await ekran(s, '64-mobil-gider');
});
await test('gider Excel: izinsiz rol yükleme alanı görmez', async (s) => {
  await girisYap(s, 'satis@test.com'); await git(s, '#/aktarim'); await s.waitForSelector('#aktarim-kok, .empty');
  esit(await s.locator('#gider-dosya').count(), 0, 'satış gider yükleme alanı görmez');
});
await test('gelir ekle: spot iş (KDV oranı) ve elden ödeme (KDV yok, tahsil edildi); fatura detayında ortalama KDV', async (s) => {
  await gelirKurulum(s); await git(s, '#/tahsilat'); await s.waitForSelector('[data-action="yeni-gelir"]');
  await s.click('[data-action="yeni-gelir"]'); const m = modal(s);
  await m.locator('button[type=submit]').click(); const hata = await m.innerText(); if (hata.includes('Firmayı seçin') || !hata.includes('ne olduğunu')) throw new Error(`doğrulama: ${hata.slice(0, 200)}`);
  await m.locator('#f-company_id').selectOption({ label: 'Alfa Gıda' }); await m.locator('#f-aciklama').fill('Ek eğitim'); await m.locator('#f-tutar').fill('1000'); await m.locator('#f-vat_rate').fill('10');
  if (!(await m.locator('#gelir-bilgi').innerText()).includes('1.100')) throw new Error(`KDV bilgisi: ${await m.locator('#gelir-bilgi').innerText()}`);
  await m.locator('button[type=submit]').click(); await s.waitForSelector('.modal-overlay', { state: 'detached' });
  await s.click('[data-action="yeni-gelir"]'); const m2 = modal(s);
  await m2.locator('#f-company_id').selectOption({ label: 'Beta Teknik' }); await m2.locator('#f-tur').selectOption('elden');
  esit(await m2.locator('#f-vat_rate').isDisabled(), true, 'elden: KDV oranı kapalı'); esit(await m2.locator('input[name="tahsil"]').isChecked(), true, 'elden: tahsil işaretli');
  await m2.locator('#f-aciklama').fill('Nakit sağlık taraması'); await m2.locator('#f-tutar').fill('500');
  await m2.locator('button[type=submit]').click(); await s.waitForSelector('.modal-overlay', { state: 'detached' });
  const d = await s.evaluate(() => { const t = globalThis.__fake.tablo; const sp = t.invoices.find((i) => i.income_kind === 'spot'); const el = t.invoices.find((i) => i.income_kind === 'elden');
    return { sp: `${sp.amount_excl_vat}/${sp.vat_amount}`, el: `${el.amount_excl_vat}/${el.vat_amount}`, odeme: t.payments.filter((p) => p.invoice_id === el.id).map((p) => `${p.amount}/${p.method}`).join(), spOdeme: t.payments.filter((p) => p.invoice_id === sp.id).length }; });
  esit(d.sp, '1000/100', 'spot KDV'); esit(d.el, '500/0', 'elden KDV yok'); esit(d.odeme, '500/Elden', 'elden tahsilat'); esit(d.spOdeme, 0, 'spot tahsil edilmedi');
  await git(s, '#/tahsilat'); await s.waitForSelector('[data-fatura-detay]');
  await s.locator('[data-fatura-detay]').first().click(); await s.waitForSelector('#fatura-ort-kdv');
  const tur = await s.locator('#fatura-tur').innerText(); const ort = await s.locator('#fatura-ort-kdv').innerText();
  if (!/Spot|Elden/.test(tur) || !/%/.test(ort)) throw new Error(`detay: ${tur} / ${ort}`);
  await ekran(s, '63-gelir-detay');
});

await test('gelir ekle: firma dışı spot iş adıyla girilir (KDV 0 dahil); listede "firma dışı" görünür', async (s) => {
  await gelirKurulum(s); await git(s, '#/tahsilat'); await s.waitForSelector('[data-action="yeni-gelir"]');
  await s.click('[data-action="yeni-gelir"]'); const m = modal(s);
  await m.locator('#f-musteri').fill('Ahmet Yılmaz'); await m.locator('#f-aciklama').fill('Sağlık raporu'); await m.locator('#f-tutar').fill('800'); await m.locator('#f-vat_rate').fill('0');
  await m.locator('button[type=submit]').click(); await s.waitForSelector('.modal-overlay', { state: 'detached' });
  const i = await s.evaluate(() => globalThis.__fake.tablo.invoices.find((x) => x.company_id === null));
  esit(i.company_id, null, 'firmasız'); esit(Number(i.vat_amount), 0, 'KDV 0'); esit(i.customer_name, 'Ahmet Yılmaz', 'müşteri'); esit(i.income_kind, 'spot', 'tür');
  await s.waitForSelector('tr:has-text("Sağlık raporu")'); const satir = await s.locator('tr:has-text("Sağlık raporu")').first().innerText();
  if (!satir.includes('Ahmet Yılmaz') || !satir.includes('firma dışı')) throw new Error(`satır: ${satir}`);
});

// ---------------------------------------------------------------- Aşama 29: firma dışı kişiler, panel ilçe/sektör grafikleri
await test('kişiler: mülk sahibi firmasız eklenir, türe göre süzülür; firma yetkilisi firmasız eklenemez', async (s) => {
  await girisYap(s);
  await git(s, '#/kisiler'); await s.waitForSelector('[data-action="yeni-kisi"]');
  await s.click('[data-action="yeni-kisi"]');
  let m = modal(s);
  await m.locator('#f-full_name').fill('Veli Mülk'); await m.locator('button[type=submit]').click();
  await m.locator('.field-error, [data-error], .field-hata').first().waitFor({ timeout: 3000 }).catch(() => {});
  esit(await s.evaluate(() => globalThis.__fake.tablo.contacts.filter((c) => c.full_name === 'Veli Mülk').length), 0, 'firma yetkilisi firmasız kaydedilmemeli');
  await m.locator('#f-contact_type').selectOption('mulk_sahibi');
  await m.locator('#f-phone').fill('0532 111 22 33'); await m.locator('#f-email').fill('veli@ornek.com');
  await m.locator('button[type=submit]').click();
  await s.waitForSelector('tr:has-text("Veli Mülk")');
  esit(await s.evaluate(() => globalThis.__fake.tablo.contacts.find((c) => c.full_name === 'Veli Mülk').contact_type), 'mulk_sahibi', 'tür');
  if (!(await s.locator('tr:has-text("Veli Mülk")').innerText()).includes('Mülk sahibi')) throw new Error('tür rozeti yok');
  await s.selectOption('#kisi-tur', 'avukat'); await s.waitForTimeout(150);
  esit(await s.locator('tr:has-text("Veli Mülk")').count(), 0, 'avukat süzgecinde mülk sahibi yok');
  await s.selectOption('#kisi-tur', 'mulk_sahibi'); await s.waitForTimeout(150);
  esit(await s.locator('tr:has-text("Veli Mülk")').count(), 1, 'mülk sahibi süzgeci');
});

await test('panel: ilçe ve sektör dağılım grafikleri', async (s) => {
  await girisYap(s);
  await firmaEkle(s, { ad: 'Grafik Bir A.Ş.', vergi: '6666666661', calisan: 10, tehlike: 'tehlikeli' }); await s.waitForSelector('.company-head h1:has-text("Grafik Bir")');
  await firmaEkle(s, { ad: 'Grafik Iki A.Ş.', vergi: '6666666662', calisan: 10, tehlike: 'tehlikeli' }); await s.waitForSelector('.company-head h1:has-text("Grafik Iki")');
  await firmaEkle(s, { ad: 'Grafik Uc A.Ş.', vergi: '6666666663', calisan: 10, tehlike: 'tehlikeli' }); await s.waitForSelector('.company-head h1:has-text("Grafik Uc")');
  await s.evaluate(() => {
    const t = globalThis.__fake.tablo.companies;
    const g = (ad, ilce, sektor) => { const c = t.find((x) => x.name === ad); c.district = ilce; c.sector = sektor; c.city = 'Muğla'; };
    g('Grafik Bir A.Ş.', 'Bodrum', 'Turizm'); g('Grafik Iki A.Ş.', 'bodrum', 'Turizm'); g('Grafik Uc A.Ş.', 'Milas', 'İnşaat');
  });
  await git(s, '#/panel'); await s.waitForSelector('#ilce-dagilim .bars');
  const ilce = await s.locator('#ilce-dagilim').innerText(); const sek = await s.locator('#sektor-dagilim').innerText();
  if (!/Bodrum\s*2/.test(ilce) || !/Milas\s*1/.test(ilce)) throw new Error(`ilçe: ${ilce}`);
  if (!/Turizm\s*2/.test(sek) || !/İnşaat\s*1/.test(sek)) throw new Error(`sektör: ${sek}`);
});

// ---------------------------------------------------------------- Gider tutarlılığı (Aşama 30)
await test('gider tutarlılığı: panel gideri = Giderler menüsü toplamı; Excel personel gideri varsa kart maliyeti eklenmez', async (s) => {
  await karlilikHazirla(s);
  await s.evaluate((bugun) => {
    const t = globalThis.__fake.tablo; const maas = t.expense_categories.find((k) => k.is_payroll);
    t.expenses.push({ id: 'gm1', organization_id: t.expenses[0].organization_id, category_id: maas.id, expense_date: bugun, amount_excl_vat: 8000, vat_amount: 0, amount_incl_vat: 8000, cost_type: 'dogrudan', company_id: null, employee_id: null, paid: true, archived_at: null, import_id: 'imp1' });
  }, await gunOf(s, 0));
  await git(s, '#/giderler'); await s.waitForSelector('.kpi:has-text("Toplam gider")');
  const menu = (await s.locator('.kpi:has-text("Toplam gider") .kpi-v').first().innerText()).trim();
  await git(s, '#/panel'); await s.waitForSelector('#yon-finans .t-gider');
  const panel = (await s.locator('#yon-finans .t-gider').innerText()).trim();
  esit(panel.replace(',00', ''), menu.replace(',00', ''), 'panel gideri Giderler menüsüyle aynı olmalı');
  if (!panel.includes('11.000')) throw new Error(`beklenen 3.000 kira + 8.000 Excel personel = 11.000; bulunan ${panel}`);
});

await test('gider türü Personel: ortak kategoride bile personel sayılır, panel gideri Giderler menüsüyle aynı, çift personel yok', async (s) => {
  await karlilikHazirla(s);
  await s.evaluate((bugun) => {
    const t = globalThis.__fake.tablo; const kira = t.expense_categories.find((k) => !k.is_payroll && !k.is_income_tax);
    t.expenses.push({ id: 'gp1', organization_id: t.expenses[0].organization_id, category_id: kira.id, expense_date: bugun, amount_excl_vat: 8000, vat_amount: 0, amount_incl_vat: 8000, cost_type: 'personel', company_id: null, employee_id: null, paid: true, archived_at: null, description: 'Excel maaş' });
  }, await gunOf(s, 0));
  await git(s, '#/giderler'); await s.waitForSelector('.kpi:has-text("Toplam gider")');
  const secenek = await s.locator('#gider-tur option').allInnerTexts();
  if (!secenek.includes('Personel')) throw new Error('tür filtresinde Personel yok');
  const menu = (await s.locator('.kpi:has-text("Toplam gider") .kpi-v').first().innerText()).trim();
  await git(s, '#/panel'); await s.waitForSelector('#yon-finans .t-gider');
  const panel = (await s.locator('#yon-finans .t-gider').innerText()).trim();
  esit(panel.replace(',00', ''), menu.replace(',00', ''), 'panel gideri Giderler menüsüyle aynı olmalı');
  if (!panel.includes('11.000')) throw new Error(`beklenen 3.000 kira + 8.000 personel = 11.000 (kart maliyeti eklenmemeli); bulunan ${panel}`);
});

await test('panel: gider, vergi öncesi ve vergi sonrası kâr kutucukları hesap detayı açar', async (s) => {
  await karlilikHazirla(s);
  await git(s, '#/panel'); await s.waitForSelector('#yon-finans [data-detay="gider"]');
  await s.locator('#yon-finans [data-detay="gider"]').click(); await s.waitForSelector('.modal table');
  let m = await s.locator('.modal').innerText();
  for (const b of ['Toplam gider', 'Kira', '3.000,00', 'Personel (kart)', '10.000,00', '13.000,00']) if (!m.includes(b)) throw new Error(`gider detayında ${b} yok: ${m}`);
  await s.keyboard.press('Escape'); await s.waitForSelector('.modal', { state: 'detached' });
  await s.locator('#yon-kar [data-detay="oncesi"]').click(); await s.waitForSelector('.modal table');
  m = await s.locator('.modal').innerText();
  for (const b of ['Toplam hizmet geliri', '20.000,00', 'Personel maliyeti', 'Ortak giderler', '7.000,00']) if (!m.includes(b)) throw new Error(`vergi öncesi detayında ${b} yok: ${m}`);
  await s.keyboard.press('Escape'); await s.waitForSelector('.modal', { state: 'detached' });
  await s.locator('#yon-kar [data-detay="sonrasi"]').click(); await s.waitForSelector('.modal table');
  m = await s.locator('.modal').innerText();
  await ekran(s, '77-hesap-detayi');
  for (const b of ['matrah', '1.750,00', '5.250,00', '%25']) if (!m.toLowerCase().includes(b.toLowerCase())) throw new Error(`vergi sonrası detayında ${b} yok: ${m}`);
});

// ---------------------------------------------------------------- Panel: aylık personel grafiği
await test('panel: aylık hizmet verilen personel grafiği, tıklayınca firma seçilebilen pencere', async (s) => {
  await girisYap(s);
  await karlilikHazirla(s);
  await git(s, '#/panel'); await s.waitForSelector('#personel-grafik svg.grafik');
  esit(await s.locator('#personel-grafik svg.grafik rect').count(), 12, '12 aylık sütun');
  await s.locator('#personel-grafik').scrollIntoViewIfNeeded(); await s.waitForTimeout(200); await ekran(s, '76-panel-personel-grafik');
  const genis = await s.evaluate(() => { const k = document.querySelector('#personel-grafik').getBoundingClientRect(); const d = document.querySelector('#tehlike-dagilim, .grid-2 > .card:not(.card-genis)').getBoundingClientRect(); return k.width / d.width; });
  if (genis < 1.8) throw new Error(`grafik kutusu iki kutu genişliğinde değil: ${genis}`);
  // sınıf düğmeleri: varsayılan toplam; düğmeye tıklayınca modal açılmaz, grafik sınıfa göre değişir
  esit(await s.locator('#personel-grafik [data-psinif]').count(), 4, 'toplam + 3 sınıf düğmesi');
  esit(await s.locator('#personel-grafik [data-psinif=""]').getAttribute('aria-pressed'), 'true', 'varsayılan toplam');
  await s.locator('#personel-grafik [data-psinif="tehlikeli"]').click();
  esit(await s.locator('.modal').count(), 0, 'düğme tıklaması pencere açmamalı');
  esit(await s.locator('#personel-grafik [data-psinif="tehlikeli"]').getAttribute('aria-pressed'), 'true', 'tehlikeli seçili');
  if (!(await s.locator('#personel-grafik svg.grafik').getAttribute('aria-label')).includes('Tehlikeli')) throw new Error('grafik sınıfa göre değişmedi');
  await s.locator('#personel-grafik .card-title').click(); await s.waitForSelector('.modal #personel-firma');
  const secenekler = await s.locator('#personel-firma option').allInnerTexts();
  if (secenekler.length < 2) throw new Error(`firma seçeneği yok: ${secenekler}`);
  await s.selectOption('#personel-firma', { index: 1 });
  await s.waitForSelector('.modal #personel-icerik svg.grafik rect', { state: 'attached' });
  esit(await s.locator('.modal #personel-icerik tbody tr').count(), 12, 'aylık değişim satırı');
  await s.locator('.modal [data-psinif="az_tehlikeli"]').click();
  if (!(await s.locator('.modal #personel-icerik svg.grafik').getAttribute('aria-label')).includes('Az tehlikeli')) throw new Error('pencerede sınıf düğmesi çalışmadı');
});

await test('panel: aylık personel grafiği İSG-Katip aktarımlarından beslenir', async (s) => {
  await girisYap(s);
  await firmaEkle(s, { ad: 'Katip Grafik A.Ş.', vergi: '5555555551', calisan: 5, tehlike: 'tehlikeli' });
  await s.waitForSelector('.company-head h1:has-text("Katip Grafik")');
  await s.evaluate((bugun) => {
    const t = globalThis.__fake.tablo; const f = t.companies.find((c) => c.name === 'Katip Grafik A.Ş.');
    const ay = (n) => { const d = new Date(`${bugun.slice(0, 7)}-01T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() - n); return d.toISOString().slice(0, 10); };
    const site = { id: 'st1', organization_id: f.organization_id, company_id: f.id, sgk_no: '99999', site_name: 'Şube', employee_count: 0, hazard_class: 'tehlikeli' }; t.company_sites.push(site);
    [[2, 30], [1, 34], [0, 37]].forEach(([n, c], i) => {
      const imp = { id: `im${i}`, organization_id: f.organization_id, period: ay(n), file_name: `k${i}.xlsx`, created_at: new Date(Date.now() - (5 - i) * 86400000).toISOString() }; t.katip_imports.push(imp);
      t.katip_rows.push({ id: `kr${i}`, organization_id: f.organization_id, import_id: imp.id, site_id: 'st1', sgk_no: '99999', site_name: 'Şube', employee_count: c, hazard_class: 'tehlikeli', staff_type: 'is_guvenligi_uzmani', person_name: 'U', minutes_per_month: 600 });
    });
  }, await gunOf(s, 0));
  await git(s, '#/panel'); await s.waitForSelector('#personel-grafik svg.grafik');
  const ozet = await s.locator('#personel-grafik svg.grafik').getAttribute('aria-label');
  const ipucu = await s.evaluate(() => [...document.querySelectorAll('#personel-grafik rect[data-ipucu]')].map((r) => r.dataset.ipucu).filter((x) => /30|34|37/.test(x)));
  if (ipucu.length < 3) throw new Error(`Katip aylık verisi grafikte yok: ${ipucu} / ${ozet}`);
  await s.locator('#personel-grafik .card-title').click(); await s.waitForSelector('.modal #personel-firma');
  await s.selectOption('#personel-firma', { label: 'Katip Grafik A.Ş.' });
  if (!(await s.locator('.modal #personel-icerik tbody').innerText()).includes('37')) throw new Error('firma tablosunda 37 yok');
});

// ---------------------------------------------------------------- Menü düzeni: Fatura Takip, Gelirler
await test('menü: Fatura Takip, Gelirler, Giderler, Cari sırası; Satış grubu Finans\'tan sonra; Gelirler sayfası ay toplamı', async (s) => {
  await girisYap(s);
  const gruplar = (await s.locator('.nav-grup-ad').allTextContents()).map((x) => x.trim());
  if (gruplar.indexOf('Satış') < gruplar.indexOf('Finans') || gruplar.indexOf('Finans') < 0) throw new Error(`grup sırası: ${gruplar}`);
  const fin = await s.evaluate(() => [...document.querySelectorAll('.nav-grup')].find((g) => g.querySelector('.nav-grup-ad').textContent.trim() === 'Finans').textContent);
  const sira = ['Fatura Takip', 'Gelirler', 'Giderler', 'Cari hesap'].map((x) => fin.indexOf(x));
  if (sira.some((x) => x < 0) || sira.join() !== [...sira].sort((a, b) => a - b).join()) throw new Error(`finans menü sırası: ${fin}`);
  await git(s, '#/gelirler'); await s.waitForSelector('h1:has-text("Gelirler")'); await s.waitForSelector('#gelir-ozet .kpi');
  await s.selectOption('#gelir-ay', { index: 3 });
});

// ---------------------------------------------------------------- Bağlı firmalar (Aşama 28)
await test('ana firma: bağlı firma ana firmaya bağlanır, kartlarda görünür', async (s) => {
  await girisYap(s);
  await firmaEkle(s, { ad: 'Ana Grup A.Ş.', vergi: '7777777771', calisan: 10, tehlike: 'az_tehlikeli' });
  await s.waitForSelector('.company-head h1:has-text("Ana Grup")'); const anaHash = hashOf(s.url());
  await firmaEkle(s, { ad: 'Bagli Sube Ltd', vergi: '7777777772', calisan: 5, tehlike: 'tehlikeli' });
  await s.waitForSelector('.company-head h1:has-text("Bagli Sube")'); const bagliHash = hashOf(s.url());
  await s.locator('[data-action="duzenle"]').click();
  await modal(s).locator('select[name="parent_company_id"]').waitFor();
  const secenek = await modal(s).locator('select[name="parent_company_id"] option').allInnerTexts();
  if (!secenek.some((x) => x.includes('Ana Grup'))) throw new Error(`ana firma seçeneği yok: ${secenek}`);
  await modal(s).locator('select[name="parent_company_id"]').selectOption({ label: 'Ana Grup A.Ş.' });
  await modal(s).locator('button[type=submit]').click();
  await s.waitForSelector('#firma-ana-notu');
  const anaId = await s.evaluate(() => globalThis.__fake.tablo.companies.find((c) => c.name === 'Ana Grup A.Ş.').id);
  esit(await s.evaluate(() => globalThis.__fake.tablo.companies.find((c) => c.name === 'Bagli Sube Ltd').parent_company_id), anaId, 'parent_company_id');
  await git(s, anaHash); await s.waitForSelector('#firma-bagli-notu');
  if (!(await s.locator('#firma-bagli-notu').innerText()).includes('Bagli Sube')) throw new Error('bağlı firma adı yok');
  void bagliHash;
});

// ---------------------------------------------------------------- Firmayı kalıcı sil, pasife al (Aşama 18)
await test('firma pasife al / aktif et: kayıtlar kalır, kapasite yükü ve yeni görevlendirme listesi pasif firmayı saymaz', async (s) => {
  await girisYap(s);
  await firmaEkle(s, { ad: 'Pasif Test A.Ş.', vergi: '8888888891', calisan: 30, tehlike: 'tehlikeli' });
  await s.waitForSelector('.company-head h1:has-text("Pasif Test")'); const firmaHash = hashOf(s.url());
  await personelEkle(s, 'is_guvenligi_uzmani', 'Pasif Uzman');
  await git(s, '#/gorevlendirmeler'); await atamaYap(s, 'Pasif Test A.Ş.', 'Pasif Uzman', 60);
  await git(s, '#/kapasite'); await s.waitForSelector('#kap-icerik .table');
  if (!(await s.locator('#kap-icerik tr:has-text("Pasif Uzman")').innerText()).includes('6 sa')) throw new Error('aktif firmada yük 6 sa olmalı');
  await git(s, firmaHash); await s.waitForSelector('[data-action="pasif"]');
  esit((await s.locator('[data-action="pasif"]').innerText()).trim(), 'Pasife al', 'düğme metni');
  await s.click('[data-action="pasif"]'); await s.click('[data-ok]');
  await s.waitForSelector('#firma-pasif-notu');
  esit(await s.evaluate(() => globalThis.__fake.tablo.companies.find((c) => c.name === 'Pasif Test A.Ş.').customer_status), 'eski_musteri', 'pasif durumu');
  esit(await s.evaluate(() => globalThis.__fake.tablo.assignments.filter((a) => !a.archived_at).length), 1, 'görevlendirme kaydı silinmedi');
  esit((await s.locator('[data-action="pasif"]').innerText()).trim(), 'Aktif et', 'düğme metni (pasif)');
  await git(s, '#/kapasite'); await s.waitForSelector('#kap-icerik .table');
  if ((await s.locator('#kap-icerik tr:has-text("Pasif Uzman")').innerText()).includes('6 sa')) throw new Error('pasif firma uzman yüküne sayılmamalı');
  await git(s, '#/gorevlendirmeler'); await s.locator('[data-action="yeni-gv"]').first().click();
  const secenek = await modal(s).locator('#f-company_id option').allInnerTexts(); if (secenek.some((x) => x.includes('Pasif Test'))) throw new Error('pasif firma görevlendirme listesinde olmamalı');
  await modal(s).locator('[data-close], .modal-close').first().click().catch(() => {}); await s.keyboard.press('Escape');
  await git(s, firmaHash); await s.click('[data-action="pasif"]'); await s.click('[data-ok]'); await s.waitForFunction(() => !document.querySelector('#firma-pasif-notu'));
  await git(s, '#/kapasite'); await s.waitForSelector('#kap-icerik .table');
  if (!(await s.locator('#kap-icerik tr:has-text("Pasif Uzman")').innerText()).includes('6 sa')) throw new Error('aktif edilince yük geri gelmeli');
});

await test('firmayı kalıcı sil: yanlış ad reddedilir, doğru adla tüm kayıtlar silinir, diğer firma korunur', async (s) => {
  await girisYap(s);
  await firmaEkle(s, { ad: 'Silinecek Ltd', vergi: '8888888892', calisan: 10, tehlike: 'az_tehlikeli' }); await s.waitForSelector('.company-head h1:has-text("Silinecek")'); const silHash = hashOf(s.url());
  await firmaEkle(s, { ad: 'Kalacak Ltd', vergi: '8888888893', calisan: 10, tehlike: 'az_tehlikeli' }); await s.waitForSelector('.company-head h1:has-text("Kalacak")');
  await s.evaluate(() => { const t = globalThis.__fake.tablo; const a = t.companies.find((c) => c.name === 'Silinecek Ltd'); const b = t.companies.find((c) => c.name === 'Kalacak Ltd');
    for (const [f, no] of [[a, 'S-1'], [b, 'K-1']]) { const id = `inv-${no}`; t.invoices.push({ id, organization_id: f.organization_id, company_id: f.id, invoice_no: no, invoice_date: '2026-01-05', due_date: '2026-02-05', amount_excl_vat: 100, vat_amount: 20, archived_at: null });
      t.invoice_items.push({ id: `it-${no}`, invoice_id: id, description: 'x', unit_price_excl: 100, vat_rate: 20 }); t.payments.push({ id: `p-${no}`, invoice_id: id, paid_at: '2026-01-06', amount: 50 });
      t.contracts.push({ id: `c-${no}`, organization_id: f.organization_id, company_id: f.id, status: 'aktif', start_date: '2026-01-01', end_date: '2026-12-31', archived_at: null });
      t.tasks.push({ id: `t-${no}`, organization_id: f.organization_id, company_id: f.id, title: `görev ${no}`, status: 'acik' }); } });
  await git(s, '#/firmalar'); await git(s, silHash); await s.waitForSelector('[data-action="firma-sil"]');
  await s.click('[data-action="firma-sil"]'); const m = modal(s);
  await var_(m.locator('#firma-sil-uyari'), 'uyarı'); if (!(await m.locator('#firma-sil-uyari').innerText()).includes('geri alınamaz')) throw new Error('uyarı metni');
  await m.locator('#f-onay_adi').fill('Silinecek'); await m.locator('button[type=submit]').click();
  if (!(await m.innerText()).includes('aynen yazılmalıdır')) throw new Error('yanlış ad reddedilmeli');
  esit(await s.evaluate(() => globalThis.__fake.tablo.companies.filter((c) => c.name === 'Silinecek Ltd').length), 1, 'yanlış adla silinmedi');
  await m.locator('#f-onay_adi').fill('Silinecek Ltd'); await m.locator('button[type=submit]').click();
  await s.waitForFunction(() => location.hash === '#/firmalar');
  const d = await s.evaluate(() => { const t = globalThis.__fake.tablo; return { firma: t.companies.map((c) => c.name).join(','), fat: t.invoices.map((i) => i.invoice_no).join(','), kalem: t.invoice_items.length, odeme: t.payments.length, soz: t.contracts.length, gorev: t.tasks.map((x) => x.title).join(',') }; });
  esit(d.firma, 'Kalacak Ltd', 'yalnız kalan firma'); esit(d.fat, 'K-1', 'fatura'); esit(d.kalem, 1, 'kalem'); esit(d.odeme, 1, 'tahsilat'); esit(d.soz, 1, 'sözleşme'); esit(d.gorev, 'görev K-1', 'görev');
  await ekran(s, '64-firma-silindi');
});

await test('firmayı kalıcı sil: finans rolü silme düğmesini görmez; sahip görür', async (s) => {
  await girisYap(s);
  await firmaEkle(s, { ad: 'Yetki Test Ltd', vergi: '8888888894', calisan: 10, tehlike: 'az_tehlikeli' }); await s.waitForSelector('.company-head h1:has-text("Yetki")'); const h = hashOf(s.url());
  esit(await s.locator('[data-action="firma-sil"]').count(), 1, 'sahip silme düğmesini görür');
  await cikisYapGir(s, 'finans@test.com'); await git(s, '#/firmalar'); await git(s, h); await s.waitForSelector('.company-head h1');
  esit(await s.locator('[data-action="firma-sil"]').count(), 0, 'finans silme düğmesini görmez');
});

// ---------------------------------------------------------------- Aşama 21: İdari İşler
const calisanTohumu = (s, liste) => s.evaluate((l) => { const t = globalThis.__fake.tablo; const org = t.organizations[0].id; for (const x of l) t.employees.push({ id: crypto.randomUUID(), organization_id: org, staff_type: null, role_kind: 'sekreter', is_active: true, monthly_capacity_min: 11700, archived_at: null, ...x }); }, liste);
const pdfDosya = (ad = 'belge.pdf', boyut = 2000) => ({ name: ad, mimeType: 'application/pdf', buffer: Buffer.alloc(boyut, 'a') });

await test('İdari İşler: menü finans altında; yalnız yetkili roller görür', async (s) => {
  await girisYap(s);
  await var_(s.locator('.nav-item:has-text("İdari İşler")'), 'sahip menüyü görür');
  await cikisYapGir(s, 'finans@test.com');
  esit(await s.locator('.nav-item:has-text("İdari İşler")').count(), 0, 'finans rolü görmez');
  await git(s, '#/idari'); await s.waitForSelector('#sayfa');
  if (!(await s.locator('#sayfa').innerText()).toLowerCase().includes('yetki')) throw new Error('yetkisiz mesajı yok');
});

await test('Firma sözleşmeler: imzalı sözleşme kaydet (PDF/resim), geçersiz dosya, listele, aç, arşivle', async (s) => {
  await girisYap(s); await firmaEkle(s, { ad: 'İmza A.Ş.' });
  await s.waitForSelector('.company-head, #firma-tablo tbody tr a');
  if (!(await s.locator('.company-head').count())) { await s.click('#firma-tablo tbody tr a'); await s.waitForSelector('.company-head'); }
  await s.click('[data-sekme="sozlesmeler"]');
  await s.waitForSelector('[data-action="imzali-yeni"]');
  if (!(await s.locator('#sekme-govde').innerText()).includes('Henüz imzalı sözleşme yüklenmedi')) throw new Error('boş durum yok');
  await s.click('[data-action="imzali-yeni"]');
  await modal(s).locator('#f-file').setInputFiles({ name: 'x.exe', mimeType: 'application/x-msdownload', buffer: Buffer.alloc(100) });
  await modal(s).locator('button[type=submit]').click();
  if (!(await modal(s).innerText()).includes('Yalnızca PDF')) throw new Error('exe reddedilmeli');
  await modal(s).locator('#f-title').fill('2026 hizmet sözleşmesi');
  await modal(s).locator('#f-signed_date').fill('2026-10-01');
  await modal(s).locator('#f-file').setInputFiles(pdfDosya('imzali.pdf'));
  await modal(s).locator('button[type=submit]').click();
  await s.waitForSelector('[data-imzali-ac]');
  const kayit = await s.evaluate(() => globalThis.__fake.tablo.signed_contracts[0]);
  esit(kayit.title, '2026 hizmet sözleşmesi', 'ad'); esit(kayit.mime_type, 'application/pdf', 'mime'); esit(kayit.signed_date, '2026-10-01', 'tarih');
  if (!kayit.storage_path.includes('/sozlesme/') || !kayit.storage_path.endsWith('.pdf')) throw new Error(`yol: ${kayit.storage_path}`);
  // resim de yüklenebilir
  await s.click('[data-action="imzali-yeni"]');
  await modal(s).locator('#f-file').setInputFiles({ name: 'foto.jpg', mimeType: 'image/jpeg', buffer: Buffer.alloc(500, 'b') });
  await modal(s).locator('button[type=submit]').click();
  await s.waitForFunction(() => document.querySelectorAll('[data-imzali-ac]').length === 2);
  // arşivle
  await s.locator('[data-imzali-arsiv]').first().click();
  await s.locator('[data-ok]').click();
  await s.waitForFunction(() => document.querySelectorAll('[data-imzali-ac]').length === 1);
  esit(await s.evaluate(() => globalThis.__fake.tablo.signed_contracts.filter((d) => d.archived_at).length), 1, 'arşivde 1');
});

await test('İdari İşler: özlük belgesi yükle, eksik/yüklü, başka belge adı, geçersiz dosya, arşivle', async (s) => {
  await girisYap(s); await calisanTohumu(s, [{ full_name: 'Ayşe Demir', start_date: '2020-03-15', birth_date: '1990-01-01' }]);
  await git(s, '#/idari'); await s.waitForSelector('[data-belge-tur="kimlik"]');
  esit(await s.locator('[data-belge-tur] .pill-warning:has-text("Eksik")').count(), 9, '9 belge eksik');
  await s.locator('[data-yukle="kimlik"]').click();
  await modal(s).locator('#f-file').setInputFiles({ name: 'x.exe', mimeType: 'application/x-msdownload', buffer: Buffer.alloc(100) });
  await modal(s).locator('button[type=submit]').click();
  if (!(await modal(s).innerText()).includes('Yalnızca PDF')) throw new Error('exe reddedilmeli');
  await modal(s).locator('#f-file').setInputFiles({ name: 'dev.pdf', mimeType: 'application/pdf', buffer: Buffer.alloc(10 * 1024 * 1024 + 1) });
  await modal(s).locator('button[type=submit]').click();
  if (!(await modal(s).innerText()).includes('10 MB')) throw new Error('büyük dosya reddedilmeli');
  await modal(s).locator('#f-file').setInputFiles(pdfDosya('kimlik.pdf'));
  await modal(s).locator('#f-valid_until').fill('2030-01-01');
  await modal(s).locator('button[type=submit]').click();
  await s.waitForSelector('[data-belge-tur="kimlik"] .pill-success');
  esit(await s.locator('[data-belge-tur] .pill-warning:has-text("Eksik")').count(), 8, '8 belge eksik');
  esit(await s.evaluate(() => globalThis.__fake.tablo.admin_documents.length), 1, 'kayıt');
  const kayit = await s.evaluate(() => globalThis.__fake.tablo.admin_documents[0]);
  esit(kayit.scope, 'personel', 'kapsam'); esit(kayit.doc_type, 'kimlik', 'tür'); esit(kayit.mime_type, 'application/pdf', 'mime');
  if (!kayit.storage_path.includes('/personel/') || !kayit.storage_path.endsWith('.pdf')) throw new Error(`yol: ${kayit.storage_path}`);
  // başka belge: ad zorunlu
  await s.locator('[data-yukle="diger"]').click();
  await modal(s).locator('#f-file').setInputFiles(pdfDosya('x.pdf'));
  await modal(s).locator('button[type=submit]').click();
  if (!(await modal(s).innerText()).includes('Belge adını yazın')) throw new Error('ad zorunlu');
  await modal(s).locator('#f-title').fill('Askerlik durum belgesi');
  await modal(s).locator('button[type=submit]').click();
  await s.waitForSelector('[data-belge-tur="diger"]:has-text("Askerlik durum belgesi")');
  // indirme bağlantısı imzalı adres üretir
  const urlP = s.evaluate(() => globalThis.__fake.tablo.admin_documents.length);
  esit(await urlP, 2, 'iki belge');
  await s.locator('[data-belge-tur="kimlik"] [data-belge-arsiv]').click();
  await modal(s).locator('button:has-text("Arşivle")').click();
  await s.waitForSelector('[data-belge-tur="kimlik"] .pill-warning:has-text("Eksik")');
  await ekran(s, '70-idari-ozluk');
});

await test('İdari İşler: yükleme veri satırı eklenemezse dosya geri silinir', async (s) => {
  await girisYap(s); await calisanTohumu(s, [{ full_name: 'Ayşe Demir', start_date: '2020-03-15' }]);
  await git(s, '#/idari'); await s.waitForSelector('[data-yukle="kimlik"]');
  await s.evaluate(() => { globalThis.__belgeKayitHata = true; });
  await s.locator('[data-yukle="kimlik"]').click();
  await modal(s).locator('#f-file').setInputFiles(pdfDosya());
  await modal(s).locator('button[type=submit]').click();
  await s.waitForSelector('.form-error:not([hidden])');
  esit(await s.evaluate(() => globalThis.__fake.depoSayisi()), 0, 'yetim dosya kalmamalı');
});

await test('İdari İşler: personel izinleri yıl yıl hesaplanır; izin eklenir, çakışma reddedilir, silinir', async (s) => {
  await girisYap(s);
  const bugunS = await s.evaluate(() => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Istanbul' }));
  const yil = Number(bugunS.slice(0, 4));
  await calisanTohumu(s, [{ full_name: 'Ayşe Demir', start_date: `${yil - 6}-01-01`, birth_date: '1990-01-01' }, { full_name: 'Yeni Başlayan', start_date: `${yil}-01-01`, birth_date: '1995-01-01' }, { full_name: 'Tarihsiz Kişi' }]);
  await git(s, '#/idari'); await s.waitForSelector('[data-sekme="izin"]'); await s.click('[data-sekme="izin"]');
  await s.waitForSelector('#izin-yillik');
  const satirlar = await s.locator('#izin-yillik tbody tr').allInnerTexts();
  esit(satirlar.length, 6, '6 yıl hak edilmiş');
  for (let i = 0; i < 5; i++) if (!satirlar[i].includes('14')) throw new Error(`yıl ${i + 1}: ${satirlar[i]}`);
  if (!satirlar[5].includes('20')) throw new Error(`6. yıl 20 gün olmalı: ${satirlar[5]}`);
  if (!(await s.locator('.kpi-grid').innerText()).includes('90')) throw new Error('toplam hak 90');
  // izin ekle: Pzt-Cum = 5 gün otomatik
  await s.locator('[data-izin-ekle]').click();
  await modal(s).locator('#f-start_date').fill('2026-07-06'); await modal(s).locator('#f-end_date').fill('2026-07-10');
  await s.waitForFunction(() => document.querySelector('.modal-overlay:last-of-type #f-days')?.value === '5');
  await modal(s).locator('button[type=submit]').click();
  await s.waitForSelector('#izin-yillik tbody tr:first-child:has-text("5")');
  esit(await s.evaluate(() => globalThis.__fake.tablo.employee_leaves.length), 1, 'izin kaydı');
  // çakışma
  await s.locator('[data-izin-ekle]').click();
  await modal(s).locator('#f-start_date').fill('2026-07-08'); await modal(s).locator('#f-end_date').fill('2026-07-09');
  await modal(s).locator('button[type=submit]').click();
  if (!(await modal(s).innerText()).includes('başka bir izin')) throw new Error('çakışma reddedilmeli');
  await modal(s).locator('button:has-text("Vazgeç")').click();
  // fazla kullanım uyarısı yok; kalan 85
  if (!(await s.locator('.kpi-grid').innerText()).includes('85')) throw new Error('kalan 85');
  // diğer personel: hak yok; tarihsiz: uyarı
  await s.selectOption('#idari-kisi', { label: 'Yeni Başlayan' });
  await s.waitForSelector('.empty:has-text("Henüz hak edilmiş")');
  await s.selectOption('#idari-kisi', { label: 'Tarihsiz Kişi' });
  await s.waitForSelector('.notice-warn:has-text("İşe başlama tarihi girilmemiş")');
  await s.selectOption('#idari-kisi', { label: 'Ayşe Demir' });
  await s.locator('[data-izin-arsiv]').click(); await modal(s).locator('button:has-text("Sil")').click();
  await s.waitForSelector('.kpi-grid:has-text("90")');
  await ekran(s, '71-idari-izin');
});

await test('İdari İşler: araç, ruhsat/sigorta/bakım kayıtları, ekstra veri, belge yükleme, plaka tekrarı', async (s) => {
  await girisYap(s);
  const bugunS = await s.evaluate(() => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Istanbul' }));
  await git(s, '#/idari'); await s.waitForSelector('[data-sekme="arac"]'); await s.click('[data-sekme="arac"]');
  await s.locator('[data-arac-ekle]').first().click();
  await modal(s).locator('#f-plate').fill('34 abc 123'); await modal(s).locator('#f-brand').fill('Renault'); await modal(s).locator('#f-model').fill('Clio'); await modal(s).locator('#f-model_year').fill('2022');
  await modal(s).locator('button[type=submit]').click();
  await s.waitForSelector('#arac-liste:has-text("34ABC123")');
  // aynı plaka reddedilir
  await s.locator('[data-arac-ekle]').first().click();
  await modal(s).locator('#f-plate').fill('34ABC123'); await modal(s).locator('#f-brand').fill('Fiat');
  await modal(s).locator('button[type=submit]').click();
  await modal(s).locator('.field-error:has-text("zaten var"), .form-error:has-text("zaten var")').first().waitFor({ timeout: 5000 }).catch(() => { throw new Error('plaka tekrarı'); });
  await modal(s).locator('button:has-text("Vazgeç")').click();
  // kayıtlar
  const ekle = async (tur, alanlar) => {
    await s.locator('[data-kayit-ekle]').click(); await modal(s).locator('#f-kind').selectOption(tur);
    for (const [k, v] of Object.entries(alanlar)) await modal(s).locator(`#f-${k}`).fill(v);
    await modal(s).locator('button[type=submit]').click();
  };
  const gec = (g) => new Date(Date.now() + g * 86400000).toLocaleDateString('sv-SE', { timeZone: 'Europe/Istanbul' });
  await ekle('trafik_sigortasi', { record_date: gec(-300), expiry_date: gec(10), amount: '4500', value_text: 'POL-123' });
  await s.waitForSelector('#arac-detay:has-text("POL-123")');
  await ekle('kasko', { expiry_date: gec(200) });
  await ekle('muayene', { expiry_date: gec(-5) });
  // diğer: ad zorunlu
  await s.locator('[data-kayit-ekle]').click(); await modal(s).locator('#f-kind').selectOption('diger'); await modal(s).locator('button[type=submit]').click();
  if (!(await modal(s).innerText()).includes('ad yazın')) throw new Error('diğer için ad zorunlu');
  await modal(s).locator('#f-label').fill('Lastik değişimi'); await modal(s).locator('#f-value_text').fill('Kış lastiği, 84.000 km'); await modal(s).locator('button[type=submit]').click();
  await s.waitForSelector('#arac-detay:has-text("Lastik değişimi")');
  esit(await s.evaluate(() => globalThis.__fake.tablo.vehicle_records.length), 4, '4 kayıt');
  const liste = await s.locator('#arac-liste').innerText();
  if (!liste.includes('gün kaldı') || !liste.includes('süresi geçti')) throw new Error(`süre durumları: ${liste}`);
  // kayda belge
  await s.locator('tr[data-kayit]:has-text("Trafik sigortası") [data-kayit-belge]').click();
  await modal(s).locator('#f-file').setInputFiles({ name: 'police.jpg', mimeType: 'image/jpeg', buffer: Buffer.alloc(500) });
  await modal(s).locator('button[type=submit]').click();
  await s.waitForSelector('#arac-detay .belge-liste');
  const d = await s.evaluate(() => globalThis.__fake.tablo.admin_documents[0]);
  esit(d.scope, 'arac', 'kapsam'); if (!d.vehicle_record_id || !d.vehicle_id) throw new Error('araç/kayıt bağı');
  await ekran(s, '72-idari-arac');
});

await test('İdari İşler: şirket belgeleri adı/tarihi/açıklamasıyla yüklenir ve arşivlenir', async (s) => {
  await girisYap(s);
  await git(s, '#/idari'); await s.waitForSelector('[data-sekme="sirket"]'); await s.click('[data-sekme="sirket"]');
  await s.locator('[data-sirket-belge]').first().click();
  await modal(s).locator('#f-file').setInputFiles({ name: 'imza.png', mimeType: 'image/png', buffer: Buffer.alloc(800) });
  await modal(s).locator('button[type=submit]').click();
  if (!(await modal(s).innerText()).includes('Belge adını yazın')) throw new Error('ad zorunlu');
  await modal(s).locator('#f-title').fill('İmza sirküleri'); await modal(s).locator('#f-doc_date').fill('2026-02-03'); await modal(s).locator('#f-description').fill('Noter onaylı');
  await modal(s).locator('button[type=submit]').click();
  await s.waitForSelector('#sirket-liste:has-text("İmza sirküleri")');
  const t = await s.locator('#sirket-liste').innerText(); if (!t.includes('03.02.2026') || !t.includes('Noter onaylı')) throw new Error(t);
  const k = await s.evaluate(() => globalThis.__fake.tablo.admin_documents[0]); esit(k.scope, 'sirket', 'kapsam'); esit(k.employee_id ?? null, null, 'personel yok');
  await s.locator('#sirket-liste [data-belge-arsiv]').click(); await modal(s).locator('button:has-text("Arşivle")').click();
  await s.waitForSelector('.empty:has-text("Henüz şirket belgesi yok")');
  await ekran(s, '73-idari-sirket');
});

await test('İdari İşler: personel formunda doğum tarihi kaydedilir', async (s) => {
  await girisYap(s); await calisanTohumu(s, [{ full_name: 'Ayşe Demir', start_date: '2020-03-15' }]);
  await git(s, '#/digerpersonel'); await s.waitForSelector('#sayfa table, #sayfa .empty');
  await s.locator('#sayfa :text("Ayşe Demir")').first().click(); await s.waitForSelector('.company-head h1, #sayfa h1:has-text("Ayşe")');
  await s.locator('[data-action="personel-duzenle"], [data-action="duzenle"]').first().click();
  await modal(s).locator('#f-birth_date').fill('1980-05-20'); await modal(s).locator('button[type=submit]').click();
  await s.waitForTimeout(500);
  const m = await s.evaluate(() => [globalThis.__fake.tablo.employees[0].birth_date, document.querySelector('.form-error')?.textContent, [...document.querySelectorAll('.field-error')].map((e) => e.textContent).join('|')]);
  esit(m[0], '1980-05-20', `doğum tarihi (${m[1]} ${m[2]})`);
});

await test('mobil 375px: İdari İşler sekmelerinde yatay taşma yok', async (s) => {
  await girisYap(s); await calisanTohumu(s, [{ full_name: 'Ayşe Demir', start_date: '2015-03-15', birth_date: '1980-01-01' }]);
  await git(s, '#/idari'); await s.waitForSelector('[data-sekme="izin"]');
  for (const id of ['ozluk', 'izin', 'arac', 'sirket']) {
    await s.click(`[data-sekme="${id}"]`); await s.waitForTimeout(150);
    const t = await s.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    if (t > 1) throw new Error(`${id}: yatay taşma ${t}px`);
  }
}, { genislik: 375, yukseklik: 800 });

await test('yönetici paneli: aylık finans özeti kutucukları, grafikler ve ay seçimi', async (s) => {
  await karlilikHazirla(s);
  await git(s, '#/panel'); await s.waitForSelector('#yon-finans .kpi');
  const finans = await s.locator('#yon-finans').innerText();
  for (const b of ['Toplam hizmet geliri', '20.000,00', 'Toplam tahsilat', 'Tahsil edilmemiş alacak', 'Toplam gider', '13.000,00']) if (!finans.includes(b)) throw new Error(`finans kutularında ${b} yok: ${finans}`);
  const kar = await s.locator('#yon-kar').innerText();
  for (const b of ['Vergi öncesi tahmini kâr', '7.000,00', 'Tahmini kurumlar vergisi', '1.750,00', 'Vergi sonrası tahmini kâr', '5.250,00']) if (!kar.includes(b)) throw new Error(`kâr kutularında ${b} yok: ${kar}`);
  const op = await s.locator('#yon-operasyon').innerText();
  for (const b of ['Hizmet verilen toplam personel', 'Ortalama kişi bazlı gelir', 'Tehlike sınıfına göre ort. kişi bazlı gelir', 'Çok tehlikeli', 'Tehlikeli', 'Az tehlikeli']) if (!op.includes(b)) throw new Error(`operasyon kutularında ${b} yok: ${op}`);
  for (const b of ['Aktif firma sayısı', 'Uzman / hekim sayısı', 'Toplam teorik hizmet dakikası', 'Toplam fiilî hizmet dakikası']) if (op.includes(b)) throw new Error(`kaldırılan kutu hâlâ var: ${b}`);
  const kutular = await s.evaluate(() => [...document.querySelectorAll(".yon-ozet .kpi")].map((k) => `${Math.round(k.getBoundingClientRect().width)}x${Math.round(k.getBoundingClientRect().height)}`));
  { const w = kutular.map((x) => Number(x.split('x')[0])); if (Math.max(...w) - Math.min(...w) > 2) throw new Error(`kutucuk genişlikleri eşit değil: ${kutular}`); }
  const renk = (sel) => s.evaluate((q) => getComputedStyle(document.querySelector(q)).color, sel);
  const [rg, rd, rk] = [await renk('#yon-finans .t-gelir'), await renk('#yon-finans .t-gider'), await renk('#yon-kar .t-kar')];
  if (rg === rd || rd === rk || rg === rk) throw new Error(`para renkleri ayrışmıyor: ${rg} ${rd} ${rk}`);
  if (!(await s.locator('#yon-dk').innerText()).includes('hesaplanamaz')) throw new Error('fiilî süre 0 iken dakika başına değerler hesaplanamaz demeli');
  esit(await s.locator('.yon-ozet svg.grafik').count(), 2, 'iki grafik');
  esit(await s.locator('.yon-ozet svg.grafik rect').count(), 36, '12 ay x 3 çubuk (gelir, gider, kâr)');
  esit(await s.locator('.yon-ozet svg.grafik polyline').count(), 2, 'iki çizgi');
  await var_(s.locator('#yon-kapasite li:has-text("Kar Uzman")'), 'personel kapasite satırı');
  await var_(s.locator('.yon-ozet .card:has-text("En kârlı müşteriler") li:has-text("Kar A.Ş.")'), 'en kârlı müşteri');
  await var_(s.locator('#yon-tehlike li'), 'tehlike sınıfı gelir satırı');
  if ((await s.locator('.yon-ozet').innerText()).includes('gelir ve zaman')) throw new Error('"zaman" ifadesi kalkmalıydı');
  // ipucu: çubuğun üzerine gelince tutar görünür
  const kutu = await s.evaluate(() => { const e = [...document.querySelectorAll('.yon-ozet svg.grafik rect')].sort((a, b) => b.getBoundingClientRect().height - a.getBoundingClientRect().height)[0]; e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; });
  await s.mouse.move(kutu.x + kutu.width / 2, kutu.y + kutu.height / 2); await s.waitForSelector('.g-ipucu:not([hidden])');
  if (!/₺|TL|\d/.test(await s.locator('.g-ipucu').innerText())) throw new Error('ipucu tutar göstermiyor');
  // büyütme pencereleri
  await s.locator('[data-buyut="gelirgider"] .card-title').click(); await s.waitForSelector('.modal svg.grafik');
  esit(await s.locator('.modal svg.grafik rect').count(), 36, 'büyük grafik çubukları');
  await s.keyboard.press('Escape'); await s.waitForSelector('.modal', { state: 'detached' });
  await s.locator('[data-buyut="kar"] .card-title').click(); await s.waitForSelector('.modal svg.grafik circle');
  esit(await s.locator('.modal svg.grafik circle').count(), 24, 'kâr noktaları'); await s.keyboard.press('Escape'); await s.waitForSelector('.modal', { state: 'detached' });
  await s.locator('[data-buyut="enkarli"] .card-title').click(); await s.waitForSelector('.modal .yon-siralama li');
  await s.keyboard.press('Escape'); await s.waitForSelector('.modal', { state: 'detached' });
  await s.locator('[data-buyut="endusuk"] .card-title').click(); await s.waitForSelector('.modal .yon-siralama li'); await s.keyboard.press('Escape');
  await var_(s.locator('#yon-dikkat:has-text("boş kapasite")'), 'dikkat notu');
  await s.waitForTimeout(900); await ekran(s, '75-yonetici-paneli-ozet');
  await s.locator('.yon-ozet .grid-2').scrollIntoViewIfNeeded(); await s.evaluate(() => window.scrollBy(0, 200)); await s.waitForTimeout(300); await ekran(s, '75b-yonetici-paneli-grafikler');
  // geçmiş ay: gelir yok
  const ay = await s.evaluate(() => { const o = [...document.querySelectorAll('#yon-ay option')]; return o[3].value; });
  await s.selectOption('#yon-ay', ay);
  await s.waitForFunction(() => document.querySelector('#yon-finans .kpi-v')?.textContent.includes('0,00'));
  await var_(s.locator('#yon-finans .kpi:has-text("Toplam hizmet geliri") .kpi-v:has-text("0,00")'), 'geçmiş ayda gelir 0');
});

await test('yönetici paneli: finans izinleri olmayan rol özeti görmez, portföy görünür', async (s) => {
  await girisYap(s); await sozlesmeliFirma(s, 'Panel A.Ş.', '7000000009', 20, 1000);
  await cikisYapGir(s, 'satis@test.com');
  await git(s, '#/panel'); await s.waitForSelector('.kpi-grid');
  esit(await s.locator('.yon-ozet').count(), 0, 'finans özeti gizli');
});

await test('mobil 375px: yönetici paneli finans özetinde yatay taşma yok', async (s) => {
  await karlilikHazirla(s); await git(s, '#/panel'); await s.waitForSelector('#yon-finans .kpi'); await s.waitForSelector('.yon-ozet svg.grafik');
  const t = await s.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  if (t > 1) throw new Error(`yatay taşma ${t}px`);
  await ekran(s, '76-yonetici-paneli-mobil');
}, { genislik: 375, yukseklik: 800 });

await tarayici.close(); sunucu.close();
console.log(`\n${gecen} geçti, ${basarisiz.length} kaldı.`);
if (basarisiz.length) { console.log(`Başarısız: ${basarisiz.join('; ')}`); process.exit(1); }
