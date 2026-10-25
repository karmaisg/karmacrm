// OSGB 360 - Kişiler listesi, kişi formu ve arşivleme işlemleri.
import { html, raw, icerir, trSirala, telHref, mailHref } from '../lib/format.js';
import { icon } from '../ui/icons.js';
import {
  avatar, pill, emptyState, field, checkbox, openFormModal, confirmDialog, toast, sayfalama,
} from '../ui/components.js';
import { bosIseNull, epostaGecerli, telefonGecerli } from '../lib/veri.js';
import { humanError } from '../lib/api.js';

const SAYFA_BASI = 25;

export const telHucre = (t) => (t ? (telHref(t) ? html`<a class="link" href="${telHref(t)}">${t}</a>` : t) : html`<span class="muted">—</span>`);
export const epostaHucre = (e) => (e ? (mailHref(e) ? html`<a class="link" href="${mailHref(e)}">${e}</a>` : e) : html`<span class="muted">—</span>`);

// ---------------------------------------------------------------- form
export async function kisiFormuAc(app, { kisi = null, firmaId = null, onDone = null } = {}) {
  const duzenle = kisi !== null;
  const sabitFirma = firmaId !== null && !duzenle;
  let firmalar = [];
  try { firmalar = await app.api.listCompanies(); }
  catch (e) { toast(humanError(e), 'hata'); return; }

  const secilenFirma = kisi?.company_id ?? firmaId ?? '';
  const secenekler = [{ deger: '', etiket: 'Seçiniz' }].concat(
    firmalar
      .filter((f) => !f.archived_at || f.id === secilenFirma)
      .sort((a, b) => trSirala(a.name, b.name))
      .map((f) => ({ deger: f.id, etiket: f.archived_at ? `${f.name} (arşivde)` : f.name })),
  );
  const v = (k) => kisi?.[k] ?? '';
  const potansiyel = duzenle && !kisi.company_id && kisi.lead_id;

  openFormModal({
    baslik: duzenle ? 'Kişiyi düzenle' : 'Yeni kişi',
    altBaslik: duzenle ? kisi.full_name : 'Firma yetkilisi veya iletişim kişisi ekleyin',
    gonderEtiketi: duzenle ? 'Değişiklikleri kaydet' : 'Kişiyi ekle',
    govde: html`
      ${field({ ad: 'company_id', etiket: 'Firma', deger: secilenFirma, secenekler, zorunlu: !potansiyel, pasif: sabitFirma, tam: true,
        ipucu: potansiyel ? 'Bu kişi bir potansiyel müşteriye bağlı. Firma seçmeden bırakabilirsiniz.' : '' })}
      ${field({ ad: 'full_name', etiket: 'Ad soyad', deger: v('full_name'), zorunlu: true, maksUzunluk: 120, otomatik: 'off' })}
      ${field({ ad: 'title', etiket: 'Unvan', deger: v('title'), maksUzunluk: 100 })}
      ${field({ ad: 'phone', etiket: 'Telefon', tur: 'tel', deger: v('phone'), maksUzunluk: 25 })}
      ${field({ ad: 'email', etiket: 'E-posta', tur: 'email', deger: v('email'), maksUzunluk: 120 })}
      ${checkbox({ ad: 'is_decision_maker', etiket: 'Karar verici', isaretli: !!kisi?.is_decision_maker, ipucu: 'Satın alma kararında söz sahibi olan kişileri işaretleyin.' })}
      ${field({ ad: 'notes', etiket: 'Notlar', tur: 'textarea', deger: v('notes'), tam: true, maksUzunluk: 2000 })}`,
    async onSubmit(fd) {
      const g = (k) => String(fd.get(k) ?? '').trim();
      const hatalar = {};
      const firma = sabitFirma ? firmaId : g('company_id');
      if (!firma && !potansiyel) hatalar.company_id = 'Firma seçin.';
      if (!g('full_name')) hatalar.full_name = 'Ad soyad zorunludur.';
      if (g('email') && !epostaGecerli(g('email'))) hatalar.email = 'Geçerli bir e-posta adresi yazın.';
      if (g('phone') && !telefonGecerli(g('phone'))) hatalar.phone = 'Telefon numarasında yalnızca rakam, boşluk, + ( ) - kullanın (en az 7 rakam).';
      if (Object.keys(hatalar).length) return { errors: hatalar };
      const degerler = {
        company_id: bosIseNull(firma), full_name: g('full_name'), title: bosIseNull(g('title')),
        phone: bosIseNull(g('phone')), email: bosIseNull(g('email')),
        is_decision_maker: fd.get('is_decision_maker') === '1', notes: bosIseNull(g('notes')),
      };
      if (duzenle) { await app.api.updateContact(kisi.id, degerler); toast('Kişi güncellendi.'); }
      else { await app.api.createContact(degerler); toast('Kişi eklendi.'); }
      app.aramaOnbellegiTemizle();
    },
    onDone: () => (onDone ? onDone() : app.yenile()),
  });
}

