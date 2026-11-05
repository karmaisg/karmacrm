// OSGB 360 - Uzmanlar ve işyeri hekimleri: liste, kayıt formu, personel sayfası (görevlendirmeler, zaman, maliyet, kullanıcı bağı).
import { html, bugun, tarih, para, para2, sayi, icerir, trSirala, ayBasi, ayAdi } from '../lib/format.js';
import { icon } from '../ui/icons.js';
import { avatar, pill, emptyState, field, checkbox, openFormModal, confirmDialog, toast } from '../ui/components.js';
import { PERSONEL_TURU, ROL_TURU, personelEtiketi, aktifMi, ayBitisi, aktifFirmaAtamalari, personelAyYuku, zamanOzeti, sureMetni, dolulukSeviyesi } from '../lib/operasyon.js';
import { bosIseNull, kapasiteDakika, profilleriGrupla, epostaGecerli, telefonGecerli } from '../lib/veri.js';
import { humanError } from '../lib/api.js';
import { maliyetHesapla } from '../lib/maliyet.js';
import { gorevlendirmeFormuAc, gorevlendirmeDurumu } from './gorevlendirmeler.js';

export const dolulukPill = (s) => ({ asiri: pill('Aşırı yüklü', 'danger'), dolu: pill('Dolu', 'warning'), normal: pill('Uygun', 'success'), bos: pill('Boş kapasite', 'info'), bilinmiyor: pill('Veri yok', 'neutral') }[s]);

