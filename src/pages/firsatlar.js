// OSGB 360 - Satış fırsatları: kanban panosu, fırsat formu, aşama taşıma ve geçmiş.
import { html, bugun, tarih, tarihSaat, para, icerir, trSirala, gunFarki } from '../lib/format.js';
import { icon } from '../ui/icons.js';
import { avatar, pill, emptyState, field, openFormModal, openModal, confirmDialog, toast } from '../ui/components.js';
import { ASAMALAR, ASAMA_SIRASI, KAYIP_NEDENLERI, huniOzeti } from '../lib/puanlama.js';
import { bosIseNull } from '../lib/veri.js';
import { humanError } from '../lib/api.js';

const ASAMA_TON = { kazanildi: 'success', kaybedildi: 'danger', ertelendi: 'neutral', pazarlik: 'warning', teklif_gonderildi: 'info' };
export const asamaPill = (a) => pill(ASAMALAR[a] ?? a, ASAMA_TON[a] ?? 'neutral');

/** Aşama taşıma: "kaybedildi" için neden sorar. Başarılıysa true döner. */
export async function firsatTasi(app, firsat, hedef, { leadDonusmus = true } = {}) {
  if (firsat.stage === hedef) return false;
  try {
    if (hedef === 'kaybedildi') {
      return await new Promise((coz) => {
        let bitti = false;
        const m = openFormModal({
          baslik: 'Fırsat kaybedildi', altBaslik: firsat.title, gonderEtiketi: 'Kaybedildi olarak işaretle',
          govde: html`${field({ ad: 'lost_reason', etiket: 'Kayıp nedeni', zorunlu: true, deger: '', tam: true,
            secenekler: [{ deger: '', etiket: 'Seçiniz' }].concat(Object.entries(KAYIP_NEDENLERI).map(([deger, etiket]) => ({ deger, etiket }))) })}
            ${field({ ad: 'lost_note', etiket: 'Not', tur: 'textarea', deger: '', tam: true, maksUzunluk: 500, ipucu: 'Neden kaybettiğimizi sonradan analiz edebilmek için kısa bir not yazın.' })}`,
          async onSubmit(fd) {
            const neden = String(fd.get('lost_reason') ?? '');
            if (!neden) return { errors: { lost_reason: 'Kayıp nedenini seçin.' } };
            await app.api.moveOpportunity(firsat.id, 'kaybedildi', { neden, not: bosIseNull(String(fd.get('lost_note') ?? '').trim()) });
            bitti = true; toast('Fırsat kaybedildi olarak işaretlendi.');
          },
          onDone: () => coz(true),
        });
        m.el.addEventListener('click', (e) => { if (!bitti && e.target.closest('[data-close]')) setTimeout(() => coz(false), 0); });
      });
    }
    await app.api.moveOpportunity(firsat.id, hedef);
    toast(`Fırsat "${ASAMALAR[hedef]}" aşamasına taşındı.`);
    if (hedef === 'kazanildi' && firsat.lead_id && !leadDonusmus && app.can('crm', 'edit')) {
      toast('Fırsat kazanıldı. Potansiyel müşteriyi firmaya dönüştürmeyi unutmayın.', 'bilgi');
    }
    return true;
  } catch (e) { toast(humanError(e), 'hata'); return false; }
}

