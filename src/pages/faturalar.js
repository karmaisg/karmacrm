// OSGB 360 - Gelirler ve tahsilatlar: fatura listesi, kısmi tahsilat, vade/gecikme takibi, toplu dönem faturası.
import { html, bugun, tarih, gunEkle, para, para2, sayi, icerir, trSirala, ayAdi, ayBasi } from '../lib/format.js';
import { icon } from '../ui/icons.js';
import { pill, emptyState, field, checkbox, openModal, openFormModal, confirmDialog, toast, sayfalama } from '../ui/components.js';
import { ODEME_DURUMLARI, ODEME_TON, ODEME_YONTEMLERI, faturaDurumu, finansOzeti, tahsilatHaritasi } from '../lib/finans.js';
import { KDV_MODU, SOZLESME_DURUMLARI } from '../lib/ticari.js';
import { kdvAyir } from '../lib/hesaplama.js';
import { bosIseNull } from '../lib/veri.js';
import { humanError } from '../lib/api.js';

const SAYFA_BASI = 25;

export const odemePill = (d) => pill(ODEME_DURUMLARI[d] ?? d, ODEME_TON[d] ?? 'neutral');

/** Durum rozeti: tahsil durumu + (kalan varsa) gecikme günü. */
export function faturaRozetleri(d) {
  return html`${odemePill(d.durum)}${d.gecikmis ? html` ${pill(`${d.gecikmeGunu} gün gecikti`, 'danger')}` : ''}${d.fazlaTahsilat ? html` ${pill('Fazla tahsilat', 'warning')}` : ''}`;
}

const seceneklerHtml = (liste) => liste.map((s) => `<option value="${String(s.deger).replace(/"/g, '&quot;')}">${String(s.etiket).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))}</option>`).join('');