export function personelFormuAc(app, { kayit = null, tur = 'is_guvenligi_uzmani', ayarlar = [] } = {}) {
  const duzenle = kayit !== null;
  const rolluMu = duzenle ? !kayit.staff_type : tur === 'diger';   // uzman/hekim dışı personel
  let yeniId = null;
  const kapVarsayilan = kapasiteDakika(ayarlar, bugun());
  openFormModal({
    baslik: duzenle ? 'Personeli düzenle' : (rolluMu ? 'Yeni personel' : tur === 'isyeri_hekimi' ? 'Yeni işyeri hekimi' : 'Yeni iş güvenliği uzmanı'),
    altBaslik: 'Maaş bilgisi bu forma girilmez; yetkili kullanıcılar personel sayfasında ayrıca girer.', boyut: 'lg',
    gonderEtiketi: duzenle ? 'Değişiklikleri kaydet' : 'Personeli ekle',
    govde: html`${field({ ad: 'full_name', etiket: 'Ad soyad', zorunlu: true, deger: kayit?.full_name ?? '', maksUzunluk: 120, tam: true })}
      ${rolluMu
    ? field({ ad: 'role_kind', etiket: 'Görevi', zorunlu: true, deger: kayit?.role_kind ?? '', secenekler: [{ deger: '', etiket: 'Seçiniz' }].concat(Object.entries(ROL_TURU).map(([deger, etiket]) => ({ deger, etiket }))), ipucu: 'Listede yoksa "Diğer" seçip unvanı yazın.' })
    : field({ ad: 'staff_type', etiket: 'Hizmet türü', zorunlu: true, deger: kayit?.staff_type ?? tur, pasif: duzenle, secenekler: Object.entries(PERSONEL_TURU).map(([deger, etiket]) => ({ deger, etiket })), ipucu: duzenle ? 'Kayıt açıldıktan sonra tür değiştirilemez.' : '' })}
      ${field({ ad: 'title', etiket: rolluMu ? 'Unvan' : 'Unvan / sınıf', deger: kayit?.title ?? '', maksUzunluk: 100, yerTutucu: rolluMu ? 'Örn. Muhasebe sorumlusu, hemşire' : 'Örn. A sınıfı uzman' })}
      ${field({ ad: 'qualifications', etiket: 'Belge ve nitelikler', deger: kayit?.qualifications ?? '', maksUzunluk: 300, tam: true, yerTutucu: 'Belge numarası, geçerlilik vb.' })}
      ${field({ ad: 'phone', etiket: 'Telefon', tur: 'tel', deger: kayit?.phone ?? '', maksUzunluk: 30, inputmode: 'tel' })}
      ${field({ ad: 'email', etiket: 'E-posta', tur: 'email', deger: kayit?.email ?? '', maksUzunluk: 120, inputmode: 'email' })}
      ${field({ ad: 'birth_date', etiket: 'Doğum tarihi', tur: 'date', deger: kayit?.birth_date ?? '', ipucu: 'Yıllık izin hakkı için (18 yaş altı / 50 yaş üstü kuralı).' })}
      ${field({ ad: 'start_date', etiket: 'İşe başlama', tur: 'date', deger: kayit?.start_date ?? '' })}
      ${field({ ad: 'end_date', etiket: 'Ayrılış', tur: 'date', deger: kayit?.end_date ?? '' })}
      ${rolluMu ? '' : field({ ad: 'monthly_capacity_min', etiket: 'Aylık kapasite (dakika)', tur: 'number', min: 1, adim: 1, inputmode: 'numeric', zorunlu: true, deger: kayit?.monthly_capacity_min ?? kapVarsayilan, ipucu: `Varsayılan ${sayi(kapVarsayilan)} dk (tam zamanlı).` })}
      ${checkbox({ ad: 'is_management', etiket: 'Yönetim gideri (maliyeti firmalara değil, genel gidere yazılır)', isaretli: kayit?.is_management ?? rolluMu })}
      ${checkbox({ ad: 'is_active', etiket: 'Aktif (görevlendirilebilir ve zaman girebilir)', isaretli: kayit?.is_active ?? true })}
      ${field({ ad: 'notes', etiket: 'Notlar', tur: 'textarea', tam: true, deger: kayit?.notes ?? '', maksUzunluk: 2000 })}`,
    async onSubmit(fd) {
      const g = (k) => String(fd.get(k) ?? '').trim();
      const h = {};
      if (!g('full_name')) h.full_name = 'Ad soyad zorunludur.';
      if (g('email') && !epostaGecerli(g('email'))) h.email = 'Geçerli bir e-posta adresi girin.';
      if (g('phone') && !telefonGecerli(g('phone'))) h.phone = 'Geçerli bir telefon numarası girin.';
      if (rolluMu && !g('role_kind')) h.role_kind = 'Görevi seçin.';
      if (rolluMu && g('role_kind') === 'diger' && !g('title')) h.title = '"Diğer" görevi için unvanı yazın.';
      if (!rolluMu && (!/^\d{1,6}$/.test(g('monthly_capacity_min')) || Number(g('monthly_capacity_min')) < 1)) h.monthly_capacity_min = 'Kapasite 1 veya daha büyük bir tam sayı olmalıdır.';
      if (g('birth_date') && (g('birth_date') > bugun() || g('birth_date') < '1900-01-01')) h.birth_date = 'Geçerli bir doğum tarihi girin.';
      if (g('start_date') && g('end_date') && g('end_date') < g('start_date')) h.end_date = 'Ayrılış tarihi işe başlamadan önce olamaz.';
      if (Object.keys(h).length) return { errors: h };
      const degerler = {
        full_name: g('full_name'), title: bosIseNull(g('title')), qualifications: bosIseNull(g('qualifications')), phone: bosIseNull(g('phone')), email: bosIseNull(g('email')),
        birth_date: bosIseNull(g('birth_date')), start_date: bosIseNull(g('start_date')), end_date: bosIseNull(g('end_date')),
        is_active: fd.get('is_active') === '1', is_management: fd.get('is_management') === '1', notes: bosIseNull(g('notes')),
      };
      if (!rolluMu) degerler.monthly_capacity_min = Number(g('monthly_capacity_min'));
      if (duzenle) { await app.api.updateEmployee(kayit.id, degerler); toast('Personel güncellendi.'); }
      else { const y = await app.api.createEmployee(rolluMu ? { ...degerler, staff_type: null, role_kind: g('role_kind') } : { ...degerler, staff_type: g('staff_type'), role_kind: null }); yeniId = y.id; toast('Personel eklendi.'); }
    },
    onDone: () => (yeniId ? app.git(`personel/${yeniId}`) : app.yenile()),
  });
}

