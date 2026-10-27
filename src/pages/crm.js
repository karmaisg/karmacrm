// OSGB 360 - CRM: potansiyel müşteri listesi, formu ve kartı (görüşmeler, kişiler, fırsatlar, görevler).
import {
  html, raw, bugun, tarih, para, sayi, icerir, trSirala, telHref, mailHref, safeUrl, TEHLIKE, TEHLIKE_SIRASI,
} from '../lib/format.js';
import { icon } from '../ui/icons.js';
import {
  avatar, pill, emptyState, field, openFormModal, confirmDialog, toast, sayfalama,
} from '../ui/components.js';
import {
  KAYNAKLAR, ONCELIKLER, ONCELIK_SIRASI, potansiyelPuani, puanSinifi, tahminiHizmetDakikasi, takipDurumu,
} from '../lib/puanlama.js';
import { bosIseNull, epostaGecerli, telefonGecerli, webGecerli, vergiNoNormalize } from '../lib/veri.js';
import { humanError } from '../lib/api.js';
import { tehlikePill } from './firmalar.js';
import { kisiFormuAc, kisiArsivle, kisiArsivdenCikar, kisiEylemDugmeleri, telHucre, epostaHucre } from './kisiler.js';
import { gorusmeFormuAc, zamanCizelgesi, gorusmeArsivle } from './gorusmeler.js';
import { firsatFormuAc, asamaPill } from './firsatlar.js';
import { gorevFormuAc } from './gorevler.js';
import { teklifFormuAc, teklifPill } from './teklifler.js';
import { firmaTeklifleri } from './sozlesmeler.js';
import { GOREV_DURUMLARI } from '../lib/puanlama.js';

const SAYFA_BASI = 25;
const PUAN_TON = { yuksek: 'success', orta: 'warning', dusuk: 'neutral', yok: 'neutral' };
const ONCELIK_TON = { kritik: 'danger', yuksek: 'warning', orta: 'info', dusuk: 'neutral' };

export const puanPill = (p) => (p === null || p === undefined ? html`<span class="muted">—</span>` : pill(`${sayi(Math.round(Number(p)))}`, PUAN_TON[puanSinifi(Number(p))]));

function durumPill(l) {
  if (l.archived_at) return pill('Arşivde', 'warning');
  if (l.converted_company_id) return pill('Firmaya dönüştü', 'success');
  return pill('Aday', 'info');
}

function takipHucre(l) {
  if (l.converted_company_id || l.archived_at) return html`<span class="muted">—</span>`;
  const d = takipDurumu(l.next_follow_up_date, bugun());
  if (d === 'yok') return html`<span class="muted">Planlanmadı</span>`;
  const ton = { gecikmis: 'danger', bugun: 'warning', yaklasan: 'neutral' }[d];
  return html`${pill(tarih(l.next_follow_up_date), ton)}${d === 'gecikmis' ? html` <small class="muted">gecikmiş</small>` : ''}`;
}

// ---------------------------------------------------------------- puan önizlemesi
function puanOnizleme(sonuc, dakika) {
  return html`<div class="score-box" aria-live="polite">
    <div class="score-top"><strong class="score-v">${sonuc.puan}</strong><span class="muted">/ ${sonuc.azami} puan</span>${sonuc.eksikVar ? pill('Veri eksik', 'warning') : ''}</div>
    <ul class="score-list">${sonuc.parcalar.map((p) => html`<li><span>${p.ad}${p.eksik ? html` <small class="muted">(girilmedi)</small>` : ''}</span><strong>${p.puan}<small>/${p.max}</small></strong></li>`)}</ul>
    ${dakika !== null ? html`<p class="fine">Tahmini hizmet süresi: <strong>${sayi(dakika)} dk/ay</strong> (uzman + hekim, teorik).</p>` : ''}
  </div>`;
}

