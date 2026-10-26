// OSGB 360 - Uygulama kabuğu: kenar menü, üst çubuk, arama (Ctrl/⌘+K), tema, kullanıcı menüsü.
import { html, mount, ilkAd, icerir, trSirala } from '../lib/format.js';
import { icon } from './icons.js';
import { avatar, attachMenu, openModal, openFormModal, toast } from './components.js';
import { logo, sifreHatalari } from '../pages/auth.js';
import { MENU, GRUPLAR, ROL_ADLARI } from '../modules.js';
import { firmaFormuAc } from '../pages/firmalar.js';
import { kisiFormuAc } from '../pages/kisiler.js';
import { leadFormuAc } from '../pages/crm.js';
import { gorevFormuAc } from '../pages/gorevler.js';
import { field } from './components.js';

const DEPO = { tema: 'osgb-tema', menu: 'osgb-menu-dar' };
const oku = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const yaz = (k, v) => { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* depolama kapalı olabilir */ } };

export function temaUygula(tema) {
  const kok = document.documentElement;
  if (tema === 'dark' || tema === 'light') kok.setAttribute('data-theme', tema); else kok.removeAttribute('data-theme');
}
const gecerliTema = () => {
  const t = oku(DEPO.tema);
  if (t === 'dark' || t === 'light') return t;
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
};

