// OSGB 360 - Firma ve personel kârlılığı (aylık, yönetim tahmini). Hesap: lib/karlilik.js
import { html, bugun, tarih, para, para2, sayi, ondalik, ayAdi, ayBasi } from '../lib/format.js';
import { icon } from '../ui/icons.js';
import { pill, emptyState, openModal, toast } from '../ui/components.js';
import { hesaplaKarlilik, dagitimSatirlari, DAGITIM_OLCUTLERI, MALIYET_YONTEMLERI } from '../lib/karlilik.js';
import { PERSONEL_TURU_KISA, ayBitisi, sureMetni } from '../lib/operasyon.js';
import { ayarDegeri, kapasiteDakika } from '../lib/veri.js';
import { humanError } from '../lib/api.js';

const NOT = 'Bu sayfa yönetim amaçlı tahmindir; muhasebe, vergi beyanı veya mevzuat hesabı yerine geçmez. Gelir KDV hariç, hizmet dönemine göredir.';
const aySecenekleri = (bugunStr) => {
  const [y, mo] = bugunStr.split('-').map(Number); const l = [];
  for (let i = 0; i < 24; i += 1) { const t = new Date(y, mo - 1 - i, 1); l.push(`${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-01`); }
  return l;
};
const renk = (n) => (n < 0 ? 'neg' : '');
const tutar = (n) => html`<span class="${renk(n)}">${para2(n)}</span>`;

async function girdiYukle(app, ay) {
  const bit = ayBitisi(ay);
  const [firmalar, profiller, kurallar, ayarlar, faturalar, giderler, kategoriler, sozlesmeler, maliyetler, dagitimKurallari, kayitliDagitim, girdi] = await Promise.all([
    app.api.listCompanies(), app.api.listAllProfiles(), app.api.listServiceRules(), app.api.listSettings(),
    app.api.listInvoices(), app.api.listExpenses(), app.api.listExpenseCategories(),
    app.can('contracts', 'view') ? app.api.listContracts() : [],
    app.api.listAllEmployeeCosts(), app.api.listAllocationRules(), app.api.listAllocations(ay, bit), app.api.getProfitInputs(ay),
  ]);
  return {
    ay, firmalar, profiller, kurallar, faturalar, giderler, kategoriler, sozlesmeler, maliyetler, dagitimKurallari, kayitliDagitim,
    atamalar: girdi.atamalar, zaman: girdi.zaman, personeller: girdi.personeller,
    kapasiteVarsayilan: kapasiteDakika(ayarlar, ay), vergiOrani: Number(ayarDegeri(ayarlar, 'kurumlar_vergisi_orani', ay, 25)) || 25,
  };
}

const kilit = (baslik, metin) => ({ baslik, altBaslik: '', govde: emptyState({ simge: 'lock', baslik: 'Bu sayfa için gerekli izinler eksik', metin }) });
const izinliMi = (app, modul) => app.can(modul, 'view') && app.can('payroll', 'view') && app.can('expenses', 'view') && app.can('invoices', 'view');
const GEREKEN = 'Kârlılık; gelir (fatura), gider ve personel maliyeti verilerini birlikte kullanır. Faturalar, giderler ve maaş (personel maliyeti) görüntüleme izinleri de gerekir. İşletme sahibi Kullanıcılar ve yetkiler ekranından düzenleyebilir.';

function ustCubuk(durum) {
  return html`<div class="toolbar">
    <label class="select-inline"><span class="sr-only">Ay</span><select id="kar-ay">${aySecenekleri(bugun()).map((a) => html`<option value="${a}" ${a === durum.ay ? html`selected` : ''}>${ayAdi(a)}</option>`)}</select></label>
    <label class="select-inline"><span class="sr-only">Personel maliyeti yöntemi</span><select id="kar-yontem">${Object.entries(MALIYET_YONTEMLERI).map(([k, e]) => html`<option value="${k}" ${k === durum.yontem ? html`selected` : ''}>${e}</option>`)}</select></label>
  </div>`;
}
const kutu = (e, d, a, s) => html`<section class="card kpi"><span class="kpi-ic">${icon(s, 22)}</span><div><div class="kpi-l">${e}</div><div class="kpi-v">${d}</div><div class="kpi-s">${a}</div></div></section>`;
const uyariKarti = (u) => (u.length ? html`<section class="card"><h2 class="card-title">Dikkat edilecekler <span class="chip-n">${u.length}</span></h2><ul class="list">${u.map((x) => html`<li><span class="muted">${x}</span></li>`)}</ul></section>` : '');

