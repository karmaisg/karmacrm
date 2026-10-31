// OSGB 360 - Yönetici paneli (Aşama 2: gerçek firma verisinden özet).
import { html, bugun, ayBasi, ayAdi, sayi, ondalik2, selamlama, ilkAd, tarih, TEHLIKE, TEHLIKE_SIRASI } from '../lib/format.js';
import { icon } from '../ui/icons.js';
import { avatar, emptyState } from '../ui/components.js';
import { firmaAylikIhtiyac } from '../lib/hesaplama.js';
import { profilleriGrupla, guncelProfil, kapasiteDakika } from '../lib/veri.js';
import { tehlikePill } from './firmalar.js';
import { yanitHaritasi, yanitDurumu } from '../lib/musteri.js';
import { huniOzeti, takipDurumu } from '../lib/puanlama.js';
import { para } from '../lib/format.js';
import { gorevZamani } from './gorevler.js';
import { sozlesmeOzeti } from './sozlesmeler.js';
import { finansOzeti } from '../lib/finans.js';
import { para2 } from '../lib/format.js';

export async function panelSayfasi(app) {
  const ad = ilkAd(app.ctx.user.full_name);
  const baslik = `${selamlama()}${ad ? `, ${ad}` : ''}`;
  const gorebilir = app.can('companies', 'view');

  if (!gorebilir) {
    return {
      baslik, altBaslik: 'OSGB 360 yönetim paneli',
      govde: emptyState({ simge: 'lock', baslik: 'Panel özetini görme izniniz yok', metin: 'Soldaki menüden yetkiniz olan modüllere geçebilirsiniz.' }),
    };
  }

  const [firmalar, profiller, kurallar, ayarlar, firsatlar, gorevler, adaylar, teklifler, sozlesmeler, sozlesmeFiyatlari, faturalar, tahsilatlar, yanitlar] = await Promise.all([
    app.api.listCompanies(), app.api.listAllProfiles(), app.api.listServiceRules(), app.api.listSettings(),
    app.can('opportunities', 'view') ? app.api.listOpportunities() : [],
    app.can('tasks', 'view') ? app.api.listTasks() : [],
    app.can('crm', 'view') ? app.api.listLeads() : [],
    app.can('offers', 'view') ? app.api.listOffers() : [],
    app.can('contracts', 'view') ? app.api.listContracts() : [],
    app.can('contracts', 'view') ? app.api.listAllContractPrices() : [],
    app.can('invoices', 'view') ? app.api.listInvoices() : [],
    app.can('invoices', 'view') ? app.api.listPayments() : [],
    app.can('offers', 'view') ? app.api.listOfferResponses().catch(() => []) : [],
  ]);
  const bugunStr = bugun();
  const ay = ayBasi(bugunStr);
  const harita = profilleriGrupla(profiller);
  const aktif = firmalar.filter((f) => !f.archived_at);
  const musteriler = aktif.filter((f) => f.customer_status === 'musteri');
  const kap = kapasiteDakika(ayarlar, ay);

  let calisan = 0, uzmanDk = 0, hekimDk = 0;
  const eksikProfil = [];
  const eksikKural = [];
  const ayortasi = [];
  const dagilim = { az_tehlikeli: 0, tehlikeli: 0, cok_tehlikeli: 0 };
  for (const f of musteriler) {
    const liste = harita.get(f.id);
    const p = guncelProfil(liste, bugunStr);
    if (!p) { eksikProfil.push(f); continue; }
    calisan += p.employee_count;
    dagilim[p.hazard_class] += 1;
    const s = firmaAylikIhtiyac({ profiller: liste, kurallar, ay });
    if (!s.profil) { ayortasi.push(f); continue; } // kayıt bu ay içinde başladı; hesap sonraki ayın 1'inden itibaren
    if (s.eksik || s.uzmanDakika === null || s.hekimDakika === null) { eksikKural.push(f); continue; }
    uzmanDk += s.uzmanDakika; hekimDk += s.hekimDakika;
  }
  const hesaplananFirma = musteriler.length - eksikProfil.length;
  const kisiSayisi = (dk) => dk / kap;

  const kpi = (etiket, deger, alt, simge) => html`<section class="card kpi"><span class="kpi-ic">${icon(simge, 22)}</span>
    <div><div class="kpi-l">${etiket}</div><div class="kpi-v">${deger}</div><div class="kpi-s">${alt}</div></div></section>`;

  const enBuyuk = Math.max(1, ...Object.values(dagilim));
  const dagilimHtml = hesaplananFirma
    ? html`<ul class="bars" aria-label="Tehlike sınıfına göre müşteri sayısı">${TEHLIKE_SIRASI.map((k, i) => html`<li>
        <span class="bars-l">${TEHLIKE[k]}</span>
        <span class="bars-track"><span class="bars-fill bars-sev${i + 1}" data-w="${Math.round((dagilim[k] / enBuyuk) * 100)}"></span></span>
        <span class="bars-n">${sayi(dagilim[k])}</span></li>`)}</ul>`
    : html`<p class="muted">Çalışan sayısı girilmiş müşteri olunca dağılım burada görünür.</p>`;

  const son = [...aktif].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).slice(0, 5);
  const eksikSayisi = eksikProfil.length + eksikKural.length + ayortasi.length;

  const huni = huniOzeti(firsatlar);
  const gecikenTakip = adaylar.filter((l) => !l.archived_at && !l.converted_company_id && takipDurumu(l.next_follow_up_date, bugunStr) === 'gecikmis');
  const satisKarti = () => (!app.can('opportunities', 'view') && !app.can('crm', 'view') ? '' : html`<section class="card"><h2 class="card-title">Satış özeti</h2>
    <ul class="list">
      ${app.can('opportunities', 'view') ? html`<li><a class="link" href="#/firsatlar">Açık satış fırsatı</a><strong>${sayi(huni.acik.adet)} · ${para(huni.acik.tutar)}/ay</strong></li>` : ''}
      ${app.can('crm', 'view') ? html`<li><a class="link" href="#/crm">Açık potansiyel müşteri</a><strong>${sayi(adaylar.filter((l) => !l.archived_at && !l.converted_company_id).length)}</strong></li>
        <li><a class="link" href="#/crm">Takibi gecikmiş aday</a><strong>${sayi(gecikenTakip.length)}</strong></li>` : ''}
    </ul></section>`);
  const yanitHarita = yanitHaritasi(yanitlar);
  const acikTeklif = teklifler.filter((o) => yanitDurumu(o, yanitHarita) === 'bekliyor');
  const yanitGelen = teklifler.filter((o) => ['kabul', 'red'].includes(yanitDurumu(o, yanitHarita)));
  const taslakTeklif = teklifler.filter((o) => !o.archived_at && ['taslak', 'onay_bekliyor'].includes(o.status));
  const soz = app.can('contracts', 'view') ? sozlesmeOzeti(sozlesmeler, sozlesmeFiyatlari, profiller, bugunStr) : null;
  const ticariKart = () => (!soz && !app.can('offers', 'view') ? '' : html`<section class="card"><h2 class="card-title">Teklif ve sözleşmeler</h2><ul class="list">
    ${app.can('offers', 'view') ? html`<li><a class="link" href="#/teklifler">Müşteri yanıtı bekleyen teklif</a><strong>${sayi(acikTeklif.length)}</strong></li>
      <li><a class="link" href="#/teklifler">Yanıt geldi, işlenmedi</a><strong id="panel-yanit-gelen">${sayi(yanitGelen.length)}</strong></li>
      <li><a class="link" href="#/teklifler">Taslak teklif</a><strong>${sayi(taslakTeklif.length)}</strong></li>` : ''}
    ${soz ? html`<li><a class="link" href="#/sozlesmeler">Aktif sözleşme</a><strong>${sayi(soz.aktifSayisi)}</strong></li>
      <li><a class="link" href="#/sozlesmeler">Aylık yinelenen gelir (KDV hariç)</a><strong>${para(soz.aylikGelir)}</strong></li>
      <li><a class="link" href="#/sozlesmeler">90 gün içinde bitecek sözleşme</a><strong>${sayi(soz.yaklasan.length)}</strong></li>` : ''}
  </ul></section>`);
  const fin = app.can('invoices', 'view') ? finansOzeti(faturalar, tahsilatlar, bugunStr) : null;
  const finansKarti = () => (!fin ? '' : html`<section class="card"><h2 class="card-title">Tahsilat durumu</h2><ul class="list">
    <li><a class="link" href="#/tahsilat">Açık alacak (KDV dahil)</a><strong>${para2(fin.toplamKalan)}</strong></li>
    <li><a class="link" href="#/tahsilat">Vadesi geçmiş</a><strong>${para2(fin.gecikmisKalan)} · ${sayi(fin.gecikmisAdet)} fatura</strong></li>
    <li><a class="link" href="#/tahsilat">Bu ay tahsilat</a><strong>${para2(fin.buAyTahsilat)}</strong></li>
  </ul></section>`);
  const acikGorev = gorevler.filter((g) => !g.archived_at && (g.status === 'acik' || g.status === 'devam_ediyor'));
  const gorevKarti = () => (!app.can('tasks', 'view') ? '' : html`<section class="card"><h2 class="card-title">Görevler</h2>
    <ul class="list">
      <li><a class="link" href="#/gorevler">Açık görev</a><strong>${sayi(acikGorev.length)}</strong></li>
      <li><a class="link" href="#/gorevler">Bugün vadesi gelen</a><strong>${sayi(acikGorev.filter((g) => gorevZamani(g) === 'bugun').length)}</strong></li>
      <li><a class="link" href="#/gorevler">Gecikmiş görev</a><strong>${sayi(acikGorev.filter((g) => gorevZamani(g) === 'gecikmis').length)}</strong></li>
    </ul></section>`);

  const govde = !firmalar.length
    ? emptyState({
      simge: 'building', baslik: 'Başlamak için ilk firmanızı ekleyin',
      metin: 'Firma kartı oluşturup çalışan sayısı ve tehlike sınıfını girdiğinizde teorik hizmet süresi ve kapasite ihtiyacı burada görünür.',
      eylem: app.can('companies', 'create') ? html`<a class="btn btn-primary" href="#/firmalar">${icon('plus', 18)} Firmalara git</a>` : '',
    })
    : html`<div class="kpi-grid">
      ${kpi('Aktif müşteri', sayi(musteriler.length), `${sayi(aktif.length - musteriler.length)} eski müşteri`, 'building')}
      ${kpi('Toplam çalışan', sayi(calisan), `${sayi(hesaplananFirma)} firmanın güncel kaydı`, 'users')}
      ${kpi('Uzman ihtiyacı', `${sayi(uzmanDk)} dk`, `${ayAdi(ay)} · yaklaşık ${ondalik2(kisiSayisi(uzmanDk))} tam zamanlı uzman`, 'shield')}
      ${kpi('Hekim ihtiyacı', `${sayi(hekimDk)} dk`, `${ayAdi(ay)} · yaklaşık ${ondalik2(kisiSayisi(hekimDk))} tam zamanlı hekim`, 'pulse')}
    </div>
    <div class="grid-2">
      <section class="card"><h2 class="card-title">Tehlike sınıfı dağılımı</h2>${dagilimHtml}</section>
      <section class="card"><h2 class="card-title">Eksik veri ${eksikSayisi ? html`<span class="chip-n">${eksikSayisi}</span>` : ''}</h2>
        ${eksikSayisi ? html`<ul class="list">
          ${eksikProfil.slice(0, 6).map((f) => html`<li><a class="link" href="#/firmalar/${f.id}">${f.name}</a><span class="muted">çalışan sayısı girilmedi</span></li>`)}
          ${eksikKural.slice(0, 6).map((f) => html`<li><a class="link" href="#/firmalar/${f.id}">${f.name}</a><span class="muted">süre kuralı bulunamadı</span></li>`)}
          ${ayortasi.slice(0, 6).map((f) => html`<li><a class="link" href="#/firmalar/${f.id}">${f.name}</a><span class="muted">kayıt ay içinde başladı, ${ayAdi(ay)} süresine dahil değil</span></li>`)}
        </ul>${eksikSayisi > 12 ? html`<p class="fine">Daha fazlası için Firmalar sayfasına bakın.</p>` : ''}`
          : html`<p class="muted">Tüm müşterilerin güncel çalışan sayısı ve tehlike sınıfı girilmiş.</p>`}
      </section>
      <section class="card"><h2 class="card-title">Son eklenen firmalar</h2><ul class="list">
        ${son.map((f) => {
    const p = guncelProfil(harita.get(f.id), bugunStr);
    return html`<li><a class="cell-main" href="#/firmalar/${f.id}">${avatar(f.name, 'sm')}<span><strong>${f.name}</strong><small>${tarih(String(f.created_at ?? '').slice(0, 10))}</small></span></a>${tehlikePill(p?.hazard_class)}</li>`;
  })}</ul></section>
      ${satisKarti()}${ticariKart()}${finansKarti()}${gorevKarti()}
    </div>`;

  return {
    baslik,
    altBaslik: 'Müşteri portföyünüzün ve hizmet yükünüzün güncel özeti',
    govde,
    // CSP satır içi style özniteliğine izin vermediği için çubuk genişlikleri burada (CSSOM ile) verilir.
    mount(kok) { kok.querySelectorAll('.bars-fill[data-w]').forEach((e) => { e.style.width = `${e.dataset.w}%`; }); },
  };
}