export function kabukKur(app) {
  const rol = ROL_ADLARI[app.ctx.role.key] ?? app.ctx.role.name;
  const ogeler = MENU.filter((m) => app.can(m.modul, 'view'));
  const gruplar = GRUPLAR.map((g) => ({ ...g, ogeler: ogeler.filter((o) => o.grup === g.id) })).filter((g) => g.ogeler.length);
  const etiket = (o) => (o.yapildi ? '' : html`<span class="nav-tag">${o.asama ? `Aşama ${o.asama}` : 'Yakında'}</span>`);

  const yeniOgeleri = [
    app.can('companies', 'create') && { id: 'yeni-firma', ad: 'Yeni firma', simge: 'building' },
    app.can('contacts', 'create') && { id: 'yeni-kisi', ad: 'Yeni kişi', simge: 'contact' },
    app.can('crm', 'create') && { id: 'yeni-aday', ad: 'Yeni potansiyel müşteri', simge: 'target' },
    app.can('tasks', 'create') && { id: 'yeni-gorev', ad: 'Yeni görev', simge: 'checksq' },
  ].filter(Boolean);

  const dar = oku(DEPO.menu) === '1';
  mount(document.getElementById('app'), html`<div class="shell ${dar ? 'shell-dar' : ''}" id="kabuk">
    <a class="skip" href="#main-icerik">İçeriğe geç</a>
    <aside class="sidebar" id="yan-menu" aria-label="Ana menü">
      <div class="side-brand">${logo(36)}<span class="side-brand-ad">OSGB 360</span></div>
      <nav class="side-nav">
        ${gruplar.map((g) => html`<div class="nav-grup"><div class="nav-grup-ad">${g.ad}</div>
          ${g.ogeler.map((o) => html`<a class="nav-item ${o.yapildi ? '' : 'nav-bekliyor'}" href="#/${o.id}" data-nav="${o.id}" title="${o.ad}">
            ${icon(o.simge, 20)}<span class="nav-ad">${o.ad}</span>${etiket(o)}</a>`)}</div>`)}
      </nav>
      <button type="button" class="side-collapse" id="menu-daralt" aria-label="Menüyü daralt" aria-pressed="${dar}">${icon('panel', 18)}<span class="nav-ad">Menüyü daralt</span></button>
    </aside>
    <div class="side-scrim" id="menu-perde" hidden></div>
    <div class="main-col">
      <header class="topbar">
        <button type="button" class="icon-btn menu-ac" id="menu-ac" aria-label="Menüyü aç" aria-controls="yan-menu" aria-expanded="false">${icon('menu', 22)}</button>
        <button type="button" class="search-trigger" id="ara-ac" aria-label="Ara (Ctrl+K)">${icon('search', 18)}<span class="st-metin">Firma veya kişi ara…</span><kbd class="st-kbd">Ctrl K</kbd></button>
        <div class="topbar-sag">
          ${yeniOgeleri.length ? html`<div class="menu-wrap"><button type="button" class="btn btn-primary btn-sm" id="yeni-dugme" aria-haspopup="menu" aria-expanded="false">${icon('plus', 16)} Yeni</button>
            <div class="menu" id="yeni-menu" role="menu" hidden>${yeniOgeleri.map((y) => html`<button type="button" role="menuitem" class="menu-item" data-yeni="${y.id}">${icon(y.simge, 18)} ${y.ad}</button>`)}</div></div>` : ''}
          <button type="button" class="icon-btn" id="tema-dugme" aria-label="Tema değiştir">${icon(gecerliTema() === 'dark' ? 'sun' : 'moon', 20)}</button>
          <div class="menu-wrap"><button type="button" class="user-btn" id="kullanici-dugme" aria-haspopup="menu" aria-expanded="false">
            ${avatar(app.ctx.user.full_name, 'sm')}<span class="user-ad"><strong>${ilkAd(app.ctx.user.full_name)}</strong><small>${rol}</small></span>${icon('chevronD', 16)}</button>
            <div class="menu menu-sag" id="kullanici-menu" role="menu" hidden>
              <div class="menu-baslik"><strong>${app.ctx.user.full_name}</strong><small>${app.ctx.user.email ?? ''}</small></div>
              <button type="button" role="menuitem" class="menu-item" data-kmenu="sifre">${icon('key', 18)} Şifre değiştir</button>
              <button type="button" role="menuitem" class="menu-item" data-kmenu="cikis">${icon('logout', 18)} Çıkış yap</button></div></div>
        </div>
      </header>
      <main class="page" id="main-icerik" tabindex="-1"><div id="sayfa"></div></main>
    </div>
  </div>`);

  const kabuk = document.getElementById('kabuk');
  const menu = document.getElementById('yan-menu');
  const perde = document.getElementById('menu-perde');
  const acBtn = document.getElementById('menu-ac');

  // ---- mobil menü
  const mobilKapat = () => { menu.classList.remove('acik'); perde.hidden = true; acBtn.setAttribute('aria-expanded', 'false'); };
  acBtn.addEventListener('click', () => { menu.classList.add('acik'); perde.hidden = false; acBtn.setAttribute('aria-expanded', 'true'); menu.querySelector('a')?.focus(); });
  perde.addEventListener('click', mobilKapat);
  menu.addEventListener('click', (e) => { if (e.target.closest('a')) mobilKapat(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && menu.classList.contains('acik')) { mobilKapat(); acBtn.focus(); } });

  // ---- daralt
  const daralt = document.getElementById('menu-daralt');
  daralt.addEventListener('click', () => {
    const simdi = kabuk.classList.toggle('shell-dar');
    daralt.setAttribute('aria-pressed', String(simdi));
    yaz(DEPO.menu, simdi ? '1' : '0');
  });

  // ---- tema
  const temaBtn = document.getElementById('tema-dugme');
  temaBtn.addEventListener('click', () => {
    const yeni = gecerliTema() === 'dark' ? 'light' : 'dark';
    yaz(DEPO.tema, yeni); temaUygula(yeni);
    temaBtn.innerHTML = icon(yeni === 'dark' ? 'sun' : 'moon', 20).s;
  });

  // ---- menüler
  if (yeniOgeleri.length) {
    attachMenu(document.getElementById('yeni-dugme'), document.getElementById('yeni-menu'));
    document.getElementById('yeni-menu').addEventListener('click', (e) => {
      const d = e.target.closest('[data-yeni]');
      if (!d) return;
      if (d.dataset.yeni === 'yeni-firma') firmaFormuAc(app);
      else if (d.dataset.yeni === 'yeni-aday') leadFormuAc(app);
      else if (d.dataset.yeni === 'yeni-gorev') gorevFormuAc(app);
      else kisiFormuAc(app);
    });
  }
  attachMenu(document.getElementById('kullanici-dugme'), document.getElementById('kullanici-menu'));
  document.getElementById('kullanici-menu').addEventListener('click', (e) => {
    const d = e.target.closest('[data-kmenu]');
    if (!d) return;
    if (d.dataset.kmenu === 'cikis') app.cikis(); else sifreDegistir(app);
  });

  // ---- arama
  document.getElementById('ara-ac').addEventListener('click', () => aramaAc(app));
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); aramaAc(app); }
  });

  return {
    sayfaKok: document.getElementById('sayfa'),
    aktifEt(id) {
      kabuk.querySelectorAll('[data-nav]').forEach((a) => {
        const acik = a.dataset.nav === id;
        a.classList.toggle('nav-on', acik);
        if (acik) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
      });
    },
    odakla() { document.getElementById('main-icerik')?.focus({ preventScroll: true }); },
  };
}