// ---------------------------------------------------------------- fatura formu
export async function faturaFormuAc(app, { kayit = null, companyId = null, onDone = null } = {}) {
  const duzenle = kayit !== null;
  let firmalar = []; let sozlesmeler = []; let kalemler = [];
  try {
    [firmalar, sozlesmeler, kalemler] = await Promise.all([
      app.api.listCompanies(), app.can('contracts', 'view') ? app.api.listContracts() : [], duzenle ? app.api.listInvoiceItems(kayit.id) : [],
    ]);
  } catch (e) { toast(humanError(e), 'hata'); return; }
  const firmaListesi = firmalar.filter((f) => !f.archived_at || f.id === kayit?.company_id).sort((a, b) => trSirala(a.name, b.name));
  const ilkFirma = kayit?.company_id ?? companyId ?? '';
  const sozSecenekleri = (firma) => [{ deger: '', etiket: 'Sözleşmesiz / tek seferlik' }].concat(
    sozlesmeler.filter((c) => !c.archived_at && c.company_id === firma).map((c) => ({ deger: c.id, etiket: `${tarih(c.start_date)} – ${tarih(c.end_date)} (${SOZLESME_DURUMLARI[c.status] ?? c.status})` })));
  const oran = kayit && Number(kayit.amount_excl_vat) > 0 ? Math.round((Number(kayit.vat_amount) / Number(kayit.amount_excl_vat)) * 10000) / 100 : 20;
  const v = (k, y = '') => kayit?.[k] ?? y;
  const bugunStr = bugun();
  const m = openFormModal({
    baslik: duzenle ? 'Faturayı düzenle' : 'Fatura ekle', altBaslik: duzenle ? kayit.invoice_no : 'Tutarı girin; KDV ayrımı otomatik yapılır.', boyut: 'lg',
    gonderEtiketi: duzenle ? 'Değişiklikleri kaydet' : 'Faturayı kaydet',
    govde: html`${field({ ad: 'company_id', etiket: 'Firma', zorunlu: true, deger: ilkFirma, pasif: duzenle || !!companyId,
      secenekler: [{ deger: '', etiket: 'Seçiniz' }].concat(firmaListesi.map((f) => ({ deger: f.id, etiket: f.name }))) })}
      ${field({ ad: 'contract_id', etiket: 'Sözleşme', deger: v('contract_id'), secenekler: sozSecenekleri(ilkFirma) })}
      ${field({ ad: 'invoice_no', etiket: 'Fatura numarası', deger: v('invoice_no'), maksUzunluk: 40, ipucu: duzenle ? '' : 'Boş bırakırsanız otomatik verilir (F-2026-0001).' })}
      ${field({ ad: 'service_period', etiket: 'Hizmet dönemi', tur: 'month', deger: kayit?.service_period ? String(kayit.service_period).slice(0, 7) : '', ipucu: 'Aylık hizmet faturası ise ayı seçin. Aynı sözleşme ve ay için tek fatura kesilebilir.' })}
      ${field({ ad: 'invoice_date', etiket: 'Fatura tarihi', tur: 'date', zorunlu: true, deger: v('invoice_date', bugunStr) })}
      ${field({ ad: 'due_date', etiket: 'Vade tarihi', tur: 'date', zorunlu: true, deger: v('due_date', gunEkle(bugunStr, 30)) })}
      ${field({ ad: 'tutar', etiket: 'Tutar (TL)', tur: 'number', min: 0, adim: '0.01', inputmode: 'decimal', zorunlu: true, deger: duzenle ? kayit.amount_excl_vat : '' })}
      ${field({ ad: 'vat_mode', etiket: 'Tutar KDV', deger: 'kdv_haric', secenekler: Object.entries(KDV_MODU).map(([deger, etiket]) => ({ deger, etiket })) })}
      ${field({ ad: 'vat_rate', etiket: 'KDV oranı (%)', tur: 'number', min: 0, max: 100, adim: '0.01', deger: oran })}
      <div class="field field-full" id="fatura-bilgi" aria-live="polite"></div>
      ${field({ ad: 'aciklama', etiket: 'Kalem açıklaması', tam: true, maksUzunluk: 200, deger: kalemler[0]?.description ?? '', yerTutucu: 'Örn. İSG hizmet bedeli - Ekim 2026' })}
      ${field({ ad: 'notes', etiket: 'Not', tur: 'textarea', tam: true, maksUzunluk: 1000, deger: v('notes') })}`,
    async onSubmit(fd, form) {
      const g = (k) => String(fd.get(k) ?? '').trim();
      const firma = form.elements.company_id.value;
      const h = {};
      if (!firma) h.company_id = 'Firmayı seçin.';
      if (!g('invoice_date')) h.invoice_date = 'Fatura tarihini seçin.';
      if (!g('due_date')) h.due_date = 'Vade tarihini seçin.';
      else if (g('invoice_date') && g('due_date') < g('invoice_date')) h.due_date = 'Vade, fatura tarihinden önce olamaz.';
      if (!(Number(g('tutar')) > 0)) h.tutar = 'Tutar sıfırdan büyük olmalıdır.';
      const kdv = Number(g('vat_rate'));
      if (g('vat_rate') === '' || !(kdv >= 0 && kdv <= 100)) h.vat_rate = 'KDV oranı 0 ile 100 arasında olmalıdır.';
      if (Object.keys(h).length) return { errors: h };
      await app.api.saveInvoice({
        id: kayit?.id ?? null, firma, sozlesme: bosIseNull(g('contract_id')), no: bosIseNull(g('invoice_no')), tarih: g('invoice_date'), vade: g('due_date'),
        donem: g('service_period') ? `${g('service_period')}-01` : null, tutar: Number(g('tutar')), kdvModu: g('vat_mode') || 'kdv_haric', kdvOrani: kdv,
        aciklama: bosIseNull(g('aciklama')), not: bosIseNull(g('notes')),
      });
      toast(duzenle ? 'Fatura güncellendi.' : 'Fatura eklendi.');
    },
    onDone: () => (onDone ? onDone() : app.yenile()),
  });
  const form = m.el.querySelector('form');
  const bilgi = form.querySelector('#fatura-bilgi');
  const guncelle = () => {
    const t = Number(form.elements.tutar.value); const o = Number(form.elements.vat_rate.value);
    if (!(t > 0) || !(o >= 0 && o <= 100)) { bilgi.innerHTML = ''; return; }
    const k = kdvAyir(t, form.elements.vat_mode.value, o);
    bilgi.innerHTML = html`<div class="notice notice-info" role="status">KDV hariç ${para2(k.haric)} + KDV ${para2(k.kdv)} = <strong>KDV dahil ${para2(k.dahil)}</strong></div>`.s;
  };
  form.addEventListener('input', guncelle); form.addEventListener('change', (e) => {
    if (e.target.name === 'company_id') form.elements.contract_id.innerHTML = seceneklerHtml(sozSecenekleri(e.target.value));
    guncelle();
  });
  guncelle();
}