// ---------------------------------------------------------------- liste
export async function personelListeSayfasi(app, tur) {
  const gorevlendirmeGorur = app.can('assignments', 'view');
  const [personel, atamalar, firmalar, profiller, kurallar, ayarlar] = await Promise.all([
    app.api.listEmployees(),
    gorevlendirmeGorur ? app.api.listAssignments() : [],
    gorevlendirmeGorur && app.can('companies', 'view') ? app.api.listCompanies() : [],
    gorevlendirmeGorur && app.can('companies', 'view') ? app.api.listAllProfiles() : [],
    app.api.listServiceRules(), app.api.listSettings(),
  ]);
  void firmalar;
  const bugunStr = bugun();
  const ay = ayBasi(bugunStr);
  const harita = profilleriGrupla(profiller);
  const rolluListe = tur === 'diger';
  const liste0 = personel.filter((p) => (rolluListe ? !p.staff_type : p.staff_type === tur));
  const durum = { filtre: 'aktif', q: '' };
  const GRUP = { aktif: (p) => !p.archived_at && p.is_active, pasif: (p) => !p.archived_at && !p.is_active, arsiv: (p) => !!p.archived_at, tumu: (p) => !p.archived_at };
  const FILTRELER = [['aktif', 'Aktif'], ['pasif', 'Pasif'], ['arsiv', 'Arşivli'], ['tumu', 'Tümü']];
  const sayilar = Object.fromEntries(Object.entries(GRUP).map(([k, f]) => [k, liste0.filter(f).length]));
  const ekleyebilir = app.can('staff', 'create');
  const ad = rolluListe ? 'Diğer personel' : tur === 'isyeri_hekimi' ? 'İşyeri hekimleri' : 'Uzmanlar';
  const yeniAd = rolluListe ? 'Yeni personel' : tur === 'isyeri_hekimi' ? 'Yeni hekim' : 'Yeni uzman';

  const rolSatiri = (p) => html`<tr class="${p.archived_at ? 'row-muted' : ''}">
      <td><a class="cell-main" href="#/personel/${p.id}">${avatar(p.full_name)}<span><strong>${p.full_name}</strong><small>${p.title || ''}</small></span></a></td>
      <td>${ROL_TURU[p.role_kind] ?? '—'}</td>
      <td>${p.is_management ? pill('Yönetim gideri', 'info') : html`<span class="muted">Dağıtılmamış</span>`}</td>
      <td>${p.archived_at ? pill('Arşivde', 'neutral') : p.is_active ? pill('Aktif', 'success') : pill('Pasif', 'neutral')}</td></tr>`;
  const satir = (p) => {
    if (rolluListe) return rolSatiri(p);
    const benim = atamalar.filter((a) => a.employee_id === p.id && aktifMi(a, bugunStr));
    const yuk = gorevlendirmeGorur ? personelAyYuku({ atamalar: aktifFirmaAtamalari(atamalar, firmalar), employeeId: p.id, profilHaritasi: harita, kurallar, ay }) : null;
    const oran = yuk && !yuk.eksikVar ? yuk.dakika / p.monthly_capacity_min : null;
    return html`<tr class="${p.archived_at ? 'row-muted' : ''}">
      <td><a class="cell-main" href="#/personel/${p.id}">${avatar(p.full_name)}<span><strong>${p.full_name}</strong><small>${p.title || PERSONEL_TURU[p.staff_type]}</small></span></a></td>
      <td class="num hide-sm">${sayi(p.monthly_capacity_min)} dk</td>
      <td class="num hide-md">${gorevlendirmeGorur ? sayi(benim.length) : '—'}</td>
      <td class="hide-md">${yuk ? (yuk.dakika ? html`${sureMetni(yuk.dakika)} <small class="muted">${oran !== null ? `%${Math.round(oran * 100)}` : 'eksik veri'}</small>` : html`<span class="muted">—</span>`) : '—'}</td>
      <td>${p.archived_at ? pill('Arşivde', 'neutral') : p.is_active ? (oran !== null && benim.length ? dolulukPill(dolulukSeviyesi(oran)) : pill('Aktif', 'success')) : pill('Pasif', 'neutral')}</td></tr>`;
  };
  const tablo = () => {
    if (!liste0.length) {
      return emptyState({ simge: rolluListe ? 'users' : tur === 'isyeri_hekimi' ? 'pulse' : 'shield', baslik: `Henüz ${rolluListe ? 'diğer personel' : tur === 'isyeri_hekimi' ? 'işyeri hekimi' : 'uzman'} kaydı yok`, metin: rolluListe ? 'Diğer sağlık personeli, satın alma, satış, sekreter, temizlik ve yönetim gibi maliyete katkısı olan personeli ekleyin.' : 'Görevlendirme, zaman takibi ve kapasite hesabı için önce personeli ekleyin.',
        eylem: ekleyebilir ? html`<button type="button" class="btn btn-primary" data-action="yeni">${icon('plus', 18)} ${yeniAd}</button>` : '' });
    }
    let l = liste0.filter(GRUP[durum.filtre]);
    if (durum.q.trim()) l = l.filter((p) => icerir(p.full_name, durum.q));
    l.sort((a, b) => trSirala(a.full_name, b.full_name));
    if (!l.length) return emptyState({ simge: 'search', baslik: 'Eşleşen kayıt yok', metin: 'Arama veya filtreyi değiştirmeyi deneyin.' });
    if (rolluListe) return html`<div class="table-wrap"><table class="table" id="rol-tablo"><thead><tr><th scope="col">Ad soyad</th><th scope="col">Görevi</th><th scope="col">Maliyet</th><th scope="col">Durum</th></tr></thead><tbody>${l.map(satir)}</tbody></table></div><p class="fine pad">Yönetim gideri işaretli personelin maliyeti, firma kârlılığında genel (ortak) gider olarak tüm firmalara dağıtılır.</p>`;
    return html`<div class="table-wrap"><table class="table"><thead><tr><th scope="col">Ad soyad</th><th scope="col" class="num hide-sm">Aylık kapasite</th><th scope="col" class="num hide-md">Firma</th><th scope="col" class="hide-md">${ayAdi(ay)} teorik yükü</th><th scope="col">Durum</th></tr></thead><tbody>${l.map(satir)}</tbody></table></div>`;
  };
  const filtreHtml = () => html`${FILTRELER.map(([id, a]) => html`<button type="button" class="chip ${durum.filtre === id ? 'chip-on' : ''}" data-filtre="${id}" aria-pressed="${durum.filtre === id}">${a} <span class="chip-n">${sayilar[id]}</span></button>`)}`;

  return {
    baslik: ad, altBaslik: rolluListe ? 'Uzman ve hekim dışındaki personel ve maliyetleri' : 'Kayıtlar, kapasite ve görevlendirme yükü', menu: rolluListe ? 'digerpersonel' : tur === 'isyeri_hekimi' ? 'hekimler' : 'uzmanlar',
    eylemler: ekleyebilir ? html`<button type="button" class="btn btn-primary" data-action="yeni">${icon('plus', 18)} ${yeniAd}</button>` : '',
    govde: html`<section class="card card-flush"><div class="toolbar">
      <div class="search-field">${icon('search', 18)}<input type="search" id="personel-ara" placeholder="Ad ile ara" aria-label="Personelde ara" autocomplete="off"></div>
      <div class="chips" id="personel-filtre" role="group" aria-label="Personel filtresi">${filtreHtml()}</div></div><div id="personel-tablo">${tablo()}</div></section>`,
    mount(kok) {
      const t = kok.querySelector('#personel-tablo');
      kok.querySelector('#personel-ara').addEventListener('input', (e) => { durum.q = e.target.value; t.innerHTML = tablo().s; });
      kok.querySelector('#personel-filtre').addEventListener('click', (e) => {
        const d = e.target.closest('[data-filtre]'); if (!d) return;
        durum.filtre = d.dataset.filtre; kok.querySelector('#personel-filtre').innerHTML = filtreHtml().s; t.innerHTML = tablo().s;
      });
      kok.addEventListener('click', (e) => { if (e.target.closest('[data-action="yeni"]')) personelFormuAc(app, { tur, ayarlar }); });
    },
  };
}

