// OSGB 360 - Yıllık Bütçe: Gelirler Tablosu (firma bazında fiyat artışı), Giderler Tablosu ve Kâr Durumu.
// Her hücre değişince o satır otomatik kaydedilir. Tutarlar KDV hariçtir.
import { html, bugun, para2 } from '../lib/format.js';
import { icon } from '../ui/icons.js';
import { emptyState, confirmDialog, toast, field, openFormModal } from '../ui/components.js';
import { humanError } from '../lib/api.js';
import { guncelProfil, profilleriGrupla } from '../lib/veri.js';
import { guncelFiyat, fiyatAylikHaric } from '../lib/ticari.js';
import { dosyaIndir } from '../ui/indir.js';
import { butceExcel } from '../lib/butce_excel.js';
import {
  DURUMLAR, DURUM_RENGI, FIYAT_TURU, VARSAYILAN_GIDERLER, sayiOku, sayiMi, otomatikOrtalamalar, satirHesapla, toplamlar,
  talepFiyati, talepYuzdesi, giderSatiri, giderlerHesapla, karDurumu,
} from '../lib/butce.js';

const XLSX_TURU = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const trSirala = (a, b) => String(a).localeCompare(String(b), 'tr');
const girdiDegeri = (x) => (x === null || x === undefined ? '' : String(x).replace('.', ','));
const yuzdeMetni = (oran) => (oran === null || oran === undefined ? '—' : `%${(oran * 100).toLocaleString('tr-TR', { maximumFractionDigits: 2 })}`);
const yuzdePuan = (p) => (p === null || p === undefined ? '—' : `%${p.toLocaleString('tr-TR', { maximumFractionDigits: 2 })}`);
const GELIR_ALANLARI = ['unit_price', 'employee_count', 'prev_avg_income', 'increase_pct', 'increase_price', 'accepted_price', 'expected_manual'];

