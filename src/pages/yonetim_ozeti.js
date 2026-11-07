// OSGB 360 - Yönetici paneli: aylık finans özeti (bilgi kutucukları + grafikler). Hesap src/lib/yonetim.js içindedir.
import { html, bugun, ayBasi, ayAdi, para, para2, sayi, ondalik } from '../lib/format.js';
import { icon } from '../ui/icons.js';
import { emptyState, toast, openModal } from '../ui/components.js';
import { humanError } from '../lib/api.js';
import { girdiYukle } from './karlilik.js';
import { aylikOzet, aylikSeri } from '../lib/yonetim.js';
import { cubukGrafik, cizgiGrafik, lejant, ipucuBagla } from '../ui/grafik.js';
import { TEHLIKE } from '../lib/format.js';

export const ozetIzniVar = (app) => ['company_profit', 'payroll', 'expenses', 'invoices'].every((m) => app.can(m, 'view'));

const aySecenekleri = (bugunStr) => {
  const [y, mo] = bugunStr.split('-').map(Number); const l = [];
  for (let i = 0; i < 24; i += 1) { const t = new Date(y, mo - 1 - i, 1); l.push(`${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-01`); }
  return l;
};
const kutu = (etiket, deger, alt, simge, ton = '') => html`<section class="card kpi"><span class="kpi-ic">${icon(simge, 22)}</span><div><div class="kpi-l">${etiket}</div><div class="kpi-v ${ton}">${deger}</div><div class="kpi-s">${alt}</div></div></section>`;
const ton = (n) => (n > 0 ? 'pos' : n < 0 ? 'neg' : '');
const SINIF_AD = { cok_tehlikeli: 'Çok tehlikeli', tehlikeli: 'Tehlikeli', az_tehlikeli: 'Az tehlikeli' };

