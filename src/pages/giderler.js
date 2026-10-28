// OSGB 360 - Giderler: doğrudan (firma/personel) ve ortak giderler, KDV hariç/dahil tutarlar, ödeme durumu.
import { html, bugun, tarih, para, para2, sayi, icerir, trSirala, ayAdi, ayBasi } from '../lib/format.js';
import { icon } from '../ui/icons.js';
import { pill, emptyState, field, checkbox, openFormModal, confirmDialog, toast, sayfalama } from '../ui/components.js';
import { GIDER_TURU, giderOzeti } from '../lib/finans.js';
import { KDV_MODU } from '../lib/ticari.js';
import { kdvAyir } from '../lib/hesaplama.js';
import { bosIseNull } from '../lib/veri.js';
import { humanError } from '../lib/api.js';

const SAYFA_BASI = 30;
const NITELIK = { isletme: 'İşletme', personel: 'Personel', vergi: 'Vergi', stopaj: 'Stopaj', sgk: 'SGK' };

const aySecenekleri = (bugunStr) => {
  const [y, mo] = bugunStr.split('-').map(Number); const l = [];
  for (let i = -1; i < 18; i += 1) { const t = new Date(y, mo - 1 - i, 1); l.push(`${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-01`); }
  return l;
};

export async function giderFormuAc(app, { kayit = null, kategoriler = null, onDone = null } = {}) {
  const duzenle = kayit !== null;
  let kats = kategoriler; let firmalar = []; let personel = [];
  try {
    [kats, firmalar, personel] = await Promise.all([
      kats ?? app.api.listExpenseCategories(), app.can('companies', 'view') ? app.api.listCompanies() : [], app.api.listStaff().catch(() => []),
    ]);
  } catch (e) { toast(humanError(e), 'hata'); return; }
  const maasYetkisi = app.can('payroll', duzenle ? 'edit' : 'create');
  const kullanilabilir = kats.filter((k) => maasYetkisi || !k.is_payroll || k.id === kayit?.category_id);
  const katMap = new Map(kats.map((k) => [k.id, k]));
  const oran = kayit && Number(kayit.amount_excl_vat) > 0 ? Math.round((Number(kayit.vat_amount) / Number(kayit.amount_excl_vat)) * 10000) / 100 : 20;
  const v = (k, y = '') => kayit?.[k] ?? y;
  const ilkKat = kayit?.category_id ?? '';
  const m = openFormModal({
    baslik: duzenle ? 'Gideri düzenle' : 'Gider ekle', altBaslik: 'Tutarı girin; KDV ayrımı otomatik yapılır.', boyut: 'lg', gonderEtiketi: duzenle ? 'Değişiklikleri kaydet' : 'Gideri kaydet',
    govde: html`${field({ ad: 'category_id', etiket: 'Kategori', zorunlu: true, deger: ilkKat, secenekler: [{ deger: '', etiket: 'Seçiniz' }].concat(kullanilabilir.map((k) => ({ deger: k.id, etiket: k.name }))) })}
      ${field({ ad: 'expense_date', etiket: 'Gider tarihi', tur: 'date', zorunlu: true, deger: v('expense_date', bugun()) })}
      ${field({ ad: 'tutar', etiket: 'Tutar (TL)', tur: 'number', min: 0, adim: '0.01', inputmode: 'decimal', zorunlu: true, deger: duzenle ? kayit.amount_excl_vat : '' })}
      ${field({ ad: 'vat_mode', etiket: 'Tutar KDV', deger: 'kdv_haric', secenekler: Object.entries(KDV_MODU).map(([deger, etiket]) => ({ deger, etiket })) })}
      ${field({ ad: 'vat_rate', etiket: 'KDV oranı (%)', tur: 'number', min: 0, max: 100, adim: '0.01', deger: oran })}
      ${field({ ad: 'cost_type', etiket: 'Gider türü', zorunlu: true, deger: v('cost_type', 'ortak'), secenekler: Object.entries(GIDER_TURU).map(([deger, etiket]) => ({ deger, etiket })),
        ipucu: 'Doğrudan: bir firmaya veya personele ait. Ortak: tüm işletmeye ait; sonra firmalara dağıtılır.' })}
      <div class="field field-full" id="gider-bilgi" aria-live="polite"></div>
      ${field({ ad: 'company_id', etiket: 'Firma (doğrudan gider)', deger: v('company_id'), secenekler: [{ deger: '', etiket: 'Seçilmedi' }].concat(firmalar.filter((f) => !f.archived_at || f.id === kayit?.company_id).sort((a, b) => trSirala(a.name, b.name)).map((f) => ({ deger: f.id, etiket: f.name }))) })}
      ${field({ ad: 'employee_id', etiket: 'Personel (doğrudan gider)', deger: v('employee_id'), secenekler: [{ deger: '', etiket: 'Seçilmedi' }].concat(personel.filter((p) => !p.archived_at || p.id === kayit?.employee_id).sort((a, b) => trSirala(a.full_name, b.full_name)).map((p) => ({ deger: p.id, etiket: p.full_name }))) })}
      ${field({ ad: 'description', etiket: 'Açıklama', tam: true, maksUzunluk: 300, deger: v('description') })}
      ${checkbox({ ad: 'paid', etiket: 'Ödendi', isaretli: !!kayit?.paid })}`,
    async onSubmit(fd, form) {
      const g = (k) => String(fd.get(k) ?? '').trim();
      const tur = g('cost_type'); const h = {};
      if (!g('category_id')) h.category_id = 'Kategoriyi seçin.';
      if (!g('expense_date')) h.expense_date = 'Tarihi seçin.';
      if (!(Number(g('tutar')) > 0)) h.tutar = 'Tutar sıfırdan büyük olmalıdır.';
      const kdv = Number(g('vat_rate'));
      if (g('vat_rate') === '' || !(kdv >= 0 && kdv <= 100)) h.vat_rate = 'KDV oranı 0 ile 100 arasında olmalıdır.';
      const firma = tur === 'dogrudan' ? bosIseNull(g('company_id')) : null; const kisi = tur === 'dogrudan' ? bosIseNull(g('employee_id')) : null;
      if (tur === 'dogrudan' && !firma && !kisi) h.company_id = 'Doğrudan gider için firma veya personel seçin.';
      if (tur === 'dogrudan' && firma && kisi) h.employee_id = 'Firma ya da personelden yalnızca birini seçin.';
      if (Object.keys(h).length) return { errors: h };
      await app.api.saveExpense({ id: kayit?.id ?? null, kategori: g('category_id'), tarih: g('expense_date'), tutar: Number(g('tutar')), kdvModu: g('vat_mode') || 'kdv_haric', kdvOrani: kdv,
        tur, firma, personel: kisi, odendi: form.elements.paid.checked, aciklama: bosIseNull(g('description')) });
      toast(duzenle ? 'Gider güncellendi.' : 'Gider eklendi.');
    },
    onDone: () => (onDone ? onDone() : app.yenile()),
  });
  const form = m.el.querySelector('form'); const bilgi = form.querySelector('#gider-bilgi');
  const gorunum = () => {
    const dogrudan = form.elements.cost_type.value === 'dogrudan';
    form.querySelector('[data-field="company_id"]').hidden = !dogrudan; form.querySelector('[data-field="employee_id"]').hidden = !dogrudan;
  };
  const guncelle = () => {
    const t = Number(form.elements.tutar.value); const o = Number(form.elements.vat_rate.value);
    if (!(t > 0) || !(o >= 0 && o <= 100)) { bilgi.innerHTML = ''; return; }
    const k = kdvAyir(t, form.elements.vat_mode.value, o);
    bilgi.innerHTML = html`<div class="notice notice-info" role="status">KDV hariç ${para2(k.haric)} + KDV ${para2(k.kdv)} = <strong>KDV dahil ${para2(k.dahil)}</strong></div>`.s;
  };
  form.addEventListener('input', guncelle);
  form.addEventListener('change', (e) => {
    if (e.target.name === 'category_id' && !duzenle) {
      const k = katMap.get(e.target.value);
      if (k) { form.elements.cost_type.value = k.default_cost_type; if (k.is_payroll) form.elements.vat_rate.value = 0; }
    }
    gorunum(); guncelle();
  });
  gorunum(); guncelle();
}

