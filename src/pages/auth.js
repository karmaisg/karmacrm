// OSGB 360 - Giriş, şifre sıfırlama ve erişimsiz durum ekranları.
import { html, mount } from '../lib/format.js';
import { icon } from '../ui/icons.js';
import { humanError } from '../lib/api.js';
import { showFieldErrors } from '../ui/components.js';

export const logo = (boyut = 36) => html`<svg class="logo-mark" width="${boyut}" height="${boyut}" viewBox="0 0 32 32" aria-hidden="true">
  <rect width="32" height="32" rx="9" fill="var(--primary)"/>
  <path d="M16 7.5a8.5 8.5 0 1 0 8.5 8.5" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round"/>
  <circle cx="16" cy="16" r="2.6" fill="#fff"/>
</svg>`;

function kart(icerik) {
  return html`<main class="auth" id="main">
    <div class="auth-card">
      <div class="auth-brand">${logo(40)}<span class="auth-brand-ad">OSGB 360</span></div>
      ${icerik}
    </div>
    <p class="auth-foot">Yönetim amaçlı analiz yazılımıdır; resmî muhasebe veya vergi beyanı yerine geçmez.</p>
  </main>`;
}

function sifreAlani(ad, etiket, otomatik) {
  return html`<div class="field" data-field="${ad}">
    <label for="f-${ad}">${etiket}</label>
    <div class="pw">
      <input id="f-${ad}" name="${ad}" type="password" autocomplete="${otomatik}" required aria-describedby="e-${ad}">
      <button type="button" class="pw-toggle" data-pw="f-${ad}" aria-label="Şifreyi göster" aria-pressed="false">Göster</button>
    </div>
    <div class="field-error" id="e-${ad}" role="alert"></div>
  </div>`;
}

function sifreGoster(kok) {
  kok.addEventListener('click', (e) => {
    const d = e.target.closest('[data-pw]');
    if (!d) return;
    const girdi = kok.querySelector(`#${d.dataset.pw}`);
    const goster = girdi.type === 'password';
    girdi.type = goster ? 'text' : 'password';
    d.textContent = goster ? 'Gizle' : 'Göster';
    d.setAttribute('aria-pressed', String(goster));
    d.setAttribute('aria-label', goster ? 'Şifreyi gizle' : 'Şifreyi göster');
  });
}

async function gonder(form, calistir) {
  const dugme = form.querySelector('button[type="submit"]');
  const genel = form.querySelector('.form-error');
  const eski = dugme.textContent;
  genel.hidden = true; genel.textContent = '';
  showFieldErrors(form, {});
  dugme.disabled = true; dugme.textContent = 'Lütfen bekleyin…';
  try { await calistir(); }
  catch (e) { genel.textContent = humanError(e); genel.hidden = false; }
  finally { dugme.disabled = false; dugme.textContent = eski; }
}

export function girisEkrani(app, { bilgi = '' } = {}) {
  const kok = document.getElementById('app');
  mount(kok, kart(html`
    <h1>Hesabınıza giriş yapın</h1>
    <p class="auth-sub">OSGB yönetim, satış ve kârlılık platformu</p>
    ${bilgi ? html`<div class="notice notice-info" role="status">${bilgi}</div>` : ''}
    <form class="form" novalidate id="giris-formu">
      <div class="field" data-field="email">
        <label for="f-email">E-posta</label>
        <input id="f-email" name="email" type="email" autocomplete="username" inputmode="email" required aria-describedby="e-email">
        <div class="field-error" id="e-email" role="alert"></div>
      </div>
      ${sifreAlani('password', 'Şifre', 'current-password')}
      <div class="form-error" role="alert" hidden></div>
      <button type="submit" class="btn btn-primary btn-block">Giriş yap</button>
    </form>
    <button type="button" class="link-btn" id="unuttum">Şifremi unuttum</button>`));
  sifreGoster(kok);
  const form = kok.querySelector('#giris-formu');
  form.email.focus();
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const email = form.email.value.trim();
    const sifre = form.password.value;
    const hatalar = {};
    if (!email) hatalar.email = 'E-posta adresinizi yazın.';
    if (!sifre) hatalar.password = 'Şifrenizi yazın.';
    if (Object.keys(hatalar).length) { showFieldErrors(form, hatalar); return; }
    gonder(form, async () => { await app.api.signIn(email, sifre); /* oturum olayı uygulamayı başlatır */ });
  });
  kok.querySelector('#unuttum').addEventListener('click', () => sifreSifirlamaEkrani(app, form.email.value.trim()));
}

