// OSGB 360 - Denetim kaydı: kim, neyi, ne zaman değiştirdi. Okuma izni veri tabanında daraltılmıştır (11_asama11.sql).
// Mantık ve metinler: lib/denetim.js
import { html } from '../lib/format.js';
import { tarihSaat } from '../lib/format.js';
import { pill, emptyState, field, toast } from '../ui/components.js';
import { icon } from '../ui/icons.js';
import { humanError } from '../lib/api.js';
import { TABLO_ADLARI, tabloAdi, kayitAdi, degisiklikler, islemEtiketi, ISLEM_TONU, tarihSiniri, KAYIT_ID_DESENI } from '../lib/denetim.js';

const BOYUT = 50;
const trSirala = (a, b) => a.localeCompare(b, 'tr');

export async function denetimSayfasi(app) {
  const kullanicilar = await app.api.listUsers().catch(() => []);
  const adlar = Object.fromEntries(kullanicilar.map((u) => [u.id, u.full_name || u.email]));
  const f = { tablo: '', islem: '', kullanici: '', bas: '', bit: '', kayit: '' };
  let sira = 0; let satirlar = []; let sonraki = false; let hata = null;

  const kullaniciAdi = (id) => (id ? adlar[id] ?? 'Silinmiş kullanıcı' : 'Sistem');
  const tabloSecenekleri = [{ deger: '', etiket: 'Tümü' }, ...Object.entries(TABLO_ADLARI).sort((a, b) => trSirala(a[1], b[1])).map(([d, e]) => ({ deger: d, etiket: e }))];
  const islemSecenekleri = [{ deger: '', etiket: 'Tümü' }, { deger: 'INSERT', etiket: 'Eklendi' }, { deger: 'UPDATE', etiket: 'Güncellendi / arşivlendi' }, { deger: 'BACKUP', etiket: 'Yedek alındı' }];
  const kullaniciSecenekleri = [{ deger: '', etiket: 'Tümü' }, ...kullanicilar.map((u) => ({ deger: u.id, etiket: u.full_name || u.email })).sort((a, b) => trSirala(a.etiket, b.etiket))];

  const satirHtml = (x) => {
    const etiket = islemEtiketi(x); const veri = x.new_data ?? x.old_data;
    const d = degisiklikler(x);
    const ayrinti = d.liste.length
      ? html`<details class="denetim-ayrinti"><summary>${x.action === 'UPDATE' ? `${d.liste.length + d.fazla} alan değişti` : 'Kaydedilen bilgiler'}</summary>
          <ul class="list">${d.liste.map((c) => html`<li><span><strong>${c.ad}</strong></span><span>${c.eski === null ? c.yeni : html`<s class="muted">${c.eski}</s> → ${c.yeni}`}</span></li>`)}
          ${d.fazla ? html`<li class="muted">… ve ${d.fazla} alan daha</li>` : ''}</ul></details>`
      : html`<span class="muted">${x.action === 'BACKUP' ? `${veri?.satir_sayisi ?? 0} satır, ${veri?.tablo_sayisi ?? 0} tablo` : 'Görünür bir alan değişmedi'}</span>`;
    return html`<tr><td class="nowrap">${tarihSaat(x.created_at)}</td><td>${kullaniciAdi(x.user_id)}</td><td>${pill(etiket, ISLEM_TONU[etiket] ?? 'info')}</td>
      <td><strong>${tabloAdi(x.table_name)}</strong><small class="block muted">${x.table_name === 'yedek' ? '' : kayitAdi(x.table_name, veri, x.record_id)}</small></td><td>${ayrinti}</td></tr>`;
  };

  const sonucHtml = () => {
    if (hata) return html`<div class="notice notice-danger" role="alert">${hata}</div>`;
    if (!satirlar.length) return emptyState({ simge: 'history', baslik: 'Kayıt bulunamadı', metin: sira ? 'Bu sayfada kayıt yok.' : 'Seçtiğiniz süzgeçlere uyan değişiklik yok.' });
    return html`<div class="table-wrap"><table class="table" id="denetim-tablo"><thead><tr><th scope="col">Zaman</th><th scope="col">Kullanıcı</th><th scope="col">İşlem</th><th scope="col">Kayıt</th><th scope="col">Ayrıntı</th></tr></thead>
      <tbody>${satirlar.map(satirHtml)}</tbody></table></div>
      <div class="pager"><span class="fine">${sira + 1}–${sira + satirlar.length}. kayıtlar</span>
      <span><button type="button" class="btn btn-secondary btn-sm" id="denetim-onceki" ${sira ? '' : 'disabled'}>Önceki</button>
      <button type="button" class="btn btn-secondary btn-sm" id="denetim-sonraki" ${sonraki ? '' : 'disabled'}>Sonraki</button></span></div>`;
  };

  async function yukle(kok) {
    const s = tarihSiniri(f.bas, f.bit);
    hata = s.hata; satirlar = []; sonraki = false;
    if (!hata) {
      try {
        const l = await app.api.listAuditLogs({ tablo: f.tablo, islem: f.islem, kullanici: f.kullanici, kayit: f.kayit, bas: s.bas, bit: s.bit, sira, boyut: BOYUT });
        sonraki = l.length > BOYUT; satirlar = l.slice(0, BOYUT);
      } catch (e) { hata = humanError(e); }
    }
    kok.querySelector('#denetim-sonuc').innerHTML = sonucHtml().s;
  }

  return {
    baslik: 'Denetim kaydı', altBaslik: 'Kim, neyi, ne zaman değiştirdi. Kayıtlar değiştirilemez ve silinemez.',
    govde: html`<section class="card pad"><form id="denetim-suz" class="form-grid" novalidate>
        ${field({ ad: 'tablo', etiket: 'Kayıt türü', secenekler: tabloSecenekleri })}${field({ ad: 'islem', etiket: 'İşlem', secenekler: islemSecenekleri })}
        ${field({ ad: 'kullanici', etiket: 'Kullanıcı', secenekler: kullaniciSecenekleri })}
        ${field({ ad: 'bas', etiket: 'Başlangıç tarihi', tur: 'date' })}${field({ ad: 'bit', etiket: 'Bitiş tarihi', tur: 'date' })}
        ${field({ ad: 'kayit', etiket: 'Kayıt kimliği (isteğe bağlı)', yerTutucu: 'ör. ayrıntıda görünen uzun kimlik', ipucu: 'Belirli bir kaydın tüm geçmişini görmek için.' })}
        <div class="form-actions"><button type="submit" class="btn btn-primary">${icon('search', 16)} Uygula</button> <button type="button" class="btn btn-secondary" id="denetim-temizle">Temizle</button></div>
      </form>
      <p class="fine">Maaş gibi hassas kayıtları yalnızca ilgili modülü görme izni olan kullanıcılar görür. Saatler Türkiye saatidir.</p></section>
      <section class="card card-flush pad-t" id="denetim-sonuc" aria-live="polite"></section>`,
    async mount(kok) {
      const form = kok.querySelector('#denetim-suz');
      const oku = () => { const fd = new FormData(form); for (const k of Object.keys(f)) f[k] = String(fd.get(k) ?? '').trim(); };
      form.addEventListener('submit', (e) => {
        e.preventDefault(); oku();
        if (f.kayit && !KAYIT_ID_DESENI.test(f.kayit)) { toast('Kayıt kimliği geçerli bir kimlik değil (uzun, tireli metin).', 'hata'); return; }
        sira = 0; yukle(kok);
      });
      kok.querySelector('#denetim-temizle').addEventListener('click', () => { form.reset(); oku(); sira = 0; yukle(kok); });
      kok.addEventListener('click', (e) => {
        if (e.target.closest('#denetim-onceki')) { sira = Math.max(0, sira - BOYUT); yukle(kok); }
        if (e.target.closest('#denetim-sonraki')) { sira += BOYUT; yukle(kok); }
      });
      await yukle(kok);
    },
  };
}
