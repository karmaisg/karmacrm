// OSGB 360 - Sözleşmeler: liste, yenileme uyarıları (90/60/30), sözleşme sayfası, fiyat geçmişi, yenileme, fesih.
import { html, bugun, tarih, gunEkle, para, sayi, icerir, trSirala } from '../lib/format.js';
import { icon } from '../ui/icons.js';
import { avatar, pill, emptyState, field, checkbox, openFormModal, confirmDialog, toast, sayfalama } from '../ui/components.js';
import { FIYATLAMA, KDV_MODU, SOZLESME_DURUMLARI, SOZLESME_TON, bitisDurumu, guncelFiyat, fiyatAylikHaric } from '../lib/ticari.js';
import { ayarDegeri, bosIseNull, guncelProfil, profilleriGrupla } from '../lib/veri.js';
import { humanError } from '../lib/api.js';

const SAYFA_BASI = 25;
export const sozlesmePill = (d) => pill(SOZLESME_DURUMLARI[d] ?? d, SOZLESME_TON[d] ?? 'neutral');

/** Bitişe kalan süre rozeti (yalnız aktif sözleşmeler). */
export function bitisRozeti(c, bugunStr = bugun()) {
  const b = bitisDurumu(c, bugunStr);
  if (!b) return '';
  if (b.seviye === 'gecmis') return pill(`${Math.abs(b.gun)} gün önce bitti`, 'danger');
  if (b.seviye === 'kritik') return pill(`${b.gun} gün kaldı`, 'danger');
  if (b.seviye === 'yaklasiyor') return pill(`${b.gun} gün kaldı`, 'warning');
  return html`<span class="muted">${b.gun} gün</span>`;
}

/** Panel ve liste için: aylık yinelenen gelir ve yaklaşan bitişler. */
export function sozlesmeOzeti(sozlesmeler, fiyatlar, profiller, bugunStr = bugun()) {
  const harita = profilleriGrupla(profiller);
  const fiyatHaritasi = new Map();
  for (const p of fiyatlar) { if (!fiyatHaritasi.has(p.contract_id)) fiyatHaritasi.set(p.contract_id, []); fiyatHaritasi.get(p.contract_id).push(p); }
  const aktifler = sozlesmeler.filter((c) => !c.archived_at && c.status === 'aktif' && c.start_date <= bugunStr && c.end_date >= bugunStr);
  let aylik = 0;
  for (const c of aktifler) {
    const f = guncelFiyat(fiyatHaritasi.get(c.id) ?? [], bugunStr);
    const p = guncelProfil(harita.get(c.company_id), bugunStr);
    if (f) aylik += fiyatAylikHaric(f, p?.employee_count ?? 0);
  }
  const yaklasan = sozlesmeler.filter((c) => !c.archived_at && c.status === 'aktif').map((c) => ({ c, b: bitisDurumu(c, bugunStr) }))
    .filter((x) => x.b && x.b.gun <= 90).sort((a, b) => a.b.gun - b.b.gun);
  return { aktifSayisi: aktifler.length, aylikGelir: Math.round(aylik * 100) / 100, yaklasan };
}

// ---------------------------------------------------------------- fiyat alanları (yeni dönem ve elle sözleşme ortak)
const fiyatAlanlari = (v = {}, kdvVarsayilan = 20) => html`
  ${field({ ad: 'pricing', etiket: 'Fiyatlama', zorunlu: true, deger: v.pricing ?? 'kisi_basi', secenekler: [{ deger: 'kisi_basi', etiket: FIYATLAMA.kisi_basi }, { deger: 'sabit_aylik', etiket: FIYATLAMA.sabit_aylik }] })}
  ${field({ ad: 'unit_price', etiket: 'Kişi başı aylık fiyat (TL)', tur: 'number', min: 0, adim: '0.01', inputmode: 'decimal', deger: v.unit_price ?? '' })}
  ${field({ ad: 'fixed_monthly_price', etiket: 'Sabit aylık fiyat (TL)', tur: 'number', min: 0, adim: '0.01', inputmode: 'decimal', deger: v.fixed_monthly_price ?? '' })}
  ${field({ ad: 'vat_mode', etiket: 'Fiyat KDV', deger: v.vat_mode ?? 'kdv_haric', secenekler: Object.entries(KDV_MODU).map(([deger, etiket]) => ({ deger, etiket })) })}
  ${field({ ad: 'vat_rate', etiket: 'KDV oranı (%)', tur: 'number', min: 0, max: 100, adim: '0.01', deger: v.vat_rate ?? kdvVarsayilan })}`;

