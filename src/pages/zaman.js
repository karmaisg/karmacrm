// OSGB 360 - Zaman ve ziyaret takibi: fiilî çalışma, yol ve bekleme süreleri; çakışma kontrolü.
import { html, bugun, tarih, ayBasi, ayAdi, sayi, trSirala, gunEkle } from '../lib/format.js';
import { icon } from '../ui/icons.js';
import { emptyState, field, openFormModal, confirmDialog, toast, sayfalama } from '../ui/components.js';
import { FAALIYET, PERSONEL_TURU_KISA, ayBitisi, aktifMi, zamanOzeti, sureMetni, zamanCakisiyor } from '../lib/operasyon.js';
import { bosIseNull } from '../lib/veri.js';
import { humanError } from '../lib/api.js';

const SAYFA_BASI = 30;
const saatMetni = (iso) => { const d = new Date(iso); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
const yerelGun = (iso) => bugun(new Date(iso));
const birlestir = (gun, saat) => new Date(`${gun}T${saat}`);

export async function zamanFormuAc(app, { kayit = null, bas = null, bit = null, onDone = null } = {}) {
  const duzenle = kayit !== null;
  let personel = [], firmalar = [], atamalar = [], mevcut = [];
  const aralikBas = bas ?? gunEkle(bugun(), -45);
  const aralikBit = bit ?? gunEkle(bugun(), 1);
  try {
    [personel, firmalar, atamalar, mevcut] = await Promise.all([
      app.api.listStaff(), app.can('companies', 'view') ? app.api.listCompanies() : [],
      app.can('assignments', 'view') ? app.api.listAssignments() : [], app.api.listTimeEntries(aralikBas, aralikBit),
    ]);
  } catch (e) { toast(humanError(e), 'hata'); return; }
  personel = personel.filter((p) => !p.archived_at && (p.is_active || p.id === kayit?.employee_id));
  if (!personel.length) { toast('Zaman girilecek aktif personel bulunamadı. Hesabınız bir personel kaydına bağlı olmayabilir.', 'hata'); return; }
  const tekKisi = personel.length === 1;
  const firmaSec = [{ deger: '', etiket: 'Firma yok (yol / idari)' }].concat(firmalar.filter((f) => !f.archived_at || f.id === kayit?.company_id).sort((a, b) => trSirala(a.name, b.name)).map((f) => ({ deger: f.id, etiket: f.name })));
  const v = (k, y = '') => kayit?.[k] ?? y;
  const gunDeger = kayit ? yerelGun(kayit.start_at) : bugun();
  const m = openFormModal({
    baslik: duzenle ? 'Zaman kaydını düzenle' : 'Zaman kaydı ekle', altBaslik: 'Toplam süre başlangıç ve bitişten hesaplanır; dakikaları saha, yol, bekleme, rapor ve idari olarak dağıtın.', boyut: 'lg',
    gonderEtiketi: duzenle ? 'Değişiklikleri kaydet' : 'Kaydet',
    govde: html`${field({ ad: 'employee_id', etiket: 'Personel', zorunlu: true, deger: kayit?.employee_id ?? (tekKisi ? personel[0].id : ''), pasif: duzenle || tekKisi,
      secenekler: (tekKisi ? [] : [{ deger: '', etiket: 'Seçiniz' }]).concat(personel.sort((a, b) => trSirala(a.full_name, b.full_name)).map((p) => ({ deger: p.id, etiket: `${p.full_name} (${PERSONEL_TURU_KISA[p.staff_type]})` }))) })}
      ${field({ ad: 'company_id', etiket: 'Firma', deger: v('company_id'), secenekler: firmaSec })}
      ${field({ ad: 'activity_type', etiket: 'Faaliyet', zorunlu: true, deger: v('activity_type', 'ziyaret'), secenekler: Object.entries(FAALIYET).map(([deger, etiket]) => ({ deger, etiket })) })}
      ${field({ ad: 'gun', etiket: 'Tarih', tur: 'date', zorunlu: true, deger: gunDeger })}
      ${field({ ad: 'baslangic', etiket: 'Başlangıç saati', tur: 'time', zorunlu: true, deger: kayit ? saatMetni(kayit.start_at) : '09:00' })}
      ${field({ ad: 'bitis', etiket: 'Bitiş saati', tur: 'time', zorunlu: true, deger: kayit ? saatMetni(kayit.end_at) : '12:00' })}
      ${field({ ad: 'onsite_minutes', etiket: 'Sahada (dk)', tur: 'number', min: 0, adim: 1, inputmode: 'numeric', deger: v('onsite_minutes', 180) })}
      ${field({ ad: 'travel_minutes', etiket: 'Yolda (dk)', tur: 'number', min: 0, adim: 1, inputmode: 'numeric', deger: v('travel_minutes', 0) })}
      ${field({ ad: 'waiting_minutes', etiket: 'Beklemede (dk)', tur: 'number', min: 0, adim: 1, inputmode: 'numeric', deger: v('waiting_minutes', 0) })}
      ${field({ ad: 'reporting_minutes', etiket: 'Raporlamada (dk)', tur: 'number', min: 0, adim: 1, inputmode: 'numeric', deger: v('reporting_minutes', 0) })}
      ${field({ ad: 'admin_minutes', etiket: 'İdari işte (dk)', tur: 'number', min: 0, adim: 1, inputmode: 'numeric', deger: v('admin_minutes', 0) })}
      <div class="field field-full" id="zaman-bilgi" aria-live="polite"></div>
      ${field({ ad: 'notes', etiket: 'Not', tur: 'textarea', tam: true, deger: v('notes'), maksUzunluk: 1000 })}`,
    async onSubmit(fd, form) {
      const g = (k) => String(fd.get(k) ?? '').trim();
      const kisi = form.elements.employee_id.value;
      const h = {};
      if (!kisi) h.employee_id = 'Personel seçin.';
      if (!g('gun')) h.gun = 'Tarihi seçin.';
      if (g('gun') && g('gun') > bugun()) h.gun = 'Gelecek tarihli kayıt girilemez.';
      if (!g('baslangic')) h.baslangic = 'Başlangıç saatini girin.';
      if (!g('bitis')) h.bitis = 'Bitiş saatini girin.';
      if (g('baslangic') && g('bitis') && g('bitis') <= g('baslangic')) h.bitis = 'Bitiş saati başlangıçtan sonra olmalıdır.';
      const dk = {};
      for (const k of ['onsite_minutes', 'travel_minutes', 'waiting_minutes', 'reporting_minutes', 'admin_minutes']) {
        if (g(k) !== '' && !/^\d{1,4}$/.test(g(k))) h[k] = 'Dakika 0 veya daha büyük bir tam sayı olmalıdır.';
        dk[k] = Number(g(k) || 0);
      }
      if (Object.keys(h).length) return { errors: h };
      const bas = birlestir(g('gun'), g('baslangic')); const bt = birlestir(g('gun'), g('bitis'));
      const toplam = Math.round((bt - bas) / 60000);
      const dagitilan = Object.values(dk).reduce((t, x) => t + x, 0);
      if (dagitilan > toplam) return { errors: { onsite_minutes: `Dağıtılan süre (${dagitilan} dk) toplam süreyi (${toplam} dk) aşıyor.` } };
      const cakisan = zamanCakisiyor(mevcut, kisi, bas.toISOString(), bt.toISOString(), kayit?.id ?? null);
      if (cakisan) return { formError: `Bu personelin ${tarih(yerelGun(cakisan.start_at))} ${saatMetni(cakisan.start_at)}–${saatMetni(cakisan.end_at)} saatleri arasında başka bir kaydı var.` };
      const degerler = { company_id: bosIseNull(g('company_id')), activity_type: g('activity_type'), start_at: bas.toISOString(), end_at: bt.toISOString(), ...dk, notes: bosIseNull(g('notes')) };
      if (duzenle) { await app.api.updateTimeEntry(kayit.id, degerler); toast('Zaman kaydı güncellendi.'); }
      else { await app.api.createTimeEntry({ ...degerler, employee_id: kisi, work_date: g('gun') }); toast('Zaman kaydı eklendi.'); }
    },
    onDone: () => (onDone ? onDone() : app.yenile()),
  });
  const form = m.el.querySelector('form');
  const bilgi = form.querySelector('#zaman-bilgi');
  const guncelle = () => {
    const g = (k) => String(form.elements[k]?.value ?? '').trim();
    let toplam = 0;
    if (g('gun') && g('baslangic') && g('bitis')) toplam = Math.round((birlestir(g('gun'), g('bitis')) - birlestir(g('gun'), g('baslangic'))) / 60000);
    const dagitilan = ['onsite_minutes', 'travel_minutes', 'waiting_minutes', 'reporting_minutes', 'admin_minutes'].reduce((t, k) => t + (Number(g(k)) || 0), 0);
    const notlar = [];
    const kisi = form.elements.employee_id.value; const firma = g('company_id');
    if (toplam <= 0) notlar.push(html`<div class="notice notice-warn" role="status">Bitiş saati başlangıçtan sonra olmalıdır.</div>`);
    else if (dagitilan > toplam) notlar.push(html`<div class="notice notice-warn" role="status">Dağıtılan süre toplamı aşıyor: ${sayi(dagitilan)} dk &gt; ${sayi(toplam)} dk.</div>`);
    else notlar.push(html`<div class="notice notice-info" role="status">Toplam süre ${sureMetni(toplam)} (${sayi(toplam)} dk); dağıtılan ${sayi(dagitilan)} dk, dağıtılmayan ${sayi(toplam - dagitilan)} dk.</div>`);
    if (toplam > 0) {
      const bas = birlestir(g('gun'), g('baslangic')).toISOString(); const bt = birlestir(g('gun'), g('bitis')).toISOString();
      const c = kisi ? zamanCakisiyor(mevcut, kisi, bas, bt, kayit?.id ?? null) : null;
      if (c) notlar.push(html`<div class="notice notice-warn" role="status">Çakışma: bu personelin ${saatMetni(c.start_at)}–${saatMetni(c.end_at)} arasında başka kaydı var.</div>`);
    }
    if (kisi && firma && g('gun') && app.can('assignments', 'view') && !atamalar.some((a) => a.employee_id === kisi && a.company_id === firma && aktifMi(a, g('gun')))) {
      notlar.push(html`<div class="notice notice-info" role="status">Bu personel bu firmaya ${tarih(g('gun'))} tarihinde görevlendirilmiş görünmüyor. Kayıt yine de eklenebilir.</div>`);
    }
    bilgi.innerHTML = notlar.map((n) => n.s).join('');
  };
  form.addEventListener('input', guncelle); form.addEventListener('change', guncelle);
  guncelle();
}

export async function zamanSayfasi(app) {
  const bugunStr = bugun();
  const durum = { ay: ayBasi(bugunStr), kisi: '', firma: '', sayfa: 1 };
  const [personel, firmalar] = await Promise.all([app.api.listStaff(), app.can('companies', 'view') ? app.api.listCompanies() : []]);
  const kisiAdi = new Map(personel.map((p) => [p.id, p]));
  const firmaAdi = new Map(firmalar.map((f) => [f.id, f.name]));
  let kayitlar = [];
  const yukle = async () => { kayitlar = await app.api.listTimeEntries(durum.ay, ayBitisi(durum.ay)); };
  await yukle();
  const olusturabilir = app.can('time', 'create');
  const duzenleyebilir = app.can('time', 'edit');
  const aySecenekleri = () => {
    const [y, mo] = bugunStr.split('-').map(Number);
    const l = [];
    for (let i = 0; i < 18; i += 1) { const t = new Date(y, mo - 1 - i, 1); l.push(`${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-01`); }
    return l;
  };

  const gorunen = () => kayitlar.filter((k) => !k.archived_at && (!durum.kisi || k.employee_id === durum.kisi) && (!durum.firma || k.company_id === durum.firma))
    .sort((a, b) => String(b.start_at).localeCompare(String(a.start_at)));
  const ozet = () => {
    const o = zamanOzeti(gorunen());
    const kutu = (e, d, a, s) => html`<section class="card kpi"><span class="kpi-ic">${icon(s, 22)}</span><div><div class="kpi-l">${e}</div><div class="kpi-v">${d}</div><div class="kpi-s">${a}</div></div></section>`;
    return html`<div class="kpi-grid">${kutu('Toplam süre', sureMetni(o.toplam), `${sayi(o.adet)} kayıt`, 'clock')}${kutu('Sahada', sureMetni(o.saha), 'firmada geçen süre', 'building')}
      ${kutu('Yolda ve beklemede', sureMetni(o.yol + o.bekleme), `yol ${sureMetni(o.yol)} · bekleme ${sureMetni(o.bekleme)}`, 'pin')}${kutu('Rapor ve idari', sureMetni(o.rapor + o.idari), `rapor ${sureMetni(o.rapor)} · idari ${sureMetni(o.idari)}`, 'file')}</div>`;
  };
  const satir = (k) => {
    const p = kisiAdi.get(k.employee_id);
    return html`<tr><td>${tarih(yerelGun(k.start_at))}<small class="block muted">${saatMetni(k.start_at)}–${saatMetni(k.end_at)}</small></td>
      <td class="hide-sm">${p ? p.full_name : 'Personel'}</td>
      <td>${k.company_id ? (firmaAdi.get(k.company_id) ? html`<a class="link" href="#/firmalar/${k.company_id}">${firmaAdi.get(k.company_id)}</a>` : 'Firma') : html`<span class="muted">—</span>`}<small class="block muted">${FAALIYET[k.activity_type] ?? k.activity_type}</small></td>
      <td class="num">${sureMetni(k.total_minutes)}</td>
      <td class="hide-md">${[k.onsite_minutes && `saha ${k.onsite_minutes}`, k.travel_minutes && `yol ${k.travel_minutes}`, k.waiting_minutes && `bekleme ${k.waiting_minutes}`, k.reporting_minutes && `rapor ${k.reporting_minutes}`, k.admin_minutes && `idari ${k.admin_minutes}`].filter(Boolean).join(' · ') || '—'}</td>
      <td class="actions">${duzenleyebilir ? html`<button type="button" class="icon-btn" data-zaman-eylem="duzenle" data-id="${k.id}" aria-label="Zaman kaydını düzenle" title="Düzenle">${icon('pencil', 16)}</button>` : ''}
        ${app.can('time', 'archive') ? html`<button type="button" class="icon-btn" data-zaman-eylem="arsiv" data-id="${k.id}" aria-label="Zaman kaydını arşivle" title="Arşivle">${icon('archive', 16)}</button>` : ''}</td></tr>`;
  };
  const tablo = () => {
    const l = gorunen();
    if (!l.length) {
      return emptyState({ simge: 'clock', baslik: `${ayAdi(durum.ay)} için zaman kaydı yok`, metin: 'Ziyaret, yol ve idari süreleri girdikçe fiilî çalışma ve kapasite analizi burada hesaplanır.',
        eylem: olusturabilir ? html`<button type="button" class="btn btn-primary" data-action="yeni-zaman">${icon('plus', 18)} Zaman kaydı ekle</button>` : '' });
    }
    const sayfaSayisi = Math.max(1, Math.ceil(l.length / SAYFA_BASI));
    durum.sayfa = Math.min(durum.sayfa, sayfaSayisi);
    return html`<div class="table-wrap"><table class="table"><thead><tr><th scope="col">Tarih ve saat</th><th scope="col" class="hide-sm">Personel</th><th scope="col">Firma / faaliyet</th><th scope="col" class="num">Süre</th><th scope="col" class="hide-md">Dağılım (dk)</th><th scope="col"><span class="sr-only">Eylemler</span></th></tr></thead>
      <tbody>${l.slice((durum.sayfa - 1) * SAYFA_BASI, durum.sayfa * SAYFA_BASI).map(satir)}</tbody></table></div>
      ${sayfalama({ sayfa: durum.sayfa, sayfaSayisi, toplam: l.length, sayfaBasi: SAYFA_BASI })}`;
  };

  return {
    baslik: 'Zaman ve ziyaret takibi', altBaslik: 'Fiilî çalışma, yol ve bekleme süreleri; aynı personelde zaman çakışması engellenir',
    eylemler: olusturabilir ? html`<button type="button" class="btn btn-primary" data-action="yeni-zaman">${icon('plus', 18)} Zaman kaydı ekle</button>` : '',
    govde: html`<div id="zaman-ozet">${ozet()}</div>
      <section class="card card-flush"><div class="toolbar">
        <label class="select-inline"><span class="sr-only">Ay</span><select id="zaman-ay">${aySecenekleri().map((a) => html`<option value="${a}" ${a === durum.ay ? html`selected` : ''}>${ayAdi(a)}</option>`)}</select></label>
        ${personel.length > 1 ? html`<label class="select-inline"><span class="sr-only">Personel</span><select id="zaman-kisi"><option value="">Tüm personel</option>${personel.map((p) => html`<option value="${p.id}">${p.full_name}</option>`)}</select></label>` : ''}
        ${firmalar.length ? html`<label class="select-inline"><span class="sr-only">Firma</span><select id="zaman-firma"><option value="">Tüm firmalar</option>${firmalar.filter((f) => !f.archived_at).sort((a, b) => trSirala(a.name, b.name)).map((f) => html`<option value="${f.id}">${f.name}</option>`)}</select></label>` : ''}
      </div><div id="zaman-tablo">${tablo()}</div></section>`,
    mount(kok) {
      const t = kok.querySelector('#zaman-tablo'); const o = kok.querySelector('#zaman-ozet');
      const ciz = () => { t.innerHTML = tablo().s; o.innerHTML = ozet().s; };
      kok.querySelector('#zaman-ay').addEventListener('change', async (e) => {
        durum.ay = e.target.value; durum.sayfa = 1;
        try { await yukle(); ciz(); } catch (err) { toast(humanError(err), 'hata'); }
      });
      kok.querySelector('#zaman-kisi')?.addEventListener('change', (e) => { durum.kisi = e.target.value; durum.sayfa = 1; ciz(); });
      kok.querySelector('#zaman-firma')?.addEventListener('change', (e) => { durum.firma = e.target.value; durum.sayfa = 1; ciz(); });
      kok.addEventListener('click', async (e) => {
        if (e.target.closest('[data-action="yeni-zaman"]')) { zamanFormuAc(app); return; }
        const sf = e.target.closest('[data-sayfa]');
        if (sf && !sf.disabled) { durum.sayfa = Number(sf.dataset.sayfa); ciz(); return; }
        const d = e.target.closest('[data-zaman-eylem]'); if (!d) return;
        const k = kayitlar.find((x) => x.id === d.dataset.id); if (!k) return;
        if (d.dataset.zamanEylem === 'duzenle') zamanFormuAc(app, { kayit: k });
        else {
          if (!(await confirmDialog({ baslik: 'Zaman kaydını arşivle', onayEtiketi: 'Arşivle', tehlikeli: true, mesaj: 'Kayıt toplamlara dahil edilmeyecek. Kayıt silinmez.' }))) return;
          try { await app.api.archiveTimeEntry(k.id); toast('Zaman kaydı arşive alındı.'); app.yenile(); } catch (err) { toast(humanError(err), 'hata'); }
        }
      });
    },
  };
}