export async function firsatFormuAc(app, { firsat = null, leadId = null, companyId = null, onDone = null } = {}) {
  const duzenle = firsat !== null;
  let uyeler = [], firmalar = [], adaylar = [];
  try {
    [uyeler, firmalar, adaylar] = await Promise.all([
      app.api.listOrgMembers().catch(() => []),
      app.can('companies', 'view') ? app.api.listCompanies() : [],
      app.can('crm', 'view') ? app.api.listLeads() : [],
    ]);
  } catch (e) { toast(humanError(e), 'hata'); return; }
  const secAday = firsat?.lead_id ?? leadId ?? '';
  const secFirma = firsat?.company_id ?? companyId ?? '';
  const sabit = !duzenle && (leadId || companyId);
  const uyeSec = [{ deger: '', etiket: 'Atanmamış' }].concat(
    uyeler.filter((u) => u.is_active || u.id === firsat?.owner_user).map((u) => ({ deger: u.id, etiket: u.is_active ? u.full_name : `${u.full_name} (pasif)` })));
  const adaySec = [{ deger: '', etiket: 'Seçiniz' }].concat(
    adaylar.filter((l) => (!l.archived_at && !l.converted_company_id) || l.id === secAday).sort((a, b) => trSirala(a.name, b.name)).map((l) => ({ deger: l.id, etiket: l.name })));
  const firmaSec = [{ deger: '', etiket: 'Seçiniz' }].concat(
    firmalar.filter((f) => !f.archived_at || f.id === secFirma).sort((a, b) => trSirala(a.name, b.name)).map((f) => ({ deger: f.id, etiket: f.name })));

  openFormModal({
    baslik: duzenle ? 'Fırsatı düzenle' : 'Yeni satış fırsatı', gonderEtiketi: duzenle ? 'Değişiklikleri kaydet' : 'Fırsatı ekle',
    altBaslik: duzenle ? firsat.title : 'Bir potansiyel müşteriye veya mevcut firmaya bağlayın',
    govde: html`
      ${field({ ad: 'title', etiket: 'Başlık', zorunlu: true, deger: firsat?.title ?? '', tam: true, maksUzunluk: 200 })}
      ${app.can('crm', 'view') ? field({ ad: 'lead_id', etiket: 'Potansiyel müşteri', deger: secAday, secenekler: adaySec, pasif: !!sabit && !!leadId }) : ''}
      ${app.can('companies', 'view') ? field({ ad: 'company_id', etiket: 'Mevcut firma', deger: secFirma, secenekler: firmaSec, pasif: !!sabit && !!companyId,
        ipucu: 'Mevcut müşteriye ek hizmet fırsatı için firmayı seçin.' }) : ''}
      ${field({ ad: 'expected_monthly', etiket: 'Beklenen aylık gelir (TL)', tur: 'number', min: 0, adim: '0.01', inputmode: 'decimal', deger: firsat?.expected_monthly ?? '' })}
      ${field({ ad: 'owner_user', etiket: 'Sorumlu', deger: firsat?.owner_user ?? app.ctx.user.id, secenekler: uyeSec })}`,
    async onSubmit(fd) {
      const g = (k) => String(fd.get(k) ?? '').trim();
      const h = {};
      if (!g('title')) h.title = 'Başlık zorunludur.';
      const aday = leadId && !duzenle ? leadId : g('lead_id');
      const firma = companyId && !duzenle ? companyId : g('company_id');
      if (!aday && !firma) h.lead_id = 'Bir potansiyel müşteri veya firma seçin.';
      if (g('expected_monthly') !== '' && !(Number(g('expected_monthly')) >= 0)) h.expected_monthly = 'Tutar 0 veya daha büyük olmalıdır.';
      if (Object.keys(h).length) return { errors: h };
      const degerler = {
        title: g('title'), lead_id: bosIseNull(aday), company_id: bosIseNull(firma),
        expected_monthly: g('expected_monthly') === '' ? null : Number(g('expected_monthly')), owner_user: bosIseNull(g('owner_user')),
      };
      if (duzenle) await app.api.updateOpportunity(firsat.id, degerler); else await app.api.createOpportunity(degerler);
      toast(duzenle ? 'Fırsat güncellendi.' : 'Fırsat eklendi.');
    },
    onDone: () => (onDone ? onDone() : app.yenile()),
  });
}

