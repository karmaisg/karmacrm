// OSGB 360 - Yönetici paneli: aylık finans özeti (bilgi kutucukları + grafikler). Hesap src/lib/yonetim.js içindedir.
import { html, bugun, ayBasi, ayAdi, para, para2, sayi, ondalik } from '../lib/format.js';
import { icon } from '../ui/icons.js';
import { emptyState, toast } from '../ui/components.js';
import { humanError } from '../lib/api.js';
import { girdiYukle } from './karlilik.js';
import { aylikOzet, aylikSeri } from '../lib/yonetim.js';
import { cubukGrafik, cizgiGrafik, lejant } from '../ui/grafik.js';
import { TEHLIKE } from '../lib/format.js';

export const ozetIzniVar = (app) => ['company_profit', 'payroll', 'expenses', 'invoices'].every((m) => app.can(m, 'view'));

const aySecenekleri = (bugunStr) => {
  const [y, mo] = bugunStr.split('-').map(Number); const l = [];
  for (let i = 0; i < 24; i += 1) { const t = new Date(y, mo - 1 - i, 1); l.push(`${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-01`); }
  return l;
};
const kutu = (etiket, deger, alt, simge, ton = '') => html`<section class="card kpi"><span class="kpi-ic">${icon(simge, 22)}</span><div><div class="kpi-l">${etiket}</div><div class="kpi-v ${ton}">${deger}</div><div class="kpi-s">${alt}</div></div></section>`;
const ton = (n) => (n > 0 ? 'pos' : n < 0 ? 'neg' : '');