// ---------------------------------------------------------------- tahsilat formu
export function tahsilatFormuAc(app, { fatura, durum, firmaAdi = '', onDone = null }) {
  const bugunStr = bugun();
  const m = openFormModal({
    baslik: 'Tahsilat ekle', altBaslik: `${fatura.invoice_no}${firmaAdi ? ` · ${firmaAdi}` : ''} · kalan ${para2(Math.max(durum.kalan, 0))}`,
    gonderEtiketi: 'Tahsilatı kaydet',
    govde: html`${field({ ad: 'paid_at', etiket: 'Tahsilat tarihi', tur: 'date', zorunlu: true, deger: bugunStr, max: bugunStr })}
      ${field({ ad: 'amount', etiket: 'Tutar (KDV dahil, TL)', tur: 'number', min: 0, adim: '0.01', inputmode: 'decimal', zorunlu: true, deger: durum.kalan > 0 ? durum.kalan : '' })}
      ${field({ ad: 'method', etiket: 'Ödeme yöntemi', deger: ODEME_YONTEMLERI[0], secenekler: ODEME_YONTEMLERI.map((y) => ({ deger: y, etiket: y })) })}
      <div class="field field-full" id="tahsilat-bilgi" aria-live="polite"></div>
      ${field({ ad: 'notes', etiket: 'Not', tam: true, maksUzunluk: 300, yerTutucu: 'Örn. dekont no' })}`,
    async onSubmit(fd) {
      const g = (k) => String(fd.get(k) ?? '').trim();
      const h = {};
      if (!g('paid_at')) h.paid_at = 'Tarihi seçin.';
      else if (g('paid_at') > bugun()) h.paid_at = 'Tahsilat tarihi gelecekte olamaz.';
      if (!(Number(g('amount')) > 0)) h.amount = 'Tutar sıfırdan büyük olmalıdır.';
      if (Object.keys(h).length) return { errors: h };
      await app.api.addPayment({ invoice_id: fatura.id, paid_at: g('paid_at'), amount: Number(g('amount')), method: bosIseNull(g('method')), notes: bosIseNull(g('notes')) });
      toast('Tahsilat kaydedildi.');
    },
    onDone: () => (onDone ? onDone() : app.yenile()),
  });
  const form = m.el.querySelector('form'); const bilgi = form.querySelector('#tahsilat-bilgi');
  const guncelle = () => {
    const t = Number(form.elements.amount.value);
    if (!(t > 0)) { bilgi.innerHTML = ''; return; }
    const kalan = Math.round((durum.kalan - t) * 100) / 100;
    bilgi.innerHTML = (kalan < 0
      ? html`<div class="notice notice-warn" role="status">Bu tutar kalanı ${para2(-kalan)} aşıyor. Fazla tahsilat olarak kaydedilir; faturada uyarı görünür.</div>`
      : html`<div class="notice notice-info" role="status">Kayıttan sonra kalan: <strong>${para2(kalan)}</strong>${kalan === 0 ? ' (fatura tamamen tahsil edilmiş olur)' : ''}</div>`).s;
  };
  form.addEventListener('input', guncelle); guncelle();
}

