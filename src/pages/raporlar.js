// OSGB 360 - Raporlar: aylık yönetici özeti ve ekrandan CSV'ye indirilebilen özet raporlar. Mantık: lib/aktarim.js
import { html, bugun, tarih, para2, sayi, ayAdi, ayBasi } from '../lib/format.js';
import { icon } from '../ui/icons.js';
import { emptyState, toast } from '../ui/components.js';
import { RAPORLAR } from '../lib/aktarim.js';
import { csvIndir } from '../ui/indir.js';
import { humanError } from '../lib/api.js';

const MODUL_ADI = { companies: 'Firmalar', contracts: 'Sözleşmeler', invoices: 'Faturalar', expenses: 'Giderler' };
const ONIZLEME_SATIRI = 200;
const ISO_TARIH = /^\d{4}-\d{2}-\d{2}$/;

const aySecenekleri = (bugunStr) => {
  const [y, mo] = bugunStr.split('-').map(Number); const l = [];
  for (let i = 0; i < 24; i += 1) { const t = new Date(y, mo - 1 - i, 1); l.push(`${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-01`); }
  return l;
};

/** Kullanıcının görüntüleme izni olan veri kümelerini yükler. İzni olmayan küme boş kalır (rapor zaten kilitli sayılır). */
export async function raporVerisiYukle(app) {
  const can = (m) => app.can(m, 'view');
  const [firmalar, profiller, sozlesmeler, faturalar, tahsilatlar, giderler, kategoriler] = await Promise.all([
    can('companies') ? app.api.listCompanies() : [],
    can('companies') ? app.api.listAllProfiles() : [],
    can('contracts') ? app.api.listContracts() : [],
    can('invoices') ? app.api.listInvoices() : [],
    can('invoices') ? app.api.listPayments() : [],
    can('expenses') ? app.api.listExpenses() : [],
    can('expenses') ? app.api.listExpenseCategories() : [],
  ]);
  return { firmalar, profiller, sozlesmeler, faturalar, tahsilatlar, giderler, kategoriler, bugun: bugun() };
}

const hucre = (v, rapor, satirNo, sutunNo) => {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'number') return (rapor.paraSutunlari?.includes(sutunNo) || rapor.paraSatirlari?.includes(satirNo)) ? para2(v) : sayi(v);
  return ISO_TARIH.test(String(v)) ? tarih(v) : String(v);
};

export const eksikModuller = (app, rapor) => rapor.moduller.filter((m) => !app.can(m, 'view'));

