// OSGB 360 - Hatırlatmalar ve görevler.
import { html, bugun, tarih, tarihSaat, yerelDeger, yerelIso, icerir, trSirala } from '../lib/format.js';
import { icon } from '../ui/icons.js';
import { avatar, pill, emptyState, field, openFormModal, confirmDialog, toast, sayfalama } from '../ui/components.js';
import { GOREV_TURLERI, GOREV_DURUMLARI, ONCELIKLER, ONCELIK_SIRASI } from '../lib/puanlama.js';
import { bosIseNull } from '../lib/veri.js';
import { humanError } from '../lib/api.js';

const SAYFA_BASI = 25;
const ONCELIK_TON = { dusuk: 'neutral', orta: 'info', yuksek: 'warning', kritik: 'danger' };
const acikMi = (g) => g.status === 'acik' || g.status === 'devam_ediyor';
/** Yerel takvim gününe göre son tarih durumu. */
export function gorevZamani(g, simdi = new Date()) {
  if (!g.due_at || !acikMi(g)) return 'yok';
  const gun = bugun(new Date(g.due_at));
  const b = bugun(simdi);
  return gun < b ? 'gecikmis' : gun === b ? 'bugun' : 'yaklasan';
}

export async function gorevFormuAc(app, { gorev = null, companyId = null, leadId = null, onDone = null } = {}) {
  const duzenle = gorev !== null;
  let uyeler = [], firmalar = [], adaylar = [];
  try {
    [uyeler, firmalar, adaylar] = await Promise.all([
      app.api.listOrgMembers().catch(() => []),
      app.can('companies', 'view') ? app.api.listCompanies() : [],
      app.can('crm', 'view') ? app.api.listLeads() : [],
    ]);
  } catch (e) { toast(humanError(e), 'hata'); return; }
  const secFirma = gorev?.company_id ?? companyId ?? '';
  const secAday = gorev?.lead_id ?? leadId ?? '';
  const uyeSec = [{ deger: '', etiket: 'Atanmamış' }].concat(
    uyeler.filter((u) => u.is_active || u.id === gorev?.assignee).map((u) => ({ deger: u.id, etiket: u.is_active ? u.full_name : `${u.full_name} (pasif)` })));
  const firmaSec = [{ deger: '', etiket: 'Yok' }].concat(
    firmalar.filter((f) => !f.archived_at || f.id === secFirma).sort((a, b) => trSirala(a.name, b.name)).map((f) => ({ deger: f.id, etiket: f.name })));
  const adaySec = [{ deger: '', etiket: 'Yok' }].concat(
    adaylar.filter((l) => !l.archived_at || l.id === secAday).sort((a, b) => trSirala(a.name, b.name)).map((l) => ({ deger: l.id, etiket: l.name })));
  const v = (k, y = '') => gorev?.[k] ?? y;

  openFormModal({
    baslik: duzenle ? 'Görevi düzenle' : 'Yeni görev', gonderEtiketi: duzenle ? 'Değişiklikleri kaydet' : 'Görevi ekle', boyut: 'lg',
    govde: html`
      ${field({ ad: 'title', etiket: 'Başlık', zorunlu: true, deger: v('title'), tam: true, maksUzunluk: 200 })}
      ${field({ ad: 'kind', etiket: 'Tür', deger: v('kind', 'diger'), secenekler: Object.entries(GOREV_TURLERI).map(([deger, etiket]) => ({ deger, etiket })) })}
      ${field({ ad: 'priority', etiket: 'Öncelik', deger: v('priority', 'orta'), secenekler: ONCELIK_SIRASI.map((deger) => ({ deger, etiket: ONCELIKLER[deger] })) })}
      ${field({ ad: 'due_at', etiket: 'Son tarih', tur: 'datetime-local', deger: yerelDeger(v('due_at', null)) })}
      ${field({ ad: 'remind_at', etiket: 'Hatırlatma zamanı', tur: 'datetime-local', deger: yerelDeger(v('remind_at', null)), ipucu: 'Bildirim gönderimi sonraki aşamalarda eklenecek; şimdilik görevde görünür.' })}
      ${field({ ad: 'assignee', etiket: 'Atanan kişi', deger: v('assignee', app.ctx.user.id), secenekler: uyeSec })}
      ${duzenle ? field({ ad: 'status', etiket: 'Durum', deger: gorev.status, secenekler: Object.entries(GOREV_DURUMLARI).map(([deger, etiket]) => ({ deger, etiket })) }) : ''}
      ${field({ ad: 'company_id', etiket: 'İlgili firma', deger: secFirma, secenekler: firmaSec })}
      ${app.can('crm', 'view') ? field({ ad: 'lead_id', etiket: 'İlgili potansiyel müşteri', deger: secAday, secenekler: adaySec }) : ''}
      ${field({ ad: 'description', etiket: 'Açıklama', tur: 'textarea', deger: v('description'), tam: true, maksUzunluk: 2000 })}`,
    async onSubmit(fd) {
      const g = (k) => String(fd.get(k) ?? '').trim();
      const h = {};
      if (!g('title')) h.title = 'Başlık zorunludur.';
      const son = yerelIso(g('due_at')), hatirlat = yerelIso(g('remind_at'));
      if (g('due_at') && !son) h.due_at = 'Geçerli bir tarih seçin.';
      if (g('remind_at') && !hatirlat) h.remind_at = 'Geçerli bir tarih seçin.';
      if (son && hatirlat && hatirlat > son) h.remind_at = 'Hatırlatma, son tarihten sonra olamaz.';
      if (Object.keys(h).length) return { errors: h };
      const degerler = {
        title: g('title'), kind: g('kind'), priority: g('priority'), due_at: son, remind_at: hatirlat,
        assignee: bosIseNull(g('assignee')), company_id: bosIseNull(g('company_id')),
        description: bosIseNull(g('description')),
        ...(app.can('crm', 'view') ? { lead_id: bosIseNull(g('lead_id')) } : {}),
        ...(duzenle ? { status: g('status') } : {}),
      };
      if (duzenle) await app.api.updateTask(gorev.id, degerler); else await app.api.createTask(degerler);
      toast(duzenle ? 'Görev güncellendi.' : 'Görev eklendi.');
    },
    onDone: () => (onDone ? onDone() : app.yenile()),
  });
}

