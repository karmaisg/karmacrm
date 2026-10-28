// OSGB 360 - Veri içe/dışa aktarma: CSV dışa aktarma ve firma/kişi içe aktarma sihirbazı (eşleştirme, önizleme, mükerrer kontrolü).
// Mantık ve doğrulama: lib/aktarim.js; CSV okuma/yazma: lib/csv.js.
import { html, bugun, sayi } from '../lib/format.js';
import { icon } from '../ui/icons.js';
import { emptyState, pill, toast, confirmDialog } from '../ui/components.js';
import { csvAyristir, csvTablo, csvUret } from '../lib/csv.js';
import {
  VERI_KUMELERI, ICE_AKTARIM_TURLERI, SABLONLAR, otomatikEsle, firmaSatirlariniDogrula, kisiSatirlariniDogrula, dogrulamaOzeti, hataRaporu,
  IC_AKTARIM_SATIR_SINIRI, IC_AKTARIM_BOYUT_SINIRI,
} from '../lib/aktarim.js';
import { csvIndir, dosyaIndir, dosyaAdiParcasi } from '../ui/indir.js';
import { humanError } from '../lib/api.js';

const ONIZLEME_SATIRI = 100;
const ART_ARDA_HATA_SINIRI = 5;
const ZORUNLU_ESLEME = { firmalar: ['name'], kisiler: ['full_name'] };

/** Dışa aktarma kümesi için gereken veriyi taze okur. */
async function kumeVerisi(app, kume) {
  const v = { bugun: bugun() };
  const gerek = { firmalar: ['firmalar', 'profiller'], kisiler: ['firmalar', 'kisiler'], sozlesmeler: ['firmalar', 'sozlesmeler'], faturalar: ['firmalar', 'faturalar', 'tahsilatlar'], tahsilatlar: ['firmalar', 'faturalar', 'tahsilatlar'], giderler: ['firmalar', 'giderler', 'kategoriler'] }[kume.id];
  const yukle = {
    firmalar: () => app.api.listCompanies(), profiller: () => app.api.listAllProfiles(), kisiler: () => app.api.listContacts(), sozlesmeler: () => app.api.listContracts(),
    faturalar: () => app.api.listInvoices(), tahsilatlar: () => app.api.listPayments(), giderler: () => app.api.listExpenses(), kategoriler: () => app.api.listExpenseCategories(),
  };
  const sonuclar = await Promise.all(gerek.map((g) => yukle[g]()));
  gerek.forEach((g, i) => { v[g] = sonuclar[i]; });
  return v;
}