function fiyatDogrula(g) {
  const h = {};
  const kisi = g('pricing') === 'kisi_basi';
  const ad = kisi ? 'unit_price' : 'fixed_monthly_price';
  if (g(ad) === '' || !(Number(g(ad)) >= 0)) h[ad] = kisi ? 'Kişi başı fiyatı girin (0 veya üstü).' : 'Sabit aylık tutarı girin (0 veya üstü).';
  const kdv = Number(g('vat_rate'));
  if (g('vat_rate') === '' || !(kdv >= 0 && kdv <= 100)) h.vat_rate = 'KDV oranı 0 ile 100 arasında olmalıdır.';
  return h;
}
const fiyatDegerleri = (g) => {
  const kisi = g('pricing') === 'kisi_basi';
  return { fiyatlama: g('pricing'), birim: kisi ? Number(g('unit_price')) : null, sabit: kisi ? null : Number(g('fixed_monthly_price')), kdvModu: g('vat_mode') || 'kdv_haric', kdvOrani: Number(g('vat_rate')) };
};
function fiyatGorunurlugu(form) {
  const f = () => {
    const kisi = form.elements.pricing.value === 'kisi_basi';
    form.querySelector('[data-field="unit_price"]').hidden = !kisi;
    form.querySelector('[data-field="fixed_monthly_price"]').hidden = kisi;
  };
  form.addEventListener('change', f); f();
}

// ---------------------------------------------------------------- elle sözleşme
export async function sozlesmeFormuAc(app, { companyId = null } = {}) {
  let firmalar = [], ayarlar = [], yeniId = null;
  try { [firmalar, ayarlar] = await Promise.all([app.api.listCompanies(), app.api.listSettings()]); } catch (e) { toast(humanError(e), 'hata'); return; }
  const firmaSec = [{ deger: '', etiket: 'Seçiniz' }].concat(firmalar.filter((f) => !f.archived_at).sort((a, b) => trSirala(a.name, b.name)).map((f) => ({ deger: f.id, etiket: f.name })));
  const m = openFormModal({
    baslik: 'Yeni sözleşme', altBaslik: 'Tekliften gelmeyen (mevcut) sözleşmeleri buradan girebilirsiniz.', boyut: 'lg', gonderEtiketi: 'Sözleşmeyi oluştur',
    govde: html`${field({ ad: 'company_id', etiket: 'Firma', zorunlu: true, deger: companyId ?? '', secenekler: firmaSec, tam: true })}
      ${field({ ad: 'baslangic', etiket: 'Başlangıç', tur: 'date', zorunlu: true, deger: bugun() })}
      ${field({ ad: 'bitis', etiket: 'Bitiş', tur: 'date', zorunlu: true, deger: gunEkle(bugun(), 364) })}
      ${fiyatAlanlari({}, Number(ayarDegeri(ayarlar, 'varsayilan_kdv_orani', bugun(), 20)) || 20)}
      ${field({ ad: 'durum', etiket: 'Durum', deger: 'aktif', secenekler: [{ deger: 'aktif', etiket: 'Aktif' }, { deger: 'taslak', etiket: 'Taslak' }] })}
      ${checkbox({ ad: 'uzman', etiket: 'İş güvenliği uzmanı hizmeti dahil', isaretli: true })}
      ${checkbox({ ad: 'hekim', etiket: 'İşyeri hekimi hizmeti dahil', isaretli: true })}
      ${field({ ad: 'odeme', etiket: 'Ödeme koşulları', tam: true, maksUzunluk: 300 })}
      ${field({ ad: 'yenileme', etiket: 'Yenileme koşulları', tam: true, maksUzunluk: 300 })}
      ${field({ ad: 'fiyat_guncelleme', etiket: 'Fiyat güncelleme koşulları', tam: true, maksUzunluk: 300 })}`,
    async onSubmit(fd) {
      const g = (k) => String(fd.get(k) ?? '').trim();
      const h = fiyatDogrula(g);
      if (!g('company_id')) h.company_id = 'Firma seçin.';
      if (!g('baslangic')) h.baslangic = 'Başlangıç tarihini seçin.';
      if (!g('bitis')) h.bitis = 'Bitiş tarihini seçin.';
      else if (g('baslangic') && g('bitis') < g('baslangic')) h.bitis = 'Bitiş, başlangıçtan önce olamaz.';
      if (Object.keys(h).length) return { errors: h };
      const c = await app.api.createContract({
        firma: g('company_id'), baslangic: g('baslangic'), bitis: g('bitis'), ...fiyatDegerleri(g), durum: g('durum') || 'aktif',
        uzman: fd.get('uzman') === '1', hekim: fd.get('hekim') === '1',
        odeme: bosIseNull(g('odeme')), yenileme: bosIseNull(g('yenileme')), fiyatGuncelleme: bosIseNull(g('fiyat_guncelleme')),
      });
      yeniId = c.id; toast('Sözleşme oluşturuldu.');
    },
    onDone: () => (yeniId ? app.git(`sozlesmeler/${yeniId}`) : app.yenile()),
  });
  fiyatGorunurlugu(m.el.querySelector('form'));
}

