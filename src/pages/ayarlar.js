// OSGB 360 - Sistem ayarları: sayısal parametreler ve hizmet süresi kuralları (tarihçeli). Mantık: lib/ayarlar.js
import { html, bugun, tarih, tarihSaat, ayAdi } from '../lib/format.js';
import { icon } from '../ui/icons.js';
import { pill, emptyState, field, openFormModal, toast } from '../ui/components.js';
import { PERSONEL_TURLERI, TEHLIKE_SINIFLARI } from '../lib/hesaplama.js';
import { PERSONEL_TURU, PERSONEL_TURU_KISA } from '../lib/operasyon.js';
import { TEHLIKE } from '../lib/format.js';
import {
  AYAR_TANIMLARI, ayarTanimi, ayarDogrula, kuralDakikaDogrula, baslangicSecenekleri, ayarDurumu, kuralDurumlari, degisiklikGecmisi,
} from '../lib/ayarlar.js';
import { humanError } from '../lib/api.js';

const SAYI = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 2 });
const ns = (n) => SAYI.format(n);
const GECMIS_SATIRI = 40;

const degerMetni = (t, v) => (t.anahtar === 'kapasite_dakika' ? `${ns(v)} dk` : `%${ns(v)}`);
const baslangicEtiketi = (iso, bugunStr) => `${ayAdi(iso)}'dan itibaren${iso.slice(0, 7) === bugunStr.slice(0, 7) ? ' (bu ay)' : ''}`;
const baslangicAlani = (bugunStr, ilk) => field({
  ad: 'baslangic', etiket: 'Ne zamandan itibaren geçerli', zorunlu: true, deger: baslangicSecenekleri(bugunStr)[ilk],
  secenekler: baslangicSecenekleri(bugunStr).map((a) => ({ deger: a, etiket: baslangicEtiketi(a, bugunStr) })),
  ipucu: 'Değişiklik seçilen ayın 1\'inden itibaren geçerli olur. Geçmiş aylar etkilenmez; "bu ay"ı seçerseniz bu ayın rakamları da değişir.',
});

