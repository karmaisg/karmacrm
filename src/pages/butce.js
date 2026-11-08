// OSGB 360 - Yıllık Bütçe: firma bazında gelecek yıl hizmet bedeli artışı çalışması.
// Her hücre değişince o satır otomatik kaydedilir. Tutarlar KDV hariçtir.
import { html, bugun, para2 } from '../lib/format.js';
import { icon } from '../ui/icons.js';
import { emptyState, confirmDialog, toast } from '../ui/components.js';
import { humanError } from '../lib/api.js';
import { guncelProfil, profilleriGrupla } from '../lib/veri.js';
import { guncelFiyat, fiyatAylikHaric } from '../lib/ticari.js';
import { DURUMLAR, DURUM_RENGI, FIYAT_TURU, sayiOku, sayiMi, yuzdeFiyata, fiyatYuzdeye, otomatikOrtalamalar, satirHesapla, toplamlar } from '../lib/butce.js';

const trSirala = (a, b) => String(a).localeCompare(String(b), 'tr');
const girdiDegeri = (x) => (x === null || x === undefined ? '' : String(x).replace('.', ','));
const yuzdeMetni = (oran) => (oran === null || oran === undefined ? '—' : `%${(oran * 100).toLocaleString('tr-TR', { maximumFractionDigits: 2 })}`);

