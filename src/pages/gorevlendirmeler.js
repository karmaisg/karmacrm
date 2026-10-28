// OSGB 360 - Görevlendirmeler: uzman/hekimin firmaya hizmet payı ve yürürlük tarihleri.
import { html, bugun, tarih, sayi, icerir, trSirala } from '../lib/format.js';
import { icon } from '../ui/icons.js';
import { avatar, pill, emptyState, field, openFormModal, confirmDialog, toast, sayfalama } from '../ui/components.js';
import { PERSONEL_TURU, PERSONEL_TURU_KISA, aktifMi, kapsamPayi } from '../lib/operasyon.js';
import { bosIseNull } from '../lib/veri.js';
import { humanError } from '../lib/api.js';

const SAYFA_BASI = 25;

export function gorevlendirmeDurumu(a, bugunStr = bugun()) {
  if (a.archived_at) return pill('Arşivde', 'neutral');
  if (a.valid_from > bugunStr) return pill('Başlayacak', 'info');
  if (a.valid_to && a.valid_to < bugunStr) return pill('Bitti', 'neutral');
  return pill('Yürürlükte', 'success');
}

/** Yeni görevlendirme formu. firma veya personel önceden seçili gelebilir. */
export async function gorevlendirmeFormuAc(app, { companyId = null, employeeId = null, onDone = null } = {}) {
  let personel = [], firmalar = [], atamalar = [];
  try {
    [personel, firmalar, atamalar] = await Promise.all([app.api.listStaff(), app.api.listCompanies(), app.api.listAssignments()]);
  } catch (e) { toast(humanError(e), 'hata'); return; }
  personel = personel.filter((p) => p.is_active && !p.archived_at);
  const onKisi = personel.find((p) => p.id === employeeId);
  const ilkTur = onKisi?.staff_type ?? 'is_guvenligi_uzmani';
  const firmaSec = [{ deger: '', etiket: 'Seçiniz' }].concat(firmalar.filter((f) => !f.archived_at).sort((a, b) => trSirala(a.name, b.name)).map((f) => ({ deger: f.id, etiket: f.name })));
  const kisiSecenekleri = (tur) => [{ deger: '', etiket: 'Seçiniz' }].concat(personel.filter((p) => p.staff_type === tur).sort((a, b) => trSirala(a.full_name, b.full_name)).map((p) => ({ deger: p.id, etiket: p.full_name })));
  const m = openFormModal({
    baslik: 'Yeni görevlendirme', altBaslik: 'Firmanın toplam hizmet ihtiyacından bu kişiye düşen pay', boyut: 'lg', gonderEtiketi: 'Görevlendir',
    govde: html`${field({ ad: 'company_id', etiket: 'Firma', zorunlu: true, deger: companyId ?? '', secenekler: firmaSec, tam: true, pasif: !!companyId })}
      ${field({ ad: 'staff_type', etiket: 'Hizmet türü', zorunlu: true, deger: ilkTur, pasif: !!employeeId, secenekler: Object.entries(PERSONEL_TURU).map(([deger, etiket]) => ({ deger, etiket })) })}
      ${field({ ad: 'employee_id', etiket: 'Personel', zorunlu: true, deger: employeeId ?? '', secenekler: kisiSecenekleri(ilkTur), pasif: !!employeeId })}
      ${field({ ad: 'share_pct', etiket: 'Hizmet payı (%)', tur: 'number', min: 1, max: 100, adim: '0.01', inputmode: 'decimal', zorunlu: true, deger: 100 })}
      ${field({ ad: 'valid_from', etiket: 'Başlangıç', tur: 'date', zorunlu: true, deger: bugun() })}
      ${field({ ad: 'valid_to', etiket: 'Bitiş (boşsa süresiz)', tur: 'date' })}
      <div class="field field-full" id="pay-bilgisi" aria-live="polite"></div>
      ${field({ ad: 'official_ref', etiket: 'Resmî görevlendirme / bildirim no', maksUzunluk: 100, ipucu: 'İSG-KATİP vb. Sözleşme tarihlerinden ayrıdır.' })}
      ${field({ ad: 'official_start', etiket: 'Resmî başlangıç', tur: 'date' })}
      ${field({ ad: 'official_end', etiket: 'Resmî bitiş', tur: 'date' })}
      ${field({ ad: 'notes', etiket: 'Not', tur: 'textarea', tam: true, maksUzunluk: 1000 })}`,
    async onSubmit(fd) {
      const g = (k) => String(fd.get(k) ?? '').trim();
      const firma = companyId ?? g('company_id');
      const kisi = employeeId ?? g('employee_id');
      const tur = onKisi?.staff_type ?? g('staff_type');
      const h = {};
      if (!firma) h.company_id = 'Firma seçin.';
      if (!kisi) h.employee_id = 'Personel seçin.';
      const pay = Number(g('share_pct'));
      if (g('share_pct') === '' || !(pay > 0 && pay <= 100)) h.share_pct = 'Pay 0 ile 100 arasında olmalıdır.';
      if (!g('valid_from')) h.valid_from = 'Başlangıç tarihini seçin.';
      if (g('valid_to') && g('valid_from') && g('valid_to') < g('valid_from')) h.valid_to = 'Bitiş, başlangıçtan önce olamaz.';
      if (g('official_start') && g('official_end') && g('official_end') < g('official_start')) h.official_end = 'Resmî bitiş, başlangıçtan önce olamaz.';
      if (Object.keys(h).length) return { errors: h };
      await app.api.createAssignment({
        company_id: firma, employee_id: kisi, staff_type: tur, share_pct: pay, valid_from: g('valid_from'), valid_to: bosIseNull(g('valid_to')),
        official_ref: bosIseNull(g('official_ref')), official_start: bosIseNull(g('official_start')), official_end: bosIseNull(g('official_end')), notes: bosIseNull(g('notes')),
      });
      toast('Görevlendirme kaydedildi.');
    },
    onDone: () => (onDone ? onDone() : app.yenile()),
  });
  const form = m.el.querySelector('form');
  const bilgi = form.querySelector('#pay-bilgisi');
  const guncelle = () => {
    const firma = companyId ?? form.elements.company_id.value;
    const tur = onKisi?.staff_type ?? form.elements.staff_type.value;
    const gun = form.elements.valid_from.value || bugun();
    if (!firma) { bilgi.innerHTML = ''; return; }
    const dolu = kapsamPayi(atamalar, firma, tur, gun);
    bilgi.innerHTML = (dolu >= 100
      ? html`<div class="notice notice-warn" role="status">Bu firmada ${PERSONEL_TURU[tur].toLowerCase()} hizmeti ${tarih(gun)} tarihinde zaten %100 görevlendirilmiş. Önce mevcut payı azaltın.</div>`
      : html`<div class="notice notice-info" role="status">Bu firmada ${tarih(gun)} tarihinde ${PERSONEL_TURU[tur].toLowerCase()} payının %${sayi(dolu)}'ü dolu; kalan %${sayi(100 - dolu)}.</div>`).s;
  };
  form.addEventListener('change', (e) => {
    if (e.target.name === 'staff_type') {
      const sel = form.elements.employee_id;
      sel.innerHTML = kisiSecenekleri(e.target.value).map((s) => `<option value="${String(s.deger).replace(/"/g, '&quot;')}">${String(s.etiket).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))}</option>`).join('');
    }
    guncelle();
  });
  form.addEventListener('input', (e) => { if (e.target.name === 'valid_from') guncelle(); });
  guncelle();
}