// ---------------------------------------------------------------- fatura detayı
export async function faturaDetayAc(app, fatura, { firmaAdi = '', onDone = null } = {}) {
  let tahsilatlar = []; let kalemler = [];
  try {
    [tahsilatlar, kalemler] = await Promise.all([app.api.listPayments().then((l) => l.filter((p) => p.invoice_id === fatura.id)), app.api.listInvoiceItems(fatura.id)]);
  } catch (e) { toast(humanError(e), 'hata'); return; }
  const bugunStr = bugun();
  const bitti = () => { if (onDone) onDone(); else app.yenile(); };
  const aktif = tahsilatlar.filter((p) => !p.archived_at).sort((a, b) => String(a.paid_at).localeCompare(String(b.paid_at)));
  const d = faturaDurumu(fatura, aktif, bugunStr);
  const duzenleyebilir = app.can('invoices', 'edit'); const olusturabilir = app.can('invoices', 'create'); const arsivleyebilir = app.can('invoices', 'archive');
  const m = openModal({
    baslik: `Fatura ${fatura.invoice_no}`, altBaslik: firmaAdi, boyut: 'lg',
    govde: html`<div class="stats">
        <div class="stat"><span class="stat-l">Fatura tutarı (KDV dahil)</span><strong class="stat-v">${para2(d.faturaTutari)}</strong><span class="stat-s">KDV hariç ${para2(fatura.amount_excl_vat)} + KDV ${para2(fatura.vat_amount)}</span></div>
        <div class="stat"><span class="stat-l">Tahsil edilen</span><strong class="stat-v">${para2(d.tahsilEdilen)}</strong><span class="stat-s">${aktif.length} tahsilat</span></div>
        <div class="stat"><span class="stat-l">Kalan</span><strong class="stat-v">${para2(d.kalan)}</strong><span class="stat-s">Vade ${tarih(fatura.due_date)}</span></div></div>
      <p class="pad-t">${faturaRozetleri(d)}</p>
      <dl class="kv-list">
        <div class="kv"><dt>Fatura tarihi</dt><dd>${tarih(fatura.invoice_date)}</dd></div>
        <div class="kv"><dt>Hizmet dönemi</dt><dd>${fatura.service_period ? ayAdi(fatura.service_period) : html`<span class="muted">—</span>`}</dd></div>
        <div class="kv"><dt>Kalem</dt><dd>${kalemler.length ? kalemler.map((k) => k.description).join(', ') : html`<span class="muted">—</span>`}</dd></div>
        ${fatura.notes ? html`<div class="kv"><dt>Not</dt><dd class="prewrap">${fatura.notes}</dd></div>` : ''}
      </dl>
      <h3 class="card-title">Tahsilatlar</h3>
      ${aktif.length ? html`<div class="table-wrap"><table class="table"><thead><tr><th scope="col">Tarih</th><th scope="col">Yöntem</th><th scope="col" class="num">Tutar</th><th scope="col"><span class="sr-only">Eylemler</span></th></tr></thead><tbody>
        ${aktif.map((p) => html`<tr><td>${tarih(p.paid_at)}</td><td>${p.method ?? '—'}${p.notes ? html`<small class="block muted">${p.notes}</small>` : ''}</td><td class="num">${para2(p.amount)}</td>
          <td class="actions">${arsivleyebilir ? html`<button type="button" class="icon-btn" data-odeme-iptal="${p.id}" aria-label="Tahsilatı iptal et" title="Tahsilatı iptal et">${icon('archive', 16)}</button>` : ''}</td></tr>`)}</tbody></table></div>`
        : html`<p class="muted">Henüz tahsilat girilmemiş.</p>`}
      <div class="modal-actions modal-actions-wrap">
        ${olusturabilir && d.kalan > 0 ? html`<button type="button" class="btn btn-primary" data-f-eylem="tahsilat">${icon('plus', 18)} Tahsilat ekle</button>` : ''}
        ${duzenleyebilir ? html`<button type="button" class="btn btn-secondary" data-f-eylem="duzenle">${icon('pencil', 18)} Düzenle</button>
          ${fatura.flag === 'itirazli' ? '' : html`<button type="button" class="btn btn-secondary" data-f-eylem="itirazli">İtirazlı işaretle</button>`}
          ${fatura.flag === 'takip_gerekiyor' ? '' : html`<button type="button" class="btn btn-secondary" data-f-eylem="takip">Takip gerekiyor</button>`}
          ${fatura.flag ? html`<button type="button" class="btn btn-secondary" data-f-eylem="isaret-kaldir">İşareti kaldır</button>` : ''}` : ''}
        ${arsivleyebilir ? html`<button type="button" class="btn btn-secondary" data-f-eylem="arsiv">${icon('archive', 18)} Arşivle</button>` : ''}
        <button type="button" class="btn btn-secondary" data-close>Kapat</button>
      </div>`,
  });
  m.el.addEventListener('click', async (e) => {
    const iptal = e.target.closest('[data-odeme-iptal]');
    if (iptal) {
      if (!(await confirmDialog({ baslik: 'Tahsilatı iptal et', onayEtiketi: 'İptal et', tehlikeli: true, mesaj: 'Tahsilat kaydı toplamlardan çıkarılır. Kayıt silinmez; denetim geçmişinde kalır.' }))) return;
      try { await app.api.archivePayment(iptal.dataset.odemeIptal); toast('Tahsilat iptal edildi.'); m.close(); bitti(); } catch (err) { toast(humanError(err), 'hata'); }
      return;
    }
    const b = e.target.closest('[data-f-eylem]'); if (!b) return;
    const eylem = b.dataset.fEylem;
    try {
      if (eylem === 'tahsilat') { m.close(); tahsilatFormuAc(app, { fatura, durum: d, firmaAdi, onDone }); }
      else if (eylem === 'duzenle') { m.close(); faturaFormuAc(app, { kayit: fatura, onDone }); }
      else if (eylem === 'itirazli' || eylem === 'takip' || eylem === 'isaret-kaldir') {
        await app.api.setInvoiceFlag(fatura.id, eylem === 'itirazli' ? 'itirazli' : eylem === 'takip' ? 'takip_gerekiyor' : null);
        toast(eylem === 'isaret-kaldir' ? 'İşaret kaldırıldı.' : 'Fatura işaretlendi.'); m.close(); bitti();
      } else if (eylem === 'arsiv') {
        if (!(await confirmDialog({ baslik: 'Faturayı arşivle', onayEtiketi: 'Arşivle', tehlikeli: true, mesaj: `${fatura.invoice_no} arşive alınacak ve toplamlara dahil edilmeyecek. Tahsilatı olan fatura arşivlenemez.` }))) return;
        await app.api.archiveInvoice(fatura.id); toast('Fatura arşive alındı.'); m.close(); bitti();
      }
    } catch (err) { toast(humanError(err), 'hata'); }
  });
}