// ---------------------------------------------------------------- şifre değiştir
function sifreDegistir(app) {
  openFormModal({
    baslik: 'Şifre değiştir', altBaslik: 'En az 10 karakter kullanın.', gonderEtiketi: 'Şifreyi kaydet',
    govde: html`${field({ ad: 'password', etiket: 'Yeni şifre', tur: 'password', zorunlu: true, tam: true, otomatik: 'new-password' })}
      ${field({ ad: 'password2', etiket: 'Yeni şifre (tekrar)', tur: 'password', zorunlu: true, tam: true, otomatik: 'new-password' })}`,
    async onSubmit(fd) {
      const h = sifreHatalari(String(fd.get('password') ?? ''), String(fd.get('password2') ?? ''));
      if (Object.keys(h).length) return { errors: h };
      await app.api.updatePassword(String(fd.get('password')));
      toast('Şifreniz değiştirildi.');
    },
  });
}

// ---------------------------------------------------------------- arama penceresi
let onbellek = null;

export function aramaOnbellegiTemizle() { onbellek = null; }

async function aramaVerisi(app) {
  if (onbellek) return onbellek;
  const firmalar = app.can('companies', 'view') ? await app.api.listCompanies() : [];
  const kisiler = app.can('contacts', 'view') ? await app.api.listContacts() : [];
  const firmaAdi = new Map(firmalar.map((f) => [f.id, f.name]));
  onbellek = [
    ...firmalar.filter((f) => !f.archived_at).map((f) => ({
      tur: 'Firma', simge: 'building', ad: f.name, alt: [f.tax_no, f.city].filter(Boolean).join(' · '), href: `#/firmalar/${f.id}`,
      anahtar: [f.name, f.tax_no, f.city, f.district, f.sector].filter(Boolean).join(' '),
    })),
    ...kisiler.filter((k) => !k.archived_at).map((k) => ({
      tur: 'Kişi', simge: 'contact', ad: k.full_name, alt: [firmaAdi.get(k.company_id), k.title].filter(Boolean).join(' · '),
      href: k.company_id ? `#/firmalar/${k.company_id}` : '#/kisiler',
      anahtar: [k.full_name, k.email, k.phone, firmaAdi.get(k.company_id)].filter(Boolean).join(' '),
    })),
  ].sort((a, b) => trSirala(a.ad, b.ad));
  return onbellek;
}

function aramaAc(app) {
  if (document.querySelector('.search-modal')) return;
  const m = openModal({
    baslik: 'Ara', boyut: 'md',
    govde: html`<div class="search-modal">
      <div class="search-field">${icon('search', 18)}<input type="search" id="genel-ara" placeholder="Firma adı, vergi no, kişi, telefon…" aria-label="Firma veya kişi ara" autocomplete="off"></div>
      <ul class="sonuc-liste" id="ara-sonuc" role="listbox" aria-label="Arama sonuçları"></ul></div>`,
  });
  const girdi = m.el.querySelector('#genel-ara');
  const liste = m.el.querySelector('#ara-sonuc');
  let secili = 0;
  let sonuclar = [];
  const ciz = () => {
    liste.innerHTML = sonuclar.length
      ? sonuclar.map((s, i) => html`<li role="option" aria-selected="${i === secili}"><a class="sonuc ${i === secili ? 'sonuc-on' : ''}" href="${s.href}">${icon(s.simge, 18)}<span><strong>${s.ad}</strong><small>${s.alt}</small></span><span class="pill pill-neutral">${s.tur}</span></a></li>`).map((x) => x.s).join('')
      : html`<li class="sonuc-bos">${girdi.value.trim() ? 'Eşleşen kayıt yok.' : 'Aramak için yazmaya başlayın.'}</li>`.s;
  };
  ciz();
  aramaVerisi(app).then((veri) => {
    const filtre = () => {
      const q = girdi.value.trim();
      sonuclar = q ? veri.filter((v) => icerir(v.anahtar, q)).slice(0, 8) : [];
      secili = 0; ciz();
    };
    girdi.addEventListener('input', filtre); filtre();
  }).catch(() => { liste.innerHTML = '<li class="sonuc-bos">Arama verisi yüklenemedi.</li>'; });
  m.el.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!sonuclar.length) return;
      secili = (secili + (e.key === 'ArrowDown' ? 1 : -1) + sonuclar.length) % sonuclar.length; ciz(); e.preventDefault();
    } else if (e.key === 'Enter' && sonuclar[secili]) {
      e.preventDefault(); location.hash = sonuclar[secili].href; m.close();
    }
  });
  liste.addEventListener('click', (e) => { if (e.target.closest('a')) m.close(); });
}