export async function butceSayfasi(app) {
  const bugunStr = bugun(); const buYil = Number(bugunStr.slice(0, 4));
  const durum = { yil: buYil + 1, ara: '' };
  const yaz = app.can('budget', 'edit') && app.can('budget', 'create');
  const [firmalar, faturalar, profiller, sozlesmeler, fiyatlar] = await Promise.all([
    app.api.listCompanies(), app.api.listInvoices().catch(() => []), app.api.listAllProfiles().catch(() => []),
    app.can('contracts', 'view') ? app.api.listContracts().catch(() => []) : [], app.can('contracts', 'view') ? app.api.listAllContractPrices().catch(() => []) : [],
  ]);
  const profilHaritasi = profilleriGrupla(profiller, firmalar);
  let satirlar = new Map(); let giderler = []; let oto = new Map(); let kok = null;

  const anahtarOf = (l) => l.company_id ?? `c:${l.id}`;
  const veriYukle = async () => {
    const [liste, gl] = await Promise.all([app.api.listBudgetLines(durum.yil).catch(() => null), app.api.listBudgetExpenses(durum.yil).catch(() => null)]);
    satirlar = new Map((liste ?? []).map((x) => [anahtarOf(x), x]));
    giderler = gl ?? [];
    oto = otomatikOrtalamalar(faturalar, firmalar, durum.yil - 1);
    if (yaz && gl !== null && !gl.length) await giderleriTohumla().catch(() => {});
    return liste !== null && gl !== null;
  };
  const giderleriTohumla = async () => {
    giderler = await app.api.createBudgetExpenses(VARSAYILAN_GIDERLER.map((ad, i) => ({ budget_year: durum.yil, name: ad, sort_order: (i + 1) * 10, is_default: true, is_personnel: ad === 'Personel Giderleri' })));
  };

  // ------------------------------------------------------------ gelir satırları
  const gelirListesi = () => {
    const f = firmalar.filter((x) => !x.archived_at && !x.parent_company_id && (x.customer_status === 'musteri' || satirlar.has(x.id))).sort((a, b) => trSirala(a.name, b.name))
      .map((x) => ({ anahtar: x.id, ad: x.name, firma: x }));
    const o = [...satirlar.values()].filter((l) => !l.company_id).sort((a, b) => trSirala(a.custom_name, b.custom_name)).map((l) => ({ anahtar: `c:${l.id}`, ad: l.custom_name, ozel: l }));
    return [...f, ...o];
  };
  const hesap = (r) => satirHesapla(satirlar.get(r.anahtar) ?? {}, r.firma ? (oto.get(r.firma.id)?.ortalama ?? null) : null);
  const calisanSayisi = (id) => guncelProfil(profilHaritasi.get(id), bugunStr)?.employee_count ?? null;
  const renk = (r) => DURUM_RENGI[satirlar.get(r.anahtar)?.status] ?? '';
  const gelirToplam = () => toplamlar(gelirListesi().map(hesap));

  // ------------------------------------------------------------ gider satırları
  const giderSirali = () => {
    const ust = giderler.filter((g) => !g.parent_id).sort((a, b) => a.sort_order - b.sort_order || String(a.created_at).localeCompare(String(b.created_at)));
    return ust.flatMap((u) => [u, ...giderler.filter((g) => g.parent_id === u.id).sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))]);
  };
  const giderHesap = () => giderlerHesapla(giderler);

  const girdi = (alan, deger, { dar = false, ipucu = '', etiket, devreDisi = false, ozel = 'alan', sayisal = true }) =>
    html`<input class="butce-in ${dar ? 'butce-dar' : ''} ${sayisal ? 'butce-sayi' : ''}" type="text" ${alan === 'employee_count' ? html`inputmode="numeric"` : html`inputmode="decimal"`} data-${ozel}="${alan}" value="${girdiDegeri(deger)}" placeholder="${ipucu}" aria-label="${etiket}" ${yaz && !devreDisi ? '' : html`disabled`}>`;

  const turSecimi = (alan, deger, etiket, bosEtiket = null) => html`<select class="butce-in" data-alan="${alan}" aria-label="${etiket}" ${yaz ? '' : html`disabled`}>${bosEtiket ? html`<option value="">${bosEtiket}</option>` : ''}${Object.entries(FIYAT_TURU).map(([d, e]) => html`<option value="${d}" ${deger === d ? html`selected` : ''}>${e}</option>`)}</select>`;

  const kaynakMetni = (h, r) => (h.elle ? 'elle girildi' : (r.firma ? (oto.get(r.firma.id) ? `otomatik · ${oto.get(r.firma.id).ay} ay` : 'otomatik · fatura yok') : 'elle girin'));
  const artisHtml = (h) => (h.artisOrani === null ? '—' : html`${yuzdeMetni(h.artisOrani)}<small class="block muted">${h.artisTutari >= 0 ? '+' : ''}${para2(h.artisTutari)} / ay</small>`);
  const beklenenAlt = (h) => (h.beklenenElle ? html`elle girildi · <button type="button" class="link-btn" data-beklenen-sifirla>hesaplanana dön</button>` : 'hesaplanan');
  const aylikAlt = (h) => (h.yeniTur === 'kisi_basi' && h.kabulAylik !== null ? html`<small class="block muted" data-c="kabulAylik">= ${para2(h.kabulAylik)} / ay</small>` : html`<small class="block muted" data-c="kabulAylik"></small>`);

  const satirHtml = (r) => {
    const s = satirlar.get(r.anahtar) ?? {}; const h = hesap(r); const o = r.firma ? oto.get(r.firma.id) : null;
    return html`<tr data-anahtar="${r.anahtar}">
      <th scope="row" class="butce-firma">${r.firma ? html`<a class="link butce-ad ${renk(r)}" href="#/firmalar/${r.firma.id}">${r.ad}</a>` : html`<span class="butce-ad ${renk(r)}">${r.ad}</span>${yaz ? html` <button type="button" class="icon-btn" data-gelir-sil="${r.ozel.id}" aria-label="Satırı sil" title="Satırı sil">${icon('trash', 14)}</button>` : ''}`}</th>
      <td>${turSecimi('price_type', h.tur, 'Önceki yıl fiyat türü')}</td>
      <td>${girdi('unit_price', s.unit_price, { dar: true, etiket: 'Önceki yıl fiyatı' })}</td>
      <td>${girdi('employee_count', s.employee_count, { dar: true, ipucu: r.firma ? (calisanSayisi(r.firma.id) ?? '') : '', etiket: 'Çalışan sayısı' })}</td>
      <td class="num" data-c="oncekiAylik">${para2(h.oncekiAylik)}</td>
      <td>${girdi('prev_avg_income', s.prev_avg_income, { ipucu: o?.ortalama != null ? girdiDegeri(o.ortalama) : (r.firma ? 'fatura yok' : ''), etiket: 'Önceki yıl aylık ortalama gelir' })}
        <small class="block muted" data-c="ortKaynak">${kaynakMetni(h, r)}${h.elle && yaz && r.firma ? html` · <button type="button" class="link-btn" data-oto-sifirla>otomatik yap</button>` : ''}</small></td>
      <td>${girdi('increase_pct', s.increase_pct, { dar: true, etiket: 'Talep edilen artış yüzdesi' })}</td>
      <td>${turSecimi('next_price_type', s.next_price_type ?? '', `${durum.yil} fiyat türü`, 'Aynı')}</td>
      <td>${girdi('increase_price', s.increase_price, { dar: true, etiket: 'Talep edilen artışlı fiyat' })}</td>
      <td>${girdi('accepted_price', s.accepted_price, { dar: true, etiket: 'Kabul edilen hizmet bedeli' })}${aylikAlt(h)}</td>
      <td class="num" data-c="artis">${artisHtml(h)}</td>
      <td>${girdi('expected_manual', h.beklenen, { etiket: 'Beklenen aylık gelir' })}<small class="block muted" data-c="beklenenAlt">${beklenenAlt(h)}</small></td>
      <td><select class="butce-in" data-alan="status" aria-label="Görüşme durumu" ${yaz ? '' : html`disabled`}><option value="">Seçilmedi</option>${Object.entries(DURUMLAR).map(([d, e]) => html`<option value="${d}" ${s.status === d ? html`selected` : ''}>${e}</option>`)}</select></td>
      <td><input class="butce-in butce-not" type="text" maxlength="4000" data-alan="note" value="${s.note ?? ''}" aria-label="Görüşme notu" ${yaz ? '' : html`disabled`}></td></tr>`;
  };

  const gelirTfoot = () => {
    const liste = gelirListesi(); const t = toplamlar(liste.map(hesap));
    return html`<tr><th scope="row" colspan="4">Toplam (${liste.length} satır)</th><td class="num">${para2(t.oncekiFiyat)}</td><td class="num"><span class="muted block">${durum.yil - 1} ort. aylık gelir</span>${para2(t.ortalama)}</td>
      <td colspan="4"></td><td class="num"><span class="muted block">Artış (belli olanlar)</span>${yuzdeMetni(t.artisOrani)}</td><td class="num"><span class="muted block">${durum.yil} beklenen aylık gelir</span>${para2(t.beklenen)}</td><td colspan="2"></td></tr>`;
  };

  const giderSatirHtml = (g, hs) => {
    const v = hs.satirlar.get(g.id) ?? giderSatiri(g); const cocuk = !!g.parent_id; const toplamli = !!v.toplamli;
    return html`<tr data-gider="${g.id}" class="${cocuk ? 'butce-cocuk' : ''}">
      <th scope="row" class="butce-firma"><span class="butce-ad ${g.is_personnel ? 'butce-kalem-ust' : ''}">${cocuk ? html`<span class="butce-girinti" aria-hidden="true">↳</span> ` : ''}${g.name}</span>
        ${yaz && g.is_personnel ? html` <button type="button" class="btn btn-secondary btn-sm" data-personel-ekle="${g.id}">${icon('plus', 14)} Personel ekle</button>` : ''}
        ${yaz && !g.is_default ? html` <button type="button" class="icon-btn" data-gider-sil="${g.id}" aria-label="Satırı sil" title="Satırı sil">${icon('trash', 14)}</button>` : ''}</th>
      <td>${girdi('prev_avg_expense', v.prev, { etiket: `${g.name} önceki yıl aylık ortalama gider`, ozel: 'galan', devreDisi: toplamli })}</td>
      <td>${girdi('increase_pct', v.pct, { dar: true, etiket: `${g.name} artış yüzdesi`, ozel: 'galan', devreDisi: toplamli })}</td>
      <td>${girdi('next_avg_expense', v.next, { etiket: `${g.name} sonraki yıl aylık ortalama gider`, ozel: 'galan', devreDisi: toplamli })}${toplamli ? html`<small class="block muted">personel toplamı</small>` : ''}</td></tr>`;
  };
  const giderTfoot = () => {
    const r = giderHesap();
    return html`<tr><th scope="row">Toplam gider</th><td class="num">${para2(r.oncekiToplam)}</td><td class="num"><span class="muted block">ağırlıklı ortalama</span>${yuzdePuan(r.agirlikliArtis)}</td><td class="num">${para2(r.sonrakiToplam)}</td></tr>`;
  };

  const ozetHtml = () => {
    const t = gelirToplam();
    return html`<div class="kpi-grid butce-kpi">
      <section class="card kpi"><span class="kpi-ic">${icon('wallet', 22)}</span><div><div class="kpi-l">${durum.yil - 1} ort. aylık gelir</div><div class="kpi-v">${para2(t.ortalama)}</div><div class="kpi-s">firmaların aylık ortalamaları toplamı</div></div></section>
      <section class="card kpi"><span class="kpi-ic">${icon('trend', 22)}</span><div><div class="kpi-l">${durum.yil} beklenen aylık gelir</div><div class="kpi-v">${para2(t.beklenen)}</div><div class="kpi-s">${t.belirsiz} satırın bedeli henüz belli değil</div></div></section>
      <section class="card kpi"><span class="kpi-ic">${icon('bars', 22)}</span><div><div class="kpi-l">Önceki yıla göre artış</div><div class="kpi-v">${yuzdeMetni(t.artisOrani)}</div><div class="kpi-s">bedeli belli olan ${t.karsilastirilan} satır üzerinden</div></div></section></div>`;
  };
  const karHtml = () => {
    const k = karDurumu(gelirToplam(), giderHesap());
    const eksi = (x) => (x < 0 ? 'butce-eksi' : 'butce-arti');
    return html`<div class="table-wrap"><table class="table butce-kar"><thead><tr><th scope="col"></th><th scope="col" class="num">${durum.yil - 1} (ortalama)</th><th scope="col" class="num">${durum.yil} (beklenen)</th></tr></thead><tbody>
      <tr><th scope="row">Aylık gelir</th><td class="num">${para2(k.oncekiGelir)}</td><td class="num">${para2(k.aylikGelir)}</td></tr>
      <tr><th scope="row">Aylık gider</th><td class="num">${para2(k.oncekiGider)}</td><td class="num">${para2(k.aylikGider)}</td></tr>
      <tr class="butce-kar-satir"><th scope="row">KÂR DURUMU (aylık)</th><td class="num ${eksi(k.oncekiKar)}">${para2(k.oncekiKar)}</td><td class="num ${eksi(k.aylikKar)}">${para2(k.aylikKar)}</td></tr>
      <tr><th scope="row">Yıllık kâr (aylık × 12)</th><td class="num ${eksi(k.oncekiKar)}">${para2(k.oncekiKar * 12)}</td><td class="num ${eksi(k.aylikKar)}">${para2(k.yillikKar)}</td></tr>
      <tr><th scope="row">Kâr marjı</th><td class="num">${yuzdeMetni(k.oncekiGelir > 0 ? k.oncekiKar / k.oncekiGelir : null)}</td><td class="num">${yuzdeMetni(k.marj)}</td></tr></tbody></table></div>
      <p class="muted fine butce-not-alt">Kâr durumu = ${durum.yil} beklenen aylık gelir toplamı − ${durum.yil} aylık gider toplamı.</p>`;
  };

  const ciz = (veriVar) => {
    const liste = gelirListesi();
    const ara = durum.ara.trim().toLocaleLowerCase('tr');
    const gosterilen = liste.filter((r) => !ara || r.ad.toLocaleLowerCase('tr').includes(ara));
    const hs = giderHesap();
    const uyari = veriVar ? '' : html`<div class="alert alert-warning">Yıllık bütçe tabloları bulunamadı. Lütfen <code>34_asama33.sql</code> ve <code>35_asama34.sql</code> dosyalarını Supabase'de çalıştırın.</div>`;
    const gelir = liste.length ? html`<div class="butce-kap"><table class="table butce-tablo"><thead><tr>
        <th scope="col">Firma</th><th scope="col">${durum.yil - 1} fiyat türü</th><th scope="col">${durum.yil - 1} fiyatı (TL)<small class="block muted">sabit aylık / kişi başı</small></th><th scope="col">Çalışan</th><th scope="col" class="num">Aylık hizmet fiyatı</th>
        <th scope="col">${durum.yil - 1} aylık ort. gelir</th><th scope="col">Talep edilen artış %</th><th scope="col">${durum.yil} fiyat türü</th><th scope="col">Talep edilen fiyat</th><th scope="col">Kabul edilen bedel</th><th scope="col" class="num">Gerçekleşen artış</th>
        <th scope="col">${durum.yil} beklenen aylık gelir</th><th scope="col">Durum</th><th scope="col">Açıklama</th></tr></thead>
        <tbody>${gosterilen.map(satirHtml)}</tbody><tfoot id="butce-gelir-toplam">${gelirTfoot()}</tfoot></table></div>`
      : emptyState({ simge: 'building', baslik: 'Listelenecek firma yok', metin: 'Müşteri durumundaki firmalar burada listelenir.' });
    const gider = giderler.length ? html`<div class="butce-kap butce-kap-dar"><table class="table butce-tablo butce-gider"><thead><tr><th scope="col">Gider kalemi</th><th scope="col">${durum.yil - 1} aylık ort. gider</th><th scope="col">% artış</th><th scope="col">${durum.yil} aylık ort. gider</th></tr></thead>
        <tbody>${giderSirali().map((g) => giderSatirHtml(g, hs))}</tbody><tfoot id="butce-gider-toplam">${giderTfoot()}</tfoot></table></div>`
      : emptyState({ simge: 'wallet', baslik: 'Gider kalemi yok', metin: yaz ? 'Gider kalemi ekleyin.' : 'Henüz gider kalemi girilmemiş.' });
    kok.querySelector('#butce-govde').innerHTML = html`${uyari}<div id="butce-ozet">${ozetHtml()}</div>
      <section class="card card-flush"><div class="card-head"><h2 class="card-title">Gelirler Tablosu</h2>${yaz ? html`<button type="button" class="btn btn-secondary btn-sm" data-action="gelir-ekle">${icon('plus', 16)} Gelir satırı ekle</button>` : ''}</div>${gelir}</section>
      <section class="card card-flush"><div class="card-head"><h2 class="card-title">Giderler Tablosu</h2>${yaz ? html`<button type="button" class="btn btn-secondary btn-sm" data-action="gider-ekle">${icon('plus', 16)} Gider kalemi ekle</button>` : ''}</div>${gider}</section>
      <section class="card card-flush"><div class="card-head"><h2 class="card-title">Kâr Durumu</h2></div><div id="butce-kar">${karHtml()}</div></section>`.s;
  };

  // ---- hesaplanan hücreleri ve toplamları yerinde güncelle (odak kaybolmasın)
  const girdiyiYenile = (tr, sorgu, deger) => { const el = tr.querySelector(sorgu); if (el && !el.dataset.kirli) el.value = deger; };
  const toplamlariGuncelle = () => {
    const q = (s) => kok.querySelector(s);
    if (q('#butce-gelir-toplam')) q('#butce-gelir-toplam').innerHTML = gelirTfoot().s;
    if (q('#butce-gider-toplam')) q('#butce-gider-toplam').innerHTML = giderTfoot().s;
    q('#butce-ozet').innerHTML = ozetHtml().s; q('#butce-kar').innerHTML = karHtml().s;
  };
  const satiriGuncelle = (tr) => {
    const r = gelirListesi().find((x) => x.anahtar === tr.dataset.anahtar); const s = satirlar.get(r.anahtar) ?? {}; const h = hesap(r);
    const yerles = (c, v) => { const el = tr.querySelector(`[data-c="${c}"]`); if (el) el.innerHTML = v.s ?? v; };
    yerles('oncekiAylik', para2(h.oncekiAylik));
    yerles('artis', artisHtml(h));
    yerles('kabulAylik', h.yeniTur === 'kisi_basi' && h.kabulAylik !== null ? `= ${para2(h.kabulAylik)} / ay` : '');
    yerles('beklenenAlt', beklenenAlt(h));
    yerles('ortKaynak', html`${kaynakMetni(h, r)}${h.elle && yaz && r.firma ? html` · <button type="button" class="link-btn" data-oto-sifirla>otomatik yap</button>` : ''}`);
    const ad = tr.querySelector('.butce-ad'); ad.classList.remove('yesil', 'kirmizi', 'turuncu'); if (renk(r)) ad.classList.add(renk(r));
    for (const alan of GELIR_ALANLARI) girdiyiYenile(tr, `[data-alan="${alan}"]`, alan === 'expected_manual' ? girdiDegeri(h.beklenen) : girdiDegeri(s[alan]));
    const nt = tr.querySelector('[data-alan="next_price_type"]'); if (nt) nt.value = s.next_price_type ?? '';
    toplamlariGuncelle();
  };
  const giderleriGuncelle = () => {
    const hs = giderHesap();
    for (const tr of kok.querySelectorAll('tr[data-gider]')) {
      const g = giderler.find((x) => x.id === tr.dataset.gider); if (!g) continue; const v = hs.satirlar.get(g.id) ?? giderSatiri(g);
      girdiyiYenile(tr, '[data-galan="prev_avg_expense"]', girdiDegeri(v.prev)); girdiyiYenile(tr, '[data-galan="increase_pct"]', girdiDegeri(v.pct)); girdiyiYenile(tr, '[data-galan="next_avg_expense"]', girdiDegeri(v.next));
    }
    toplamlariGuncelle();
  };

  // aynı satıra art arda yapılan değişiklikler sırayla kaydedilir (yeni satırın çift oluşmasını ve eski veriyle hesaplamayı önler)
  const kuyruklar = new Map();
  const sirala = (anahtar, is) => { const yeni = (kuyruklar.get(anahtar) ?? Promise.resolve()).catch(() => {}).then(is); kuyruklar.set(anahtar, yeni); return yeni; };

  const kaydet = async (anahtar, degerler) => {
    const mevcut = satirlar.get(anahtar);
    const kayit = mevcut ? await app.api.updateBudgetLine(mevcut.id, degerler) : await app.api.createBudgetLine({ budget_year: durum.yil, company_id: anahtar, ...degerler });
    satirlar.set(anahtar, kayit); return kayit;
  };

  const degistir = (el) => {
    delete el.dataset.kirli; const tr = el.closest('tr[data-anahtar]'); if (!tr) return Promise.resolve();
    const anahtar = tr.dataset.anahtar; const ham = el.value;
    return sirala(anahtar, () => degistirIs(el, tr, anahtar, ham));
  };
  const degistirIs = async (el, tr, anahtar, ham) => {
    const alan = el.dataset.alan; const s = satirlar.get(anahtar) ?? { price_type: 'sabit' };
    const bos = ham.trim() === ''; const d = {};
    if (alan === 'price_type') {
      d.price_type = ham;
      if (ham === 'kisi_basi' && !sayiMi(s.employee_count) && !anahtar.startsWith('c:') && calisanSayisi(anahtar) != null) d.employee_count = calisanSayisi(anahtar);
    } else if (alan === 'next_price_type') {
      d.next_price_type = ham || null;
      if (ham === 'kisi_basi' && !sayiMi(s.employee_count) && !anahtar.startsWith('c:') && calisanSayisi(anahtar) != null) d.employee_count = calisanSayisi(anahtar);
    }
    else if (alan === 'status') d.status = ham || null;
    else if (alan === 'note') d.note = bos ? null : ham.trim();
    else {
      const v = bos ? null : sayiOku(ham, alan === 'increase_pct');
      if (!bos && v === null) { toast('Geçerli bir sayı girin.', 'hata'); el.value = girdiDegeri(alan === 'expected_manual' ? hesap(gelirListesi().find((x) => x.anahtar === anahtar)).beklenen : s[alan]); return; }
      d[alan] = alan === 'employee_count' && v !== null ? Math.round(v) : v;
    }
    // talep edilen artış yüzdesi ile fiyatı birbirine bağla (aylık tutar üzerinden; fiyat türleri farklı olabilir)
    const yeni = { ...s, ...d };
    if (alan === 'increase_price') d.increase_pct = talepYuzdesi(yeni, yeni.increase_price);
    else if (['unit_price', 'employee_count', 'price_type', 'next_price_type', 'increase_pct'].includes(alan) && sayiMi(yeni.increase_pct)) d.increase_price = talepFiyati(yeni, yeni.increase_pct);
    try { await kaydet(anahtar, d); satiriGuncelle(tr); } catch (e) { toast(humanError(e), 'hata'); }
  };

  const giderDegistir = (el) => {
    delete el.dataset.kirli; const tr = el.closest('tr[data-gider]'); if (!tr) return Promise.resolve();
    const id = tr.dataset.gider; const ham = el.value;
    return sirala(`g:${id}`, () => giderDegistirIs(el, id, ham));
  };
  const giderDegistirIs = async (el, id, ham) => {
    const g = giderler.find((x) => x.id === id); const alan = el.dataset.galan; const bos = ham.trim() === '';
    const v = bos ? null : sayiOku(ham, alan === 'increase_pct');
    if (!bos && v === null) { toast('Geçerli bir sayı girin.', 'hata'); const c = giderSatiri(g); el.value = girdiDegeri({ prev_avg_expense: c.prev, increase_pct: c.pct, next_avg_expense: c.next }[alan]); return; }
    const c = giderSatiri(g); const d = {};
    if (alan === 'prev_avg_expense') { d.prev_avg_expense = v; if (c.pct !== null && v !== null) d.next_avg_expense = Math.round(v * (1 + c.pct / 100) * 100) / 100; }
    else if (alan === 'increase_pct') { d.increase_pct = v; d.next_avg_expense = v !== null && c.prev !== null ? Math.round(c.prev * (1 + v / 100) * 100) / 100 : null; }
    else { d.next_avg_expense = v; d.increase_pct = v !== null && c.prev > 0 ? Math.round((v / c.prev - 1) * 10000) / 100 : null; }
    try { const kayit = await app.api.updateBudgetExpense(g.id, d); giderler = giderler.map((x) => (x.id === g.id ? kayit : x)); giderleriGuncelle(); } catch (e) { toast(humanError(e), 'hata'); }
  };

  const adFormu = (baslik, altBaslik, onSubmit) => openFormModal({
    baslik, altBaslik, boyut: 'md', gonderEtiketi: 'Ekle',
    govde: html`${field({ ad: 'ad', etiket: 'Ad', zorunlu: true, maksUzunluk: 200, tam: true })}`,
    async onSubmit(fd) { const ad = String(fd.get('ad') ?? '').trim(); if (!ad) return { errors: { ad: 'Adı yazın.' } }; await onSubmit(ad); },
    onDone: () => ciz(true),
  });
  const gelirEkle = () => adFormu('Gelir satırı ekle', 'Firma dışında bir gelir kalemi (ör. eğitim geliri). Önceki yıl aylık ortalama gelirini elle girersiniz.', async (ad) => {
    const kayit = await app.api.createBudgetLine({ budget_year: durum.yil, custom_name: ad, price_type: 'sabit' }); satirlar.set(anahtarOf(kayit), kayit);
  });
  const giderEkle = () => adFormu('Gider kalemi ekle', 'Giderler tablosuna yeni bir kalem eklenir.', async (ad) => {
    const son = Math.max(0, ...giderler.filter((g) => !g.parent_id).map((g) => g.sort_order));
    giderler = [...giderler, await app.api.createBudgetExpense({ budget_year: durum.yil, name: ad, sort_order: son + 10 })];
  });
  const personelEkle = (ustId) => adFormu('Personel ekle', 'Personel Giderleri kaleminin altına adı soyadı elle girilen personel eklenir.', async (ad) => {
    giderler = [...giderler, await app.api.createBudgetExpense({ budget_year: durum.yil, name: ad, parent_id: ustId, sort_order: 0 })];
  });
  const sil = async (baslik, mesaj, islem) => {
    if (!(await confirmDialog({ baslik, onayEtiketi: 'Sil', tehlikeli: true, mesaj }))) return;
    try { await islem(); ciz(true); } catch (e) { toast(humanError(e), 'hata'); }
  };

  const sozlesmedenDoldur = async () => {
    const yil = durum.yil - 1; const adaylar = [];
    for (const r of gelirListesi().filter((x) => x.firma)) {
      const s = satirlar.get(r.anahtar); if (sayiMi(s?.unit_price)) continue;
      const cs = sozlesmeler.filter((c) => c.company_id === r.firma.id && !c.archived_at).sort((a, b) => String(b.end_date).localeCompare(String(a.end_date)));
      for (const c of cs) {
        const ps = fiyatlar.filter((p) => p.contract_id === c.id);
        const p = guncelFiyat(ps, `${yil}-12-31`) ?? guncelFiyat(ps, bugunStr) ?? ps[0];
        if (p) { adaylar.push({ r, p }); break; }
      }
    }
    if (!adaylar.length) { toast('Doldurulacak sözleşme fiyatı bulunamadı.'); return; }
    if (!(await confirmDialog({ baslik: 'Sözleşme fiyatlarından doldur', onayEtiketi: 'Doldur', mesaj: `${adaylar.length} firmanın boş olan önceki yıl fiyatı, sözleşmedeki fiyattan (KDV hariç) doldurulacak. Mevcut girişlere dokunulmaz.` }))) return;
    try {
      for (const { r, p } of adaylar) await kaydet(r.anahtar, { price_type: p.pricing === 'kisi_basi' ? 'kisi_basi' : 'sabit', unit_price: fiyatAylikHaric(p, 1), employee_count: p.pricing === 'kisi_basi' ? calisanSayisi(r.firma.id) : null });
      toast(`${adaylar.length} firma dolduruldu.`);
    } catch (e) { toast(humanError(e), 'hata'); }
    ciz(true);
  };

  const excelIndir = () => {
    const gelirler = gelirListesi().map((r) => {
      const s = satirlar.get(r.anahtar) ?? {}; const h = hesap(r);
      return { ad: r.ad, durum: s.status ?? null, tur: h.tur, birim: h.birim, adet: h.tur === 'kisi_basi' || h.yeniTur === 'kisi_basi' ? h.adet : 0, aylik: h.oncekiAylik, ortalama: h.ortalama, yuzde: sayiMi(s.increase_pct) ? Number(s.increase_pct) : null, yeniTur: h.yeniTur, talepFiyat: sayiMi(s.increase_price) ? Number(s.increase_price) : null, kabul: h.kabul, artisOrani: h.artisOrani, artisTutari: h.artisTutari, beklenen: h.beklenen, not: s.note ?? '' };
    });
    const hs = giderHesap();
    const giderListe = giderSirali().map((g) => {
      const v = hs.satirlar.get(g.id) ?? giderSiraliDeger(g);
      const next = v.next ?? v.prev ?? 0; const pct = v.pct ?? (v.prev > 0 ? Math.round((next / v.prev - 1) * 10000) / 100 : null);
      return { ad: g.name, cocuk: !!g.parent_id, toplamli: !!v.toplamli, prev: v.prev, pct, next };
    });
    const bayt = butceExcel({ yil: durum.yil, gelirler, giderler: giderListe, gelirToplam: gelirToplam(), tarih: bugunStr.split('-').reverse().join('.') });
    const ad = `yillik-butce-${durum.yil}.xlsx`;
    dosyaIndir(ad, bayt, XLSX_TURU); toast(`Excel indirildi: ${ad}`);
  };
  const giderSiraliDeger = (g) => giderSatiri(g);

  return {
    baslik: 'Yıllık Bütçe', altBaslik: 'Gelecek yıl gelir, gider ve kâr çalışması; değişiklikler otomatik kaydedilir, tutarlar KDV hariçtir',
    eylemler: html`${yaz && sozlesmeler.length ? html`<button type="button" class="btn btn-secondary" data-action="sozlesmeden-doldur">${icon('contract', 18)} Sözleşme fiyatlarından doldur</button> ` : ''}<button type="button" class="btn btn-primary" data-action="butce-excel">${icon('download', 18)} Excel'e aktar</button>`,
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
        if (!yaz) return;
        if (e.target.dataset.alan) degistir(e.target); else if (e.target.dataset.galan) giderDegistir(e.target);
      });
      k.addEventListener('input', (e) => { if (e.target.id === 'butce-ara') { durum.ara = e.target.value; ciz(true); } else if (e.target.dataset.alan || e.target.dataset.galan) e.target.dataset.kirli = '1'; });
      k.addEventListener('click', async (e) => {
        const t = e.target;
        if (t.closest('[data-action="sozlesmeden-doldur"]')) { await sozlesmedenDoldur(); return; }
        if (t.closest('[data-action="butce-excel"]')) { excelIndir(); return; }
        if (t.closest('[data-action="gelir-ekle"]')) { gelirEkle(); return; }
        if (t.closest('[data-action="gider-ekle"]')) { giderEkle(); return; }
        const pe = t.closest('[data-personel-ekle]'); if (pe) { personelEkle(pe.dataset.personelEkle); return; }
        const gs = t.closest('[data-gider-sil]');
        if (gs) { const g = giderler.find((x) => x.id === gs.dataset.giderSil); await sil('Gider satırını sil', `"${g.name}" satırı${g.is_personnel ? ' ve altındaki personel satırları' : ''} silinecek.`, async () => { await app.api.deleteBudgetExpense(g.id); giderler = giderler.filter((x) => x.id !== g.id && x.parent_id !== g.id); }); return; }
        const ls = t.closest('[data-gelir-sil]');
        if (ls) { const l = [...satirlar.values()].find((x) => x.id === ls.dataset.gelirSil); await sil('Gelir satırını sil', `"${l.custom_name}" satırı silinecek.`, async () => { await app.api.deleteBudgetLine(l.id); satirlar.delete(anahtarOf(l)); }); return; }
        const sf = t.closest('[data-oto-sifirla], [data-beklenen-sifirla]');
        if (sf && yaz) {
          const tr = sf.closest('tr'); const d = sf.hasAttribute('data-oto-sifirla') ? { prev_avg_income: null } : { expected_manual: null };
          try { await sirala(tr.dataset.anahtar, () => kaydet(tr.dataset.anahtar, d)); satiriGuncelle(tr); } catch (err) { toast(humanError(err), 'hata'); }
        }
      });
    },
  };
}
