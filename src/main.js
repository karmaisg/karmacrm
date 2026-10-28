// OSGB 360 - Uygulama başlatıcı: oturum, yetki bağlamı, yönlendirme.
import { html, mount } from './lib/format.js';
import { createDb } from './lib/supabase.js';
import { createApi, humanError } from './lib/api.js';
import { rotaAyir, git, dinle } from './lib/router.js';
import { kabukKur, aramaOnbellegiTemizle, temaUygula } from './ui/shell.js';
import { errorState, skeleton, toast } from './ui/components.js';
import { icon } from './ui/icons.js';
import {
  girisEkrani, yeniSifreEkrani, erisimYokEkrani, yuklemeEkrani, olumcul,
} from './pages/auth.js';
import { MENU, menuOgesi } from './modules.js';
import { panelSayfasi } from './pages/panel.js';
import { firmalarSayfasi } from './pages/firmalar.js';
import { firmaSayfasi } from './pages/firma.js';
import { kisilerSayfasi } from './pages/kisiler.js';
import { kullanicilarSayfasi } from './pages/kullanicilar.js';
import { crmSayfasi, leadSayfasi } from './pages/crm.js';
import { firsatlarSayfasi } from './pages/firsatlar.js';
import { gorevlerSayfasi } from './pages/gorevler.js';
import { tekliflerSayfasi, teklifSayfasi } from './pages/teklifler.js';
import { sozlesmelerSayfasi, sozlesmeSayfasi } from './pages/sozlesmeler.js';
import { tahsilatSayfasi } from './pages/faturalar.js';
import { giderlerSayfasi } from './pages/giderler.js';
import { personelListeSayfasi, personelSayfasi } from './pages/personel.js';
import { gorevlendirmelerSayfasi } from './pages/gorevlendirmeler.js';
import { zamanSayfasi } from './pages/zaman.js';
import { kapasiteSayfasi } from './pages/kapasite.js';
import { yakindaSayfasi } from './pages/placeholder.js';

const app = {
  api: null,
  ctx: null,
  can: () => false,
  git,
  yenile: () => sayfayiCiz(),
  aramaOnbellegiTemizle,
  async cikis() {
    try { await app.api.signOut(); } catch (e) { toast(humanError(e), 'hata'); }
  },
};

let kabuk = null;
let kullaniciId = null;
let kurtarma = false;      // şifre sıfırlama bağlantısıyla gelindi
let cizimNo = 0;
let kopyalaSilici = null;

// ---------------------------------------------------------------- yönlendirme
function rotaCoz(parcalar) {
  const [ilk = 'panel', ikinci] = parcalar;
  if (ilk === 'panel') return { menu: 'panel', modul: 'dashboard', yukle: () => panelSayfasi(app) };
  if (ilk === 'firmalar' && ikinci) return { menu: 'firmalar', modul: 'companies', yukle: () => firmaSayfasi(app, ikinci) };
  if (ilk === 'firmalar') return { menu: 'firmalar', modul: 'companies', yukle: () => firmalarSayfasi(app) };
  if (ilk === 'kisiler') return { menu: 'kisiler', modul: 'contacts', yukle: () => kisilerSayfasi(app) };
  if (ilk === 'crm' && ikinci) return { menu: 'crm', modul: 'crm', yukle: () => leadSayfasi(app, ikinci) };
  if (ilk === 'crm') return { menu: 'crm', modul: 'crm', yukle: () => crmSayfasi(app) };
  if (ilk === 'firsatlar') return { menu: 'firsatlar', modul: 'opportunities', yukle: () => firsatlarSayfasi(app) };
  if (ilk === 'gorevler') return { menu: 'gorevler', modul: 'tasks', yukle: () => gorevlerSayfasi(app) };
  if (ilk === 'teklifler' && ikinci) return { menu: 'teklifler', modul: 'offers', yukle: () => teklifSayfasi(app, ikinci) };
  if (ilk === 'teklifler') return { menu: 'teklifler', modul: 'offers', yukle: () => tekliflerSayfasi(app) };
  if (ilk === 'sozlesmeler' && ikinci) return { menu: 'sozlesmeler', modul: 'contracts', yukle: () => sozlesmeSayfasi(app, ikinci) };
  if (ilk === 'sozlesmeler') return { menu: 'sozlesmeler', modul: 'contracts', yukle: () => sozlesmelerSayfasi(app) };
  if (ilk === 'uzmanlar') return { menu: 'uzmanlar', modul: 'staff', yukle: () => personelListeSayfasi(app, 'is_guvenligi_uzmani') };
  if (ilk === 'hekimler') return { menu: 'hekimler', modul: 'staff', yukle: () => personelListeSayfasi(app, 'isyeri_hekimi') };
  if (ilk === 'personel' && ikinci) return { menu: 'uzmanlar', modul: 'staff', yukle: () => personelSayfasi(app, ikinci) };
  if (ilk === 'gorevlendirmeler') return { menu: 'gorevlendirmeler', modul: 'assignments', yukle: () => gorevlendirmelerSayfasi(app) };
  if (ilk === 'zaman') return { menu: 'zaman', modul: 'time', yukle: () => zamanSayfasi(app) };
  if (ilk === 'kapasite') return { menu: 'kapasite', modul: 'capacity', yukle: () => kapasiteSayfasi(app) };
  if (ilk === 'tahsilat') return { menu: 'tahsilat', modul: 'invoices', yukle: () => tahsilatSayfasi(app) };
  if (ilk === 'giderler') return { menu: 'giderler', modul: 'expenses', yukle: () => giderlerSayfasi(app) };
  if (ilk === 'kullanicilar') return { menu: 'kullanicilar', modul: 'users', yukle: () => kullanicilarSayfasi(app) };
  const o = menuOgesi(ilk);
  if (o && !o.yapildi) return { menu: o.id, modul: o.modul, yukle: async () => yakindaSayfasi(o.id) };
  return null;
}

