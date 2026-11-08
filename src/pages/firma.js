// OSGB 360 - Firma kartı: genel bilgiler, kişiler, çalışan sayısı geçmişi ve teorik hizmet süresi.
import {
  html, raw, bugun, ayBasi, tarih, ayAdi, sayi, ondalik, dakikaSaat, safeUrl, telHref, mailHref, TEHLIKE, TEHLIKE_SIRASI, gunEkle,
} from '../lib/format.js';
import { icon } from '../ui/icons.js';
import {
  avatar, pill, emptyState, field, checkbox, openFormModal, confirmDialog, toast,
} from '../ui/components.js';
import { firmaAylikIhtiyac, kapasiteKullanimi } from '../lib/hesaplama.js';
import { guncelProfil, kapasiteDakika, bosIseNull } from '../lib/veri.js';
import { humanError } from '../lib/api.js';
import { TEHLIKE_ADI } from '../lib/aktarim.js';
import { tehlikePill, durumPill, firmaFormuAc } from './firmalar.js';
import { kisiFormuAc, kisiArsivle, kisiArsivdenCikar, kisiEylemDugmeleri, telHucre, epostaHucre } from './kisiler.js';
import { MENU } from '../modules.js';
import { gorusmeFormuAc, zamanCizelgesi, gorusmeArsivle } from './gorusmeler.js';
import { firsatFormuAc, asamaPill } from './firsatlar.js';
import { teklifFormuAc, teklifPill } from './teklifler.js';
import { sozlesmeFormuAc, firmaTeklifleri, firmaSozlesmeleri, imzaliSozlesmeFormuAc, firmaImzaliSozlesmeler, imzaliSozlesmeAc, imzaliSozlesmeArsivle } from './sozlesmeler.js';
import { gorevFormuAc } from './gorevler.js';
import { gorevlendirmeFormuAc, gorevlendirmeDurumu, gorevlendirmeEylemleri, gorevlendirmeEylemiYurut } from './gorevlendirmeler.js';
import { PERSONEL_TURU, aktifMi, kapsamPayi, sureMetni } from '../lib/operasyon.js';
import { para } from '../lib/format.js';
import { faturaFormuAc, faturaDetayAc, firmaFaturalari, firmaTahsilatFormuAc } from './faturalar.js';

const SEKMELER = [
  { id: 'genel', ad: 'Genel bilgiler' },
  { id: 'gorusmeler', ad: 'Görüşmeler' },
  { id: 'kisiler', ad: 'Kişiler' },
  { id: 'calisan', ad: 'Çalışan sayısı' },
  { id: 'firsatlar', ad: 'Fırsatlar' },
  { id: 'teklifler', ad: 'Teklifler' },
  { id: 'sozlesmeler', ad: 'Sözleşmeler' },
  { id: 'atamalar', ad: 'Görevlendirme' },
  { id: 'faturalar', ad: 'Faturalar' },
  { id: 'isyerleri', ad: 'İşyerleri' },
];

const bilgi = (etiket, deger) => html`<div class="kv"><dt>${etiket}</dt><dd>${deger || html`<span class="muted">—</span>`}</dd></div>`;

// Sayfa yenilense de (kayıt sonrası) aynı firmada açık sekme korunur.
const hatirla = { id: null, sekme: 'genel' };