// ---------------------------------------------------------------- toplu dönem faturası
export function topluFaturaFormuAc(app, { onDone = null } = {}) {
  const bugunStr = bugun();
  let sonuc = null;
  openFormModal({
    baslik: 'Aylık faturaları oluştur', altBaslik: 'Aktif sözleşmeler için seçilen aya fatura üretir. Aynı sözleşme ve ay için ikinci fatura üretilmez.',
    gonderEtiketi: 'Faturaları oluştur', boyut: 'md',
    govde: html`${field({ ad: 'donem', etiket: 'Hizmet dönemi', tur: 'month', zorunlu: true, deger: bugunStr.slice(0, 7) })}
      ${field({ ad: 'fatura_tarihi', etiket: 'Fatura tarihi', tur: 'date', zorunlu: true, deger: bugunStr })}
      ${field({ ad: 'vade_gun', etiket: 'Vade (gün)', tur: 'number', min: 0, max: 365, adim: 1, inputmode: 'numeric', zorunlu: true, deger: 30 })}
      <div class="notice notice-info field-full" role="note">Kişi başı fiyatlı sözleşmelerde tutar, o tarihte geçerli çalışan sayısıyla hesaplanır. Özel fiyatlı sözleşmeler ve ay ortasında başlayan/biten sözleşmelerde gün oranlaması yapılmaz; gerekirse faturayı elle girin veya düzenleyin.</div>`,
    async onSubmit(fd) {
      const g = (k) => String(fd.get(k) ?? '').trim();
      const h = {};
      if (!/^\d{4}-\d{2}$/.test(g('donem'))) h.donem = 'Ayı seçin.';
      if (!g('fatura_tarihi')) h.fatura_tarihi = 'Fatura tarihini seçin.';
      if (!/^\d{1,3}$/.test(g('vade_gun')) || Number(g('vade_gun')) > 365) h.vade_gun = 'Vade 0 ile 365 gün arasında olmalıdır.';
      if (Object.keys(h).length) return { errors: h };
      sonuc = await app.api.generateInvoices({ donem: `${g('donem')}-01`, tarih: g('fatura_tarihi'), vadeGun: Number(g('vade_gun')) });
    },
    onDone: () => {
      const ozet = sonuc ?? { olusturulan: 0, atlanan: [] };
      toast(ozet.olusturulan ? `${ozet.olusturulan} fatura oluşturuldu.` : 'Yeni fatura oluşturulmadı.', ozet.olusturulan ? 'basari' : 'bilgi');
      if (ozet.atlanan.length) {
        const m = openModal({ baslik: 'Atlanan sözleşmeler', altBaslik: `${ozet.olusturulan} fatura oluşturuldu, ${ozet.atlanan.length} sözleşme atlandı.`,
          govde: html`<ul class="list">${ozet.atlanan.map((a) => html`<li><strong>${a.firma}</strong><span class="muted">${a.neden}</span></li>`)}</ul>
            <div class="modal-actions"><button type="button" class="btn btn-primary" data-close>Tamam</button></div>`, onClose: () => (onDone ? onDone() : app.yenile()) });
        return m;
      }
      return onDone ? onDone() : app.yenile();
    },
  });
}