export async function butceSayfasi(app) {
  const bugunStr = bugun(); const buYil = Number(bugunStr.slice(0, 4));
  const durum = { yil: buYil + 1, ara: '' };
  const yaz = app.can('budget', 'edit') && app.can('budget', 'create');
  const [firmalar, faturalar, profiller, sozlesmeler, fiyatlar] = await Promise.all([
    app.api.listCompanies(), app.api.listInvoices().catch(() => []), app.api.listAllProfiles().catch(() => []),
    app.can('contracts', 'view') ? app.api.listContracts().catch(() => []) : [], app.can('contracts', 'view') ? app.api.listAllContractPrices().catch(() => []) : [],
  ]);
  const profilHaritasi = profilleriGrupla(profiller, firmalar);
  let satirlar = new Map(); let oto = new Map(); let kok = null;

  const veriYukle = async () => {
    const liste = await app.api.listBudgetLines(durum.yil).catch(() => null);
    satirlar = new Map((liste ?? []).map((x) => [x.company_id, x]));
    oto = otomatikOrtalamalar(faturalar, firmalar, durum.yil - 1);
    return liste !== null;
  };
  const gorunenFirmalar = () => firmalar.filter((f) => !f.archived_at && !f.parent_company_id && (f.customer_status === 'musteri' || satirlar.has(f.id))).sort((a, b) => trSirala(a.name, b.name));
  const hesap = (f) => satirHesapla(satirlar.get(f.id) ?? {}, oto.get(f.id)?.ortalama ?? null);
  const calisanSayisi = (id) => guncelProfil(profilHaritasi.get(id), bugunStr)?.employee_count ?? null;

  const renk = (f) => DURUM_RENGI[satirlar.get(f.id)?.status] ?? '';
  const girdi = (alan, deger, { uzun = false, dar = false, ipucu = '', etiket }) => html`<input class="butce-in ${uzun ? 'butce-uzun' : ''} ${dar ? 'butce-dar' : ''}" type="text" ${alan === 'employee_count' ? html`inputmode="numeric"` : html`inputmode="decimal"`} data-alan="${alan}" value="${girdiDegeri(deger)}" placeholder="${ipucu}" aria-label="${etiket}" ${yaz ? '' : html`disabled`}>`;

  const satirHtml = (f) => {
    const s = satirlar.get(f.id) ?? {}; const h = hesap(f); const o = oto.get(f.id);
    return html`<tr data-firma="${f.id}">
      <th scope="row" class="butce-firma"><a class="link butce-ad ${renk(f)}" href="#/firmalar/${f.id}">${f.name}</a></th>
      <td><select class="butce-in" data-alan="price_type" aria-label="Fiyat türü" ${yaz ? '' : html`disabled`}>${Object.entries(FIYAT_TURU).map(([d, e]) => html`<option value="${d}" ${h.tur === d ? html`selected` : ''}>${e}</option>`)}</select></td>
      <td>${girdi('unit_price', s.unit_price, { dar: true, etiket: 'Önceki yıl fiyatı' })}</td>
      <td>${girdi('employee_count', s.employee_count, { dar: true, ipucu: calisanSayisi(f.id) ?? '', etiket: 'Çalışan sayısı' })}</td>
      <td class="num" data-c="oncekiAylik">${para2(h.oncekiAylik)}</td>
      <td>${girdi('prev_avg_income', s.prev_avg_income, { ipucu: o?.ortalama != null ? girdiDegeri(o.ortalama) : 'fatura yok', etiket: 'Önceki yıl aylık ortalama gelir' })}
        <small class="block muted" data-c="ortKaynak">${h.elle ? 'elle girildi' : (o ? `otomatik · ${o.ay} ay` : 'otomatik · fatura yok')}${h.elle && yaz ? html` · <button type="button" class="link-btn" data-oto-sifirla>otomatik yap</button>` : ''}</small></td>
      <td>${girdi('increase_pct', s.increase_pct, { dar: true, etiket: 'Talep edilen artış yüzdesi' })}</td>
      <td>${girdi('increase_price', s.increase_price, { dar: true, etiket: 'Talep edilen artışlı fiyat' })}</td>
      <td>${girdi('accepted_price', s.accepted_price, { dar: true, etiket: 'Kabul edilen hizmet bedeli' })}</td>
      <td class="num" data-c="artis">${h.artisOrani === null ? '—' : html`${yuzdeMetni(h.artisOrani)}<small class="block muted">${h.artisTutari >= 0 ? '+' : ''}${para2(h.artisTutari)} / ay</small>`}</td>
      <td class="num" data-c="beklenen"><strong>${para2(h.beklenen)}</strong></td>
      <td><select class="butce-in" data-alan="status" aria-label="Görüşme durumu" ${yaz ? '' : html`disabled`}><option value="">Seçilmedi</option>${Object.entries(DURUMLAR).map(([d, e]) => html`<option value="${d}" ${s.status === d ? html`selected` : ''}>${e}</option>`)}</select></td>
      <td><input class="butce-in butce-not" type="text" maxlength="4000" data-alan="note" value="${s.note ?? ''}" aria-label="Görüşme notu" ${yaz ? '' : html`disabled`}></td></tr>`;
  };

  const toplamHtml = () => {
    const liste = gorunenFirmalar(); const hs = liste.map(hesap); const t = toplamlar(hs);
    return html`<tr><th scope="row" colspan="4">Toplam (${liste.length} firma)</th><td class="num">${para2(t.oncekiFiyat)}</td><td class="num"><span class="muted block">Önceki yıl ort. aylık gelir</span>${para2(t.ortalama)}</td>
      <td colspan="3"></td><td class="num">${yuzdeMetni(t.artisOrani)}<span class="muted block">artış</span></td><td class="num"><span class="muted block">Beklenen aylık gelir</span>${para2(t.beklenen)}</td><td colspan="2"></td></tr>`;
  };
  const ozetHtml = () => {
    const t = toplamlar(gorunenFirmalar().map(hesap));
    return html`<div class="kpi-grid">
      <section class="card kpi"><span class="kpi-ic">${icon('wallet', 22)}</span><div><div class="kpi-l">${durum.yil - 1} ort. aylık gelir (toplam)</div><div class="kpi-v" data-toplam="ortalama">${para2(t.ortalama)}</div><div class="kpi-s">firmaların aylık ortalamaları toplamı</div></div></section>
      <section class="card kpi"><span class="kpi-ic">${icon('trend', 22)}</span><div><div class="kpi-l">${durum.yil} beklenen aylık gelir (toplam)</div><div class="kpi-v" data-toplam="beklenen">${para2(t.beklenen)}</div><div class="kpi-s">${t.belirsiz} firmanın bedeli henüz belli değil</div></div></section>
      <section class="card kpi"><span class="kpi-ic">${icon('bars', 22)}</span><div><div class="kpi-l">Önceki yıla göre artış</div><div class="kpi-v" data-toplam="artis">${yuzdeMetni(t.artisOrani)}</div><div class="kpi-s">bedeli belli olan ${t.karsilastirilan} firma üzerinden</div></div></section></div>`;
  };

  const ciz = (veriVar) => {
    const liste = gorunenFirmalar();
    const ara = durum.ara.trim().toLocaleLowerCase('tr');
    const gosterilen = liste.filter((f) => !ara || f.name.toLocaleLowerCase('tr').includes(ara));
    const uyari = veriVar ? '' : html`<div class="alert alert-warning">Yıllık bütçe tablosu bulunamadı. Lütfen <code>34_asama33.sql</code> dosyasını Supabase'de çalıştırın.</div>`;
    const tablo = liste.length ? html`<div id="butce-ozet">${ozetHtml()}</div>
      <section class="card card-flush"><div class="table-wrap"><table class="table butce-tablo"><thead><tr>
        <th scope="col">Firma</th><th scope="col">Fiyat türü</th><th scope="col">${durum.yil - 1} fiyatı (TL)<small class="block muted">sabit aylık / kişi başı</small></th><th scope="col">Çalışan</th><th scope="col" class="num">Aylık hizmet fiyatı</th>
        <th scope="col">${durum.yil - 1} aylık ort. gelir</th><th scope="col">Talep edilen artış %</th><th scope="col">Talep edilen fiyat</th><th scope="col">Kabul edilen bedel</th><th scope="col" class="num">Gerçekleşen artış</th>
        <th scope="col" class="num">${durum.yil} beklenen aylık gelir</th><th scope="col">Durum</th><th scope="col">Açıklama</th></tr></thead>
        <tbody>${gosterilen.map(satirHtml)}</tbody><tfoot id="butce-toplam">${toplamHtml()}</tfoot></table></div></section>`
      : emptyState({ simge: 'building', baslik: 'Listelenecek firma yok', metin: 'Müşteri durumundaki firmalar burada listelenir.' });
    kok.querySelector('#butce-govde').innerHTML = html`${uyari}${tablo}`.s;
  };

  // ---- hesaplanan hücreleri yerinde güncelle (odak kaybolmasın)
  const satiriGuncelle = (tr) => {
    const f = firmalar.find((x) => x.id === tr.dataset.firma); const s = satirlar.get(f.id) ?? {}; const h = hesap(f); const o = oto.get(f.id);
    const yerles = (c, v) => { const el = tr.querySelector(`[data-c="${c}"]`); if (el) el.innerHTML = v.s ?? v; };
    yerles('oncekiAylik', para2(h.oncekiAylik));
    yerles('beklenen', html`<strong>${para2(h.beklenen)}</strong>`);
    yerles('artis', h.artisOrani === null ? '—' : html`${yuzdeMetni(h.artisOrani)}<small class="block muted">${h.artisTutari >= 0 ? '+' : ''}${para2(h.artisTutari)} / ay</small>`);
    yerles('ortKaynak', html`${h.elle ? 'elle girildi' : (o ? `otomatik · ${o.ay} ay` : 'otomatik · fatura yok')}${h.elle && yaz ? html` · <button type="button" class="link-btn" data-oto-sifirla>otomatik yap</button>` : ''}`);
    const ad = tr.querySelector('.butce-ad'); ad.classList.remove('yesil', 'kirmizi', 'turuncu'); if (renk(f)) ad.classList.add(renk(f));
    for (const alan of ['unit_price', 'employee_count', 'prev_avg_income', 'increase_pct', 'increase_price', 'accepted_price']) {
      const el = tr.querySelector(`[data-alan="${alan}"]`); if (el && !el.dataset.kirli) el.value = girdiDegeri(s[alan]);
    }
    kok.querySelector('#butce-toplam').innerHTML = toplamHtml().s;
    const t = toplamlar(gorunenFirmalar().map(hesap));
    kok.querySelector('[data-toplam="ortalama"]').textContent = para2(t.ortalama); kok.querySelector('[data-toplam="beklenen"]').textContent = para2(t.beklenen); kok.querySelector('[data-toplam="artis"]').textContent = yuzdeMetni(t.artisOrani);
  };

  const kaydet = async (firmaId, degerler) => {
    const mevcut = satirlar.get(firmaId);
    const kayit = mevcut ? await app.api.updateBudgetLine(mevcut.id, degerler) : await app.api.createBudgetLine({ budget_year: durum.yil, company_id: firmaId, ...degerler });
    satirlar.set(firmaId, kayit); return kayit;
  };

  const degistir = async (el) => {
    delete el.dataset.kirli; const tr = el.closest('tr[data-firma]'); if (!tr) return;
    const id = tr.dataset.firma; const alan = el.dataset.alan; const s = satirlar.get(id) ?? { price_type: 'sabit' };
    const bos = el.value.trim() === ''; let d = {};
    const sayi = (eksi = false) => sayiOku(el.value, eksi);
    if (alan === 'price_type') {
      d.price_type = el.value;
      if (el.value === 'kisi_basi' && !sayiMi(s.employee_count) && calisanSayisi(id) != null) d.employee_count = calisanSayisi(id);
    } else if (alan === 'status') d.status = el.value || null;
    else if (alan === 'note') d.note = bos ? null : el.value.trim();
    else {
      const v = bos ? null : sayi(alan === 'increase_pct');
      if (!bos && v === null) { toast('Geçerli bir sayı girin.', 'hata'); el.value = girdiDegeri(s[alan]); return; }
      if (alan === 'employee_count') d.employee_count = v === null ? null : Math.round(v);
      else if (alan === 'unit_price') { d.unit_price = v; if (sayiMi(s.increase_pct)) d.increase_price = yuzdeFiyata(v, s.increase_pct); }
      else if (alan === 'increase_pct') { d.increase_pct = v; d.increase_price = yuzdeFiyata(s.unit_price, v); }
      else if (alan === 'increase_price') { d.increase_price = v; d.increase_pct = fiyatYuzdeye(s.unit_price, v); }
      else d[alan] = v;                                           // prev_avg_income, accepted_price
    }
    try { await kaydet(id, d); satiriGuncelle(tr); } catch (e) { toast(humanError(e), 'hata'); }
  };

  const sozlesmedenDoldur = async () => {
    const yil = durum.yil - 1; const adaylar = [];
    for (const f of gorunenFirmalar()) {
      const s = satirlar.get(f.id); if (sayiMi(s?.unit_price)) continue;
      const cs = sozlesmeler.filter((c) => c.company_id === f.id && !c.archived_at).sort((a, b) => String(b.end_date).localeCompare(String(a.end_date)));
      for (const c of cs) {
        const ps = fiyatlar.filter((p) => p.contract_id === c.id);
        const p = guncelFiyat(ps, `${yil}-12-31`) ?? guncelFiyat(ps, bugunStr) ?? ps[0];
        if (p) { adaylar.push({ f, p }); break; }
      }
    }
    if (!adaylar.length) { toast('Doldurulacak sözleşme fiyatı bulunamadı.'); return; }
    if (!(await confirmDialog({ baslik: 'Sözleşme fiyatlarından doldur', onayEtiketi: 'Doldur', mesaj: `${adaylar.length} firmanın boş olan önceki yıl fiyatı, sözleşmedeki fiyattan (KDV hariç) doldurulacak. Mevcut girişlere dokunulmaz.` }))) return;
    try {
      for (const { f, p } of adaylar) {
        await kaydet(f.id, { price_type: p.pricing === 'kisi_basi' ? 'kisi_basi' : 'sabit', unit_price: fiyatAylikHaric(p, 1), employee_count: p.pricing === 'kisi_basi' ? calisanSayisi(f.id) : null });
      }
      toast(`${adaylar.length} firma dolduruldu.`); ciz(true);
    } catch (e) { toast(humanError(e), 'hata'); ciz(true); }
  };

  return {
    baslik: 'Yıllık Bütçe', altBaslik: 'Gelecek yıl hizmet bedeli artışı çalışması; değişiklikler otomatik kaydedilir, tutarlar KDV hariçtir',
    eylemler: yaz && sozlesmeler.length ? html`<button type="button" class="btn btn-secondary" data-action="sozlesmeden-doldur">${icon('contract', 18)} Sözleşme fiyatlarından doldur</button>` : '',
    govde: html`<section class="card card-flush"><div class="toolbar">
      <label class="select-inline"><span class="sr-only">Bütçe yılı</span><select id="butce-yil">${[buYil, buYil + 1, buYil + 2].map((y) => html`<option value="${y}" ${y === durum.yil ? html`selected` : ''}>${y} bütçesi</option>`)}</select></label>
      <label class="search-field"><span class="sr-only">Firma ara</span><input type="search" id="butce-ara" placeholder="Firma ara" autocomplete="off"></label>
      <span class="muted fine">Önceki yıl: ${html`<strong id="butce-onceki">${durum.yil - 1}</strong>`} · Ortalama gelir, o yıl kesilen "fatura" türü faturaların aylık ortalamasıdır (elle de girilebilir).</span></div></section>
      <div id="butce-govde"></div>`,
    async mount(k) {
      kok = k;
      const hazir = await veriYukle(); ciz(hazir);
      k.addEventListener('change', (e) => {
        if (e.target.id === 'butce-yil') { durum.yil = Number(e.target.value); k.querySelector('#butce-onceki').textContent = durum.yil - 1; veriYukle().then((h) => ciz(h)); return; }
        if (e.target.dataset.alan && yaz) degistir(e.target);
      });
      k.addEventListener('input', (e) => { if (e.target.id === 'butce-ara') { durum.ara = e.target.value; ciz(true); } else if (e.target.dataset.alan) e.target.dataset.kirli = '1'; });
      k.addEventListener('click', async (e) => {
        if (e.target.closest('[data-action="sozlesmeden-doldur"]')) { await sozlesmedenDoldur(); return; }
        const sf = e.target.closest('[data-oto-sifirla]');
        if (sf && yaz) { const tr = sf.closest('tr'); try { await kaydet(tr.dataset.firma, { prev_avg_income: null }); satiriGuncelle(tr); } catch (err) { toast(humanError(err), 'hata'); } }
      });
    },
  };
}