// ---------------------------------------------------------------- liste
export async function sozlesmelerSayfasi(app) {
  const [sozlesmeler, fiyatlar, firmalar, profiller] = await Promise.all([
    app.api.listContracts(), app.api.listAllContractPrices(),
    app.can('companies', 'view') ? app.api.listCompanies() : [],
    app.can('companies', 'view') ? app.api.listAllProfiles() : [],
  ]);
  const bugunStr = bugun();
  const firmaAdi = new Map(firmalar.map((f) => [f.id, f.name]));
  const ozet = sozlesmeOzeti(sozlesmeler, fiyatlar, profiller, bugunStr);
  const olusturabilir = app.can('contracts', 'create');
  const durum = { filtre: 'aktif', q: '', sayfa: 1 };
  const GRUP = {
    aktif: (c) => !c.archived_at && c.status === 'aktif',
    yaklasan: (c) => { const b = bitisDurumu(c, bugunStr); return !c.archived_at && !!b && b.gun <= 90; },
    taslak: (c) => !c.archived_at && c.status === 'taslak',
    biten: (c) => !c.archived_at && ['yenilendi', 'sona_erdi', 'feshedildi'].includes(c.status),
    tumu: (c) => !c.archived_at, arsiv: (c) => !!c.archived_at,
  };
  const FILTRELER = [['aktif', 'Aktif'], ['yaklasan', 'Bitişi yaklaşan (90 gün)'], ['taslak', 'Taslak'], ['biten', 'Sona eren / yenilenen'], ['tumu', 'Tümü'], ['arsiv', 'Arşivli']];
  const sayilar = Object.fromEntries(Object.entries(GRUP).map(([k, f]) => [k, sozlesmeler.filter(f).length]));
  const fiyatHaritasi = new Map();
  for (const p of fiyatlar) { if (!fiyatHaritasi.has(p.contract_id)) fiyatHaritasi.set(p.contract_id, []); fiyatHaritasi.get(p.contract_id).push(p); }
  const profilHaritasi = profilleriGrupla(profiller);

  const satir = (c) => {
    const f = guncelFiyat(fiyatHaritasi.get(c.id) ?? [], bugunStr);
    const p = guncelProfil(profilHaritasi.get(c.company_id), bugunStr);
    const ad = firmaAdi.get(c.company_id) ?? 'Firma';
    return html`<tr class="${c.archived_at ? 'row-muted' : ''}">
      <td><a class="cell-main" href="#/sozlesmeler/${c.id}">${avatar(ad)}<span><strong>${ad}</strong><small>${tarih(c.start_date)} – ${tarih(c.end_date)}</small></span></a></td>
      <td class="num hide-sm">${f ? para(fiyatAylikHaric(f, p?.employee_count ?? 0)) : '—'}</td>
      <td class="hide-md">${bitisRozeti(c, bugunStr)}</td><td>${sozlesmePill(c.status)}</td></tr>`;
  };
  function tablo() {
    if (!sozlesmeler.length) {
      return emptyState({ simge: 'contract', baslik: 'Henüz sözleşme yok', metin: 'Kabul edilen bir teklifi sözleşmeye çevirin ya da mevcut sözleşmeyi elle girin.',
        eylem: olusturabilir ? html`<button type="button" class="btn btn-primary" data-action="yeni-sozlesme">${icon('plus', 18)} Sözleşme ekle</button>` : '' });
    }
    let liste = sozlesmeler.filter(GRUP[durum.filtre]);
    const q = durum.q.trim();
    if (q) liste = liste.filter((c) => icerir(firmaAdi.get(c.company_id) ?? '', q));
    liste.sort((a, b) => String(a.end_date).localeCompare(String(b.end_date)));
    if (!liste.length) return emptyState({ simge: 'search', baslik: 'Eşleşen sözleşme yok', metin: 'Arama veya filtreyi değiştirmeyi deneyin.' });
    const sayfaSayisi = Math.max(1, Math.ceil(liste.length / SAYFA_BASI));
    durum.sayfa = Math.min(durum.sayfa, sayfaSayisi);
    return html`<div class="table-wrap"><table class="table"><thead><tr><th scope="col">Firma ve dönem</th><th scope="col" class="num hide-sm">Aylık gelir (KDV hariç)</th><th scope="col" class="hide-md">Bitişe kalan</th><th scope="col">Durum</th></tr></thead>
      <tbody>${liste.slice((durum.sayfa - 1) * SAYFA_BASI, durum.sayfa * SAYFA_BASI).map(satir)}</tbody></table></div>
      ${sayfalama({ sayfa: durum.sayfa, sayfaSayisi, toplam: liste.length, sayfaBasi: SAYFA_BASI })}`;
  }
  const filtreHtml = () => html`${FILTRELER.map(([id, ad]) => html`<button type="button" class="chip ${durum.filtre === id ? 'chip-on' : ''}" data-filtre="${id}" aria-pressed="${durum.filtre === id}">${ad} <span class="chip-n">${sayilar[id]}</span></button>`)}`;

  return {
    baslik: 'Sözleşmeler', altBaslik: 'Dönemler, fiyat geçmişi ve yenileme uyarıları',
    eylemler: olusturabilir ? html`<button type="button" class="btn btn-primary" data-action="yeni-sozlesme">${icon('plus', 18)} Yeni sözleşme</button>` : '',
    govde: html`<div class="kpi-grid kpi-grid-3">
        <section class="card kpi"><span class="kpi-ic">${icon('contract', 22)}</span><div><div class="kpi-l">Aktif sözleşme</div><div class="kpi-v">${sayi(ozet.aktifSayisi)}</div><div class="kpi-s">bugün yürürlükte</div></div></section>
        <section class="card kpi"><span class="kpi-ic">${icon('wallet', 22)}</span><div><div class="kpi-l">Aylık yinelenen gelir</div><div class="kpi-v">${para(ozet.aylikGelir)}</div><div class="kpi-s">KDV hariç, güncel fiyat ve çalışan sayısıyla</div></div></section>
        <section class="card kpi"><span class="kpi-ic">${icon('alert', 22)}</span><div><div class="kpi-l">90 gün içinde bitecek</div><div class="kpi-v">${sayi(ozet.yaklasan.length)}</div><div class="kpi-s">yenileme görüşmesi gerekir</div></div></section></div>
      <section class="card card-flush"><div class="toolbar">
      <div class="search-field">${icon('search', 18)}<input type="search" id="sozlesme-ara" placeholder="Firma adına göre ara" aria-label="Sözleşmelerde ara" autocomplete="off"></div>
      <div class="chips" id="sozlesme-filtre" role="group" aria-label="Sözleşme filtresi">${filtreHtml()}</div></div><div id="sozlesme-tablo">${tablo()}</div></section>`,
    mount(kok) {
      const tabloEl = kok.querySelector('#sozlesme-tablo');
      const yenile = () => { tabloEl.innerHTML = tablo().s; };
      kok.querySelector('#sozlesme-ara').addEventListener('input', (e) => { durum.q = e.target.value; durum.sayfa = 1; yenile(); });
      kok.querySelector('#sozlesme-filtre').addEventListener('click', (e) => {
        const d = e.target.closest('[data-filtre]'); if (!d) return;
        durum.filtre = d.dataset.filtre; durum.sayfa = 1; kok.querySelector('#sozlesme-filtre').innerHTML = filtreHtml().s; yenile();
      });
      kok.addEventListener('click', (e) => {
        if (e.target.closest('[data-action="yeni-sozlesme"]')) { sozlesmeFormuAc(app); return; }
        const sf = e.target.closest('[data-sayfa]');
        if (sf && !sf.disabled) { durum.sayfa = Number(sf.dataset.sayfa); yenile(); }
      });
    },
  };
}

