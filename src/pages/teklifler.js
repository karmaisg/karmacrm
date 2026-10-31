// OSGB 360 - Teklifler: liste, form (canlı kârlılık), teklif sayfası, kalemler, durum işlemleri, kabul → sözleşme.
import {
  html, bugun, tarih, tarihSaat, gunEkle, para, sayi, icerir, trSirala, TEHLIKE, TEHLIKE_SIRASI,
} from '../lib/format.js';
import { icon } from '../ui/icons.js';
import {
  avatar, pill, emptyState, field, openFormModal, openModal, confirmDialog, toast, sayfalama,
} from '../ui/components.js';
import { SURE_SECENEKLERI, baglantiAdresi, baglantiDurumu, yanitHaritasi, yanitDurumu } from '../lib/musteri.js';
import { fiyatSenaryolari } from '../lib/hesaplama.js';
import {
  FIYATLAMA, KDV_MODU, TEKLIF_DURUMLARI, TEKLIF_TON, TEKLIF_GECISLERI, teklifKilitli, kabulEdilebilir, teklifHesabi,
} from '../lib/ticari.js';
import { ayarDegeri, bosIseNull, guncelProfil, profilleriGrupla } from '../lib/veri.js';
import { humanError } from '../lib/api.js';

const SAYFA_BASI = 25;
export const teklifPill = (d) => pill(TEKLIF_DURUMLARI[d] ?? d, TEKLIF_TON[d] ?? 'neutral');
/** Gönderilmiş teklifte müşteri yanıtı rozeti (durum rozetinin yanına). */
export const yanitPill = (y) => (y === 'kabul' ? pill('Müşteri KABUL etti — işleyin', 'success') : y === 'red' ? pill('Müşteri reddetti — işleyin', 'danger') : y === 'bekliyor' ? pill('Müşteri yanıtı bekleniyor', 'warning') : '');
const yuzde = (m) => (m === null || m === undefined ? '—' : `%${(m * 100).toFixed(1).replace('.', ',')}`);

const marjEsigi = (ayarlar) => Number(ayarDegeri(ayarlar, 'marj_esigi_yuzde', bugun(), 20)) || 20;
const varsayilanKdv = (ayarlar) => Number(ayarDegeri(ayarlar, 'varsayilan_kdv_orani', bugun(), 20)) || 20;

// ---------------------------------------------------------------- hesap özeti (form ve sayfa ortak)
export function hesapOzeti(o, esik) {
  let h;
  try { h = teklifHesabi(o, esik); } catch { return html`<p class="muted">Hesap için fiyat ve çalışan sayısını girin.</p>`; }
  return html`<div class="score-box" aria-live="polite">
    <div class="score-top"><strong class="score-v">${yuzde(h.katkiMarji)}</strong><span class="muted">katkı marjı</span>${h.esikAltinda ? pill('Eşiğin altında', 'danger') : ''}</div>
    <ul class="score-list">
      <li><span>Aylık gelir (KDV hariç)</span><strong>${para(h.aylikGelirKdvHaric)}</strong></li>
      <li><span>KDV</span><strong>${para(h.kdvTutari)}</strong></li>
      <li><span>Aylık toplam (KDV dahil)</span><strong>${para(h.aylikToplamKdvDahil)}</strong></li>
      <li><span>Tahmini aylık maliyet</span><strong>${para(h.toplamMaliyet)}</strong></li>
      <li><span>Aylık katkı kârı</span><strong>${para(h.katkiKari)}</strong></li>
    </ul>
    ${h.uyari ? html`<div class="notice notice-warn" role="status">${h.uyari}</div>` : ''}
  </div>`;
}

