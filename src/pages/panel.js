// OSGB 360 - Yönetici paneli (Aşama 2: gerçek firma verisinden özet).
import { html, bugun, ayBasi, ayAdi, sayi, ondalik2, selamlama, ilkAd, tarih, TEHLIKE, TEHLIKE_SIRASI } from '../lib/format.js';
import { icon } from '../ui/icons.js';
import { avatar, emptyState, openModal } from '../ui/components.js';
import { cubukGrafik, ipucuBagla } from '../ui/grafik.js';
import { personelSeri, sonAylar } from '../lib/yonetim.js';
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
import { ozetIzniVar, yonetimOzetiIskelet, yonetimOzetiBaglan, yeniDurum } from './yonetim_ozeti.js';

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

  const [firmalar, profiller, kurallar, ayarlar, firsatlar, gorevler, adaylar, teklifler, sozlesmeler, sozlesmeFiyatlari, faturalar, tahsilatlar, yanitlar, katipAylik] = await Promise.all([
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
    app.api.listKatipAylik(),
  ]);
  const bugunStr = bugun();
  const ay = ayBasi(bugunStr);
  const harita = profilleriGrupla(profiller, firmalar);
  const aktif = firmalar.filter((f) => !f.archived_at);
  const musteriler = aktif.filter((f) => f.customer_status === 'musteri' && !f.parent_company_id);
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

  // Müşteri dağılımı: ilçe ve sektör (aktif müşteriler; boş olanlar "Belirtilmemiş")
  const KOVA_SINIRI = 10;
  const gruplaSay = (anahtar, etiket) => {
    const m = new Map();
    for (const f of musteriler) {
      const ham = anahtar(f); const k = ham ? ham.toLocaleLowerCase('tr') : '';
      const e = m.get(k) ?? { ad: ham ? etiket(f) : 'Belirtilmemiş', n: 0, bos: !ham }; e.n += 1; m.set(k, e);
    }
    const l = [...m.values()].sort((a, b) => (a.bos - b.bos) || b.n - a.n || a.ad.localeCompare(b.ad, 'tr'));
    const dolu = l.filter((x) => !x.bos); const bos = l.find((x) => x.bos);
    const gor = dolu.slice(0, KOVA_SINIRI); const kalan = dolu.slice(KOVA_SINIRI);
    if (kalan.length) gor.push({ ad: `Diğer (${kalan.length} başlık daha)`, n: kalan.reduce((t, x) => t + x.n, 0) });
    if (bos) gor.push(bos);
    return gor;
  };
  const birIl = new Set(musteriler.map((f) => (f.city ?? '').trim().toLocaleLowerCase('tr')).filter(Boolean)).size <= 1;
  const ilceler = gruplaSay((f) => (f.district ?? '').trim() ? `${(f.district ?? '').trim()}|${birIl ? '' : (f.city ?? '').trim()}` : '', (f) => `${f.district.trim()}${!birIl && f.city?.trim() ? ` / ${f.city.trim()}` : ''}`);
  const sektorler = gruplaSay((f) => (f.sector ?? '').trim(), (f) => f.sector.trim());
  const dagilimGrafigi = (liste, ad) => {
    const enb = Math.max(1, ...liste.map((x) => x.n));
    return musteriler.length ? html`<ul class="bars bars-genis" aria-label="${ad}">${liste.map((x) => html`<li>
        <span class="bars-l" title="${x.ad}">${x.ad}</span>
        <span class="bars-track"><span class="bars-fill bars-mavi" data-w="${Math.round((x.n / enb) * 100)}"></span></span>
        <span class="bars-n">${sayi(x.n)}</span></li>`)}</ul>` : html`<p class="muted">Müşteri eklendikçe dağılım burada görünür.</p>`;
  };

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
  const seriAylari = sonAylar(ay, 12).map((a) => a.slice(0, 7) + '-01');
  const pSeri = personelSeri({ firmalar, profiller, sozlesmeler, aylar: seriAylari, katip: katipAylik });
  const personelKarti = () => html`<section class="card card-genis card-buyut" id="personel-grafik" data-buyut-personel title="Firma seçerek aylık değişimi görmek için tıklayın">
    <h2 class="card-title">Hizmet verilen toplam personel — aylık <span class="buyut-ipucu">Firma seç</span></h2>
    ${pSeri.toplam.some((n) => n > 0) ? html`<div id="personel-grafik-alan">${personelGrafigi(pSeri, '', '', 'genis')}</div>
      ${sinifDugmeleri('')}
      <p class="fine">Her ay, o ayda sözleşmesi geçerli müşteri firmaların çalışan sayıları toplanır (bağlı firmalar ana firmada). Ayrıntı ve firma bazında değişim için grafiğe tıklayın.</p>` : html`<p class="muted">Sözleşmeli firma ve çalışan sayısı girildikçe aylık grafik burada görünür.</p>`}
  </section>`;
  const acikGorev = gorevler.filter((g) => !g.archived_at && (g.status === 'acik' || g.status === 'devam_ediyor'));
  const gorevKarti = () => (!app.can('tasks', 'view') ? '' : html`<section class="card"><h2 class="card-title">Görevler</h2>
    <ul class="list">
      <li><a class="link" href="#/gorevler">Açık görev</a><strong>${sayi(acikGorev.length)}</strong></li>
      <li><a class="link" href="#/gorevler">Bugün vadesi gelen</a><strong>${sayi(acikGorev.filter((g) => gorevZamani(g) === 'bugun').length)}</strong></li>
      <li><a class="link" href="#/gorevler">Gecikmiş görev</a><strong>${sayi(acikGorev.filter((g) => gorevZamani(g) === 'gecikmis').length)}</strong></li>
    </ul></section>`);

  const ozetVar = ozetIzniVar(app); const ozetDurum = yeniDurum();
  const govde = !firmalar.length
    ? emptyState({
      simge: 'building', baslik: 'Başlamak için ilk firmanızı ekleyin',
      metin: 'Firma kartı oluşturup çalışan sayısı ve tehlike sınıfını girdiğinizde teorik hizmet süresi ve kapasite ihtiyacı burada görünür.',
      eylem: app.can('companies', 'create') ? html`<a class="btn btn-primary" href="#/firmalar">${icon('plus', 18)} Firmalara git</a>` : '',
    })
    : html`${ozetVar ? html`${yonetimOzetiIskelet(ozetDurum)}<h2 class="yon-baslik pad-t">Müşteri portföyü ve hizmet yükü</h2>` : ''}<div class="kpi-grid">
      ${kpi('Aktif müşteri', sayi(musteriler.length), `${sayi(aktif.length - musteriler.length)} eski müşteri`, 'building')}
      ${kpi('Toplam çalışan', sayi(calisan), `${sayi(hesaplananFirma)} firmanın güncel kaydı`, 'users')}
      ${kpi('Uzman ihtiyacı', `${sayi(uzmanDk)} dk`, `${ayAdi(ay)} · yaklaşık ${ondalik2(kisiSayisi(uzmanDk))} tam zamanlı uzman`, 'shield')}
      ${kpi('Hekim ihtiyacı', `${sayi(hekimDk)} dk`, `${ayAdi(ay)} · yaklaşık ${ondalik2(kisiSayisi(hekimDk))} tam zamanlı hekim`, 'pulse')}
    </div>
    <div class="grid-2">
      <section class="card" id="ilce-dagilim"><h2 class="card-title">İlçelere göre müşteri sayısı</h2>${dagilimGrafigi(ilceler, 'İlçelere göre müşteri sayısı')}</section>
      <section class="card" id="sektor-dagilim"><h2 class="card-title">Sektörlere göre müşteri sayısı</h2>${dagilimGrafigi(sektorler, 'Sektörlere göre müşteri sayısı')}</section>
      <section class="card"><h2 class="card-title">Tehlike sınıfı dağılımı</h2>${dagilimHtml}</section>
      ${finansKarti()}
      ${personelKarti()}
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
      ${satisKarti()}${ticariKart()}${gorevKarti()}
    </div>`;

  return {
    baslik,
    altBaslik: 'Müşteri portföyünüzün ve hizmet yükünüzün güncel özeti',
    govde,
    // CSP satır içi style özniteliğine izin vermediği için çubuk genişlikleri burada (CSSOM ile) verilir.
    mount(kok) {
      const ciz = (k) => k.querySelectorAll('.bars-fill[data-w]').forEach((e) => { e.style.width = `${e.dataset.w}%`; });
      ciz(kok);
      ipucuBagla(document.body);
      kok.querySelector('[data-buyut-personel]')?.addEventListener('click', (e) => {
        const d = e.target.closest('[data-psinif]');
        if (d) { kok.querySelectorAll('#personel-grafik [data-psinif]').forEach((b) => b.setAttribute('aria-pressed', String(b === d))); kok.querySelector('#personel-grafik-alan').innerHTML = personelGrafigi(pSeri, d.dataset.psinif, '', 'genis').s; return; }
        if (!e.target.closest('a, button, select')) personelPenceresi(pSeri);
      });
      if (ozetVar && firmalar.length) yonetimOzetiBaglan(kok, app, ozetDurum, ciz);
    },
  };
}

