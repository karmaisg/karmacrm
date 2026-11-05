// OSGB 360 - İdari İşler: özlük belgeleri, personel izinleri, şirket araçları, şirket belgeleri.
import { html, bugun, tarih, para2, ondalik, trSirala } from '../lib/format.js';
import { icon } from '../ui/icons.js';
import { pill, emptyState, field, openFormModal, confirmDialog, toast } from '../ui/components.js';
import { humanError } from '../lib/api.js';
import { bosIseNull } from '../lib/veri.js';
import { izinHakki, isGunuSayisi } from '../lib/izin.js';
import { OZLUK_BELGELERI, BELGE_TURU, ARAC_KAYDI, KABUL, dosyaDogrula, dosyaTuru, boyutMetni, sureDurumu, plakaDuzelt, plakaGecerli } from '../lib/idari.js';

const SEKMELER = [
  { id: 'ozluk', ad: 'Özlük belgeleri', simge: 'folder' }, { id: 'izin', ad: 'Personel izinleri', simge: 'calendar' },
  { id: 'arac', ad: 'Şirket araçları', simge: 'car' }, { id: 'sirket', ad: 'Şirket belgeleri', simge: 'building' },
];
const durum = { sekme: 'ozluk', kisi: '', arac: '' };   // sayfa yenilense de seçim korunur

const sureHap = (bitis, bugunStr) => {
  const s = sureDurumu(bitis, bugunStr);
  if (s.durum === 'yok') return '';
  const ton = { gecmis: 'danger', yakin: 'warning', gecerli: 'success' }[s.durum];
  const yazi = s.durum === 'gecmis' ? `${tarih(bitis)} · süresi geçti` : s.durum === 'yakin' ? `${tarih(bitis)} · ${s.gun} gün kaldı` : `${tarih(bitis)} tarihine kadar`;
  return pill(yazi, ton);
};

// ---------------------------------------------------------------- belge yükleme formu
function belgeFormuAc(app, { kapsam, kisiId = null, aracId = null, kayitId = null, turler = null, tur = 'diger', baslik, baslikGoster = false, baslikZorunlu = false, gecerlilik = true }) {
  openFormModal({
    baslik, altBaslik: 'PDF veya resim (JPG, PNG, WEBP); en çok 10 MB.', boyut: 'md', gonderEtiketi: 'Belgeyi yükle',
    govde: html`${turler ? field({ ad: 'doc_type', etiket: 'Belge türü', zorunlu: true, deger: tur, secenekler: turler.map((t) => ({ deger: t, etiket: BELGE_TURU[t] })) }) : ''}
      ${baslikGoster ? field({ ad: 'title', etiket: baslikZorunlu ? 'Belge adı' : 'Belge adı (isteğe bağlı)', zorunlu: baslikZorunlu, maksUzunluk: 200, tam: true }) : ''}
      ${field({ ad: 'doc_date', etiket: 'Belge tarihi', tur: 'date' })}
      ${gecerlilik ? field({ ad: 'valid_until', etiket: 'Geçerlilik bitişi', tur: 'date', ipucu: 'Varsa; süresi yaklaşınca işaretlenir.' }) : ''}
      ${field({ ad: 'description', etiket: 'Açıklama', tur: 'textarea', tam: true, maksUzunluk: 2000 })}
      ${field({ ad: 'file', etiket: 'Dosya', tur: 'file', zorunlu: true, kabul: KABUL, tam: true })}`,
    async onSubmit(fd) {
      const g = (k) => String(fd.get(k) ?? '').trim(); const h = {};
      const dosya = fd.get('file'); const hata = dosyaDogrula(dosya);
      const dt = turler ? g('doc_type') : tur;
      if (hata) h.file = hata;
      if (baslikZorunlu && !g('title')) h.title = 'Belge adını yazın.';
      if (g('doc_date') && g('valid_until') && g('valid_until') < g('doc_date')) h.valid_until = 'Bitiş tarihi belge tarihinden önce olamaz.';
      if (Object.keys(h).length) return { errors: h };
      await app.api.uploadAdminDocument({
        kurum: app.ctx.org.id, dosya, tur: dosyaTuru(dosya),
        alanlar: { scope: kapsam, employee_id: kisiId, vehicle_id: aracId, vehicle_record_id: kayitId, doc_type: dt, title: bosIseNull(g('title')),
          doc_date: bosIseNull(g('doc_date')), valid_until: bosIseNull(g('valid_until')), description: bosIseNull(g('description')) },
      });
      toast('Belge yüklendi.');
    },
    onDone: () => app.yenile(),
  });
}

async function belgeAc(app, d) {
  try {
    const url = await app.api.adminDocumentUrl(d.storage_path);
    const a = document.createElement('a'); a.href = url; a.target = '_blank'; a.rel = 'noopener'; a.download = d.file_name;
    document.body.append(a); a.click(); a.remove();
  } catch (e) { toast(humanError(e), 'hata'); }
}