// ---------------------------------------------------------------- firma kartındaki sekme
export function firmaFaturalari(app, faturalar, tahsilatlar, bugunStr = bugun()) {
  const harita = tahsilatHaritasi(tahsilatlar);
  const l = faturalar.filter((f) => !f.archived_at).sort((a, b) => String(b.invoice_date).localeCompare(String(a.invoice_date)));
  if (!l.length) return emptyState({ simge: 'wallet', baslik: 'Bu firmaya henüz fatura kesilmemiş', metin: 'Fatura ekleyin veya Gelirler ve tahsilatlar sayfasından aylık faturaları toplu oluşturun.' });
  return html`<div class="table-wrap"><table class="table"><thead><tr><th scope="col">Fatura</th><th scope="col" class="hide-sm">Vade</th><th scope="col" class="num">Tutar</th><th scope="col" class="num hide-sm">Kalan</th><th scope="col">Durum</th><th scope="col"><span class="sr-only">Eylemler</span></th></tr></thead><tbody>
    ${l.map((f) => { const d = faturaDurumu(f, harita.get(f.id) ?? [], bugunStr);
      return html`<tr><td><strong>${f.invoice_no}</strong><small class="block muted">${tarih(f.invoice_date)}${f.service_period ? ` · ${ayAdi(f.service_period)}` : ''}</small></td><td class="hide-sm">${tarih(f.due_date)}</td>
        <td class="num">${para2(d.faturaTutari)}</td><td class="num hide-sm">${para2(Math.max(d.kalan, 0))}</td><td>${faturaRozetleri(d)}</td>
        <td class="actions"><button type="button" class="icon-btn" data-fatura-detay="${f.id}" aria-label="Fatura ${f.invoice_no} detayı" title="Detay">${icon('receipt', 16)}</button></td></tr>`; })}</tbody></table></div>`;
}

// ---------------------------------------------------------------- sayfa
const DURUM_FILTRELERI = [['', 'Tüm faturalar'], ['acik', 'Kalanı olanlar'], ['gecikmis', 'Vadesi geçmiş'], ['kismi_tahsilat', 'Kısmi tahsilat'], ['tahsil_edildi', 'Tahsil edilmiş'], ['itirazli', 'İtirazlı'], ['takip_gerekiyor', 'Takip gerekiyor']];