export async function raporlarSayfasi(app) {
  const veri = await raporVerisiYukle(app);
  const kullanilabilir = RAPORLAR.filter((r) => !eksikModuller(app, r).length);
  const durum = { id: (kullanilabilir[0] ?? RAPORLAR[0]).id, ay: ayBasi(bugun()) };
  const secili = () => RAPORLAR.find((r) => r.id === durum.id);

  const govdeCiz = () => {
    const r = secili(); const eksik = eksikModuller(app, r);
    if (eksik.length) {
      return emptyState({ simge: 'lock', baslik: 'Bu rapor için izniniz yok', metin: `Bu rapor ${eksik.map((m) => MODUL_ADI[m]).join(', ')} verilerini kullanır; bu modüllerin görüntüleme izni gerekir. İşletme sahibi Kullanıcılar ve yetkiler sayfasından izin verebilir.` });
    }
    const o = r.uret(veri, durum.ay);
    if (!o.satirlar.length) return emptyState({ simge: 'bars', baslik: r.aylik ? `${ayAdi(durum.ay)} için kayıt yok` : 'Raporlanacak kayıt yok', metin: 'Veri girildikçe bu rapor otomatik dolar.' });
    const gorunen = o.satirlar.slice(0, ONIZLEME_SATIRI);
    const sayisal = (s) => o.satirlar.some((x) => typeof x[s] === 'number');
    return html`<div class="table-wrap"><table class="table" id="rapor-tablo"><caption class="sr-only">${r.ad}</caption>
      <thead><tr>${o.basliklar.map((b, i) => html`<th scope="col" class="${sayisal(i) ? 'num' : ''}">${b}</th>`)}</tr></thead>
      <tbody>${gorunen.map((s, si) => html`<tr>${s.map((v, i) => html`<td class="${typeof v === 'number' ? 'num' : ''}">${hucre(v, r, si, i)}</td>`)}</tr>`)}</tbody>
      ${o.toplam ? html`<tfoot><tr>${o.toplam.map((v, i) => (i === 0 ? html`<th scope="row">${v}</th>` : html`<td class="num"><strong>${hucre(v, r, -1, i)}</strong></td>`))}</tr></tfoot>` : ''}</table></div>
      ${o.satirlar.length > ONIZLEME_SATIRI ? html`<p class="fine pad">Ekranda ilk ${sayi(ONIZLEME_SATIRI)} satır gösteriliyor; CSV dosyası ${sayi(o.satirlar.length)} satırın tamamını içerir.</p>` : ''}`;
  };

  const araCubuk = () => html`<div class="toolbar">
    <label class="select-inline"><span class="sr-only">Rapor</span><select id="rapor-sec">${RAPORLAR.map((r) => html`<option value="${r.id}" ${r.id === durum.id ? html`selected` : ''}>${r.ad}${eksikModuller(app, r).length ? ' (izin gerekli)' : ''}</option>`)}</select></label>
    <label class="select-inline" id="rapor-ay-kutu" ${secili().aylik ? '' : html`hidden`}><span class="sr-only">Ay</span><select id="rapor-ay">${aySecenekleri(bugun()).map((a) => html`<option value="${a}" ${a === durum.ay ? html`selected` : ''}>${ayAdi(a)}</option>`)}</select></label>
    <button type="button" class="btn btn-secondary btn-sm toolbar-ozet" id="rapor-indir" data-action="rapor-indir">${icon('upload', 16)} CSV indir</button>
  </div>`;

  return {
    baslik: 'Raporlar', altBaslik: 'Yönetici özetleri; her rapor Excel\'de açılabilen CSV olarak indirilir',
    govde: html`<div class="notice notice-info" role="note">Raporlar, giriş yapan kullanıcının görebildiği kayıtlarla hazırlanır. Tutarlar, aksi belirtilmedikçe fatura ve gider kayıtlarındaki değerlerdir; yönetim bilgisidir, muhasebe veya vergi beyanı yerine geçmez.</div>
      <section class="card card-flush">${araCubuk()}<p class="card-sub pad" id="rapor-aciklama">${secili().aciklama}</p><div id="rapor-govde">${govdeCiz()}</div></section>
      <section class="card pad-t"><h2 class="card-title">Kârlılık raporları</h2><p class="card-sub">Firma ve personel kârlılığı kendi sayfalarında hesaplanır.</p>
        <p><a class="btn btn-secondary btn-sm" href="#/firma-karlilik">Firma kârlılığı</a> <a class="btn btn-secondary btn-sm" href="#/personel-karlilik">Personel kârlılığı</a>
        <a class="btn btn-secondary btn-sm" href="#/aktarim">Tüm verileri dışa aktar</a></p></section>`,
    mount(kok) {
      const yenile = () => {
        kok.querySelector('#rapor-govde').innerHTML = govdeCiz().s;
        kok.querySelector('#rapor-aciklama').textContent = secili().aciklama;
        kok.querySelector('#rapor-ay-kutu').hidden = !secili().aylik;
        kok.querySelector('#rapor-indir').disabled = eksikModuller(app, secili()).length > 0;
      };
      kok.querySelector('#rapor-sec').addEventListener('change', (e) => { durum.id = e.target.value; yenile(); });
      kok.querySelector('#rapor-ay').addEventListener('change', (e) => { durum.ay = e.target.value; yenile(); });
      yenile();
      kok.querySelector('#rapor-indir').addEventListener('click', () => {
        try {
          const r = secili(); const o = r.uret(veri, durum.ay);
          const ad = csvIndir(`rapor-${r.id}${r.aylik ? `-${durum.ay.slice(0, 7)}` : ''}`, o.basliklar, o.toplam ? [...o.satirlar, o.toplam] : o.satirlar, bugun());
          toast(`${ad} indirildi.`);
        } catch (err) { toast(humanError(err), 'hata'); }
      });
    },
  };
}