async function firsatAyrintisi(app, firsat, { ad, uyeAdi, onDone }) {
  let gecmis = [];
  try { gecmis = await app.api.listStageHistory(firsat.id); } catch (e) { toast(humanError(e), 'hata'); }
  const duzenleyebilir = app.can('opportunities', 'edit');
  const arsivleyebilir = app.can('opportunities', 'archive');
  const m = openModal({
    baslik: firsat.title, altBaslik: ad, boyut: 'md',
    govde: html`<dl class="kv-list">
        <div class="kv"><dt>Aşama</dt><dd>${asamaPill(firsat.stage)}</dd></div>
        <div class="kv"><dt>Beklenen aylık gelir</dt><dd>${para(firsat.expected_monthly)}</dd></div>
        <div class="kv"><dt>Sorumlu</dt><dd>${uyeAdi.get(firsat.owner_user) || html`<span class="muted">—</span>`}</dd></div>
        <div class="kv"><dt>Oluşturulma</dt><dd>${tarihSaat(firsat.created_at)}</dd></div>
        ${firsat.stage === 'kaybedildi' ? html`<div class="kv"><dt>Kayıp nedeni</dt><dd>${KAYIP_NEDENLERI[firsat.lost_reason] ?? '—'}${firsat.lost_note ? html` · ${firsat.lost_note}` : ''}</dd></div>` : ''}
      </dl>
      <h3 class="sub-title">Aşama geçmişi</h3>
      ${gecmis.length ? html`<ol class="history">${gecmis.map((h) => html`<li><span>${h.from_stage ? html`${ASAMALAR[h.from_stage]} <span class="muted">→</span> ` : 'Açıldı: '}<strong>${ASAMALAR[h.to_stage]}</strong></span>
        <small>${tarihSaat(h.changed_at)}${h.changed_by && uyeAdi.get(h.changed_by) ? ` · ${uyeAdi.get(h.changed_by)}` : ''}</small></li>`)}</ol>` : html`<p class="muted">Geçmiş kaydı yok.</p>`}
      <div class="modal-actions">
        ${arsivleyebilir ? html`<button type="button" class="btn btn-secondary" data-arsiv>${icon('archive', 18)} Arşivle</button>` : ''}
        ${duzenleyebilir ? html`<button type="button" class="btn btn-primary" data-duzenle>${icon('pencil', 18)} Düzenle</button>` : ''}
      </div>`,
  });
  m.el.querySelector('[data-duzenle]')?.addEventListener('click', () => { m.close(); firsatFormuAc(app, { firsat, onDone }); });
  m.el.querySelector('[data-arsiv]')?.addEventListener('click', async () => {
    if (!(await confirmDialog({ baslik: 'Fırsatı arşivle', onayEtiketi: 'Arşivle', tehlikeli: true, mesaj: `"${firsat.title}" fırsatı panodan kalkacak. Kayıt silinmez.` }))) return;
    try { await app.api.archiveOpportunity(firsat.id); m.close(); toast('Fırsat arşive alındı.'); await onDone?.(); } catch (e) { toast(humanError(e), 'hata'); }
  });
}