// ---------------------------------------------------------------- sözleşme sayfası
export async function sozlesmeSayfasi(app, id) {
  const [sozlesmeler, firmalar, profiller, teklifler, uyeler] = await Promise.all([
    app.api.listContracts(),
    app.can('companies', 'view') ? app.api.listCompanies() : [],
    app.can('companies', 'view') ? app.api.listAllProfiles() : [],
    app.can('offers', 'view') ? app.api.listOffers() : [],
    app.api.listOrgMembers().catch(() => []),
  ]);
  const c = sozlesmeler.find((x) => x.id === id);
  if (!c) {
    return { baslik: 'Sözleşme bulunamadı', altBaslik: '', eylemler: html`<a class="btn btn-secondary" href="#/sozlesmeler">${icon('arrowL', 18)} Sözleşmelere dön</a>`,
      govde: emptyState({ simge: 'contract', baslik: 'Bu sözleşme yok ya da erişim izniniz yok' }) };
  }
  const fiyatlar = await app.api.listContractPrices(id);
  const bugunStr = bugun();
  const firma = firmalar.find((f) => f.id === c.company_id);
  const teklif = teklifler.find((t) => t.id === c.offer_id);
  const onceki = sozlesmeler.find((x) => x.id === c.previous_contract_id);
  const sonraki = sozlesmeler.find((x) => x.previous_contract_id === c.id && !x.archived_at);
  const uyeAdi = new Map(uyeler.map((u) => [u.id, u.full_name]));
  const p = guncelProfil(profilleriGrupla(profiller).get(c.company_id), bugunStr);
  const guncel = guncelFiyat(fiyatlar, bugunStr) ?? fiyatlar.find((x) => !x.valid_to) ?? null;
  const duzenleyebilir = app.can('contracts', 'edit') && !c.archived_at;
  const aktif = c.status === 'aktif';
  const b = bitisDurumu(c, bugunStr);
  const fiyatMetni = (f) => `${para(f.pricing === 'kisi_basi' ? f.unit_price : f.fixed_monthly_price)}${f.pricing === 'kisi_basi' ? ' / kişi' : ' / ay'} · ${KDV_MODU[f.vat_mode]} %${sayi(Number(f.vat_rate))}`;

  return {
    baslik: firma?.name ?? 'Sözleşme', altBaslik: '', geri: { href: '#/sozlesmeler', ad: 'Sözleşmeler' },
    ozelBaslik: html`<div class="company-head">${avatar(firma?.name ?? 'S', 'lg')}<div><h1>${firma?.name ?? 'Sözleşme'}</h1>
      <div class="company-meta">${sozlesmePill(c.status)} ${bitisRozeti(c, bugunStr)} <span class="muted">${tarih(c.start_date)} – ${tarih(c.end_date)}</span>
      ${firma ? html`<a class="link" href="#/firmalar/${firma.id}">Firma kartı</a>` : ''}</div></div></div>`,
    eylemler: html`${duzenleyebilir && aktif ? html`<button type="button" class="btn btn-secondary" data-action="fiyat">${icon('trend', 18)} Yeni fiyat dönemi</button>` : ''}
      ${duzenleyebilir && aktif && !sonraki && app.can('contracts', 'create') ? html`<button type="button" class="btn btn-primary" data-action="yenile">${icon('history', 18)} Sözleşmeyi yenile</button>` : ''}
      ${duzenleyebilir && c.status === 'taslak' ? html`<button type="button" class="btn btn-primary" data-action="aktiflestir">${icon('check', 18)} Aktifleştir</button>` : ''}
      ${duzenleyebilir && (aktif || c.status === 'taslak') ? html`<button type="button" class="btn btn-secondary" data-action="fesih">Feshet</button>` : ''}
      ${app.can('contracts', 'archive') && !c.archived_at ? html`<button type="button" class="btn btn-secondary" data-action="arsiv">${icon('archive', 18)} Arşivle</button>` : ''}`,
    govde: html`${c.archived_at ? html`<div class="notice notice-warn" role="status">Bu sözleşme arşivde.</div>` : ''}
      ${b && b.seviye !== 'normal' ? html`<div class="notice ${b.seviye === 'yaklasiyor' ? 'notice-info' : 'notice-warn'}" role="status">${b.gun < 0 ? `Sözleşme süresi ${Math.abs(b.gun)} gün önce doldu; yenileyin ya da sona erdirin.` : `Sözleşmenin bitişine ${b.gun} gün kaldı. Yenileme görüşmesini planlayın.`}</div>` : ''}
      ${sonraki ? html`<div class="notice notice-ok" role="status">Bu sözleşme yenilendi: <a class="link" href="#/sozlesmeler/${sonraki.id}">Yeni dönemi aç</a></div>` : ''}
      <div class="grid-2">
        <section class="card"><h2 class="card-title">Sözleşme bilgileri</h2><dl class="kv-list">
          <div class="kv"><dt>Dönem</dt><dd>${tarih(c.start_date)} – ${tarih(c.end_date)}</dd></div>
          <div class="kv"><dt>Hizmet</dt><dd>${[c.expert_service ? 'İş güvenliği uzmanı' : '', c.physician_service ? 'İşyeri hekimi' : ''].filter(Boolean).join(', ') || '—'}</dd></div>
          <div class="kv"><dt>Güncel fiyat</dt><dd>${guncel ? fiyatMetni(guncel) : '—'}</dd></div>
          <div class="kv"><dt>Aylık tutar (KDV hariç)</dt><dd>${guncel ? para(fiyatAylikHaric(guncel, p?.employee_count ?? 0)) : '—'}${guncel?.pricing === 'kisi_basi' ? html` <small class="muted">${sayi(p?.employee_count ?? 0)} çalışan</small>` : ''}</dd></div>
          <div class="kv"><dt>Ödeme koşulları</dt><dd>${c.payment_terms || html`<span class="muted">—</span>`}</dd></div>
          <div class="kv"><dt>Yenileme koşulları</dt><dd>${c.renewal_terms || html`<span class="muted">—</span>`}</dd></div>
          <div class="kv"><dt>Fiyat güncelleme</dt><dd>${c.price_update_terms || html`<span class="muted">—</span>`}</dd></div>
          <div class="kv"><dt>Kaynak</dt><dd>${teklif ? html`<a class="link" href="#/teklifler/${teklif.id}">${teklif.offer_no}</a>` : 'Elle girildi'}${onceki ? html` · <a class="link" href="#/sozlesmeler/${onceki.id}">önceki dönem</a>` : ''}</dd></div>
          <div class="kv"><dt>Sorumlu</dt><dd>${uyeAdi.get(c.owner_user) || html`<span class="muted">—</span>`}</dd></div>
        </dl></section>
        <section class="card"><h2 class="card-title">Fiyat geçmişi</h2>
          ${fiyatlar.length ? html`<ol class="timeline">${fiyatlar.map((f) => html`<li class="tl-item"><span class="tl-ic tl-neutral">${icon('trend', 16)}</span>
            <div class="tl-body"><div class="tl-head"><strong>${fiyatMetni(f)}</strong>${!f.valid_to ? pill('Geçerli', 'success') : ''}</div>
            <div class="tl-meta">${tarih(f.valid_from)} – ${f.valid_to ? tarih(f.valid_to) : 'devam ediyor'}${f.note ? ` · ${f.note}` : ''}</div></div></li>`)}</ol>`
    : html`<p class="muted">Fiyat kaydı yok.</p>`}
          <p class="fine">Eski fiyatlar silinmez; geçmiş dönem faturaları kendi fiyatıyla hesaplanır.</p></section>
      </div>`,
    mount(kok) {
      kok.addEventListener('click', async (e) => {
        const a = e.target.closest('[data-action]'); if (!a) return;
        const x = a.dataset.action;
        if (x === 'fiyat') fiyatDonemiFormu(app, c, guncel);
        else if (x === 'yenile') yenilemeFormu(app, c);
        else if (x === 'aktiflestir') {
          try { await app.api.updateContract(c.id, { status: 'aktif' }); toast('Sözleşme aktifleştirildi.'); app.yenile(); } catch (err) { toast(humanError(err), 'hata'); }
        } else if (x === 'fesih') {
          if (!(await confirmDialog({ baslik: 'Sözleşmeyi feshet', onayEtiketi: 'Feshet', tehlikeli: true, mesaj: 'Fesih sonrası sözleşme değiştirilemez. Kayıt silinmez.' }))) return;
          try { await app.api.updateContract(c.id, { status: 'feshedildi' }); toast('Sözleşme feshedildi.'); app.yenile(); } catch (err) { toast(humanError(err), 'hata'); }
        } else if (x === 'arsiv') {
          if (!(await confirmDialog({ baslik: 'Sözleşmeyi arşivle', onayEtiketi: 'Arşivle', tehlikeli: true, mesaj: 'Sözleşme arşive alınacak. Kayıt silinmez.' }))) return;
          try { await app.api.archiveContract(c.id); toast('Sözleşme arşive alındı.'); app.yenile(); } catch (err) { toast(humanError(err), 'hata'); }
        }
      });
    },
  };
}

