// OSGB 360 - İSG-Katip aktarımı: sözleşme listesi Excel'i -> işyeri (sicil) eşleştirme, çalışan sayısı, görevli uzman/hekim, değişiklik uyarıları.
// Mantık: lib/katip.js (saf, testli); Excel okuma: lib/xlsx.js (dosya tarayıcıdan çıkmaz).
import { html, bugun, ayBasi, ayAdi, tarih, tarihSaat, sayi } from '../lib/format.js';
import { icon } from '../ui/icons.js';
import { emptyState, pill, toast, confirmDialog } from '../ui/components.js';
import { xlsxOku, XLSX_BOYUT_SINIRI } from '../lib/xlsx.js';
import {
  katipSatirlari, isyerleriniGrupla, birimleriHazirla, firmaOzetleri, excelDisiFirmalar, degisiklikler, profilFarklari, uygulamaPaketi, TEHLIKE_ADI, adBenzerligi, ESIK,
} from '../lib/katip.js';
import { gorevlendirmeOnerisi, gorevlendirmePaketi } from '../lib/gorevlendirme.js';
import { profilleriGrupla, guncelProfil } from '../lib/veri.js';
import { humanError } from '../lib/api.js';
import { PERSONEL_TURU } from '../lib/operasyon.js';

let sonGorev = null; // görevlendirme aktarımı sonucu (sayfa yenilendikten sonra gösterilir)
let sonSonuc = null; // uygulamadan sonra sayfa yenilenir; sonuç özeti bir sonraki çizimde gösterilir
const tehlikeDokumu = (o) => Object.entries(o.isyerleri.reduce((m, i) => { m[i.tehlike] = (m[i.tehlike] ?? 0) + i.calisan; return m; }, {})).map(([t, n]) => `${TEHLIKE_ADI[t]} ${n}`).join(' + ');
const ONEM = { yuksek: ['Önemli', 'danger'], orta: ['Dikkat', 'warning'], bilgi: ['Bilgi', 'info'] };