// ---------------------------------------------------------------- form
export async function teklifFormuAc(app, { teklif = null, leadId = null, companyId = null, opportunityId = null, onDone = null } = {}) {
  const duzenle = teklif !== null;
  let yeniId = null;
  let firmalar = [], adaylar = [], firsatlar = [], ayarlar = [], profiller = [];
  try {
    [firmalar, adaylar, firsatlar, ayarlar, profiller] = await Promise.all([
      app.can('companies', 'view') ? app.api.listCompanies() : [],
      app.can('crm', 'view') ? app.api.listLeads() : [],
      app.can('opportunities', 'view') ? app.api.listOpportunities() : [],
      app.api.listSettings(),
      app.can('companies', 'view') ? app.api.listAllProfiles() : [],
    ]);
  } catch (e) { toast(humanError(e), 'hata'); return; }
  const esik = marjEsigi(ayarlar);
  const profilHaritasi = profilleriGrupla(profiller);
  const secFirma = teklif?.company_id ?? companyId ?? '';
  const secAday = teklif?.lead_id ?? leadId ?? '';
  const sabit = !duzenle && (companyId || leadId);
  const firmaSec = [{ deger: '', etiket: 'Seçiniz' }].concat(firmalar.filter((f) => !f.archived_at || f.id === secFirma).sort((a, b) => trSirala(a.name, b.name)).map((f) => ({ deger: f.id, etiket: f.name })));
  const adaySec = [{ deger: '', etiket: 'Seçiniz' }].concat(adaylar.filter((l) => (!l.archived_at && !l.converted_company_id) || l.id === secAday).sort((a, b) => trSirala(a.name, b.name)).map((l) => ({ deger: l.id, etiket: l.name })));
  const firsatSec = [{ deger: '', etiket: 'Bağlı fırsat yok' }].concat(firsatlar.filter((f) => !f.archived_at).map((f) => ({ deger: f.id, etiket: f.title })));
  const onProfil = guncelProfil(profilHaritasi.get(secFirma), bugun());
  const onAday = adaylar.find((l) => l.id === secAday);
  const v = (k, y = '') => teklif?.[k] ?? y;
  const oncekiCalisan = teklif ? v('employee_count') : (onProfil?.employee_count ?? onAday?.employee_count ?? '');
  const oncekiTehlike = teklif ? v('hazard_class') : (onProfil?.hazard_class ?? onAday?.hazard_class ?? '');

  const m = openFormModal({
    baslik: duzenle ? `Teklifi düzenle (${teklif.offer_no})` : 'Yeni teklif', altBaslik: 'Fiyat girdikçe katkı kârı ve marj canlı hesaplanır',
    boyut: 'lg', gonderEtiketi: duzenle ? 'Değişiklikleri kaydet' : 'Taslak teklifi oluştur',
    govde: html`
      ${app.can('companies', 'view') ? field({ ad: 'company_id', etiket: 'Mevcut firma', deger: secFirma, secenekler: firmaSec, pasif: !!sabit && !!companyId }) : ''}
      ${app.can('crm', 'view') ? field({ ad: 'lead_id', etiket: 'Potansiyel müşteri', deger: secAday, secenekler: adaySec, pasif: !!sabit && !!leadId }) : ''}
      ${app.can('opportunities', 'view') ? field({ ad: 'opportunity_id', etiket: 'Satış fırsatı', deger: teklif?.opportunity_id ?? opportunityId ?? '', secenekler: firsatSec, tam: true }) : ''}
      ${field({ ad: 'employee_count', etiket: 'Çalışan sayısı', tur: 'number', min: 0, adim: 1, inputmode: 'numeric', zorunlu: true, deger: oncekiCalisan })}
      ${field({ ad: 'hazard_class', etiket: 'Tehlike sınıfı', zorunlu: true, deger: oncekiTehlike, secenekler: [{ deger: '', etiket: 'Seçiniz' }].concat(TEHLIKE_SIRASI.map((k) => ({ deger: k, etiket: TEHLIKE[k] }))) })}
      ${field({ ad: 'pricing', etiket: 'Fiyatlama', zorunlu: true, deger: v('pricing', 'kisi_basi'), secenekler: [{ deger: 'kisi_basi', etiket: FIYATLAMA.kisi_basi }, { deger: 'sabit_aylik', etiket: FIYATLAMA.sabit_aylik }] })}
      ${field({ ad: 'unit_price', etiket: 'Kişi başı aylık fiyat (TL)', tur: 'number', min: 0, adim: '0.01', inputmode: 'decimal', deger: v('unit_price') })}
      ${field({ ad: 'fixed_monthly_price', etiket: 'Sabit aylık fiyat (TL)', tur: 'number', min: 0, adim: '0.01', inputmode: 'decimal', deger: v('fixed_monthly_price') })}
      ${field({ ad: 'vat_mode', etiket: 'Fiyat KDV', deger: v('vat_mode', 'kdv_haric'), secenekler: Object.entries(KDV_MODU).map(([deger, etiket]) => ({ deger, etiket })) })}
      ${field({ ad: 'vat_rate', etiket: 'KDV oranı (%)', tur: 'number', min: 0, max: 100, adim: '0.01', deger: v('vat_rate', varsayilanKdv(ayarlar)) })}
      ${field({ ad: 'discount_pct', etiket: 'İndirim (%)', tur: 'number', min: 0, max: 100, adim: '0.01', deger: v('discount_pct', 0) })}
      ${field({ ad: 'valid_until', etiket: 'Geçerlilik tarihi', tur: 'date', deger: v('valid_until', gunEkle(bugun(), 30)) })}
      ${field({ ad: 'est_expert_cost', etiket: 'Tahmini aylık uzman maliyeti (TL)', tur: 'number', min: 0, adim: '0.01', inputmode: 'decimal', deger: v('est_expert_cost'), ipucu: 'Bu müşteriye ayrılacak uzman süresinin aylık maliyeti.' })}
      ${field({ ad: 'est_physician_cost', etiket: 'Tahmini aylık hekim maliyeti (TL)', tur: 'number', min: 0, adim: '0.01', inputmode: 'decimal', deger: v('est_physician_cost') })}
      ${field({ ad: 'est_travel_other_cost', etiket: 'Tahmini yol ve diğer maliyet (TL)', tur: 'number', min: 0, adim: '0.01', inputmode: 'decimal', deger: v('est_travel_other_cost') })}
      ${field({ ad: 'description', etiket: 'Açıklama / kapsam', tur: 'textarea', tam: true, deger: v('description'), maksUzunluk: 3000 })}
      <div class="field field-full" id="hesap-alani"></div>`,
    async onSubmit(fd) {
      const g = (k) => String(fd.get(k) ?? '').trim();
      const h = {};
      const firma = sabit && companyId ? companyId : g('company_id');
      const aday = sabit && leadId ? leadId : g('lead_id');
      if (!firma && !aday) h.company_id = 'Bir firma veya potansiyel müşteri seçin.';
      if (firma && aday) h.lead_id = 'Aynı anda hem firma hem potansiyel müşteri seçilemez.';
      if (!/^\d{1,7}$/.test(g('employee_count'))) h.employee_count = 'Çalışan sayısı 0 veya daha büyük bir tam sayı olmalıdır.';
      if (!g('hazard_class')) h.hazard_class = 'Tehlike sınıfını seçin.';
      const sayiMi = (k) => g(k) !== '' && Number(g(k)) >= 0;
      if (g('pricing') === 'kisi_basi' && !sayiMi('unit_price')) h.unit_price = 'Kişi başı fiyatı girin (0 veya üstü).';
      if (g('pricing') === 'sabit_aylik' && !sayiMi('fixed_monthly_price')) h.fixed_monthly_price = 'Sabit aylık tutarı girin (0 veya üstü).';
      for (const k of ['est_expert_cost', 'est_physician_cost', 'est_travel_other_cost']) if (g(k) !== '' && !sayiMi(k)) h[k] = 'Tutar 0 veya daha büyük olmalıdır.';
      const kdv = Number(g('vat_rate'));
      if (g('vat_rate') === '' || !(kdv >= 0 && kdv <= 100)) h.vat_rate = 'KDV oranı 0 ile 100 arasında olmalıdır.';
      const ind = Number(g('discount_pct') || 0);
      if (!(ind >= 0 && ind <= 100)) h.discount_pct = 'İndirim 0 ile 100 arasında olmalıdır.';
      if (g('valid_until') && g('valid_until') < (teklif?.offer_date ?? bugun())) h.valid_until = 'Geçerlilik tarihi teklif tarihinden önce olamaz.';
      if (Object.keys(h).length) return { errors: h };
      const num = (k) => (g(k) === '' ? null : Number(g(k)));
      const kisi = g('pricing') === 'kisi_basi';
      const degerler = {
        company_id: bosIseNull(firma), lead_id: bosIseNull(aday), opportunity_id: bosIseNull(g('opportunity_id')),
        employee_count: Number(g('employee_count')), hazard_class: g('hazard_class'), pricing: g('pricing'),
        unit_price: kisi ? num('unit_price') : null, fixed_monthly_price: kisi ? null : num('fixed_monthly_price'),
        vat_mode: g('vat_mode') || 'kdv_haric', vat_rate: kdv, discount_pct: ind, valid_until: bosIseNull(g('valid_until')),
        est_expert_cost: num('est_expert_cost'), est_physician_cost: num('est_physician_cost'), est_travel_other_cost: num('est_travel_other_cost'),
        description: bosIseNull(g('description')),
      };
      if (duzenle) { await app.api.updateOffer(teklif.id, degerler); toast('Teklif güncellendi.'); }
      else { const yeni = await app.api.createOffer(degerler); yeniId = yeni.id; toast(`Taslak teklif oluşturuldu (${yeni.offer_no}).`); }
    },
    onDone: () => (yeniId ? app.git(`teklifler/${yeniId}`) : (onDone ? onDone() : app.yenile())),
  });

  const form = m.el.querySelector('form');
  const alan = form.querySelector('#hesap-alani');
  const guncelle = () => {
    const g = (k) => String(form.elements[k]?.value ?? '').trim();
    const kisi = g('pricing') === 'kisi_basi';
    form.querySelector('[data-field="unit_price"]').hidden = !kisi;
    form.querySelector('[data-field="fixed_monthly_price"]').hidden = kisi;
    const n = (k) => (g(k) === '' ? null : Number(g(k)));
    alan.innerHTML = hesapOzeti({
      pricing: g('pricing'), unit_price: kisi ? n('unit_price') : null, fixed_monthly_price: kisi ? null : n('fixed_monthly_price'),
      employee_count: n('employee_count') ?? 0, vat_mode: g('vat_mode'), vat_rate: n('vat_rate') ?? 20, discount_pct: n('discount_pct') ?? 0,
      est_expert_cost: n('est_expert_cost'), est_physician_cost: n('est_physician_cost'), est_travel_other_cost: n('est_travel_other_cost'),
    }, esik).s;
  };
  form.addEventListener('input', guncelle);
  form.addEventListener('change', guncelle);
  // firma seçilince çalışan sayısı ve tehlike sınıfı otomatik gelir (boşsa)
  form.addEventListener('change', (e) => {
    if (e.target.name !== 'company_id' || !e.target.value) return;
    const p = guncelProfil(profilHaritasi.get(e.target.value), bugun());
    if (p && !form.elements.employee_count.value) form.elements.employee_count.value = p.employee_count;
    if (p && !form.elements.hazard_class.value) form.elements.hazard_class.value = p.hazard_class;
    guncelle();
  });
  guncelle();
}