function fiyatDonemiFormu(app, c, guncel) {
  const m = openFormModal({
    baslik: 'Yeni fiyat dönemi', altBaslik: 'Önceki fiyat yeni dönemin başlangıcında kapanır ve geçmişte kalır.', boyut: 'lg', gonderEtiketi: 'Fiyatı kaydet',
    govde: html`${field({ ad: 'baslangic', etiket: 'Yeni fiyat başlangıcı', tur: 'date', zorunlu: true, deger: bugun() > c.start_date ? bugun() : gunEkle(c.start_date, 1), tam: true })}
      ${fiyatAlanlari(guncel ?? {})}
      ${field({ ad: 'not', etiket: 'Not', tam: true, maksUzunluk: 300, yerTutucu: 'Örn. Yıllık TÜFE artışı' })}`,
    async onSubmit(fd) {
      const g = (k) => String(fd.get(k) ?? '').trim();
      const h = fiyatDogrula(g);
      if (!g('baslangic')) h.baslangic = 'Başlangıç tarihini seçin.';
      else if (g('baslangic') <= (guncel?.valid_from ?? '')) h.baslangic = 'Yeni dönem, mevcut fiyatın başlangıcından sonra olmalıdır.';
      else if (g('baslangic') > c.end_date) h.baslangic = 'Yeni fiyat sözleşme bitişinden sonra başlayamaz.';
      if (Object.keys(h).length) return { errors: h };
      await app.api.addContractPrice({ contractId: c.id, ...fiyatDegerleri(g), baslangic: g('baslangic'), not: bosIseNull(g('not')) });
      toast('Yeni fiyat dönemi kaydedildi.');
    },
    onDone: () => app.yenile(),
  });
  fiyatGorunurlugu(m.el.querySelector('form'));
}

