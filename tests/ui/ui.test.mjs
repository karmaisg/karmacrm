// OSGB 360 - Arayüz testleri (Playwright + sahte supabase-js). Çalıştırma: node tests/ui/ui.test.mjs
// Statik sunucu proje kökünü sunar; jsDelivr isteği sahte istemciyle değiştirilir. CSP gerçek haliyle uygulanır.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
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
  await var_(s.locator('.nav-item:has-text("Teklifler") .nav-tag:has-text("Aşama 4")'), 'aşama etiketi');
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
  esit(await s.locator('.nav-item').count(), 1, 'uzman/hekim yalnızca zaman menüsünü görür');
  await var_(s.locator('h3:has-text("Bu sayfayı görme izniniz yok")'), 'panel engeli');
});

await test('kullanıcılar: ekle, rol değiştir, kendini düzenleyemez', async (s) => {
  await girisYap(s);
  await git(s, '#/kullanicilar'); await s.waitForSelector('#kul-icerik .table');
  esit(await s.locator('[data-kullanici]').count(), 3, 'kendisi hariç 3 düzenleme düğmesi');
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

await test('kabuk: yakında sayfası ve olmayan adres', async (s) => {
  await girisYap(s);
  await git(s, '#/teklifler');
  await var_(s.locator('h3:has-text("Aşama 4")'), 'yakında');
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

await tarayici.close(); sunucu.close();
console.log(`\n${gecen} geçti, ${basarisiz.length} kaldı.`);
if (basarisiz.length) { console.log(`Başarısız: ${basarisiz.join('; ')}`); process.exit(1); }