export function sifreSifirlamaEkrani(app, eposta = '') {
  const kok = document.getElementById('app');
  mount(kok, kart(html`
    <h1>Şifrenizi sıfırlayın</h1>
    <p class="auth-sub">E-posta adresinizi yazın; kayıtlıysa şifre sıfırlama bağlantısı gönderilir.</p>
    <form class="form" novalidate id="sifirla-formu">
      <div class="field" data-field="email">
        <label for="f-email">E-posta</label>
        <input id="f-email" name="email" type="email" autocomplete="username" inputmode="email" value="${eposta}" required aria-describedby="e-email">
        <div class="field-error" id="e-email" role="alert"></div>
      </div>
      <div class="form-error" role="alert" hidden></div>
      <div class="notice notice-ok" role="status" hidden id="sifirla-tamam"></div>
      <button type="submit" class="btn btn-primary btn-block">Bağlantı gönder</button>
    </form>
    <button type="button" class="link-btn" id="geri">${icon('arrowL', 16)} Girişe dön</button>`));
  const form = kok.querySelector('#sifirla-formu');
  form.email.focus();
  kok.querySelector('#geri').addEventListener('click', () => girisEkrani(app));
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const email = form.email.value.trim();
    if (!email) { showFieldErrors(form, { email: 'E-posta adresinizi yazın.' }); return; }
    gonder(form, async () => {
      await app.api.resetPassword(email, location.origin + location.pathname);
      const tamam = kok.querySelector('#sifirla-tamam');
      tamam.textContent = 'Bu e-posta kayıtlıysa şifre sıfırlama bağlantısı gönderildi. Bağlantıyı bu cihazdaki tarayıcıda açın.';
      tamam.hidden = false;
    });
  });
}

export function yeniSifreEkrani(app, { onDone }) {
  const kok = document.getElementById('app');
  mount(kok, kart(html`
    <h1>Yeni şifre belirleyin</h1>
    <p class="auth-sub">En az 10 karakter kullanın. Başka sitelerde kullanmadığınız bir şifre seçin.</p>
    <form class="form" novalidate id="yeni-sifre-formu">
      ${sifreAlani('password', 'Yeni şifre', 'new-password')}
      ${sifreAlani('password2', 'Yeni şifre (tekrar)', 'new-password')}
      <div class="form-error" role="alert" hidden></div>
      <button type="submit" class="btn btn-primary btn-block">Şifreyi kaydet</button>
    </form>`));
  sifreGoster(kok);
  const form = kok.querySelector('#yeni-sifre-formu');
  form.password.focus();
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const hatalar = sifreHatalari(form.password.value, form.password2.value);
    if (Object.keys(hatalar).length) { showFieldErrors(form, hatalar); return; }
    gonder(form, async () => { await app.api.updatePassword(form.password.value); await onDone(); });
  });
}

/** Ortak şifre kuralları (giriş ekranı ve "Şifre değiştir" penceresi). */
export function sifreHatalari(sifre, tekrar) {
  const h = {};
  if (sifre.length < 10) h.password = 'Şifre en az 10 karakter olmalıdır.';
  else if (/^(.)\1+$/.test(sifre)) h.password = 'Şifre tek bir karakterin tekrarı olamaz.';
  if (!h.password && sifre !== tekrar) h.password2 = 'Şifreler aynı değil.';
  return h;
}

export function erisimYokEkrani(app, neden) {
  const kok = document.getElementById('app');
  mount(kok, kart(html`
    <h1>Hesabınız kuruma tanımlı değil</h1>
    <p class="auth-sub">${neden}</p>
    <button type="button" class="btn btn-secondary btn-block" id="cikis">${icon('logout', 18)} Çıkış yap</button>`));
  kok.querySelector('#cikis').addEventListener('click', () => app.cikis());
}

export function yuklemeEkrani(mesaj = 'Yükleniyor…') {
  mount(document.getElementById('app'), html`<main class="auth" id="main"><div class="auth-card auth-loading" role="status">
    <div class="auth-brand">${logo(40)}<span class="auth-brand-ad">OSGB 360</span></div><p class="auth-sub">${mesaj}</p></div></main>`);
}

export function olumcul(mesaj) {
  const kok = document.getElementById('app');
  mount(kok, kart(html`
    <h1>Uygulama açılamadı</h1>
    <p class="auth-sub">${mesaj}</p>
    <button type="button" class="btn btn-primary btn-block" id="yenile">Sayfayı yenile</button>`));
  kok.querySelector('#yenile').addEventListener('click', () => location.reload());
}
