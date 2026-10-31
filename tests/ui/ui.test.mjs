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
    if (process.env.DEBUG_DOM) console.log((await sayfa.evaluate(() => document.body.innerText).catch(() => '')).slice(0, 1500));
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
  esit(await s.locator('.nav-item:has-text("Gelirler ve tahsilatlar")').count(), 0, 'finans menüde olmamalı');
  await git(s, '#/kullanicilar');
  await var_(s.locator('h3:has-text("Bu sayfayı görme izniniz yok")'), 'erişim engeli');
});

await test('yetki: finans ve uzman/hekim rolleri', async (s, ctx) => {
  await girisYap(s, 'finans@test.com');
  await var_(s.locator('.nav-item:has-text("Gelirler ve tahsilatlar")'), 'finans menüsü');
  esit(await s.locator('.nav-item:has-text("Kişiler")').count(), 0, 'finans kişileri görmemeli');
  await s.click('.user-btn'); await s.click('[data-kmenu="cikis"]');
  await s.waitForSelector('#f-email');
  await s.fill('#f-email', 'uzman@test.com'); await s.fill('#f-password', 'GucluSifre123'); await s.click('button[type=submit]');
  await s.waitForSelector('#kabuk');
  esit(await s.locator('.nav-item').count(), 4, 'uzman/hekim: firmalar, görevlendirmeler, zaman, görevler');
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

await test('maliyet: maaş yetkisi olan görür ve girer, operasyon göremez; finans kayıt açamaz', async (s) => {
  await girisYap(s);
  const url = await personelEkle(s, 'is_guvenligi_uzmani', 'Maaş Uzman');
  await s.waitForSelector('[data-action="maliyet"]');
  await s.click('[data-action="maliyet"]');
  await modal(s).locator('#f-baslangic').fill(ayinBirinci());
  await modal(s).locator('#f-brut').fill('50000'); await modal(s).locator('#f-sgk').fill('12000'); await modal(s).locator('#f-diger').fill('3000');
  await modal(s).locator('button[type=submit]').click();
  await s.waitForFunction(() => document.querySelector('#sayfa')?.textContent.includes('65.000'));
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
  await git(s, '#/personel-karlilik'); await s.waitForSelector('#kar-personel-tablo tbody tr');
  const metin = await s.locator('#kar-personel-tablo tbody tr').first().innerText();
  for (const beklenen of ['Kar Uzman', '10.000,00', '20.000,00', '9.658,12']) if (!metin.includes(beklenen)) throw new Error(`personel satırında ${beklenen} yok: ${metin}`);
  await var_(s.locator('#kar-personel-tablo tbody tr td.num:has-text("%3,4")'), 'doluluk 400/11700');
  await var_(s.locator('.kpi:has-text("Boşta kapasite") .kpi-v:has-text("9.658")'), 'boşta kpi');
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

await tarayici.close(); sunucu.close();
console.log(`\n${gecen} geçti, ${basarisiz.length} kaldı.`);
if (basarisiz.length) { console.log(`Başarısız: ${basarisiz.join('; ')}`); process.exit(1); }