// ---------------------------------------------------------------- firma kârlılığı
export async function firmaKarlilikSayfasi(app) {
  if (!izinliMi(app, 'company_profit')) return kilit('Firma kârlılığı', GEREKEN);
  const durum = { ay: ayBasi(bugun()), yontem: 'teorik' };
  let veri = await girdiYukle(app, durum.ay);
  const duzenleyebilir = app.can('company_profit', 'edit') && app.can('company_profit', 'create');
  const hesapla = (ekstra = {}) => hesaplaKarlilik({ ...veri, yontem: durum.yontem, ...ekstra });
  let r = hesapla();

  const kpiler = () => { const i = r.isletme; const gider = i.personel + i.dogrudan + i.ortakHavuz; return html`<div class="kpi-grid">
    ${kutu('Gelir (KDV hariç)', para(i.gelir), `${ayAdi(durum.ay)} faturaları`, 'wallet')}${kutu('Toplam maliyet', para(gider), `personel ${para(i.personel)} · doğrudan ${para(i.dogrudan)} · ortak ${para(i.ortakHavuz)}`, 'receipt')}
    ${kutu('Vergi öncesi kâr', para(i.vergiOncesiKar), i.marj === null ? 'gelir yok' : `marj %${ondalik(i.marj)}`, 'trend')}${kutu('Vergi sonrası (tahmini)', para(i.vergiSonrasiKar), `tahmini vergi ${para(i.tahminiVergi)}`, 'bars')}</div>`; };
  const tablo = () => {
    if (!r.firmalar.length) return emptyState({ simge: 'bars', baslik: `${ayAdi(durum.ay)} için firma verisi yok`, metin: 'Fatura, görevlendirme veya gider girildikçe firma bazında kârlılık burada hesaplanır.' });
    const t = r.firmalar.reduce((a, f) => ({ gelir: a.gelir + f.gelir, personel: a.personel + f.personel, dogrudan: a.dogrudan + f.dogrudan, katki: a.katki + f.katki, ortak: a.ortak + f.ortak, kar: a.kar + f.kar }), { gelir: 0, personel: 0, dogrudan: 0, katki: 0, ortak: 0, kar: 0 });
    return html`<div class="table-wrap"><table class="table" id="kar-firma-tablo"><thead><tr><th scope="col">Firma</th><th scope="col" class="num">Gelir</th><th scope="col" class="num hide-sm">Personel</th><th scope="col" class="num hide-md">Doğrudan gider</th>
      <th scope="col" class="num">Katkı kârı</th><th scope="col" class="num hide-sm">Ortak gider payı</th><th scope="col" class="num">Kâr katkısı</th><th scope="col" class="num hide-sm">Marj</th></tr></thead><tbody>
      ${r.firmalar.map((f) => html`<tr><td><a class="link" href="#/firmalar/${f.id}">${f.ad}</a></td><td class="num">${para2(f.gelir)}</td><td class="num hide-sm">${para2(f.personel)}</td><td class="num hide-md">${para2(f.dogrudan)}</td>
        <td class="num">${tutar(f.katki)}</td><td class="num hide-sm">${para2(f.ortak)}</td><td class="num"><strong>${tutar(f.kar)}</strong></td><td class="num hide-sm">${f.marj === null ? '—' : `%${ondalik(f.marj)}`}</td></tr>`)}
      </tbody><tfoot><tr><th scope="row">Firmalar toplamı</th><td class="num">${para2(t.gelir)}</td><td class="num hide-sm">${para2(t.personel)}</td><td class="num hide-md">${para2(t.dogrudan)}</td><td class="num">${tutar(t.katki)}</td><td class="num hide-sm">${para2(t.ortak)}</td><td class="num">${tutar(t.kar)}</td><td class="hide-sm"></td></tr></tfoot></table></div>`;
  };
  const isletme = () => { const i = r.isletme; return html`<section class="card"><h2 class="card-title">İşletme sonucu</h2><ul class="list">
    <li><span>Gelir</span><strong>${para2(i.gelir)}</strong></li>
    <li><span>Personel maliyeti (tümü)</span><strong>${para2(i.personel)}</strong></li>
    <li><span class="muted">&nbsp;&nbsp;firmalara yazılan</span><span>${para2(i.personelFirmalara)}</span></li>
    <li><span class="muted">&nbsp;&nbsp;boşta kapasite (hiçbir firmaya yazılmadı)</span><span>${para2(i.bosta)}</span></li>
    <li><span>Doğrudan giderler</span><strong>${para2(i.dogrudan)}</strong></li>
    <li><span>Ortak giderler</span><strong>${para2(i.ortakHavuz)}</strong></li>
    ${i.ortakDagitilmayan ? html`<li><span class="muted">&nbsp;&nbsp;firmalara dağıtılmamış kısım</span><span>${para2(i.ortakDagitilmayan)}</span></li>` : ''}
    <li><span><strong>Vergi öncesi kâr</strong></span><strong>${tutar(i.vergiOncesiKar)}</strong></li>
    <li><span>Tahmini kurumlar vergisi</span><span>${para2(i.tahminiVergi)}</span></li>
    <li><span><strong>Vergi sonrası kâr (tahmini)</strong></span><strong>${tutar(i.vergiSonrasiKar)}</strong></li></ul>
    <p class="fine pad">Boşta kapasite ve dağıtılmayan ortak gider firma kârlarına yazılmaz ama işletme sonucuna dahildir; bu yüzden firma kârlarının toplamı işletme kârından yüksek olabilir.</p></section>`; };
  const ortakKarti = () => {
    const satirlar = r.ortak;
    return html`<section class="card card-flush"><div class="card-head"><div><h2 class="card-title">Ortak giderlerin dağıtımı</h2>
      <p class="card-sub">Kategori havuzu, seçilen ölçüte göre firmalara bölünür; dağıtılan toplam havuzu aşmaz.</p></div>
      ${duzenleyebilir && satirlar.length ? html`<button type="button" class="btn btn-secondary btn-sm" data-action="dagitim-kaydet">${icon('check', 16)} Bu ayın dağıtımını kaydet</button>` : ''}</div>
      ${satirlar.length ? html`<div class="table-wrap"><table class="table"><thead><tr><th scope="col">Kategori</th><th scope="col" class="num">Havuz (KDV hariç)</th><th scope="col">Dağıtım ölçütü</th><th scope="col">Durum</th></tr></thead><tbody>
        ${satirlar.map((o) => html`<tr><td><strong>${o.ad}</strong></td><td class="num">${para2(o.havuz)}</td>
          <td>${duzenleyebilir ? html`<label class="select-inline"><span class="sr-only">${o.ad} ölçütü</span><select data-olcut="${o.kategoriId}">${Object.entries(DAGITIM_OLCUTLERI).map(([k, e]) => html`<option value="${k}" ${k === o.olcut ? html`selected` : ''}>${e}</option>`)}</select></label>` : DAGITIM_OLCUTLERI[o.olcut]}</td>
          <td>${o.kaydedilmis ? pill('Kaydedilmiş', 'success') : pill('Hesaplanan', 'neutral')}${o.dagitilmayan > 0.005 ? html` ${pill(`${para2(o.dagitilmayan)} dağıtılmadı`, 'warning')}` : ''}</td></tr>`)}</tbody></table></div>
        <p class="fine pad">Ölçüt değişikliği seçili ayın 1'inden itibaren geçerli olur; önceki aylar eski ölçütle kalır. Kaydedilmiş bir aydaki dağıtımı yeni ölçütle güncellemek için "dağıtımı kaydet"e basın.</p>`
        : emptyState({ simge: 'receipt', baslik: `${ayAdi(durum.ay)} için ortak gider yok`, metin: 'Giderler sayfasında "ortak" türünde gider girildiğinde burada dağıtılır.' })}</section>`;
  };

  const ciz = (kok) => {
    kok.querySelector('#kar-ust').innerHTML = kpiler().s;
    kok.querySelector('#kar-tablo').innerHTML = tablo().s;
    kok.querySelector('#kar-yan').innerHTML = `${isletme().s}${ortakKarti().s}${uyariKarti(r.uyarilar).s}`;
  };
  return {
    baslik: 'Firma kârlılığı', altBaslik: 'Firma bazında katkı kârı, ortak gider payı ve vergi öncesi kâr katkısı',
    govde: html`<div class="notice notice-info" role="note">${NOT}</div>
      <section class="card card-flush">${ustCubuk(durum)}</section>
      <div id="kar-ust" class="pad-t">${kpiler()}</div>
      <section class="card card-flush pad-t"><div class="card-head"><h2 class="card-title">Firma bazında sonuç</h2></div><div id="kar-tablo">${tablo()}</div></section>
      <div id="kar-yan" class="grid-2 pad-t">${isletme()}${ortakKarti()}${uyariKarti(r.uyarilar)}</div>`,
    mount(kok) {
      const yenidenHesapla = () => { r = hesapla(); ciz(kok); };
      kok.querySelector('#kar-ay').addEventListener('change', async (e) => {
        durum.ay = e.target.value;
        try { veri = await girdiYukle(app, durum.ay); yenidenHesapla(); } catch (err) { toast(humanError(err), 'hata'); }
      });
      kok.querySelector('#kar-yontem').addEventListener('change', (e) => { durum.yontem = e.target.value; yenidenHesapla(); });
      kok.addEventListener('change', async (e) => {
        const s = e.target.closest('[data-olcut]'); if (!s) return;
        try {
          await app.api.setAllocationBasis({ kategori: s.dataset.olcut, olcut: s.value, baslangic: durum.ay });
          veri = await girdiYukle(app, durum.ay); yenidenHesapla(); toast('Dağıtım ölçütü güncellendi.');
        } catch (err) { toast(humanError(err), 'hata'); veri = await girdiYukle(app, durum.ay).catch(() => veri); yenidenHesapla(); }
      });
      kok.addEventListener('click', async (e) => {
        if (!e.target.closest('[data-action="dagitim-kaydet"]')) return;
        try {
          const taze = hesapla({ kayitliDagitim: [] });
          for (const o of taze.ortak) await app.api.saveAllocation({ donem: durum.ay, kategori: o.kategoriId, olcut: o.olcut, satirlar: dagitimSatirlari(o) });
          veri = await girdiYukle(app, durum.ay); yenidenHesapla(); toast('Dağıtım kaydedildi.');
        } catch (err) { toast(humanError(err), 'hata'); }
      });
    },
  };
}

// ---------------------------------------------------------------- personel kârlılığı
export async function personelKarlilikSayfasi(app) {
  if (!izinliMi(app, 'staff_profit')) return kilit('Personel kârlılığı', GEREKEN);
  const durum = { ay: ayBasi(bugun()), yontem: 'teorik' };
  let veri = await girdiYukle(app, durum.ay);
  let r = hesaplaKarlilik({ ...veri, yontem: durum.yontem });

  const kpiler = () => {
    const p = r.personel; const maliyet = p.reduce((t, x) => t + x.toplam, 0); const gelir = p.reduce((t, x) => t + x.gelirPayi, 0); const bosta = p.reduce((t, x) => t + x.bosta, 0);
    const dolu = p.filter((x) => x.doluluk !== null); const ort = dolu.length ? dolu.reduce((t, x) => t + x.doluluk, 0) / dolu.length : null;
    return html`<div class="kpi-grid">${kutu('Personel maliyeti', para(maliyet), `${sayi(p.length)} personel`, 'users')}${kutu('Personele düşen gelir', para(gelir), 'görevlendirme payına göre, yaklaşık', 'wallet')}
      ${kutu('Boşta kapasite maliyeti', para(bosta), 'firmalara yazılmayan', 'gauge')}${kutu('Ortalama doluluk', ort === null ? '—' : `%${ondalik(ort * 100)}`, 'teorik süre / kapasite', 'pulse')}</div>`;
  };
  const tablo = () => {
    if (!r.personel.length) return emptyState({ simge: 'users', baslik: 'Personel verisi yok', metin: 'Uzman ve hekim kaydı, maliyet dönemi ve görevlendirme girildikçe burada hesaplanır.' });
    return html`<div class="table-wrap"><table class="table" id="kar-personel-tablo"><thead><tr><th scope="col">Personel</th><th scope="col" class="num">Maliyet</th><th scope="col" class="num hide-sm">Doluluk</th><th scope="col" class="num hide-md">Fiilî hizmet</th>
      <th scope="col" class="num">Gelir payı</th><th scope="col" class="num">Katkı</th><th scope="col" class="num hide-sm">Boşta maliyet</th><th scope="col"><span class="sr-only">Detay</span></th></tr></thead><tbody>
      ${r.personel.map((p) => html`<tr><td><strong>${p.ad}</strong><small class="block muted">${PERSONEL_TURU_KISA[p.tur]}</small></td><td class="num">${para2(p.toplam)}</td>
        <td class="num hide-sm">${p.doluluk === null ? '—' : `%${ondalik(p.doluluk * 100)}`}</td><td class="num hide-md">${sureMetni(p.fiiliDk)}</td><td class="num">${para2(p.gelirPayi)}</td>
        <td class="num"><strong>${tutar(p.katki)}</strong></td><td class="num hide-sm">${para2(p.bosta)}</td>
        <td class="actions"><button type="button" class="icon-btn" data-kar-detay="${p.id}" aria-label="${p.ad} firma dağılımı" title="Firma dağılımı">${icon('building', 16)}</button></td></tr>`)}</tbody></table></div>`;
  };
  const ciz = (kok) => { kok.querySelector('#kar-ust').innerHTML = kpiler().s; kok.querySelector('#kar-tablo').innerHTML = tablo().s; kok.querySelector('#kar-yan').innerHTML = uyariKarti(r.uyarilar).s; };
  return {
    baslik: 'Personel kârlılığı', altBaslik: 'Uzman ve hekim bazında gelir, maliyet ve katkı kârı',
    govde: html`<div class="notice notice-info" role="note">${NOT} Personele düşen gelir: firma geliri, görevli uzman ve hekim arasında eşit (%50-%50) bölünür; tek türde görevli varsa tamamı ona yazılır; sonra görevlendirme payı uygulanır.</div>
      <section class="card card-flush">${ustCubuk(durum)}</section>
      <div id="kar-ust" class="pad-t">${kpiler()}</div>
      <section class="card card-flush pad-t"><div class="card-head"><h2 class="card-title">Personel bazında sonuç</h2></div><div id="kar-tablo">${tablo()}</div></section>
      <div id="kar-yan" class="pad-t">${uyariKarti(r.uyarilar)}</div>`,
    mount(kok) {
      const yenidenHesapla = () => { r = hesaplaKarlilik({ ...veri, yontem: durum.yontem }); ciz(kok); };
      kok.querySelector('#kar-ay').addEventListener('change', async (e) => {
        durum.ay = e.target.value;
        try { veri = await girdiYukle(app, durum.ay); yenidenHesapla(); } catch (err) { toast(humanError(err), 'hata'); }
      });
      kok.querySelector('#kar-yontem').addEventListener('change', (e) => { durum.yontem = e.target.value; yenidenHesapla(); });
      kok.addEventListener('click', (e) => {
        const b = e.target.closest('[data-kar-detay]'); if (!b) return;
        const p = r.personel.find((x) => x.id === b.dataset.karDetay); if (!p) return;
        openModal({ baslik: p.ad, altBaslik: `${ayAdi(durum.ay)} · ${MALIYET_YONTEMLERI[durum.yontem]}`, boyut: 'lg',
          govde: html`<div class="stats"><div class="stat"><span class="stat-l">Aylık maliyet</span><strong class="stat-v">${para2(p.toplam)}</strong><span class="stat-s">maaş ${para2(p.maliyet)}${p.dogrudan ? ` + doğrudan gider ${para2(p.dogrudan)}` : ''}</span></div>
            <div class="stat"><span class="stat-l">Kapasite</span><strong class="stat-v">${sureMetni(p.kapasite)}</strong><span class="stat-s">teorik yük ${sureMetni(p.teorikDk)}</span></div>
            <div class="stat"><span class="stat-l">Boşta maliyet</span><strong class="stat-v">${para2(p.bosta)}</strong><span class="stat-s">firmalara yazılmayan</span></div></div>
            <h3 class="card-title pad-t">Firma bazında</h3>
            ${p.firmaPay.length || p.gelirKalemleri.length ? html`<div class="table-wrap"><table class="table"><thead><tr><th scope="col">Firma</th><th scope="col" class="num">Dakika</th><th scope="col" class="num">Maliyet payı</th><th scope="col" class="num">Gelir payı</th></tr></thead><tbody>
              ${[...new Set([...p.firmaPay.map((f) => f.companyId), ...p.gelirKalemleri.map((f) => f.companyId)])].map((id) => { const m = p.firmaPay.find((f) => f.companyId === id); const g = p.gelirKalemleri.find((f) => f.companyId === id);
                return html`<tr><td>${m?.ad ?? g?.ad}</td><td class="num">${sureMetni(m?.dakika ?? 0)}</td><td class="num">${para2(m?.maliyet ?? 0)}</td><td class="num">${para2(g?.gelir ?? 0)}</td></tr>`; })}</tbody></table></div>`
              : html`<p class="muted">Bu ay için firma bağlantısı yok.</p>`}
            <div class="modal-actions"><button type="button" class="btn btn-primary" data-close>Kapat</button></div>` });
      });
    },
  };
}
