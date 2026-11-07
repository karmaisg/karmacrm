// OSGB 360 - Gelirler: ay bazında toplam gelir ve gelir kalemlerinin listesi (faturalar, spot ve elden gelirler).
import { html, bugun, tarih, para, para2, sayi, ayAdi, ayBasi } from '../lib/format.js';
import { icon } from '../ui/icons.js';
import { pill, emptyState, sayfalama } from '../ui/components.js';
import { faturaDurumu, tahsilatHaritasi } from '../lib/finans.js';
import { faturaAyi } from '../lib/karlilik.js';
import { odemePill } from './faturalar.js';

const SAYFA_BASI = 30;
const TUR = { fatura: 'Fatura', spot: 'Spot iş', elden: 'Elden ödeme' };
const kurus = (x) => Math.round(Number(x ?? 0) * 100);

const aySecenekleri = (bugunStr) => {
  const [y, mo] = bugunStr.split('-').map(Number); const l = [];
  for (let i = -1; i < 24; i += 1) { const t = new Date(y, mo - 1 - i, 1); l.push(`${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-01`); }
  return l;
};

export async function gelirlerSayfasi(app) {
  const bugunStr = bugun();
  const [faturalar, tahsilatlar, firmalar] = await Promise.all([
    app.api.listInvoices(), app.api.listPayments(), app.can('companies', 'view') ? app.api.listCompanies() : [],
  ]);
  const firmaAdi = new Map(firmalar.map((f) => [f.id, f.name]));
  const harita = tahsilatHaritasi(tahsilatlar);
  const durum = { ay: ayBasi(bugunStr), tur: '', sayfa: 1 };
  const tur = (f) => f.income_kind ?? 'fatura';
  const dahil = (f) => Number(f.amount_incl_vat ?? Number(f.amount_excl_vat) + Number(f.vat_amount));

  const aydakiler = () => faturalar.filter((f) => !f.archived_at && faturaAyi(f) === durum.ay.slice(0, 7));
  const gorunen = () => aydakiler().filter((f) => !durum.tur || tur(f) === durum.tur)
    .sort((a, b) => String(b.invoice_date).localeCompare(String(a.invoice_date)) || String(b.id).localeCompare(String(a.id)));
  const ozet = () => {
    const l = aydakiler(); let haric = 0; let kdv = 0; let tahsil = 0; let kalan = 0;
    const turToplam = {};
    for (const f of l) {
      const d = faturaDurumu(f, harita.get(f.id) ?? [], bugunStr);
      haric += kurus(f.amount_excl_vat); kdv += kurus(f.vat_amount); tahsil += kurus(d.tahsilEdilen); kalan += Math.max(0, kurus(d.kalan));
      turToplam[tur(f)] = (turToplam[tur(f)] ?? 0) + kurus(f.amount_excl_vat);
    }
    const kutu = (e, d, a, s) => html`<section class="card kpi"><span class="kpi-ic">${icon(s, 22)}</span><div><div class="kpi-l">${e}</div><div class="kpi-v">${d}</div><div class="kpi-s">${a}</div></div></section>`;
    const alt = Object.entries(turToplam).map(([k, v]) => `${TUR[k] ?? k}: ${para(v / 100)}`).join(' · ');
    return html`<div class="kpi-grid">${kutu('Toplam gelir', para(haric / 100), `KDV hariç · ${sayi(l.length)} kayıt`, 'wallet')}${kutu('KDV dahil toplam', para((haric + kdv) / 100), `KDV ${para(kdv / 100)}`, 'receipt')}
      ${kutu('Tahsil edilen', para(tahsil / 100), alt || 'KDV dahil', 'bars')}${kutu('Kalan alacak', para(kalan / 100), 'KDV dahil', 'clock')}</div>`;
  };
  const satir = (f) => {
    const d = faturaDurumu(f, harita.get(f.id) ?? [], bugunStr);
    const kim = f.company_id ? (firmaAdi.get(f.company_id) ?? 'Firma') : (f.customer_name ?? 'Firma dışı');
    return html`<tr><td>${tarih(f.invoice_date)}</td><td><strong>${f.invoice_no ?? '—'}</strong>${f.description ? html`<small class="block muted">${f.description}</small>` : ''}</td>
      <td class="hide-sm">${kim}</td><td>${pill(TUR[tur(f)] ?? tur(f), tur(f) === 'fatura' ? 'info' : 'neutral')}</td>
      <td class="num">${para2(f.amount_excl_vat)}<small class="block muted">KDV dahil ${para2(dahil(f))}</small></td>
      <td class="hide-sm">${odemePill(d.durum)}</td></tr>`;
  };
  const tablo = () => {
    const l = gorunen();
    if (!l.length) {
      return emptyState({ simge: 'wallet', baslik: `${ayAdi(durum.ay)} için gelir yok`, metin: 'Fatura ve gelir kayıtları Fatura Takip sayfasında girilir; burada ay bazında toplanır.',
        eylem: app.can('invoices', 'create') ? html`<a class="btn btn-primary" href="#/tahsilat">Fatura Takip'e git</a>` : '' });
    }
    const sayfaSayisi = Math.max(1, Math.ceil(l.length / SAYFA_BASI)); durum.sayfa = Math.min(durum.sayfa, sayfaSayisi);
    return html`<div class="table-wrap"><table class="table"><thead><tr><th scope="col">Tarih</th><th scope="col">Fatura / açıklama</th><th scope="col" class="hide-sm">Firma / müşteri</th><th scope="col">Tür</th><th scope="col" class="num">Tutar</th><th scope="col" class="hide-sm">Durum</th></tr></thead>
      <tbody>${l.slice((durum.sayfa - 1) * SAYFA_BASI, durum.sayfa * SAYFA_BASI).map(satir)}</tbody></table></div>${sayfalama({ sayfa: durum.sayfa, sayfaSayisi, toplam: l.length, sayfaBasi: SAYFA_BASI })}`;
  };

  return {
    baslik: 'Gelirler', altBaslik: 'Ay bazında toplam gelir ve gelir kalemleri; tutarlar KDV hariç esas alınır, KDV dahil tutar da gösterilir',
    eylemler: html`<a class="btn btn-secondary" href="#/tahsilat">Fatura Takip</a>`,
    govde: html`<div id="gelir-ozet">${ozet()}</div>
      <section class="card card-flush"><div class="toolbar">
        <label class="select-inline"><span class="sr-only">Ay</span><select id="gelir-ay">${aySecenekleri(bugunStr).map((a) => html`<option value="${a}" ${a === durum.ay ? html`selected` : ''}>${ayAdi(a)}</option>`)}</select></label>
        <label class="select-inline"><span class="sr-only">Tür</span><select id="gelir-tur"><option value="">Tüm türler</option>${Object.entries(TUR).map(([k, v]) => html`<option value="${k}">${v}</option>`)}</select></label>
      </div><div id="gelir-tablo">${tablo()}</div></section>
      <p class="fine pad">Gelir ayı, faturanın hizmet dönemi (varsa) yoksa fatura tarihidir; kârlılık raporlarıyla aynı kuraldır. Fatura ekleme ve tahsilat girişi Fatura Takip sayfasındadır.</p>`,
    mount(kok) {
      const t = kok.querySelector('#gelir-tablo'); const o = kok.querySelector('#gelir-ozet');
      const ciz = () => { t.innerHTML = tablo().s; o.innerHTML = ozet().s; };
      kok.querySelector('#gelir-ay').addEventListener('change', (e) => { durum.ay = e.target.value; durum.sayfa = 1; ciz(); });
      kok.querySelector('#gelir-tur').addEventListener('change', (e) => { durum.tur = e.target.value; durum.sayfa = 1; ciz(); });
      kok.addEventListener('click', (e) => { const sf = e.target.closest('[data-sayfa]'); if (sf && !sf.disabled) { durum.sayfa = Number(sf.dataset.sayfa); ciz(); } });
    },
  };
}