/** Aylık personel grafiğinin büyük penceresi: tüm firmalar (toplam) veya seçilen firmanın aylık çalışan sayısı ve değişimi. */
function personelPenceresi(seri) {
  const durum = { firma: '', sinif: '' };
  const ciz = () => {
    const f = durum.firma ? seri.firmalar.find((x) => x.id === durum.firma) : null;
    const degerler = f ? (durum.sinif ? f.siniflar[durum.sinif] : f.degerler) : (durum.sinif ? seri.siniflar[durum.sinif] : seri.toplam);
    const satirlar = seri.aylar.map((a, i) => ({ ay: a, n: degerler[i], fark: i ? degerler[i] - degerler[i - 1] : null }));
    return html`<div class="grafik-buyuk">${personelGrafigi(seri, durum.sinif, durum.firma, true)}</div>${sinifDugmeleri(durum.sinif)}
      <div class="table-wrap"><table class="table"><thead><tr><th scope="col">Ay</th><th scope="col" class="num">Personel</th><th scope="col" class="num">Değişim</th></tr></thead><tbody>
      ${satirlar.map((r) => html`<tr><td>${ayAdi(r.ay)}</td><td class="num">${sayi(r.n)}</td><td class="num ${r.fark > 0 ? 'pos' : r.fark < 0 ? 'neg' : ''}">${r.fark === null ? '—' : `${r.fark > 0 ? '+' : ''}${sayi(r.fark)}`}</td></tr>`)}</tbody></table></div>`;
  };
  openModal({ baslik: 'Hizmet verilen personel — aylık değişim', altBaslik: 'Firma ve tehlike sınıfı seçerek aylık çalışan sayısını görebilirsiniz; çubukların üzerine gelince kişi sayısı görünür.', boyut: 'xl',
    govde: html`<label class="field"><span class="field-label">Firma</span><select id="personel-firma"><option value="">Tüm firmalar (toplam)</option>${seri.firmalar.map((f) => html`<option value="${f.id}">${f.ad}</option>`)}</select></label><div id="personel-icerik">${ciz()}</div>` });
  const sec = document.querySelector('#personel-firma'); const icerik = document.querySelector('#personel-icerik');
  sec?.addEventListener('change', () => { durum.firma = sec.value; icerik.innerHTML = ciz().s; });
  icerik?.addEventListener('click', (e) => { const d = e.target.closest('[data-psinif]'); if (d) { durum.sinif = d.dataset.psinif; icerik.innerHTML = ciz().s; } });
}