// ---------------------------------------------------------------- personel sayfası
export async function personelSayfasi(app, id) {
  const [personel, ayarlar, uyeler] = await Promise.all([app.api.listEmployees(), app.api.listSettings(), app.api.listOrgMembers().catch(() => [])]);
  const p = personel.find((x) => x.id === id);
  if (!p) {
    return { baslik: 'Personel bulunamadı', altBaslik: '', eylemler: html`<a class="btn btn-secondary" href="#/uzmanlar">${icon('arrowL', 18)} Uzmanlara dön</a>`,
      govde: emptyState({ simge: 'shield', baslik: 'Bu kayıt yok ya da erişim izniniz yok' }) };
  }
  const rolluMu = !p.staff_type;
  const listeAdi = rolluMu ? 'digerpersonel' : p.staff_type === 'isyeri_hekimi' ? 'hekimler' : 'uzmanlar';
  const bugunStr = bugun(); const ay = ayBasi(bugunStr);
  const gorevGorur = app.can('assignments', 'view') && !rolluMu;
  const [atamalar, firmalar, maliyetler, zaman, profiller, kurallar] = await Promise.all([
    gorevGorur ? app.api.listAssignments() : [],
    app.can('companies', 'view') ? app.api.listCompanies() : [],
    app.can('payroll', 'view') ? app.api.listEmployeeCosts(id) : [],
    app.can('time', 'view') && !rolluMu ? app.api.listTimeEntries(ay, ayBitisi(ay)) : [],
    app.can('companies', 'view') ? app.api.listAllProfiles() : [],
    app.api.listServiceRules(),
  ]);
  const firmaAdi = new Map(firmalar.map((f) => [f.id, f.name]));
  const kullanicilar = app.can('users', 'view') ? await app.api.listUsers().catch(() => []) : [];
  const bagli = kullanicilar.find((u) => u.employee_id === id) ?? null;
  const benim = atamalar.filter((a) => a.employee_id === id);
  const yuk = gorevGorur ? personelAyYuku({ atamalar: aktifFirmaAtamalari(atamalar, firmalar), employeeId: id, profilHaritasi: profilleriGrupla(profiller), kurallar, ay }) : null;
  const oran = yuk && !yuk.eksikVar ? yuk.dakika / p.monthly_capacity_min : null;
  const zamanOz = zamanOzeti(zaman.filter((k) => k.employee_id === id));
  const duzenleyebilir = app.can('staff', 'edit') && !p.archived_at;
  const maliyetYonet = app.can('payroll', 'create') && app.can('payroll', 'edit');
  const guncelMaliyet = maliyetler.find((m) => m.valid_from <= bugunStr && (!m.valid_to || m.valid_to >= bugunStr)) ?? null;

  return {
    baslik: p.full_name, altBaslik: '', geri: { href: `#/${listeAdi}`, ad: rolluMu ? 'Diğer personel' : p.staff_type === 'isyeri_hekimi' ? 'İşyeri hekimleri' : 'Uzmanlar' }, menu: listeAdi,
    ozelBaslik: html`<div class="company-head">${avatar(p.full_name, 'lg')}<div><h1>${p.full_name}</h1>
      <div class="company-meta">${pill(personelEtiketi(p), 'info')} ${p.is_management ? pill('Yönetim gideri', 'warning') : ''} ${p.archived_at ? pill('Arşivde', 'neutral') : p.is_active ? pill('Aktif', 'success') : pill('Pasif', 'neutral')}
      ${p.title ? html`<span class="muted">${p.title}</span>` : ''}</div></div></div>`,
    eylemler: html`${duzenleyebilir ? html`<button type="button" class="btn btn-secondary" data-action="duzenle">${icon('pencil', 18)} Düzenle</button>` : ''}
      ${app.can('assignments', 'create') && !rolluMu && !p.archived_at && p.is_active ? html`<button type="button" class="btn btn-primary" data-action="gorevlendir">${icon('plus', 18)} Görevlendir</button>` : ''}
      ${app.can('staff', 'archive') ? html`<button type="button" class="btn btn-secondary" data-action="arsiv">${icon(p.archived_at ? 'restore' : 'archive', 18)} ${p.archived_at ? 'Arşivden çıkar' : 'Arşivle'}</button>` : ''}`,
    govde: html`<div class="grid-2">
      <section class="card"><h2 class="card-title">Kayıt</h2><dl class="kv-list">
        <div class="kv"><dt>Belge ve nitelikler</dt><dd>${p.qualifications || html`<span class="muted">—</span>`}</dd></div>
        <div class="kv"><dt>Telefon</dt><dd>${p.phone || html`<span class="muted">—</span>`}</dd></div>
        <div class="kv"><dt>E-posta</dt><dd>${p.email || html`<span class="muted">—</span>`}</dd></div>
        <div class="kv"><dt>İşe başlama / ayrılış</dt><dd>${p.start_date ? tarih(p.start_date) : '—'} / ${p.end_date ? tarih(p.end_date) : '—'}</dd></div>
        ${rolluMu ? html`<div class="kv"><dt>Maliyet türü</dt><dd>${p.is_management ? 'Yönetim gideri (genel gidere yazılır)' : 'Dağıtılmamış (firmaya atanmaz)'}</dd></div>` : html`<div class="kv"><dt>Aylık kapasite</dt><dd>${sayi(p.monthly_capacity_min)} dk <small class="muted">${sureMetni(p.monthly_capacity_min)}</small></dd></div>${p.is_management ? html`<div class="kv"><dt>Maliyet türü</dt><dd>Yönetim gideri: görevlendirmesi olsa bile maliyeti genel gidere yazılır</dd></div>` : ''}`}
        ${p.notes ? html`<div class="kv"><dt>Notlar</dt><dd class="prewrap">${p.notes}</dd></div>` : ''}
      </dl></section>
      ${rolluMu ? '' : html`<section class="card"><h2 class="card-title">${ayAdi(ay)} özeti</h2>
        ${yuk ? html`<dl class="kv-list"><div class="kv"><dt>Teorik yük</dt><dd>${sureMetni(yuk.dakika)} ${oran !== null ? html`<small class="muted">%${Math.round(oran * 100)}</small> ${dolulukPill(dolulukSeviyesi(oran))}` : html`<small class="muted">bazı firmalarda veri eksik</small>`}</dd></div>
          <div class="kv"><dt>Fiilî toplam süre</dt><dd>${sureMetni(zamanOz.toplam)} <small class="muted">${sayi(zamanOz.adet)} kayıt</small></dd></div>
          <div class="kv"><dt>Firmaya hizmet (saha + rapor)</dt><dd>${sureMetni(zamanOz.hizmet)}</dd></div>
          <div class="kv"><dt>Yol / bekleme</dt><dd>${sureMetni(zamanOz.yol)} / ${sureMetni(zamanOz.bekleme)}</dd></div></dl>` : html`<p class="muted">Görevlendirme bilgisini görme izniniz yok.</p>`}
        <p class="fine">Zaman kayıtlarının tamamı için <a class="link" href="#/zaman">Zaman ve ziyaret takibi</a>.</p></section>`}
      ${app.can('users', 'edit') && app.can('staff', 'edit') ? html`<section class="card"><h2 class="card-title">Giriş hesabı</h2>
        <p class="card-sub">Uzman veya hekim kendi hesabıyla giriş yapıp yalnızca kendi zaman kaydını görebilsin diye personel kaydı bir kullanıcıya bağlanır.</p>
        <div class="form-grid"><div class="field field-full"><label for="bagli-kullanici">Bağlı kullanıcı</label>
          <select id="bagli-kullanici"><option value="">Bağlı değil</option>${uyeler.filter((u) => u.is_active).map((u) => html`<option value="${u.id}" ${bagli?.id === u.id ? html`selected` : ''}>${u.full_name}</option>`)}</select></div></div>
        <button type="button" class="btn btn-secondary btn-sm" data-action="bagla">Bağlantıyı kaydet</button></section>` : ''}
      ${app.can('payroll', 'view') ? html`<section class="card"><div class="card-head"><div><h2 class="card-title">Aylık maliyet</h2><p class="card-sub">Hassas bilgi: yalnızca maaş yetkisi olanlar görür.</p></div>
          ${maliyetYonet ? html`<button type="button" class="btn btn-secondary btn-sm" data-action="maliyet">${icon('plus', 16)} Yeni dönem</button>` : ''}</div>
        ${maliyetler.length ? html`<div class="table-wrap"><table class="table"><thead><tr><th scope="col">Dönem</th><th scope="col" class="num">Net</th><th scope="col" class="num">Brüt</th><th scope="col" class="num">SGK primi</th><th scope="col" class="num">Elden</th><th scope="col" class="num">Toplam</th></tr></thead><tbody>
          ${maliyetler.map((m) => html`<tr><td>${tarih(m.valid_from)} – ${m.valid_to ? tarih(m.valid_to) : 'devam'} ${guncelMaliyet?.id === m.id ? pill('Güncel', 'success') : ''}</td><td class="num">${Number(m.cost_version) === 2 ? para(m.net_salary) : '—'}</td><td class="num">${para(m.gross_salary)}${m.is_retired ? html`<small class="block muted">emekli</small>` : ''}</td><td class="num">${para(m.employer_sgk)}${m.sgk_manual ? html`<small class="block muted">elle</small>` : ''}</td><td class="num">${Number(m.cost_version) === 2 ? para(m.cash_paid) : (Number(m.other_benefits) ? `${para(m.other_benefits)} (diğer)` : '—')}</td><td class="num"><strong>${para(m.total_monthly_cost)}</strong></td></tr>`)}</tbody></table></div>`
    : emptyState({ simge: 'wallet', baslik: 'Maliyet girilmemiş', metin: 'Personel kârlılığı (Aşama 7) bu bilgiye ihtiyaç duyar.' })}</section>` : ''}
      ${gorevGorur ? html`<section class="card card-flush grid-full"><div class="card-head"><h2 class="card-title">Görevlendirmeler</h2></div>
        ${benim.length ? html`<div class="table-wrap"><table class="table"><thead><tr><th scope="col">Firma</th><th scope="col" class="num">Pay</th><th scope="col">Dönem</th><th scope="col">Durum</th></tr></thead><tbody>
          ${benim.sort((a, b) => String(b.valid_from).localeCompare(String(a.valid_from))).map((a) => html`<tr class="${a.archived_at ? 'row-muted' : ''}"><td>${firmaAdi.get(a.company_id) ? html`<a class="link" href="#/firmalar/${a.company_id}">${firmaAdi.get(a.company_id)}</a>` : 'Firma'}</td><td class="num">%${sayi(Number(a.share_pct))}</td><td>${tarih(a.valid_from)} – ${a.valid_to ? tarih(a.valid_to) : 'devam'}</td><td>${gorevlendirmeDurumu(a, bugunStr)}</td></tr>`)}</tbody></table></div>`
    : emptyState({ simge: 'briefcase', baslik: 'Henüz görevlendirme yok' })}</section>` : ''}
    </div>`,
    mount(kok) {
      kok.addEventListener('click', async (e) => {
        const a = e.target.closest('[data-action]'); if (!a) return;
        const x = a.dataset.action;
        if (x === 'duzenle') personelFormuAc(app, { kayit: p, ayarlar });
        else if (x === 'gorevlendir') gorevlendirmeFormuAc(app, { employeeId: p.id });
        else if (x === 'maliyet') maliyetFormu(app, p, maliyetler);
        else if (x === 'bagla') {
          try { await app.api.linkEmployeeUser(p.id, kok.querySelector('#bagli-kullanici').value || null); toast('Kullanıcı bağlantısı kaydedildi.'); app.yenile(); } catch (err) { toast(humanError(err), 'hata'); }
        } else if (x === 'arsiv') {
          if (p.archived_at) { try { await app.api.unarchiveEmployee(p.id); toast('Arşivden çıkarıldı.'); app.yenile(); } catch (err) { toast(humanError(err), 'hata'); } return; }
          if (!(await confirmDialog({ baslik: 'Personeli arşivle', onayEtiketi: 'Arşivle', tehlikeli: true, mesaj: `${p.full_name} arşive alınacak. Geçmiş kayıtlar silinmez. Açık görevlendirmesi varsa önce bitirmeniz gerekir.` }))) return;
          try { await app.api.archiveEmployee(p.id); toast('Personel arşive alındı.'); app.yenile(); } catch (err) { toast(humanError(err), 'hata'); }
        }
      });
    },
  };
}