function kategoriFormuAc(app, onDone) {
  openFormModal({
    baslik: 'Gider kategorisi ekle', altBaslik: 'Yeni kategori giderlerde seçilebilir.',
    govde: html`${field({ ad: 'name', etiket: 'Kategori adı', zorunlu: true, maksUzunluk: 80 })}
      ${field({ ad: 'nature', etiket: 'Niteliği', deger: 'isletme', secenekler: Object.entries(NITELIK).filter(([k]) => app.can('payroll', 'create') || !['personel', 'sgk'].includes(k)).map(([deger, etiket]) => ({ deger, etiket })) })}
      ${field({ ad: 'default_cost_type', etiket: 'Varsayılan tür', deger: 'ortak', secenekler: Object.entries(GIDER_TURU).map(([deger, etiket]) => ({ deger, etiket })) })}`,
    async onSubmit(fd) {
      const g = (k) => String(fd.get(k) ?? '').trim();
      if (!g('name')) return { errors: { name: 'Kategori adını girin.' } };
      await app.api.createExpenseCategory({ name: g('name'), nature: g('nature'), default_cost_type: g('default_cost_type'), sort_order: 100 });
      toast('Kategori eklendi.');
    },
    onDone,
  });
}

export async function giderlerSayfasi(app) {
  const bugunStr = bugun();
  const [giderler, kategoriler, firmalar, personel] = await Promise.all([
    app.api.listExpenses(), app.api.listExpenseCategories(), app.can('companies', 'view') ? app.api.listCompanies() : [], app.api.listStaff().catch(() => []),
  ]);
  const katAdi = new Map(kategoriler.map((k) => [k.id, k.name]));
  const firmaAdi = new Map(firmalar.map((f) => [f.id, f.name])); const kisiAdi = new Map(personel.map((p) => [p.id, p.full_name]));
  const durum = { ay: ayBasi(bugunStr), kategori: '', tur: '', odenmemis: false, sayfa: 1 };
  const olusturabilir = app.can('expenses', 'create'); const duzenleyebilir = app.can('expenses', 'edit'); const arsivleyebilir = app.can('expenses', 'archive');

  const aydakiler = () => giderler.filter((g) => !g.archived_at && String(g.expense_date).slice(0, 7) === durum.ay.slice(0, 7));
  const gorunen = () => aydakiler().filter((g) => (!durum.kategori || g.category_id === durum.kategori) && (!durum.tur || g.cost_type === durum.tur) && (!durum.odenmemis || !g.paid))
    .sort((a, b) => String(b.expense_date).localeCompare(String(a.expense_date)) || String(b.id).localeCompare(String(a.id)));
  const ozet = () => {
    const o = giderOzeti(giderler, durum.ay);
    const kutu = (e, d, a, s) => html`<section class="card kpi"><span class="kpi-ic">${icon(s, 22)}</span><div><div class="kpi-l">${e}</div><div class="kpi-v">${d}</div><div class="kpi-s">${a}</div></div></section>`;
    return html`<div class="kpi-grid">${kutu('Toplam gider', para(o.toplamGider), `KDV hariç · ${sayi(o.adet)} kayıt`, 'receipt')}${kutu('Doğrudan gider', para(o.dogrudanToplam), 'firma / personele bağlı', 'briefcase')}
      ${kutu('Ortak gider havuzu', para(o.ortakHavuz), 'dağıtım Aşama 7\'de', 'bars')}${kutu('Ödenmemiş', para(o.odenmemisDahil), 'KDV dahil', 'wallet')}</div>`;
  };
  const satir = (g) => {
    const bagli = g.company_id ? (firmaAdi.get(g.company_id) ?? 'Firma') : g.employee_id ? (kisiAdi.get(g.employee_id) ?? 'Personel') : '—';
    return html`<tr><td>${tarih(g.expense_date)}</td><td><strong>${katAdi.get(g.category_id) ?? 'Kategori'}</strong>${g.description ? html`<small class="block muted">${g.description}</small>` : ''}</td>
      <td class="hide-sm">${bagli}</td><td>${pill(GIDER_TURU[g.cost_type], g.cost_type === 'dogrudan' ? 'info' : 'neutral')}</td>
      <td class="num">${para2(g.amount_excl_vat)}<small class="block muted">KDV dahil ${para2(g.amount_incl_vat)}</small></td>
      <td class="hide-sm">${g.paid ? pill('Ödendi', 'success') : pill('Ödenmedi', 'warning')}</td>
      <td class="actions">${duzenleyebilir ? html`<button type="button" class="icon-btn" data-gider-eylem="duzenle" data-id="${g.id}" aria-label="Gideri düzenle" title="Düzenle">${icon('pencil', 16)}</button>` : ''}
        ${arsivleyebilir ? html`<button type="button" class="icon-btn" data-gider-eylem="arsiv" data-id="${g.id}" aria-label="Gideri arşivle" title="Arşivle">${icon('archive', 16)}</button>` : ''}</td></tr>`;
  };
  const tablo = () => {
    const l = gorunen();
    if (!l.length) {
      return emptyState({ simge: 'receipt', baslik: `${ayAdi(durum.ay)} için gider yok`, metin: 'Kira, yakıt, maaş gibi giderleri girdikçe işletme ve firma kârlılığı hesaplanabilir.',
        eylem: olusturabilir ? html`<button type="button" class="btn btn-primary" data-action="yeni-gider">${icon('plus', 18)} Gider ekle</button>` : '' });
    }
    const sayfaSayisi = Math.max(1, Math.ceil(l.length / SAYFA_BASI)); durum.sayfa = Math.min(durum.sayfa, sayfaSayisi);
    return html`<div class="table-wrap"><table class="table"><thead><tr><th scope="col">Tarih</th><th scope="col">Kategori</th><th scope="col" class="hide-sm">Bağlı olduğu</th><th scope="col">Tür</th><th scope="col" class="num">Tutar</th><th scope="col" class="hide-sm">Ödeme</th><th scope="col"><span class="sr-only">Eylemler</span></th></tr></thead>
      <tbody>${l.slice((durum.sayfa - 1) * SAYFA_BASI, durum.sayfa * SAYFA_BASI).map(satir)}</tbody></table></div>${sayfalama({ sayfa: durum.sayfa, sayfaSayisi, toplam: l.length, sayfaBasi: SAYFA_BASI })}`;
  };

  return {
    baslik: 'Giderler', altBaslik: 'Doğrudan ve ortak giderler; tutarlar KDV hariç esas alınır, KDV dahil tutar da gösterilir',
    eylemler: html`${app.can('settings', 'create') ? html`<button type="button" class="btn btn-secondary" data-action="yeni-kategori">${icon('plus', 18)} Kategori ekle</button>` : ''}
      ${olusturabilir ? html`<button type="button" class="btn btn-primary" data-action="yeni-gider">${icon('plus', 18)} Gider ekle</button>` : ''}`,
    govde: html`<div id="gider-ozet">${ozet()}</div>
      <section class="card card-flush"><div class="toolbar">
        <label class="select-inline"><span class="sr-only">Ay</span><select id="gider-ay">${aySecenekleri(bugunStr).map((a) => html`<option value="${a}" ${a === durum.ay ? html`selected` : ''}>${ayAdi(a)}</option>`)}</select></label>
        <label class="select-inline"><span class="sr-only">Kategori</span><select id="gider-kategori"><option value="">Tüm kategoriler</option>${kategoriler.map((k) => html`<option value="${k.id}">${k.name}</option>`)}</select></label>
        <label class="select-inline"><span class="sr-only">Tür</span><select id="gider-tur"><option value="">Tüm türler</option><option value="dogrudan">Doğrudan</option><option value="ortak">Ortak</option></select></label>
        <label class="check"><input type="checkbox" id="gider-odenmemis"> <span>Yalnız ödenmemişler</span></label>
      </div><div id="gider-tablo">${tablo()}</div></section>
      <p class="fine pad">Ortak giderlerin firmalara ve personele dağıtımı ile kârlılık Aşama 7'de eklenecek. Maaş ve personel maliyeti giderlerini yalnızca maaş yetkisi olanlar görür.</p>`,
    mount(kok) {
      const t = kok.querySelector('#gider-tablo'); const o = kok.querySelector('#gider-ozet');
      const ciz = () => { t.innerHTML = tablo().s; o.innerHTML = ozet().s; };
      const yenileVeri = async () => { app.yenile(); };
      kok.querySelector('#gider-ay').addEventListener('change', (e) => { durum.ay = e.target.value; durum.sayfa = 1; ciz(); });
      kok.querySelector('#gider-kategori').addEventListener('change', (e) => { durum.kategori = e.target.value; durum.sayfa = 1; ciz(); });
      kok.querySelector('#gider-tur').addEventListener('change', (e) => { durum.tur = e.target.value; durum.sayfa = 1; ciz(); });
      kok.querySelector('#gider-odenmemis').addEventListener('change', (e) => { durum.odenmemis = e.target.checked; durum.sayfa = 1; ciz(); });
      kok.addEventListener('click', async (e) => {
        const a = e.target.closest('[data-action]');
        if (a?.dataset.action === 'yeni-gider') { giderFormuAc(app, { kategoriler }); return; }
        if (a?.dataset.action === 'yeni-kategori') { kategoriFormuAc(app, yenileVeri); return; }
        const sf = e.target.closest('[data-sayfa]'); if (sf && !sf.disabled) { durum.sayfa = Number(sf.dataset.sayfa); ciz(); return; }
        const d = e.target.closest('[data-gider-eylem]'); if (!d) return;
        const g = giderler.find((x) => x.id === d.dataset.id); if (!g) return;
        if (d.dataset.giderEylem === 'duzenle') { giderFormuAc(app, { kayit: g, kategoriler }); return; }
        if (!(await confirmDialog({ baslik: 'Gideri arşivle', onayEtiketi: 'Arşivle', tehlikeli: true, mesaj: 'Gider toplamlara dahil edilmeyecek. Kayıt silinmez.' }))) return;
        try { await app.api.archiveExpense(g.id); toast('Gider arşive alındı.'); app.yenile(); } catch (err) { toast(humanError(err), 'hata'); }
      });
    },
  };
}