function duzenleFormu(app, a, adiyla) {
  const basladi = a.valid_from <= bugun();
  openFormModal({
    baslik: 'Görevlendirmeyi düzenle', altBaslik: adiyla, gonderEtiketi: 'Kaydet',
    govde: html`${basladi ? html`<div class="notice notice-info field-full" role="status">Başlamış görevlendirmenin payı ve başlangıcı değiştirilemez; pay için "Payı değiştir"i kullanın.</div>` : ''}
      ${field({ ad: 'share_pct', etiket: 'Hizmet payı (%)', tur: 'number', min: 1, max: 100, adim: '0.01', deger: a.share_pct, pasif: basladi })}
      ${field({ ad: 'valid_from', etiket: 'Başlangıç', tur: 'date', deger: a.valid_from, pasif: basladi })}
      ${field({ ad: 'valid_to', etiket: 'Bitiş (boşsa süresiz)', tur: 'date', deger: a.valid_to ?? '' })}
      ${field({ ad: 'official_ref', etiket: 'Resmî görevlendirme / bildirim no', maksUzunluk: 100, deger: a.official_ref ?? '' })}
      ${field({ ad: 'official_start', etiket: 'Resmî başlangıç', tur: 'date', deger: a.official_start ?? '' })}
      ${field({ ad: 'official_end', etiket: 'Resmî bitiş', tur: 'date', deger: a.official_end ?? '' })}
      ${field({ ad: 'notes', etiket: 'Not', tur: 'textarea', tam: true, maksUzunluk: 1000, deger: a.notes ?? '' })}`,
    async onSubmit(fd) {
      const g = (k) => String(fd.get(k) ?? '').trim();
      const h = {};
      const bas = basladi ? a.valid_from : g('valid_from');
      if (g('valid_to') && g('valid_to') < bas) h.valid_to = 'Bitiş, başlangıçtan önce olamaz.';
      if (g('official_start') && g('official_end') && g('official_end') < g('official_start')) h.official_end = 'Resmî bitiş, başlangıçtan önce olamaz.';
      if (!basladi && !(Number(g('share_pct')) > 0 && Number(g('share_pct')) <= 100)) h.share_pct = 'Pay 0 ile 100 arasında olmalıdır.';
      if (Object.keys(h).length) return { errors: h };
      const d = { valid_to: bosIseNull(g('valid_to')), official_ref: bosIseNull(g('official_ref')), official_start: bosIseNull(g('official_start')), official_end: bosIseNull(g('official_end')), notes: bosIseNull(g('notes')) };
      if (!basladi) { d.share_pct = Number(g('share_pct')); d.valid_from = g('valid_from'); }
      await app.api.updateAssignment(a.id, d);
      toast('Görevlendirme güncellendi.');
    },
    onDone: () => app.yenile(),
  });
}