function maliyetFormu(app, p, maliyetler) {
  const guncel = maliyetler.find((m) => m.valid_from <= bugun() && (!m.valid_to || m.valid_to >= bugun())) ?? maliyetler[0] ?? null;
  const yeniSurum = guncel && Number(guncel.cost_version) === 2;
  const m = openFormModal({
    baslik: 'Yeni maliyet dönemi', altBaslik: `${p.full_name} · seçtiğiniz tarihten itibaren, başka bir başlangıç girilene kadar aynı hesapla devam eder`, gonderEtiketi: 'Kaydet',
    govde: html`${field({ ad: 'baslangic', etiket: 'Geçerlilik başlangıcı', tur: 'date', zorunlu: true, deger: ayBasi(bugun()), tam: true })}
      ${field({ ad: 'net', etiket: 'Net maaş (TL)', tur: 'number', min: 0, adim: '0.01', inputmode: 'decimal', deger: yeniSurum ? guncel.net_salary : '' })}
      ${field({ ad: 'brut', etiket: 'Brüt maaş (TL)', tur: 'number', min: 0, adim: '0.01', inputmode: 'decimal', deger: guncel?.gross_salary ?? '', ipucu: 'SGK primi bu tutardan hesaplanır.' })}
      ${checkbox({ ad: 'emekli', etiket: 'Personel emekli', isaretli: !!guncel?.is_retired, ipucu: 'Emekli: brüt × (%2,25 + %30). Emekli değil: brüt × (%2,25 + %21 + %12,5 + %3).' })}
      ${field({ ad: 'sgk', etiket: 'SGK primi (TL)', tur: 'number', min: 0, adim: '0.01', inputmode: 'decimal', deger: guncel?.sgk_manual ? guncel.employer_sgk : '', ipucu: 'Boş bırakırsanız brüt maaştan otomatik hesaplanır. Maaş girmeden yalnızca SGK primi girmek için buraya yazın.' })}
      ${field({ ad: 'elden', etiket: 'Elden verilen (TL)', tur: 'number', min: 0, adim: '0.01', inputmode: 'decimal', deger: yeniSurum ? guncel.cash_paid : '' })}
      <div class="field field-full" id="maliyet-bilgi" aria-live="polite"></div>`,
    async onSubmit(fd) {
      const g = (k) => String(fd.get(k) ?? '').trim();
      const h = {};
      if (!g('baslangic')) h.baslangic = 'Başlangıç tarihini seçin.';
      for (const k of ['net', 'brut', 'sgk', 'elden']) if (g(k) !== '' && !(Number(g(k)) >= 0)) h[k] = 'Tutar 0 veya daha büyük olmalıdır.';
      if (Object.keys(h).length) return { errors: h };
      const x = maliyetHesapla({ brut: g('brut'), net: g('net'), emekli: fd.get('emekli') === '1', sgk: g('sgk'), elden: g('elden') });
      await app.api.addEmployeeCost({ employeeId: p.id, baslangic: g('baslangic'), brut: x.brut, net: x.net, emekli: fd.get('emekli') === '1', sgk: x.sgkElle ? x.sgk : null, elden: x.elden });
      toast('Maliyet dönemi kaydedildi.');
    },
    onDone: () => app.yenile(),
  });
  const form = m.el.querySelector('form'); const bilgi = form.querySelector('#maliyet-bilgi');
  const guncelle = () => {
    const x = maliyetHesapla({ brut: form.elements.brut.value, net: form.elements.net.value, emekli: form.elements.emekli.checked, sgk: form.elements.sgk.value, elden: form.elements.elden.value });
    bilgi.innerHTML = html`<div class="notice notice-info" role="status">SGK primi <strong>${para2(x.sgk)}</strong> ${x.sgkElle ? '(elle girildi)' : '(otomatik)'} · İşverene toplam maliyet = net ${para2(x.net)} + SGK ${para2(x.sgk)} + elden ${para2(x.elden)} = <strong>${para2(x.toplam)}</strong></div>`.s;
  };
  form.addEventListener('input', guncelle); form.addEventListener('change', guncelle); guncelle();
}
