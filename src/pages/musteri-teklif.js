// OSGB 360 - Müşteri teklif sayfası (giriş gerektirmez). Adres: #/t/<gizli anahtar>
// Bu sayfa uygulamanın geri kalanını (oturum, menü, yetki) YÜKLEMEZ; yalnızca iki güvenli fonksiyonu çağırır.
// Mantık: lib/musteri.js. Veri tabanı yalnızca izinli alanları döndürür (maliyet, kâr, iç not yok).
import { html, mount, tarih } from '../lib/format.js';
import { tarihSaat } from '../lib/format.js';
import { icon } from '../ui/icons.js';
import { field, showFieldErrors } from '../ui/components.js';
import { humanError } from '../lib/api.js';
import { TOKEN_DESENI, teklifOzeti, yanitDogrula, tl } from '../lib/musteri.js';
import { FIYATLAMA, KDV_MODU } from '../lib/ticari.js';
import { TEHLIKE } from '../lib/format.js';

const kapsayici = (icerik) => html`<main class="musteri" id="main"><div class="musteri-kap">${icerik}</div></main>`;
const kart = (baslik, metin) => kapsayici(html`<section class="card pad musteri-mesaj"><h1>${baslik}</h1><p>${metin}</p></section>`);

function robotlariEngelle() {
  if (document.querySelector('meta[name="robots"]')) return;
  const m = document.createElement('meta'); m.name = 'robots'; m.content = 'noindex,nofollow,noarchive'; document.head.append(m);
}