function payDegistirFormu(app, a, adiyla) {
  let yeni = bugun() > a.valid_from ? bugun() : a.valid_from;
  yeni = bugun() > a.valid_from ? bugun() : new Date(new Date(`${a.valid_from}T00:00:00Z`).getTime() + 86400000).toISOString().slice(0, 10);
  openFormModal({
    baslik: 'Hizmet payını değiştir', altBaslik: `${adiyla} · şu an %${sayi(Number(a.share_pct))}`, gonderEtiketi: 'Yeni payı kaydet',
    govde: html`${field({ ad: 'pay', etiket: 'Yeni pay (%)', tur: 'number', min: 1, max: 100, adim: '0.01', zorunlu: true, deger: a.share_pct })}
      ${field({ ad: 'baslangic', etiket: 'Yeni payın başlangıcı', tur: 'date', zorunlu: true, deger: yeni, ipucu: 'Mevcut dönem bu tarihin bir gün öncesinde biter; geçmiş aylar eski payla hesaplanır.' })}
      ${field({ ad: 'not', etiket: 'Not', tam: true, maksUzunluk: 300 })}`,
    async onSubmit(fd) {
      const g = (k) => String(fd.get(k) ?? '').trim();
      const h = {};
      const pay = Number(g('pay'));
      if (g('pay') === '' || !(pay > 0 && pay <= 100)) h.pay = 'Pay 0 ile 100 arasında olmalıdır.';
      if (!g('baslangic')) h.baslangic = 'Başlangıç tarihini seçin.';
      else if (g('baslangic') <= a.valid_from) h.baslangic = 'Başlangıç, mevcut dönemin başlangıcından sonra olmalıdır.';
      if (Object.keys(h).length) return { errors: h };
      await app.api.changeAssignment({ id: a.id, pay, baslangic: g('baslangic'), not: bosIseNull(g('not')) });
      toast('Yeni pay kaydedildi.');
    },
    onDone: () => app.yenile(),
  });
}