function icerik(o, seri) {
  const k = o.kpi; const ay = ayAdi(o.ay); const d = o.dikkat;
  const uyari = d.atanmamisGelir > 0 || d.dagitilmayanOrtak > 0 || d.bosta > 0
    ? html`<div class="notice notice-warn pad-t" role="status" id="yon-dikkat">${icon('alert', 16)} Dikkat: Personele atanmamış firma geliri ${para2(d.atanmamisGelir)} · dağıtılamayan ortak gider ${para2(d.dagitilmayanOrtak)} · müşteriye yüklenmeyen (boş kapasite) personel maliyeti ${para2(d.bosta)}. Bu kalemler toplamlara dahildir, ilgili ekranlarda ayrıca gösterilir.</div>` : '';
  const etiketler = seri.map((m) => m.ay);
  const gelirGider = [{ ad: 'Gelir (KDV hariç)', sinif: 'gelir', degerler: seri.map((m) => m.gelir) }, { ad: 'Gider', sinif: 'gider', degerler: seri.map((m) => m.gider) }];
  const kar = [{ ad: 'Vergi öncesi', sinif: 'oncesi', degerler: seri.map((m) => m.vergiOncesi) }, { ad: 'Vergi sonrası', sinif: 'sonrasi', degerler: seri.map((m) => m.vergiSonrasi), kesik: true }];
  const bar = (liste) => {
    const en = Math.max(1, ...liste.map((x) => Math.abs(x.kar)));
    return liste.length ? html`<ul class="bars bars-wide">${liste.map((f) => html`<li><span class="bars-l" title="${f.ad}"><a class="link" href="#/firmalar/${f.id}">${f.ad}</a></span>
      <span class="bars-track"><span class="bars-fill ${f.kar < 0 ? 'bars-neg' : 'bars-pos'}" data-w="${Math.max(2, Math.round((Math.abs(f.kar) / en) * 100))}"></span></span><span class="bars-n ${f.kar < 0 ? 'neg' : ''}">${para2(f.kar)}</span></li>`)}</ul>`
      : html`<p class="muted">Bu ay için firma verisi yok.</p>`;
  };
  const pk = (x) => (x === null ? '—' : `%${ondalik(x * 100)}`);
  const kapasite = o.kapasite.length ? html`<ul class="bars bars-wide" id="yon-kapasite">${o.kapasite.map((p) => html`<li><span class="bars-l" title="${p.ad}">${p.ad}</span>
      <span class="bars-ikili"><span class="bars-track"><span class="bars-fill bars-pos" data-w="${Math.min(100, Math.round((p.teorikOran ?? 0) * 100))}"></span></span>
        <span class="bars-track"><span class="bars-fill bars-gri" data-w="${Math.min(100, Math.round((p.fiiliOran ?? 0) * 100))}"></span></span></span>
      <span class="bars-n">teorik ${pk(p.teorikOran)}<small class="block muted">fiilî ${pk(p.fiiliOran)}</small></span></li>`)}</ul>
    <ul class="g-lejant"><li><span class="g-k bars-pos" aria-hidden="true"></span>Teorik yük</li><li><span class="g-k bars-gri" aria-hidden="true"></span>Fiilî çalışma</li></ul>
    <p class="fine">Kapasite = personel kapasitesi (varsayılan 11.700 dk). Teorik ≠ fiilî; birbirine karıştırılmaz.</p>`
    : html`<p class="muted">Bu ay için personel verisi yok.</p>`;
  const tehlike = o.tehlike.length ? html`<div class="table-wrap"><table class="table" id="yon-tehlike"><thead><tr><th scope="col">Sınıf</th><th scope="col" class="num">Firma</th><th scope="col" class="num">Gelir</th><th scope="col" class="num">Teorik dk</th><th scope="col" class="num">Fiilî dk</th></tr></thead><tbody>
      ${o.tehlike.map((t) => html`<tr><td>${TEHLIKE[t.sinif]}</td><td class="num">${sayi(t.firma)}</td><td class="num">${para2(t.gelir)}</td><td class="num">${sayi(t.teorikDk)}</td><td class="num">${sayi(t.fiiliDk)}</td></tr>`)}</tbody></table></div>
    <p class="fine">Gelir KDV hariç; teorik = çalışan × sınıf dakikası; fiilî = zaman kayıtları.</p>` : html`<p class="muted">Bu ay sözleşmesi geçerli firma yok.</p>`;
  return html`
    <div class="kpi-grid" id="yon-finans">
      ${kutu('Toplam hizmet geliri', para2(k.gelir), 'KDV hariç · fatura esaslı', 'wallet')}
      ${kutu('Toplam tahsilat', para2(k.tahsilat), 'Tahsilat tarihi bu ay olanlar (KDV dahil)', 'receipt')}
      ${kutu('Tahsil edilmemiş alacak', para2(k.tahsilEdilmemis), 'Bu ay faturaları · KDV dahil', 'clock')}
      ${kutu('Toplam gider', para2(k.gider), `Personel ${para2(k.personel)} · doğrudan ${para2(k.dogrudan)} · ortak ${para2(k.ortak)}`, 'bars')}
    </div>
    <div class="kpi-grid kpi-grid-3 yon-grup" id="yon-kar">
      ${kutu('Vergi öncesi tahmini kâr', para2(k.vergiOncesi), 'Gelir − gider', 'trend', ton(k.vergiOncesi))}
      ${kutu('Tahmini kurumlar vergisi', para2(k.vergi), k.vergiOncesi > 0 ? `Vergiye tabi kâr üzerinden · KDV 0 gelir hariç` : 'Zarar olduğu için 0', 'file')}
      ${kutu('Vergi sonrası tahmini kâr', para2(k.vergiSonrasi), 'Vergi öncesi − tahmini vergi', 'check', ton(k.vergiSonrasi))}
    </div>
    <div class="kpi-grid yon-grup" id="yon-operasyon">
      ${kutu('Aktif firma sayısı', sayi(k.aktifFirma), 'Seçili ayda sözleşmesi geçerli', 'building')}
      ${kutu('Uzman / hekim sayısı', `${sayi(k.uzman)} / ${sayi(k.hekim)}`, 'Seçili ayda aktif personel', 'users')}
      ${kutu('Toplam teorik hizmet dakikası', sayi(k.teorikDk), `Uzman ${sayi(k.uzmanDk)} · hekim ${sayi(k.hekimDk)}`, 'gauge')}
      ${kutu('Toplam fiilî hizmet dakikası', sayi(k.fiiliDk), k.fiiliDk > 0 ? 'Zaman kayıtlarından (saha + raporlama)' : 'Bu ay fiilî zaman kaydı yok', 'pulse')}
    </div>
    <div class="kpi-grid kpi-grid-2 yon-grup" id="yon-dk">
      ${kutu('Ort. dakika başına gelir', k.dkGelir === null ? '—' : para2(k.dkGelir), k.dkGelir === null ? 'Fiilî süre 0 olduğu için hesaplanamaz' : 'Gelir ÷ fiilî dakika', 'wallet')}
      ${kutu('Ort. dakika başına maliyet', k.dkMaliyet === null ? '—' : para2(k.dkMaliyet), k.dkMaliyet === null ? 'Fiilî süre 0 olduğu için hesaplanamaz' : 'Gider ÷ fiilî dakika', 'receipt')}
    </div>
    ${uyari}
    <div class="grid-2 pad-t">
      <section class="card"><h2 class="card-title">Aylık gelir ve gider (son 12 ay)</h2>${cubukGrafik({ ad: 'Aylık gelir ve gider', etiketler, seriler: gelirGider })}${lejant(gelirGider)}
        <p class="fine">Dönem: ${ayAdi(etiketler[0])} – ${ayAdi(etiketler[etiketler.length - 1])}. Veri: gelir, gider ve personel maliyet kayıtları; kârlılık sayfalarıyla aynı hesap.</p></section>
      <section class="card"><h2 class="card-title">Aylık kâr eğilimi (son 12 ay)</h2>${cizgiGrafik({ ad: 'Aylık kâr eğilimi', etiketler, seriler: kar })}${lejant(kar)}
        <p class="fine">Vergi her ay kendi kârı üzerinden tahmin edilir (aylık zarar sonraki aya devretmez).</p></section>
      <section class="card"><h2 class="card-title">En kârlı müşteriler — ${ay}</h2>${bar(o.enKarli)}<p class="fine">Ölçü: dağıtılmış genel gider sonrası tahmini kâr.</p></section>
      <section class="card"><h2 class="card-title">En düşük kârlı müşteriler — ${ay}</h2>${bar(o.enDusuk)}<p class="fine">Negatif çubuklar zarar eden müşterilerdir. Ayrıntı: Firma kârlılığı.</p></section>
      <section class="card"><h2 class="card-title">Personel bazında kapasite kullanımı — ${ay}</h2>${kapasite}</section>
      <section class="card"><h2 class="card-title">Tehlike sınıfına göre gelir ve zaman — ${ay}</h2>${tehlike}</section>
    </div>`;
}