export async function firmaSayfasi(app, id) {
  const [firma, profiller, kisiler, kurallar, ayarlar, uyeler, gorusmeler, tumFirsatlar, tumTeklifler, tumSozlesmeler, tumAtamalar, personelListesi, tumFaturalar, tumTahsilatlar, tumImzalilar] = await Promise.all([
    app.api.getCompany(id),
    app.api.listProfiles(id),
    app.can('contacts', 'view') ? app.api.listContactsByCompany(id) : Promise.resolve([]),
    app.api.listServiceRules(),
    app.api.listSettings(),
    app.api.listOrgMembers().catch(() => []),
    app.can('contacts', 'view') ? app.api.listActivitiesByCompany(id) : Promise.resolve([]),
    app.can('opportunities', 'view') ? app.api.listOpportunities() : Promise.resolve([]),
    app.can('offers', 'view') ? app.api.listOffers() : Promise.resolve([]),
    app.can('contracts', 'view') ? app.api.listContracts() : Promise.resolve([]),
    app.can('assignments', 'view') ? app.api.listAssignments() : Promise.resolve([]),
    app.can('assignments', 'view') ? app.api.listStaff().catch(() => []) : Promise.resolve([]),
    app.can('invoices', 'view') ? app.api.listInvoices() : Promise.resolve([]),
    app.can('invoices', 'view') ? app.api.listPayments() : Promise.resolve([]),
    app.can('contracts', 'view') ? app.api.listSignedContracts().catch(() => []) : Promise.resolve([]),   // SQL (33_asama32) çalıştırılmadıysa boş
  ]);
  const tumFirmalar = firma ? ((await app.api.listCompanies().catch(() => [])) ?? []) : [];
  const anaFirma = firma?.parent_company_id ? tumFirmalar.find((c) => c.id === firma.parent_company_id) : null;
  const bagliFirmalar = firma ? tumFirmalar.filter((c) => c.parent_company_id === firma.id && !c.archived_at) : [];
  const tumSiteler = firma ? await app.api.listSites().catch(() => null) : null;
  const siteler = tumSiteler ? tumSiteler.filter((x) => x.company_id === id && !x.archived_at).sort((a, b) => a.site_name.localeCompare(b.site_name, 'tr')) : null;
  if (!firma) {
    return {
      baslik: 'Firma bulunamadı', altBaslik: '',
      eylemler: html`<a class="btn btn-secondary" href="#/firmalar">${icon('arrowL', 18)} Firmalara dön</a>`,
      govde: emptyState({ simge: 'building', baslik: 'Bu firma yok ya da erişim izniniz yok', metin: 'Bağlantı eski olabilir veya firma silinmiş olabilir.' }),
    };
  }

  const uyeAdi = new Map(uyeler.map((u) => [u.id, u.full_name]));
  const durum = { sekme: hatirla.id === id ? hatirla.sekme : 'genel', ay: ayBasi(bugun()) };
  const duzenleyebilir = app.can('companies', 'edit');
  const arsivleyebilir = app.can('companies', 'archive');
  const silebilir = ['isletme_sahibi', 'sistem_yoneticisi'].includes(app.ctx?.role?.key);
  const profilEkleyebilir = app.can('companies', 'edit');
  const kisiEkleyebilir = app.can('contacts', 'create');
  const guncel = guncelProfil(profiller, bugun());
  const firsatlar = tumFirsatlar.filter((f) => f.company_id === id && !f.archived_at);
  const kisiAdi = new Map(kisiler.map((k) => [k.id, k.full_name]));
  const web = safeUrl(firma.website);

  // ---------------------------------------------------------------- sekmeler
  const genel = () => html`<div class="grid-2">
    <section class="card"><h2 class="card-title">Firma bilgileri</h2><dl class="kv-list">
      ${bilgi('Vergi no / tanımlayıcı', firma.tax_no)}
      ${bilgi('Vergi dairesi', firma.tax_office)}
      ${bilgi('Sektör', firma.sector)}
      ${bilgi('Konum', [firma.city, firma.district].filter(Boolean).join(' / '))}
      ${bilgi('Adres', firma.address)}
      ${bilgi('Mevcut OSGB', firma.current_provider)}
      ${bilgi('Sorumlu kullanıcı', uyeAdi.get(firma.responsible_user))}
    </dl></section>
    <section class="card"><h2 class="card-title">İletişim</h2><dl class="kv-list">
      ${bilgi('Telefon', firma.phone ? (telHref(firma.phone) ? html`<a class="link" href="${telHref(firma.phone)}">${firma.phone}</a>` : firma.phone) : '')}
      ${bilgi('E-posta', firma.email ? (mailHref(firma.email) ? html`<a class="link" href="${mailHref(firma.email)}">${firma.email}</a>` : firma.email) : '')}
      ${bilgi('Web sitesi', firma.website ? (web ? html`<a class="link" href="${web}" target="_blank" rel="noopener noreferrer">${firma.website}</a>` : firma.website) : '')}
      ${bilgi('Kayıt tarihi', tarih(String(firma.created_at ?? '').slice(0, 10)))}
    </dl></section>
    ${firma.notes ? html`<section class="card grid-full"><h2 class="card-title">Notlar</h2><p class="prewrap">${firma.notes}</p></section>` : ''}
    ${teorikKart()}
  </div>`;

  const kisilerSekmesi = () => {
    if (!app.can('contacts', 'view')) return emptyState({ simge: 'lock', baslik: 'Kişileri görme izniniz yok' });
    const aktif = kisiler.filter((k) => !k.archived_at);
    const arsiv = kisiler.filter((k) => k.archived_at);
    if (!kisiler.length) {
      return emptyState({
        simge: 'contact', baslik: 'Bu firmada kişi yok', metin: 'Firma yetkilisini veya iletişim kişisini ekleyin.',
        eylem: kisiEkleyebilir ? html`<button type="button" class="btn btn-primary" data-action="kisi-ekle">${icon('plus', 18)} Kişi ekle</button>` : '',
      });
    }
    const satir = (k) => html`<tr class="${k.archived_at ? 'row-muted' : ''}">
      <td><span class="cell-main">${avatar(k.full_name)}<span><strong>${k.full_name}</strong>${k.is_decision_maker ? html`<small class="tag-ok">Karar verici</small>` : ''}</span></span></td>
      <td class="hide-sm">${k.title || html`<span class="muted">—</span>`}</td>
      <td>${telHucre(k.phone)}</td><td class="hide-md">${epostaHucre(k.email)}</td>
      <td class="actions">${kisiEylemDugmeleri(app, k)}</td></tr>`;
    return html`<section class="card card-flush">
      <div class="card-head"><h2 class="card-title">Kişiler <span class="chip-n">${aktif.length}</span></h2>
        ${kisiEkleyebilir ? html`<button type="button" class="btn btn-secondary btn-sm" data-action="kisi-ekle">${icon('plus', 16)} Kişi ekle</button>` : ''}</div>
      <div class="table-wrap"><table class="table"><thead><tr><th scope="col">Kişi</th><th scope="col" class="hide-sm">Unvan</th><th scope="col">Telefon</th><th scope="col" class="hide-md">E-posta</th><th scope="col"><span class="sr-only">Eylemler</span></th></tr></thead>
      <tbody>${aktif.map(satir)}${arsiv.map(satir)}</tbody></table></div></section>`;
  };

  const calisanSekmesi = () => {
    const satir = (p) => {
      const simdi = !p.valid_to || p.valid_to >= bugun();
      return html`<tr>
        <td>${tarih(p.valid_from)}</td><td>${p.valid_to ? tarih(p.valid_to) : html`<span class="muted">Devam ediyor</span>`}</td>
        <td class="num">${sayi(p.employee_count)}</td><td>${tehlikePill(p.hazard_class)}</td>
        <td class="hide-sm">${p.note || html`<span class="muted">—</span>`}</td>
        <td>${simdi && p.valid_from <= bugun() ? pill('Güncel', 'success') : ''}</td></tr>`;
    };
    return html`<section class="card card-flush">
      <div class="card-head"><div><h2 class="card-title">Çalışan sayısı ve tehlike sınıfı geçmişi</h2>
        <p class="card-sub">Her dönem kendi tarihinde geçerlidir; geçmiş aylar sonradan değişen sayılardan etkilenmez.</p></div>
        ${profilEkleyebilir ? html`<button type="button" class="btn btn-secondary btn-sm" data-action="profil-ekle">${icon('plus', 16)} Yeni dönem ekle</button>` : ''}</div>
      ${profiller.length ? html`<div class="table-wrap"><table class="table"><thead><tr>
        <th scope="col">Başlangıç</th><th scope="col">Bitiş</th><th scope="col" class="num">Çalışan</th><th scope="col">Tehlike sınıfı</th><th scope="col" class="hide-sm">Not</th><th scope="col"><span class="sr-only">Durum</span></th></tr></thead>
        <tbody>${profiller.map(satir)}</tbody></table></div>`
        : emptyState({ simge: 'users', baslik: 'Henüz çalışan sayısı girilmedi', metin: 'Teorik hizmet süresi hesaplanabilmesi için çalışan sayısı ve tehlike sınıfı gerekir.',
          eylem: profilEkleyebilir ? html`<button type="button" class="btn btn-primary" data-action="profil-ekle">${icon('plus', 18)} İlk dönemi ekle</button>` : '' })}
    </section>${profiller.length ? teorikKart() : ''}`;
  };

  const gorusmeSekmesi = () => html`<section class="card"><div class="card-head"><h2 class="card-title">Görüşme geçmişi</h2>
    ${app.can('contacts', 'create') ? html`<button type="button" class="btn btn-secondary btn-sm" data-action="gorusme-ekle">${icon('plus', 16)} Görüşme / not ekle</button>` : ''}
    ${app.can('tasks', 'create') ? html`<button type="button" class="btn btn-secondary btn-sm" data-action="gorev-ekle">${icon('plus', 16)} Görev ekle</button>` : ''}</div>
    ${app.can('contacts', 'view') ? zamanCizelgesi(app, gorusmeler, { kisiAdi, kullaniciAdi: uyeAdi }) : emptyState({ simge: 'lock', baslik: 'Görüşmeleri görme izniniz yok' })}</section>`;

  const firsatSekmesi = () => html`<section class="card card-flush"><div class="card-head"><h2 class="card-title">Satış fırsatları</h2>
    ${app.can('opportunities', 'create') && !firma.archived_at ? html`<button type="button" class="btn btn-secondary btn-sm" data-action="firsat-ekle">${icon('plus', 16)} Fırsat ekle</button>` : ''}</div>
    ${firsatlar.length ? html`<div class="table-wrap"><table class="table"><thead><tr><th scope="col">Fırsat</th><th scope="col">Aşama</th><th scope="col">Beklenen gelir</th></tr></thead>
      <tbody>${firsatlar.map((f) => html`<tr><td><strong>${f.title}</strong></td><td>${asamaPill(f.stage)}</td><td>${para(f.expected_monthly)}<small class="muted">/ay</small></td></tr>`)}</tbody></table></div>
      <p class="fine pad">Aşamayı değiştirmek için <a class="link" href="#/firsatlar">Satış fırsatları</a> panosunu kullanın.</p>`
    : emptyState({ simge: 'kanban', baslik: 'Bu firma için fırsat yok', metin: 'Mevcut müşteriye ek hizmet satışı için fırsat açabilirsiniz.' })}</section>`;

  const teklifSekmesi = () => html`<section class="card card-flush"><div class="card-head"><h2 class="card-title">Teklifler</h2>
    ${app.can('offers', 'create') && !firma.archived_at ? html`<button type="button" class="btn btn-secondary btn-sm" data-action="teklif-yeni">${icon('plus', 16)} Yeni teklif</button>` : ''}</div>
    ${firmaTeklifleri(app, tumTeklifler.filter((o) => o.company_id === id), teklifPill)}</section>`;
  const sozlesmeSekmesi = () => html`<section class="card card-flush"><div class="card-head"><h2 class="card-title">Sözleşmeler</h2>
    ${app.can('contracts', 'create') && !firma.archived_at ? html`<button type="button" class="btn btn-secondary btn-sm" data-action="sozlesme-yeni">${icon('plus', 16)} Sözleşme ekle</button>` : ''}</div>
    ${firmaSozlesmeleri(app, tumSozlesmeler.filter((c) => c.company_id === id))}</section>
    <section class="card card-flush"><div class="card-head"><h2 class="card-title">İmzalı sözleşmeler</h2>
    ${app.can('contracts', 'create') && !firma.archived_at ? html`<button type="button" class="btn btn-primary btn-sm" data-action="imzali-yeni">${icon('upload', 16)} İmzalı sözleşme kaydet</button>` : ''}</div>
    ${firmaImzaliSozlesmeler(app, tumImzalilar.filter((d) => d.company_id === id), tumSozlesmeler.filter((c) => c.company_id === id))}</section>`;

  const firmaFaturalariListesi = tumFaturalar.filter((f) => f.company_id === id);
  const faturaSekmesi = () => {
    const l = firmaFaturalariListesi.map((f) => f.id);
    return html`<section class="card card-flush"><div class="card-head"><h2 class="card-title">Faturalar ve tahsilatlar</h2>
      <div class="btn-row">${app.can('invoices', 'create') && !firma.archived_at ? html`<button type="button" class="btn btn-primary btn-sm" data-action="firma-tahsilat">${icon('wallet', 16)} Tahsilat gir</button> <button type="button" class="btn btn-secondary btn-sm" data-action="fatura-yeni">${icon('plus', 16)} Fatura ekle</button>` : ''}</div></div>
      ${firmaFaturalari(app, firmaFaturalariListesi, tumTahsilatlar.filter((p) => l.includes(p.invoice_id)))}</section>`;
  };

  const personelAdi = new Map(personelListesi.map((p) => [p.id, p.full_name]));
  const firmaAtamalari = tumAtamalar.filter((a) => a.company_id === id);
  const gorevSekmesi = () => {
    if (!app.can('assignments', 'view')) return emptyState({ simge: 'lock', baslik: 'Görevlendirmeleri görme izniniz yok' });
    const bugunStr = bugun();
    const ihtiyac = firmaAylikIhtiyac({ profiller, kurallar, ay: ayBasi(bugunStr) });
    const tur = (t) => {
      const pay = kapsamPayi(tumAtamalar, id, t, bugunStr);
      const toplam = t === 'is_guvenligi_uzmani' ? ihtiyac.uzmanDakika : ihtiyac.hekimDakika;
      return html`<div class="kv"><dt>${PERSONEL_TURU[t]}</dt><dd>%${sayi(pay)} görevlendirildi ${pay < 100 ? pill(pay === 0 ? 'Görevli yok' : 'Eksik pay', 'warning') : pill('Tam', 'success')}
        <small class="block muted">${toplam === null || toplam === undefined ? 'Teorik süre hesaplanamadı' : `Aylık ihtiyaç ${sureMetni(toplam)}${pay < 100 ? ` · boşta ${sureMetni(Math.round(toplam * (100 - pay) / 100))}` : ''}`}</small></dd></div>`;
    };
    const sirali = [...firmaAtamalari].sort((a, b) => String(b.valid_from).localeCompare(String(a.valid_from)));
    return html`<section class="card card-flush"><div class="card-head"><div><h2 class="card-title">Uzman ve hekim görevlendirmesi</h2>
      <p class="card-sub">Teorik hizmet süresi bu paylara göre kişilere dağıtılır.</p></div>
      ${app.can('assignments', 'create') && !firma.archived_at ? html`<button type="button" class="btn btn-secondary btn-sm" data-action="gv-yeni">${icon('plus', 16)} Görevlendir</button>` : ''}</div>
      <dl class="kv-list pad">${tur('is_guvenligi_uzmani')}${tur('isyeri_hekimi')}</dl>
      ${sirali.length ? html`<div class="table-wrap"><table class="table"><thead><tr><th scope="col">Personel</th><th scope="col" class="num">Pay</th><th scope="col">Dönem</th><th scope="col">Durum</th><th scope="col"><span class="sr-only">Eylemler</span></th></tr></thead><tbody>
        ${sirali.map((a) => html`<tr class="${a.archived_at ? 'row-muted' : ''}"><td>${personelAdi.get(a.employee_id) ? html`<a class="link" href="#/personel/${a.employee_id}">${personelAdi.get(a.employee_id)}</a>` : 'Personel'} <small class="muted">${PERSONEL_TURU[a.staff_type]}</small></td><td class="num">%${sayi(Number(a.share_pct))}</td><td>${tarih(a.valid_from)} – ${a.valid_to ? tarih(a.valid_to) : 'devam'}</td><td>${gorevlendirmeDurumu(a, bugunStr)}</td><td class="actions">${gorevlendirmeEylemleri(app, a, bugunStr)}</td></tr>`)}</tbody></table></div>`
        : emptyState({ simge: 'briefcase', baslik: 'Bu firmaya görevlendirme yapılmamış' })}</section>`;
  };

  const beklemede = (s) => emptyState({
    simge: MENU.find((m) => m.id === ({ teklifler: 'teklifler', sozlesmeler: 'sozlesmeler', atamalar: 'atamalar', faturalar: 'faturalar' }[s.id]))?.simge ?? 'info',
    baslik: `${s.ad} Aşama ${s.asama}'te eklenecek`,
    metin: 'Bu sekme yapım aşamasında. Şimdilik firma, kişi ve çalışan sayısı kayıtlarını kullanabilirsiniz.',
  });

  // ---------------------------------------------------------------- teorik hizmet süresi kartı
  function aySecenekleri() {
    const bu = ayBasi(bugun());
    const [y] = bu.split('-').map(Number);
    const liste = [];
    for (let yil = y - 1; yil <= y + 1; yil += 1) {
      for (let a = 1; a <= 12; a += 1) liste.push(`${yil}-${String(a).padStart(2, '0')}-01`);
    }
    return liste;
  }

  function teorikIcerik() {
    const sonuc = firmaAylikIhtiyac({ profiller, kurallar, ay: durum.ay });
    if (!sonuc.profil) {
      const ilk = profiller.length ? profiller.reduce((m, p) => (p.valid_from < m ? p.valid_from : m), '9999-12-31') : null;
      return html`<p class="muted">${ayAdi(durum.ay)} için geçerli bir çalışan sayısı kaydı yok.${ilk && ilk > durum.ay ? ` İlk kayıt ${tarih(ilk)} tarihinde başlıyor; hesap ayın 1'indeki kayda göre yapıldığından o aydan sonraki ayları seçin.` : ''}</p>`;
    }
    const kap = kapasiteDakika(ayarlar, durum.ay);
    const kutu = (ad, dk) => html`<div class="stat"><span class="stat-l">${ad}</span><strong class="stat-v">${dk === null ? '—' : sayi(dk)} <small>dk</small></strong>
      <span class="stat-s">${dk === null ? 'Süre kuralı bulunamadı' : `${dakikaSaat(dk).replace(/^.*\(/, '').replace(')', '')} · bir tam zamanlı kişinin kapasitesinin %${ondalik(kapasiteKullanimi(dk, kap) * 100)}'i`}</span></div>`;
    return html`<p class="card-sub">${ayAdi(durum.ay)} · ${sayi(sonuc.profil.employee_count)} çalışan · ${TEHLIKE[sonuc.profil.hazard_class]}</p>
      <div class="stats">${kutu('İş güvenliği uzmanı', sonuc.uzmanDakika)}${kutu('İşyeri hekimi', sonuc.hekimDakika)}</div>
      ${sonuc.eksik ? html`<div class="notice notice-warn" role="status">${sonuc.eksik}</div>` : ''}
      <p class="fine">Bu değer firmanın toplam teorik ihtiyacıdır. Kişilere dağıtım Görevlendirme sekmesindeki paylara göre yapılır. Kapasite: kişi başı ayda ${sayi(kap)} dk.</p>`;
  }

  function teorikKart() {
    return html`<section class="card grid-full" id="teorik-kart">
      <div class="card-head"><h2 class="card-title">Teorik hizmet süresi</h2>
        <label class="select-inline"><span class="sr-only">Ay seçin</span>
          <select id="teorik-ay">${aySecenekleri().map((a) => html`<option value="${a}" ${a === durum.ay ? raw('selected') : ''}>${ayAdi(a)}</option>`)}</select></label></div>
      <div id="teorik-icerik">${teorikIcerik()}</div></section>`;
  }

  const TEHLIKE_SECENEKLERI = [['', 'Belirtilmedi'], ['az_tehlikeli', 'Az tehlikeli'], ['tehlikeli', 'Tehlikeli'], ['cok_tehlikeli', 'Çok tehlikeli']];
  const isyeriOzeti = () => {
    const sayilan = siteler.filter((x) => x.is_active && x.hazard_class);
    if (!sayilan.length) return html`<div class="notice notice-warn" role="status">Tehlike sınıfı girilmiş işyeri yok; hizmet süresi ve maliyet hesabı firma kartındaki çalışan sayısı ve tehlike sınıfına göre yapılır.</div>`;
    const gruplar = TEHLIKE_SECENEKLERI.slice(1).map(([k, ad]) => [ad, sayilan.filter((x) => x.hazard_class === k)]).filter(([, l]) => l.length);
    return html`<div class="notice notice-info" id="isyeri-ozet" role="note">Hesapta kullanılan: ${gruplar.map(([ad, l]) => html`<strong>${ad}</strong> ${l.length} işyeri / ${l.reduce((t, x) => t + (x.employee_count ?? 0), 0)} çalışan`).reduce((acc, x, i) => (i ? [...acc, html`; `, x] : [x]), [])}. Her tehlike sınıfı kendi süresiyle hesaplanır.</div>`;
  };

  const isyeriSekmesi = () => {
    if (siteler === null) return html`<section class="card"><div class="notice notice-info" role="note">İşyeri bilgisi okunamadı. Supabase'de 14_asama13_katip.sql ve 16_asama15.sql dosyalarının çalıştırıldığından emin olun.</div></section>`;
    const duzenleyebilir = app.can('companies', 'edit');
    return html`<section class="card card-flush"><div class="card-head"><div><h2 class="card-title">İşyerleri</h2>
      <p class="card-sub">İşyerlerinin çalışan sayısı ve tehlike sınıfı hizmet süresi ve maliyet hesabında kullanılır (farklı sınıflar ayrı ayrı hesaplanır). "Ayrı fatura" işaretlenmeyen işyerleri için firmaya tek fatura kesilir. Faturada geçen kısa adı (ör. UKEM) "Fatura adı" alanına yazın.</p></div>
      <div class="btn-row">${app.can('companies', 'create') ? html`<button type="button" class="btn btn-secondary btn-sm" data-action="isyeri-mevcut">${icon('search', 16)} Mevcut işyerini ekle</button> <button type="button" class="btn btn-secondary btn-sm" data-action="isyeri-ekle">${icon('plus', 16)} İşyeri ekle</button>` : ''}</div></div>
      ${siteler.length ? html`<div class="pad-x">${isyeriOzeti()}</div><div class="table-wrap"><table class="table" id="isyeri-tablo"><thead><tr><th scope="col">İşyeri</th><th scope="col" class="num hide-sm">Çalışan</th><th scope="col">Tehlike sınıfı</th><th scope="col">Fatura adı</th><th scope="col">Ayrı fatura</th><th scope="col"><span class="sr-only">Eylemler</span></th></tr></thead><tbody>
        ${siteler.map((x) => {
          const elle = x.is_manual && duzenleyebilir;
          return html`<tr data-isyeri="${x.id}"><td><strong>${x.site_name}</strong><small class="block muted">${x.is_manual ? 'Elle girildi' : `Sicil: ${x.sgk_no}${x.is_active ? '' : ' · dosyada yok'}`}</small></td>
          <td class="num hide-sm">${elle ? html`<input type="number" min="0" step="1" inputmode="numeric" class="input-sm" data-isyeri-calisan="${x.id}" value="${x.employee_count ?? ''}" aria-label="${x.site_name} çalışan sayısı">` : (x.employee_count ?? '—')}</td>
          <td>${elle ? html`<select data-isyeri-tehlike="${x.id}" aria-label="${x.site_name} tehlike sınıfı">${TEHLIKE_SECENEKLERI.map(([k, ad]) => html`<option value="${k}" ${(x.hazard_class ?? '') === k ? html`selected` : ''}>${ad}</option>`)}</select>` : (x.hazard_class ? TEHLIKE_ADI[x.hazard_class] : html`<span class="muted">Belirtilmedi</span>`)}${!x.hazard_class ? html`<small class="block muted">hesaba katılmaz</small>` : (!x.is_active ? html`<small class="block muted">pasif: hesaba katılmaz</small>` : '')}</td>
          <td>${duzenleyebilir ? html`<input type="text" maxlength="120" data-isyeri-ad="${x.id}" value="${x.invoice_alias ?? ''}" placeholder="Örn. UKEM" aria-label="${x.site_name} fatura adı">` : (x.invoice_alias || '—')}</td>
          <td>${duzenleyebilir ? html`<label class="check-inline"><input type="checkbox" data-isyeri-ayri="${x.id}" ${x.separate_invoice ? html`checked` : ''}> <span>Ayrı fatura</span></label>` : (x.separate_invoice ? 'Evet' : 'Hayır')}</td>
          <td class="actions">${duzenleyebilir ? html`<button type="button" class="icon-btn" data-isyeri-sil="${x.id}" aria-label="${x.site_name} işyerini sil" title="Listeden sil">${icon('trash', 16)}</button>` : ''}</td></tr>`;
        })}</tbody></table></div>`
        : emptyState({ simge: 'building', baslik: 'Bu firmaya bağlı işyeri yok', metin: 'İSG-Katip aktarımı yapıldığında firmanın işyerleri burada görünür; "İşyeri ekle" ile elle girebilir veya "Mevcut işyerini ekle" ile sistemde kayıtlı bir işyerini bu firmaya bağlayabilirsiniz.' })}</section>`;
  };

  /** İşyeri değişikliğinden sonra firma profilini (çalışan sayısı/tehlike sınıfı) işyerlerinden yeniler. */
  async function profilEsitle(firmaId = id) {
    try { await app.api.isyeriProfilEsitle(firmaId); } catch (err) { toast(`İşyeri kaydedildi ancak firma hesabı güncellenemedi: ${humanError(err)}`, 'hata'); }
  }

  async function mevcutIsyeriFormu() {
    const firmaHaritasi = new Map(((await app.api.listCompanies().catch(() => [])) ?? []).map((c) => [c.id, c.name]));
    const adaylar = (tumSiteler ?? []).filter((x) => x.company_id !== id).sort((a, b) => a.site_name.localeCompare(b.site_name, 'tr'));
    if (!adaylar.length) { toast('Başka firmalarda kayıtlı işyeri bulunamadı.', 'bilgi'); return; }
    const firmaAdi = (cid) => firmaHaritasi.get(cid) ?? 'Bilinmeyen firma';
    openFormModal({
      baslik: 'Mevcut işyerini ekle', altBaslik: `${firma.name} firmasına bağlanacak`, gonderEtiketi: 'Bu firmaya ekle', boyut: 'lg',
      govde: html`<div class="notice notice-info field-full" role="note">Sistemde daha önce girilmiş (başka firmada duran veya silinmiş) bir işyerini bu firmaya bağlar; işyeri eski firmadan çıkar, faturalama bu firmaya göre yapılır.</div>
        ${field({ ad: 'site_id', etiket: 'İşyeri', zorunlu: true, tam: true, deger: '', secenekler: [{ deger: '', etiket: 'İşyeri seçin' }, ...adaylar.map((x) => ({ deger: x.id, etiket: `${x.site_name} — ${firmaAdi(x.company_id)}${x.archived_at ? ' (silinmiş)' : ''}${x.hazard_class ? ` · ${TEHLIKE_ADI[x.hazard_class]}` : ''}` }))] })}`,
      async onSubmit(fd) {
        const sid = String(fd.get('site_id') ?? '');
        if (!sid) return { errors: { site_id: 'Bir işyeri seçin.' } };
        await app.api.isyeriFirmayaTasi(sid, id);
        toast('İşyeri bu firmaya bağlandı.');
      },
      onDone: () => app.yenile(),
    });
  }

  function isyeriFormu() {
    openFormModal({
      baslik: 'İşyeri ekle', altBaslik: `${firma.name} · İSG-Katip'te bulunmayan işyeri`, gonderEtiketi: 'Ekle', boyut: 'lg',
      govde: html`${field({ ad: 'site_name', etiket: 'İşyeri adı', zorunlu: true, tam: true, maksUzunluk: 200, yerTutucu: 'Örn. Ukem Sağlık Hizmetleri Şubesi' })}
        ${field({ ad: 'invoice_alias', etiket: 'Fatura adı (takma ad)', maksUzunluk: 120, yerTutucu: 'Örn. UKEM' })}
        ${field({ ad: 'employee_count', etiket: 'Çalışan sayısı', tur: 'number', min: 0, adim: 1, inputmode: 'numeric' })}
        ${field({ ad: 'hazard_class', etiket: 'Tehlike sınıfı', deger: '', secenekler: [{ deger: '', etiket: 'Belirtilmedi' }, { deger: 'az_tehlikeli', etiket: 'Az tehlikeli' }, { deger: 'tehlikeli', etiket: 'Tehlikeli' }, { deger: 'cok_tehlikeli', etiket: 'Çok tehlikeli' }] })}
        ${checkbox({ ad: 'separate_invoice', etiket: 'Bu işyerine ayrı fatura kesilir', isaretli: false })}`,
      async onSubmit(fd) {
        const g = (k) => String(fd.get(k) ?? '').trim(); const h = {};
        if (!g('site_name')) h.site_name = 'İşyeri adı zorunludur.';
        if (g('employee_count') !== '' && !/^\d{1,6}$/.test(g('employee_count'))) h.employee_count = 'Çalışan sayısı 0 veya daha büyük bir tam sayı olmalıdır.';
        if (Object.keys(h).length) return { errors: h };
        const rastgele = Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => (b % 36).toString(36)).join('').toUpperCase();
        await app.api.createSite({ company_id: id, sgk_no: `EL${rastgele}`, site_name: g('site_name'), invoice_alias: bosIseNull(g('invoice_alias')),
          employee_count: g('employee_count') === '' ? null : Number(g('employee_count')), hazard_class: bosIseNull(g('hazard_class')), separate_invoice: fd.get('separate_invoice') === '1', is_manual: true, is_active: true });
        await profilEsitle();
        toast('İşyeri eklendi.');
      },
      onDone: () => app.yenile(),
    });
  }

  function sekmeGovdesi() {
    const s = SEKMELER.find((x) => x.id === durum.sekme);
    if (s.asama) return beklemede(s);
    if (s.id === 'kisiler') return kisilerSekmesi();
    if (s.id === 'gorusmeler') return gorusmeSekmesi();
    if (s.id === 'firsatlar') return firsatSekmesi();
    if (s.id === 'teklifler') return app.can('offers', 'view') ? teklifSekmesi() : emptyState({ simge: 'lock', baslik: 'Teklifleri görme izniniz yok' });
    if (s.id === 'sozlesmeler') return app.can('contracts', 'view') ? sozlesmeSekmesi() : emptyState({ simge: 'lock', baslik: 'Sözleşmeleri görme izniniz yok' });
    if (s.id === 'faturalar') return app.can('invoices', 'view') ? faturaSekmesi() : emptyState({ simge: 'lock', baslik: 'Faturaları görme izniniz yok' });
    if (s.id === 'isyerleri') return isyeriSekmesi();
    if (s.id === 'calisan') return calisanSekmesi();
    if (s.id === 'atamalar') return gorevSekmesi();
    return genel();
  }

  const sekmeCubugu = () => html`<div class="tabs" role="tablist" aria-label="Firma bölümleri">
    ${SEKMELER.map((s) => html`<button type="button" role="tab" class="tab ${durum.sekme === s.id ? 'tab-on' : ''}" aria-selected="${durum.sekme === s.id}" data-sekme="${s.id}">
      ${s.ad}${s.asama ? html` <span class="tab-tag">Aşama ${s.asama}</span>` : ''}${s.id === 'kisiler' && kisiler.length ? html` <span class="chip-n">${kisiler.filter((k) => !k.archived_at).length}</span>` : ''}</button>`)}</div>`;

  // ---------------------------------------------------------------- eylemler
  function profilFormu() {
    const acik = profiller.find((p) => !p.valid_to);
    const enSon = profiller.length ? profiller.reduce((m, p) => (p.valid_from > m ? p.valid_from : m), '') : '';
    const varsayilan = enSon && enSon >= ayBasi(bugun()) ? gunEkle(enSon, 1) : ayBasi(bugun());
    openFormModal({
      baslik: 'Yeni dönem ekle', altBaslik: firma.name,
      govde: html`${field({ ad: 'employee_count', etiket: 'Çalışan sayısı', tur: 'number', min: 0, adim: 1, inputmode: 'numeric', zorunlu: true, deger: guncel?.employee_count ?? '' })}
        ${field({ ad: 'hazard_class', etiket: 'Tehlike sınıfı', zorunlu: true, deger: guncel?.hazard_class ?? '', secenekler: [{ deger: '', etiket: 'Seçiniz' }].concat(TEHLIKE_SIRASI.map((k) => ({ deger: k, etiket: TEHLIKE[k] }))) })}
        ${field({ ad: 'valid_from', etiket: 'Geçerlilik başlangıcı', tur: 'date', zorunlu: true, deger: varsayilan,
          ipucu: acik ? `Mevcut dönem (${tarih(acik.valid_from)} başlangıçlı) bu tarihin bir gün öncesinde kapatılır.` : 'İlk dönem kaydı.' })}
        ${field({ ad: 'note', etiket: 'Not', deger: '', maksUzunluk: 200, tam: true, yerTutucu: 'Örn. yeni şube açıldı' })}`,
      async onSubmit(fd) {
        const g = (k) => String(fd.get(k) ?? '').trim();
        const h = {};
        if (!/^\d{1,7}$/.test(g('employee_count'))) h.employee_count = 'Çalışan sayısı 0 veya daha büyük bir tam sayı olmalıdır.';
        if (!g('hazard_class')) h.hazard_class = 'Tehlike sınıfını seçin.';
        if (!/^\d{4}-\d{2}-\d{2}$/.test(g('valid_from'))) h.valid_from = 'Başlangıç tarihini seçin.';
        else if (enSon && g('valid_from') <= enSon) h.valid_from = `Başlangıç, mevcut en son dönemin başlangıcından (${tarih(enSon)}) sonra olmalıdır.`;
        if (Object.keys(h).length) return { errors: h };
        await app.api.addProfile({
          companyId: firma.id, calisanSayisi: Number(g('employee_count')), tehlike: g('hazard_class'),
          baslangic: g('valid_from'), not: bosIseNull(g('note')),
        });
        toast('Yeni dönem eklendi.');
      },
      onDone: () => app.yenile(),
    });
  }

  async function arsivIslemi() {
    if (firma.archived_at) {
      try { await app.api.unarchiveCompany(firma.id); toast('Firma arşivden çıkarıldı.'); app.aramaOnbellegiTemizle(); app.yenile(); }
      catch (e) { toast(humanError(e), 'hata'); }
      return;
    }
    const onay = await confirmDialog({
      baslik: 'Firmayı arşivle', onayEtiketi: 'Arşivle', tehlikeli: true,
      mesaj: `"${firma.name}" arşive alınacak. Kayıtlar silinmez; "Arşivli" filtresinden görülüp geri alınabilir.`,
    });
    if (!onay) return;
    try { await app.api.archiveCompany(firma.id); toast('Firma arşive alındı.'); app.aramaOnbellegiTemizle(); app.yenile(); }
    catch (e) { toast(humanError(e), 'hata'); }
  }

  async function pasifIslemi() {
    const pasifMi = firma.customer_status === 'eski_musteri';
    const onay = await confirmDialog({
      baslik: pasifMi ? 'Firmayı aktif et' : 'Firmayı pasife al', onayEtiketi: pasifMi ? 'Aktif et' : 'Pasife al', tehlikeli: !pasifMi,
      mesaj: pasifMi
        ? `"${firma.name}" yeniden müşteri olacak: aylık toplu faturaya girer, görevlendirmeleri uzman/hekim yüküne tekrar sayılır.`
        : `"${firma.name}" pasife alınacak (eski müşteri). Tüm kayıtları (fatura, sözleşme, zaman kaydı vb.) kalır; ama sonraki aylarda otomatik fatura üretilmez, görevlendirmeleri uzman/hekim yük ve kapasite hesabına katılmaz, yeni zaman kaydı veya görevlendirme girilemez. İstediğiniz zaman aktif edebilirsiniz.`,
    });
    if (!onay) return;
    try { await app.api.updateCompany(firma.id, { customer_status: pasifMi ? 'musteri' : 'eski_musteri' }); toast(pasifMi ? 'Firma aktif edildi.' : 'Firma pasife alındı.'); app.aramaOnbellegiTemizle(); app.yenile(); }
    catch (e) { toast(humanError(e), 'hata'); }
  }

  function silIslemi() {
    const m = openFormModal({
      baslik: 'Firmayı kalıcı sil', altBaslik: firma.name, boyut: 'md', gonderEtiketi: 'Kalıcı olarak sil',
      govde: html`<div class="field field-full"><div class="notice notice-warn" role="alert" id="firma-sil-uyari"><strong>Bu işlem geri alınamaz.</strong>
        Firmanın TÜM kayıtları kalıcı silinir: kişiler, fırsatlar, görüşmeler, teklifler, sözleşmeler, faturalar ve tahsilatlar, görevlendirmeler, zaman kayıtları, giderler, işyerleri, takvim kayıtları ve görevler.
        Kayıtları saklayıp yalnızca firmayı devre dışı bırakmak için "Pasife al" kullanın. Silmeden önce Yedekleme sayfasından yedek almanızı öneririz.</div></div>
        ${field({ ad: 'onay_adi', etiket: `Onay için firma adını aynen yazın: ${firma.name}`, zorunlu: true, tam: true, maksUzunluk: 200, otomatik: 'off' })}`,
      async onSubmit(fd) {
        const yazilan = String(fd.get('onay_adi') ?? '').trim();
        if (yazilan !== firma.name.trim()) return { errors: { onay_adi: 'Firma adı aynen yazılmalıdır.' } };
        const r = await app.api.deleteCompany(firma.id, yazilan);
        const toplam = Object.values(r?.silinen ?? {}).reduce((t, x) => t + Number(x || 0), 0);
        toast(`"${firma.name}" ve ${sayi(toplam)} bağlı kayıt kalıcı silindi.`);
        app.aramaOnbellegiTemizle();
      },
      onDone: () => { location.hash = '#/firmalar'; },
    });
    return m;
  }

  return {
    baslik: firma.name,
    altBaslik: [firma.sector, [firma.city, firma.district].filter(Boolean).join(' / ')].filter(Boolean).join(' · '),
    geri: { href: '#/firmalar', ad: 'Firmalar' },
    ozelBaslik: html`<div class="company-head">${avatar(firma.name, 'lg')}<div>
      <h1>${firma.name}</h1>
      <div class="company-meta">${durumPill(firma)} ${guncel ? html`${tehlikePill(guncel.hazard_class)} <span class="muted">${sayi(guncel.employee_count)} çalışan</span>` : html`<span class="muted">Çalışan sayısı girilmedi</span>`}</div>
    </div></div>`,
    eylemler: html`${duzenleyebilir && !firma.archived_at ? html`<button type="button" class="btn btn-secondary" data-action="duzenle">${icon('pencil', 18)} Düzenle</button>` : ''}
      ${arsivleyebilir ? html`<button type="button" class="btn ${firma.archived_at ? 'btn-primary' : 'btn-secondary'}" data-action="arsiv">${icon(firma.archived_at ? 'restore' : 'archive', 18)} ${firma.archived_at ? 'Arşivden çıkar' : 'Arşivle'}</button>` : ''}
      ${duzenleyebilir && !firma.archived_at ? html`<button type="button" class="btn btn-secondary" data-action="pasif">${icon('archive', 18)} ${firma.customer_status === 'eski_musteri' ? 'Aktif et' : 'Pasife al'}</button>` : ''}
      ${silebilir ? html`<button type="button" class="btn btn-danger" data-action="firma-sil">${icon('x', 18)} Firmayı sil</button>` : ''}`,
    govde: html`${anaFirma ? html`<div class="notice notice-info" role="status" id="firma-ana-notu">Bu firma <a href="${`#/firmalar/${anaFirma.id}`}">${anaFirma.name}</a> firmasına bağlıdır. Karlılık raporlarında ve çalışan/tehlike sınıfı hesabında ana firmayla tek firma sayılır.</div>` : ''}${bagliFirmalar.length ? html`<div class="notice notice-info" role="status" id="firma-bagli-notu">Bağlı firmalar: ${bagliFirmalar.map((c, i) => html`${i ? ', ' : ''}<a href="${`#/firmalar/${c.id}`}">${c.name}</a>`)}. Bu firmaların geliri, maliyeti, çalışan sayısı ve tehlike sınıfı burada toplanır.</div>` : ''}${!firma.archived_at && firma.customer_status === 'eski_musteri' ? html`<div class="notice notice-info" role="status" id="firma-pasif-notu">Bu firma pasif (eski müşteri). Kayıtları durur; yeni aylık fatura üretilmez, görevlendirmeleri uzman/hekim yüküne sayılmaz ve yeni zaman kaydı girilemez.</div>` : ''}${firma.archived_at ? html`<div class="notice notice-warn" role="status">Bu firma arşivde. Kayıtları görüntüleyebilirsiniz; düzenlemek için önce arşivden çıkarın.</div>` : ''}
      <div id="sekme-cubugu">${sekmeCubugu()}</div>
      <div id="sekme-govde" role="tabpanel">${sekmeGovdesi()}</div>`,
    mount(kok) {
      const govdeEl = kok.querySelector('#sekme-govde');
      const ciz = () => {
        kok.querySelector('#sekme-cubugu').innerHTML = sekmeCubugu().s;
        govdeEl.innerHTML = sekmeGovdesi().s;
      };
      kok.addEventListener('change', async (e) => {
        const hedef = e.target.dataset.isyeriAd ?? e.target.dataset.isyeriAyri;
        if (hedef) {
          const x = siteler.find((y) => y.id === hedef); if (!x) return;
          const degisim = e.target.dataset.isyeriAd !== undefined ? { invoice_alias: e.target.value.trim() || null } : { separate_invoice: e.target.checked };
          try { Object.assign(x, await app.api.updateSite(x.id, degisim)); toast('İşyeri bilgisi kaydedildi.'); }
          catch (err) { toast(humanError(err), 'hata'); }
          return;
        }
        const ihedef = e.target.dataset.isyeriCalisan ?? e.target.dataset.isyeriTehlike;
        if (ihedef) {
          const x = siteler.find((y) => y.id === ihedef); if (!x) return;
          let degisim;
          if (e.target.dataset.isyeriCalisan !== undefined) {
            const v = e.target.value.trim();
            if (v !== '' && !/^\d{1,6}$/.test(v)) { toast('Çalışan sayısı 0 veya daha büyük bir tam sayı olmalıdır.', 'hata'); e.target.value = x.employee_count ?? ''; return; }
            degisim = { employee_count: v === '' ? null : Number(v) };
          } else degisim = { hazard_class: e.target.value || null };
          try { Object.assign(x, await app.api.updateSite(x.id, degisim)); await profilEsitle(); toast('İşyeri bilgisi kaydedildi.'); app.yenile(); }
          catch (err) { toast(humanError(err), 'hata'); }
          return;
        }
        if (e.target.id === 'teorik-ay') {
          durum.ay = e.target.value;
          kok.querySelector('#teorik-icerik').innerHTML = teorikIcerik().s;
        }
      });
      kok.addEventListener('click', async (e) => {
        const sil = e.target.closest('[data-isyeri-sil]');
        if (sil) {
          const x = siteler.find((y) => y.id === sil.dataset.isyeriSil); if (!x) return;
          if (!(await confirmDialog({ baslik: 'İşyerini sil', mesaj: `"${x.site_name}" işyeri listeden kaldırılacak; hizmet süresi ve maliyet hesabından da çıkar.${x.is_manual ? '' : ' İSG-Katip dosyasında hâlâ yer alıyorsa sonraki yüklemede yeniden gelir.'} Silinen işyeri daha sonra "Mevcut işyerini ekle" ile geri alınabilir.`, onayEtiketi: 'Sil', tehlikeli: true }))) return;
          try { await app.api.updateSite(x.id, { archived_at: new Date().toISOString() }); await profilEsitle(); toast('İşyeri silindi.'); app.yenile(); } catch (err) { toast(humanError(err), 'hata'); }
          return;
        }
        const t = e.target.closest('[data-sekme]');
        if (t) { durum.sekme = t.dataset.sekme; hatirla.id = id; hatirla.sekme = durum.sekme; ciz(); kok.querySelector(`[data-sekme="${durum.sekme}"]`)?.focus(); return; }
        const a = e.target.closest('[data-action]');
        if (a) {
          const eylem = a.dataset.action;
          if (eylem === 'duzenle') firmaFormuAc(app, { firma });
          else if (eylem === 'arsiv') await arsivIslemi();
          else if (eylem === 'pasif') await pasifIslemi();
          else if (eylem === 'firma-sil') silIslemi();
          else if (eylem === 'isyeri-ekle') isyeriFormu();
          else if (eylem === 'isyeri-mevcut') mevcutIsyeriFormu();
          else if (eylem === 'profil-ekle') profilFormu();
          else if (eylem === 'kisi-ekle') kisiFormuAc(app, { firmaId: firma.id });
          else if (eylem === 'gorusme-ekle') gorusmeFormuAc(app, { companyId: firma.id, kisiler });
          else if (eylem === 'firsat-ekle') firsatFormuAc(app, { companyId: firma.id });
          else if (eylem === 'teklif-yeni') teklifFormuAc(app, { companyId: firma.id });
          else if (eylem === 'sozlesme-yeni') sozlesmeFormuAc(app, { companyId: firma.id });
          else if (eylem === 'imzali-yeni') imzaliSozlesmeFormuAc(app, { companyId: firma.id, sozlesmeler: tumSozlesmeler.filter((c) => c.company_id === id) });
          else if (eylem === 'gorev-ekle') gorevFormuAc(app, { companyId: firma.id });
          else if (eylem === 'fatura-yeni') faturaFormuAc(app, { companyId: firma.id });
          else if (eylem === 'firma-tahsilat') firmaTahsilatFormuAc(app, { firma, faturalar: firmaFaturalariListesi, tahsilatlar: tumTahsilatlar.filter((p) => firmaFaturalariListesi.some((f) => f.id === p.invoice_id)) });
          else if (eylem === 'gv-yeni') gorevlendirmeFormuAc(app, { companyId: firma.id });
          return;
        }
        const iz = e.target.closest('[data-imzali-ac], [data-imzali-arsiv]');
        if (iz) { const d = tumImzalilar.find((x) => x.id === (iz.dataset.imzaliAc ?? iz.dataset.imzaliArsiv)); if (d) { if (iz.dataset.imzaliAc) await imzaliSozlesmeAc(app, d); else await imzaliSozlesmeArsivle(app, d); } return; }
        const fd = e.target.closest('[data-fatura-detay]');
        if (fd) { const f = firmaFaturalariListesi.find((x) => x.id === fd.dataset.faturaDetay); if (f) faturaDetayAc(app, f, { firmaAdi: firma.name }); return; }
        const gv = e.target.closest('[data-gv-eylem]');
        if (gv) {
          const a = firmaAtamalari.find((x) => x.id === gv.dataset.id);
          if (a) gorevlendirmeEylemiYurut(app, gv.dataset.gvEylem, a, `${firma.name} / ${personelAdi.get(a.employee_id) ?? 'Personel'}`);
          return;
        }
        const gr = e.target.closest('[data-gorusme-eylem]');
        if (gr) {
          const k = gorusmeler.find((x) => x.id === gr.dataset.id); if (!k) return;
          if (gr.dataset.gorusmeEylem === 'duzenle') gorusmeFormuAc(app, { kayit: k, companyId: firma.id, kisiler });
          else if (await gorusmeArsivle(app, k)) app.yenile();
          return;
        }
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