function bitirFormu(app, a, adiyla) {
  openFormModal({
    baslik: 'Görevlendirmeyi bitir', altBaslik: adiyla, gonderEtiketi: 'Bitir',
    govde: html`${field({ ad: 'bitis', etiket: 'Son çalışma günü', tur: 'date', zorunlu: true, deger: bugun() < a.valid_from ? a.valid_from : bugun(), tam: true })}`,
    async onSubmit(fd) {
      const b = String(fd.get('bitis') ?? '').trim();
      if (!b) return { errors: { bitis: 'Tarih seçin.' } };
      if (b < a.valid_from) return { errors: { bitis: 'Bitiş, başlangıçtan önce olamaz.' } };
      await app.api.updateAssignment(a.id, { valid_to: b });
      toast('Görevlendirme bitirildi.');
    },
    onDone: () => app.yenile(),
  });
}

/** Görevlendirme satırı eylem düğmeleri (liste ve firma sekmesi ortak). data-gv-eylem olaylarını sayfa yönetir. */
export function gorevlendirmeEylemleri(app, a, bugunStr = bugun()) {
  if (a.archived_at) return '';
  const duzenle = app.can('assignments', 'edit');
  const bitmis = a.valid_to && a.valid_to < bugunStr;
  return html`${duzenle ? html`<button type="button" class="icon-btn" data-gv-eylem="duzenle" data-id="${a.id}" aria-label="Görevlendirmeyi düzenle" title="Düzenle">${icon('pencil', 16)}</button>` : ''}
    ${duzenle && app.can('assignments', 'create') && !bitmis ? html`<button type="button" class="icon-btn" data-gv-eylem="pay" data-id="${a.id}" aria-label="Payı değiştir" title="Payı değiştir">${icon('trend', 16)}</button>` : ''}
    ${duzenle && !bitmis ? html`<button type="button" class="icon-btn" data-gv-eylem="bitir" data-id="${a.id}" aria-label="Görevlendirmeyi bitir" title="Bitir">${icon('clock', 16)}</button>` : ''}
    ${app.can('assignments', 'archive') ? html`<button type="button" class="icon-btn" data-gv-eylem="arsiv" data-id="${a.id}" aria-label="Görevlendirmeyi arşivle" title="Arşivle">${icon('archive', 16)}</button>` : ''}`;
}

export async function gorevlendirmeEylemiYurut(app, eylem, a, adiyla) {
  if (eylem === 'duzenle') duzenleFormu(app, a, adiyla);
  else if (eylem === 'pay') payDegistirFormu(app, a, adiyla);
  else if (eylem === 'bitir') bitirFormu(app, a, adiyla);
  else if (eylem === 'arsiv') {
    if (!(await confirmDialog({ baslik: 'Görevlendirmeyi arşivle', onayEtiketi: 'Arşivle', tehlikeli: true, mesaj: `${adiyla} görevlendirmesi arşive alınacak ve pay hesabına dahil edilmeyecek. Kayıt silinmez.` }))) return;
    try { await app.api.archiveAssignment(a.id); toast('Görevlendirme arşive alındı.'); app.yenile(); } catch (e) { toast(humanError(e), 'hata'); }
  }
}