// ---------------------------------------------------------------- izin ve araç formları
function izinFormuAc(app, { kisi, kayit = null, izinler }) {
  const duzenle = kayit !== null; let elle = duzenle;
  const m = openFormModal({
    baslik: duzenle ? 'İzin kaydını düzenle' : 'İzin ekle', altBaslik: `${kisi.full_name} · gün sayısı hafta içi günlerden otomatik hesaplanır, resmî tatil varsa elle düzeltin.`, gonderEtiketi: duzenle ? 'Değişiklikleri kaydet' : 'İzni kaydet',
    govde: html`${field({ ad: 'start_date', etiket: 'İzin başlangıcı', tur: 'date', zorunlu: true, deger: kayit?.start_date ?? '' })}
      ${field({ ad: 'end_date', etiket: 'İzin bitişi (son izinli gün)', tur: 'date', zorunlu: true, deger: kayit?.end_date ?? '' })}
      ${field({ ad: 'days', etiket: 'Kullanılan izin (iş günü)', tur: 'number', min: 0.5, max: 366, adim: 0.5, inputmode: 'decimal', zorunlu: true, deger: kayit?.days ?? '', ipucu: 'Yarım gün için 0,5 girilebilir.' })}
      ${field({ ad: 'note', etiket: 'Not', tur: 'textarea', tam: true, maksUzunluk: 1000, deger: kayit?.note ?? '' })}`,
    async onSubmit(fd) {
      const g = (k) => String(fd.get(k) ?? '').trim(); const h = {};
      if (!g('start_date')) h.start_date = 'Başlangıç tarihini seçin.';
      if (!g('end_date')) h.end_date = 'Bitiş tarihini seçin.';
      if (g('start_date') && g('end_date') && g('end_date') < g('start_date')) h.end_date = 'Bitiş, başlangıçtan önce olamaz.';
      const gun = Number(g('days').replace(',', '.'));
      if (!(gun > 0 && gun <= 366)) h.days = 'Gün sayısı 0 ile 366 arasında olmalıdır.';
      else if (Math.round(gun * 2) !== gun * 2) h.days = 'Gün sayısı tam veya yarım gün olmalıdır.';
      if (!Object.keys(h).length && izinler.some((i) => i.id !== kayit?.id && i.employee_id === kisi.id && i.start_date <= g('end_date') && i.end_date >= g('start_date'))) h.start_date = 'Bu tarihlerde bu personelin başka bir izin kaydı var.';
      if (Object.keys(h).length) return { errors: h };
      const d = { start_date: g('start_date'), end_date: g('end_date'), days: gun, note: bosIseNull(g('note')) };
      if (duzenle) await app.api.updateLeave(kayit.id, d); else await app.api.createLeave({ ...d, employee_id: kisi.id });
      toast(duzenle ? 'İzin güncellendi.' : 'İzin kaydedildi.');
    },
    onDone: () => app.yenile(),
  });
  const form = m.el.querySelector('form');
  form.addEventListener('input', (e) => {
    if (e.target.name === 'days') { elle = true; return; }
    if (elle || (e.target.name !== 'start_date' && e.target.name !== 'end_date')) return;
    const n = isGunuSayisi(form.elements.start_date.value, form.elements.end_date.value);
    if (n > 0) form.elements.days.value = n;
  });
  form.addEventListener('change', (e) => {   // tarih seçicide "input" bazı tarayıcılarda geç tetiklenir
    if (elle || (e.target.name !== 'start_date' && e.target.name !== 'end_date')) return;
    const n = isGunuSayisi(form.elements.start_date.value, form.elements.end_date.value);
    if (n > 0) form.elements.days.value = n;
  });
}

function aracFormuAc(app, kayit = null) {
  const duzenle = kayit !== null;
  openFormModal({
    baslik: duzenle ? 'Aracı düzenle' : 'Araç ekle', altBaslik: 'Plaka ve marka ile tanımlanır; ruhsat, sigorta, bakım gibi kayıtlar sonra eklenir.', gonderEtiketi: duzenle ? 'Değişiklikleri kaydet' : 'Aracı ekle',
    govde: html`${field({ ad: 'plate', etiket: 'Plaka', zorunlu: true, maksUzunluk: 15, deger: kayit?.plate ?? '', yerTutucu: 'Örn. 34 ABC 123' })}
      ${field({ ad: 'brand', etiket: 'Marka', zorunlu: true, maksUzunluk: 80, deger: kayit?.brand ?? '' })}
      ${field({ ad: 'model', etiket: 'Model', maksUzunluk: 80, deger: kayit?.model ?? '' })}
      ${field({ ad: 'model_year', etiket: 'Model yılı', tur: 'number', min: 1950, max: 2100, adim: 1, inputmode: 'numeric', deger: kayit?.model_year ?? '' })}
      ${field({ ad: 'note', etiket: 'Not', tur: 'textarea', tam: true, maksUzunluk: 1000, deger: kayit?.note ?? '' })}`,
    async onSubmit(fd) {
      const g = (k) => String(fd.get(k) ?? '').trim(); const h = {};
      if (!plakaGecerli(g('plate'))) h.plate = 'Geçerli bir plaka girin (harf ve rakam).';
      if (!g('brand')) h.brand = 'Markayı yazın.';
      if (g('model_year') && !(/^\d{4}$/.test(g('model_year')) && Number(g('model_year')) >= 1950 && Number(g('model_year')) <= 2100)) h.model_year = 'Model yılı 4 haneli olmalıdır.';
      if (Object.keys(h).length) return { errors: h };
      const d = { plate: plakaDuzelt(g('plate')), brand: g('brand'), model: bosIseNull(g('model')), model_year: g('model_year') ? Number(g('model_year')) : null, note: bosIseNull(g('note')) };
      if (duzenle) await app.api.updateVehicle(kayit.id, d); else { const y = await app.api.createVehicle(d); durum.arac = y.id; }
      toast(duzenle ? 'Araç güncellendi.' : 'Araç eklendi.');
    },
    onDone: () => app.yenile(),
  });
}