export async function kisiArsivle(app, kisi) {
  const onay = await confirmDialog({
    baslik: 'Kişiyi arşivle', onayEtiketi: 'Arşivle', tehlikeli: true,
    mesaj: `"${kisi.full_name}" arşive alınacak. Kayıt silinmez; "Arşivli" filtresinden görülüp geri alınabilir.`,
  });
  if (!onay) return false;
  try { await app.api.archiveContact(kisi.id); toast('Kişi arşive alındı.'); app.aramaOnbellegiTemizle(); return true; }
  catch (e) { toast(humanError(e), 'hata'); return false; }
}

export async function kisiArsivdenCikar(app, kisi) {
  try { await app.api.unarchiveContact(kisi.id); toast('Kişi arşivden çıkarıldı.'); app.aramaOnbellegiTemizle(); return true; }
  catch (e) { toast(humanError(e), 'hata'); return false; }
}

/** Kişi satırındaki eylem düğmeleri (yetkiye göre). */
export function kisiEylemDugmeleri(app, k) {
  const duzenle = app.can('contacts', 'edit');
  const arsiv = app.can('contacts', 'archive');
  if (k.archived_at) {
    return arsiv ? html`<button type="button" class="btn btn-ghost btn-sm" data-kisi-eylem="geri" data-id="${k.id}">${icon('restore', 16)} Geri al</button>` : '';
  }
  return html`${duzenle ? html`<button type="button" class="icon-btn" data-kisi-eylem="duzenle" data-id="${k.id}" aria-label="${k.full_name} kişisini düzenle" title="Düzenle">${icon('pencil', 18)}</button>` : ''}
    ${arsiv ? html`<button type="button" class="icon-btn" data-kisi-eylem="arsivle" data-id="${k.id}" aria-label="${k.full_name} kişisini arşivle" title="Arşivle">${icon('archive', 18)}</button>` : ''}`;
}