// ---------------------------------------------------------------- liste
export async function gorevlendirmelerSayfasi(app) {
  const [atamalar, personel, firmalar] = await Promise.all([
    app.api.listAssignments(), app.api.listStaff(),
    app.can('companies', 'view') ? app.api.listCompanies() : [],
  ]);
  const bugunStr = bugun();
  const firmaAdi = new Map(firmalar.map((f) => [f.id, f.name]));
  const kisiAdi = new Map(personel.map((p) => [p.id, p]));
  const durum = { filtre: 'yururlukte', tur: '', q: '', sayfa: 1 };
  const GRUP = {
    yururlukte: (a) => !a.archived_at && aktifMi(a, bugunStr), baslayacak: (a) => !a.archived_at && a.valid_from > bugunStr,
    biten: (a) => !a.archived_at && !!a.valid_to && a.valid_to < bugunStr, tumu: (a) => !a.archived_at, arsiv: (a) => !!a.archived_at,
  };
  const FILTRELER = [['yururlukte', 'Yürürlükte'], ['baslayacak', 'Başlayacak'], ['biten', 'Biten'], ['tumu', 'Tümü'], ['arsiv', 'Arşivli']];
  const sayilar = Object.fromEntries(Object.entries(GRUP).map(([k, f]) => [k, atamalar.filter(f).length]));
  const olusturabilir = app.can('assignments', 'create');
  const adiyla = (a) => `${firmaAdi.get(a.company_id) ?? 'Firma'} / ${kisiAdi.get(a.employee_id)?.full_name ?? 'Personel'}`;

  const satir = (a) => html`<tr class="${a.archived_at ? 'row-muted' : ''}">
    <td><span class="cell-main">${avatar(firmaAdi.get(a.company_id) ?? 'F')}<span><strong>${firmaAdi.get(a.company_id) ? html`<a class="link" href="#/firmalar/${a.company_id}">${firmaAdi.get(a.company_id)}</a>` : 'Firma'}</strong>
      <small>${a.official_ref ? `Resmî: ${a.official_ref}` : `${tarih(a.valid_from)} – ${a.valid_to ? tarih(a.valid_to) : 'devam'}`}</small></span></span></td>
    <td>${kisiAdi.get(a.employee_id) ? html`<a class="link" href="#/personel/${a.employee_id}">${kisiAdi.get(a.employee_id).full_name}</a>` : 'Personel'} <small class="muted">${PERSONEL_TURU_KISA[a.staff_type]}</small></td>
    <td class="num">%${sayi(Number(a.share_pct))}</td>
    <td class="hide-md">${tarih(a.valid_from)} – ${a.valid_to ? tarih(a.valid_to) : 'devam'}</td>
    <td>${gorevlendirmeDurumu(a, bugunStr)}</td>
    <td class="actions">${gorevlendirmeEylemleri(app, a, bugunStr)}</td></tr>`;
  function tablo() {
    if (!atamalar.length) {
      return emptyState({ simge: 'briefcase', baslik: 'Henüz görevlendirme yok', metin: 'Uzman ve hekimleri firmalara payla görevlendirin; kapasite analizi bu kayıtlardan hesaplanır.',
        eylem: olusturabilir ? html`<button type="button" class="btn btn-primary" data-action="yeni-gv">${icon('plus', 18)} İlk görevlendirmeyi yap</button>` : '' });
    }
    let l = atamalar.filter(GRUP[durum.filtre]);
    if (durum.tur) l = l.filter((a) => a.staff_type === durum.tur);
    if (durum.q.trim()) l = l.filter((a) => icerir(`${firmaAdi.get(a.company_id) ?? ''} ${kisiAdi.get(a.employee_id)?.full_name ?? ''}`, durum.q));
    l.sort((a, b) => trSirala(firmaAdi.get(a.company_id), firmaAdi.get(b.company_id)) || String(b.valid_from).localeCompare(String(a.valid_from)));
    if (!l.length) return emptyState({ simge: 'search', baslik: 'Eşleşen görevlendirme yok', metin: 'Arama veya filtreyi değiştirmeyi deneyin.' });
    const sayfaSayisi = Math.max(1, Math.ceil(l.length / SAYFA_BASI));
    durum.sayfa = Math.min(durum.sayfa, sayfaSayisi);
    return html`<div class="table-wrap"><table class="table"><thead><tr><th scope="col">Firma</th><th scope="col">Personel</th><th scope="col" class="num">Pay</th><th scope="col" class="hide-md">Dönem</th><th scope="col">Durum</th><th scope="col"><span class="sr-only">Eylemler</span></th></tr></thead>
      <tbody>${l.slice((durum.sayfa - 1) * SAYFA_BASI, durum.sayfa * SAYFA_BASI).map(satir)}</tbody></table></div>
      ${sayfalama({ sayfa: durum.sayfa, sayfaSayisi, toplam: l.length, sayfaBasi: SAYFA_BASI })}`;
  }
  const filtreHtml = () => html`${FILTRELER.map(([id, a]) => html`<button type="button" class="chip ${durum.filtre === id ? 'chip-on' : ''}" data-filtre="${id}" aria-pressed="${durum.filtre === id}">${a} <span class="chip-n">${sayilar[id]}</span></button>`)}`;

  return {
    baslik: 'Görevlendirmeler', altBaslik: 'Uzman ve hekimlerin firmalara hizmet payı ve yürürlük tarihleri',
    eylemler: olusturabilir ? html`<button type="button" class="btn btn-primary" data-action="yeni-gv">${icon('plus', 18)} Yeni görevlendirme</button>` : '',
    govde: html`<section class="card card-flush"><div class="toolbar">
      <div class="search-field">${icon('search', 18)}<input type="search" id="gv-ara" placeholder="Firma veya personel ara" aria-label="Görevlendirmelerde ara" autocomplete="off"></div>
      <label class="select-inline"><span class="sr-only">Hizmet türü</span><select id="gv-tur"><option value="">Tüm hizmet türleri</option>${Object.entries(PERSONEL_TURU).map(([k, v]) => html`<option value="${k}">${v}</option>`)}</select></label>
      <div class="chips" id="gv-filtre" role="group" aria-label="Görevlendirme filtresi">${filtreHtml()}</div></div><div id="gv-tablo">${tablo()}</div></section>`,
    mount(kok) {
      const t = kok.querySelector('#gv-tablo');
      const yenile = () => { t.innerHTML = tablo().s; };
      kok.querySelector('#gv-ara').addEventListener('input', (e) => { durum.q = e.target.value; durum.sayfa = 1; yenile(); });
      kok.querySelector('#gv-tur').addEventListener('change', (e) => { durum.tur = e.target.value; durum.sayfa = 1; yenile(); });
      kok.querySelector('#gv-filtre').addEventListener('click', (e) => {
        const d = e.target.closest('[data-filtre]'); if (!d) return;
        durum.filtre = d.dataset.filtre; durum.sayfa = 1; kok.querySelector('#gv-filtre').innerHTML = filtreHtml().s; yenile();
      });
      kok.addEventListener('click', (e) => {
        if (e.target.closest('[data-action="yeni-gv"]')) { gorevlendirmeFormuAc(app); return; }
        const sf = e.target.closest('[data-sayfa]');
        if (sf && !sf.disabled) { durum.sayfa = Number(sf.dataset.sayfa); yenile(); return; }
        const d = e.target.closest('[data-gv-eylem]');
        if (d) { const a = atamalar.find((x) => x.id === d.dataset.id); if (a) gorevlendirmeEylemiYurut(app, d.dataset.gvEylem, a, adiyla(a)); }
      });
    },
  };
}
