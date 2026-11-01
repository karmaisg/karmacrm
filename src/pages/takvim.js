// OSGB 360 - Takvim: aylık görünüm; kendi kayıtlarınız (tek seferlik / her ay tekrarlayan ödeme ve hatırlatmalar) ile
// görevlerin son tarih ve hatırlatma tarihleri otomatik işlenir. Hesap veritabanında (app.takvim_olaylari); günlük özet e-postası aynı kaynağı kullanır.
import { html, bugun, tarih, para, trSirala } from '../lib/format.js';
import { icon } from '../ui/icons.js';
import { pill, emptyState, field, openFormModal, confirmDialog, toast } from '../ui/components.js';
import { ayIzgarasi, ayBasi, ayEkle, gunlereGore, gunFarki, kalanGunMetni } from '../lib/takvim.js';
import { bosIseNull } from '../lib/veri.js';
import { humanError } from '../lib/api.js';

const GUNLER = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'];
const ayAdiYil = (iso) => new Intl.DateTimeFormat('tr-TR', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${iso}T00:00:00Z`));
const gunAdi = (iso) => new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'long', weekday: 'long', timeZone: 'UTC' }).format(new Date(`${iso}T00:00:00Z`));
const KAYNAK = { takvim: null, gorev_son: ['Görev son tarihi', 'warning'], gorev_hatirlatma: ['Görev hatırlatması', 'info'] };
const TUR = { odeme: ['Ödeme', 'success'], hatirlatma: ['Hatırlatma', 'neutral'] };

export function takvimKaydiFormuAc(app, { kayit = null, gun = bugun(), firmalar = [], onDone }) {
  const duzenle = kayit !== null; const v = (k, y = '') => kayit?.[k] ?? y;
  const firmaSec = [{ deger: '', etiket: 'Yok' }].concat(firmalar.filter((f) => !f.archived_at || f.id === kayit?.company_id).sort((a, b) => trSirala(a.name, b.name)).map((f) => ({ deger: f.id, etiket: f.name })));
  openFormModal({
    baslik: duzenle ? 'Takvim kaydını düzenle' : 'Yeni takvim kaydı', gonderEtiketi: duzenle ? 'Değişiklikleri kaydet' : 'Kaydet', boyut: 'lg',
    altBaslik: 'Aylık tekrarda ilk tarihin günü her ay kullanılır; o gün olmayan aylarda (ör. 31) ayın son günü.',
    govde: html`${field({ ad: 'title', etiket: 'Başlık', zorunlu: true, deger: v('title'), tam: true, maksUzunluk: 200, yerTutucu: 'Örn. SGK prim ödemesi' })}
      ${field({ ad: 'kind', etiket: 'Tür', deger: v('kind', 'hatirlatma'), secenekler: [{ deger: 'hatirlatma', etiket: 'Hatırlatma' }, { deger: 'odeme', etiket: 'Ödeme' }] })}
      ${field({ ad: 'start_date', etiket: 'Tarih (aylık ise ilk tarih)', tur: 'date', zorunlu: true, deger: v('start_date', gun) })}
      ${field({ ad: 'recurrence', etiket: 'Tekrar', deger: v('recurrence', 'yok'), secenekler: [{ deger: 'yok', etiket: 'Tek seferlik' }, { deger: 'aylik', etiket: 'Her ay' }] })}
      ${field({ ad: 'end_date', etiket: 'Tekrar bitişi (isteğe bağlı)', tur: 'date', deger: v('end_date') })}
      ${field({ ad: 'amount', etiket: 'Tutar (TL, isteğe bağlı)', tur: 'number', min: 0, adim: '0.01', inputmode: 'decimal', deger: v('amount') })}
      ${app.can('companies', 'view') ? field({ ad: 'company_id', etiket: 'İlgili firma', deger: v('company_id'), secenekler: firmaSec }) : ''}
      ${field({ ad: 'note', etiket: 'Not', tur: 'textarea', tam: true, deger: v('note'), maksUzunluk: 2000 })}`,
    async onSubmit(fd) {
      const g = (k) => String(fd.get(k) ?? '').trim(); const h = {};
      if (!g('title')) h.title = 'Başlık zorunludur.';
      if (!g('start_date')) h.start_date = 'Tarihi seçin.';
      if (g('end_date') && g('recurrence') !== 'aylik') h.end_date = 'Bitiş tarihi yalnızca aylık tekrarda kullanılır.';
      if (g('end_date') && g('start_date') && g('end_date') < g('start_date')) h.end_date = 'Bitiş, başlangıçtan önce olamaz.';
      if (g('amount') !== '' && !(Number(g('amount')) >= 0)) h.amount = 'Tutar 0 veya daha büyük olmalıdır.';
      if (Object.keys(h).length) return { errors: h };
      const d = { title: g('title'), kind: g('kind'), start_date: g('start_date'), recurrence: g('recurrence'), end_date: bosIseNull(g('end_date')),
        amount: g('amount') === '' ? null : Number(g('amount')), company_id: bosIseNull(g('company_id')), note: bosIseNull(g('note')) };
      if (duzenle) { await app.api.updateCalendarItem(kayit.id, d); toast('Takvim kaydı güncellendi.'); }
      else { await app.api.createCalendarItem(d); toast('Takvim kaydı eklendi.'); }
    },
    onDone,
  });
}

export async function takvimSayfasi(app) {
  const ekleyebilir = app.can('tasks', 'create'); const duzenleyebilir = app.can('tasks', 'edit');
  const firmalar = app.can('companies', 'view') ? await app.api.listCompanies().catch(() => []) : [];
  let ogeler = [];
  try { ogeler = await app.api.listCalendarItems(); }
  catch { return { baslik: 'Takvim', altBaslik: '', govde: html`<div class="notice notice-info" role="note">Bu sayfa için Supabase'de <strong>17_asama16.sql</strong> dosyasını çalıştırın (Kurulum rehberi, "Aşama 16 kurulumu").</div>` }; }
  const d = { ay: ayBasi(bugun()), secili: bugun(), olaylar: [], hata: '' };
  const bugunStr = bugun();

  async function yukle() {
    const iz = ayIzgarasi(d.ay); const bas = iz[0][0]; const bit = iz[iz.length - 1][6];
    try { d.olaylar = await app.api.getCalendarEvents(bas, bit); d.hata = ''; } catch (e) { d.olaylar = []; d.hata = humanError(e); }
  }
  await yukle();

  const kisa = (o) => (o.baslik.length > 22 ? `${o.baslik.slice(0, 21)}…` : o.baslik);
  const izgara = () => {
    const iz = ayIzgarasi(d.ay); const harita = gunlereGore(d.olaylar);
    return html`<div class="takvim-izgara" role="grid" aria-label="${ayAdiYil(d.ay)} takvimi">
      <div class="takvim-baslik" role="row">${GUNLER.map((g) => html`<div role="columnheader">${g}</div>`)}</div>
      ${iz.map((hafta) => html`<div class="takvim-hafta" role="row">${hafta.map((g) => {
        const l = harita.get(g) ?? []; const acik = l.filter((o) => !o.tamam).length;
        return html`<button type="button" role="gridcell" class="takvim-gun ${g.slice(0, 7) !== d.ay.slice(0, 7) ? 'takvim-disi' : ''} ${g === bugunStr ? 'takvim-bugun' : ''} ${g === d.secili ? 'takvim-secili' : ''}" data-gun="${g}" aria-label="${gunAdi(g)}${l.length ? `, ${l.length} kayıt` : ''}" aria-pressed="${g === d.secili}">
          <span class="takvim-no">${Number(g.slice(8))}</span>
          ${l.slice(0, 3).map((o) => html`<span class="takvim-chip takvim-${o.kaynak === 'takvim' ? o.tur : 'gorev'} ${o.tamam ? 'takvim-yapildi' : ''}">${kisa(o)}</span>`)}
          ${l.length > 3 ? html`<span class="takvim-fazla">+${l.length - 3}</span>` : ''}
          ${acik ? html`<span class="takvim-nokta" aria-hidden="true"></span>` : ''}</button>`;
      })}</div>`)}</div>`;
  };
  const oge = (id) => ogeler.find((x) => x.id === id);
  const gunPaneli = () => {
    const l = d.olaylar.filter((o) => o.tarih === d.secili); const fark = gunFarki(d.secili, bugunStr);
    return html`<section class="card" id="takvim-gun-paneli"><div class="card-head"><div><h2 class="card-title">${gunAdi(d.secili)}</h2>
      <p class="card-sub">${kalanGunMetni(fark)}${fark > 1 ? '' : ''}</p></div>
      ${ekleyebilir ? html`<button type="button" class="btn btn-secondary btn-sm" data-action="takvim-yeni">${icon('plus', 16)} Bu güne ekle</button>` : ''}</div>
      ${l.length ? html`<ul class="takvim-liste">${l.map((o) => {
        const k = KAYNAK[o.kaynak]; const t = TUR[o.tur];
        return html`<li class="${o.tamam ? 'takvim-yapildi' : ''}" data-olay="${o.ref}">
          ${o.kaynak === 'takvim' && duzenleyebilir ? html`<label class="check-inline"><input type="checkbox" data-tamam="${o.ref}" data-gun="${o.tarih}" ${o.tamam ? html`checked` : ''}> <span class="sr-only">Yapıldı</span></label>` : ''}
          <div class="takvim-metin"><strong>${o.baslik}</strong>
            <small class="block muted">${[o.firma, o.tutar !== null && o.tutar !== undefined ? para(o.tutar) : null, o.tekrar ? 'her ay tekrarlanır' : null].filter(Boolean).join(' · ')}</small></div>
          ${k ? pill(k[0], k[1]) : (t ? pill(t[0], t[1]) : '')}
          ${o.kaynak === 'takvim' ? (duzenleyebilir ? html`<button type="button" class="btn btn-secondary btn-sm" data-duzenle="${o.ref}">${icon('pencil', 14)} Düzenle</button><button type="button" class="btn btn-secondary btn-sm" data-arsiv="${o.ref}">${icon('archive', 14)} Sil</button>` : '')
            : html`<a class="btn btn-secondary btn-sm" href="#/gorevler">Göreve git</a>`}</li>`;
      })}</ul>` : emptyState({ simge: 'calendar', baslik: 'Bu gün için kayıt yok', metin: ekleyebilir ? '"Bu güne ekle" ile ödeme veya hatırlatma ekleyebilirsiniz.' : '' })}</section>`;
  };
  const icerik = () => html`<div class="toolbar takvim-arac"><button type="button" class="btn btn-secondary btn-sm" data-ay="-1" aria-label="Önceki ay">${icon('chevronL', 16)}</button>
      <strong class="takvim-ay" id="takvim-ay" aria-live="polite">${ayAdiYil(d.ay)}</strong>
      <button type="button" class="btn btn-secondary btn-sm" data-ay="1" aria-label="Sonraki ay">${icon('chevronR', 16)}</button>
      <button type="button" class="btn btn-secondary btn-sm" data-ay="bugun">Bugün</button></div>
    ${d.hata ? html`<p class="form-error" role="alert">${d.hata}</p>` : ''}${izgara()}${gunPaneli()}
    <p class="fine pad">Görevlerin son tarihi ve hatırlatma zamanı bu takvime otomatik işlenir. Her gün gelen e-postada bugünün işleri "Bugün Yapılacaklar", önümüzdeki 3 günün işleri "Yaklaşan Program" başlığıyla yer alır.</p>`;

  return {
    baslik: 'Takvim', altBaslik: 'Ödemeler, tekrarlayan işler, hatırlatmalar ve görev tarihleri',
    eylemler: ekleyebilir ? html`<button type="button" class="btn btn-primary" data-action="takvim-yeni">${icon('plus', 18)} Yeni kayıt</button>` : '',
    govde: html`<div id="takvim-kok">${icerik()}</div>`,
    mount(kok) {
      const ciz = () => { kok.querySelector('#takvim-kok').innerHTML = icerik().s; };
      const yenile = async () => { try { ogeler = await app.api.listCalendarItems(); } catch (e) { toast(humanError(e), 'hata'); } await yukle(); ciz(); };
      kok.addEventListener('click', async (e) => {
        const ay = e.target.closest('[data-ay]');
        if (ay) { d.ay = ay.dataset.ay === 'bugun' ? ayBasi(bugunStr) : ayEkle(d.ay, Number(ay.dataset.ay)); if (ay.dataset.ay === 'bugun') d.secili = bugunStr; else d.secili = d.ay; await yukle(); ciz(); return; }
        const g = e.target.closest('.takvim-gun'); if (g) { d.secili = g.dataset.gun; ciz(); kok.querySelector(`.takvim-gun[data-gun="${d.secili}"]`)?.focus(); return; }
        if (e.target.closest('[data-action="takvim-yeni"]')) { takvimKaydiFormuAc(app, { gun: d.secili, firmalar, onDone: yenile }); return; }
        const du = e.target.closest('[data-duzenle]'); if (du) { const k = oge(du.dataset.duzenle); if (k) takvimKaydiFormuAc(app, { kayit: k, firmalar, onDone: yenile }); return; }
        const ar = e.target.closest('[data-arsiv]');
        if (ar) {
          const k = oge(ar.dataset.arsiv); if (!k) return;
          if (!(await confirmDialog({ baslik: 'Kaydı sil', mesaj: `"${k.title}"${k.recurrence === 'aylik' ? ' ve tüm tekrarları' : ''} takvimden kaldırılacak.`, onayEtiketi: 'Sil', tehlikeli: true }))) return;
          try { await app.api.archiveCalendarItem(k.id); toast('Kayıt silindi.'); await yenile(); } catch (err) { toast(humanError(err), 'hata'); }
        }
      });
      kok.addEventListener('change', async (e) => {
        const t = e.target.closest('[data-tamam]'); if (!t) return;
        try { if (t.checked) await app.api.completeCalendarItem(t.dataset.tamam, t.dataset.gun); else await app.api.uncompleteCalendarItem(t.dataset.tamam, t.dataset.gun); await yukle(); ciz(); }
        catch (err) { t.checked = !t.checked; toast(humanError(err), 'hata'); }
      });
    },
  };
}