// ---------------------------------------------------------------- liste sayfası
export async function kisilerSayfasi(app) {
  const [kisiler, firmalar] = await Promise.all([app.api.listContacts(), app.api.listCompanies()]);
  const firmaAdi = new Map(firmalar.map((f) => [f.id, f.name]));
  const olusturabilir = app.can('contacts', 'create');
  const arsivGorebilir = app.can('contacts', 'archive');
  const durum = { filtre: 'aktif', q: '', firma: '', sayfa: 1 };
  const aktifSayisi = kisiler.filter((k) => !k.archived_at).length;
  const arsivSayisi = kisiler.length - aktifSayisi;

  const firmaSecenekleri = [...new Set(kisiler.map((k) => k.company_id).filter(Boolean))]
    .map((id) => ({ id, ad: firmaAdi.get(id) ?? '—' })).sort((a, b) => trSirala(a.ad, b.ad));

  function filtrele() {
    let liste = kisiler.filter((k) => (durum.filtre === 'arsiv' ? !!k.archived_at : !k.archived_at));
    if (durum.firma) liste = liste.filter((k) => k.company_id === durum.firma);
    const q = durum.q.trim();
    if (q) liste = liste.filter((k) => [k.full_name, k.title, k.phone, k.email, firmaAdi.get(k.company_id)].some((d) => d && icerir(d, q)));
    return liste.sort((a, b) => trSirala(a.full_name, b.full_name));
  }

  const satir = (k) => html`<tr class="${k.archived_at ? 'row-muted' : ''}">
    <td><span class="cell-main">${avatar(k.full_name)}<span><strong>${k.full_name}</strong>${k.is_decision_maker ? html`<small class="tag-ok">Karar verici</small>` : ''}</span></span></td>
    <td>${k.company_id ? html`<a class="link" href="#/firmalar/${k.company_id}">${firmaAdi.get(k.company_id) ?? 'Firma'}</a>` : pill('Potansiyel müşteri', 'info')}</td>
    <td class="hide-md">${k.title || html`<span class="muted">—</span>`}</td>
    <td class="hide-sm">${telHucre(k.phone)}</td>
    <td class="hide-md">${epostaHucre(k.email)}</td>
    <td class="actions">${kisiEylemDugmeleri(app, k)}</td>
  </tr>`;

  function tablo() {
    if (!kisiler.length) {
      return emptyState({
        simge: 'contact', baslik: 'Henüz kişi eklenmedi',
        metin: 'Firma yetkililerini ve iletişim kişilerini buradan ya da firma kartından ekleyebilirsiniz.',
        eylem: olusturabilir ? html`<button type="button" class="btn btn-primary" data-action="yeni-kisi">${icon('plus', 18)} İlk kişiyi ekle</button>` : '',
      });
    }
    const liste = filtrele();
    if (!liste.length) {
      return emptyState({ simge: 'search', baslik: 'Eşleşen kişi yok', metin: 'Arama veya filtreyi değiştirmeyi deneyin.' });
    }
    const sayfaSayisi = Math.max(1, Math.ceil(liste.length / SAYFA_BASI));
    durum.sayfa = Math.min(durum.sayfa, sayfaSayisi);
    const gorunen = liste.slice((durum.sayfa - 1) * SAYFA_BASI, durum.sayfa * SAYFA_BASI);
    return html`<div class="table-wrap"><table class="table">
      <thead><tr><th scope="col">Kişi</th><th scope="col">Firma</th><th scope="col" class="hide-md">Unvan</th><th scope="col" class="hide-sm">Telefon</th><th scope="col" class="hide-md">E-posta</th><th scope="col"><span class="sr-only">Eylemler</span></th></tr></thead>
      <tbody>${gorunen.map(satir)}</tbody></table></div>
      ${sayfalama({ sayfa: durum.sayfa, sayfaSayisi, toplam: liste.length, sayfaBasi: SAYFA_BASI })}`;
  }

  const filtreHtml = () => html`
    <button type="button" class="chip ${durum.filtre === 'aktif' ? 'chip-on' : ''}" data-filtre="aktif" aria-pressed="${durum.filtre === 'aktif'}">Aktif <span class="chip-n">${aktifSayisi}</span></button>
    ${arsivGorebilir || arsivSayisi ? html`<button type="button" class="chip ${durum.filtre === 'arsiv' ? 'chip-on' : ''}" data-filtre="arsiv" aria-pressed="${durum.filtre === 'arsiv'}">Arşivli <span class="chip-n">${arsivSayisi}</span></button>` : ''}`;

  return {
    baslik: 'Kişiler',
    altBaslik: 'Firma yetkilileri ve iletişim kişileri. Görüşme geçmişi Aşama 3\'te eklenecek.',
    eylemler: olusturabilir ? html`<button type="button" class="btn btn-primary" data-action="yeni-kisi">${icon('plus', 18)} Yeni kişi</button>` : '',
    govde: html`<section class="card card-flush">
      <div class="toolbar">
        <div class="search-field">${icon('search', 18)}<input type="search" id="kisi-ara" placeholder="Ad, firma, unvan, telefon veya e-posta ara" aria-label="Kişilerde ara" autocomplete="off"></div>
        <label class="select-inline"><span class="sr-only">Firmaya göre filtrele</span>
          <select id="kisi-firma"><option value="">Tüm firmalar</option>${firmaSecenekleri.map((f) => html`<option value="${f.id}">${f.ad}</option>`)}</select></label>
        <div class="chips" id="kisi-filtre" role="group" aria-label="Kişi filtresi">${filtreHtml()}</div>
      </div>
      <div id="kisi-tablo">${tablo()}</div>
    </section>`,
    mount(kok) {
      const tabloEl = kok.querySelector('#kisi-tablo');
      const yenile = () => { tabloEl.innerHTML = tablo().s; };
      kok.querySelector('#kisi-ara').addEventListener('input', (e) => { durum.q = e.target.value; durum.sayfa = 1; yenile(); });
      kok.querySelector('#kisi-firma').addEventListener('change', (e) => { durum.firma = e.target.value; durum.sayfa = 1; yenile(); });
      kok.querySelector('#kisi-filtre').addEventListener('click', (e) => {
        const d = e.target.closest('[data-filtre]');
        if (!d) return;
        durum.filtre = d.dataset.filtre; durum.sayfa = 1;
        kok.querySelector('#kisi-filtre').innerHTML = filtreHtml().s; yenile();
      });
      kok.addEventListener('click', async (e) => {
        if (e.target.closest('[data-action="yeni-kisi"]')) { kisiFormuAc(app); return; }
        const sf = e.target.closest('[data-sayfa]');
        if (sf && !sf.disabled) { durum.sayfa = Number(sf.dataset.sayfa); yenile(); return; }
        const d = e.target.closest('[data-kisi-eylem]');
        if (!d) return;
        const k = kisiler.find((x) => x.id === d.dataset.id);
        if (!k) return;
        if (d.dataset.kisiEylem === 'duzenle') kisiFormuAc(app, { kisi: k });
        if (d.dataset.kisiEylem === 'arsivle' && await kisiArsivle(app, k)) app.yenile();
        if (d.dataset.kisiEylem === 'geri' && await kisiArsivdenCikar(app, k)) app.yenile();
      });
    },
  };
}

export { raw };
