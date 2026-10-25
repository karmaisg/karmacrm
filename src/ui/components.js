// OSGB 360 - Ortak arayüz bileşenleri: toast, modal, form alanları, onay penceresi, boş/hata durumları.
import { html, esc, raw, bastaHarfler, renkNo } from '../lib/format.js';
import { icon } from './icons.js';
import { humanError } from '../lib/api.js';

// ---------------------------------------------------------------- küçük parçalar
export const avatar = (ad, boyut = 'md') =>
  html`<span class="avatar av-${renkNo(ad)} av-${boyut}" aria-hidden="true">${bastaHarfler(ad)}</span>`;

export const pill = (metin, ton = 'neutral') => html`<span class="pill pill-${ton}">${metin}</span>`;

export function emptyState({ simge = 'info', baslik, metin = '', eylem = '' }) {
  return html`<div class="empty">
    <span class="empty-ic">${icon(simge, 26)}</span>
    <h3>${baslik}</h3>
    ${metin ? html`<p>${metin}</p>` : ''}
    ${eylem}
  </div>`;
}

export function errorState(mesaj, yenidenDene = true) {
  return html`<div class="empty empty-error" role="alert">
    <span class="empty-ic">${icon('alert', 26)}</span>
    <h3>Sayfa yüklenemedi</h3>
    <p>${mesaj}</p>
    ${yenidenDene ? html`<button class="btn btn-secondary" type="button" data-action="retry">Yeniden dene</button>` : ''}
  </div>`;
}

export const skeleton = () => html`<div class="skeleton" aria-busy="true" aria-label="Yükleniyor">
  <div class="sk sk-title"></div><div class="sk-row"><div class="sk sk-card"></div><div class="sk sk-card"></div><div class="sk sk-card"></div></div><div class="sk sk-block"></div>
</div>`;

// ---------------------------------------------------------------- toast
export function toast(mesaj, tur = 'basari') {
  const kap = document.getElementById('toasts');
  if (!kap) return;
  const el = document.createElement('div');
  el.className = `toast toast-${tur}`;
  el.setAttribute('role', tur === 'hata' ? 'alert' : 'status');
  el.innerHTML = html`<span class="toast-ic">${icon(tur === 'hata' ? 'alert' : tur === 'bilgi' ? 'info' : 'check', 18)}</span>
    <span class="toast-msg">${mesaj}</span>
    <button type="button" class="toast-x" aria-label="Kapat">${icon('x', 16)}</button>`.s;
  const kapat = () => el.remove();
  el.querySelector('.toast-x').addEventListener('click', kapat);
  kap.appendChild(el);
  setTimeout(kapat, tur === 'hata' ? 9000 : 5000);
}

// ---------------------------------------------------------------- modal
const ODAKLANABILIR = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
let acikModalSayisi = 0;

export function openModal({ baslik, altBaslik = '', govde, boyut = 'md', arkaPlanKapatir = true, onClose = null }) {
  const onceki = document.activeElement;
  const kaplama = document.createElement('div');
  kaplama.className = 'modal-overlay';
  const kimlik = `modal-${Math.random().toString(36).slice(2, 8)}`;
  kaplama.innerHTML = html`<div class="modal modal-${boyut}" role="dialog" aria-modal="true" aria-labelledby="${kimlik}-t" tabindex="-1">
    <div class="modal-head">
      <div><h2 id="${kimlik}-t">${baslik}</h2>${altBaslik ? html`<p class="modal-sub">${altBaslik}</p>` : ''}</div>
      <button type="button" class="icon-btn" data-close aria-label="Kapat">${icon('x', 20)}</button>
    </div>
    <div class="modal-body">${govde}</div>
  </div>`.s;
  document.body.appendChild(kaplama);
  document.body.classList.add('modal-open');
  acikModalSayisi += 1;
  const pencere = kaplama.querySelector('.modal');
  let kapali = false;

  const kapat = () => {
    if (kapali) return;
    kapali = true;
    kaplama.remove();
    acikModalSayisi -= 1;
    if (acikModalSayisi <= 0) document.body.classList.remove('modal-open');
    document.removeEventListener('keydown', tus, true);
    if (onceki && document.contains(onceki)) onceki.focus();
    onClose?.();
  };
  const tus = (e) => {
    if (!kaplama.isConnected) return;
    // yalnızca en üstteki modal tuşları işler
    const hepsi = document.querySelectorAll('.modal-overlay');
    if (hepsi[hepsi.length - 1] !== kaplama) return;
    if (e.key === 'Escape') { e.stopPropagation(); kapat(); return; }
    if (e.key !== 'Tab') return;
    const liste = [...pencere.querySelectorAll(ODAKLANABILIR)].filter((x) => x.offsetParent !== null || x === document.activeElement);
    if (!liste.length) { e.preventDefault(); return; }
    const ilk = liste[0], son = liste[liste.length - 1];
    if (e.shiftKey && (document.activeElement === ilk || document.activeElement === pencere)) { e.preventDefault(); son.focus(); }
    else if (!e.shiftKey && document.activeElement === son) { e.preventDefault(); ilk.focus(); }
  };
  document.addEventListener('keydown', tus, true);
  kaplama.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) { kapat(); return; }
    if (arkaPlanKapatir && e.target === kaplama) kapat();
  });
  const ilkAlan = pencere.querySelector('.modal-body input:not([type="hidden"]):not([disabled]), .modal-body select:not([disabled]), .modal-body textarea:not([disabled])');
  (ilkAlan ?? pencere).focus();
  return { el: kaplama, pencere, close: kapat };
}

