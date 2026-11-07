// OSGB 360 - Aylık gider Excel'i yükleme: kalem eşleştirme, ay özeti, "önceki aktarımın yerine geçer" önizlemesi, tek işlemde aktarım.
// Mantık: lib/gider_aktar.js.
import { html, sayi, para2 } from '../lib/format.js';
import { icon } from '../ui/icons.js';
import { toast, confirmDialog } from '../ui/components.js';
import { xlsxOku, XLSX_BOYUT_SINIRI } from '../lib/xlsx.js';
import { giderSablonu } from '../lib/xlsxyaz.js';
import { giderTablosu, varsayilanKararlar, bekleyenSatirlar, giderPaketi, eklenecekOzet, yerineGecenler, ayEtiketi } from '../lib/gider_aktar.js';
import { humanError } from '../lib/api.js';

const XLSX_TUR = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const SATIR_SINIRI = 200;

export function giderAktarimKarti(app) {
  const izin = app.can('expenses', 'create') && app.can('expenses', 'archive') && app.can('import_export', 'create');
  const kategoriYarat = app.can('settings', 'create');
  const d = { dosyaAdi: '', tablo: null, kararlar: {}, kdvModu: 'kdv_haric', kdvOrani: 20, calisiyor: false, sonuc: null, hata: '', veri: null };

  const uygunKategoriler = () => d.veri.kategoriler.filter((k) => !k.is_management_pay && !k.archived_at).sort((a, b) => a.name.localeCompare(b.name, 'tr'));
  const bekleyen = () => bekleyenSatirlar(d.tablo.satirlar, d.kararlar);

  const kararSecimi = (s) => {
    const k = d.kararlar[s.anahtar]; const deger = k.islem === 'yonetim' ? 'yonetim' : k.islem === 'atla' ? 'atla' : k.kategori_id ? `k:${k.kategori_id}` : 'yeni';
    return html`<label class="select-inline"><span class="sr-only">${s.etiket} için kategori</span><select data-gkarar="${s.anahtar}">
      <optgroup label="Gider kategorisi">${uygunKategoriler().map((c) => html`<option value="k:${c.id}" ${deger === `k:${c.id}` ? html`selected` : ''}>${c.name}</option>`)}</optgroup>
      ${kategoriYarat ? html`<option value="yeni" ${deger === 'yeni' ? html`selected` : ''}>+ Yeni kategori oluştur</option>` : ''}
      <option value="yonetim" ${deger === 'yonetim' ? html`selected` : ''}>Yönetime ödenen (yönetim personeli maliyeti)</option>
      <option value="atla" ${deger === 'atla' ? html`selected` : ''}>Aktarma (bu satırı alma)</option></select></label>
      ${deger === 'yeni' ? html`<div class="field"><label class="sr-only" for="gy-${s.anahtar}">Yeni kategori adı</label><input id="gy-${s.anahtar}" data-gyeni-ad="${s.anahtar}" type="text" maxlength="120" value="${k.yeni?.ad ?? ''}" placeholder="Yeni kategori adı"></div>` : ''}`;
  };

  const eslesme = () => html`<h3 class="card-title pad-t">Kalem eşleştirme</h3>
    <p class="card-sub">Her satır bir gider kategorisine bağlanır; onayladığınız eşleşmeler hatırlanır. "Yönetime ödenen" yönetim olarak işaretli uzman/hekim maliyetidir; "Personel Giderleri" satırı gider olarak alınır; kârlılıkta tek personel maliyeti olarak kullanılır; personel kartındaki maliyetler yalnızca kişilere paylaştırma oranıdır.</p>
    <div class="table-wrap"><table class="table" id="gider-eslesme"><thead><tr><th scope="col">Dosyadaki kalem</th><th scope="col" class="num">Toplam (KDV hariç)</th><th scope="col">Kategori</th></tr></thead><tbody>
    ${d.tablo.satirlar.map((s) => html`<tr data-anahtar="${s.anahtar}" data-islem="${d.kararlar[s.anahtar].islem}"><td><strong>${s.etiket}</strong>${s.dolu ? '' : html`<small class="block muted">Tüm aylar boş — aktarılmaz</small>`}</td><td class="num">${para2(s.toplam)}</td><td>${kararSecimi(s)}</td></tr>`)}</tbody></table></div>`;

  const aySatiri = () => {
    const o = eklenecekOzet({ aylar: d.tablo.aylar, satirlar: d.tablo.satirlar, kararlar: d.kararlar });
    const y = yerineGecenler({ aylar: d.tablo.aylar, giderler: d.veri.giderler });
    return { o, y, tablo: html`<h3 class="card-title pad-t">Aylık özet</h3><div class="table-wrap"><table class="table" id="gider-aylar"><thead><tr><th scope="col">Ay</th><th scope="col" class="num">Gider</th><th scope="col" class="num">Yönetime ödenen</th><th scope="col" class="num">Yerine geçen önceki kayıt</th></tr></thead><tbody>
      ${d.tablo.aylar.map((a) => html`<tr data-ay="${a}"><td>${ayEtiketi(a)}</td><td class="num">${para2(o.ay[a].gider)}</td><td class="num">${para2(o.ay[a].yonetim)}</td><td class="num">${y.ay[a] ? `${sayi(y.ay[a].adet)} kayıt · ${para2(y.ay[a].tutar)}` : '—'}</td></tr>`)}</tbody></table></div>` };
  };

  const govde = () => {
    if (d.sonuc) {
      const s = d.sonuc;
      return html`<div class="notice notice-ok" role="status" id="gider-sonuc"><strong>${sayi(s.eklenen)}</strong> gider kaydı eklendi, önceki Excel aktarımlarından <strong>${sayi(s.arsivlenen)}</strong> kayıt arşivlendi${s.yeni_kategori ? html`, ${sayi(s.yeni_kategori)} yeni kategori oluşturuldu` : ''}${s.negatif_atlanan ? html`; ${sayi(s.negatif_atlanan)} negatif tutar aktarılmadı` : ''}.</div>
        <div class="modal-actions pad-t"><a class="btn btn-secondary" href="#/giderler">Giderlere git</a><button type="button" class="btn btn-primary" data-action="gider-yeni">Yeni yükleme</button></div>`;
    }
    if (!d.tablo) return '';
    const t = d.tablo; const bek = bekleyen(); const { o, y, tablo } = aySatiri();
    const paket = giderPaketi({ aylar: t.aylar, satirlar: t.satirlar, kararlar: d.kararlar });
    const kayit = Object.values(o.ay).reduce((x, a) => x + a.adet, 0);
    return html`${t.hatalar.length ? html`<div class="notice notice-warn" role="alert" id="gider-hatalar"><strong>Dosyada sorun var, aktarılamaz:</strong><ul>${t.hatalar.slice(0, 20).map((h) => html`<li>${h}</li>`)}</ul></div>` : ''}
      ${t.uyarilar.length ? html`<div class="notice" id="gider-uyarilar"><ul>${t.uyarilar.slice(0, 20).map((h) => html`<li>${h}</li>`)}</ul></div>` : ''}
      ${t.satirlar.length ? html`${eslesme()}${tablo}
      <div class="form-grid pad-t"><div class="field"><label for="gider-kdv">Dosyadaki tutarlar</label><select id="gider-kdv"><option value="kdv_haric" ${d.kdvModu === 'kdv_haric' ? html`selected` : ''}>KDV hariç</option><option value="kdv_dahil" ${d.kdvModu === 'kdv_dahil' ? html`selected` : ''}>KDV dahil</option></select></div>
        <div class="field"><label for="gider-oran">KDV oranı (%)</label><input id="gider-oran" type="number" min="0" max="100" step="0.01" value="${d.kdvOrani}"><p class="fine">Yalnızca "KDV dahil" seçilirse tutar KDV hariç ve KDV olarak ayrılır.</p></div></div>
      <div class="notice ${y.adet ? 'notice-warn' : ''}" id="gider-yerine" data-adet="${y.adet}">${y.adet ? html`Bu dosyadaki aylar için daha önce Excel'den aktarılmış <strong>${sayi(y.adet)}</strong> kayıt (${para2(y.tutar)}) bulundu; yeni dosya bunların yerine geçer, eskiler arşivlenir. Elle girilen giderlere dokunulmaz.` : 'Bu aylar için önceden aktarılmış Excel kaydı yok; elle girilen giderlere dokunulmaz.'}</div>
      ${bek.length ? html`<div class="notice notice-warn" role="alert" id="gider-bekleyen" data-adet="${bek.length}">${sayi(bek.length)} kalem için kategori seçilmedi: ${bek.map((b) => b.etiket).join(', ')}.</div>` : ''}
      <div class="modal-actions pad-t"><button type="button" class="btn btn-primary" id="gider-uygula" data-action="gider-uygula" ${t.hatalar.length || bek.length || d.calisiyor || !paket.satirlar.length ? html`disabled` : ''}>${icon('check', 16)} ${sayi(kayit)} gider kaydını aktar</button></div>` : ''}`;
  };

  const kart = () => html`<section class="card" id="gider-karti"><div class="card-head"><div><h2 class="card-title">Aylık gider Excel'i</h2>
    <p class="card-sub">Satırı gider kalemi, sütunu ay olan tabloyu yükleyin. Her yükleme, içindeki aylar için önceki Excel aktarımının yerine geçer. "Personel Giderleri" satırı da gider olarak alınır; personel kârlılığı için kişi bazlı maliyet ayrıca (sonraki aşamada) girilir.</p></div></div>
    ${izin ? html`<div class="toolbar"><button type="button" class="btn btn-secondary btn-sm" data-action="gider-sablon">${icon('upload', 16)} Boş şablonu indir (.xlsx)</button></div>
      <div class="pad">${d.sonuc ? '' : html`<div class="field"><label for="gider-dosya">Gider Excel dosyası (.xlsx, en çok 8 MB)</label><input id="gider-dosya" type="file" accept=".xlsx,${XLSX_TUR}"></div>
      <p class="form-error" id="gider-hata" role="alert" ${d.hata ? '' : html`hidden`}>${d.hata}</p>${d.dosyaAdi && !d.hata ? html`<p class="muted">${d.dosyaAdi}</p>` : ''}`}
      <div id="gider-govde">${govde()}</div></div>`
      : html`<p class="muted pad">Gider aktarımı için gider ekleme, arşivleme ve içe aktarma izni gerekir.</p>`}</section>`;

  return {
    govde: html`<div id="gider-kok">${kart()}</div>`,
    mount(kok) {
      const yenile = () => { const k = kok.querySelector('#gider-kok'); if (k) k.innerHTML = kart().s; };
      const yalnizGovde = () => { const g = kok.querySelector('#gider-govde'); if (g) g.innerHTML = govde().s; };
      const sifirla = () => { Object.assign(d, { dosyaAdi: '', tablo: null, kararlar: {}, sonuc: null, hata: '', calisiyor: false }); };

      async function dosyaSecildi(dosya) {
        sifirla();
        try {
          if (!dosya) { yenile(); return; }
          if (dosya.size > XLSX_BOYUT_SINIRI) throw new Error('Dosya 8 MB sınırını aşıyor.');
          const x = await xlsxOku(await dosya.arrayBuffer());
          const t = giderTablosu(x.satirlar);
          if (!t.satirlar.length) throw new Error(t.hatalar[0] ?? 'Dosyada gider satırı bulunamadı.');
          if (t.satirlar.length > SATIR_SINIRI) throw new Error(`Dosyada ${sayi(t.satirlar.length)} satır var; en fazla ${sayi(SATIR_SINIRI)} kalem aktarılabilir.`);
          const [kategoriler, harita, giderler] = await Promise.all([app.api.listExpenseCategories(), app.api.listExpenseRowMap(), app.api.listExpenses()]);
          d.veri = { kategoriler, harita, giderler };
          d.dosyaAdi = dosya.name; d.tablo = t; d.kararlar = varsayilanKararlar(t.satirlar, { kategoriler, harita });
        } catch (err) { d.hata = err instanceof Error && !err.code ? err.message : humanError(err); d.tablo = null; }
        yenile();
      }

      async function uygula() {
        if (d.calisiyor || !d.tablo || bekleyen().length || d.tablo.hatalar.length) return;
        const paket = giderPaketi({ dosya: d.dosyaAdi, aylar: d.tablo.aylar, satirlar: d.tablo.satirlar, kararlar: d.kararlar, kdvModu: d.kdvModu, kdvOrani: d.kdvOrani });
        const y = yerineGecenler({ aylar: d.tablo.aylar, giderler: d.veri.giderler });
        const kayit = Object.values(eklenecekOzet({ aylar: d.tablo.aylar, satirlar: d.tablo.satirlar, kararlar: d.kararlar }).ay).reduce((t, a) => t + a.adet, 0);
        if (!(await confirmDialog({ baslik: 'Gider aktarım onayı', onayEtiketi: `${sayi(kayit)} gideri ekle`, mesaj: `${sayi(kayit)} gider kaydı eklenecek. ${y.adet ? `Aynı aylardaki ${sayi(y.adet)} önceki Excel kaydı arşivlenecek. ` : ''}Elle girilen giderlere dokunulmaz. Hepsi tek işlemde yazılır; hata olursa hiçbir şey değişmez.` }))) return;
        d.calisiyor = true; yalnizGovde();
        try { d.sonuc = await app.api.applyExpenses(paket); toast(`${sayi(d.sonuc.eklenen)} gider kaydı eklendi.`); }
        catch (err) { d.hata = humanError(err); toast(d.hata, 'hata'); }
        d.calisiyor = false; yenile();
      }

      kok.addEventListener('change', (e) => {
        const t = e.target;
        if (t.id === 'gider-dosya') { dosyaSecildi(t.files?.[0]); return; }
        if (t.id === 'gider-kdv') { d.kdvModu = t.value === 'kdv_dahil' ? 'kdv_dahil' : 'kdv_haric'; return; }
        if (t.id === 'gider-oran') { const n = Number(t.value); d.kdvOrani = Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : 20; return; }
        if (t.dataset?.gyeniAd !== undefined) { const k = d.kararlar[t.dataset.gyeniAd]; if (k) k.yeni = { ...(k.yeni ?? { tur: 'isletme' }), ad: t.value }; yalnizGovde(); return; }
        const anahtar = t.dataset?.gkarar; if (anahtar === undefined) return;
        const s = d.tablo.satirlar.find((x) => x.anahtar === anahtar); const v = t.value;
        if (v.startsWith('k:')) d.kararlar[anahtar] = { islem: 'kategori', kategori_id: v.slice(2), yeni: null };
        else if (v === 'yeni') d.kararlar[anahtar] = { islem: 'kategori', kategori_id: null, yeni: { ad: s.etiket, tur: anahtar === 'vergi' ? 'vergi' : 'isletme' } };
        else if (v === 'yonetim') d.kararlar[anahtar] = { islem: 'yonetim', kategori_id: null, yeni: null };
        else d.kararlar[anahtar] = { islem: 'atla', kategori_id: null, yeni: null };
        yalnizGovde();
      });
      kok.addEventListener('click', (e) => {
        const a = e.target.closest('[data-action]')?.dataset.action;
        if (a === 'gider-sablon') {
          const url = URL.createObjectURL(new Blob([giderSablonu()], { type: XLSX_TUR }));
          const el = document.createElement('a'); el.href = url; el.download = 'gider-sablonu.xlsx'; el.rel = 'noopener';
          document.body.append(el); el.click(); el.remove(); setTimeout(() => URL.revokeObjectURL(url), 5000);
        } else if (a === 'gider-uygula') uygula();
        else if (a === 'gider-yeni') { sifirla(); yenile(); }
      });
    },
  };
}