const P_SINIF = [['', 'Toplam'], ['cok_tehlikeli', 'Çok tehlikeli'], ['tehlikeli', 'Tehlikeli'], ['az_tehlikeli', 'Az tehlikeli']];
const sinifDugmeleri = (secili) => html`<div class="chips p-sinif" role="group" aria-label="Tehlike sınıfına göre personel">${P_SINIF.map(([k, ad]) => html`<button type="button" class="chip" data-psinif="${k}" aria-pressed="${k === secili ? 'true' : 'false'}">${ad}</button>`)}</div>`;
/** Aylık personel grafiği: sinif '' = toplam, aksi hâlde o tehlike sınıfındaki çalışanlar; firmaId boşsa tüm firmalar. */
function personelGrafigi(seri, sinif, firmaId, boyut) {
  const f = firmaId ? seri.firmalar.find((x) => x.id === firmaId) : null;
  const degerler = f ? (sinif ? f.siniflar[sinif] : f.degerler) : (sinif ? seri.siniflar[sinif] : seri.toplam);
  const ad = (P_SINIF.find((x) => x[0] === sinif) ?? P_SINIF[0])[1];
  return html`${cubukGrafik({ ad: `Aylık personel — ${f ? f.ad : 'tüm firmalar'} — ${ad}`, etiketler: seri.aylar, seriler: [{ ad: sinif ? `${ad} sınıf personeli` : 'Hizmet verilen personel', sinif: 'personel', degerler }], birim: 'kisi', buyuk: boyut })}`;
}