function aracKaydiFormuAc(app, { arac, kayit = null }) {
  const duzenle = kayit !== null;
  openFormModal({
    baslik: duzenle ? 'Araç kaydını düzenle' : `${arac.plate} · kayıt ekle`, altBaslik: 'Ruhsat, trafik sigortası, kasko, bakım, muayene veya "Diğer" ile istediğiniz ek veriyi girin.', boyut: 'lg', gonderEtiketi: duzenle ? 'Değişiklikleri kaydet' : 'Kaydı ekle',
    govde: html`${field({ ad: 'kind', etiket: 'Kayıt türü', zorunlu: true, deger: kayit?.kind ?? 'trafik_sigortasi', secenekler: Object.entries(ARAC_KAYDI).map(([deger, etiket]) => ({ deger, etiket })) })}
      ${field({ ad: 'label', etiket: 'Ad (Diğer için zorunlu)', maksUzunluk: 120, deger: kayit?.label ?? '', ipucu: 'Örn. Lastik değişimi, HGS, yangın söndürücü.' })}
      ${field({ ad: 'record_date', etiket: 'Başlangıç / yapıldığı tarih', tur: 'date', deger: kayit?.record_date ?? '' })}
      ${field({ ad: 'expiry_date', etiket: 'Bitiş / sonraki tarih', tur: 'date', deger: kayit?.expiry_date ?? '', ipucu: 'Poliçe bitişi, ruhsat/muayene geçerliliği veya sonraki bakım tarihi.' })}
      ${field({ ad: 'amount', etiket: 'Tutar (TL)', tur: 'number', min: 0, adim: '0.01', inputmode: 'decimal', deger: kayit?.amount ?? '' })}
      ${field({ ad: 'value_text', etiket: 'Ek bilgi (poliçe no, km vb.)', maksUzunluk: 300, deger: kayit?.value_text ?? '' })}
      ${field({ ad: 'note', etiket: 'Not', tur: 'textarea', tam: true, maksUzunluk: 1000, deger: kayit?.note ?? '' })}`,
    async onSubmit(fd) {
      const g = (k) => String(fd.get(k) ?? '').trim(); const h = {};
      if (g('kind') === 'diger' && !g('label')) h.label = '"Diğer" kayıtları için ad yazın.';
      if (g('record_date') && g('expiry_date') && g('expiry_date') < g('record_date')) h.expiry_date = 'Bitiş tarihi başlangıçtan önce olamaz.';
      if (g('amount') !== '' && !(Number(g('amount')) >= 0)) h.amount = 'Tutar sıfır veya daha büyük olmalıdır.';
      if (Object.keys(h).length) return { errors: h };
      const d = { kind: g('kind'), label: bosIseNull(g('label')), record_date: bosIseNull(g('record_date')), expiry_date: bosIseNull(g('expiry_date')),
        amount: g('amount') === '' ? null : Number(g('amount')), value_text: bosIseNull(g('value_text')), note: bosIseNull(g('note')) };
      if (duzenle) await app.api.updateVehicleRecord(kayit.id, d); else await app.api.createVehicleRecord({ ...d, vehicle_id: arac.id });
      toast(duzenle ? 'Kayıt güncellendi.' : 'Kayıt eklendi.');
    },
    onDone: () => app.yenile(),
  });
}