export async function tahsilatSayfasi(app) {
  const bugunStr = bugun();
  const [faturalar, tahsilatlar, firmalar] = await Promise.all([app.api.listInvoices(), app.api.listPayments(), app.can('companies', 'view') ? app.api.listCompanies() : []]);
  const firmaAdi = new Map(firmalar.map((f) => [f.id, f.name]));
  const harita = tahsilatHaritasi(tahsilatlar);
  const durum = { durum: 'acik', firma: '', ara: '', sayfa: 1 };
  const olusturabilir = app.can('invoices', 'create');
  const ozet = finansOzeti(faturalar, tahsilatlar, bugunStr);

  const satirlar = () => faturalar.filter((f) => !f.archived_at).map((f) => ({ f, d: faturaDurumu(f, harita.get(f.id) ?? [], bugunStr) }))
    .filter(({ f, d }) => {
      if (durum.firma && f.company_id !== durum.firma) return false;
      if (durum.ara && !icerir(`${f.invoice_no} ${firmaAdi.get(f.company_id) ?? ''}`, durum.ara)) return false;
      if (durum.durum === 'acik') return d.kalan > 0;
      if (durum.durum === 'gecikmis') return d.gecikmis;
      if (durum.durum) return d.durum === durum.durum;
      return true;
    }).sort((a, b) => (b.d.gecikmis - a.d.gecikmis) || String(a.f.due_date).localeCompare(String(b.f.due_date)));

  const kutu = (e, d, a, s) => html`<section class="card kpi"><span class="kpi-ic">${icon(s, 22)}</span><div><div class="kpi-l">${e}</div><div class="kpi-v">${d}</div><div class="kpi-s">${a}</div></div></section>`;
  const kpiler = () => html`<div class="kpi-grid">
    ${kutu('Açık alacak', para(ozet.toplamKalan), `${sayi(satirlar0().filter((x) => x.d.kalan > 0).length)} faturada kalan (KDV dahil)`, 'wallet')}
    ${kutu('Vadesi geçmiş', para(ozet.gecikmisKalan), `${sayi(ozet.gecikmisAdet)} fatura`, 'alert')}
    ${kutu('Bu ay tahsilat', para(ozet.buAyTahsilat), ayAdi(ayBasi(bugunStr)), 'trend')}
    ${kutu('İtirazlı', para(ozet.itirazliKalan), `${sayi(ozet.itirazliAdet)} fatura${ozet.fazlaTahsilatAdet ? ` · ${ozet.fazlaTahsilatAdet} faturada fazla tahsilat` : ''}`, 'receipt')}</div>`;
  const satirlar0 = () => faturalar.filter((f) => !f.archived_at).map((f) => ({ f, d: faturaDurumu(f, harita.get(f.id) ?? [], bugunStr) }));

  const yas = ozet.yaslandirma;
  const yasKarti = () => html`<section class="card"><h2 class="card-title">Vade yaşlandırması</h2><ul class="list">
    <li><span>Vadesi gelmemiş</span><strong>${para(yas.guncel)}</strong></li><li><span>1–30 gün gecikmiş</span><strong>${para(yas.g30)}</strong></li>
    <li><span>31–60 gün</span><strong>${para(yas.g60)}</strong></li><li><span>61–90 gün</span><strong>${para(yas.g90)}</strong></li><li><span>90 günden fazla</span><strong>${para(yas.g90p)}</strong></li></ul></section>`;
  const borcluKarti = () => {
    const en = Object.entries(ozet.firmaKalan).sort((a, b) => b[1] - a[1]).slice(0, 5);
    return html`<section class="card"><h2 class="card-title">En yüksek açık alacak</h2>${en.length ? html`<ul class="list">${en.map(([id, t]) => html`<li>${firmaAdi.get(id) ? html`<a class="link" href="#/firmalar/${id}">${firmaAdi.get(id)}</a>` : 'Firma'}<strong>${para(t)}</strong></li>`)}</ul>` : html`<p class="muted">Açık alacak yok.</p>`}</section>`;
  };

  const satir = ({ f, d }) => html`<tr><td><strong>${f.invoice_no}</strong><small class="block muted">${tarih(f.invoice_date)}${f.service_period ? ` · ${ayAdi(f.service_period)}` : ''}</small></td>
    <td>${firmaAdi.get(f.company_id) ? html`<a class="link" href="#/firmalar/${f.company_id}">${firmaAdi.get(f.company_id)}</a>` : 'Firma'}</td>
    <td class="hide-sm">${tarih(f.due_date)}</td><td class="num">${para2(d.faturaTutari)}</td><td class="num hide-md">${para2(d.tahsilEdilen)}</td><td class="num">${para2(Math.max(d.kalan, 0))}</td>
    <td>${faturaRozetleri(d)}</td>
    <td class="actions">${olusturabilir && d.kalan > 0 ? html`<button type="button" class="icon-btn" data-fatura-tahsilat="${f.id}" aria-label="Fatura ${f.invoice_no} için tahsilat ekle" title="Tahsilat ekle">${icon('plus', 16)}</button>` : ''}
      <button type="button" class="icon-btn" data-fatura-detay="${f.id}" aria-label="Fatura ${f.invoice_no} detayı" title="Detay">${icon('receipt', 16)}</button></td></tr>`;
  const tablo = () => {
    const l = satirlar();
    if (!faturalar.some((f) => !f.archived_at)) {
      return emptyState({ simge: 'wallet', baslik: 'Henüz fatura yok', metin: 'Sözleşmeli müşterileriniz için aylık faturaları tek tıkla oluşturabilir ya da fatura ekleyebilirsiniz.',
        eylem: olusturabilir ? html`<button type="button" class="btn btn-primary" data-action="toplu-fatura">${icon('plus', 18)} Aylık faturaları oluştur</button>` : '' });
    }
    if (!l.length) return emptyState({ simge: 'search', baslik: 'Bu filtreye uyan fatura yok', metin: 'Filtreleri değiştirin.' });
    const sayfaSayisi = Math.max(1, Math.ceil(l.length / SAYFA_BASI)); durum.sayfa = Math.min(durum.sayfa, sayfaSayisi);
    return html`<div class="table-wrap"><table class="table"><thead><tr><th scope="col">Fatura</th><th scope="col">Firma</th><th scope="col" class="hide-sm">Vade</th><th scope="col" class="num">Tutar</th><th scope="col" class="num hide-md">Tahsil edilen</th><th scope="col" class="num">Kalan</th><th scope="col">Durum</th><th scope="col"><span class="sr-only">Eylemler</span></th></tr></thead>
      <tbody>${l.slice((durum.sayfa - 1) * SAYFA_BASI, durum.sayfa * SAYFA_BASI).map(satir)}</tbody></table></div>${sayfalama({ sayfa: durum.sayfa, sayfaSayisi, toplam: l.length, sayfaBasi: SAYFA_BASI })}`;
  };

  return {
    baslik: 'Gelirler ve tahsilatlar', altBaslik: 'Faturalar, kısmi tahsilatlar, vade ve gecikme takibi (tutarlar KDV dahil)',
    eylemler: olusturabilir ? html`<button type="button" class="btn btn-secondary" data-action="toplu-fatura">${icon('calendar', 18)} Aylık faturaları oluştur</button>
      <button type="button" class="btn btn-primary" data-action="yeni-fatura">${icon('plus', 18)} Fatura ekle</button>` : '',
    govde: html`${kpiler()}<div class="grid-2 pad-t">${yasKarti()}${borcluKarti()}</div>
      <section class="card card-flush"><div class="toolbar">
        <label class="search-field"><span class="sr-only">Fatura veya firma ara</span><input type="search" id="fatura-ara" placeholder="Fatura no veya firma ara" autocomplete="off"></label>
        <label class="select-inline"><span class="sr-only">Durum</span><select id="fatura-durum">${DURUM_FILTRELERI.map(([d, e]) => html`<option value="${d}" ${d === durum.durum ? html`selected` : ''}>${e}</option>`)}</select></label>
        ${firmalar.length ? html`<label class="select-inline"><span class="sr-only">Firma</span><select id="fatura-firma"><option value="">Tüm firmalar</option>${firmalar.filter((f) => !f.archived_at).sort((a, b) => trSirala(a.name, b.name)).map((f) => html`<option value="${f.id}">${f.name}</option>`)}</select></label>` : ''}
      </div><div id="fatura-tablo">${tablo()}</div></section>`,
    mount(kok) {
      const t = kok.querySelector('#fatura-tablo'); const ciz = () => { t.innerHTML = tablo().s; };
      kok.querySelector('#fatura-ara').addEventListener('input', (e) => { durum.ara = e.target.value; durum.sayfa = 1; ciz(); });
      kok.querySelector('#fatura-durum').addEventListener('change', (e) => { durum.durum = e.target.value; durum.sayfa = 1; ciz(); });
      kok.querySelector('#fatura-firma')?.addEventListener('change', (e) => { durum.firma = e.target.value; durum.sayfa = 1; ciz(); });
      kok.addEventListener('click', (e) => {
        const a = e.target.closest('[data-action]');
        if (a?.dataset.action === 'yeni-fatura') { faturaFormuAc(app); return; }
        if (a?.dataset.action === 'toplu-fatura') { topluFaturaFormuAc(app); return; }
        const sf = e.target.closest('[data-sayfa]'); if (sf && !sf.disabled) { durum.sayfa = Number(sf.dataset.sayfa); ciz(); return; }
        const tb = e.target.closest('[data-fatura-tahsilat]');
        if (tb) { const x = satirlar0().find((s) => s.f.id === tb.dataset.faturaTahsilat); if (x) tahsilatFormuAc(app, { fatura: x.f, durum: x.d, firmaAdi: firmaAdi.get(x.f.company_id) ?? '' }); return; }
        const db = e.target.closest('[data-fatura-detay]');
        if (db) { const f = faturalar.find((s) => s.id === db.dataset.faturaDetay); if (f) faturaDetayAc(app, f, { firmaAdi: firmaAdi.get(f.company_id) ?? '' }); }
      });
    },
  };
}