/** Panelde yer alacak bölüm iskeleti; içerik mount ile yüklenir. */
export function yonetimOzetiIskelet(durum) {
  return html`<section class="yon-ozet" aria-labelledby="yon-baslik">
    <section class="card card-flush"><div class="card-head"><h2 class="card-title" id="yon-baslik">Aylık finans özeti</h2>
      <label class="select-inline"><span class="sr-only">Ay</span><select id="yon-ay">${aySecenekleri(bugun()).map((a) => html`<option value="${a}" ${a === durum.ay ? html`selected` : ''}>${ayAdi(a)}</option>`)}</select></label></div></section>
    <div id="yon-icerik" class="pad-t" aria-live="polite"><p class="muted">Aylık özet hesaplanıyor…</p></div></section>`;
}

export const yeniDurum = () => ({ ay: ayBasi(bugun()), sayac: 0 });

/** mount: seçili ayın verisini yükler ve çizer; ay değişince yeniden yükler. */
export function yonetimOzetiBaglan(kok, app, durum, ciz) {
  const hedef = kok.querySelector('#yon-icerik'); let tahsilatlar = null;
  const yukle = async () => {
    const sira = ++durum.sayac; hedef.innerHTML = html`<p class="muted">Aylık özet hesaplanıyor…</p>`.s;
    try {
      if (!tahsilatlar) tahsilatlar = await app.api.listPayments();
      const veri = await girdiYukle(app, durum.ay);
      if (sira !== durum.sayac) return;                         // eski istek: sonucu at
      const o = aylikOzet({ veri, tahsilatlar }); const seri = aylikSeri({ veri });
      hedef.innerHTML = icerik(o, seri).s; ciz(hedef);
    } catch (e) {
      if (sira !== durum.sayac) return;
      hedef.innerHTML = emptyState({ simge: 'alert', baslik: 'Aylık özet yüklenemedi', metin: humanError(e) }).s; toast(humanError(e), 'hata');
    }
  };
  kok.querySelector('#yon-ay').addEventListener('change', (e) => { durum.ay = e.target.value; yukle(); });
  yukle();
}