export async function gorevlerSayfasi(app) {
  const [gorevler, uyeler, firmalar, adaylar] = await Promise.all([
    app.api.listTasks(),
    app.api.listOrgMembers().catch(() => []),
    app.can('companies', 'view') ? app.api.listCompanies() : [],
    app.can('crm', 'view') ? app.api.listLeads() : [],
  ]);
  const uyeAdi = new Map(uyeler.map((u) => [u.id, u.full_name]));
  const firmaAdi = new Map(firmalar.map((f) => [f.id, f.name]));
  const adayAdi = new Map(adaylar.map((l) => [l.id, l.name]));
  const benim = app.ctx.user.id;
  const olusturabilir = app.can('tasks', 'create');
  const duzenleyebilir = app.can('tasks', 'edit');
  const arsivleyebilir = app.can('tasks', 'archive');
  const durum = { filtre: 'acik', q: '', sayfa: 1 };

  const canli = gorevler.filter((g) => !g.archived_at);
  const sayilar = () => ({
    acik: canli.filter(acikMi).length,
    bugun: canli.filter((g) => gorevZamani(g) === 'bugun').length,
    gecikmis: canli.filter((g) => gorevZamani(g) === 'gecikmis').length,
    benim: canli.filter((g) => acikMi(g) && g.assignee === benim).length,
    tamam: canli.filter((g) => g.status === 'tamamlandi').length,
  });
  const FILTRELER = [['acik', 'Açık'], ['bugun', 'Bugün'], ['gecikmis', 'Gecikmiş'], ['benim', 'Bana atanan'], ['tamam', 'Tamamlanan']];
  const filtreHtml = () => { const n = sayilar(); return html`${FILTRELER.map(([id, ad]) => html`<button type="button" class="chip ${durum.filtre === id ? 'chip-on' : ''}" data-filtre="${id}" aria-pressed="${durum.filtre === id}">${ad} <span class="chip-n">${n[id === 'tamam' ? 'tamam' : id]}</span></button>`)}`; };

  function filtrele() {
    let l = canli.filter((g) => ({
      acik: acikMi(g), bugun: gorevZamani(g) === 'bugun', gecikmis: gorevZamani(g) === 'gecikmis',
      benim: acikMi(g) && g.assignee === benim, tamam: g.status === 'tamamlandi',
    }[durum.filtre]));
    const q = durum.q.trim();
    if (q) l = l.filter((g) => [g.title, g.description, firmaAdi.get(g.company_id), adayAdi.get(g.lead_id), uyeAdi.get(g.assignee)].some((d) => d && icerir(d, q)));
    return l.sort((a, b) => (a.due_at ?? '9999').localeCompare(b.due_at ?? '9999') || trSirala(a.title, b.title));
  }

  const satir = (g) => {
    const z = gorevZamani(g);
    const bagli = g.company_id && firmaAdi.get(g.company_id) ? html`<a class="link" href="#/firmalar/${g.company_id}">${firmaAdi.get(g.company_id)}</a>`
      : g.lead_id && adayAdi.get(g.lead_id) ? html`<a class="link" href="#/crm/${g.lead_id}">${adayAdi.get(g.lead_id)}</a>` : html`<span class="muted">—</span>`;
    return html`<tr class="${g.status === 'tamamlandi' || g.status === 'iptal' ? 'row-muted' : ''}">
      <td class="chk">${duzenleyebilir ? html`<input type="checkbox" data-bitir="${g.id}" ${g.status === 'tamamlandi' ? html`checked` : ''} aria-label="${g.title} görevini ${g.status === 'tamamlandi' ? 'yeniden aç' : 'tamamla'}">` : ''}</td>
      <td><strong>${g.title}</strong><small class="block">${GOREV_TURLERI[g.kind] ?? g.kind}${g.status === 'devam_ediyor' ? ' · devam ediyor' : ''}${g.status === 'iptal' ? ' · iptal' : ''}</small></td>
      <td class="hide-sm">${bagli}</td>
      <td>${pill(ONCELIKLER[g.priority] ?? g.priority, ONCELIK_TON[g.priority] ?? 'neutral')}</td>
      <td class="${z === 'gecikmis' ? 'due-late' : z === 'bugun' ? 'due-today' : ''}">${g.due_at ? tarihSaat(g.due_at) : html`<span class="muted">—</span>`}${z === 'gecikmis' ? html`<small class="block">Gecikmiş</small>` : z === 'bugun' ? html`<small class="block">Bugün</small>` : ''}</td>
      <td class="hide-md">${g.assignee && uyeAdi.get(g.assignee) ? html`<span class="cell-main">${avatar(uyeAdi.get(g.assignee), 'sm')}<span>${uyeAdi.get(g.assignee)}</span></span>` : html`<span class="muted">—</span>`}</td>
      <td class="actions">${duzenleyebilir ? html`<button type="button" class="icon-btn" data-gorev="duzenle" data-id="${g.id}" aria-label="${g.title} görevini düzenle" title="Düzenle">${icon('pencil', 18)}</button>` : ''}
        ${arsivleyebilir ? html`<button type="button" class="icon-btn" data-gorev="arsivle" data-id="${g.id}" aria-label="${g.title} görevini arşivle" title="Arşivle">${icon('archive', 18)}</button>` : ''}</td></tr>`;
  };

  function tablo() {
    if (!canli.length) {
      return emptyState({ simge: 'checksq', baslik: 'Henüz görev yok', metin: 'Aramalar, ziyaretler ve takip işlerini görev olarak ekleyin; son tarihi geçenler burada kırmızı görünür.',
        eylem: olusturabilir ? html`<button type="button" class="btn btn-primary" data-action="yeni-gorev">${icon('plus', 18)} İlk görevi ekle</button>` : '' });
    }
    const liste = filtrele();
    if (!liste.length) return emptyState({ simge: 'check', baslik: durum.q ? 'Eşleşen görev yok' : 'Bu filtrede görev yok', metin: durum.q ? 'Aramayı değiştirmeyi deneyin.' : 'Her şey yolunda görünüyor.' });
    const sayfaSayisi = Math.max(1, Math.ceil(liste.length / SAYFA_BASI));
    durum.sayfa = Math.min(durum.sayfa, sayfaSayisi);
    const gorunen = liste.slice((durum.sayfa - 1) * SAYFA_BASI, durum.sayfa * SAYFA_BASI);
    return html`<div class="table-wrap"><table class="table"><thead><tr><th scope="col" class="chk"><span class="sr-only">Tamamla</span></th><th scope="col">Görev</th><th scope="col" class="hide-sm">İlgili kayıt</th><th scope="col">Öncelik</th><th scope="col">Son tarih</th><th scope="col" class="hide-md">Atanan</th><th scope="col"><span class="sr-only">Eylemler</span></th></tr></thead>
      <tbody>${gorunen.map(satir)}</tbody></table></div>${sayfalama({ sayfa: durum.sayfa, sayfaSayisi, toplam: liste.length, sayfaBasi: SAYFA_BASI })}`;
  }

  return {
    baslik: 'Hatırlatmalar ve görevler',
    altBaslik: 'Aramalar, ziyaretler ve takip işleri',
    eylemler: olusturabilir ? html`<button type="button" class="btn btn-primary" data-action="yeni-gorev">${icon('plus', 18)} Yeni görev</button>` : '',
    govde: html`<section class="card card-flush"><div class="toolbar">
      <div class="search-field">${icon('search', 18)}<input type="search" id="gorev-ara" placeholder="Görev, firma veya kişi ara" aria-label="Görevlerde ara" autocomplete="off"></div>
      <div class="chips" id="gorev-filtre" role="group" aria-label="Görev filtresi">${filtreHtml()}</div></div>
      <div id="gorev-tablo">${tablo()}</div></section>`,
    mount(kok) {
      const tabloEl = kok.querySelector('#gorev-tablo');
      const yenile = () => { tabloEl.innerHTML = tablo().s; };
      kok.querySelector('#gorev-ara').addEventListener('input', (e) => { durum.q = e.target.value; durum.sayfa = 1; yenile(); });
      kok.querySelector('#gorev-filtre').addEventListener('click', (e) => {
        const d = e.target.closest('[data-filtre]'); if (!d) return;
        durum.filtre = d.dataset.filtre; durum.sayfa = 1; kok.querySelector('#gorev-filtre').innerHTML = filtreHtml().s; yenile();
      });
      kok.addEventListener('change', async (e) => {
        const c = e.target.closest('[data-bitir]'); if (!c) return;
        const hedef = c.checked ? 'tamamlandi' : 'acik';
        c.disabled = true;
        try { await app.api.updateTask(c.dataset.bitir, { status: hedef }); toast(c.checked ? 'Görev tamamlandı.' : 'Görev yeniden açıldı.'); app.yenile(); }
        catch (err) { c.checked = !c.checked; c.disabled = false; toast(humanError(err), 'hata'); }
      });
      kok.addEventListener('click', async (e) => {
        if (e.target.closest('[data-action="yeni-gorev"]')) { gorevFormuAc(app); return; }
        const sf = e.target.closest('[data-sayfa]');
        if (sf && !sf.disabled) { durum.sayfa = Number(sf.dataset.sayfa); yenile(); return; }
        const d = e.target.closest('[data-gorev]'); if (!d) return;
        const g = gorevler.find((x) => x.id === d.dataset.id); if (!g) return;
        if (d.dataset.gorev === 'duzenle') gorevFormuAc(app, { gorev: g });
        if (d.dataset.gorev === 'arsivle') {
          if (!(await confirmDialog({ baslik: 'Görevi arşivle', onayEtiketi: 'Arşivle', tehlikeli: true, mesaj: `"${g.title}" görevi arşive alınacak. Kayıt silinmez.` }))) return;
          try { await app.api.archiveTask(g.id); toast('Görev arşive alındı.'); app.yenile(); } catch (err) { toast(humanError(err), 'hata'); }
        }
      });
    },
  };
}
export { tarih };