function icerik(o, seri) {
  const k = o.kpi; const ay = ayAdi(o.ay); const d = o.dikkat;
  const uyari = d.atanmamisGelir > 0 || d.dagitilmayanOrtak > 0 || d.bosta > 0
    ? html`<div class="notice notice-warn pad-t" role="status" id="yon-dikkat">${icon('alert', 16)} Dikkat: Personele atanmamış firma geliri ${para2(d.atanmamisGelir)} · dağıtılamayan ortak gider ${para2(d.dagitilmayanOrtak)} · müşteriye yüklenmeyen (boş kapasite) personel maliyeti ${para2(d.bosta)}. Bu kalemler toplamlara dahildir, ilgili ekranlarda ayrıca gösterilir.</div>` : '';
  const etiketler = seri.map((m) => m.ay);
  const gelirGider = [{ ad: 'Gelir (KDV hariç)', sinif: 'gelir', degerler: seri.map((m) => m.gelir) }, { ad: 'Gider', sinif: 'gider', degerler: seri.map((m) => m.gider) }, { ad: 'Kâr (vergi öncesi)', sinif: 'kar', degerler: seri.map((m) => m.vergiOncesi) }];
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
  const enSinif = Math.max(1, ...o.sinifGelir.map((t) => t.gelir));
  const tehlike = o.sinifGelir.some((t) => t.gelir > 0 || t.firma > 0) ? html`<ul class="bars bars-genis" id="yon-tehlike" aria-label="Tehlike sınıfına göre gelir">${o.sinifGelir.map((t) => html`<li>
      <span class="bars-l" title="${SINIF_AD[t.sinif]}">${SINIF_AD[t.sinif]}</span>
      <span class="bars-track"><span class="bars-fill bars-gelir" data-w="${Math.round((t.gelir / enSinif) * 100)}" data-ipucu="${SINIF_AD[t.sinif]}: ${para2(t.gelir)}"></span></span>
      <span class="bars-n">${para2(t.gelir)}</span></li>`)}</ul>
    <p class="fine">${ay} ayında faturası kesilen (KDV hariç) ve sözleşmesi geçerli firmaların geliri, firmanın o aydaki tehlike sınıfına göre toplanır. Karma sınıflı firmanın geliri, sınıflardaki çalışan sayısı oranında bölünür.${o.kpi.siniflanamayanGelir > 0 ? ` Sınıfı girilmemiş firmaların ${para2(o.kpi.siniflanamayanGelir)} tutarındaki geliri bu dağılımda yoktur.` : ''}</p>` : html`<p class="muted">Bu ay faturası kesilmiş veya sözleşmesi geçerli firma yok.</p>`;
  const kisiSinif = html`<ul class="kpi-mini" id="yon-kisi-sinif">${o.sinifGelir.map((t) => html`<li><span>${SINIF_AD[t.sinif]}</span><strong>${t.kisiGelir === null ? '—' : para2(t.kisiGelir)}</strong></li>`)}</ul>`;
  return html`
    <div class="kpi-grid" id="yon-finans">
      ${kutu('Toplam hizmet geliri', para2(k.gelir), 'KDV hariç · fatura esaslı', 'wallet', 't-gelir')}
      <section class="card kpi kpi-cift" id="yon-tahsilat"><span class="kpi-ic">${icon('receipt', 22)}</span><div>
        <div class="kpi-l">Toplam tahsilat</div><div class="kpi-v">${para2(k.tahsilat)}</div><div class="kpi-s">Tahsilat tarihi bu ay olanlar (KDV dahil)</div>
        <div class="kpi-l kpi-ikinci">Tahsil edilmemiş alacak</div><div class="kpi-v">${para2(k.tahsilEdilmemis)}</div><div class="kpi-s">Bu ay faturaları · KDV dahil</div></div></section>
      ${kutu('Toplam gider', para2(k.gider), `Personel ${para2(k.personel)} · doğrudan ${para2(k.dogrudan)} · ortak ${para2(k.ortak)}`, 'bars', 't-gider')}
    </div>
    <div class="kpi-grid yon-grup" id="yon-kar">
      ${kutu('Vergi öncesi tahmini kâr', para2(k.vergiOncesi), 'Gelir − gider', 'trend', 't-kar')}
      ${kutu('Tahmini kurumlar vergisi', para2(k.vergi), k.vergiOncesi > 0 ? `Vergiye tabi kâr üzerinden · KDV 0 gelir hariç` : 'Zarar olduğu için 0', 'file')}
      ${kutu('Vergi sonrası tahmini kâr', para2(k.vergiSonrasi), 'Vergi öncesi − tahmini vergi', 'check', 't-kar')}
    </div>
    <div class="kpi-grid yon-grup" id="yon-operasyon">
      ${kutu('Hizmet verilen toplam personel', sayi(k.hizmetCalisan), 'Sözleşmesi geçerli veya faturası kesilen firmaların çalışanları', 'users')}
      ${kutu('Ortalama kişi bazlı gelir', k.kisiGelir === null ? '—' : para2(k.kisiGelir), 'Toplam hizmet geliri ÷ hizmet verilen çalışan', 'wallet')}
      ${kutu('Tehlike sınıfına göre ort. kişi bazlı gelir', kisiSinif, 'Sınıftaki firmalara kesilen gelir ÷ o sınıftaki çalışan', 'shield')}
    </div>
    <div class="kpi-grid yon-grup" id="yon-dk">
      ${kutu('Ort. dakika başına gelir', k.dkGelir === null ? '—' : para2(k.dkGelir), k.dkGelir === null ? 'Fiilî süre 0 olduğu için hesaplanamaz' : 'Gelir ÷ fiilî dakika', 'wallet')}
      ${kutu('Ort. dakika başına maliyet', k.dkMaliyet === null ? '—' : para2(k.dkMaliyet), k.dkMaliyet === null ? 'Fiilî süre 0 olduğu için hesaplanamaz' : 'Gider ÷ fiilî dakika', 'receipt')}
    </div>
    ${uyari}
    <div class="grid-2 pad-t">
      <section class="card card-buyut" data-buyut="gelirgider" title="Büyütmek için tıklayın"><h2 class="card-title">Aylık gelir, gider ve kâr (son 12 ay) <span class="buyut-ipucu">Büyüt</span></h2>${cubukGrafik({ ad: 'Aylık gelir, gider ve kâr', etiketler, seriler: gelirGider })}${lejant(gelirGider)}
        <p class="fine">Dönem: ${ayAdi(etiketler[0])} – ${ayAdi(etiketler[etiketler.length - 1])}. Veri: gelir, gider ve personel maliyet kayıtları; kârlılık sayfalarıyla aynı hesap.</p></section>
      <section class="card card-buyut" data-buyut="kar" title="Büyütmek için tıklayın"><h2 class="card-title">Aylık kâr eğilimi (son 12 ay) <span class="buyut-ipucu">Büyüt</span></h2>${cizgiGrafik({ ad: 'Aylık kâr eğilimi', etiketler, seriler: kar })}${lejant(kar)}
        <p class="fine">Vergi her ay kendi kârı üzerinden tahmin edilir (aylık zarar sonraki aya devretmez).</p></section>
      <section class="card card-buyut" data-buyut="enkarli" title="Tüm firmaları görmek için tıklayın"><h2 class="card-title">En kârlı müşteriler — ${ay} <span class="buyut-ipucu">Tümü</span></h2>${bar(o.enKarli)}<p class="fine">Ölçü: dağıtılmış genel gider sonrası tahmini kâr.</p></section>
      <section class="card card-buyut" data-buyut="endusuk" title="Tüm firmaları görmek için tıklayın"><h2 class="card-title">En düşük kârlı müşteriler — ${ay} <span class="buyut-ipucu">Tümü</span></h2>${bar(o.enDusuk)}<p class="fine">Negatif çubuklar zarar eden müşterilerdir. Ayrıntı: Firma kârlılığı.</p></section>
      <section class="card"><h2 class="card-title">Personel bazında kapasite kullanımı — ${ay}</h2>${kapasite}</section>
      <section class="card"><h2 class="card-title">Tehlike sınıfına göre gelir — ${ay}</h2>${tehlike}</section>
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
  const hedef = kok.querySelector('#yon-icerik'); let tahsilatlar = null; let son = null;
  ipucuBagla(document.body);
  hedef.addEventListener('click', (e) => { if (!son || e.target.closest('a, button, select, input')) return; const k = e.target.closest('[data-buyut]'); if (k) buyut(k.dataset.buyut, son.o, son.seri); });
  const yukle = async () => {
    const sira = ++durum.sayac; hedef.innerHTML = html`<p class="muted">Aylık özet hesaplanıyor…</p>`.s;
    try {
      if (!tahsilatlar) tahsilatlar = await app.api.listPayments();
      const veri = await girdiYukle(app, durum.ay);
      if (sira !== durum.sayac) return;                         // eski istek: sonucu at
      const o = aylikOzet({ veri, tahsilatlar }); const seri = aylikSeri({ veri });
      hedef.innerHTML = icerik(o, seri).s; ciz(hedef); son = { o, seri };
    } catch (e) {
      if (sira !== durum.sayac) return;
      hedef.innerHTML = emptyState({ simge: 'alert', baslik: 'Aylık özet yüklenemedi', metin: humanError(e) }).s; toast(humanError(e), 'hata');
    }
  };
  kok.querySelector('#yon-ay').addEventListener('change', (e) => { durum.ay = e.target.value; yukle(); });
  yukle();
}

/** Tıklanan kartı açılır pencerede büyük gösterir; grafiklerde noktaların/çubukların üzerine gelince tutar görünür. */
function buyut(tur, o, seri) {
  const ay = ayAdi(o.ay); const etiketler = seri.map((m) => m.ay);
  const firmaListesi = (liste, baslik, aciklama) => {
    const en = Math.max(1, ...liste.map((x) => Math.abs(x.kar)));
    openModal({ baslik, altBaslik: `${ay} · ${sayi(liste.length)} firma · ${aciklama}`, boyut: 'lg', govde: liste.length
      ? html`<ol class="yon-siralama">${liste.map((f) => html`<li><span class="yon-sira-ad"><a class="link" href="#/firmalar/${f.id}" data-close>${f.ad}</a></span>
          <span class="bars-track"><span class="bars-fill ${f.kar < 0 ? 'bars-neg' : 'bars-pos'}" data-w="${Math.max(2, Math.round((Math.abs(f.kar) / en) * 100))}"></span></span>
          <span class="bars-n ${f.kar < 0 ? 'neg' : ''}">${para2(f.kar)}</span></li>`)}</ol>` : html`<p class="muted">Bu ay için firma verisi yok.</p>` });
    document.querySelectorAll('.modal .bars-fill[data-w]').forEach((e) => { e.style.width = `${e.dataset.w}%`; });
  };
  if (tur === 'enkarli') return firmaListesi(o.tumFirmalar, 'Firma kârlılığı — en kârlıdan en düşüğe', 'dağıtılmış genel gider sonrası tahmini kâr');
  if (tur === 'endusuk') return firmaListesi([...o.tumFirmalar].reverse(), 'Firma kârlılığı — en düşükten en kârlıya', 'negatif tutarlar zarar eden müşterilerdir');
  const gelirGider = [{ ad: 'Gelir (KDV hariç)', sinif: 'gelir', degerler: seri.map((m) => m.gelir) }, { ad: 'Gider', sinif: 'gider', degerler: seri.map((m) => m.gider) }, { ad: 'Kâr (vergi öncesi)', sinif: 'kar', degerler: seri.map((m) => m.vergiOncesi) }];
  const kar = [{ ad: 'Vergi öncesi', sinif: 'oncesi', degerler: seri.map((m) => m.vergiOncesi) }, { ad: 'Vergi sonrası', sinif: 'sonrasi', degerler: seri.map((m) => m.vergiSonrasi), kesik: true }];
  const [ad, seriler, cizim] = tur === 'kar' ? ['Aylık kâr eğilimi (son 12 ay)', kar, cizgiGrafik] : ['Aylık gelir, gider ve kâr (son 12 ay)', gelirGider, cubukGrafik];
  openModal({ baslik: ad, altBaslik: 'Çubukların veya noktaların üzerine gelince o ayın tutarı görünür.', boyut: 'xl',
    govde: html`<div class="grafik-buyuk">${cizim({ ad, etiketler, seriler, buyuk: true })}</div>${lejant(seriler)}` });
}