// ---------------------------------------------------------------- liste
export async function tekliflerSayfasi(app) {
  const [teklifler, firmalar, adaylar, ayarlar, yanitlar] = await Promise.all([
    app.api.listOffers(),
    app.can('companies', 'view') ? app.api.listCompanies() : [],
    app.can('crm', 'view') ? app.api.listLeads() : [],
    app.api.listSettings(),
    app.api.listOfferResponses().catch(() => []),
  ]);
  const yanitHarita = yanitHaritasi(yanitlar);
  const yanitOf = (o) => yanitDurumu(o, yanitHarita);
  const esik = marjEsigi(ayarlar);
  const firmaAdi = new Map(firmalar.map((f) => [f.id, f.name]));
  const adayAdi = new Map(adaylar.map((l) => [l.id, l.name]));
  const kimin = (o) => (o.company_id && firmaAdi.get(o.company_id)) || (o.lead_id && adayAdi.get(o.lead_id)) || 'Kayıt';
  const olusturabilir = app.can('offers', 'create');
  const durum = { filtre: 'tumu', q: '', sayfa: 1 };
  const GRUP = {
    tumu: (o) => !o.archived_at, taslak: (o) => !o.archived_at && ['taslak', 'onay_bekliyor'].includes(o.status),
    gonderilen: (o) => !o.archived_at && ['gonderildi', 'gorusuluyor'].includes(o.status),
    yanit_bekleyen: (o) => yanitOf(o) === 'bekliyor', yanit_gelen: (o) => ['kabul', 'red'].includes(yanitOf(o)),
    kabul: (o) => !o.archived_at && o.status === 'kabul_edildi',
    kapanan: (o) => !o.archived_at && ['reddedildi', 'suresi_doldu'].includes(o.status), arsiv: (o) => !!o.archived_at,
  };
  const FILTRELER = [['tumu', 'Tümü'], ['taslak', 'Taslak'], ['gonderilen', 'Gönderilen'], ['yanit_bekleyen', 'Yanıt bekleyen'], ['yanit_gelen', 'Yanıt geldi (işlenmedi)'], ['kabul', 'Kabul edilen'], ['kapanan', 'Reddedilen / süresi dolan'], ['arsiv', 'Arşivli']];
  const sayilar = Object.fromEntries(Object.entries(GRUP).map(([k, f]) => [k, teklifler.filter(f).length]));

  const satir = (o) => {
    let h = null; try { h = teklifHesabi(o, esik); } catch { h = null; }
    return html`<tr class="${o.archived_at ? 'row-muted' : ''}">
      <td><a class="cell-main" href="#/teklifler/${o.id}">${avatar(kimin(o))}<span><strong>${o.offer_no}</strong><small>${kimin(o)}</small></span></a></td>
      <td class="hide-sm">${tarih(o.offer_date)}</td>
      <td class="num">${h ? para(h.aylikGelirKdvHaric) : '—'}</td>
      <td class="hide-md">${h ? (h.esikAltinda ? pill(yuzde(h.katkiMarji), 'danger') : yuzde(h.katkiMarji)) : '—'}</td>
      <td class="hide-md">${o.valid_until ? tarih(o.valid_until) : html`<span class="muted">—</span>`}</td>
      <td>${teklifPill(o.status)}${yanitOf(o) ? html`<small class="block">${yanitPill(yanitOf(o))}</small>` : ''}</td></tr>`;
  };
  function tablo() {
    if (!teklifler.length) {
      return emptyState({ simge: 'file', baslik: 'Henüz teklif yok', metin: 'Firma veya potansiyel müşteri için teklif hazırlayın; kâr marjı fiyat girerken canlı hesaplanır.',
        eylem: olusturabilir ? html`<button type="button" class="btn btn-primary" data-action="yeni-teklif">${icon('plus', 18)} İlk teklifi hazırla</button>` : '' });
    }
    let liste = teklifler.filter(GRUP[durum.filtre]);
    const q = durum.q.trim();
    if (q) liste = liste.filter((o) => [o.offer_no, kimin(o), o.description].some((d) => d && icerir(d, q)));
    liste.sort((a, b) => String(b.offer_no).localeCompare(String(a.offer_no)));
    if (!liste.length) return emptyState({ simge: 'search', baslik: 'Eşleşen teklif yok', metin: 'Arama veya filtreyi değiştirmeyi deneyin.' });
    const sayfaSayisi = Math.max(1, Math.ceil(liste.length / SAYFA_BASI));
    durum.sayfa = Math.min(durum.sayfa, sayfaSayisi);
    return html`<div class="table-wrap"><table class="table"><thead><tr><th scope="col">Teklif</th><th scope="col" class="hide-sm">Tarih</th><th scope="col" class="num">Aylık gelir (KDV hariç)</th><th scope="col" class="hide-md">Katkı marjı</th><th scope="col" class="hide-md">Geçerlilik</th><th scope="col">Durum</th></tr></thead>
      <tbody>${liste.slice((durum.sayfa - 1) * SAYFA_BASI, durum.sayfa * SAYFA_BASI).map(satir)}</tbody></table></div>
      ${sayfalama({ sayfa: durum.sayfa, sayfaSayisi, toplam: liste.length, sayfaBasi: SAYFA_BASI })}`;
  }
  const filtreHtml = () => html`${FILTRELER.map(([id, ad]) => html`<button type="button" class="chip ${durum.filtre === id ? 'chip-on' : ''}" data-filtre="${id}" aria-pressed="${durum.filtre === id}">${ad} <span class="chip-n">${sayilar[id]}</span></button>`)}`;

  return {
    baslik: 'Teklifler', altBaslik: 'Kişi başı veya sabit fiyatlı teklifler, canlı kârlılık hesabı',
    eylemler: olusturabilir ? html`<button type="button" class="btn btn-primary" data-action="yeni-teklif">${icon('plus', 18)} Yeni teklif</button>` : '',
    govde: html`<section class="card card-flush"><div class="toolbar">
      <div class="search-field">${icon('search', 18)}<input type="search" id="teklif-ara" placeholder="Teklif no, firma veya açıklama ara" aria-label="Tekliflerde ara" autocomplete="off"></div>
      <div class="chips" id="teklif-filtre" role="group" aria-label="Teklif filtresi">${filtreHtml()}</div></div><div id="teklif-tablo">${tablo()}</div></section>`,
    mount(kok) {
      const tabloEl = kok.querySelector('#teklif-tablo');
      const yenile = () => { tabloEl.innerHTML = tablo().s; };
      kok.querySelector('#teklif-ara').addEventListener('input', (e) => { durum.q = e.target.value; durum.sayfa = 1; yenile(); });
      kok.querySelector('#teklif-filtre').addEventListener('click', (e) => {
        const d = e.target.closest('[data-filtre]'); if (!d) return;
        durum.filtre = d.dataset.filtre; durum.sayfa = 1; kok.querySelector('#teklif-filtre').innerHTML = filtreHtml().s; yenile();
      });
      kok.addEventListener('click', (e) => {
        if (e.target.closest('[data-action="yeni-teklif"]')) { teklifFormuAc(app); return; }
        const sf = e.target.closest('[data-sayfa]');
        if (sf && !sf.disabled) { durum.sayfa = Number(sf.dataset.sayfa); yenile(); }
      });
    },
  };
}