// ---------------------------------------------------------------- form
export async function leadFormuAc(app, { lead = null, onDone = null } = {}) {
  const duzenle = lead !== null;
  let uyeler = [], kurallar = [], firmalar = [], adaylar = [];
  try {
    [uyeler, kurallar, firmalar, adaylar] = await Promise.all([
      app.api.listOrgMembers().catch(() => []),
      app.api.listServiceRules().catch(() => []),
      app.can('companies', 'view') ? app.api.listCompanies().catch(() => []) : [],
      app.api.listLeads().catch(() => []),
    ]);
  } catch { /* alt kontroller sunucuda da yapılır */ }
  const v = (k) => lead?.[k] ?? '';
  const uyeSec = [{ deger: '', etiket: 'Atanmamış' }].concat(
    uyeler.filter((u) => u.is_active || u.id === lead?.sales_owner).map((u) => ({ deger: u.id, etiket: u.is_active ? u.full_name : `${u.full_name} (pasif)` })));
  const tehlikeSec = [{ deger: '', etiket: 'Seçiniz' }].concat(TEHLIKE_SIRASI.map((k) => ({ deger: k, etiket: TEHLIKE[k] })));
  const kaynakSec = [{ deger: '', etiket: 'Seçiniz' }].concat(Object.entries(KAYNAKLAR).map(([deger, etiket]) => ({ deger, etiket })));

  let yeniId = null;
  const m = openFormModal({
    baslik: duzenle ? 'Potansiyel müşteriyi düzenle' : 'Yeni potansiyel müşteri', altBaslik: duzenle ? lead.name : 'Aday firmanın bilgilerini girin; puan otomatik hesaplanır',
    boyut: 'lg', gonderEtiketi: duzenle ? 'Değişiklikleri kaydet' : 'Potansiyel müşteriyi ekle',
    govde: html`
      ${field({ ad: 'name', etiket: 'Firma adı', zorunlu: true, tam: true, deger: v('name'), maksUzunluk: 200 })}
      ${field({ ad: 'tax_no', etiket: 'Vergi numarası', deger: v('tax_no'), inputmode: 'numeric', maksUzunluk: 30 })}
      ${field({ ad: 'sector', etiket: 'Sektör', deger: v('sector'), maksUzunluk: 100 })}
      ${field({ ad: 'employee_count', etiket: 'Çalışan sayısı', tur: 'number', min: 0, adim: 1, inputmode: 'numeric', deger: v('employee_count') })}
      ${field({ ad: 'hazard_class', etiket: 'Tehlike sınıfı', deger: v('hazard_class'), secenekler: tehlikeSec })}
      ${field({ ad: 'city', etiket: 'İl', deger: v('city'), maksUzunluk: 60 })}
      ${field({ ad: 'district', etiket: 'İlçe', deger: v('district'), maksUzunluk: 60 })}
      ${field({ ad: 'address', etiket: 'Adres', tam: true, deger: v('address'), maksUzunluk: 300 })}
      ${field({ ad: 'phone', etiket: 'Telefon', tur: 'tel', deger: v('phone'), maksUzunluk: 25 })}
      ${field({ ad: 'email', etiket: 'E-posta', tur: 'email', deger: v('email'), maksUzunluk: 120 })}
      ${field({ ad: 'website', etiket: 'Web sitesi', deger: v('website'), maksUzunluk: 200 })}
      ${field({ ad: 'current_provider', etiket: 'Mevcut OSGB', deger: v('current_provider'), maksUzunluk: 120 })}
      ${duzenle ? '' : html`${field({ ad: 'contact_name', etiket: 'Yetkili adı', deger: '', maksUzunluk: 120 })}
        ${field({ ad: 'contact_title', etiket: 'Yetkili unvanı', deger: '', maksUzunluk: 100 })}`}
      ${field({ ad: 'source', etiket: 'Kaynak', deger: v('source'), secenekler: kaynakSec })}
      ${field({ ad: 'est_monthly_revenue', etiket: 'Tahmini aylık gelir (TL)', tur: 'number', min: 0, adim: '0.01', inputmode: 'decimal', deger: v('est_monthly_revenue') })}
      ${field({ ad: 'sales_owner', etiket: 'Satış sorumlusu', deger: duzenle ? v('sales_owner') : app.ctx.user.id, secenekler: uyeSec })}
      ${field({ ad: 'priority', etiket: 'Öncelik', deger: lead?.priority ?? 'orta', secenekler: ONCELIK_SIRASI.map((k) => ({ deger: k, etiket: ONCELIKLER[k] })) })}
      ${field({ ad: 'next_follow_up_date', etiket: 'Sonraki takip tarihi', tur: 'date', deger: v('next_follow_up_date') })}
      ${field({ ad: 'notes', etiket: 'Notlar', tur: 'textarea', tam: true, deger: v('notes'), maksUzunluk: 2000 })}
      <div class="field field-full" id="puan-alani"></div>`,
    async onSubmit(fd) {
      const g = (k) => String(fd.get(k) ?? '').trim();
      const h = {};
      if (!g('name')) h.name = 'Firma adı zorunludur.';
      if (g('email') && !epostaGecerli(g('email'))) h.email = 'Geçerli bir e-posta adresi yazın.';
      if (g('phone') && !telefonGecerli(g('phone'))) h.phone = 'Telefon numarasında yalnızca rakam, boşluk, + ( ) - kullanın (en az 7 rakam).';
      if (g('website') && !webGecerli(g('website'))) h.website = 'Geçerli bir web adresi yazın.';
      if (g('employee_count') !== '' && !/^\d{1,7}$/.test(g('employee_count'))) h.employee_count = 'Çalışan sayısı 0 veya daha büyük bir tam sayı olmalıdır.';
      if (g('employee_count') !== '' && !g('hazard_class')) h.hazard_class = 'Çalışan sayısı girildiyse tehlike sınıfı da seçilmelidir.';
      if (g('est_monthly_revenue') !== '' && !(Number(g('est_monthly_revenue')) >= 0)) h.est_monthly_revenue = 'Tutar 0 veya daha büyük olmalıdır.';
      if (Object.keys(h).length) return { errors: h };

      const vergi = vergiNoNormalize(g('tax_no'));
      if (vergi) {
        const firma = firmalar.find((f) => !f.archived_at && f.tax_no && vergiNoNormalize(f.tax_no) === vergi);
        if (firma) return { errors: { tax_no: `Bu numara "${firma.name}" firmasında zaten müşteri olarak kayıtlı.` } };
        const diger = adaylar.find((l) => l.id !== lead?.id && !l.archived_at && l.tax_no && vergiNoNormalize(l.tax_no) === vergi);
        if (diger) return { errors: { tax_no: `Bu numara "${diger.name}" potansiyel müşterisinde kayıtlı.` } };
      }
      const ad = g('name').toLocaleLowerCase('tr-TR');
      const ayniAd = adaylar.find((l) => l.id !== lead?.id && !l.archived_at && l.name.toLocaleLowerCase('tr-TR') === ad);
      if (ayniAd && !(await confirmDialog({ baslik: 'Aynı adda potansiyel müşteri var', onayEtiketi: 'Yine de kaydet',
        mesaj: `"${ayniAd.name}" adında bir potansiyel müşteri zaten kayıtlı. Yine de kaydedilsin mi?` }))) return { kal: true };

      const say = g('employee_count') === '' ? null : Number(g('employee_count'));
      const gelir = g('est_monthly_revenue') === '' ? null : Number(g('est_monthly_revenue'));
      const puan = potansiyelPuani({ employee_count: say, hazard_class: g('hazard_class') || null, source: g('source') || null, est_monthly_revenue: gelir });
      let dakika = null;
      try { dakika = tahminiHizmetDakikasi({ calisan: say, tehlike: g('hazard_class') || null, kurallar, tarih: bugun() }); } catch { dakika = null; }
      const veri = {
        name: g('name'), tax_no: bosIseNull(vergi), sector: bosIseNull(g('sector')), hazard_class: bosIseNull(g('hazard_class')),
        employee_count: say, city: bosIseNull(g('city')), district: bosIseNull(g('district')), address: bosIseNull(g('address')),
        phone: bosIseNull(g('phone')), email: bosIseNull(g('email')), website: bosIseNull(g('website')),
        current_provider: bosIseNull(g('current_provider')), source: bosIseNull(g('source')), est_monthly_revenue: gelir,
        est_service_minutes: dakika, sales_owner: bosIseNull(g('sales_owner')), priority: g('priority') || 'orta',
        next_follow_up_date: bosIseNull(g('next_follow_up_date')), notes: bosIseNull(g('notes')),
        score: puan.puan, score_details: puan.parcalar,
      };
      if (duzenle) {
        await app.api.updateLead(lead.id, veri);
        toast('Potansiyel müşteri güncellendi.');
      } else {
        const yeni = await app.api.createLead({ ...veri, contact_name: bosIseNull(g('contact_name')), contact_title: bosIseNull(g('contact_title')) });
        yeniId = yeni.id;
        toast('Potansiyel müşteri eklendi.');
      }
    },
    onDone: () => (yeniId ? app.git(`crm/${yeniId}`) : (onDone ? onDone() : app.yenile())),
  });

  // Canlı puan önizlemesi
  const form = m.el.querySelector('form');
  const alan = form.querySelector('#puan-alani');
  const guncelle = () => {
    const g = (k) => String(form.elements[k]?.value ?? '').trim();
    const say = g('employee_count') === '' ? null : Number(g('employee_count'));
    const sonuc = potansiyelPuani({ employee_count: say, hazard_class: g('hazard_class') || null, source: g('source') || null, est_monthly_revenue: g('est_monthly_revenue') === '' ? null : Number(g('est_monthly_revenue')) });
    let dakika = null;
    try { dakika = tahminiHizmetDakikasi({ calisan: say, tehlike: g('hazard_class') || null, kurallar, tarih: bugun() }); } catch { dakika = null; }
    alan.innerHTML = puanOnizleme(sonuc, dakika).s;
  };
  form.addEventListener('input', guncelle);
  form.addEventListener('change', guncelle);
  guncelle();
}