export function confirmDialog({ baslik, mesaj, onayEtiketi = 'Onayla', tehlikeli = false }) {
  return new Promise((coz) => {
    let sonuc = false;
    const m = openModal({
      baslik, boyut: 'sm', arkaPlanKapatir: false,
      govde: html`<p class="confirm-msg">${mesaj}</p>
        <div class="modal-actions">
          <button type="button" class="btn btn-secondary" data-close>Vazgeç</button>
          <button type="button" class="btn ${tehlikeli ? 'btn-danger' : 'btn-primary'}" data-ok>${onayEtiketi}</button>
        </div>`,
      onClose: () => coz(sonuc),
    });
    m.el.querySelector('[data-ok]').addEventListener('click', () => { sonuc = true; m.close(); });
    m.el.querySelector('[data-ok]').focus();
  });
}

// ---------------------------------------------------------------- form alanları
const kimlikOf = (ad) => `f-${ad}`;

/** Tek satırlık, seçimli veya çok satırlı form alanı. Değerler kaçışlanır. */
export function field({
  ad, etiket, tur = 'text', deger = '', zorunlu = false, ipucu = '', yerTutucu = '', secenekler = null,
  satir = 3, otomatik = 'off', inputmode = '', maksUzunluk = '', min = '', max = '', adim = '', tam = false, pasif = false,
}) {
  const id = kimlikOf(ad);
  const tarif = `${ipucu ? `h-${ad} ` : ''}e-${ad}`.trim();
  let kontrol;
  if (secenekler) {
    kontrol = html`<select id="${id}" name="${ad}" ${zorunlu ? raw('required') : ''} ${pasif ? raw('disabled') : ''} aria-describedby="${tarif}">
      ${secenekler.map((s) => html`<option value="${s.deger}" ${String(s.deger) === String(deger ?? '') ? raw('selected') : ''}>${s.etiket}</option>`)}
    </select>`;
  } else if (tur === 'textarea') {
    kontrol = html`<textarea id="${id}" name="${ad}" rows="${satir}" ${maksUzunluk ? html`maxlength="${maksUzunluk}"` : ''} ${pasif ? raw('disabled') : ''} aria-describedby="${tarif}" placeholder="${yerTutucu}">${deger ?? ''}</textarea>`;
  } else {
    kontrol = html`<input id="${id}" name="${ad}" type="${tur}" value="${deger ?? ''}" placeholder="${yerTutucu}" autocomplete="${otomatik}"
      ${zorunlu ? raw('required') : ''} ${pasif ? raw('disabled') : ''} ${inputmode ? html`inputmode="${inputmode}"` : ''}
      ${maksUzunluk ? html`maxlength="${maksUzunluk}"` : ''} ${min !== '' ? html`min="${min}"` : ''} ${max !== '' ? html`max="${max}"` : ''}
      ${adim !== '' ? html`step="${adim}"` : ''} aria-describedby="${tarif}">`;
  }
  return html`<div class="field ${tam ? 'field-full' : ''}" data-field="${ad}">
    <label for="${id}">${etiket}${zorunlu ? html` <span class="req" aria-hidden="true">*</span><span class="sr-only"> (zorunlu)</span>` : ''}</label>
    ${kontrol}
    ${ipucu ? html`<div class="field-hint" id="h-${ad}">${ipucu}</div>` : ''}
    <div class="field-error" id="e-${ad}" role="alert"></div>
  </div>`;
}

export function checkbox({ ad, etiket, isaretli = false, ipucu = '' }) {
  return html`<div class="field field-full field-check" data-field="${ad}">
    <label class="check"><input type="checkbox" id="${kimlikOf(ad)}" name="${ad}" value="1" ${isaretli ? raw('checked') : ''}> <span>${etiket}</span></label>
    ${ipucu ? html`<div class="field-hint">${ipucu}</div>` : ''}
  </div>`;
}

