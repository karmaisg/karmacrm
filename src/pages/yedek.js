// OSGB 360 - Yedekleme: tüm verinin tek JSON dosyasında indirilmesi ve yedek dosyasının doğrulanması.
// Mantık: lib/yedek.js. Not: Bu ekran geri yükleme yapmaz; geri yükleme gerektiğinde yedek dosyası geliştiriciyle birlikte kullanılır.
import { html, tarih } from '../lib/format.js';
import { tarihSaat } from '../lib/format.js';
import { icon } from '../ui/icons.js';
import { pill, toast } from '../ui/components.js';
import { dosyaIndir } from '../ui/indir.js';
import { humanError } from '../lib/api.js';
import { YEDEK_TABLOLARI, TUM_MODULLER, yedekPaketi, yedekDogrula, yedekYasi } from '../lib/yedek.js';
import { tabloAdi } from '../lib/denetim.js';

const DOSYA_SINIRI = 100 * 1024 * 1024;

export async function yedekSayfasi(app) {
  const tamYetki = TUM_MODULLER.every((m) => app.can(m, 'view'));
  let son = await app.api.lastBackup().catch(() => null);
  let calisiyor = false;

  const sonKart = () => {
    const yas = yedekYasi(son?.created_at);
    const durum = yas === null ? pill('Henüz yedek alınmadı', 'danger') : yas > 7 ? pill(`${yas} gün önce — eski`, 'warning') : pill(yas === 0 ? 'Bugün alındı' : `${yas} gün önce`, 'success');
    return html`<div class="card-head"><div><h2 class="card-title">Son yedek</h2>
      <p class="card-sub">${son ? `${tarihSaat(son.created_at)} · ${son.new_data?.satir_sayisi ?? 0} satır, ${son.new_data?.tablo_sayisi ?? 0} tablo` : 'Bu uygulamadan yedek alındığı kaydı yok.'}</p></div>${durum}</div>
      <p class="fine pad">En az haftada bir yedek almanız önerilir. Yedeği bilgisayarınızın dışında bir yerde de (ör. şifreli bir bulut klasörü) saklayın.</p>`;
  };

  async function yedekAl(kok) {
    if (calisiyor) return; calisiyor = true;
    const dugme = kok.querySelector('#yedek-al'); const durum = kok.querySelector('#yedek-durum'); dugme.disabled = true;
    const tablolar = {}; const eksik = [];
    try {
      for (const [i, t] of YEDEK_TABLOLARI.entries()) {
        durum.textContent = `Okunuyor: ${tabloAdi(t.ad)} (${i + 1}/${YEDEK_TABLOLARI.length})…`;
        try { tablolar[t.ad] = await app.api.readAllRows(t.ad, t.sira); } catch { eksik.push(t.ad); }
      }
      if (!Object.keys(tablolar).length) throw new Error('Hiçbir tablo okunamadı. İnternet bağlantınızı ve oturumunuzu kontrol edin.');
      const kurum = app.ctx?.org?.name ?? null;
      const p = await yedekPaketi(tablolar, { kurum, eksik });
      dosyaIndir(p.dosyaAdi, p.metin, 'application/json;charset=utf-8');
      let kayitHatasi = false;
      try { await app.api.recordBackup({ tabloSayisi: p.tabloSayisi, satirSayisi: p.satirSayisi, dosya: p.dosyaAdi }); } catch { kayitHatasi = true; }
      son = await app.api.lastBackup().catch(() => son);
      kok.querySelector('#yedek-son').innerHTML = sonKart().s;
      durum.textContent = '';
      toast(eksik.length ? `Yedek indirildi, ancak ${eksik.length} tablo okunamadı: ${eksik.join(', ')}.` : kayitHatasi ? 'Yedek indirildi (yedek kaydı denetime yazılamadı).' : `Yedek indirildi: ${p.satirSayisi} satır.`, eksik.length || kayitHatasi ? 'bilgi' : undefined);
    } catch (e) { durum.textContent = ''; toast(humanError(e), 'hata'); }
    calisiyor = false; dugme.disabled = false;
  }

  async function dogrula(kok) {
    const girdi = kok.querySelector('#yedek-dosya'); const kutu = kok.querySelector('#yedek-sonuc'); const dosya = girdi.files?.[0];
    if (!dosya) { toast('Önce bir yedek dosyası seçin.', 'hata'); return; }
    if (dosya.size > DOSYA_SINIRI) { kutu.innerHTML = html`<div class="notice notice-danger" role="alert">Dosya çok büyük (en çok 100 MB).</div>`.s; return; }
    const s = await yedekDogrula(await dosya.text());
    kutu.innerHTML = html`<div class="notice ${s.gecerli ? 'notice-info' : 'notice-danger'}" role="${s.gecerli ? 'status' : 'alert'}"><strong>${s.gecerli ? 'Yedek dosyası sağlam.' : 'Yedek dosyasında sorun var.'}</strong>
      ${s.olusturma ? html`<span> Oluşturulma: ${tarihSaat(s.olusturma)} · toplam ${s.toplamSatir} satır.</span>` : ''}</div>
      ${s.hatalar.length ? html`<ul class="list">${s.hatalar.map((h) => html`<li class="text-danger">${h}</li>`)}</ul>` : ''}
      ${s.uyarilar.length ? html`<ul class="list">${s.uyarilar.map((h) => html`<li class="muted">${h}</li>`)}</ul>` : ''}
      ${s.tablolar.length ? html`<div class="table-wrap"><table class="table" id="yedek-tablolar"><thead><tr><th scope="col">Tablo</th><th scope="col" class="num">Satır</th></tr></thead><tbody>
        ${s.tablolar.map((t) => html`<tr><td>${tabloAdi(t.ad)}</td><td class="num">${t.adet}</td></tr>`)}</tbody></table></div>` : ''}`.s;
  }

  return {
    baslik: 'Yedekleme', altBaslik: 'Tüm verinizi tek dosyada bilgisayarınıza indirin',
    govde: html`<div class="notice notice-info" role="note"><strong>Neden önemli?</strong> Supabase ücretsiz planında otomatik yedek bulunmaz. Verinizin tek kopyası Supabase'dedir; yedeği bu ekrandan siz almalısınız.</div>
      <section class="card card-flush pad-t" id="yedek-son">${sonKart()}</section>
      <section class="card pad-t"><h2 class="card-title">Yedek al</h2>
        ${tamYetki ? html`<p class="card-sub">Firmalar, kişiler, teklifler, sözleşmeler, faturalar, tahsilatlar, giderler, personel maliyetleri, ayarlar ve denetim kaydı dahil, arşivdekilerle birlikte hepsi indirilir.</p>
          <p><button type="button" class="btn btn-primary" id="yedek-al">${icon('archive', 16)} Yedeği indir</button> <span class="fine" id="yedek-durum" aria-live="polite"></span></p>`
          : html`<div class="notice notice-info" role="note">Tam yedek için tüm modülleri görüntüleme yetkisi gerekir (işletme sahibi / sistem yöneticisi). Yetkiniz olmayan veriler eksik kalacağı için yedek alma kapalıdır.</div>`}
        <p class="fine">Yedek dosyası <strong>maaşlar ve müşteri bilgileri</strong> gibi gizli veriler içerir. Başkalarıyla paylaşmayın, e-postayla göndermeyin. Kullanıcıların giriş şifreleri yedekte yoktur (Supabase'de ayrı tutulur).</p></section>
      <section class="card pad-t"><h2 class="card-title">Yedek dosyasını doğrula</h2>
        <p class="card-sub">Eski bir yedeğin bozulmadığını kontrol edin. Hiçbir veri değiştirilmez ya da yüklenmez; dosya yalnızca tarayıcınızda okunur.</p>
        <div class="field"><label for="yedek-dosya">Yedek dosyası (.json)</label><input id="yedek-dosya" type="file" accept=".json,application/json"></div>
        <p><button type="button" class="btn btn-secondary" id="yedek-dogrula">${icon('check', 16)} Doğrula</button></p><div id="yedek-sonuc" aria-live="polite"></div></section>
      <section class="card pad-t"><h2 class="card-title">Geri yükleme</h2>
        <p class="fine">Bu ekran verileri geri yüklemez; yanlışlıkla yapılacak bir geri yükleme güncel kayıtları ezebilir. Veri kaybı olursa yedek dosyasını saklayın ve geri yükleme için destek alın.</p></section>`,
    mount(kok) {
      kok.addEventListener('click', (e) => {
        if (e.target.closest('#yedek-al')) yedekAl(kok);
        if (e.target.closest('#yedek-dogrula')) dogrula(kok);
      });
    },
  };
}