export async function musteriTeklifSayfasi(api, token) {
  const kok = document.getElementById('app');
  robotlariEngelle();
  document.title = 'Teklif';
  let p = null; let secim = null; let gonderiyor = false;

  const gecersiz = () => { document.title = 'Teklif'; mount(kok, kart('Bu bağlantı geçersiz ya da süresi dolmuş', 'Lütfen teklifi gönderen kişiyle iletişime geçin ve yeni bir bağlantı isteyin.')); };

  async function yukle() {
    if (!TOKEN_DESENI.test(token)) { gecersiz(); return false; }
    try { p = await api.getPublicOffer(token); } catch (e) {
      console.error(e);
      mount(kok, kart('Teklif şu anda açılamadı', 'İnternet bağlantınızı kontrol edip sayfayı yenileyin. Sorun sürerse teklifi gönderen kişiyle iletişime geçin.'));
      return false;
    }
    if (!p || p.durum !== 'gecerli') { gecersiz(); return false; }
    return true;
  }

  function ciz() {
    const o = teklifOzeti(p);
    document.title = `Teklif ${p.teklif_no} · ${p.kurum}`;
    const durumNotu = p.yanit
      ? html`<div class="notice ${p.yanit.karar === 'kabul' ? 'notice-ok' : 'notice-info'}" role="status" id="yanit-bilgi"><strong>Yanıtınız alındı:</strong> ${p.yanit.karar === 'kabul' ? 'Teklifi kabul ettiniz' : 'Teklifi kabul etmediniz'} (${p.yanit.ad}, ${tarihSaat(p.yanit.tarih)}). Değişiklik için lütfen bizimle iletişime geçin.</div>`
      : p.teklif_durumu === 'kabul_edildi' ? html`<div class="notice notice-ok" role="status">Bu teklif kabul edilmiştir.</div>`
      : p.teklif_durumu === 'reddedildi' ? html`<div class="notice notice-info" role="status">Bu teklif kapatılmıştır.</div>`
      : p.sure_bitti || p.teklif_durumu === 'suresi_doldu' ? html`<div class="notice notice-warn" role="status">Bu teklifin geçerlilik süresi dolmuştur. Güncel teklif için lütfen bizimle iletişime geçin.</div>` : '';
    mount(kok, kapsayici(html`
      <header class="musteri-ust"><div><p class="musteri-kurum">${p.kurum}</p><h1>Teklif ${p.teklif_no}</h1>
        <p class="muted">${tarih(p.teklif_tarihi)}${p.gecerlilik ? ` · ${tarih(p.gecerlilik)} tarihine kadar geçerlidir` : ''}</p></div>
        <button type="button" class="btn btn-secondary yazdirma-gizli" id="yazdir">${icon('file', 18)} Yazdır / PDF</button></header>
      ${durumNotu}
      <section class="card pad"><p>Sayın <strong>${p.alici}</strong>,</p>
        ${p.musteri_notu ? html`<p class="prewrap" id="musteri-notu">${p.musteri_notu}</p>` : ''}</section>
      <section class="card card-flush"><div class="card-head"><h2 class="card-title">Hizmet bedeli</h2></div>
        <dl class="kv-list pad">
          <div class="kv"><dt>Çalışan sayısı / tehlike sınıfı</dt><dd>${p.calisan_sayisi} · ${TEHLIKE[p.tehlike] ?? p.tehlike}</dd></div>
          <div class="kv"><dt>Fiyatlama</dt><dd>${FIYATLAMA[p.fiyatlama] ?? p.fiyatlama}</dd></div>
          ${o.fiyatlama === 'kisi_basi' && o.birimFiyat !== null ? html`<div class="kv"><dt>Kişi başı aylık (${KDV_MODU[o.kdvModu]})</dt><dd>${tl(o.birimFiyat)} × ${o.calisan}</dd></div>` : ''}
          <div class="kv"><dt>Aylık tutar (${KDV_MODU[o.kdvModu]})</dt><dd>${tl(o.brut)}</dd></div>
          ${o.indirimYuzde > 0 ? html`<div class="kv"><dt>İndirim (%${o.indirimYuzde})</dt><dd>−${tl(o.indirimTutari)}</dd></div>` : ''}
          <div class="kv"><dt>Aylık, KDV hariç</dt><dd>${tl(o.aylikHaric)}</dd></div>
          <div class="kv"><dt>KDV (%${o.kdvOrani})</dt><dd>${tl(o.aylikKdv)}</dd></div>
          <div class="kv"><dt><strong>Aylık toplam (KDV dahil)</strong></dt><dd><strong id="aylik-toplam">${tl(o.aylikDahil)}</strong></dd></div>
        </dl></section>
      ${o.kalemler.length ? html`<section class="card card-flush pad-t"><div class="card-head"><div><h2 class="card-title">Ek hizmetler</h2><p class="card-sub">Aylık bedele dahil değildir.</p></div></div>
        <div class="table-wrap"><table class="table" id="kalem-tablo"><thead><tr><th scope="col">Açıklama</th><th scope="col" class="num">Miktar</th><th scope="col" class="num">Birim fiyat</th><th scope="col" class="num">KDV hariç</th><th scope="col" class="num">KDV dahil</th></tr></thead><tbody>
          ${o.kalemler.map((k) => html`<tr><td>${k.aciklama}<small class="block muted">${KDV_MODU[k.kdvModu]} %${k.kdvOrani}</small></td><td class="num">${k.miktar}</td><td class="num">${tl(k.birimFiyat)}</td><td class="num">${tl(k.haric)}</td><td class="num">${tl(k.dahil)}</td></tr>`)}
          <tr><th scope="row">Toplam</th><td></td><td></td><td class="num"><strong>${tl(o.kalemHaric)}</strong></td><td class="num"><strong>${tl(o.kalemDahil)}</strong></td></tr></tbody></table></div></section>` : ''}
      ${p.yanit_verilebilir ? html`<section class="card pad pad-t yazdirma-gizli" id="yanit-kart"><h2 class="card-title">Yanıtınız</h2>
        <p class="card-sub">Yanıtınız teklif sahibine iletilir. Hizmet sözleşmesi ayrıca düzenlenir.</p>
        <div class="musteri-dugmeler" id="yanit-dugmeler"><button type="button" class="btn btn-success" data-karar="kabul">${icon('check', 18)} Teklifi kabul ediyorum</button>
          <button type="button" class="btn btn-danger" data-karar="red">${icon('x', 18)} Kabul etmiyorum</button></div>
        <form id="yanit-form" class="form" novalidate hidden><div class="form-grid">
          ${field({ ad: 'ad', etiket: 'Adınız ve soyadınız', zorunlu: true, maksUzunluk: 80, otomatik: 'name', tam: true })}
          ${field({ ad: 'not', etiket: 'Notunuz (isteğe bağlı)', tur: 'textarea', maksUzunluk: 500, tam: true })}</div>
          <div class="form-error" role="alert" hidden></div>
          <div class="modal-actions"><button type="button" class="btn btn-secondary" id="yanit-vazgec">Vazgeç</button><button type="submit" class="btn btn-success" id="yanit-gonder">Gönder</button></div></form></section>` : ''}
      <p class="fine musteri-alt">Bu sayfa size özel bir bağlantıyla açılmıştır; lütfen başkalarıyla paylaşmayın.</p>`));
    bagla();
  }

  function bagla() {
    kok.querySelector('#yazdir').addEventListener('click', () => window.print());
    const form = kok.querySelector('#yanit-form'); if (!form) return;
    const dugmeler = kok.querySelector('#yanit-dugmeler'); const hataKutusu = form.querySelector('.form-error'); const gonder = form.querySelector('#yanit-gonder');
    dugmeler.addEventListener('click', (e) => {
      const b = e.target.closest('[data-karar]'); if (!b) return;
      secim = b.dataset.karar; dugmeler.hidden = true; form.hidden = false;
      gonder.textContent = secim === 'kabul' ? 'Kabulümü gönder' : 'Reddimi gönder';
      gonder.classList.toggle('btn-success', secim === 'kabul'); gonder.classList.toggle('btn-danger', secim !== 'kabul');
      form.dataset.karar = secim;
      form.querySelector('#f-ad').focus();
    });
    kok.querySelector('#yanit-vazgec').addEventListener('click', () => { form.hidden = true; dugmeler.hidden = false; secim = null; hataKutusu.hidden = true; showFieldErrors(form, {}); });
    form.addEventListener('submit', async (e) => {
      e.preventDefault(); if (gonderiyor || !secim) return;
      showFieldErrors(form, {}); hataKutusu.hidden = true;
      const fd = new FormData(form); const s = yanitDogrula({ ad: fd.get('ad'), not: fd.get('not') });
      if (s.hata) { showFieldErrors(form, s.hata); return; }
      gonderiyor = true; gonder.disabled = true; gonder.textContent = 'Gönderiliyor…';
      try {
        await api.answerPublicOffer({ token, karar: secim, ad: s.ad, not: s.not });
        if (await yukle()) { ciz(); kok.querySelector('#yanit-bilgi')?.focus?.(); }
      } catch (err) {
        hataKutusu.textContent = humanError(err); hataKutusu.hidden = false;
        gonder.disabled = false; gonder.textContent = secim === 'kabul' ? 'Kabulümü gönder' : 'Reddimi gönder';
      }
      gonderiyor = false;
    });
  }

  mount(kok, kart('Teklif açılıyor…', 'Lütfen bekleyin.'));
  if (await yukle()) ciz();
}