// ---------------------------------------------------------------- teklif sayfası
export async function teklifSayfasi(app, id) {
  const [liste, firmalar, adaylar, ayarlar, uyeler] = await Promise.all([
    app.api.listOffers(),
    app.can('companies', 'view') ? app.api.listCompanies() : [],
    app.can('crm', 'view') ? app.api.listLeads() : [],
    app.api.listSettings(),
    app.api.listOrgMembers().catch(() => []),
  ]);
  const o = liste.find((x) => x.id === id);
  if (!o) {
    return { baslik: 'Teklif bulunamadı', altBaslik: '', eylemler: html`<a class="btn btn-secondary" href="#/teklifler">${icon('arrowL', 18)} Tekliflere dön</a>`,
      govde: emptyState({ simge: 'file', baslik: 'Bu teklif yok ya da erişim izniniz yok' }) };
  }
  const [kalemler, sozlesmeler, paylasimlar] = await Promise.all([
    app.api.listOfferItems(id),
    app.can('contracts', 'view') ? app.api.listContracts() : [],
    app.api.listOfferShares(id).catch(() => null),   // null: 12_asama12.sql çalıştırılmamış
  ]);
  const esik = marjEsigi(ayarlar);
  const firma = firmalar.find((f) => f.id === o.company_id);
  const aday = adaylar.find((l) => l.id === o.lead_id);
  const uyeAdi = new Map(uyeler.map((u) => [u.id, u.full_name]));
  const kilitli = teklifKilitli(o.status);
  const duzenleyebilir = app.can('offers', 'edit') && !o.archived_at;
  const bagliSozlesme = sozlesmeler.find((c) => c.offer_id === o.id && !c.archived_at);
  const kdvDurum = (k) => `${KDV_MODU[k.vat_mode] ?? ''} %${sayi(Number(k.vat_rate))}`;

  let h = null; try { h = teklifHesabi(o, esik); } catch { h = null; }
  let senaryo = null;
  try {
    const fiyatlama = o.pricing === 'kisi_basi' ? 'kisi_basi' : 'sabit_aylik';
    senaryo = fiyatSenaryolari({
      fiyatlama, birimFiyat: Number(o.unit_price ?? 0), sabitFiyat: Number(o.fixed_monthly_price ?? 0), calisanSayisi: o.employee_count,
      kdvModu: o.vat_mode, kdvOrani: Number(o.vat_rate), indirimYuzde: Number(o.discount_pct),
      uzmanMaliyeti: Number(o.est_expert_cost ?? 0), hekimMaliyeti: Number(o.est_physician_cost ?? 0), ulasimDigerMaliyet: Number(o.est_travel_other_cost ?? 0), marjEsigiYuzde: esik,
    });
  } catch { senaryo = null; }

  const kalemToplami = kalemler.reduce((t, k) => t + Number(k.quantity) * Number(k.unit_price), 0);
  const kalemTablosu = () => html`<section class="card card-flush"><div class="card-head"><div><h2 class="card-title">Ek kalemler</h2><p class="card-sub">Eğitim, ölçüm, danışmanlık gibi tek seferlik veya ek hizmetler. Aylık hizmet bedeline dahil değildir.</p></div>
      ${duzenleyebilir && !kilitli ? html`<button type="button" class="btn btn-secondary btn-sm" data-action="kalem-ekle">${icon('plus', 16)} Kalem ekle</button>` : ''}</div>
    ${kalemler.length ? html`<div class="table-wrap"><table class="table"><thead><tr><th scope="col">Açıklama</th><th scope="col" class="num">Miktar</th><th scope="col" class="num">Birim fiyat</th><th scope="col" class="num">Tutar</th><th scope="col"><span class="sr-only">Eylemler</span></th></tr></thead>
      <tbody>${kalemler.map((k) => html`<tr><td>${k.description}<small class="block muted">${kdvDurum(k)}</small></td><td class="num">${sayi(Number(k.quantity))}</td><td class="num">${para(k.unit_price)}</td><td class="num">${para(Number(k.quantity) * Number(k.unit_price))}</td>
        <td class="actions">${duzenleyebilir && !kilitli ? html`<button type="button" class="icon-btn" data-kalem-sil="${k.id}" aria-label="${k.description} kalemini kaldır" title="Kaldır">${icon('archive', 18)}</button>` : ''}</td></tr>`)}
      <tr><th scope="row">Toplam (KDV hariç/dahil karışık girilmiş olabilir)</th><td></td><td></td><td class="num"><strong>${para(kalemToplami)}</strong></td><td></td></tr></tbody></table></div>`
      : emptyState({ simge: 'receipt', baslik: 'Ek kalem yok' })}</section>`;

  const gecisDugmeleri = () => {
    if (!duzenleyebilir) return '';
    const etiket = { onay_bekliyor: 'Onaya gönder', gonderildi: o.status === 'taslak' || o.status === 'onay_bekliyor' ? 'Müşteriye gönder' : 'Yeniden gönder', gorusuluyor: 'Görüşülüyor', reddedildi: 'Reddedildi', suresi_doldu: 'Süresi doldu', taslak: 'Taslağa al' };
    return (TEKLIF_GECISLERI[o.status] ?? []).map((d) => html`<button type="button" class="btn btn-secondary" data-gecis="${d}">${etiket[d] ?? TEKLIF_DURUMLARI[d]}</button>`);
  };

  const yanitliPay = (paylasimlar ?? []).find((x) => x.response);
  const paylasimKarti = () => {
    if (paylasimlar === null) return html`<section class="card pad grid-full yazdirma-gizli" id="paylasim-karti"><h2 class="card-title">Müşteri bağlantısı</h2>
      <div class="notice notice-info" role="note">Bu özellik için Supabase'de <strong>12_asama12.sql</strong> dosyasını çalıştırın.</div></section>`;
    const aktif = paylasimlar.find((x) => !x.revoked_at); const durum = baglantiDurumu(aktif);
    const yanitli = paylasimlar.find((x) => x.response);
    const olusturabilir = duzenleyebilir && kabulEdilebilir(o.status);
    return html`<section class="card card-flush grid-full yazdirma-gizli" id="paylasim-karti"><div class="card-head"><div><h2 class="card-title">Müşteri bağlantısı</h2>
      <p class="card-sub">Teklifi müşteriye giriş gerektirmeyen gizli bir bağlantıyla gösterin; müşteri kabul veya ret yanıtı verebilir. Sistem müşteriye hiçbir mesaj göndermez; bağlantıyı siz iletirsiniz.</p></div>
      <div class="action-row">${olusturabilir ? html`<button type="button" class="btn btn-primary btn-sm" data-action="paylasim-olustur">${icon('plus', 16)} ${aktif && durum.ad === 'aktif' ? 'Yeni bağlantı oluştur' : 'Bağlantı oluştur'}</button>` : ''}
        ${duzenleyebilir && durum.ad === 'aktif' ? html`<button type="button" class="btn btn-secondary btn-sm" data-action="paylasim-iptal">Bağlantıyı iptal et</button>` : ''}</div></div>
      <div class="pad">
        ${aktif ? html`<p>${pill(durum.metin, durum.ad === 'aktif' ? 'success' : 'neutral')} <span class="muted">Son geçerlilik: ${tarihSaat(aktif.expires_at)} · ${aktif.view_count} görüntüleme${aktif.last_viewed_at ? ` · son: ${tarihSaat(aktif.last_viewed_at)}` : ''}</span></p>
          ${aktif.customer_note ? html`<p class="fine">Müşteriye notunuz: <span class="prewrap">${aktif.customer_note}</span></p>` : ''}`
          : html`<p class="muted">${olusturabilir ? 'Henüz bağlantı oluşturulmadı.' : 'Bağlantı oluşturmak için teklifi önce "Müşteriye gönder" olarak işaretleyin.'}</p>`}
        ${durum.ad === 'aktif' ? html`<p class="fine">Güvenlik gereği bağlantının kendisi yalnızca oluşturulduğu anda gösterilir. Kaybettiyseniz yeni bağlantı oluşturun; eskisi kapanır.</p>` : ''}
        ${yanitli ? html`<div class="notice ${yanitli.response === 'kabul' ? 'notice-ok' : 'notice-warn'}" role="status" id="musteri-yaniti"><strong>Müşteri yanıtı: ${yanitli.response === 'kabul' ? 'KABUL' : 'RED'}</strong> — ${yanitli.responder_name}, ${tarihSaat(yanitli.responded_at)}
          ${yanitli.responder_note ? html`<span class="block prewrap">Not: ${yanitli.responder_note}</span>` : ''}
          <span class="block fine">${['gonderildi', 'gorusuluyor'].includes(o.status) ? (yanitli.response === 'kabul' ? 'Sıradaki adım: müşteriyle görüşüp "Sözleşme oluştur" düğmesini kullanın.' : 'Sıradaki adım: müşteriyle görüşün; sonuç değişmezse "Reddedildi" olarak işaretleyin.') : 'Teklif durumu işlenmiş.'} Teklif durumu kendiliğinden değişmez. Size bir görev eklendi; e-posta bildirimi kuruluysa ayrıca e-posta gelir.</span></div>` : ''}
      </div></section>`;
  };

  return {
    baslik: o.offer_no, altBaslik: '', geri: { href: '#/teklifler', ad: 'Teklifler' },
    ozelBaslik: html`<div class="company-head">${avatar(firma?.name ?? aday?.name ?? o.offer_no, 'lg')}<div><h1>${o.offer_no}</h1>
      <div class="company-meta">${teklifPill(o.status)} ${['gonderildi', 'gorusuluyor'].includes(o.status) && !o.archived_at ? yanitPill(yanitliPay ? yanitliPay.response : 'bekliyor') : ''} ${firma ? html`<a class="link" href="#/firmalar/${firma.id}">${firma.name}</a>` : aday ? html`<a class="link" href="#/crm/${aday.id}">${aday.name}</a>` : ''}
      <span class="muted">${tarih(o.offer_date)}${o.valid_until ? ` · geçerlilik ${tarih(o.valid_until)}` : ''}</span></div></div></div>`,
    eylemler: html`${duzenleyebilir && !kilitli ? html`<button type="button" class="btn btn-secondary" data-action="duzenle">${icon('pencil', 18)} Düzenle</button>` : ''}
      <button type="button" class="btn btn-secondary" data-yazdir>${icon('file', 18)} Yazdır / PDF</button>
      ${app.can('offers', 'create') ? html`<button type="button" class="btn btn-secondary" data-action="kopyala">${icon('file', 18)} Kopyala</button>` : ''}
      ${duzenleyebilir && kabulEdilebilir(o.status) && app.can('contracts', 'create') ? html`<button type="button" class="btn btn-primary" data-action="kabul">${icon('check', 18)} Sözleşme oluştur</button>` : ''}
      ${app.can('offers', 'archive') && !o.archived_at ? html`<button type="button" class="btn btn-secondary" data-action="arsiv">${icon('archive', 18)} Arşivle</button>` : ''}`,
    govde: html`${o.archived_at ? html`<div class="notice notice-warn" role="status">Bu teklif arşivde.</div>` : ''}
      ${kilitli ? html`<div class="notice notice-info" role="status">Gönderilmiş teklifin fiyat bilgileri değiştirilemez. Değişiklik için <strong>Kopyala</strong> ile yeni sürüm hazırlayın.</div>` : ''}
      ${kabulEdilebilir(o.status) && duzenleyebilir && !app.can('contracts', 'create') ? html`<div class="notice notice-info" role="status">Teklifi kabul edip sözleşmeye çevirmek için sözleşme oluşturma yetkisi gerekir; yetkili kullanıcıya iletin.</div>` : ''}
      ${bagliSozlesme ? html`<div class="notice notice-ok" role="status">Bu teklif sözleşmeye çevrildi: <a class="link" href="#/sozlesmeler/${bagliSozlesme.id}">Sözleşmeyi aç</a></div>` : ''}
      ${gecisDugmeleri().length ? html`<div class="action-row">${gecisDugmeleri()}</div>` : ''}
      <div class="grid-2">
        <section class="card"><h2 class="card-title">Fiyat</h2><dl class="kv-list">
          <div class="kv"><dt>Çalışan / tehlike</dt><dd>${sayi(o.employee_count)} · ${TEHLIKE[o.hazard_class]}</dd></div>
          <div class="kv"><dt>Fiyatlama</dt><dd>${FIYATLAMA[o.pricing]}</dd></div>
          <div class="kv"><dt>${o.pricing === 'kisi_basi' ? 'Kişi başı fiyat' : 'Aylık fiyat'}</dt><dd>${para(o.pricing === 'kisi_basi' ? o.unit_price : o.fixed_monthly_price)} <small class="muted">${kdvDurum(o)}</small></dd></div>
          <div class="kv"><dt>İndirim</dt><dd>%${sayi(Number(o.discount_pct))}</dd></div>
          <div class="kv"><dt>Hazırlayan</dt><dd>${uyeAdi.get(o.created_by) || html`<span class="muted">—</span>`}</dd></div>
        </dl></section>
        <section class="card yazdirma-gizli"><h2 class="card-title">Kârlılık</h2>${h ? hesapOzeti(o, esik) : html`<p class="muted">Hesaplanamadı.</p>`}</section>
        ${senaryo ? html`<section class="card grid-full yazdirma-gizli"><h2 class="card-title">Fiyat senaryoları</h2>
          <div class="table-wrap"><table class="table"><thead><tr><th scope="col">Senaryo</th><th scope="col" class="num">Aylık gelir (KDV hariç)</th><th scope="col" class="num">Katkı kârı</th><th scope="col" class="num">Marj</th></tr></thead><tbody>
            <tr><td>Mevcut teklif</td><td class="num">${para(senaryo.mevcut.aylikGelirKdvHaric)}</td><td class="num">${para(senaryo.mevcut.katkiKari)}</td><td class="num">${yuzde(senaryo.mevcut.katkiMarji)}</td></tr>
            <tr><td>Ek %5 indirim verilirse</td><td class="num">${para(senaryo.indirimli.aylikGelirKdvHaric)}</td><td class="num">${para(senaryo.indirimli.katkiKari)}</td><td class="num">${yuzde(senaryo.indirimli.katkiMarji)}</td></tr>
            <tr><td>%${sayi(esik)} marjı korumak için en az</td><td class="num">${para(senaryo.hedefMarj.gerekenAylikGelirKdvHaric)}</td><td class="num">—</td><td class="num">%${sayi(esik)}</td></tr></tbody></table></div>
          <p class="fine">Maliyetler sizin girdiğiniz tahminlerdir; gerçek maliyet Aşama 7'de fiilî sürelerle hesaplanır.</p></section>` : ''}
        ${o.description ? html`<section class="card grid-full"><h2 class="card-title">Kapsam / açıklama</h2><p class="prewrap">${o.description}</p></section>` : ''}
        <div class="grid-full">${kalemTablosu()}</div>
        ${paylasimKarti()}
      </div>`,
    mount(kok) {
      kok.addEventListener('click', async (e) => {
        if (e.target.closest('[data-yazdir]')) { window.print(); return; }
        const kalemSil = e.target.closest('[data-kalem-sil]');
        if (kalemSil) {
          try { await app.api.archiveOfferItem(kalemSil.dataset.kalemSil); toast('Kalem kaldırıldı.'); app.yenile(); } catch (err) { toast(humanError(err), 'hata'); }
          return;
        }
        const gecis = e.target.closest('[data-gecis]');
        if (gecis) {
          try { await app.api.setOfferStatus(o.id, gecis.dataset.gecis); toast(`Teklif durumu: ${TEKLIF_DURUMLARI[gecis.dataset.gecis]}.`); app.yenile(); } catch (err) { toast(humanError(err), 'hata'); }
          return;
        }
        const a = e.target.closest('[data-action]'); if (!a) return;
        const x = a.dataset.action;
        if (x === 'duzenle') teklifFormuAc(app, { teklif: o });
        else if (x === 'kalem-ekle') kalemFormu(app, o);
        else if (x === 'paylasim-olustur') paylasimFormu(app, o);
        else if (x === 'paylasim-iptal') {
          if (!(await confirmDialog({ baslik: 'Bağlantıyı iptal et', onayEtiketi: 'İptal et', tehlikeli: true, mesaj: 'Müşteri bu bağlantıyla teklife bir daha ulaşamaz. Daha önce verdiği yanıt saklanır.' }))) return;
          try { await app.api.revokeOfferShare(o.id); toast('Müşteri bağlantısı iptal edildi.'); app.yenile(); } catch (err) { toast(humanError(err), 'hata'); }
        }
        else if (x === 'kabul') kabulFormu(app, o);
        else if (x === 'kopyala') {
          try { const k = await app.api.copyOffer(o.id); toast(`Yeni taslak oluşturuldu (${k.offer_no}).`); app.git(`teklifler/${k.id}`); } catch (err) { toast(humanError(err), 'hata'); }
        } else if (x === 'arsiv') {
          if (!(await confirmDialog({ baslik: 'Teklifi arşivle', onayEtiketi: 'Arşivle', tehlikeli: true, mesaj: `${o.offer_no} teklifi arşive alınacak. Kayıt silinmez.` }))) return;
          try { await app.api.archiveOffer(o.id); toast('Teklif arşive alındı.'); app.yenile(); } catch (err) { toast(humanError(err), 'hata'); }
        }
      });
    },
  };
}

function kalemFormu(app, o) {
  openFormModal({
    baslik: 'Ek kalem ekle', altBaslik: o.offer_no, gonderEtiketi: 'Kalemi ekle',
    govde: html`${field({ ad: 'description', etiket: 'Açıklama', zorunlu: true, tam: true, maksUzunluk: 200, yerTutucu: 'Örn. Yıllık eğitim paketi' })}
      ${field({ ad: 'quantity', etiket: 'Miktar', tur: 'number', min: 0, adim: '0.01', deger: 1, zorunlu: true })}
      ${field({ ad: 'unit_price', etiket: 'Birim fiyat (TL)', tur: 'number', min: 0, adim: '0.01', inputmode: 'decimal', zorunlu: true })}
      ${field({ ad: 'vat_mode', etiket: 'KDV', deger: o.vat_mode, secenekler: Object.entries(KDV_MODU).map(([deger, etiket]) => ({ deger, etiket })) })}
      ${field({ ad: 'vat_rate', etiket: 'KDV oranı (%)', tur: 'number', min: 0, max: 100, adim: '0.01', deger: o.vat_rate })}`,
    async onSubmit(fd) {
      const g = (k) => String(fd.get(k) ?? '').trim();
      const h = {};
      if (!g('description')) h.description = 'Açıklama zorunludur.';
      if (!(Number(g('quantity')) > 0)) h.quantity = 'Miktar sıfırdan büyük olmalıdır.';
      if (g('unit_price') === '' || !(Number(g('unit_price')) >= 0)) h.unit_price = 'Birim fiyatı girin (0 veya üstü).';
      if (!(Number(g('vat_rate')) >= 0 && Number(g('vat_rate')) <= 100)) h.vat_rate = 'KDV oranı 0 ile 100 arasında olmalıdır.';
      if (Object.keys(h).length) return { errors: h };
      await app.api.createOfferItem({ offer_id: o.id, description: g('description'), quantity: Number(g('quantity')), unit_price: Number(g('unit_price')), vat_mode: g('vat_mode'), vat_rate: Number(g('vat_rate')) });
      toast('Kalem eklendi.');
    },
    onDone: () => app.yenile(),
  });
}

function paylasimFormu(app, o) {
  let token = null;
  openFormModal({
    baslik: 'Müşteri bağlantısı oluştur', altBaslik: `${o.offer_no}. Varsa önceki bağlantı kapanır.`, gonderEtiketi: 'Bağlantıyı oluştur',
    govde: html`${field({ ad: 'gun', etiket: 'Bağlantı kaç gün açık kalsın', zorunlu: true, deger: '30', secenekler: SURE_SECENEKLERI.map((g) => ({ deger: String(g), etiket: `${g} gün` })) })}
      ${field({ ad: 'not', etiket: 'Müşteriye kısa not (isteğe bağlı)', tur: 'textarea', tam: true, maksUzunluk: 1000, ipucu: 'Teklif sayfasında müşteri görür. İç bilgi yazmayın.' })}`,
    async onSubmit(fd) {
      token = await app.api.createOfferShare({ offer: o.id, gun: Number(fd.get('gun')), not: String(fd.get('not') ?? '').trim() || null });
    },
    onDone: async () => { if (token) baglantiGoster(token); app.yenile(); },
  });
}

function baglantiGoster(token) {
  const adres = baglantiAdresi(token, window.location);
  const m = openModal({
    baslik: 'Müşteri bağlantısı hazır', boyut: 'md', arkaPlanKapatir: false,
    govde: html`<p>Bu bağlantıyı müşteriye WhatsApp, e-posta veya mesajla siz iletin. Bağlantıya sahip olan herkes teklifi görebilir.</p>
      <div class="field"><label for="m-link">Bağlantı</label><input id="m-link" type="text" readonly value="${adres}"></div>
      <div class="notice notice-warn" role="note"><strong>Önemli:</strong> Bu bağlantı güvenlik için yalnızca şimdi gösterilir. Kopyalamayı unutursanız yeni bağlantı oluşturun (eskisi kapanır).</div>
      <div class="modal-actions"><button type="button" class="btn btn-secondary" data-close>Kapat</button><button type="button" class="btn btn-primary" data-kopyala>${icon('file', 16)} Kopyala</button></div>`,
  });
  m.el.querySelector('[data-kopyala]').addEventListener('click', async () => {
    const girdi = m.el.querySelector('#m-link');
    try { await navigator.clipboard.writeText(adres); toast('Bağlantı kopyalandı.'); }
    catch { girdi.focus(); girdi.select(); toast('Kopyalanamadı; bağlantı seçildi, Ctrl+C ile kopyalayın.', 'bilgi'); }
  });
  m.el.querySelector('#m-link').addEventListener('focus', (e) => e.target.select());
}

function kabulFormu(app, o) {
  let yeniId = null;
  openFormModal({
    baslik: 'Teklif kabul edildi', altBaslik: `${o.offer_no} sözleşmeye çevrilecek. İndirim fiyata işlenir; bağlı satış fırsatı "kazanıldı" olur.`, gonderEtiketi: 'Sözleşmeyi oluştur',
    govde: html`${field({ ad: 'baslangic', etiket: 'Sözleşme başlangıcı', tur: 'date', zorunlu: true, deger: bugun() })}
      ${field({ ad: 'bitis', etiket: 'Sözleşme bitişi', tur: 'date', zorunlu: true, deger: gunEkle(bugun(), 364), ipucu: 'Genellikle 12 ay.' })}
      ${field({ ad: 'odeme', etiket: 'Ödeme koşulları', tam: true, maksUzunluk: 300, yerTutucu: 'Örn. Her ayın 5\'ine kadar, 15 gün vade' })}
      ${field({ ad: 'yenileme', etiket: 'Yenileme koşulları', tam: true, maksUzunluk: 300 })}
      ${field({ ad: 'fiyat_guncelleme', etiket: 'Fiyat güncelleme koşulları', tam: true, maksUzunluk: 300, yerTutucu: 'Örn. Yılda bir, TÜFE oranında' })}`,
    async onSubmit(fd) {
      const g = (k) => String(fd.get(k) ?? '').trim();
      const h = {};
      if (!g('baslangic')) h.baslangic = 'Başlangıç tarihini seçin.';
      if (!g('bitis')) h.bitis = 'Bitiş tarihini seçin.';
      else if (g('baslangic') && g('bitis') < g('baslangic')) h.bitis = 'Bitiş, başlangıçtan önce olamaz.';
      if (Object.keys(h).length) return { errors: h };
      const c = await app.api.acceptOffer({ id: o.id, baslangic: g('baslangic'), bitis: g('bitis'), odeme: bosIseNull(g('odeme')), yenileme: bosIseNull(g('yenileme')), fiyatGuncelleme: bosIseNull(g('fiyat_guncelleme')) });
      yeniId = c.id; toast('Sözleşme oluşturuldu.');
    },
    onDone: () => (yeniId ? app.git(`sozlesmeler/${yeniId}`) : app.yenile()),
  });
}