export async function aktarimSayfasi(app) {
  const disa = VERI_KUMELERI.filter((k) => app.can(k.modul, 'view'));
  const iceTurleri = Object.entries(ICE_AKTARIM_TURLERI).filter(([, t]) => app.can(t.modul, 'create'));
  const iceIzni = app.can('import_export', 'create') && iceTurleri.length > 0;

  // sihirbaz durumu
  const d = { tur: iceTurleri[0]?.[0] ?? 'firmalar', dosyaAdi: '', basliklar: [], kayitlar: [], esleme: [], sonuclar: [], baslangic: bugun(), calisiyor: false, bitti: null, hata: '' };
  let mevcut = { firmalar: [], kisiler: [] };

  const alanlar = () => ICE_AKTARIM_TURLERI[d.tur].alanlar;
  const dogrula = () => {
    if (!d.kayitlar.length) { d.sonuclar = []; return; }
    d.sonuclar = d.tur === 'firmalar'
      ? firmaSatirlariniDogrula({ kayitlar: d.kayitlar, esleme: d.esleme, mevcutFirmalar: mevcut.firmalar })
      : kisiSatirlariniDogrula({ kayitlar: d.kayitlar, esleme: d.esleme, mevcutFirmalar: mevcut.firmalar, mevcutKisiler: mevcut.kisiler });
  };
  const eksikEsleme = () => {
    const eksik = ZORUNLU_ESLEME[d.tur].filter((a) => !d.esleme.includes(a)).map((a) => alanlar().find((x) => x.alan === a).etiket);
    if (d.tur === 'kisiler' && !d.esleme.includes('company') && !d.esleme.includes('company_tax_no')) eksik.push('Firma (ad) veya Firma vergi no');
    return eksik;
  };

  // ------------------------------------------------------------ dışa aktarma
  const disaKarti = () => html`<section class="card"><div class="card-head"><div><h2 class="card-title">Dışa aktar (CSV)</h2>
    <p class="card-sub">Dosyalar Excel'de çift tıklayarak açılabilir (Türkçe karakterler ve noktalı virgül ayırıcıyla).</p></div></div>
    ${disa.length ? html`<ul class="list" id="disa-liste">${disa.map((k) => html`<li><span><strong>${k.ad}</strong><small class="block muted">${k.aciklama}</small></span>
      <button type="button" class="btn btn-secondary btn-sm" data-disa="${k.id}">${icon('upload', 16)} CSV indir</button></li>`)}</ul>`
      : emptyState({ simge: 'lock', baslik: 'Dışa aktarılabilir veri yok', metin: 'Firma, kişi, sözleşme, fatura veya gider görüntüleme izniniz bulunmuyor.' })}
    <p class="fine pad">Dosyalar kişisel veri (ad, telefon, e-posta) ve mali bilgi içerebilir. İndirdikten sonra güvenli yerde saklayın, gerekmedikçe paylaşmayın. Arşivdeki kayıtlar "Kayıt durumu" sütununda belirtilir.</p></section>`;

  // ------------------------------------------------------------ içe aktarma
  const durumPill = (s) => (s.durum === 'hazir' ? pill('Aktarılacak', 'success') : s.durum === 'mukerrer' ? pill('Mükerrer — atlanır', 'warning') : pill('Hatalı', 'danger'));
  const ozetKutulari = (o) => html`<div class="stats"><div class="stat"><span class="stat-l">Aktarılacak</span><strong class="stat-v" id="ice-n-hazir">${sayi(o.hazir)}</strong><span class="stat-s">hatasız yeni kayıt</span></div>
    <div class="stat"><span class="stat-l">Mükerrer</span><strong class="stat-v" id="ice-n-mukerrer">${sayi(o.mukerrer)}</strong><span class="stat-s">atlanacak</span></div>
    <div class="stat"><span class="stat-l">Hatalı</span><strong class="stat-v" id="ice-n-hata">${sayi(o.hata)}</strong><span class="stat-s">düzeltilmeden aktarılmaz</span></div></div>`;

  const eslemeTablosu = () => html`<h3 class="card-title pad-t">2. Sütunları eşleştirin</h3>
    <p class="card-sub">Başlıklar otomatik eşleştirildi; gerekirse değiştirin. "Aktarma" seçilen sütunlar yok sayılır.</p>
    <div class="table-wrap"><table class="table" id="ice-esleme"><thead><tr><th scope="col">Dosyadaki sütun</th><th scope="col" class="hide-sm">Örnek</th><th scope="col">Aktarılacağı alan</th></tr></thead><tbody>
    ${d.basliklar.map((b, i) => html`<tr><td><strong>${b || `(adsız ${i + 1})`}</strong></td><td class="hide-sm muted">${d.kayitlar[0]?.hucreler[i] ?? ''}</td>
      <td><label class="select-inline"><span class="sr-only">${b} sütununun alanı</span><select data-esle="${i}"><option value="">— Aktarma —</option>
      ${alanlar().map((a) => html`<option value="${a.alan}" ${d.esleme[i] === a.alan ? html`selected` : ''}>${a.etiket}${a.zorunlu ? ' *' : ''}</option>`)}</select></label></td></tr>`)}</tbody></table></div>`;

  const onizleme = () => {
    const eksik = eksikEsleme();
    if (eksik.length) return html`<div class="notice notice-warn" role="alert">Aktarmaya başlamak için şu alanları eşleştirin: <strong>${eksik.join(', ')}</strong>.</div>`;
    const o = dogrulamaOzeti(d.sonuclar);
    const gorunen = d.sonuclar.slice(0, ONIZLEME_SATIRI);
    return html`<h3 class="card-title pad-t">3. Önizleme</h3>${ozetKutulari(o)}
      <div class="table-wrap"><table class="table" id="ice-onizleme"><thead><tr><th scope="col" class="num">Satır</th><th scope="col">${d.tur === 'firmalar' ? 'Firma' : 'Kişi'}</th><th scope="col">Durum</th><th scope="col">Açıklama</th></tr></thead><tbody>
      ${gorunen.map((s) => {
        const ad = d.tur === 'firmalar' ? (s.firma?.name ?? '—') : (s.kisi?.full_name ?? '—');
        const not = s.durum === 'hata' ? s.hatalar.join(' ') : s.durum === 'mukerrer' ? s.nedenMukerrer : s.uyarilar.join(' ');
        return html`<tr data-durum="${s.durum}"><td class="num">${s.satirNo}</td><td>${ad}${d.tur === 'kisiler' && s.firmaAdi ? html`<small class="block muted">${s.firmaAdi}</small>` : ''}</td><td>${durumPill(s)}</td><td class="${s.durum === 'hazir' && s.uyarilar.length ? 'muted' : ''}">${not}</td></tr>`;
      })}</tbody></table></div>
      ${d.sonuclar.length > ONIZLEME_SATIRI ? html`<p class="fine pad">Önizlemede ilk ${sayi(ONIZLEME_SATIRI)} satır gösteriliyor; ${sayi(d.sonuclar.length)} satırın tamamı kontrol edildi. Hatalı ve mükerrer satırların tamamını CSV olarak indirebilirsiniz.</p>` : ''}
      ${d.tur === 'firmalar' && d.sonuclar.some((s) => s.profil) ? html`<div class="form-grid pad-t"><div class="field"><label for="ice-baslangic">Çalışan sayısı geçerlilik tarihi</label>
        <input id="ice-baslangic" type="date" value="${d.baslangic}" max="${bugun()}"><p class="fine">Dosyadaki çalışan sayısı ve tehlike sınıfı bu tarihten itibaren geçerli kaydedilir.</p></div></div>` : ''}
      <div class="modal-actions pad-t">
        ${o.hata + o.mukerrer > 0 ? html`<button type="button" class="btn btn-secondary" data-action="ice-hata-indir">${icon('upload', 16)} Aktarılamayanları indir (CSV)</button>` : ''}
        <button type="button" class="btn btn-primary" data-action="ice-aktar" ${o.hazir === 0 || d.calisiyor ? html`disabled` : ''}>${icon('check', 16)} ${sayi(o.hazir)} kaydı aktar</button></div>
      <p class="fine pad" id="ice-ilerleme" role="status" aria-live="polite"></p>`;
  };

  const sonucKarti = () => {
    const b = d.bitti;
    return html`<h3 class="card-title pad-t">Aktarım tamamlandı</h3><div class="notice ${b.hatali.length ? 'notice-warn' : 'notice-ok'}" role="status" id="ice-sonuc">
      <strong>${sayi(b.eklenen)}</strong> kayıt eklendi${b.hatali.length ? html`, <strong>${sayi(b.hatali.length)}</strong> kayıt eklenemedi` : ''}${b.atlanan ? html`, ${sayi(b.atlanan)} kayıt (mükerrer/hatalı) atlandı` : ''}${b.durduruldu ? html`. Art arda hata alındığı için aktarım durduruldu; kalan kayıtlar denenmedi.` : '.'}</div>
      ${b.hatali.length ? html`<div class="table-wrap"><table class="table" id="ice-sunucu-hata"><thead><tr><th scope="col" class="num">Satır</th><th scope="col">Kayıt</th><th scope="col">Hata</th></tr></thead><tbody>
        ${b.hatali.slice(0, ONIZLEME_SATIRI).map((h) => html`<tr><td class="num">${h.satirNo}</td><td>${h.ad}</td><td>${h.mesaj}</td></tr>`)}</tbody></table></div>` : ''}
      <div class="modal-actions pad-t">${b.hatali.length || b.atlanan ? html`<button type="button" class="btn btn-secondary" data-action="ice-hata-indir">${icon('upload', 16)} Aktarılamayanları indir (CSV)</button>` : ''}
        <button type="button" class="btn btn-primary" data-action="ice-yeni">Yeni aktarım</button></div>`;
  };

  const iceKarti = () => {
    if (!iceIzni) return html`<section class="card"><h2 class="card-title">İçe aktar (CSV)</h2>${emptyState({ simge: 'lock', baslik: 'İçe aktarma izniniz yok', metin: 'İçe aktarma için Veri içe/dışa aktarma modülünde "oluşturma" izni ve aktarılacak modülde (firma veya kişi) oluşturma izni gerekir. İşletme sahibi Kullanıcılar ve yetkiler sayfasından izin verebilir.' })}</section>`;
    return html`<section class="card"><div class="card-head"><div><h2 class="card-title">İçe aktar (CSV)</h2>
      <p class="card-sub">Önce önizleme gösterilir; hiçbir kayıt siz onaylamadan eklenmez. Excel dosyanızı "Farklı kaydet → CSV UTF-8 (virgülle ayrılmış)" ile CSV'ye çevirin.</p></div></div>
      <div class="toolbar"><label class="select-inline"><span class="sr-only">Ne aktarılacak</span><select id="ice-tur">${iceTurleri.map(([k, t]) => html`<option value="${k}" ${k === d.tur ? html`selected` : ''}>${t.ad}</option>`)}</select></label>
        <button type="button" class="btn btn-secondary btn-sm" data-action="ice-sablon">${icon('upload', 16)} Boş şablonu indir</button></div>
      <div class="pad"><div id="ice-govde">${d.bitti ? sonucKarti() : html`<h3 class="card-title">1. CSV dosyasını seçin</h3>
        <div class="field"><label for="ice-dosya">CSV dosyası (en çok ${sayi(IC_AKTARIM_SATIR_SINIRI)} satır, 2 MB)</label><input id="ice-dosya" type="file" accept=".csv,.txt,text/csv,text/plain"></div>
        <p class="form-error" id="ice-hata" role="alert" ${d.hata ? '' : html`hidden`}>${d.hata}</p>${d.kayitlar.length ? html`<p class="muted">${d.dosyaAdi}: ${sayi(d.kayitlar.length)} satır okundu.</p>${eslemeTablosu()}<div id="ice-onizleme-kutu">${onizleme()}</div>` : ''}`}</div></div></section>`;
  };

  return {
    baslik: 'Veri içe/dışa aktarma', altBaslik: 'CSV ile dışa aktarın; firma ve kişileri sütun eşleştirme, önizleme ve mükerrer kontrolüyle içe aktarın',
    govde: html`<div id="aktarim-kok">${disaKarti()}<div class="pad-t" id="ice-kok">${iceKarti()}</div></div>`,
    mount(kok) {
      const iceYenile = () => { kok.querySelector('#ice-kok').innerHTML = iceKarti().s; };
      const onizlemeYenile = () => { const k = kok.querySelector('#ice-onizleme-kutu'); if (k) k.innerHTML = onizleme().s; };
      const sifirla = () => { Object.assign(d, { dosyaAdi: '', basliklar: [], kayitlar: [], esleme: [], sonuclar: [], bitti: null, hata: '', calisiyor: false }); };

      async function mevcutYukle() {
        const [firmalar, kisiler] = await Promise.all([app.api.listCompanies(), d.tur === 'kisiler' ? app.api.listContacts() : []]);
        mevcut = { firmalar, kisiler };
      }

      async function dosyaSecildi(dosya) {
        d.hata = ''; d.kayitlar = []; d.sonuclar = []; d.bitti = null;
        try {
          if (!dosya) return;
          if (dosya.size > IC_AKTARIM_BOYUT_SINIRI) throw new Error('Dosya 2 MB sınırını aşıyor. Dosyayı bölerek aktarın.');
          const metin = await dosya.text();
          if (metin.includes('\u0000') || /^PK\u0003\u0004/.test(metin)) throw new Error('Bu dosya CSV gibi görünmüyor. Excel dosyasını "CSV UTF-8" olarak kaydedip yeniden seçin.');
          const { satirlar } = csvAyristir(metin);
          if (satirlar.length < 2) throw new Error('Dosyada başlık satırı ve en az bir veri satırı olmalıdır.');
          if (satirlar.length - 1 > IC_AKTARIM_SATIR_SINIRI) throw new Error(`Dosyada ${sayi(satirlar.length - 1)} satır var; en fazla ${sayi(IC_AKTARIM_SATIR_SINIRI)} satır aktarılabilir. Dosyayı bölün.`);
          const t = csvTablo(satirlar);
          await mevcutYukle();
          d.dosyaAdi = dosya.name; d.basliklar = t.basliklar; d.kayitlar = t.kayitlar; d.esleme = otomatikEsle(t.basliklar, alanlar());
          dogrula();
        } catch (err) { d.hata = err instanceof Error && !err.code ? err.message : humanError(err); d.kayitlar = []; }
        iceYenile();
      }

      async function aktar() {
        const hazir = d.sonuclar.filter((s) => s.durum === 'hazir');
        if (!hazir.length || d.calisiyor) return;
        const tur = ICE_AKTARIM_TURLERI[d.tur].ad.toLowerCase();
        if (!(await confirmDialog({ baslik: 'Aktarım onayı', onayEtiketi: `${sayi(hazir.length)} kaydı ekle`, mesaj: `${sayi(hazir.length)} yeni ${tur === 'firmalar' ? 'firma' : 'kişi'} eklenecek. Mükerrer ve hatalı satırlar atlanır. Eklenen kayıtlar tek tek arşivlenebilir; toplu geri alma yoktur. Devam edilsin mi?` }))) return;
        d.calisiyor = true; onizlemeYenile();
        const ilerleme = () => kok.querySelector('#ice-ilerleme');
        const b = { eklenen: 0, atlanan: d.sonuclar.length - hazir.length, hatali: [], durduruldu: false };
        let ardArda = 0;
        const baslangic = kok.querySelector('#ice-baslangic')?.value || d.baslangic;
        for (let i = 0; i < hazir.length; i += 1) {
          const s = hazir[i];
          if (ilerleme()) ilerleme().textContent = `Aktarılıyor… ${sayi(i)} / ${sayi(hazir.length)}`;
          try {
            if (d.tur === 'firmalar') await app.api.createCompany(s.firma, s.profil ? { ...s.profil, baslangic } : null);
            else await app.api.createContact(s.kisi);
            b.eklenen += 1; ardArda = 0;
          } catch (err) {
            ardArda += 1; b.hatali.push({ satirNo: s.satirNo, ad: d.tur === 'firmalar' ? s.firma.name : s.kisi.full_name, mesaj: humanError(err) });
            if (ardArda >= ART_ARDA_HATA_SINIRI) { b.durduruldu = i < hazir.length - 1; break; }
          }
        }
        d.calisiyor = false; d.bitti = b;
        // raporlanabilsin: sunucu hatası alan satırları hata raporuna dönüştür
        for (const h of b.hatali) { const s = d.sonuclar.find((x) => x.satirNo === h.satirNo); if (s) { s.durum = 'hata'; s.hatalar = [h.mesaj]; } }
        iceYenile();
        toast(b.hatali.length ? `${sayi(b.eklenen)} kayıt eklendi, ${sayi(b.hatali.length)} kayıt eklenemedi.` : `${sayi(b.eklenen)} kayıt eklendi.`, b.hatali.length ? 'bilgi' : 'basari');
      }

      kok.addEventListener('change', (e) => {
        if (e.target.id === 'ice-dosya') { dosyaSecildi(e.target.files?.[0]); return; }
        if (e.target.id === 'ice-tur') { d.tur = e.target.value; sifirla(); iceYenile(); return; }
        if (e.target.id === 'ice-baslangic') { d.baslangic = e.target.value; return; }
        const s = e.target.closest('[data-esle]');
        if (s) {
          const alan = s.value; const i = Number(s.dataset.esle);
          if (alan) d.esleme = d.esleme.map((a, k) => (k !== i && a === alan ? '' : a)); // bir alan tek sütuna eşlenir
          d.esleme[i] = alan; dogrula();
          kok.querySelectorAll('[data-esle]').forEach((x) => { x.value = d.esleme[Number(x.dataset.esle)]; });
          onizlemeYenile();
        }
      });

      kok.addEventListener('click', async (e) => {
        const disaBtn = e.target.closest('[data-disa]');
        if (disaBtn) {
          const kume = VERI_KUMELERI.find((k) => k.id === disaBtn.dataset.disa); if (!kume) return;
          disaBtn.disabled = true;
          try {
            const veri = await kumeVerisi(app, kume);
            const satirlar = kume.satirlar(veri);
            if (!satirlar.length) toast(`${kume.ad} için kayıt yok; yalnızca başlık satırı indirildi.`, 'bilgi');
            const ad = csvIndir(kume.id, kume.basliklar, satirlar, bugun());
            if (satirlar.length) toast(`${ad} indirildi (${sayi(satirlar.length)} satır).`);
          } catch (err) { toast(humanError(err), 'hata'); } finally { disaBtn.disabled = false; }
          return;
        }
        const a = e.target.closest('[data-action]')?.dataset.action;
        if (a === 'ice-sablon') { const t = SABLONLAR[d.tur]; dosyaIndir(`${dosyaAdiParcasi(ICE_AKTARIM_TURLERI[d.tur].ad)}-sablon.csv`, csvUret(t.basliklar, [t.ornek])); }
        else if (a === 'ice-aktar') aktar();
        else if (a === 'ice-yeni') { sifirla(); iceYenile(); }
        else if (a === 'ice-hata-indir') {
          const r = hataRaporu(d.sonuclar, d.kayitlar, d.basliklar);
          csvIndir(`aktarilamayan-${d.tur}`, r.basliklar, r.satirlar, bugun());
        }
      });
    },
  };
}