const bulunamadi = () => ({
  baslik: 'Sayfa bulunamadı', altBaslik: '',
  govde: html`<section class="card"><div class="empty"><span class="empty-ic">${icon('search', 26)}</span><h3>Bu adreste sayfa yok</h3>
    <a class="btn btn-secondary" href="#/panel">Panele dön</a></div></section>`,
});

const yetkisiz = () => ({
  baslik: 'Erişim izni yok', altBaslik: '',
  govde: html`<section class="card"><div class="empty"><span class="empty-ic">${icon('lock', 26)}</span><h3>Bu sayfayı görme izniniz yok</h3>
    <p>Gerekli yetki için sistem yöneticinize başvurun.</p><a class="btn btn-secondary" href="#/panel">Panele dön</a></div></section>`,
});

function sayfaBasligi(s) {
  return html`<div class="page-head">
    <div class="page-head-sol">
      ${s.geri ? html`<a class="back-link" href="${s.geri.href}">${icon('arrowL', 16)} ${s.geri.ad}</a>` : ''}
      ${s.ozelBaslik ?? html`<h1>${s.baslik}</h1>`}
      ${s.altBaslik ? html`<p class="page-sub">${s.altBaslik}</p>` : ''}
    </div>
    ${s.eylemler ? html`<div class="page-actions">${s.eylemler}</div>` : ''}
  </div>`;
}

async function sayfayiCiz() {
  if (!kabuk) return;
  const no = ++cizimNo;
  const rota = rotaCoz(rotaAyir());
  const kok = kabuk.sayfaKok;
  let sayfa;
  let menuId = rota?.menu ?? '';

  if (!rota) sayfa = bulunamadi();
  else if (!app.can(rota.modul, 'view')) sayfa = yetkisiz();
  else {
    mount(kok, skeleton());
    try { sayfa = await rota.yukle(); }
    catch (e) {
      if (no !== cizimNo) return;
      console.error(e);
      mount(kok, errorState(humanError(e)));
      kabuk.aktifEt(menuId);
      return;
    }
  }
  if (no !== cizimNo) return;   // kullanıcı bu arada başka sayfaya geçti

  // Her çizimde yeni bir kap kullanılır; böylece sayfa.mount içindeki olay dinleyicileri birikmez.
  const ic = document.createElement('div');
  kok.replaceChildren(ic);
  mount(ic, html`${sayfaBasligi(sayfa)}${sayfa.govde}`);
  kabuk.aktifEt(sayfa.menu ?? menuId);
  document.title = `${sayfa.baslik} · OSGB 360`;
  window.scrollTo(0, 0);
  if (!sayfa.__odakYok) kabuk.odakla();
  sayfa.mount?.(ic);
}