function yenilemeFormu(app, c) {
  let yeniId = null;
  openFormModal({
    baslik: 'Sözleşmeyi yenile', altBaslik: 'Mevcut sözleşme "Yenilendi" olur; yeni dönem aynı koşul ve güncel fiyatla açılır.', gonderEtiketi: 'Yenile',
    govde: html`${field({ ad: 'baslangic', etiket: 'Yeni dönem başlangıcı', tur: 'date', zorunlu: true, deger: gunEkle(c.end_date, 1) })}
      ${field({ ad: 'bitis', etiket: 'Yeni dönem bitişi', tur: 'date', zorunlu: true, deger: gunEkle(c.end_date, 365) })}
      ${field({ ad: 'not', etiket: 'Fiyat notu', tam: true, maksUzunluk: 300, yerTutucu: 'Örn. Fiyat aynı kaldı' })}`,
    async onSubmit(fd) {
      const g = (k) => String(fd.get(k) ?? '').trim();
      const h = {};
      if (!g('baslangic')) h.baslangic = 'Başlangıç tarihini seçin.';
      if (!g('bitis')) h.bitis = 'Bitiş tarihini seçin.';
      else if (g('baslangic') && g('bitis') < g('baslangic')) h.bitis = 'Bitiş, başlangıçtan önce olamaz.';
      if (Object.keys(h).length) return { errors: h };
      const y = await app.api.renewContract({ id: c.id, baslangic: g('baslangic'), bitis: g('bitis'), not: bosIseNull(g('not')) });
      yeniId = y.id; toast('Sözleşme yenilendi.');
    },
    onDone: () => (yeniId ? app.git(`sozlesmeler/${yeniId}`) : app.yenile()),
  });
}