// ---------------------------------------------------------------- liste
export async function crmSayfasi(app) {
  const [adaylar, uyeler] = await Promise.all([app.api.listLeads(), app.api.listOrgMembers().catch(() => [])]);
  const uyeAdi = new Map(uyeler.map((u) => [u.id, u.full_name]));
  const olusturabilir = app.can('crm', 'create');
  const durum = { filtre: 'acik', q: '', alan: 'puan', yon: -1, sayfa: 1 };
  const bugunStr = bugun();
  const acikMi = (l) => !l.archived_at && !l.converted_company_id;
  const sayilar = {
    acik: adaylar.filter(acikMi).length,
    gecikmis: adaylar.filter((l) => acikMi(l) && takipDurumu(l.next_follow_up_date, bugunStr) === 'gecikmis').length,
    donusen: adaylar.filter((l) => !l.archived_at && l.converted_company_id).length,
    arsiv: adaylar.filter((l) => l.archived_at).length,
  };
  const FILTRELER = [['acik', 'Açık adaylar'], ['gecikmis', 'Takibi gecikmiş'], ['donusen', 'Firmaya dönüşen'], ['arsiv', 'Arşivli']];
  const anahtar = {
    ad: (l) => l.name, puan: (l) => Number(l.score ?? -1), kaynak: (l) => KAYNAKLAR[l.source] ?? '', oncelik: (l) => ONCELIK_SIRASI.indexOf(l.priority),
    sahip: (l) => uyeAdi.get(l.sales_owner) ?? '', takip: (l) => l.next_follow_up_date ?? '9999-99-99',
  };
  const SUTUNLAR = [
    { id: 'ad', ad: 'Aday firma' }, { id: 'puan', ad: 'Puan' }, { id: 'kaynak', ad: 'Kaynak', sinif: 'hide-md' },
    { id: 'oncelik', ad: 'Öncelik' }, { id: 'sahip', ad: 'Sorumlu', sinif: 'hide-lg' }, { id: 'takip', ad: 'Sonraki takip' }, { id: 'durum', ad: 'Durum', sirasiz: true },
  ];

  function filtrele() {
    let l = adaylar.filter((x) => ({
      acik: acikMi(x), gecikmis: acikMi(x) && takipDurumu(x.next_follow_up_date, bugunStr) === 'gecikmis',
      donusen: !x.archived_at && !!x.converted_company_id, arsiv: !!x.archived_at,
    }[durum.filtre]));
    const q = durum.q.trim();
    if (q) l = l.filter((x) => [x.name, x.tax_no, x.sector, x.city, x.district, x.phone, x.email, x.contact_name].some((d) => d && icerir(d, q)));
    const k = anahtar[durum.alan];
    return l.sort((a, b) => {
      const x = k(a), y = k(b);
      const s = typeof x === 'number' ? x - y : trSirala(x, y);
      return (s || trSirala(a.name, b.name)) * durum.yon;
    });
  }

  const satir = (l) => html`<tr class="${l.archived_at ? 'row-muted' : ''}">
    <td><a class="cell-main" href="#/crm/${l.id}">${avatar(l.name)}<span><strong>${l.name}</strong><small>${[l.sector, l.city].filter(Boolean).join(' · ') || ' '}</small></span></a></td>
    <td>${puanPill(l.score)}</td>
    <td class="hide-md">${KAYNAKLAR[l.source] ?? html`<span class="muted">—</span>`}</td>
    <td>${pill(ONCELIKLER[l.priority] ?? l.priority, ONCELIK_TON[l.priority] ?? 'neutral')}</td>
    <td class="hide-lg">${uyeAdi.get(l.sales_owner) ?? html`<span class="muted">—</span>`}</td>
    <td>${takipHucre(l)}</td>
    <td>${durumPill(l)}</td></tr>`;

  function tablo() {
    if (!adaylar.length) {
      return emptyState({ simge: 'target', baslik: 'Henüz potansiyel müşteri yok',
        metin: 'Aday firmaları ekleyin; puan, takip tarihi ve satış fırsatı otomatik oluşur. Anlaşınca tek tıkla müşteri firmasına dönüştürürsünüz.',
        eylem: olusturabilir ? html`<button type="button" class="btn btn-primary" data-action="yeni-aday">${icon('plus', 18)} İlk adayı ekle</button>` : '' });
    }
    const liste = filtrele();
    if (!liste.length) return emptyState({ simge: 'search', baslik: 'Eşleşen aday yok', metin: 'Arama veya filtreyi değiştirmeyi deneyin.' });
    const sayfaSayisi = Math.max(1, Math.ceil(liste.length / SAYFA_BASI));
    durum.sayfa = Math.min(durum.sayfa, sayfaSayisi);
    const gorunen = liste.slice((durum.sayfa - 1) * SAYFA_BASI, durum.sayfa * SAYFA_BASI);
    return html`<div class="table-wrap"><table class="table"><thead><tr>${SUTUNLAR.map((s) => html`<th scope="col" class="${s.sinif ?? ''}" ${s.sirasiz ? '' : html`aria-sort="${durum.alan === s.id ? (durum.yon === 1 ? 'ascending' : 'descending') : 'none'}"`}>
      ${s.sirasiz ? s.ad : html`<button type="button" class="th-btn" data-sirala="${s.id}">${s.ad}${durum.alan === s.id ? icon('chevronD', 14, durum.yon === 1 ? '' : 'flip') : ''}</button>`}</th>`)}</tr></thead>
      <tbody>${gorunen.map(satir)}</tbody></table></div>
      ${sayfalama({ sayfa: durum.sayfa, sayfaSayisi, toplam: liste.length, sayfaBasi: SAYFA_BASI })}`;
  }
  const filtreHtml = () => html`${FILTRELER.map(([id, ad]) => html`<button type="button" class="chip ${durum.filtre === id ? 'chip-on' : ''}" data-filtre="${id}" aria-pressed="${durum.filtre === id}">${ad} <span class="chip-n">${sayilar[id]}</span></button>`)}`;

  return {
    baslik: 'CRM ve potansiyel müşteriler',
    altBaslik: 'Aday firmalar, puanları ve takip tarihleri',
    eylemler: olusturabilir ? html`<button type="button" class="btn btn-primary" data-action="yeni-aday">${icon('plus', 18)} Yeni aday</button>` : '',
    govde: html`<section class="card card-flush">
      <div class="toolbar">
        <div class="search-field">${icon('search', 18)}<input type="search" id="aday-ara" placeholder="Firma, vergi no, yetkili, il veya sektör ara" aria-label="Potansiyel müşterilerde ara" autocomplete="off"></div>
        <div class="chips" id="aday-filtre" role="group" aria-label="Aday filtresi">${filtreHtml()}</div>
      </div><div id="aday-tablo">${tablo()}</div></section>`,
    mount(kok) {
      const tabloEl = kok.querySelector('#aday-tablo');
      const yenile = () => { tabloEl.innerHTML = tablo().s; };
      kok.querySelector('#aday-ara').addEventListener('input', (e) => { durum.q = e.target.value; durum.sayfa = 1; yenile(); });
      kok.querySelector('#aday-filtre').addEventListener('click', (e) => {
        const d = e.target.closest('[data-filtre]'); if (!d) return;
        durum.filtre = d.dataset.filtre; durum.sayfa = 1;
        kok.querySelector('#aday-filtre').innerHTML = filtreHtml().s; yenile();
      });
      kok.addEventListener('click', (e) => {
        if (e.target.closest('[data-action="yeni-aday"]')) { leadFormuAc(app); return; }
        const s = e.target.closest('[data-sirala]');
        if (s) {
          const id = s.dataset.sirala;
          if (durum.alan === id) durum.yon *= -1; else { durum.alan = id; durum.yon = id === 'puan' ? -1 : 1; }
          yenile(); tabloEl.querySelector(`[data-sirala="${id}"]`)?.focus(); return;
        }
        const sf = e.target.closest('[data-sayfa]');
        if (sf && !sf.disabled) { durum.sayfa = Number(sf.dataset.sayfa); yenile(); }
      });
    },
  };
}