export async function ayarlarSayfasi(app) {
  const [ayarlar0, kurallar0] = await Promise.all([app.api.listSettings(), app.api.listServiceRules()]);
  let ayarlar = ayarlar0; let kurallar = kurallar0;
  // Özet günlüğü: 10_asama10.sql çalıştırılmadıysa tablo yoktur; sayfa yine açılır, kart "kurulmamış" der.
  const gunlukOku = () => Promise.resolve().then(() => app.api.listDigestLog()).then((v) => ({ satirlar: v, hata: false }), () => ({ satirlar: [], hata: true }));
  let ozetGunlugu = await gunlukOku();
  const degistirebilir = app.can('settings', 'create') && app.can('settings', 'edit');

  const genelKart = () => {
    const bugunStr = bugun();
    return html`<section class="card card-flush"><div class="card-head"><div><h2 class="card-title">Genel parametreler</h2>
      <p class="card-sub">Teklif, kapasite ve kârlılık hesaplarında kullanılır.</p></div></div>
      <div class="table-wrap"><table class="table" id="ayar-tablo"><thead><tr><th scope="col">Ayar</th><th scope="col" class="num">Şu an geçerli</th><th scope="col" class="hide-sm">Planlanan değişiklik</th>${degistirebilir ? html`<th scope="col"><span class="sr-only">İşlem</span></th>` : ''}</tr></thead><tbody>
      ${AYAR_TANIMLARI.map((t) => { const d = ayarDurumu(ayarlar, t, bugunStr); return html`<tr data-ayar-satir="${t.anahtar}"><td><strong>${t.etiket}</strong><small class="block muted">${t.aciklama}</small></td>
        <td class="num"><strong>${degerMetni(t, d.gecerli.deger)}</strong>${d.gecerli.varsayilan ? html`<small class="block muted">varsayılan</small>` : ''}</td>
        <td class="hide-sm">${d.planli ? html`${pill(`${degerMetni(t, d.planli.deger)} · ${tarih(d.planli.baslangic)}`, 'info')}` : html`<span class="muted">—</span>`}</td>
        ${degistirebilir ? html`<td class="actions"><button type="button" class="btn btn-secondary btn-sm" data-ayar="${t.anahtar}">${icon('settings', 16)} Değiştir</button></td>` : ''}</tr>`; })}
      </tbody></table></div></section>`;
  };

  const kuralKart = () => {
    const bugunStr = bugun(); const d = kuralDurumlari(kurallar, bugunStr);
    return html`<section class="card card-flush pad-t"><div class="card-head"><div><h2 class="card-title">Hizmet süresi kuralları</h2>
      <p class="card-sub">Çalışan başına aylık teorik dakika; firma ihtiyacı, kapasite ve kârlılık bu kurallardan hesaplanır. Mevzuat değişirse yeni değer girin; eski ayların hesabı eski kuralla kalır.</p></div></div>
      <div class="table-wrap"><table class="table" id="kural-tablo"><thead><tr><th scope="col">Personel</th>${TEHLIKE_SINIFLARI.map((t) => html`<th scope="col" class="num">${TEHLIKE[t]}</th>`)}</tr></thead><tbody>
      ${PERSONEL_TURLERI.map((tur) => html`<tr><td><strong>${PERSONEL_TURU[tur]}</strong></td>${TEHLIKE_SINIFLARI.map((t) => { const x = d[`${tur}|${t}`];
        return html`<td class="num" data-kural-hucre="${tur}|${t}"><strong>${x.gecerli ? `${ns(x.gecerli.minutes_per_employee)} dk` : '—'}</strong>
          ${x.planli ? html`<small class="block muted">${ns(x.planli.minutes_per_employee)} dk · ${ayAdi(x.planli.valid_from)}</small>` : ''}
          ${degistirebilir ? html`<button type="button" class="icon-btn" data-kural="${tur}|${t}" aria-label="${PERSONEL_TURU_KISA[tur]} ${TEHLIKE[t]} kuralını değiştir" title="Değiştir">${icon('settings', 16)}</button>` : ''}</td>`; })}</tr>`)}
      </tbody></table></div>
      <p class="fine pad">Bu değerler sizin parametrelerinizdir; yürürlükteki mevzuat süreleriyle uyumunu ayrıca doğrulayın.</p></section>`;
  };

  const gecmisKart = () => {
    const g = degisiklikGecmisi(ayarlar, kurallar, { turAdi: PERSONEL_TURU_KISA, tehlikeAdi: TEHLIKE });
    return html`<section class="card card-flush pad-t"><div class="card-head"><h2 class="card-title">Değişiklik geçmişi</h2></div>
      ${g.length ? html`<div class="table-wrap"><table class="table" id="ayar-gecmis"><thead><tr><th scope="col">Geçerli olduğu tarih</th><th scope="col">Ayar</th><th scope="col" class="num">Değer</th><th scope="col" class="hide-sm">Bitiş / not</th></tr></thead><tbody>
        ${g.slice(0, GECMIS_SATIRI).map((x) => html`<tr><td>${x.baslangic === '2000-01-01' ? html`<span class="muted">başlangıç değeri</span>` : tarih(x.baslangic)}</td><td>${x.ad}</td>
          <td class="num">${x.tur === 'kural' ? `${ns(x.deger)} dk` : degerMetni(ayarTanimi(x.anahtar), x.deger)}</td>
          <td class="hide-sm muted">${x.bitis ? `${tarih(x.bitis)} tarihine kadar` : ''}${x.not ? ` ${x.not}` : ''}</td></tr>`)}</tbody></table></div>
        ${g.length > GECMIS_SATIRI ? html`<p class="fine pad">En yeni ${GECMIS_SATIRI} kayıt gösteriliyor.</p>` : ''}`
        : emptyState({ simge: 'settings', baslik: 'Kayıt yok', metin: 'Ayarlar değiştikçe burada görünür.' })}</section>`;
  };

  const digerKart = () => html`<section class="card pad-t"><h2 class="card-title">Başka yerden yönetilenler</h2><ul class="list">
    <li><span><strong>Gider kategorileri</strong><small class="block muted">Yeni kategori eklemek için</small></span><a class="btn btn-secondary btn-sm" href="#/giderler">Giderler</a></li>
    <li><span><strong>Ortak gider dağıtım ölçütü</strong><small class="block muted">Kategori başına, aylık</small></span><a class="btn btn-secondary btn-sm" href="#/firma-karlilik">Firma kârlılığı</a></li>
    <li><span><strong>Kullanıcılar ve yetkiler</strong><small class="block muted">Kim neyi görebilir ve değiştirebilir</small></span><a class="btn btn-secondary btn-sm" href="#/kullanicilar">Yetkiler</a></li>
    <li><span><strong>Sözleşme yenileme uyarıları</strong><small class="block muted">90, 60 ve 30 gün kala (sabit)</small></span><span class="muted">değiştirilemez</span></li></ul></section>`;

  const DURUM = { gonderildi: ['Gönderildi', 'success'], atlandi: ['Atlandı', 'info'], hata: ['Hata', 'danger'] };
  const ozetKart = () => html`<section class="card card-flush pad-t" id="ozet-kart"><div class="card-head"><div><h2 class="card-title">Günlük özet e-postası</h2>
    <p class="card-sub">Her sabah 08:00'de yalnızca sizin e-posta adresinize gider: vadesi geçmiş ve yaklaşan faturalar, biten sözleşmeler, geciken görevler. Müşterilere hiçbir şey gönderilmez. Bildirilecek bir şey yoksa e-posta gönderilmez.</p></div>
    ${degistirebilir ? html`<button type="button" class="btn btn-secondary btn-sm" id="ozet-test">${icon('mail', 16)} Test e-postası gönder</button>` : ''}</div>
    ${ozetGunlugu.hata ? html`<div class="notice notice-info" role="note">Günlük özet henüz kurulmamış görünüyor (10_asama10.sql çalıştırılmamış olabilir). Kurulum rehberindeki Aşama 10 adımlarına bakın.</div>`
      : ozetGunlugu.satirlar.length ? html`<div class="table-wrap"><table class="table" id="ozet-gunlugu"><thead><tr><th scope="col">Zaman</th><th scope="col">Tür</th><th scope="col">Durum</th><th scope="col" class="hide-sm">Ayrıntı</th></tr></thead><tbody>
        ${ozetGunlugu.satirlar.map((x) => { const d = DURUM[x.durum] ?? [x.durum, 'info']; return html`<tr><td>${tarihSaat(x.created_at)}</td><td>${x.tur === 'test' ? 'Test' : 'Günlük'}</td><td>${pill(d[0], d[1])}</td><td class="hide-sm muted">${x.ayrinti ?? ''}</td></tr>`; })}</tbody></table></div>`
        : html`<p class="fine pad">Henüz gönderim kaydı yok. Kurulumu denemek için "Test e-postası gönder"i kullanın.</p>`}
    <p class="fine pad">Alıcı adresi ve e-posta servisi anahtarı güvenlik için Supabase'de gizli ayar olarak tutulur; bu sayfada gösterilmez ve değiştirilemez.</p></section>`;

  const hepsi = () => html`${genelKart()}${kuralKart()}${ozetKart()}${gecmisKart()}${digerKart()}`;

  async function yenile(kok) {
    try { [ayarlar, kurallar] = await Promise.all([app.api.listSettings(), app.api.listServiceRules()]); } catch (e) { toast(humanError(e), 'hata'); return; }
    ozetGunlugu = await gunlukOku();
    kok.querySelector('#ayarlar-kok').innerHTML = hepsi().s;
  }

  function ayarFormu(kok, anahtar) {
    const t = ayarTanimi(anahtar); const d = ayarDurumu(ayarlar, t, bugun());
    openFormModal({
      baslik: t.etiket, altBaslik: `Şu an geçerli: ${degerMetni(t, d.gecerli.deger)}`,
      govde: html`${field({ ad: 'deger', etiket: `Yeni değer (${t.birim === 'dk' ? 'dakika' : 'yüzde'})`, zorunlu: true, inputmode: 'decimal', deger: ns(d.gecerli.deger).replace(/\./g, ''), ipucu: t.aciklama, tam: true })}${baslangicAlani(bugun(), 1)}`,
      async onSubmit(fd) {
        const s = ayarDogrula(t, fd.get('deger'));
        if (s.hata) return { errors: { deger: s.hata } };
        if (s.deger === d.gecerli.deger && String(fd.get('baslangic')).slice(0, 7) === bugun().slice(0, 7)) return { errors: { deger: 'Değer şu anki değerle aynı.' } };
        await app.api.saveSetting({ anahtar, deger: s.deger, gecerlilik: String(fd.get('baslangic')) });
        toast(`${t.etiket} güncellendi.`);
      },
      onDone: () => yenile(kok),
    });
  }

  let ozetGidiyor = false;
  async function ozetTesti(kok) {
    if (ozetGidiyor) return;
    ozetGidiyor = true;
    const dugme = kok.querySelector('#ozet-test'); if (dugme) dugme.disabled = true;
    try { await app.api.sendDigestTest(); toast('Test e-postası gönderildi. Gelen kutunuzu (ve istenmeyen klasörünü) kontrol edin.'); } catch (e) { toast(humanError(e), 'hata'); }
    ozetGidiyor = false;
    await yenile(kok);
  }

  function kuralFormu(kok, anahtar) {
    const [tur, tehlike] = anahtar.split('|'); const x = kuralDurumlari(kurallar, bugun())[anahtar];
    openFormModal({
      baslik: `${PERSONEL_TURU[tur]} · ${TEHLIKE[tehlike]}`, altBaslik: `Şu an geçerli: ${x.gecerli ? `${ns(x.gecerli.minutes_per_employee)} dk / çalışan` : 'kural yok'}`,
      govde: html`${field({ ad: 'dakika', etiket: 'Çalışan başına aylık dakika', zorunlu: true, inputmode: 'decimal', deger: x.gecerli ? ns(x.gecerli.minutes_per_employee).replace(/\./g, '') : '', tam: true })}${baslangicAlani(bugun(), 1)}
        ${field({ ad: 'not', etiket: 'Not (isteğe bağlı)', tam: true, maksUzunluk: 200, yerTutucu: 'ör. Yönetmelik değişikliği' })}`,
      async onSubmit(fd) {
        const s = kuralDakikaDogrula(fd.get('dakika'));
        if (s.hata) return { errors: { dakika: s.hata } };
        if (x.gecerli && s.deger === Number(x.gecerli.minutes_per_employee) && !x.planli) return { errors: { dakika: 'Değer şu anki değerle aynı.' } };
        await app.api.addServiceRule({ tur, tehlike, dakika: s.deger, gecerlilik: String(fd.get('baslangic')), not: String(fd.get('not') ?? '').trim() || null });
        toast('Hizmet süresi kuralı güncellendi.');
      },
      onDone: () => yenile(kok),
    });
  }

  return {
    baslik: 'Sistem ayarları', altBaslik: 'Hesaplarda kullanılan parametreler; değişiklikler tarihçelidir, geçmiş aylar bozulmaz',
    govde: html`${degistirebilir ? '' : html`<div class="notice notice-info" role="note">Bu ayarları yalnızca görüntüleyebilirsiniz; değiştirmek için "Sistem ayarları" modülünde oluşturma ve düzenleme izni gerekir.</div>`}
      <div id="ayarlar-kok">${hepsi()}</div>`,
    mount(kok) {
      kok.addEventListener('click', (e) => {
        const a = e.target.closest('[data-ayar]'); if (a) { ayarFormu(kok, a.dataset.ayar); return; }
        const k = e.target.closest('[data-kural]'); if (k) { kuralFormu(kok, k.dataset.kural); return; }
        if (e.target.closest('#ozet-test')) ozetTesti(kok);
      });
    },
  };
}