// ---------------------------------------------------------------- firma kartı sekmeleri
export function firmaTeklifleri(app, teklifler, teklifPill, para2) {
  const liste = teklifler.filter((o) => !o.archived_at).sort((a, b) => String(b.offer_no).localeCompare(String(a.offer_no)));
  if (!liste.length) {
    return emptyState({ simge: 'file', baslik: 'Bu firmaya teklif verilmemiş',
      eylem: app.can('offers', 'create') ? html`<button type="button" class="btn btn-primary" data-action="teklif-yeni">${icon('plus', 18)} Teklif hazırla</button>` : '' });
  }
  return html`<div class="table-wrap"><table class="table"><thead><tr><th scope="col">Teklif</th><th scope="col">Tarih</th><th scope="col">Durum</th></tr></thead><tbody>
    ${liste.map((o) => html`<tr><td><a class="link" href="#/teklifler/${o.id}"><strong>${o.offer_no}</strong></a></td><td>${tarih(o.offer_date)}</td><td>${teklifPill(o.status)}</td></tr>`)}</tbody></table></div>`;
}

export function firmaSozlesmeleri(app, sozlesmeler) {
  const bugunStr = bugun();
  const liste = sozlesmeler.filter((c) => !c.archived_at).sort((a, b) => String(b.start_date).localeCompare(String(a.start_date)));
  if (!liste.length) {
    return emptyState({ simge: 'contract', baslik: 'Bu firmanın sözleşmesi yok',
      eylem: app.can('contracts', 'create') ? html`<button type="button" class="btn btn-primary" data-action="sozlesme-yeni">${icon('plus', 18)} Sözleşme ekle</button>` : '' });
  }
  return html`<div class="table-wrap"><table class="table"><thead><tr><th scope="col">Dönem</th><th scope="col">Bitişe kalan</th><th scope="col">Durum</th></tr></thead><tbody>
    ${liste.map((c) => html`<tr><td><a class="link" href="#/sozlesmeler/${c.id}"><strong>${tarih(c.start_date)} – ${tarih(c.end_date)}</strong></a></td><td>${bitisRozeti(c, bugunStr)}</td><td>${sozlesmePill(c.status)}</td></tr>`)}</tbody></table></div>`;
}
