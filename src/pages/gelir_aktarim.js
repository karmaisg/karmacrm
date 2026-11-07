// OSGB 360 - Aylık gelir (fatura) Excel'i yükleme: önizleme, firma eşleştirme, unutulan fatura uyarısı, tek işlemde aktarım.
// Mantık: lib/gelir.js (ayrıştırma/eşleştirme/KDV), lib/xlsx.js (okuma), lib/xlsxyaz.js (boş şablon).
import { html, bugun, sayi, para2, tarih } from '../lib/format.js';
import { icon } from '../ui/icons.js';
import { pill, toast, confirmDialog } from '../ui/components.js';
import { xlsxOku, XLSX_BOYUT_SINIRI } from '../lib/xlsx.js';
import { gelirSablonu } from '../lib/xlsxyaz.js';
import {
  gelirSatirlari, kdvOzeti, eslestir, varsayilanKararlar, bekleyenler, gelirPaketi, unutulanFaturalar, donemEtiketi,
} from '../lib/gelir.js';
import { humanError } from '../lib/api.js';

const SATIR_SINIRI = 1000; const ONIZLEME = 150;
const DURUM = { kayitli: ['Kayıtlı eşleşme', 'success'], isyeri: ['İşyeri adı', 'success'], tam: ['Firma adı aynı', 'success'], guclu: ['Güçlü benzerlik — kontrol edin', 'info'], olasi: ['Olası eşleşme — onaylayın', 'warning'], yok: ['Firma bulunamadı', 'danger'] };
const oran = (n) => `%${String(n).replace('.', ',')}`;
const XLSX_TUR = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export function gelirAktarimKarti(app) {
  const izin = app.can('invoices', 'create') && app.can('import_export', 'create');
  const yeniFirmaIzni = app.can('companies', 'create');
  const d = { dosyaAdi: '', satirlar: [], hatalar: [], eslesmeler: [], kararlar: {}, vadeGun: 30, calisiyor: false, sonuc: null, hata: '', veri: null, sonucUnutulan: '' };

  const firmaSecenekleri = () => [...d.veri.firmalar].filter((f) => !f.archived_at).sort((a, b) => a.name.localeCompare(b.name, 'tr'));
  const bekleyen = () => bekleyenler(d.eslesmeler, d.kararlar);
  const mevcutNolar = () => new Set(d.veri.faturalar.filter((i) => !i.archived_at).map((i) => i.invoice_no));
  const unutulan = () => unutulanFaturalar({ satirlar: d.satirlar, eslesmeler: d.eslesmeler, kararlar: d.kararlar, firmalar: d.veri.firmalar, sozlesmeler: d.veri.sozlesmeler, faturalar: d.veri.faturalar });

  const kararSecimi = (e) => {
    const k = d.kararlar[e.anahtar] ?? { tur: null };
    const deger = k.tur === 'esle' ? `f:${k.firma_id}` : k.tur === 'yeni' ? 'yeni' : k.tur === 'yoksay' ? 'yoksay' : '';
    const aday = new Set(e.adaylar.map((a) => a.firma_id)); if (e.firma_id) aday.add(e.firma_id);
    const f = firmaSecenekleri();
    return html`<label class="select-inline"><span class="sr-only">${e.ad} için firma</span><select data-karar="${e.anahtar}">
      <option value="" ${deger === '' ? html`selected` : ''}>— Firma seçin —</option>
      ${e.adaylar.length ? html`<optgroup label="Önerilenler">${e.adaylar.map((a) => html`<option value="f:${a.firma_id}" ${deger === `f:${a.firma_id}` ? html`selected` : ''}>${a.ad} (benzerlik ${sayi(Math.round(a.skor * 100))}%)</option>`)}</optgroup>` : ''}
      <optgroup label="Tüm firmalar">${f.map((x) => html`<option value="f:${x.id}" ${deger === `f:${x.id}` ? html`selected` : ''}>${x.name}</option>`)}</optgroup>
      ${yeniFirmaIzni ? html`<option value="yeni" ${deger === 'yeni' ? html`selected` : ''}>+ Yeni firma oluştur</option>` : ''}
      <option value="yoksay" ${deger === 'yoksay' ? html`selected` : ''}>Bu satırları aktarma</option></select></label>
      ${k.tur === 'yeni' ? html`<div class="field"><label class="sr-only" for="yn-${e.anahtar}">Yeni firma adı</label><input id="yn-${e.anahtar}" data-yeni-ad="${e.anahtar}" type="text" maxlength="200" value="${k.yeniAd ?? ''}" placeholder="Yeni firma adı"></div>` : ''}`;
  };

  const ozetKartlari = () => {
    const o = kdvOzeti(d.satirlar.filter((s) => !s.tekrar));
    return html`<div class="stats" id="gelir-ozet">
      <div class="stat"><span class="stat-l">Fatura satırı</span><strong class="stat-v" id="gelir-n">${sayi(d.satirlar.length)}</strong><span class="stat-s">${sayi(d.hatalar.length)} satır okunamadı</span></div>
      <div class="stat"><span class="stat-l">KDV hariç</span><strong class="stat-v">${para2(o.haric)}</strong><span class="stat-s">toplam matrah</span></div>
      <div class="stat"><span class="stat-l">KDV</span><strong class="stat-v">${para2(o.kdv)}</strong><span class="stat-s">${Object.keys(o.oranlar).sort((a, b) => b - a).map((r) => `${oran(r)}: ${para2(o.oranlar[r].kdv)}`).join(' · ') || '—'}</span></div>
      <div class="stat"><span class="stat-l">Ortalama KDV</span><strong class="stat-v" id="gelir-ort">${oran(o.ortOran)}</strong><span class="stat-s">KDV / matrah; toplam ${para2(o.toplam)}</span></div></div>`;
  };

  const eslesmeTablosu = () => html`<h3 class="card-title pad-t">Firma eşleştirme</h3>
    <p class="card-sub">Faturanın açıklamasındaki ad, firma / işyeri adlarıyla ve daha önce onayladığınız eşleşmelerle karşılaştırıldı. Onayladığınız eşleşmeler hatırlanır; bir sonraki yüklemede sorulmaz.</p>
    <div class="table-wrap"><table class="table" id="gelir-eslesme"><thead><tr><th scope="col">Faturadaki ad</th><th scope="col" class="num">Satır</th><th scope="col">Durum</th><th scope="col">Firma</th></tr></thead><tbody>
    ${d.eslesmeler.map((e) => html`<tr data-durum="${e.durum}" data-anahtar="${e.anahtar}"><td><strong>${e.ad}</strong></td><td class="num">${sayi(e.satirlar.length)}</td>
      <td>${pill(DURUM[e.durum][0], DURUM[e.durum][1])}</td><td>${kararSecimi(e)}</td></tr>`)}</tbody></table></div>`;

  const onizleme = () => {
    const nolar = mevcutNolar(); const eH = new Map(d.eslesmeler.map((e) => [e.anahtar, e]));
    const firmaAdi = new Map(d.veri.firmalar.map((f) => [f.id, f.name]));
    return html`<h3 class="card-title pad-t">Fatura önizleme</h3><div class="table-wrap"><table class="table" id="gelir-onizleme"><thead><tr><th scope="col">Fatura no</th><th scope="col">Tarih</th><th scope="col">Firma</th>
      <th scope="col">Dönem</th><th scope="col" class="num">KDV hariç</th><th scope="col" class="num">KDV</th><th scope="col" class="num">Ort. KDV</th><th scope="col">Not</th></tr></thead><tbody>
      ${d.satirlar.slice(0, ONIZLEME).map((s) => {
        const k = d.kararlar[s.anahtar]; const e = eH.get(s.anahtar);
        const firma = k?.tur === 'esle' ? firmaAdi.get(k.firma_id) : k?.tur === 'yeni' ? `${k.yeniAd || '(yeni firma)'} — yeni` : k?.tur === 'yoksay' ? 'Aktarılmayacak' : '— seçilmedi —';
        const notlar = [...s.uyarilar]; const var_ = s.no && nolar.has(s.no);
        return html`<tr data-no="${s.no ?? ''}" data-var="${var_ ? '1' : '0'}"><td>${s.no ?? 'otomatik'}</td><td>${tarih(s.tarih)}</td><td>${firma}${e?.site_id && k?.site_id ? html`<small class="block muted">işyeri eşleşti</small>` : ''}</td>
          <td>${donemEtiketi(s.donem)}</td><td class="num">${para2(s.haric)}</td><td class="num">${para2(s.kdv)}${s.kalemler.length > 1 ? html`<small class="block muted">${s.kalemler.map((x) => `${oran(x.oran)}: ${para2(x.kdv)}`).join(' · ')}</small>` : ''}</td>
          <td class="num">${oran(s.ortOran)}</td><td>${var_ ? pill('Zaten kayıtlı — atlanır', 'warning') : ''}${s.tekrar ? pill('Dosyada tekrar — atlanır', 'warning') : ''}${notlar.map((n) => html`<small class="block">${n}</small>`)}</td></tr>`;
      })}</tbody></table></div>
      ${d.satirlar.length > ONIZLEME ? html`<p class="fine pad">Önizlemede ilk ${sayi(ONIZLEME)} satır gösteriliyor; ${sayi(d.satirlar.length)} satırın tamamı aktarılır.</p>` : ''}`;
  };

  const unutulanKutusu = () => {
    const u = unutulan();
    if (!d.satirlar.length) return '';
    if (!u.donemler.length) return html`<div class="notice" id="gelir-unutulan" data-adet="0">Dosyada baskın bir hizmet dönemi bulunamadığı için "faturası kesilmemiş firma" kontrolü yapılmadı.</div>`;
    if (!u.firmalar.length) return html`<div class="notice notice-ok" id="gelir-unutulan" data-adet="0">${u.donemler.map(donemEtiketi).join(', ')} dönemi için aktif sözleşmesi olan her firmaya fatura görünüyor.</div>`;
    return html`<div class="notice notice-warn" id="gelir-unutulan" role="alert" data-adet="${u.firmalar.length}"><strong>${sayi(u.firmalar.length)} aktif firmaya bu dosyada ve sistemde fatura görünmüyor.</strong> Fatura kesmeyi unutmuş olabilirsiniz:
      <ul class="list">${u.firmalar.map((f) => html`<li><span>${f.ad}</span><span class="muted">${donemEtiketi(f.donem)}</span></li>`)}</ul></div>`;
  };

  const sonucKutusu = () => {
    const s = d.sonuc;
    return html`<div class="notice ${s.atlanan.length ? 'notice-warn' : 'notice-ok'}" role="status" id="gelir-sonuc"><strong>${sayi(s.eklenen)}</strong> fatura eklendi${s.yeni_firma ? html`, <strong>${sayi(s.yeni_firma)}</strong> yeni firma oluşturuldu` : ''}${s.atlanan.length ? html`, ${sayi(s.atlanan.length)} fatura zaten kayıtlı olduğu için atlandı (${s.atlanan.map((a) => a.no).join(', ')})` : ''}.</div>
      ${d.sonucUnutulan}
      <div class="modal-actions pad-t"><a class="btn btn-secondary" href="#/tahsilat">Fatura Takip'e git</a><button type="button" class="btn btn-primary" data-action="gelir-yeni">Yeni yükleme</button></div>`;
  };

  const govde = () => {
    if (d.sonuc) return sonucKutusu();
    const bek = bekleyen();
    const aktarilacak = gelirPaketi({ satirlar: d.satirlar, eslesmeler: d.eslesmeler, kararlar: d.kararlar }).faturalar.filter((f) => !(f.no && mevcutNolar().has(f.no))).length;
    return html`${d.hatalar.length ? html`<div class="notice notice-warn" role="alert" id="gelir-hatalar"><strong>${sayi(d.hatalar.length)} satır okunamadı (aktarılmaz):</strong><ul>${d.hatalar.slice(0, 20).map((h) => html`<li>${h}</li>`)}</ul></div>` : ''}
      ${d.satirlar.length ? html`${ozetKartlari()}${unutulanKutusu()}${eslesmeTablosu()}${onizleme()}
        <div class="form-grid pad-t"><div class="field"><label for="gelir-vade">Vade (fatura tarihinden sonra gün)</label><input id="gelir-vade" type="number" min="0" max="365" step="1" value="${d.vadeGun}"><p class="fine">Excel'de vade yoktur; tahsilat takibi için fatura tarihine bu kadar gün eklenir.</p></div></div>
        ${bek.length ? html`<div class="notice notice-warn" role="alert" id="gelir-bekleyen" data-adet="${bek.length}">${sayi(bek.length)} ad için firma seçilmedi: ${bek.map((b) => b.ad).join(', ')}. Firma seçin, yeni firma oluşturun veya satırları aktarmayın.</div>` : ''}
        <div class="modal-actions pad-t"><button type="button" class="btn btn-primary" id="gelir-uygula" data-action="gelir-uygula" ${bek.length || d.calisiyor || !aktarilacak ? html`disabled` : ''}>${icon('check', 16)} ${sayi(aktarilacak)} faturayı aktar</button></div>` : ''}`;
  };

  const kart = () => html`<section class="card" id="gelir-karti"><div class="card-head"><div><h2 class="card-title">Aylık gelir (fatura) Excel'i</h2>
    <p class="card-sub">Ay sonu fatura listesini yükleyin. Firma, faturanın açıklamasındaki addan bulunur; %20 ve %10 KDV ayrı kalemler olarak işlenir ve ortalama KDV gösterilir. Spot iş ve elden ödemeler için Fatura Takip sayfasındaki "Gelir ekle" kullanılır.</p></div></div>
    ${izin ? html`<div class="toolbar"><button type="button" class="btn btn-secondary btn-sm" data-action="gelir-sablon">${icon('upload', 16)} Boş şablonu indir (.xlsx)</button></div>
      <div class="pad">${d.sonuc ? '' : html`<div class="field"><label for="gelir-dosya">Gelir Excel dosyası (.xlsx, en çok 8 MB)</label><input id="gelir-dosya" type="file" accept=".xlsx,${XLSX_TUR}"></div>
      <p class="form-error" id="gelir-hata" role="alert" ${d.hata ? '' : html`hidden`}>${d.hata}</p>${d.dosyaAdi && !d.hata ? html`<p class="muted">${d.dosyaAdi}</p>` : ''}`}
      <div id="gelir-govde">${govde()}</div></div>`
      : html`<p class="muted pad">Gelir aktarımı için fatura ekleme ve içe aktarma izni gerekir.</p>`}</section>`;

  return {
    govde: html`<div id="gelir-kok">${kart()}</div>`,
    mount(kok) {
      const yenile = () => { const k = kok.querySelector('#gelir-kok'); if (k) k.innerHTML = kart().s; };
      const yalnizGovde = () => { const g = kok.querySelector('#gelir-govde'); if (g) g.innerHTML = govde().s; };
      const sifirla = () => { Object.assign(d, { dosyaAdi: '', satirlar: [], hatalar: [], eslesmeler: [], kararlar: {}, sonuc: null, hata: '', calisiyor: false, sonucUnutulan: '' }); };

      async function dosyaSecildi(dosya) {
        sifirla();
        try {
          if (!dosya) { yenile(); return; }
          if (dosya.size > XLSX_BOYUT_SINIRI) throw new Error('Dosya 8 MB sınırını aşıyor.');
          const tablo = await xlsxOku(await dosya.arrayBuffer());
          const r = gelirSatirlari(tablo.satirlar);
          if (!r.satirlar.length) throw new Error(r.hatalar[0] ?? 'Dosyada aktarılacak fatura satırı bulunamadı.');
          if (r.satirlar.length > SATIR_SINIRI) throw new Error(`Dosyada ${sayi(r.satirlar.length)} satır var; en fazla ${sayi(SATIR_SINIRI)} satır aktarılabilir.`);
          const [firmalar, siteler, aliaslar, sozlesmeler, faturalar] = await Promise.all([
            app.api.listCompanies(), app.api.listSites(), app.api.listInvoiceAliases(), app.api.listContracts(), app.api.listInvoices()]);
          d.veri = { firmalar, siteler, aliaslar, sozlesmeler, faturalar };
          d.dosyaAdi = dosya.name; d.satirlar = r.satirlar; d.hatalar = r.hatalar;
          d.eslesmeler = eslestir(r.satirlar, { firmalar, siteler, aliaslar });
          d.kararlar = varsayilanKararlar(d.eslesmeler);
        } catch (err) { d.hata = err instanceof Error && !err.code ? err.message : humanError(err); d.satirlar = []; }
        yenile();
      }

      async function uygula() {
        if (d.calisiyor || bekleyen().length) return;
        const paket = gelirPaketi({ satirlar: d.satirlar, eslesmeler: d.eslesmeler, kararlar: d.kararlar, dosyaAdi: d.dosyaAdi, vadeGun: d.vadeGun });
        const adet = paket.faturalar.filter((f) => !(f.no && mevcutNolar().has(f.no))).length;
        if (!(await confirmDialog({ baslik: 'Gelir aktarım onayı', onayEtiketi: `${sayi(adet)} faturayı ekle`, mesaj: `${sayi(adet)} fatura eklenecek${paket.yeni_firmalar.length ? `, ${sayi(paket.yeni_firmalar.length)} yeni firma oluşturulacak` : ''}. Zaten kayıtlı numaralar atlanır. Hepsi tek işlemde yazılır; hata olursa hiçbiri eklenmez.` }))) return;
        d.calisiyor = true; yalnizGovde();
        try {
          const unut = unutulan();
          const s = await app.api.applyIncome(paket);
          d.sonuc = s;
          d.sonucUnutulan = unut.firmalar.length ? html`<div class="notice notice-warn" role="alert" id="gelir-sonuc-unutulan" data-adet="${unut.firmalar.length}"><strong>Fatura kesilmemiş görünen ${sayi(unut.firmalar.length)} aktif firma var:</strong> ${unut.firmalar.map((f) => f.ad).join(', ')}. Fatura unutulmuş olabilir.</div>` : '';
          toast(`${sayi(s.eklenen)} fatura eklendi.`);
        } catch (err) { d.hata = humanError(err); toast(d.hata, 'hata'); }
        d.calisiyor = false; yenile();
      }

      kok.addEventListener('change', (e) => {
        const t = e.target;
        if (t.id === 'gelir-dosya') { dosyaSecildi(t.files?.[0]); return; }
        if (t.id === 'gelir-vade') { const n = Math.round(Number(t.value)); d.vadeGun = Number.isFinite(n) ? Math.min(365, Math.max(0, n)) : 30; return; }
        if (t.dataset?.yeniAd !== undefined) { const k = d.kararlar[t.dataset.yeniAd]; if (k) k.yeniAd = t.value; yalnizGovde(); return; }
        const anahtar = t.dataset?.karar; if (anahtar === undefined) return;
        const e1 = d.eslesmeler.find((x) => x.anahtar === anahtar); const v = t.value;
        if (v.startsWith('f:')) { const fid = v.slice(2); const aday = e1.adaylar.find((a) => a.firma_id === fid); d.kararlar[anahtar] = { tur: 'esle', firma_id: fid, site_id: aday?.site_id ?? (e1.firma_id === fid ? e1.site_id : null) }; }
        else if (v === 'yeni') d.kararlar[anahtar] = { tur: 'yeni', yeniAd: e1.ad };
        else if (v === 'yoksay') d.kararlar[anahtar] = { tur: 'yoksay' };
        else d.kararlar[anahtar] = { tur: null };
        yalnizGovde();
      });
      kok.addEventListener('click', (e) => {
        const a = e.target.closest('[data-action]')?.dataset.action;
        if (a === 'gelir-sablon') {
          const url = URL.createObjectURL(new Blob([gelirSablonu()], { type: XLSX_TUR }));
          const el = document.createElement('a'); el.href = url; el.download = 'gelir-sablonu.xlsx'; el.rel = 'noopener';
          document.body.append(el); el.click(); el.remove(); setTimeout(() => URL.revokeObjectURL(url), 5000);
        } else if (a === 'gelir-uygula') uygula();
        else if (a === 'gelir-yeni') { sifirla(); yenile(); }
      });
    },
  };
}