// ---------------------------------------------------------------- sayfa
export async function idariSayfasi(app) {
  const bugunStr = bugun();
  const [calisanlar, belgeler, izinler, araclar, kayitlar] = await Promise.all([
    app.can('staff', 'view') ? app.api.listEmployees() : [], app.api.listAdminDocuments(), app.api.listLeaves(), app.api.listVehicles(), app.api.listVehicleRecords(),
  ]);
  const yaz = app.can('admin_affairs', 'create'); const duzenler = app.can('admin_affairs', 'edit'); const arsivler = app.can('admin_affairs', 'archive');
  const personel = calisanlar.filter((p) => !p.archived_at).sort((a, b) => trSirala(a.full_name, b.full_name));
  const canliBelge = belgeler.filter((d) => !d.archived_at);
  if (!personel.some((p) => p.id === durum.kisi)) durum.kisi = personel[0]?.id ?? '';
  if (!araclar.some((a) => a.id === durum.arac)) durum.arac = araclar[0]?.id ?? '';
  const kisi = () => personel.find((p) => p.id === durum.kisi) ?? null;

  const belgeListesi = (liste) => liste.length ? html`<ul class="belge-liste">${liste.map((d) => html`<li>
      <button type="button" class="link-btn" data-indir="${d.id}" title="Aç / indir">${icon('download', 15)} ${d.title || d.file_name}</button>
      <small class="muted">${d.doc_date ? tarih(d.doc_date) : tarih(String(d.created_at).slice(0, 10))} · ${boyutMetni(d.size_bytes)}</small> ${sureHap(d.valid_until, bugunStr)}
      ${arsivler ? html`<button type="button" class="icon-btn" data-belge-arsiv="${d.id}" aria-label="Belgeyi arşivle" title="Arşivle">${icon('archive', 15)}</button>` : ''}
      ${d.description ? html`<small class="block muted">${d.description}</small>` : ''}</li>`)}</ul>` : html`<span class="muted">—</span>`;

  const kisiSecici = () => html`<div class="toolbar"><label class="select-inline"><span class="sr-only">Personel</span><select id="idari-kisi">
    ${personel.map((p) => html`<option value="${p.id}" ${p.id === durum.kisi ? html`selected` : ''}>${p.full_name}</option>`)}</select></label></div>`;
  const personelYok = () => emptyState({ simge: 'users', baslik: 'Personel kaydı yok', metin: 'Önce Uzmanlar, Hekimler veya Diğer personel menüsünden personel ekleyin.' });

  // ---- 1) özlük
  const ozluk = () => {
    const p = kisi(); if (!p) return html`<section class="card card-flush">${personelYok()}</section>`;
    const belgesi = canliBelge.filter((d) => d.scope === 'personel' && d.employee_id === p.id);
    const yuklu = Object.keys(OZLUK_BELGELERI).filter((t) => belgesi.some((d) => d.doc_type === t)).length;
    const diger = belgesi.filter((d) => d.doc_type === 'diger');
    return html`<section class="card card-flush">${kisiSecici()}
      <div class="table-wrap"><table class="table"><thead><tr><th scope="col">Belge</th><th scope="col">Durum</th><th scope="col">Yüklenen dosyalar</th><th scope="col"><span class="sr-only">Eylemler</span></th></tr></thead><tbody>
      ${Object.entries(OZLUK_BELGELERI).map(([t, ad]) => { const l = belgesi.filter((d) => d.doc_type === t); return html`<tr data-belge-tur="${t}"><td><strong>${ad}</strong></td><td>${l.length ? pill('Yüklü', 'success') : pill('Eksik', 'warning')}</td><td>${belgeListesi(l)}</td>
        <td class="actions">${yaz ? html`<button type="button" class="btn btn-secondary btn-sm" data-yukle="${t}">${icon('upload', 16)} Yükle</button>` : ''}</td></tr>`; })}
      <tr data-belge-tur="diger"><td><strong>Diğer belgeler</strong><small class="block muted">Belge adını kendiniz yazarsınız</small></td><td>${diger.length ? pill(`${diger.length} belge`, 'info') : pill('—', 'neutral')}</td><td>${belgeListesi(diger)}</td>
        <td class="actions">${yaz ? html`<button type="button" class="btn btn-secondary btn-sm" data-yukle="diger">${icon('plus', 16)} Başka belge</button>` : ''}</td></tr>
      </tbody></table></div>
      <p class="fine pad">${p.full_name}: ${yuklu} / ${Object.keys(OZLUK_BELGELERI).length} standart belge yüklü.</p></section>`;
  };

  // ---- 2) izin
  const hesapla = (p) => izinHakki({ baslangic: p.start_date, dogum: p.birth_date, ayrilis: p.end_date, bugun: bugunStr, izinler: izinler.filter((i) => i.employee_id === p.id) });
  const izin = () => {
    const p = kisi(); if (!p) return html`<section class="card card-flush">${personelYok()}</section>`;
    const r = hesapla(p); const liste = izinler.filter((i) => i.employee_id === p.id);
    const kutu = (e, d, a) => html`<section class="card kpi"><div><div class="kpi-l">${e}</div><div class="kpi-v">${d}</div><div class="kpi-s">${a}</div></div></section>`;
    const ozet = r.gecerli ? html`<div class="kpi-grid pad">${kutu('Toplam hak', `${ondalik(r.toplamHak)} gün`, `${r.yillar.length} yıllık hak`)}${kutu('Kullanılan', `${ondalik(r.toplamKullanilan)} gün`, `${liste.length} kayıt`)}
      ${kutu('Kalan', `${ondalik(r.kalan)} gün`, r.fazla ? 'hak aşıldı' : 'kullanılabilir')}${kutu('Sonraki hak', r.sonraki ? `${r.sonraki.gun} gün` : '—', r.sonraki ? `${tarih(r.sonraki.tarih)} tarihinde` : 'personel ayrılmış')}</div>` : '';
    return html`<section class="card card-flush">${kisiSecici()}
      ${r.uyarilar.map((u) => html`<div class="notice notice-warn pad-notice" role="status">${icon('alert', 16)} ${u}</div>`)}${ozet}</section>
      <section class="card card-flush pad-t-card"><div class="card-head"><h2 class="card-title">Yıl yıl izin hakkı</h2></div>
      ${r.yillar.length ? html`<div class="table-wrap"><table class="table" id="izin-yillik"><thead><tr><th scope="col">Yıl</th><th scope="col">Çalışma dönemi</th><th scope="col">Hak edildiği tarih</th><th scope="col" class="num">Hak (iş günü)</th><th scope="col" class="num">Kullanılan</th><th scope="col" class="num">Kalan</th></tr></thead><tbody>
        ${r.yillar.map((y) => html`<tr><td>${y.no}. yıl</td><td>${tarih(y.donemBas)} – ${tarih(y.donemBit)}</td><td>${tarih(y.hakTarihi)}</td><td class="num">${ondalik(y.hakGun)}${y.yasKurali ? html`<small class="block muted">yaş kuralı (${y.yas} yaş)</small>` : ''}</td><td class="num">${ondalik(y.kullanilan)}</td><td class="num">${ondalik(y.kalan)}</td></tr>`)}</tbody></table></div>`
    : emptyState({ simge: 'calendar', baslik: 'Henüz hak edilmiş yıllık izin yok', metin: r.gecerli ? `İlk hak ${r.sonraki ? tarih(r.sonraki.tarih) : '—'} tarihinde doğar (1 yıl çalışma sonrası).` : 'İşe başlama tarihi girildiğinde hesaplanır.' })}
      <p class="fine pad">Hak, işe başlama tarihinin her yıldönümünde doğar. 1–5 yıl (5 dahil) 14, 5–15 yıl 20, 15 yıl ve üzeri 26 iş günü; hak edildiği tarihte 18 yaşından küçük veya 50 yaşında/üzerinde olanlara en az 20 gün. Kullanılan izin en eski haktan düşülür.</p></section>
      <section class="card card-flush pad-t-card"><div class="card-head"><h2 class="card-title">Kullanılan izinler</h2>${yaz && p.start_date ? html`<button type="button" class="btn btn-primary btn-sm" data-izin-ekle>${icon('plus', 16)} İzin ekle</button>` : ''}</div>
      ${liste.length ? html`<div class="table-wrap"><table class="table"><thead><tr><th scope="col">Tarih aralığı</th><th scope="col" class="num">İş günü</th><th scope="col" class="hide-sm">Not</th><th scope="col"><span class="sr-only">Eylemler</span></th></tr></thead><tbody>
        ${liste.map((i) => html`<tr><td>${tarih(i.start_date)} – ${tarih(i.end_date)}</td><td class="num">${ondalik(Number(i.days))}</td><td class="hide-sm">${i.note ?? ''}</td><td class="actions">
          ${duzenler ? html`<button type="button" class="icon-btn" data-izin-duzenle="${i.id}" aria-label="İzni düzenle" title="Düzenle">${icon('pencil', 16)}</button>` : ''}
          ${arsivler ? html`<button type="button" class="icon-btn" data-izin-arsiv="${i.id}" aria-label="İzni sil" title="Arşivle">${icon('archive', 16)}</button>` : ''}</td></tr>`)}</tbody></table></div>`
    : html`<p class="fine pad">Bu personel için izin kaydı yok.</p>`}</section>
      <section class="card card-flush pad-t-card"><div class="card-head"><h2 class="card-title">Tüm personel özeti</h2></div><div class="table-wrap"><table class="table" id="izin-ozet"><thead><tr><th scope="col">Personel</th><th scope="col">İşe başlama</th><th scope="col" class="num">Hak</th><th scope="col" class="num">Kullanılan</th><th scope="col" class="num">Kalan</th></tr></thead><tbody>
      ${personel.map((q) => { const x = hesapla(q); return html`<tr><td><button type="button" class="link-btn" data-izin-kisi="${q.id}">${q.full_name}</button></td><td>${q.start_date ? tarih(q.start_date) : html`<span class="muted">girilmemiş</span>`}</td><td class="num">${x.gecerli ? ondalik(x.toplamHak) : '—'}</td><td class="num">${x.gecerli ? ondalik(x.toplamKullanilan) : '—'}</td><td class="num">${x.gecerli ? ondalik(x.kalan) : '—'}</td></tr>`; })}</tbody></table></div></section>`;
  };

  // ---- 3) araçlar
  const aracKayitlari = (a) => kayitlar.filter((k) => k.vehicle_id === a.id);
  const sonDurum = (a, tur) => {
    const l = aracKayitlari(a).filter((k) => k.kind === tur && k.expiry_date).sort((x, y) => String(y.expiry_date).localeCompare(String(x.expiry_date)))[0];
    return l ? sureHap(l.expiry_date, bugunStr) : html`<span class="muted">—</span>`;
  };
  const arac = () => {
    const sec = araclar.find((a) => a.id === durum.arac) ?? null;
    const liste = araclar.length ? html`<div class="table-wrap"><table class="table" id="arac-liste"><thead><tr><th scope="col">Plaka</th><th scope="col">Marka / model</th><th scope="col" class="hide-sm">Trafik sigortası</th><th scope="col" class="hide-sm">Kasko</th><th scope="col" class="hide-sm">Muayene</th><th scope="col"><span class="sr-only">Eylemler</span></th></tr></thead><tbody>
      ${araclar.map((a) => html`<tr class="${a.id === durum.arac ? 'row-on' : ''}"><td><button type="button" class="link-btn" data-arac-sec="${a.id}"><strong>${a.plate}</strong></button></td><td>${a.brand}${a.model ? ` ${a.model}` : ''}${a.model_year ? html`<small class="block muted">${a.model_year}</small>` : ''}</td>
        <td class="hide-sm">${sonDurum(a, 'trafik_sigortasi')}</td><td class="hide-sm">${sonDurum(a, 'kasko')}</td><td class="hide-sm">${sonDurum(a, 'muayene')}</td>
        <td class="actions">${duzenler ? html`<button type="button" class="icon-btn" data-arac-duzenle="${a.id}" aria-label="Aracı düzenle" title="Düzenle">${icon('pencil', 16)}</button>` : ''}
          ${arsivler ? html`<button type="button" class="icon-btn" data-arac-arsiv="${a.id}" aria-label="Aracı arşivle" title="Arşivle">${icon('archive', 16)}</button>` : ''}</td></tr>`)}</tbody></table></div>`
    : emptyState({ simge: 'car', baslik: 'Henüz araç tanımlanmadı', metin: 'Plaka ve marka ile araç ekleyin; sonra ruhsat, sigorta, kasko, bakım kayıtlarını ve belgelerini girin.', eylem: yaz ? html`<button type="button" class="btn btn-primary" data-arac-ekle>${icon('plus', 18)} Araç ekle</button>` : '' });
    let detay = '';
    if (sec) {
      const ks = aracKayitlari(sec); const aracBelge = canliBelge.filter((d) => d.scope === 'arac' && d.vehicle_id === sec.id);
      detay = html`<section class="card card-flush pad-t-card" id="arac-detay"><div class="card-head"><h2 class="card-title">${sec.plate} · ${sec.brand}${sec.model ? ` ${sec.model}` : ''}</h2>
        <div>${yaz ? html`<button type="button" class="btn btn-secondary btn-sm" data-arac-belge>${icon('upload', 16)} Araca belge yükle</button> <button type="button" class="btn btn-primary btn-sm" data-kayit-ekle>${icon('plus', 16)} Kayıt ekle</button>` : ''}</div></div>
        ${sec.note ? html`<p class="fine pad">${sec.note}</p>` : ''}
        ${ks.length ? html`<div class="table-wrap"><table class="table"><thead><tr><th scope="col">Kayıt</th><th scope="col">Tarih</th><th scope="col">Bitiş / sonraki</th><th scope="col" class="num hide-sm">Tutar</th><th scope="col">Belgeler</th><th scope="col"><span class="sr-only">Eylemler</span></th></tr></thead><tbody>
          ${ks.map((k) => html`<tr data-kayit="${k.id}"><td><strong>${k.kind === 'diger' ? k.label : ARAC_KAYDI[k.kind]}</strong>${k.kind !== 'diger' && k.label ? html`<small class="block muted">${k.label}</small>` : ''}${k.value_text ? html`<small class="block muted">${k.value_text}</small>` : ''}${k.note ? html`<small class="block muted">${k.note}</small>` : ''}</td>
            <td>${k.record_date ? tarih(k.record_date) : '—'}</td><td>${k.expiry_date ? sureHap(k.expiry_date, bugunStr) : '—'}</td><td class="num hide-sm">${k.amount === null ? '—' : para2(k.amount)}</td>
            <td>${belgeListesi(aracBelge.filter((d) => d.vehicle_record_id === k.id))}${yaz ? html`<button type="button" class="link-btn" data-kayit-belge="${k.id}">${icon('upload', 14)} Belge yükle</button>` : ''}</td>
            <td class="actions">${duzenler ? html`<button type="button" class="icon-btn" data-kayit-duzenle="${k.id}" aria-label="Kaydı düzenle" title="Düzenle">${icon('pencil', 16)}</button>` : ''}
              ${arsivler ? html`<button type="button" class="icon-btn" data-kayit-arsiv="${k.id}" aria-label="Kaydı arşivle" title="Arşivle">${icon('archive', 16)}</button>` : ''}</td></tr>`)}</tbody></table></div>`
      : html`<p class="fine pad">Bu araç için kayıt yok. Ruhsat, trafik sigortası, kasko, bakım gibi kayıtları ekleyin.</p>`}
        ${aracBelge.some((d) => !d.vehicle_record_id) ? html`<div class="pad"><strong>Araca bağlı genel belgeler</strong>${belgeListesi(aracBelge.filter((d) => !d.vehicle_record_id))}</div>` : ''}</section>`;
    }
    return html`<section class="card card-flush"><div class="card-head"><h2 class="card-title">Araçlar</h2>${yaz && araclar.length ? html`<button type="button" class="btn btn-primary btn-sm" data-arac-ekle>${icon('plus', 16)} Araç ekle</button>` : ''}</div>${liste}</section>${detay}`;
  };

  // ---- 4) şirket belgeleri
  const sirket = () => {
    const l = canliBelge.filter((d) => d.scope === 'sirket');
    return html`<section class="card card-flush"><div class="card-head"><h2 class="card-title">Şirket belgeleri</h2>${yaz ? html`<button type="button" class="btn btn-primary btn-sm" data-sirket-belge>${icon('plus', 16)} Belge yükle</button>` : ''}</div>
      ${l.length ? html`<div class="table-wrap"><table class="table" id="sirket-liste"><thead><tr><th scope="col">Belge adı</th><th scope="col">Tarih</th><th scope="col" class="hide-sm">Açıklama</th><th scope="col">Dosya</th><th scope="col"><span class="sr-only">Eylemler</span></th></tr></thead><tbody>
        ${l.map((d) => html`<tr><td><strong>${d.title}</strong></td><td>${d.doc_date ? tarih(d.doc_date) : '—'}</td><td class="hide-sm">${d.description ?? ''}</td>
          <td><button type="button" class="link-btn" data-indir="${d.id}">${icon('download', 15)} ${d.file_name}</button><small class="block muted">${boyutMetni(d.size_bytes)}</small></td>
          <td class="actions">${arsivler ? html`<button type="button" class="icon-btn" data-belge-arsiv="${d.id}" aria-label="Belgeyi arşivle" title="Arşivle">${icon('archive', 16)}</button>` : ''}</td></tr>`)}</tbody></table></div>`
    : emptyState({ simge: 'building', baslik: 'Henüz şirket belgesi yok', metin: 'Şirketle ilgili belgeleri (PDF veya resim) adı, tarihi ve açıklamasıyla yükleyin.', eylem: yaz ? html`<button type="button" class="btn btn-primary" data-sirket-belge>${icon('upload', 18)} Belge yükle</button>` : '' })}</section>`;
  };

  const govdeCiz = () => ({ ozluk, izin, arac, sirket })[durum.sekme]();
  const sekmeCubugu = () => html`<div class="tabs" role="tablist" aria-label="İdari işler bölümleri">${SEKMELER.map((s) => html`<button type="button" role="tab" class="tab ${durum.sekme === s.id ? 'tab-on' : ''}" aria-selected="${durum.sekme === s.id}" data-sekme="${s.id}">${icon(s.simge, 16)} ${s.ad}</button>`)}</div>`;

  return {
    baslik: 'İdari İşler', altBaslik: 'Özlük belgeleri, yıllık izinler, şirket araçları ve şirket belgeleri',
    govde: html`<div id="idari-sekmeler">${sekmeCubugu()}</div><div id="idari-icerik">${govdeCiz()}</div>`,
    mount(kok) {
      const ic = kok.querySelector('#idari-icerik'); const sb = kok.querySelector('#idari-sekmeler');
      const ciz = () => { sb.innerHTML = sekmeCubugu().s; ic.innerHTML = govdeCiz().s; };
      const bul = (liste, id) => liste.find((x) => x.id === id);
      const belgeTurleri = ['ruhsat', 'trafik_sigortasi', 'kasko', 'bakim', 'diger'];
      kok.addEventListener('change', (e) => {
        if (e.target.id === 'idari-kisi') { durum.kisi = e.target.value; ciz(); }
      });
      kok.addEventListener('click', async (e) => {
        const t = e.target; const a = (s) => t.closest(`[${s}]`);
        let x;
        if ((x = a('data-sekme'))) { durum.sekme = x.dataset.sekme; ciz(); return; }
        if ((x = a('data-indir'))) { const d = bul(belgeler, x.dataset.indir); if (d) await belgeAc(app, d); return; }
        if ((x = a('data-belge-arsiv'))) {
          const d = bul(belgeler, x.dataset.belgeArsiv); if (!d) return;
          if (!(await confirmDialog({ baslik: 'Belgeyi arşivle', onayEtiketi: 'Arşivle', tehlikeli: true, mesaj: 'Belge listeden kalkar; dosya silinmez, kayıt arşivde tutulur.' }))) return;
          try { await app.api.archiveAdminDocument(d.id); toast('Belge arşive alındı.'); app.yenile(); } catch (err) { toast(humanError(err), 'hata'); }
          return;
        }
        if ((x = a('data-yukle'))) {
          const p = kisi(); if (!p) return; const tur = x.dataset.yukle;
          belgeFormuAc(app, tur === 'diger'
            ? { kapsam: 'personel', kisiId: p.id, tur, baslik: `${p.full_name} · başka belge`, baslikGoster: true, baslikZorunlu: true }
            : { kapsam: 'personel', kisiId: p.id, tur, baslik: `${p.full_name} · ${OZLUK_BELGELERI[tur]}` });
          return;
        }
        if ((x = a('data-izin-kisi'))) { durum.kisi = x.dataset.izinKisi; ciz(); window.scrollTo(0, 0); return; }
        if (a('data-izin-ekle')) { const p = kisi(); if (p) izinFormuAc(app, { kisi: p, izinler }); return; }
        if ((x = a('data-izin-duzenle'))) { const p = kisi(); const i = bul(izinler, x.dataset.izinDuzenle); if (p && i) izinFormuAc(app, { kisi: p, kayit: i, izinler }); return; }
        if ((x = a('data-izin-arsiv'))) {
          const i = bul(izinler, x.dataset.izinArsiv); if (!i) return;
          if (!(await confirmDialog({ baslik: 'İzin kaydını sil', onayEtiketi: 'Sil', tehlikeli: true, mesaj: 'Bu izin kullanılan izinlerden düşülür ve kalan hak yeniden hesaplanır.' }))) return;
          try { await app.api.archiveLeave(i.id); toast('İzin kaydı kaldırıldı.'); app.yenile(); } catch (err) { toast(humanError(err), 'hata'); }
          return;
        }
        if (a('data-arac-ekle')) { aracFormuAc(app); return; }
        if ((x = a('data-arac-sec'))) { durum.arac = x.dataset.aracSec; ciz(); return; }
        if ((x = a('data-arac-duzenle'))) { const v = bul(araclar, x.dataset.aracDuzenle); if (v) aracFormuAc(app, v); return; }
        if ((x = a('data-arac-arsiv'))) {
          const v = bul(araclar, x.dataset.aracArsiv); if (!v) return;
          if (!(await confirmDialog({ baslik: 'Aracı arşivle', onayEtiketi: 'Arşivle', tehlikeli: true, mesaj: `${v.plate} araç listesinden kalkar; kayıtları ve belgeleri silinmez.` }))) return;
          try { await app.api.archiveVehicle(v.id); toast('Araç arşive alındı.'); app.yenile(); } catch (err) { toast(humanError(err), 'hata'); }
          return;
        }
        const v = bul(araclar, durum.arac);
        if (a('data-kayit-ekle')) { if (v) aracKaydiFormuAc(app, { arac: v }); return; }
        if ((x = a('data-kayit-duzenle'))) { const k = bul(kayitlar, x.dataset.kayitDuzenle); if (v && k) aracKaydiFormuAc(app, { arac: v, kayit: k }); return; }
        if ((x = a('data-kayit-arsiv'))) {
          const k = bul(kayitlar, x.dataset.kayitArsiv); if (!k) return;
          if (!(await confirmDialog({ baslik: 'Kaydı arşivle', onayEtiketi: 'Arşivle', tehlikeli: true, mesaj: 'Kayıt listeden kalkar; yüklenen belgeler silinmez.' }))) return;
          try { await app.api.archiveVehicleRecord(k.id); toast('Kayıt arşive alındı.'); app.yenile(); } catch (err) { toast(humanError(err), 'hata'); }
          return;
        }
        if (a('data-arac-belge')) { if (v) belgeFormuAc(app, { kapsam: 'arac', aracId: v.id, turler: belgeTurleri, tur: 'ruhsat', baslik: `${v.plate} · belge yükle`, baslikGoster: true }); return; }
        if ((x = a('data-kayit-belge'))) {
          const k = bul(kayitlar, x.dataset.kayitBelge); if (!v || !k) return;
          belgeFormuAc(app, { kapsam: 'arac', aracId: v.id, kayitId: k.id, tur: k.kind === 'diger' || k.kind === 'muayene' ? 'diger' : k.kind, baslik: `${v.plate} · ${ARAC_KAYDI[k.kind]} belgesi`,
            baslikGoster: k.kind === 'diger' || k.kind === 'muayene', baslikZorunlu: k.kind === 'diger' || k.kind === 'muayene' });
          return;
        }
        if (a('data-sirket-belge')) belgeFormuAc(app, { kapsam: 'sirket', baslik: 'Şirket belgesi yükle', baslikGoster: true, baslikZorunlu: true, gecerlilik: false });
      });
    },
  };
}