// ---------------------------------------------------------------- oturum
async function uygulamayiBaslat(oturum) {
  yuklemeEkrani('Hesabınız hazırlanıyor…');
  let ctx;
  try { ctx = await app.api.loadContext(oturum.user.id); }
  catch (e) { console.error(e); olumcul(humanError(e)); return; }
  if (!ctx) {
    erisimYokEkrani(app, 'Giriş yaptınız ancak bu hesap kurumda tanımlı değil veya pasif. Sistem yöneticinizden hesabınızı eklemesini isteyin.');
    return;
  }
  app.ctx = ctx;
  app.can = (modul, eylem = 'view') => !!ctx.perms[modul]?.[eylem];
  kullaniciId = oturum.user.id;
  aramaOnbellegiTemizle();
  kabuk = kabukKur(app);
  // 90/60/30 gün yenileme görevleri sessizce üretilir (yetkisi olmayan veya hata alan kullanıcıyı etkilemez).
  if (app.can('contracts', 'view') && app.can('tasks', 'create')) app.api.createRenewalTasks().catch((e) => console.warn('yenileme görevleri', e));
  if (app.can('invoices', 'view') && app.can('companies', 'view') && app.can('tasks', 'create')) app.api.createOverdueTasks().catch((e) => console.warn('tahsilat görevleri', e));
  if (!location.hash || location.hash === '#') git('panel');
  await sayfayiCiz();
}

function cikisEkrani(bilgi = '') {
  kabuk = null; kullaniciId = null; app.ctx = null; app.can = () => false; cizimNo += 1;
  document.title = 'OSGB 360';
  girisEkrani(app, { bilgi });
}

function adresiTemizle() {
  // PKCE dönüşündeki ?code=… adres çubuğunda kalmasın
  const u = new URL(location.href);
  if (u.searchParams.has('code') || u.searchParams.has('error_description')) {
    u.searchParams.delete('code'); u.searchParams.delete('error'); u.searchParams.delete('error_code'); u.searchParams.delete('error_description');
    history.replaceState(null, '', u.pathname + (u.search || '') + u.hash);
  }
}

async function oturumOlayi(olay, oturum) {
  if (olay === 'PASSWORD_RECOVERY') {
    kurtarma = true;
    yeniSifreEkrani(app, {
      onDone: async () => { kurtarma = false; adresiTemizle(); toast('Şifreniz güncellendi.'); await uygulamayiBaslat(oturum ?? await app.api.getSession()); },
    });
    return;
  }
  if (kurtarma) return;
  if (olay === 'SIGNED_OUT' || (olay === 'INITIAL_SESSION' && !oturum)) {
    if (olay === 'SIGNED_OUT' || !kabuk) cikisEkrani();
    return;
  }
  if (olay === 'TOKEN_REFRESHED' || olay === 'USER_UPDATED') return;
  if ((olay === 'SIGNED_IN' || olay === 'INITIAL_SESSION') && oturum) {
    if (kullaniciId === oturum.user.id && kabuk) return;   // aynı oturum için tekrar başlatma
    adresiTemizle();
    await uygulamayiBaslat(oturum);
  }
}

// ---------------------------------------------------------------- açılış
document.addEventListener('click', (e) => {
  if (e.target.closest('[data-action="retry"]')) sayfayiCiz();
});

async function basla() {
  temaUygula(document.documentElement.getAttribute('data-theme'));
  yuklemeEkrani();
  try {
    const db = await createDb();
    app.api = createApi(db);
  } catch (e) {
    console.error(e);
    olumcul('Gerekli kütüphane yüklenemedi. İnternet bağlantınızı kontrol edip sayfayı yenileyin.');
    return;
  }
  dinle(() => { if (kabuk) sayfayiCiz(); });
  // Olay geri çağrımı içinde başka Supabase çağrısı yapmak kilitlenmeye yol açabilir; bir sonraki turda çalıştırılır.
  kopyalaSilici = app.api.onAuthChange((olay, oturum) => { setTimeout(() => oturumOlayi(olay, oturum), 0); });
  // Olay hiç gelmezse (ör. eski sürüm) açılış takılı kalmasın
  setTimeout(async () => {
    if (kabuk || kurtarma || document.querySelector('.auth-card:not(.auth-loading)')) return;
    try {
      const s = await app.api.getSession();
      if (s) await oturumOlayi('SIGNED_IN', s); else cikisEkrani();
    } catch (e) { olumcul(humanError(e)); }
  }, 4000);
}

window.addEventListener('unhandledrejection', (e) => { console.error(e.reason); });
basla();
void MENU; void kopyalaSilici;