export function showFieldErrors(form, hatalar) {
  form.querySelectorAll('.field-error').forEach((e) => { e.textContent = ''; });
  form.querySelectorAll('[aria-invalid]').forEach((e) => e.removeAttribute('aria-invalid'));
  let ilk = null;
  for (const [ad, mesaj] of Object.entries(hatalar ?? {})) {
    const hata = form.querySelector(`#e-${CSS.escape(ad)}`);
    const girdi = form.querySelector(`[name="${CSS.escape(ad)}"]`);
    if (hata) hata.textContent = mesaj;
    if (girdi) { girdi.setAttribute('aria-invalid', 'true'); ilk ??= girdi; }
  }
  ilk?.focus();
}

/**
 * Form içeren modal. onSubmit(formData) -> { errors } döndürürse modal açık kalır ve alan hataları gösterilir;
 * hiçbir şey döndürmezse modal kapanır. Fırlatılan hata form üstünde Türkçe mesajla gösterilir.
 */
export function openFormModal({ baslik, altBaslik = '', govde, gonderEtiketi = 'Kaydet', boyut = 'md', onSubmit, onDone = null }) {
  const m = openModal({
    baslik, altBaslik, boyut, arkaPlanKapatir: false,
    govde: html`<form class="form" novalidate>
      <div class="form-grid">${govde}</div>
      <div class="form-error" role="alert" hidden></div>
      <div class="modal-actions">
        <button type="button" class="btn btn-secondary" data-close>Vazgeç</button>
        <button type="submit" class="btn btn-primary">${gonderEtiketi}</button>
      </div>
    </form>`,
  });
  const form = m.el.querySelector('form');
  const formHata = form.querySelector('.form-error');
  const gonder = form.querySelector('button[type="submit"]');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (gonder.disabled) return;
    formHata.hidden = true; formHata.textContent = '';
    showFieldErrors(form, {});
    gonder.disabled = true;
    const eski = gonder.textContent;
    gonder.textContent = 'Kaydediliyor…';
    form.setAttribute('aria-busy', 'true');
    let kapanis = false;
    try {
      const sonuc = await onSubmit(new FormData(form), form);
      if (sonuc?.kal) {
        /* kullanıcı bir onayı reddetti: pencere açık kalır, mesaj gösterilmez */
      } else if (sonuc?.errors && Object.keys(sonuc.errors).length) {
        showFieldErrors(form, sonuc.errors);
      } else if (sonuc?.formError) {
        formHata.textContent = sonuc.formError; formHata.hidden = false;
      } else {
        kapanis = true;
      }
    } catch (err) {
      formHata.textContent = humanError(err);
      formHata.hidden = false;
    } finally {
      form.removeAttribute('aria-busy');
      if (!kapanis) { gonder.disabled = false; gonder.textContent = eski; }
    }
    if (kapanis) { m.close(); await onDone?.(); }
  });
  return m;
}

// ---------------------------------------------------------------- açılır menü
export function attachMenu(dugme, menu) {
  const kapat = () => { menu.hidden = true; dugme.setAttribute('aria-expanded', 'false'); };
  const ac = () => {
    menu.hidden = false; dugme.setAttribute('aria-expanded', 'true');
    menu.querySelector('a, button')?.focus();
  };
  dugme.addEventListener('click', (e) => { e.stopPropagation(); menu.hidden ? ac() : kapat(); });
  document.addEventListener('click', (e) => { if (!menu.hidden && !menu.contains(e.target) && e.target !== dugme) kapat(); });
  menu.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { kapat(); dugme.focus(); }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const ogeler = [...menu.querySelectorAll('a, button')];
      const i = ogeler.indexOf(document.activeElement);
      const sonraki = ogeler[(i + (e.key === 'ArrowDown' ? 1 : -1) + ogeler.length) % ogeler.length];
      sonraki?.focus(); e.preventDefault();
    }
  });
  menu.addEventListener('click', (e) => { if (e.target.closest('a, button')) kapat(); });
  return { kapat };
}

export function sayfalama({ sayfa, sayfaSayisi, toplam, sayfaBasi }) {
  if (toplam <= sayfaBasi) return html`<div class="pager"><span class="pager-info">${toplam} kayıt</span></div>`;
  const bas = (sayfa - 1) * sayfaBasi + 1;
  const son = Math.min(sayfa * sayfaBasi, toplam);
  return html`<nav class="pager" aria-label="Sayfalama">
    <span class="pager-info">${toplam} kayıttan ${bas}–${son} arası</span>
    <div class="pager-btns">
      <button type="button" class="btn btn-secondary btn-sm" data-sayfa="${sayfa - 1}" ${sayfa <= 1 ? raw('disabled') : ''}>${icon('chevronL', 16)} Önceki</button>
      <span class="pager-no" aria-current="page">${sayfa} / ${sayfaSayisi}</span>
      <button type="button" class="btn btn-secondary btn-sm" data-sayfa="${sayfa + 1}" ${sayfa >= sayfaSayisi ? raw('disabled') : ''}>Sonraki ${icon('chevronR', 16)}</button>
    </div>
  </nav>`;
}

export { esc };