export async function firsatlarSayfasi(app) {
  const [firsatlar, uyeler, firmalar, adaylar] = await Promise.all([
    app.api.listOpportunities(),
    app.api.listOrgMembers().catch(() => []),
    app.can('companies', 'view') ? app.api.listCompanies() : [],
    app.can('crm', 'view') ? app.api.listLeads() : [],
  ]);
  const uyeAdi = new Map(uyeler.map((u) => [u.id, u.full_name]));
  const firmaAdi = new Map(firmalar.map((f) => [f.id, f.name]));
  const adayAdi = new Map(adaylar.map((l) => [l.id, l.name]));
  const adayDonusmus = new Map(adaylar.map((l) => [l.id, !!l.converted_company_id]));
  const olusturabilir = app.can('opportunities', 'create');
  const tasiyabilir = app.can('opportunities', 'edit');
  const durum = { q: '', sahip: 'tumu' };
  const canli = firsatlar.filter((f) => !f.archived_at);
  const kimin = (f) => (f.company_id && firmaAdi.get(f.company_id)) || (f.lead_id && adayAdi.get(f.lead_id)) || '';

  const gorunen = () => canli.filter((f) => (durum.sahip === 'benim' ? f.owner_user === app.ctx.user.id : true)
    && (!durum.q.trim() || [f.title, kimin(f)].some((d) => d && icerir(d, durum.q))));

  const kart = (f) => {
    const bagli = f.company_id && firmaAdi.get(f.company_id) ? html`<a class="link" href="#/firmalar/${f.company_id}">${firmaAdi.get(f.company_id)}</a>`
      : f.lead_id && adayAdi.get(f.lead_id) ? html`<a class="link" href="#/crm/${f.lead_id}">${adayAdi.get(f.lead_id)}</a>` : '';
    return html`<article class="kcard" ${tasiyabilir ? html`draggable="true"` : ''} data-kart="${f.id}">
      <button type="button" class="kcard-baslik" data-firsat="${f.id}">${f.title}</button>
      <div class="kcard-alt">${bagli}</div>
      <div class="kcard-satir"><strong>${f.expected_monthly === null ? html`<span class="muted">Tutar yok</span>` : html`${para(f.expected_monthly)}<small>/ay</small>`}</strong>
        ${f.owner_user && uyeAdi.get(f.owner_user) ? html`<span title="${uyeAdi.get(f.owner_user)}">${avatar(uyeAdi.get(f.owner_user), 'sm')}</span>` : ''}</div>
      ${f.stage === 'kaybedildi' ? html`<div class="kcard-not">${KAYIP_NEDENLERI[f.lost_reason] ?? ''}</div>` : ''}
      ${f.stage !== 'kazanildi' && f.stage !== 'kaybedildi' ? html`<div class="kcard-yas">${gunFarki(String(f.created_at).slice(0, 10), bugun())} gündür açık</div>` : ''}
      ${tasiyabilir ? html`<label class="kcard-tasi"><span class="sr-only">${f.title} fırsatının aşamasını değiştir</span>
        <select data-tasi="${f.id}" aria-label="${f.title} aşamasını değiştir">${ASAMA_SIRASI.map((a) => html`<option value="${a}" ${a === f.stage ? html`selected` : ''}>${ASAMALAR[a]}</option>`)}</select></label>` : ''}
    </article>`;
  };

  const pano = () => {
    const liste = gorunen();
    return html`<div class="kanban" role="list">${ASAMA_SIRASI.map((a) => {
      const k = liste.filter((f) => f.stage === a).sort((x, y) => String(y.updated_at).localeCompare(String(x.updated_at)));
      const toplam = k.reduce((t, f) => t + Number(f.expected_monthly ?? 0), 0);
      return html`<section class="kcol kcol-${a}" role="listitem" data-asama="${a}" aria-label="${ASAMALAR[a]}">
        <header class="kcol-bas"><h2>${ASAMALAR[a]}</h2><span class="chip-n">${k.length}</span></header>
        <div class="kcol-toplam">${para(toplam)}<small>/ay</small></div>
        <div class="kcol-liste">${k.length ? k.map(kart) : html`<p class="kcol-bos">Fırsat yok</p>`}</div></section>`;
    })}</div>`;
  };

  const ozet = huniOzeti(canli);
  const ozetHtml = () => { const o = huniOzeti(gorunen()); return html`<strong>${o.acik.adet}</strong> açık fırsat · beklenen <strong>${para(o.acik.tutar)}</strong>/ay`; };

  return {
    baslik: 'Satış fırsatları',
    altBaslik: 'Kartı sürükleyin ya da kartın altındaki listeden aşamayı seçin. Her taşıma tarih ve kullanıcıyla kaydedilir.',
    eylemler: olusturabilir ? html`<button type="button" class="btn btn-primary" data-action="yeni-firsat">${icon('plus', 18)} Yeni fırsat</button>` : '',
    govde: !firsatlar.length && !olusturabilir ? emptyState({ simge: 'kanban', baslik: 'Henüz fırsat yok' }) : html`<section class="card card-flush">
      <div class="toolbar">
        <div class="search-field">${icon('search', 18)}<input type="search" id="firsat-ara" placeholder="Fırsat veya firma ara" aria-label="Fırsatlarda ara" autocomplete="off"></div>
        <div class="chips" id="firsat-sahip" role="group" aria-label="Sorumlu filtresi">
          <button type="button" class="chip chip-on" data-sahip="tumu" aria-pressed="true">Tümü</button>
          <button type="button" class="chip" data-sahip="benim" aria-pressed="false">Bana atanan</button></div>
        <p class="toolbar-ozet" id="firsat-ozet" aria-live="polite">${ozetHtml()}</p>
      </div>
      ${canli.length ? html`<div id="firsat-pano">${pano()}</div>` : emptyState({ simge: 'kanban', baslik: 'Henüz satış fırsatı yok',
        metin: 'Potansiyel müşteri eklediğinizde ilk fırsat otomatik açılır. Mevcut müşterilere ek hizmet fırsatını buradan ekleyebilirsiniz.',
        eylem: olusturabilir ? html`<button type="button" class="btn btn-primary" data-action="yeni-firsat">${icon('plus', 18)} İlk fırsatı ekle</button>` : '' })}
    </section>`,
    mount(kok) {
      void ozet;
      const panoEl = kok.querySelector('#firsat-pano');
      const ciz = () => { if (panoEl) panoEl.innerHTML = pano().s; kok.querySelector('#firsat-ozet').innerHTML = ozetHtml().s; };
      kok.querySelector('#firsat-ara')?.addEventListener('input', (e) => { durum.q = e.target.value; ciz(); });
      kok.querySelector('#firsat-sahip')?.addEventListener('click', (e) => {
        const d = e.target.closest('[data-sahip]'); if (!d) return;
        durum.sahip = d.dataset.sahip;
        kok.querySelectorAll('#firsat-sahip .chip').forEach((c) => { const on = c === d; c.classList.toggle('chip-on', on); c.setAttribute('aria-pressed', String(on)); });
        ciz();
      });
      const tasi = async (id, hedef) => {
        const f = canli.find((x) => x.id === id); if (!f) return;
        if (await firsatTasi(app, f, hedef, { leadDonusmus: f.company_id ? true : adayDonusmus.get(f.lead_id) })) app.yenile(); else ciz();
      };
      kok.addEventListener('change', (e) => { const s = e.target.closest('[data-tasi]'); if (s) tasi(s.dataset.tasi, s.value); });
      kok.addEventListener('click', (e) => {
        if (e.target.closest('[data-action="yeni-firsat"]')) { firsatFormuAc(app); return; }
        const d = e.target.closest('[data-firsat]');
        if (d) { const f = canli.find((x) => x.id === d.dataset.firsat); if (f) firsatAyrintisi(app, f, { ad: kimin(f), uyeAdi, onDone: () => app.yenile() }); }
      });
      // sürükle-bırak (fare); klavye ve dokunmatik için kart altındaki aşama listesi vardır
      let surukle = null;
      kok.addEventListener('dragstart', (e) => { const k = e.target.closest?.('[data-kart]'); if (!k) return; surukle = k.dataset.kart; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', surukle); k.classList.add('surukleniyor'); });
      kok.addEventListener('dragend', () => { surukle = null; kok.querySelectorAll('.surukleniyor, .kcol-hedef').forEach((x) => x.classList.remove('surukleniyor', 'kcol-hedef')); });
      kok.addEventListener('dragover', (e) => { const c = e.target.closest?.('[data-asama]'); if (!c || !surukle) return; e.preventDefault(); kok.querySelectorAll('.kcol-hedef').forEach((x) => x !== c && x.classList.remove('kcol-hedef')); c.classList.add('kcol-hedef'); });
      kok.addEventListener('drop', (e) => { const c = e.target.closest?.('[data-asama]'); if (!c || !surukle) return; e.preventDefault(); const id = surukle; surukle = null; c.classList.remove('kcol-hedef'); tasi(id, c.dataset.asama); });
    },
  };
}
export { tarih };
