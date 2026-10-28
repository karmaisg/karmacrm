// OSGB 360 - Kapasite analizi: teorik yük (görevlendirme payı x firma ihtiyacı) ve fiilî süreye göre doluluk.
import { html, bugun, ayBasi, ayAdi, sayi, trSirala } from '../lib/format.js';
import { icon } from '../ui/icons.js';
import { avatar, emptyState, toast } from '../ui/components.js';
import { PERSONEL_TURU, PERSONEL_TURU_KISA, ayBitisi, kapsamPayi, personelAyYuku, zamanOzeti, dolulukSeviyesi, sureMetni } from '../lib/operasyon.js';
import { firmaAylikIhtiyac } from '../lib/hesaplama.js';
import { profilleriGrupla } from '../lib/veri.js';
import { humanError } from '../lib/api.js';
import { dolulukPill } from './personel.js';

const yuzde = (x) => (x === null || x === undefined ? '—' : `%${Math.round(x * 100)}`);

export async function kapasiteSayfasi(app) {
  const gerekli = [['staff', 'personel'], ['assignments', 'görevlendirme'], ['time', 'zaman kaydı'], ['companies', 'firma']].filter(([m]) => !app.can(m, 'view'));
  if (gerekli.length) {
    return { baslik: 'Kapasite analizi', altBaslik: 'Teorik yük ve fiilî süreye göre uzman ve hekim doluluk oranları',
      govde: emptyState({ simge: 'lock', baslik: 'Bu analiz için ek görüntüleme izni gerekir', metin: `Kapasite analizi personel, görevlendirme, zaman kaydı ve firma verilerini birlikte kullanır. Eksik izinler: ${gerekli.map(([, a]) => a).join(', ')}. Sistem yöneticinizden isteyin.` }) };
  }
  const bugunStr = bugun();
  const durum = { ay: ayBasi(bugunStr) };
  const [personel, atamalar, firmalar, profiller, kurallar] = await Promise.all([
    app.api.listEmployees(), app.api.listAssignments(), app.api.listCompanies(), app.api.listAllProfiles(), app.api.listServiceRules(),
  ]);
  const harita = profilleriGrupla(profiller);
  let zaman = await app.api.listTimeEntries(durum.ay, ayBitisi(durum.ay));
  const aySecenekleri = () => {
    const [y, mo] = bugunStr.split('-').map(Number); const l = [];
    for (let i = -1; i < 12; i += 1) { const t = new Date(y, mo - 1 - i, 1); l.push(`${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-01`); }
    return l;
  };

  function hesapla() {
    const aktifler = personel.filter((p) => !p.archived_at && p.is_active);
    const satirlar = aktifler.map((p) => {
      const yuk = personelAyYuku({ atamalar, employeeId: p.id, profilHaritasi: harita, kurallar, ay: durum.ay });
      const z = zamanOzeti(zaman.filter((k) => k.employee_id === p.id));
      const teorikOran = yuk.eksikVar ? null : yuk.dakika / p.monthly_capacity_min;
      return { p, yuk, z, teorikOran, fiiliOran: z.toplam / p.monthly_capacity_min };
    }).sort((a, b) => a.p.staff_type.localeCompare(b.p.staff_type) || trSirala(a.p.full_name, b.p.full_name));

    // görevlendirme eksiği: müşteri firmaların ihtiyacından payı %100'ün altında kalanlar
    const eksikler = [];
    const toplamlar = { is_guvenligi_uzmani: { ihtiyac: 0, atanmamis: 0 }, isyeri_hekimi: { ihtiyac: 0, atanmamis: 0 } };
    for (const f of firmalar.filter((x) => !x.archived_at && x.customer_status === 'musteri')) {
      const ih = firmaAylikIhtiyac({ profiller: harita.get(f.id) ?? [], kurallar, ay: durum.ay });
      if (!ih.profil) continue;
      for (const tur of ['is_guvenligi_uzmani', 'isyeri_hekimi']) {
        const ihtiyac = tur === 'is_guvenligi_uzmani' ? ih.uzmanDakika : ih.hekimDakika;
        if (ihtiyac === null) continue;
        const pay = kapsamPayi(atamalar, f.id, tur, durum.ay);
        toplamlar[tur].ihtiyac += ihtiyac;
        const bos = Math.round(ihtiyac * Math.max(0, 100 - pay) / 100);
        toplamlar[tur].atanmamis += bos;
        if (pay < 100 && ihtiyac > 0) eksikler.push({ f, tur, pay, bos, ihtiyac });
      }
    }
    eksikler.sort((a, b) => b.bos - a.bos);
    return { satirlar, eksikler, toplamlar };
  }

  function icerik() {
    const { satirlar, eksikler, toplamlar } = hesapla();
    const turOzet = (tur) => {
      const l = satirlar.filter((s) => s.p.staff_type === tur);
      const kap = l.reduce((t, s) => t + s.p.monthly_capacity_min, 0);
      const teorik = l.reduce((t, s) => t + s.yuk.dakika, 0);
      const fiili = l.reduce((t, s) => t + s.z.toplam, 0);
      return { l, kap, teorik, fiili, ihtiyac: toplamlar[tur].ihtiyac, atanmamis: toplamlar[tur].atanmamis };
    };
    const kart = (tur, simge) => {
      const o = turOzet(tur);
      return html`<section class="card"><h2 class="card-title">${PERSONEL_TURU[tur]}</h2>
        ${o.l.length ? html`<dl class="kv-list">
          <div class="kv"><dt>Toplam kapasite</dt><dd>${sureMetni(o.kap)} <small class="muted">${sayi(o.l.length)} kişi</small></dd></div>
          <div class="kv"><dt>Müşteri ihtiyacı (teorik)</dt><dd>${sureMetni(o.ihtiyac)} <small class="muted">${yuzde(o.kap ? o.ihtiyac / o.kap : null)} kapasite</small></dd></div>
          <div class="kv"><dt>Görevlendirilen yük</dt><dd>${sureMetni(o.teorik)} <small class="muted">${yuzde(o.kap ? o.teorik / o.kap : null)}</small></dd></div>
          <div class="kv"><dt>Görevlendirilmemiş ihtiyaç</dt><dd>${o.atanmamis ? html`<strong>${sureMetni(o.atanmamis)}</strong>` : '0 dk'}</dd></div>
          <div class="kv"><dt>Fiilî toplam süre</dt><dd>${sureMetni(o.fiili)} <small class="muted">${yuzde(o.kap ? o.fiili / o.kap : null)}</small></dd></div></dl>`
          : html`<p class="muted">Aktif ${PERSONEL_TURU[tur].toLowerCase()} kaydı yok. ${icon(simge, 14)}</p>`}</section>`;
    };
    const tablo = satirlar.length ? html`<div class="table-wrap"><table class="table"><thead><tr><th scope="col">Personel</th><th scope="col" class="num hide-sm">Kapasite</th><th scope="col" class="num">Teorik yük</th><th scope="col" class="num">Fiilî süre</th><th scope="col" class="hide-md">Fiilî hizmet</th><th scope="col">Durum</th></tr></thead><tbody>
      ${satirlar.map((s) => html`<tr><td><a class="cell-main" href="#/personel/${s.p.id}">${avatar(s.p.full_name, 'sm')}<span><strong>${s.p.full_name}</strong><small>${PERSONEL_TURU_KISA[s.p.staff_type]}</small></span></a></td>
        <td class="num hide-sm">${sureMetni(s.p.monthly_capacity_min)}</td>
        <td class="num">${s.yuk.dakika ? sureMetni(s.yuk.dakika) : '—'}<small class="block muted">${s.teorikOran !== null ? yuzde(s.teorikOran) : (s.yuk.eksikVar ? 'eksik veri' : '')}</small></td>
        <td class="num">${s.z.toplam ? sureMetni(s.z.toplam) : '—'}<small class="block muted">${s.z.toplam ? yuzde(s.fiiliOran) : ''}</small></td>
        <td class="hide-md">${s.z.hizmet ? sureMetni(s.z.hizmet) : '—'}<small class="block muted">${s.z.toplam ? `yol ${sureMetni(s.z.yol)} · bekleme ${sureMetni(s.z.bekleme)}` : ''}</small></td>
        <td>${dolulukPill(dolulukSeviyesi(s.teorikOran === null && s.z.toplam === 0 ? null : Math.max(s.teorikOran ?? 0, s.fiiliOran)))}</td></tr>`)}</tbody></table></div>`
      : emptyState({ simge: 'gauge', baslik: 'Aktif personel yok', metin: 'Uzman ve hekim ekleyip görevlendirdikçe analiz burada görünür.' });
    return html`<div class="grid-2">${kart('is_guvenligi_uzmani', 'shield')}${kart('isyeri_hekimi', 'pulse')}</div>
      <section class="card card-flush"><div class="card-head"><div><h2 class="card-title">Personel doluluğu · ${ayAdi(durum.ay)}</h2>
        <p class="card-sub">Teorik yük: ayın 1'inde yürürlükteki görevlendirme payları x firma ihtiyacı. Fiilî süre: o ay girilen zaman kayıtlarının toplamı.</p></div></div>${tablo}</section>
      <section class="card card-flush"><div class="card-head"><div><h2 class="card-title">Görevlendirme eksiği ${eksikler.length ? html`<span class="chip-n">${eksikler.length}</span>` : ''}</h2>
        <p class="card-sub">Müşteri firmalarda hizmet payı %100'ün altında kalan türler.</p></div></div>
        ${eksikler.length ? html`<div class="table-wrap"><table class="table"><thead><tr><th scope="col">Firma</th><th scope="col">Hizmet</th><th scope="col" class="num">Görevli pay</th><th scope="col" class="num">Boşta kalan süre</th></tr></thead><tbody>
          ${eksikler.slice(0, 30).map((e) => html`<tr><td><a class="link" href="#/firmalar/${e.f.id}">${e.f.name}</a></td><td>${PERSONEL_TURU[e.tur]}</td><td class="num">%${sayi(e.pay)}</td><td class="num">${sureMetni(e.bos)}</td></tr>`)}</tbody></table></div>`
          : html`<p class="pad muted">Tüm müşteri firmalarda uzman ve hekim payı %100 görevlendirilmiş.</p>`}</section>`;
  }

  return {
    baslik: 'Kapasite analizi', altBaslik: 'Teorik yük ve fiilî süreye göre uzman ve hekim doluluk oranları',
    govde: html`<section class="card"><label class="select-inline" for="kap-ay"><span class="muted">Ay</span>
        <select id="kap-ay">${aySecenekleri().map((a) => html`<option value="${a}" ${a === durum.ay ? html`selected` : ''}>${ayAdi(a)}</option>`)}</select></label></section>
      <div id="kap-icerik">${icerik()}</div>`,
    mount(kok) {
      kok.querySelector('#kap-ay').addEventListener('change', async (e) => {
        durum.ay = e.target.value;
        try { zaman = await app.api.listTimeEntries(durum.ay, ayBitisi(durum.ay)); kok.querySelector('#kap-icerik').innerHTML = icerik().s; } catch (err) { toast(humanError(err), 'hata'); }
      });
    },
  };
}