export async function katipSayfasi(app) {
  const olusturabilir = app.can('import_export', 'create') && app.can('companies', 'create') && app.can('companies', 'edit');
  const [firmalar, siteler, profiller, yuklemeler, kisiler] = await Promise.all([
    app.api.listCompanies(),
    app.api.listSites().catch(() => null),            // null: 14_asama13_katip.sql çalıştırılmamış
    app.api.listAllProfiles(),
    app.api.listKatipImports().catch(() => null),
    app.can('contacts', 'view') ? app.api.listContacts().catch(() => []) : [],
  ]);
  if (siteler === null || yuklemeler === null) {
    return { baslik: 'İSG-Katip aktarımı', altBaslik: 'Sözleşme listesi Excel\'i', govde: html`<div class="notice notice-info" role="note">Bu sayfa için Supabase'de <strong>14_asama13_katip.sql</strong> dosyasını çalıştırın (Kurulum rehberi, "Aşama 13 kurulumu").</div>` };
  }
  const firmaAdi = new Map(firmalar.map((f) => [f.id, f.name]));
  const profilHaritasi = new Map([...profilleriGrupla(profiller)].map(([id, l]) => [id, guncelProfil(l, bugun())]).filter(([, p]) => p));
  let oncekiSatirlar = []; let oncekiHata = null;
  if (yuklemeler.length) { try { oncekiSatirlar = await app.api.listKatipRows(yuklemeler[0].id); } catch (e) { oncekiHata = humanError(e); } }

  const gorevYetki = app.can('assignments', 'create') && app.can('assignments', 'edit') && app.can('staff', 'create');
  const [calisanlar, atamalar, kurallar] = yuklemeler.length && !oncekiHata
    ? await Promise.all([app.api.listEmployees().catch(() => []), app.api.listAssignments().catch(() => []), app.api.listServiceRules().catch(() => [])]) : [[], [], []];
  const gorev = { oneri: null, secili: new Set(), gozden: false, calisiyor: false, hata: '', bitti: sonGorev };
  sonGorev = null;
  if (yuklemeler.length && !oncekiHata) {
    gorev.oneri = gorevlendirmeOnerisi({ satirlar: oncekiSatirlar, siteler, firmalar, profilHaritasi: profilleriGrupla(profiller), kurallar, calisanlar, atamalar, tarih: yuklemeler[0].period });
    for (const f of gorev.oneri.firmalar) if (f.turler.some((t) => !t.atla && (t.bitenler.length || t.satirlar.some((x) => x.islem !== 'degismedi')))) gorev.secili.add(f.firmaId);
  }

  const d = { donem: ayBasi(bugun()), dosyaAdi: '', okunan: null, isyerleri: [], birimler: [], uyarilar: [], degisiklik: [], pasif: new Set(), gozden: false, hata: '', calisiyor: false, bitti: sonSonuc, siteAra: '', sitePage: 1 };

  sonSonuc = null;
  // ------------------------------------------------------------ yardımcılar
  const ozetler = () => firmaOzetleri({ birimler: d.birimler, firmalar });
  const kararDegeri = (k) => (k.tip === 'esle' ? `esle:${k.firmaId}` : k.tip === 'birlestir' ? `birlestir:${k.hedef}` : k.tip);
  const kararSecenekleri = (b) => {
    const onerilen = new Set(b.adaylar.map((a) => a.firma.id));
    const digerBirimler = d.birimler.filter((x) => x.anahtar !== b.anahtar && adBenzerligi(x.unvan, b.unvan) >= ESIK.olasi);
    const diger = firmalar.filter((f) => !f.archived_at && !onerilen.has(f.id)).sort((a, z) => a.name.localeCompare(z.name, 'tr'));
    const sec = kararDegeri(b.karar);
    const opt = (v, ad) => html`<option value="${v}" ${v === sec ? html`selected` : ''}>${ad}</option>`;
    return html`${b.adaylar.length ? html`<optgroup label="Benzer firmalar">${b.adaylar.map((a) => opt(`esle:${a.firma.id}`, `${a.firma.name} (%${Math.round(a.skor * 100)})`))}</optgroup>` : ''}
      ${b.kayitliFirmaId && !onerilen.has(b.kayitliFirmaId) ? html`<optgroup label="Kayıtlı eşleşme">${opt(`esle:${b.kayitliFirmaId}`, firmaAdi.get(b.kayitliFirmaId))}</optgroup>` : ''}
      ${digerBirimler.length ? html`<optgroup label="Aynı dosyadaki benzer unvanla birleştir (çalışan sayıları toplanır)">${digerBirimler.map((x) => opt(`birlestir:${x.anahtar}`, x.unvan))}</optgroup>` : ''}
      <optgroup label="Diğer">${opt('yeni', 'Yeni firma oluştur')}${opt('yoksay', 'Bu işyerini aktarma')}</optgroup>
      <optgroup label="Tüm firmalar">${diger.map((f) => opt(`esle:${f.id}`, f.name))}</optgroup>`;
  };

  const birimSatiri = (b) => {
    const k = b.karar;
    return html`<tr data-birim="${b.anahtar}">
      <td><strong>${b.unvan}</strong><small class="block muted">${b.isyerleri.length} işyeri · ${sayi(b.calisan)} çalışan · ${[...new Set(b.isyerleri.map((i) => TEHLIKE_ADI[i.tehlike]))].join(', ')}</small>
        ${b.not ? html`<small class="block ${b.soru && !b.cevaplandi ? 'text-warn' : 'muted'}">${b.not}</small>` : ''}${b.cevaplandi ? html`<small class="block text-ok">✓ Seçiminiz kaydedildi</small>` : ''}</td>
      <td><label class="select-inline"><span class="sr-only">${b.unvan} için karar</span><select data-karar="${b.anahtar}">${kararSecenekleri(b)}</select></label>
        ${k.tip === 'yeni' ? html`<input class="mt-1" type="text" data-yeni-ad="${b.anahtar}" value="${k.ad ?? b.unvan}" maxlength="200" aria-label="Yeni firma adı">` : ''}</td></tr>`;
  };
  const birimTablosu = (liste, id) => html`<div class="table-wrap"><table class="table" id="${id}"><thead><tr><th scope="col">Excel'deki işyeri unvanı</th><th scope="col">Sistemde hangi firma?</th></tr></thead><tbody>${liste.map(birimSatiri)}</tbody></table></div>`;

  const degisiklikTablosu = () => html`<div class="table-wrap"><table class="table" id="katip-degisiklik"><thead><tr><th scope="col">Önem</th><th scope="col">İşyeri</th><th scope="col">Değişiklik</th></tr></thead><tbody>
    ${d.degisiklik.map((x) => html`<tr><td>${pill(...ONEM[x.onem])}</td><td><strong>${x.unvan}</strong><small class="block muted">${x.sicil}</small></td><td>${x.mesaj}</td></tr>`)}</tbody></table></div>`;

  const analizHtml = () => {
    if (!d.okunan) return '';
    const oz = ozetler(); const sorular = d.birimler.filter((b) => b.soru); const eslesen = d.birimler.filter((b) => !b.soru && b.karar.tip === 'esle'); const yeniler = d.birimler.filter((b) => !b.soru && b.karar.tip !== 'esle');
    const disi = excelDisiFirmalar({ firmalar, ozetler: oz }); const profilFark = profilFarklari({ ozetler: oz, profilHaritasi });
    const yoksayilan = d.birimler.filter((b) => b.karar.tip === 'yoksay').length;
    const yeniFirmaSayisi = oz.filter((o) => o.yeni).length;
    const yuksek = d.degisiklik.filter((x) => x.onem === 'yuksek').length;
    return html`
      <div class="stats" id="katip-ozet"><div class="stat"><span class="stat-l">Sözleşme satırı</span><strong class="stat-v">${sayi(d.okunan.kayitlar.length)}</strong><span class="stat-s">${d.okunan.atlanan ? `${d.okunan.atlanan} satır atlandı` : 'hepsi okundu'}</span></div>
        <div class="stat"><span class="stat-l">İşyeri (sicil)</span><strong class="stat-v">${sayi(d.isyerleri.length)}</strong><span class="stat-s">${sayi(d.birimler.length)} farklı unvan</span></div>
        <div class="stat"><span class="stat-l">Firma</span><strong class="stat-v">${sayi(oz.length)}</strong><span class="stat-s">${yeniFirmaSayisi} yeni oluşturulacak</span></div>
        <div class="stat"><span class="stat-l">Sorular</span><strong class="stat-v" id="katip-n-soru">${sayi(sorular.filter((b) => !b.cevaplandi).length)}</strong><span class="stat-s">${yoksayilan ? `${yoksayilan} unvan aktarılmayacak` : 'cevap bekleyen'}</span></div></div>
      ${d.okunan.uyarilar.length || d.uyarilar.length ? html`<div class="notice notice-warn" role="status" id="katip-uyarilar"><strong>Dosya uyarıları</strong><ul class="plain">${[...d.okunan.uyarilar, ...d.uyarilar].slice(0, 12).map((u) => html`<li>${u}</li>`)}</ul>${d.okunan.uyarilar.length + d.uyarilar.length > 12 ? html`<small>… ve ${d.okunan.uyarilar.length + d.uyarilar.length - 12} uyarı daha</small>` : ''}</div>` : ''}

      <h3 class="card-title pad-t">1. Önceki yüklemeye göre değişiklikler</h3>
      ${oncekiHata ? html`<div class="notice notice-warn" role="status">Önceki yükleme okunamadı, karşılaştırma yapılamadı: ${oncekiHata}</div>`
        : !oncekiSatirlar.length ? html`<p class="muted" id="katip-ilk">Bu ilk yükleme; karşılaştırılacak önceki yükleme yok.</p>`
        : !d.degisiklik.length ? html`<div class="notice notice-ok" role="status" id="katip-degisiklik-yok">Önceki yüklemeye (${ayAdi(yuklemeler[0].period)}) göre çalışan sayısı, tehlike sınıfı, görevli uzman/hekim veya firma kişisinde değişiklik yok.</div>`
        : html`<div class="notice ${yuksek ? 'notice-warn' : 'notice-info'}" role="status" id="katip-degisiklik-baslik"><strong>${d.degisiklik.length} değişiklik</strong>${yuksek ? `, ${yuksek} tanesi önemli (görevli, tehlike sınıfı veya ayrılan işyeri)` : ''}. Önceki yükleme: ${ayAdi(yuklemeler[0].period)}.</div>${degisiklikTablosu()}`}

      <h3 class="card-title pad-t">2. Eşleştirme soruları (${sayi(sorular.length)})</h3>
      ${sorular.length ? html`<p class="card-sub">Benzer unvanlar bulundu. Her biri için sistemdeki hangi firmaya bağlanacağını seçin; birleştirilen işyerlerinin çalışan sayıları toplanır. Seçiminiz kaydedilir, bir sonraki yüklemede aynı sicil için tekrar sorulmaz.</p>${birimTablosu(sorular, 'katip-sorular')}`
        : html`<p class="muted">Cevaplanacak soru yok.</p>`}

      <details class="pad-t" ${yeniler.length && !sorular.length ? html`open` : ''}><summary><strong>Excel'de var, sistemde yok — yeni firma olarak eklenecek (${sayi(yeniler.length)})</strong></summary>
        <p class="card-sub">Yanlış eşleşme olmasın diye yeni firmalar listelenir. Doğru değilse sistemdeki firmayı seçin ya da "aktarma" deyin.</p>${yeniler.length ? birimTablosu(yeniler, 'katip-yeniler') : html`<p class="muted">Yok.</p>`}</details>
      <details class="pad-t"><summary><strong>Otomatik eşleşenler (${sayi(eslesen.length)})</strong></summary>${eslesen.length ? birimTablosu(eslesen, 'katip-eslesenler') : html`<p class="muted">Yok.</p>`}</details>

      <h3 class="card-title pad-t">3. Sistemde olup Excel'de olmayan firmalar (${sayi(disi.length)})</h3>
      ${disi.length ? html`<p class="card-sub">Bu aktif müşteri firmaların bu dosyada işyeri yok; sözleşmeleri bitmiş (pasif) olabilir ya da başka bir firmanın altında görünüyor olabilir. Pasife (eski müşteri) almak istediklerinizi işaretleyin; hiçbir kayıt silinmez.</p>
        <div class="table-wrap"><table class="table" id="katip-disi"><thead><tr><th scope="col">Firma</th><th scope="col">Eski müşteri yap</th></tr></thead><tbody>
        ${disi.map((f) => html`<tr><td>${f.name}</td><td><label class="check-inline"><input type="checkbox" data-pasif="${f.id}" ${d.pasif.has(f.id) ? html`checked` : ''}> <span>Pasife al</span></label></td></tr>`)}</tbody></table></div>`
        : html`<p class="muted">Tüm aktif müşteri firmaların Excel'de karşılığı var.</p>`}

      <h3 class="card-title pad-t">4. Firma bazında sonuç</h3>
      <div class="table-wrap"><table class="table" id="katip-firmalar"><thead><tr><th scope="col">Firma</th><th scope="col" class="num">İşyeri</th><th scope="col" class="num">Çalışan (toplam)</th><th scope="col">Tehlike sınıfı</th><th scope="col" class="hide-sm">Firma kartında şimdi</th></tr></thead><tbody>
        ${oz.map((o) => { const p = o.firmaId ? profilHaritasi.get(o.firmaId) : null; const fark = p && (p.employee_count !== o.calisan || p.hazard_class !== o.enYuksek);
          return html`<tr><td><strong>${o.ad}</strong>${o.yeni ? html` ${pill('Yeni', 'success')}` : ''}${o.unvanlar.length > 1 ? html`<small class="block muted">${o.unvanlar.length} unvan birleşti</small>` : ''}</td><td class="num">${o.isyerleri.length}</td><td class="num">${sayi(o.calisan)}</td>
            <td>${o.tehlikeler.length > 1 ? html`${pill('Karma', 'warning')} <small class="muted">${tehlikeDokumu(o)}</small>` : TEHLIKE_ADI[o.enYuksek]}</td>
            <td class="hide-sm">${p ? html`${sayi(p.employee_count)} · ${TEHLIKE_ADI[p.hazard_class]} ${fark ? pill('Güncellenecek', 'warning') : ''}` : html`<span class="muted">—</span>`}</td></tr>`; })}</tbody></table></div>
      ${profilFark.length ? html`<p class="fine">${profilFark.length} firmanın kartındaki çalışan sayısı/tehlike sınıfı güncellenecek; eski değerler geçmiş olarak saklanır (ayın başından itibaren yeni değer geçerli olur).</p>` : ''}

      <div class="pad-t"><label class="check-inline"><input type="checkbox" id="katip-gozden" ${d.gozden ? html`checked` : ''}> <span>Eşleştirmeleri, değişiklik uyarılarını ve pasife alınacak firmaları gözden geçirdim.</span></label></div>
      <div class="modal-actions pad-t"><button type="button" class="btn btn-primary" data-action="katip-uygula" ${!d.gozden || d.calisiyor || !olusturabilir ? html`disabled` : ''}>${icon('check', 16)} ${d.calisiyor ? 'Uygulanıyor…' : 'Aktarımı uygula'}</button></div>
      <p class="fine" id="katip-ilerleme" role="status" aria-live="polite"></p>`;
  };

  const sonucHtml = () => { const b = d.bitti;
    return html`<div class="notice notice-ok" role="status" id="katip-sonuc"><strong>Aktarım tamamlandı.</strong> ${b.yeni_firma} yeni firma, ${b.yeni_isyeri} yeni işyeri, ${b.guncellenen_isyeri} işyeri güncellendi${b.kapanan_isyeri ? `, ${b.kapanan_isyeri} işyeri bu dosyada olmadığı için pasife alındı` : ''}; ${b.firma_karti_guncellenen} firma kartı güncellendi, ${b.yeni_kisi} firma kişisi eklendi${b.pasife_alinan ? `, ${b.pasife_alinan} firma eski müşteri yapıldı` : ''}.</div>
      <div class="modal-actions pad-t"><button type="button" class="btn btn-primary" data-action="katip-yeni">Yeni yükleme</button></div>`; };

  const yuklemeKarti = () => {
    if (!olusturabilir) return html`<section class="card"><h2 class="card-title">Yeni yükleme</h2>${emptyState({ simge: 'lock', baslik: 'Aktarım izniniz yok', metin: 'İçe aktarma ve firma ekleme/düzenleme izinleri gerekir.' })}</section>`;
    return html`<section class="card" id="katip-kart"><div class="card-head"><div><h2 class="card-title">Yeni yükleme</h2>
      <p class="card-sub">İSG-Katip'ten aldığınız "İSG Hizmet Sözleşme Süreçleri" Excel dosyasını (.xlsx) doğrudan seçin. Dosya tarayıcınızda okunur; önizleme ve onayınız olmadan hiçbir kayıt yazılmaz.</p></div></div>
      <div class="pad"><div id="katip-govde">${d.bitti ? sonucHtml() : html`<div class="form-grid"><div class="field"><label for="katip-donem">Dönem (ay)</label><input id="katip-donem" type="month" value="${d.donem.slice(0, 7)}"><p class="fine">Çalışan sayıları ve tehlike sınıfı bu ayın başından itibaren firma kartında geçerli olur.</p></div>
        <div class="field"><label for="katip-dosya">Excel dosyası (.xlsx, en çok 8 MB)</label><input id="katip-dosya" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"></div></div>
        <p class="form-error" id="katip-hata" role="alert" ${d.hata ? '' : html`hidden`}>${d.hata}</p>
        <div id="katip-analiz">${analizHtml()}</div>`}</div></div></section>`;
  };


  // ------------------------------------------------------------ Aşama 14: görevlendirme önizlemesi
  const payMetni = (x) => `%${String(x).replace('.', ',')}`;
  const ISLEM = { ekle: ['Yeni görevlendirme', 'success'], degistir: ['Pay değişiyor', 'warning'], degismedi: ['Değişmiyor', 'neutral'] };
  const gorevIcerik = () => {
    const o = gorev.oneri; const sy = o.sayim; const yy = yuklemeler[0];
    if (gorev.bitti) {
      const b = gorev.bitti;
      return html`<div class="notice notice-ok" role="status" id="gorev-sonuc"><strong>Görevlendirmeler güncellendi.</strong> ${b.eklenen} yeni görevlendirme, ${b.degisen} pay değişikliği, ${b.biten} görevlendirme bitirildi; ${b.yeni_personel} yeni personel eklendi, ${b.sertifika_baglanan} personele sertifika numarası bağlandı.</div>`;
    }
    if (!o.firmalar.length) return html`<p class="muted" id="gorev-bos">Bu yüklemeden görevlendirme önerisi çıkmadı (eşleşmiş firma ve görevli kaydı yok).</p>`;
    const firmaSatiri = (f) => html`<div class="gorev-firma" data-gfirma-kart="${f.firmaId}">
      <label class="check-inline"><input type="checkbox" data-gfirma="${f.firmaId}" ${gorev.secili.has(f.firmaId) ? html`checked` : ''}> <strong>${f.ad}</strong></label>
      ${f.turler.map((t) => html`<div class="gorev-tur"><small class="block muted">${PERSONEL_TURU[t.tur]}${t.ihtiyac ? ` · aylık ihtiyaç ${sayi(t.ihtiyac)} dk` : ''}</small>
        ${t.atla && !t.uyarilar.length ? html`<small class="block muted">Katip'te bu türde görevli yok; mevcut kayıtlara dokunulmaz.</small>` : ''}
        ${t.satirlar.length ? html`<ul class="plain">${t.satirlar.map((x) => html`<li>${x.kisi.ad} ${x.kisi.yeni ? pill('Yeni personel', 'info') : ''} — ${sayi(x.dakika)} dk → ${x.eskiPay !== null ? `${payMetni(x.eskiPay)} → ` : ''}<strong>${payMetni(x.pay)}</strong> ${pill(...ISLEM[x.islem])}</li>`)}</ul>` : ''}
        ${t.bitenler.length ? html`<ul class="plain">${t.bitenler.map((b) => html`<li>${b.ad} (${payMetni(b.pay)}) — ${pill('Görevlendirme biter', 'danger')}</li>`)}</ul>` : ''}
        ${t.uyarilar.map((u) => html`<small class="block text-warn">⚠ ${u}</small>`)}</div>`)}</div>`;
    return html`<p class="fine" id="gorev-ozet">${ayAdi(yy.period)} yüklemesine göre: <strong>${sy.eklenecek}</strong> yeni görevlendirme, <strong>${sy.degisecek}</strong> pay değişikliği, <strong>${sy.bitecek}</strong> görevlendirme bitecek, ${sy.degismeyen} değişmeyecek${o.yeniKisiler.length ? `; ${o.yeniKisiler.length} yeni personel kaydı açılacak` : ''}. Geçerlilik tarihi: ${tarih(o.tarih)}.</p>
      ${o.atlanan.length ? html`<p class="fine muted">${o.atlanan.length} "diğer sağlık personeli" satırı görevlendirmeye aktarılmaz (yalnızca uzman ve hekim yönetilir).</p>` : ''}
      ${o.uyarilar.map((u) => html`<p class="fine text-warn">⚠ ${u}</p>`)}
      <div id="gorev-liste">${o.firmalar.map(firmaSatiri)}</div>
      ${gorev.hata ? html`<p class="form-error" role="alert" id="gorev-hata">${gorev.hata}</p>` : ''}
      <div class="pad-t"><label class="check-inline"><input type="checkbox" id="gorev-gozden" ${gorev.gozden ? html`checked` : ''}> <span>Önerilen görevlendirmeleri ve uyarıları gözden geçirdim.</span></label></div>
      <div class="modal-actions pad-t"><button type="button" class="btn btn-primary" data-action="gorev-uygula" ${!gorev.gozden || gorev.calisiyor || !gorev.secili.size || !gorevYetki ? html`disabled` : ''}>${icon('check', 16)} ${gorev.calisiyor ? 'Uygulanıyor…' : `Seçili ${gorev.secili.size} firmanın görevlendirmesini uygula`}</button></div>
      ${!gorevYetki ? html`<p class="fine muted">Uygulamak için görevlendirme ve personel ekleme/düzenleme izinleri gerekir.</p>` : ''}`;
  };
  const gorevKarti = () => {
    if (!yuklemeler.length) return '';
    if (oncekiHata) return html`<section class="card pad-t-card" id="gorev-kart"><div class="card-head"><div><h2 class="card-title">Görevlendirmeleri güncelle</h2></div></div><div class="pad"><p class="muted">Son yükleme satırları okunamadı: ${oncekiHata}</p></div></section>`;
    return html`<section class="card pad-t-card" id="gorev-kart"><div class="card-head"><div><h2 class="card-title">Görevlendirmeleri güncelle</h2>
      <p class="card-sub">Son yüklemedeki görevli uzman ve hekimler personele bağlanır, firmalardaki hizmet payları (Katip süresi ÷ firmanın teorik ihtiyacı) önerilir. Siz onaylamadan hiçbir görevlendirme yazılmaz; geçmiş kayıtlar korunur.</p></div></div>
      <div class="pad" id="gorev-kok">${gorevIcerik()}</div></section>`;
  };

  // ------------------------------------------------------------ işyerleri (sicil) yönetimi
  const SAYFA = 20;
  const siteKarti = () => {
    const q = d.siteAra.trim().toLocaleLowerCase('tr');
    const liste = siteler.filter((s) => !q || `${s.site_name} ${s.sgk_no} ${firmaAdi.get(s.company_id) ?? ''}`.toLocaleLowerCase('tr').includes(q))
      .sort((a, b) => String(firmaAdi.get(a.company_id)).localeCompare(String(firmaAdi.get(b.company_id)), 'tr') || a.site_name.localeCompare(b.site_name, 'tr'));
    const sayfaSayisi = Math.max(1, Math.ceil(liste.length / SAYFA)); d.sitePage = Math.min(d.sitePage, sayfaSayisi);
    const duzenleyebilir = app.can('companies', 'edit');
    const secenekler = (secili) => firmalar.filter((f) => !f.archived_at || f.id === secili).sort((a, b) => a.name.localeCompare(b.name, 'tr')).map((f) => html`<option value="${f.id}" ${f.id === secili ? html`selected` : ''}>${f.name}</option>`);
    return html`<div class="toolbar"><div class="search-field">${icon('search', 18)}<input type="search" id="site-ara" placeholder="Unvan, sicil no veya firma ara" aria-label="İşyeri ara" value="${d.siteAra}" autocomplete="off"></div></div>
      ${siteler.length ? html`<div class="table-wrap"><table class="table" id="site-tablo"><thead><tr><th scope="col">İşyeri (Katip unvanı)</th><th scope="col">Fatura edilen firma</th><th scope="col" class="num">Çalışan</th><th scope="col" class="hide-sm">Tehlike</th><th scope="col">Durum</th></tr></thead><tbody>
        ${liste.slice((d.sitePage - 1) * SAYFA, d.sitePage * SAYFA).map((s) => html`<tr data-site="${s.id}"><td><strong>${s.site_name}</strong><small class="block muted">Sicil: ${s.sgk_no}${s.city ? ` · ${s.city}` : ''}</small></td>
          <td>${duzenleyebilir ? html`<label class="select-inline"><span class="sr-only">${s.site_name} için fatura firması</span><select data-site-firma="${s.id}">${secenekler(s.company_id)}</select></label>` : firmaAdi.get(s.company_id)}</td>
          <td class="num">${s.employee_count ?? '—'}</td><td class="hide-sm">${s.hazard_class ? TEHLIKE_ADI[s.hazard_class] : '—'}</td><td>${s.is_active ? pill('Aktif', 'success') : pill('Dosyada yok', 'neutral')}</td></tr>`)}</tbody></table></div>
        <div class="pager" id="site-sayfa"><button type="button" class="btn btn-secondary btn-sm" data-site-sayfa="-1" ${d.sitePage <= 1 ? html`disabled` : ''}>Önceki</button><span>${d.sitePage} / ${sayfaSayisi} · ${liste.length} işyeri</span><button type="button" class="btn btn-secondary btn-sm" data-site-sayfa="1" ${d.sitePage >= sayfaSayisi ? html`disabled` : ''}>Sonraki</button></div>`
        : emptyState({ simge: 'building', baslik: 'Henüz işyeri yok', metin: 'İlk Excel yüklemesinden sonra işyerleri (sicil numaraları) burada listelenir; hangi firmaya faturalandığını buradan değiştirebilirsiniz.' })}`;
  };

  const gecmisKarti = () => html`<section class="card"><div class="card-head"><div><h2 class="card-title">Önceki yüklemeler</h2></div></div>
    ${yuklemeler.length ? html`<div class="table-wrap"><table class="table" id="katip-gecmis"><thead><tr><th scope="col">Dönem</th><th scope="col">Dosya</th><th scope="col" class="num">İşyeri</th><th scope="col" class="num">Satır</th><th scope="col" class="num">Değişiklik</th><th scope="col" class="hide-sm">Yüklenme</th></tr></thead><tbody>
      ${yuklemeler.map((y) => html`<tr><td>${ayAdi(y.period)}</td><td>${y.file_name ?? '—'}</td><td class="num">${y.site_count}</td><td class="num">${y.row_count}</td><td class="num">${y.summary?.degisiklik_sayisi ?? '—'}${y.summary?.onemli ? html` <small class="muted">(${y.summary.onemli} önemli)</small>` : ''}</td><td class="hide-sm">${tarihSaat(y.created_at)}</td></tr>`)}</tbody></table></div>`
      : emptyState({ simge: 'history', baslik: 'Henüz yükleme yok' })}</section>`;

  return {
    baslik: 'İSG-Katip aktarımı', altBaslik: 'Sözleşme listesinden işyeri, çalışan sayısı ve görevli bilgilerini aktarın',
    govde: html`<div id="katip-kok">${yuklemeKarti()}${gorevKarti()}
      <section class="card pad-t-card"><div class="card-head"><div><h2 class="card-title">İşyerleri ve sicil numaraları</h2>
        <p class="card-sub">Bir firmanın birden çok işyeri olabilir; faturayı kesen firma Katip'teki unvandan farklıysa buradan değiştirin. Değişiklik bir sonraki yüklemede de korunur.</p></div></div><div id="site-kok">${siteKarti()}</div></section>
      ${gecmisKarti()}</div>`,
    mount(kok) {
      const analizYenile = () => { const k = kok.querySelector('#katip-analiz'); if (k) k.innerHTML = analizHtml().s; };
      const govdeYenile = () => { kok.querySelector('#katip-kart').outerHTML = yuklemeKarti().s; };
      const gorevYenile = () => { const k = kok.querySelector('#gorev-kok'); if (k) k.innerHTML = gorevIcerik().s; };
      async function gorevUygula() {
        if (gorev.calisiyor || !gorev.gozden) return;
        const paket = gorevlendirmePaketi(gorev.oneri, gorev.secili, yuklemeler[0].id);
        const onay = await confirmDialog({ baslik: 'Görevlendirmeleri uygula', mesaj: `${gorev.secili.size} firma için ${paket.islemler.length} görevlendirme işlemi yapılacak${paket.kisiler.length ? `, ${paket.kisiler.length} yeni personel kaydı açılacak` : ''}. Eski görevlendirmeler silinmez; tarihçede kalır. Devam edilsin mi?`, onayEtiketi: 'Uygula' });
        if (!onay) return;
        gorev.calisiyor = true; gorev.hata = ''; gorevYenile();
        try {
          sonGorev = await app.api.applyGorevlendirme(paket);
          toast('Görevlendirmeler güncellendi.');
          app.yenile();
        } catch (err) {
          gorev.calisiyor = false; gorev.hata = `Uygulanamadı: ${humanError(err)} Hiçbir kayıt değişmedi.${/katip_gorevlendir|certificate_no/.test(String(err?.message ?? '')) ? ' (Supabase\'de 15_asama14.sql dosyasını çalıştırdınız mı?)' : ''}`; gorevYenile();
        }
      }
      const siteYenile = () => { kok.querySelector('#site-kok').innerHTML = siteKarti().s; };

      async function dosyaSecildi(dosya) {
        Object.assign(d, { hata: '', okunan: null, isyerleri: [], birimler: [], uyarilar: [], degisiklik: [], pasif: new Set(), gozden: false });
        try {
          if (!dosya) { analizYenile(); return; }
          if (dosya.size > XLSX_BOYUT_SINIRI) throw new Error('Dosya 8 MB sınırını aşıyor.');
          if (!/\.xlsx$/i.test(dosya.name)) throw new Error('Yalnızca .xlsx dosyası seçin. Eski .xls dosyasını Excel\'de .xlsx olarak kaydedin.');
          const tablo = await xlsxOku(await dosya.arrayBuffer());
          const okunan = katipSatirlari(tablo.satirlar);
          if (okunan.hata) throw new Error(okunan.hata);
          const g = isyerleriniGrupla(okunan.kayitlar);
          d.dosyaAdi = dosya.name; d.okunan = okunan; d.isyerleri = g.isyerleri; d.uyarilar = g.uyarilar;
          d.birimler = birimleriHazirla({ isyerleri: g.isyerleri, firmalar, siteler });
          d.degisiklik = degisiklikler({ isyerleri: g.isyerleri, onceki: oncekiSatirlar });
        } catch (err) { d.hata = err instanceof Error && !err.code ? err.message : humanError(err); d.okunan = null; }
        const h = kok.querySelector('#katip-hata'); if (h) { h.textContent = d.hata; h.hidden = !d.hata; }
        analizYenile();
      }

      async function uygula() {
        if (d.calisiyor || !d.gozden) return;
        const oz = ozetler(); const disi = excelDisiFirmalar({ firmalar, ozetler: oz });
        const pasif = disi.filter((f) => d.pasif.has(f.id)).map((f) => f.id);
        const onay = await confirmDialog({ baslik: 'Aktarımı uygula', mesaj: `${oz.length} firma, ${d.isyerleri.length} işyeri aktarılacak; ${oz.filter((o) => o.yeni).length} yeni firma oluşturulacak${pasif.length ? `, ${pasif.length} firma eski müşteri yapılacak` : ''}. Firma kartlarındaki çalışan sayıları güncellenecek (eski değerler geçmişte kalır). Devam edilsin mi?`, onayEtiketi: 'Uygula' });
        if (!onay) return;
        d.calisiyor = true; analizYenile();
        try {
          const paket = uygulamaPaketi({ donem: ayBasi(`${d.donem.slice(0, 7)}-01`), dosyaAdi: d.dosyaAdi, birimler: d.birimler, firmalar, pasif, mevcutKisiler: kisiler,
            ozet: { degisiklik_sayisi: d.degisiklik.length, onemli: d.degisiklik.filter((x) => x.onem === 'yuksek').length, degisiklikler: d.degisiklik.slice(0, 150).map((x) => ({ tur: x.tur, onem: x.onem, sicil: x.sicil, unvan: x.unvan, mesaj: x.mesaj })), uyari_sayisi: d.okunan.uyarilar.length + d.uyarilar.length } });
          sonSonuc = await app.api.applyKatip(paket);
          toast('İSG-Katip aktarımı tamamlandı.');
          app.aramaOnbellegiTemizle?.(); app.yenile();   // taze veriyle yeniden çiz; sonuç özeti gösterilir
        } catch (err) {
          d.calisiyor = false; analizYenile();
          const m = kok.querySelector('#katip-ilerleme'); if (m) m.textContent = ''; toast(humanError(err), 'hata');
          const h = kok.querySelector('#katip-hata'); if (h) { h.textContent = `Aktarım yapılamadı: ${humanError(err)} Hiçbir kayıt değişmedi.`; h.hidden = false; }
        }
      }

      kok.addEventListener('change', async (e) => {
        const t = e.target;
        if (t.id === 'katip-dosya') { await dosyaSecildi(t.files?.[0]); return; }
        if (t.id === 'katip-donem') { if (/^\d{4}-\d{2}$/.test(t.value)) d.donem = `${t.value}-01`; return; }
        if (t.id === 'gorev-gozden') { gorev.gozden = t.checked; gorevYenile(); return; }
        if (t.dataset.gfirma) { if (t.checked) gorev.secili.add(t.dataset.gfirma); else gorev.secili.delete(t.dataset.gfirma); gorev.gozden = false; gorevYenile(); return; }
        if (t.id === 'katip-gozden') { d.gozden = t.checked; const b = kok.querySelector('[data-action="katip-uygula"]'); if (b) b.disabled = !d.gozden || d.calisiyor || !olusturabilir; return; }
        if (t.dataset.pasif) { if (t.checked) d.pasif.add(t.dataset.pasif); else d.pasif.delete(t.dataset.pasif); return; }
        if (t.dataset.karar) {
          const b = d.birimler.find((x) => x.anahtar === t.dataset.karar); const v = t.value;
          if (v.startsWith('esle:')) b.karar = { tip: 'esle', firmaId: v.slice(5) };
          else if (v.startsWith('birlestir:')) b.karar = { tip: 'birlestir', hedef: v.slice(10) };
          else if (v === 'yeni') b.karar = { tip: 'yeni', ad: b.unvan };
          else b.karar = { tip: 'yoksay' };
          b.cevaplandi = true; d.gozden = false; analizYenile(); return;
        }
        if (t.dataset.yeniAd !== undefined) { const b = d.birimler.find((x) => x.anahtar === t.dataset.yeniAd); b.karar = { tip: 'yeni', ad: t.value.trim() || b.unvan }; return; }
        if (t.dataset.siteFirma) {
          const s = siteler.find((x) => x.id === t.dataset.siteFirma); const eski = s.company_id;
          try { const g = await app.api.updateSite(s.id, { company_id: t.value }); Object.assign(s, g); toast('İşyerinin fatura firması güncellendi.'); }
          catch (err) { t.value = eski; toast(humanError(err), 'hata'); }
        }
      });
      kok.addEventListener('input', (e) => { if (e.target.id === 'site-ara') { d.siteAra = e.target.value; d.sitePage = 1; siteYenile(); const i = kok.querySelector('#site-ara'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); } });
      kok.addEventListener('click', (e) => {
        if (e.target.closest('[data-action="katip-uygula"]')) { uygula(); return; }
        if (e.target.closest('[data-action="gorev-uygula"]')) { gorevUygula(); return; }
        if (e.target.closest('[data-action="katip-yeni"]')) { app.yenile(); return; }
        const sp = e.target.closest('[data-site-sayfa]'); if (sp && !sp.disabled) { d.sitePage += Number(sp.dataset.siteSayfa); siteYenile(); }
      });
    },
  };
}