// ---------------------------------------------------------------- aday kartı
const SEKMELER = [
  { id: 'genel', ad: 'Genel bilgiler' }, { id: 'gorusmeler', ad: 'Görüşmeler' }, { id: 'kisiler', ad: 'Kişiler' },
  { id: 'firsatlar', ad: 'Fırsatlar' }, { id: 'teklifler', ad: 'Teklifler' }, { id: 'gorevler', ad: 'Görevler' },
];
const bilgi = (e, d) => html`<div class="kv"><dt>${e}</dt><dd>${d || html`<span class="muted">—</span>`}</dd></div>`;

const sonSekme = new Map();   // yenilemeden sonra aynı sekmede kalmak için

export async function leadSayfasi(app, id) {
  const [lead, uyeler] = await Promise.all([app.api.getLead(id), app.api.listOrgMembers().catch(() => [])]);
  if (!lead) {
    return { baslik: 'Potansiyel müşteri bulunamadı', altBaslik: '', eylemler: html`<a class="btn btn-secondary" href="#/crm">${icon('arrowL', 18)} Listeye dön</a>`,
      govde: emptyState({ simge: 'target', baslik: 'Bu kayıt yok ya da erişim izniniz yok' }) };
  }
  const [gorusmeler, kisiler, firsatlar, gorevler, tumTeklifler] = await Promise.all([
    app.can('contacts', 'view') ? app.api.listActivitiesByLead(id) : [],
    app.can('contacts', 'view') ? app.api.listContactsByLead(id) : [],
    app.can('opportunities', 'view') ? app.api.listOpportunities() : [],
    app.can('tasks', 'view') ? app.api.listTasks() : [],
    app.can('offers', 'view') ? app.api.listOffers() : [],
  ]);
  const uyeAdi = new Map(uyeler.map((u) => [u.id, u.full_name]));
  const kisiAdi = new Map(kisiler.map((k) => [k.id, k.full_name]));
  const benimFirsatlar = firsatlar.filter((f) => f.lead_id === id && !f.archived_at);
  const benimGorevler = gorevler.filter((g) => g.lead_id === id && !g.archived_at);
  const durum = { sekme: sonSekme.get(id) ?? 'genel' };
  const donustu = !!lead.converted_company_id;
  const duzenleyebilir = app.can('crm', 'edit') && !lead.archived_at;
  const arsivleyebilir = app.can('crm', 'archive');
  const web = safeUrl(lead.website);
  const puan = potansiyelPuani(lead);
  const detay = Array.isArray(lead.score_details) ? lead.score_details : null;

  const genel = () => html`<div class="grid-2">
    <section class="card"><h2 class="card-title">Firma bilgileri</h2><dl class="kv-list">
      ${bilgi('Vergi no', lead.tax_no)}${bilgi('Sektör', lead.sector)}
      ${bilgi('Çalışan / tehlike', lead.employee_count === null ? '' : html`${sayi(lead.employee_count)} · ${tehlikePill(lead.hazard_class)}`)}
      ${bilgi('Konum', [lead.city, lead.district].filter(Boolean).join(' / '))}${bilgi('Adres', lead.address)}${bilgi('Mevcut OSGB', lead.current_provider)}
    </dl></section>
    <section class="card"><h2 class="card-title">Satış bilgileri</h2><dl class="kv-list">
      ${bilgi('Kaynak', KAYNAKLAR[lead.source])}${bilgi('Öncelik', pill(ONCELIKLER[lead.priority] ?? lead.priority, ONCELIK_TON[lead.priority] ?? 'neutral'))}
      ${bilgi('Sorumlu', uyeAdi.get(lead.sales_owner))}${bilgi('Tahmini aylık gelir', lead.est_monthly_revenue === null ? '' : para(lead.est_monthly_revenue))}
      ${bilgi('Tahmini hizmet süresi', lead.est_service_minutes === null ? '' : `${sayi(lead.est_service_minutes)} dk/ay`)}
      ${bilgi('Son temas', lead.last_contact_date ? tarih(lead.last_contact_date) : '')}${bilgi('Sonraki takip', takipHucre(lead))}
    </dl></section>
    <section class="card"><h2 class="card-title">İletişim</h2><dl class="kv-list">
      ${bilgi('Telefon', lead.phone ? (telHref(lead.phone) ? html`<a class="link" href="${telHref(lead.phone)}">${lead.phone}</a>` : lead.phone) : '')}
      ${bilgi('E-posta', lead.email ? (mailHref(lead.email) ? html`<a class="link" href="${mailHref(lead.email)}">${lead.email}</a>` : lead.email) : '')}
      ${bilgi('Web sitesi', lead.website ? (web ? html`<a class="link" href="${web}" target="_blank" rel="noopener noreferrer">${lead.website}</a>` : lead.website) : '')}
    </dl></section>
    <section class="card"><h2 class="card-title">Puan: ${lead.score === null ? '—' : sayi(Math.round(Number(lead.score)))} / 100</h2>
      <ul class="score-list">${(detay ?? puan.parcalar).map((p) => html`<li><span>${p.ad}${p.eksik ? html` <small class="muted">(girilmedi)</small>` : ''}</span><strong>${p.puan}<small>/${p.max}</small></strong></li>`)}</ul>
      <p class="fine">Puan; firma büyüklüğü, tehlike sınıfı, kaynak ve tahmini gelirden oluşur. Girilmeyen bilgi 0 puan sayılır.</p></section>
    ${lead.notes ? html`<section class="card grid-full"><h2 class="card-title">Notlar</h2><p class="prewrap">${lead.notes}</p></section>` : ''}</div>`;

  const gorusmeSekmesi = () => {
    const ekle = app.can('contacts', 'create');
    return html`<section class="card"><div class="card-head"><h2 class="card-title">Görüşme geçmişi</h2>
      ${ekle ? html`<button type="button" class="btn btn-secondary btn-sm" data-action="gorusme-ekle">${icon('plus', 16)} Görüşme / not ekle</button>` : ''}</div>
      ${zamanCizelgesi(app, gorusmeler, { kisiAdi, kullaniciAdi: uyeAdi })}</section>`;
  };

  const kisiSekmesi = () => {
    const ekle = app.can('contacts', 'create');
    const satir = (k) => html`<tr class="${k.archived_at ? 'row-muted' : ''}"><td><span class="cell-main">${avatar(k.full_name)}<span><strong>${k.full_name}</strong>${k.is_decision_maker ? html`<small class="tag-ok">Karar verici</small>` : ''}</span></span></td>
      <td class="hide-sm">${k.title || html`<span class="muted">—</span>`}</td><td>${telHucre(k.phone)}</td><td class="hide-md">${epostaHucre(k.email)}</td><td class="actions">${kisiEylemDugmeleri(app, k)}</td></tr>`;
    return html`<section class="card card-flush"><div class="card-head"><h2 class="card-title">Kişiler</h2>
      ${ekle && !donustu ? html`<button type="button" class="btn btn-secondary btn-sm" data-action="kisi-ekle">${icon('plus', 16)} Kişi ekle</button>` : ''}</div>
      ${kisiler.length ? html`<div class="table-wrap"><table class="table"><thead><tr><th scope="col">Kişi</th><th scope="col" class="hide-sm">Unvan</th><th scope="col">Telefon</th><th scope="col" class="hide-md">E-posta</th><th scope="col"><span class="sr-only">Eylemler</span></th></tr></thead>
        <tbody>${kisiler.map(satir)}</tbody></table></div>` : emptyState({ simge: 'contact', baslik: 'Bu adayda kişi yok' })}</section>`;
  };

  const firsatSekmesi = () => html`<section class="card card-flush"><div class="card-head"><h2 class="card-title">Satış fırsatları</h2>
    ${app.can('opportunities', 'create') && !donustu ? html`<button type="button" class="btn btn-secondary btn-sm" data-action="firsat-ekle">${icon('plus', 16)} Fırsat ekle</button>` : ''}</div>
    ${benimFirsatlar.length ? html`<div class="table-wrap"><table class="table"><thead><tr><th scope="col">Fırsat</th><th scope="col">Aşama</th><th scope="col">Beklenen gelir</th></tr></thead>
      <tbody>${benimFirsatlar.map((f) => html`<tr><td><strong>${f.title}</strong></td><td>${asamaPill(f.stage)}</td><td>${para(f.expected_monthly)}<small class="muted">/ay</small></td></tr>`)}</tbody></table></div>
      <p class="fine pad">Aşamayı değiştirmek için <a class="link" href="#/firsatlar">Satış fırsatları</a> panosunu kullanın.</p>`
    : emptyState({ simge: 'kanban', baslik: 'Bu aday için fırsat yok' })}</section>`;

  const benimTeklifler = tumTeklifler.filter((o) => o.lead_id === id);
  const teklifSekmesi = () => html`<section class="card card-flush"><div class="card-head"><h2 class="card-title">Teklifler</h2>
    ${app.can('offers', 'create') && !donustu ? html`<button type="button" class="btn btn-secondary btn-sm" data-action="teklif-yeni">${icon('plus', 16)} Yeni teklif</button>` : ''}</div>
    ${firmaTeklifleri(app, benimTeklifler, teklifPill)}
    ${donustu ? html`<p class="fine pad">Aday firmaya dönüştüğünde teklifler firma kartına taşınır.</p>` : ''}</section>`;

  const gorevSekmesi = () => html`<section class="card card-flush"><div class="card-head"><h2 class="card-title">Görevler</h2>
    ${app.can('tasks', 'create') ? html`<button type="button" class="btn btn-secondary btn-sm" data-action="gorev-ekle">${icon('plus', 16)} Görev ekle</button>` : ''}</div>
    ${benimGorevler.length ? html`<div class="table-wrap"><table class="table"><thead><tr><th scope="col">Görev</th><th scope="col">Durum</th><th scope="col">Vade</th></tr></thead>
      <tbody>${benimGorevler.map((g) => html`<tr><td><strong>${g.title}</strong></td><td>${GOREV_DURUMLARI[g.status] ?? g.status}</td><td>${g.due_at ? tarih(String(g.due_at).slice(0, 10)) : html`<span class="muted">—</span>`}</td></tr>`)}</tbody></table></div>
      <p class="fine pad">Görevi tamamlamak için <a class="link" href="#/gorevler">Görevler</a> sayfasını kullanın.</p>`
    : emptyState({ simge: 'checksq', baslik: 'Bu aday için görev yok' })}</section>`;

  const sekmeGovdesi = () => ({ genel, gorusmeler: gorusmeSekmesi, kisiler: kisiSekmesi, firsatlar: firsatSekmesi, teklifler: teklifSekmesi, gorevler: gorevSekmesi }[durum.sekme])();
  const sayac = { gorusmeler: gorusmeler.length, kisiler: kisiler.filter((k) => !k.archived_at).length, firsatlar: benimFirsatlar.length, teklifler: benimTeklifler.filter((o) => !o.archived_at).length, gorevler: benimGorevler.length };
  const sekmeCubugu = () => html`<div class="tabs" role="tablist" aria-label="Potansiyel müşteri bölümleri">${SEKMELER.map((s) => html`<button type="button" role="tab" class="tab ${durum.sekme === s.id ? 'tab-on' : ''}" aria-selected="${durum.sekme === s.id}" data-sekme="${s.id}">${s.ad}${sayac[s.id] ? html` <span class="chip-n">${sayac[s.id]}</span>` : ''}</button>`)}</div>`;

  async function donustur() {
    if (!(await confirmDialog({ baslik: 'Firmaya dönüştür', onayEtiketi: 'Firmaya dönüştür',
      mesaj: `"${lead.name}" müşteri firması olarak kaydedilecek. Kişiler, görüşmeler, fırsatlar ve görevler firmaya taşınır; açık fırsatlar "kazanıldı" olur. Devam edilsin mi?` }))) return;
    try { const f = await app.api.convertLead(lead.id); toast('Firma oluşturuldu.'); app.aramaOnbellegiTemizle(); app.git(`firmalar/${f.id}`); }
    catch (e) { toast(humanError(e), 'hata'); }
  }
  async function arsivle() {
    if (lead.archived_at) {
      try { await app.api.unarchiveLead(lead.id); toast('Arşivden çıkarıldı.'); app.aramaOnbellegiTemizle(); app.yenile(); } catch (e) { toast(humanError(e), 'hata'); }
      return;
    }
    if (!(await confirmDialog({ baslik: 'Potansiyel müşteriyi arşivle', onayEtiketi: 'Arşivle', tehlikeli: true, mesaj: `"${lead.name}" arşive alınacak. Kayıt silinmez; "Arşivli" filtresinden geri alınabilir.` }))) return;
    try { await app.api.archiveLead(lead.id); toast('Arşive alındı.'); app.aramaOnbellegiTemizle(); app.yenile(); } catch (e) { toast(humanError(e), 'hata'); }
  }

  return {
    baslik: lead.name, altBaslik: [lead.sector, [lead.city, lead.district].filter(Boolean).join(' / ')].filter(Boolean).join(' · '),
    geri: { href: '#/crm', ad: 'Potansiyel müşteriler' },
    ozelBaslik: html`<div class="company-head">${avatar(lead.name, 'lg')}<div><h1>${lead.name}</h1>
      <div class="company-meta">${durumPill(lead)} ${puanPill(lead.score)} ${pill(ONCELIKLER[lead.priority] ?? lead.priority, ONCELIK_TON[lead.priority] ?? 'neutral')}
      ${donustu ? html`<a class="link" href="#/firmalar/${lead.converted_company_id}">Firma kartına git</a>` : ''}</div></div></div>`,
    eylemler: html`${duzenleyebilir ? html`<button type="button" class="btn btn-secondary" data-action="duzenle">${icon('pencil', 18)} Düzenle</button>` : ''}
      ${duzenleyebilir && !donustu && app.can('companies', 'create') ? html`<button type="button" class="btn btn-primary" data-action="donustur">${icon('check', 18)} Firmaya dönüştür</button>` : ''}
      ${arsivleyebilir ? html`<button type="button" class="btn btn-secondary" data-action="arsiv">${icon(lead.archived_at ? 'restore' : 'archive', 18)} ${lead.archived_at ? 'Arşivden çıkar' : 'Arşivle'}</button>` : ''}`,
    govde: html`${lead.archived_at ? html`<div class="notice notice-warn" role="status">Bu kayıt arşivde. Düzenlemek için önce arşivden çıkarın.</div>` : ''}
      ${donustu ? html`<div class="notice notice-ok" role="status">Bu aday müşteri firmasına dönüştürüldü. Güncel bilgiler firma kartında tutulur.</div>` : ''}
      <div id="sekme-cubugu">${sekmeCubugu()}</div><div id="sekme-govde" role="tabpanel">${sekmeGovdesi()}</div>`,
    mount(kok) {
      const ciz = () => { kok.querySelector('#sekme-cubugu').innerHTML = sekmeCubugu().s; kok.querySelector('#sekme-govde').innerHTML = sekmeGovdesi().s; };
      kok.addEventListener('click', async (e) => {
        const t = e.target.closest('[data-sekme]');
        if (t) { durum.sekme = t.dataset.sekme; sonSekme.set(id, durum.sekme); ciz(); kok.querySelector(`[data-sekme="${durum.sekme}"]`)?.focus(); return; }
        const a = e.target.closest('[data-action]');
        if (a) {
          const x = a.dataset.action;
          if (x === 'duzenle') leadFormuAc(app, { lead });
          else if (x === 'donustur') await donustur();
          else if (x === 'arsiv') await arsivle();
          else if (x === 'gorusme-ekle') gorusmeFormuAc(app, { leadId: lead.id, kisiler });
          else if (x === 'kisi-ekle') kisiFormuAc(app, { leadId: lead.id });
          else if (x === 'firsat-ekle') firsatFormuAc(app, { leadId: lead.id });
          else if (x === 'teklif-yeni') teklifFormuAc(app, { leadId: lead.id });
          else if (x === 'gorev-ekle') gorevFormuAc(app, { leadId: lead.id });
          return;
        }
        const g = e.target.closest('[data-gorusme-eylem]');
        if (g) {
          const k = gorusmeler.find((x) => x.id === g.dataset.id); if (!k) return;
          if (g.dataset.gorusmeEylem === 'duzenle') gorusmeFormuAc(app, { kayit: k, leadId: lead.id, kisiler });
          else if (await gorusmeArsivle(app, k)) app.yenile();
          return;
        }
        const d = e.target.closest('[data-kisi-eylem]');
        if (!d) return;
        const k = kisiler.find((x) => x.id === d.dataset.id); if (!k) return;
        if (d.dataset.kisiEylem === 'duzenle') kisiFormuAc(app, { kisi: k });
        if (d.dataset.kisiEylem === 'arsivle' && await kisiArsivle(app, k)) app.yenile();
        if (d.dataset.kisiEylem === 'geri' && await kisiArsivdenCikar(app, k)) app.yenile();
      });
    },
  };
}
export { raw };
