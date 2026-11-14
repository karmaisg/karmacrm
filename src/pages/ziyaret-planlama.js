// OSGB 360 - Operasyon > Ziyaret planlama: firmalar Google Haritası'nda, aylık uzman/hekim ziyaret takibi, ziyaret planı ve rota.
// Harita ayrı bir çerçevede (harita.html) çalışır; mantık: lib/ziyaret.js
import { html, bugun, tarih, ayBasi, ayAdi } from '../lib/format.js';
import { icon } from '../ui/icons.js';
import { pill, emptyState, field, checkbox, openFormModal, confirmDialog, toast } from '../ui/components.js';
import { PERSONEL_TURU, PERSONEL_TURU_KISA, ayBitisi } from '../lib/operasyon.js';
import { humanError } from '../lib/api.js';
import {
  ZIYARET_TURLERI, ROTA_AZAMI_DURAK, OZET_ETIKETI, DURUM_ETIKETI, OZET_RENGI, adresSorgusu, ayZiyaretDurumlari, ziyaretSatirlari, filtrele, ayrikDegerler, rotaBaglantisi,
} from '../lib/ziyaret.js';

const KONUM_PILL = { guncel: ['Konum var', 'success'], eski: ['Adres değişti', 'warning'], yok: ['Konum yok', 'warning'], 'adres-eksik': ['Adres eksik', 'neutral'] };
const DURUM_TONU = { yapildi: 'success', planli: 'info', bekliyor: 'warning', gerekmez: 'neutral' };
const OZET_TONU = { tamam: 'success', kismi: 'warning', eksik: 'danger', gerekmez: 'neutral' };
const bekle = (ms) => new Promise((r) => setTimeout(r, ms));

export async function ziyaretPlanlamaSayfasi(app) {
  const bugunStr = bugun();
  const durum = { ay: ayBasi(bugunStr), filtre: { il: '', ilce: '', gorevli: '', ozet: '', konum: '', ara: '' }, secili: new Set(), duzelt: null };
  const planlayabilir = app.can('time', 'create');
  const ayarlaraGidebilir = app.can('settings', 'view');

  const [firmalar, personel, atamalar, anahtar] = await Promise.all([
    app.api.listCompanies(), app.api.listEmployees().catch(() => []), app.api.listAssignments().catch(() => []), app.api.getMapsKey().catch(() => undefined),
  ]);
  // İlk yüklemede tablo yoksa (42_asama41.sql çalıştırılmadı) planlar undefined döner; sonraki yüklemelerde hata gösterilir.
  const ayYukle = async (ay, ilk = false) => {
    const [z, p] = await Promise.all([app.api.listTimeEntries(ay, ayBitisi(ay)).catch((e) => { if (ilk) return []; throw e; }), app.api.listVisitPlans(ay, ayBitisi(ay)).catch((e) => { if (ilk) return undefined; throw e; })]);
    return { zamanlar: z, planlar: p };
  };
  let { zamanlar, planlar } = await ayYukle(durum.ay, true);
  const kurulu = planlar !== undefined;            // 42_asama41.sql çalıştırıldı mı
  if (!kurulu) planlar = [];
  const haritaVar = !!anahtar;

  const aySecenekleri = () => {
    const [y, mo] = bugunStr.split('-').map(Number); const l = [];
    for (let i = -1; i < 12; i += 1) { const t = new Date(y, mo - 1 - i, 1); l.push(`${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-01`); }
    return l;
  };
  const personelAdi = new Map(personel.map((p) => [p.id, p.full_name]));
  const firmaById = new Map(firmalar.map((f) => [f.id, f]));
  const hesap = () => {
    const durumlar = ayZiyaretDurumlari({ firmalar, atamalar, personel, zamanlar, planlar, ayBasi: durum.ay });
    const hepsi = ziyaretSatirlari({ firmalar, durumlar });
    return { durumlar, hepsi, gorunen: filtrele(hepsi, durum.filtre) };
  };
  let h = hesap();
  const yenidenHesapla = () => { h = hesap(); };

  // ---------------------------------------------------------------- görünüm parçaları
  const turHucre = (s, t) => {
    const x = s.turler[t];
    const alt = [x.gorevliler.join(', '), x.durum === 'yapildi' && x.sonZiyaret ? `son: ${tarih(x.sonZiyaret)}` : '', x.planlar.length ? `plan: ${x.planlar.map((p) => tarih(p.planned_date).slice(0, 5)).join(', ')}` : ''].filter(Boolean).join(' · ');
    return html`${pill(DURUM_ETIKETI[x.durum], DURUM_TONU[x.durum])}${alt ? html`<small class="block muted">${alt}</small>` : (x.gerekli ? '' : html`<small class="block muted">görevli yok</small>`)}`;
  };
  const ozetKartlari = () => {
    const say = (o) => h.hepsi.filter((s) => s.ozet === o).length; const konumsuz = h.hepsi.filter((s) => ['yok', 'eski'].includes(s.konum)).length;
    return html`<div class="chip-row" id="zp-ozet-ser">
      ${['tamam', 'kismi', 'eksik', 'gerekmez'].map((o) => html`<span class="chip"><span class="zp-dot zp-dot-${o}"></span> ${OZET_ETIKETI[o]} <span class="chip-n">${say(o)}</span></span>`)}
      <span class="chip">Konumu olmayan <span class="chip-n" id="zp-konumsuz-sayi">${konumsuz}</span></span></div>`;
  };
  const tablo = () => {
    if (!h.hepsi.length) return emptyState({ simge: 'pin', baslik: 'Aktif müşteri firma yok', metin: 'Firmalar eklendikçe burada ve haritada görünür.' });
    if (!h.gorunen.length) return emptyState({ simge: 'pin', baslik: 'Süzgece uyan firma yok', metin: 'Filtreleri değiştirin.' });
    const secildi = (id) => durum.secili.has(id);
    return html`<div class="table-wrap"><table class="table" id="zp-tablo"><thead><tr>
      <th scope="col"><input type="checkbox" id="zp-hepsini-sec" aria-label="Görünen tüm firmaları seç"></th><th scope="col">Firma</th><th scope="col">Konum</th><th scope="col">Uzman</th><th scope="col">Hekim</th><th scope="col" class="hide-sm">Ay özeti</th><th scope="col"><span class="sr-only">İşlem</span></th></tr></thead><tbody>
      ${h.gorunen.map((s) => { const k = KONUM_PILL[s.konum]; return html`<tr data-firma="${s.firma.id}">
        <td><input type="checkbox" data-sec="${s.firma.id}" aria-label="${s.firma.name} seç" ${secildi(s.firma.id) ? html`checked` : ''}></td>
        <td><a class="link" href="#/firmalar/${s.firma.id}">${s.firma.name}</a><small class="block muted">${[s.firma.district, s.firma.city].filter(Boolean).join(', ') || 'Adres bilgisi yok'}</small></td>
        <td>${pill(k[0], k[1])}</td><td>${turHucre(s, 'is_guvenligi_uzmani')}</td><td>${turHucre(s, 'isyeri_hekimi')}</td>
        <td class="hide-sm">${pill(OZET_ETIKETI[s.ozet], OZET_TONU[s.ozet])}</td>
        <td class="actions">${haritaVar && s.konum !== 'adres-eksik' ? html`<button type="button" class="btn btn-secondary btn-sm" data-haritada="${s.firma.id}" title="Haritada göster">${icon('pin', 16)}</button>` : ''}
          ${planlayabilir && kurulu ? html`<button type="button" class="btn btn-secondary btn-sm" data-planla-firma="${s.firma.id}">Planla</button>` : ''}</td></tr>`; })}</tbody></table></div>`;
  };
  const seciliBar = () => {
    const n = durum.secili.size;
    return html`<div class="pad zp-bar" id="zp-secim-bar" ${n ? '' : html`hidden`}>
      <strong id="zp-secim-sayi">${n} firma seçildi</strong>
      ${planlayabilir && kurulu ? html`<button type="button" class="btn btn-primary btn-sm" id="zp-planla">${icon('calendar', 16)} Ziyaret planla</button>` : ''}
      <button type="button" class="btn btn-secondary btn-sm" id="zp-rota">${icon('pin', 16)} Rota aç (Google Haritalar)</button>
      <button type="button" class="btn btn-secondary btn-sm" id="zp-temizle">Seçimi temizle</button></div>`;
  };
  const planKarti = () => {
    const liste = planlar.filter((p) => !p.archived_at).sort((a, b) => a.planned_date.localeCompare(b.planned_date));
    const yapildi = (p) => (h.durumlar.get(p.company_id)?.turler[p.staff_type]?.durum === 'yapildi');
    return html`<section class="card card-flush" id="zp-plan-karti"><div class="card-head"><div><h2 class="card-title">Planlanan ziyaretler · ${ayAdi(durum.ay)}</h2>
      <p class="card-sub">Ziyaret yapıldığında "Zaman ve ziyaret takibi"ne firma ziyareti olarak girilen kayıt, o ayın uzman/hekim ziyaretini "Yapıldı" yapar.</p></div></div>
      ${!kurulu ? html`<div class="notice notice-info" role="note">Ziyaret planı için Supabase'de <strong>42_asama41.sql</strong> dosyasını çalıştırın.</div>`
        : liste.length ? html`<div class="table-wrap"><table class="table" id="zp-plan-tablo"><thead><tr><th scope="col">Tarih</th><th scope="col">Firma</th><th scope="col">Ziyaret</th><th scope="col" class="hide-sm">Personel</th><th scope="col">Durum</th><th scope="col" class="hide-sm">Not</th><th scope="col"><span class="sr-only">İşlem</span></th></tr></thead><tbody>
          ${liste.map((p) => html`<tr data-plan="${p.id}"><td>${tarih(p.planned_date)}</td><td><a class="link" href="#/firmalar/${p.company_id}">${firmaById.get(p.company_id)?.name ?? 'Firma'}</a></td>
            <td>${PERSONEL_TURU[p.staff_type]}</td><td class="hide-sm">${personelAdi.get(p.employee_id) ?? html`<span class="muted">—</span>`}</td>
            <td>${yapildi(p) ? pill('Yapıldı', 'success') : (p.planned_date < bugunStr ? pill('Tarihi geçti', 'warning') : pill('Planlandı', 'info'))}</td><td class="hide-sm muted">${p.note ?? ''}</td>
            <td class="actions">${planlayabilir ? html`<button type="button" class="btn btn-secondary btn-sm" data-plan-sil="${p.id}" aria-label="Planı sil">${icon('trash', 16)}</button>` : ''}</td></tr>`)}</tbody></table></div>`
        : html`<p class="pad muted">Bu ay için planlanmış ziyaret yok. Tablodan firma seçip "Ziyaret planla"yı kullanın.</p>`}</section>`;
  };
  const haritaKart = () => !haritaVar
    ? html`<section class="card pad" id="zp-harita-yok"><div class="notice notice-info" role="note">Harita için Google Haritalar anahtarı gerekir. ${ayarlaraGidebilir ? html`<a class="link" href="#/ayarlar">Sistem ayarlarından</a> anahtarı girin` : 'Anahtarı sistem yöneticiniz Sistem ayarları sayfasından girer'}; o zamana kadar bu sayfa liste olarak çalışır.</div></section>`
    : html`<section class="card card-flush" id="zp-harita-karti"><div class="card-head"><div><h2 class="card-title">Harita</h2>
        <p class="card-sub"><span class="zp-dot zp-dot-tamam"></span> Tamamlandı <span class="zp-dot zp-dot-kismi"></span> Kısmen <span class="zp-dot zp-dot-eksik"></span> Ziyaret bekliyor <span class="zp-dot zp-dot-gerekmez"></span> Beklenen ziyaret yok</p></div>
        ${planlayabilir && kurulu ? html`<div class="action-row"><button type="button" class="btn btn-secondary btn-sm" id="zp-konum-bul">${icon('pin', 16)} Konumları bul <span class="chip-n" id="zp-bulunacak">0</span></button>
          <button type="button" class="btn btn-secondary btn-sm" id="zp-konum-dur" hidden>Durdur</button></div>` : ''}</div>
      <p class="fine pad" id="zp-ilerleme" role="status" hidden></p><div class="notice notice-info" role="note" id="zp-duzelt-bar" hidden></div><div class="notice notice-info" role="alert" id="zp-harita-hata" hidden></div>
      <div id="zp-konum-sonuc"></div>
      <div class="zp-harita"><iframe id="zp-cerceve" src="harita.html" title="Firma haritası" loading="eager"></iframe></div></section>`;

  const filtreSecenek = (liste, deger, bos) => html`<option value="">${bos}</option>${liste.map(([v, e]) => html`<option value="${v}" ${v === deger ? html`selected` : ''}>${e}</option>`)}`;
  const ilceler = () => ayrikDegerler(firmalar.filter((f) => !durum.filtre.il || (f.city ?? '').trim() === durum.filtre.il), 'district');
  const gorevliler = () => personel.filter((p) => p.staff_type && p.is_active !== false).sort((a, b) => a.full_name.localeCompare(b.full_name, 'tr'));

  return {
    baslik: 'Ziyaret planlama', altBaslik: 'Firmalar harita üzerinde; aylık uzman ve hekim ziyaretlerini planlayın ve takip edin',
    govde: html`${kurulu ? '' : html`<div class="notice notice-info" role="note" id="zp-kurulu-degil">Ziyaret planlama için Supabase'de <strong>42_asama41.sql</strong> dosyasını çalıştırın. O zamana kadar firmalar ve ay durumu görüntülenir, konum ve plan kaydedilemez.</div>`}
      <section class="card"><div class="toolbar">
        <label class="select-inline"><span class="muted">Ay</span><select id="zp-ay">${aySecenekleri().map((a) => html`<option value="${a}" ${a === durum.ay ? html`selected` : ''}>${ayAdi(a)}</option>`)}</select></label>
        <label class="select-inline"><span class="sr-only">İl</span><select id="zp-il">${filtreSecenek(ayrikDegerler(firmalar, 'city').map((x) => [x, x]), '', 'Tüm iller')}</select></label>
        <label class="select-inline"><span class="sr-only">İlçe</span><select id="zp-ilce">${filtreSecenek(ilceler().map((x) => [x, x]), '', 'Tüm ilçeler')}</select></label>
        <label class="select-inline"><span class="sr-only">Görevli</span><select id="zp-gorevli">${filtreSecenek(gorevliler().map((p) => [p.id, `${PERSONEL_TURU_KISA[p.staff_type]} · ${p.full_name}`]), '', 'Tüm görevliler')}</select></label>
        <label class="select-inline"><span class="sr-only">Ay özeti</span><select id="zp-ozet">${filtreSecenek(Object.entries(OZET_ETIKETI), '', 'Tüm durumlar')}</select></label>
        <label class="select-inline"><span class="sr-only">Konum</span><select id="zp-konum"><option value="">Konum: tümü</option><option value="var">Konumu olanlar</option><option value="yok">Konumu olmayanlar</option></select></label>
        <label class="search-field">${icon('search', 18)}<span class="sr-only">Ara</span><input type="search" id="zp-ara" placeholder="Firma veya adres ara" autocomplete="off"></label></div>
        <div class="pad" id="zp-ozet-kok">${ozetKartlari()}</div></section>
      ${haritaKart()}
      <section class="card card-flush"><div class="card-head"><div><h2 class="card-title">Firmalar <span class="chip-n" id="zp-firma-sayi">${h.gorunen.length}</span></h2>
        <p class="card-sub">Her ay uzman ve hekim ziyareti beklenir (o ay görevlendirmesi olan türler). Yapılan ziyaret "Zaman ve ziyaret takibi"nden gelir.</p></div></div>
        <div id="zp-secim-kok">${seciliBar()}</div><div id="zp-tablo-kok">${tablo()}</div></section>
      <div id="zp-plan-kok">${planKarti()}</div>`,

    mount(kok) {
      const $ = (s) => kok.querySelector(s);
      const cerceve = $('#zp-cerceve');
      let hazir = false; let konumBulunuyor = false; let durdur = false; const bekleyenler = new Map();
      const mesaj = (m) => { cerceve?.contentWindow?.postMessage(m, window.location.origin); };

      // ---- harita işaretleri
      const isaretListesi = () => h.gorunen.filter((s) => s.firma.latitude != null && s.firma.longitude != null).map((s) => {
        const f = s.firma; const satir = (t) => { const x = s.turler[t]; return `${PERSONEL_TURU_KISA[t]}: ${x.gerekli || x.durum !== 'gerekmez' ? DURUM_ETIKETI[x.durum] : 'görevli yok'}${x.gorevliler.length ? ` (${x.gorevliler.join(', ')})` : ''}`; };
        return { id: f.id, baslik: f.name, adres: [f.address, f.district, f.city].filter(Boolean).join(', '), enlem: Number(f.latitude), boylam: Number(f.longitude), renk: OZET_RENGI[s.ozet],
          secili: durum.secili.has(f.id), satirlar: [OZET_ETIKETI[s.ozet], ...ZIYARET_TURLERI.map(satir)], planlanabilir: planlayabilir && kurulu, duzeltilebilir: planlayabilir && kurulu };
      });
      const haritayiGuncelle = (sigdir = false) => { if (hazir) mesaj({ t: 'isaretler', liste: isaretListesi(), sigdir }); };
      const bulunacaklar = () => h.hepsi.filter((s) => ['yok', 'eski'].includes(s.konum) && adresSorgusu(s.firma));
      const sayaclar = () => {
        const b = $('#zp-bulunacak'); if (b) b.textContent = String(bulunacaklar().length);
        const dugme = $('#zp-konum-bul'); if (dugme) dugme.disabled = konumBulunuyor || !hazir || bulunacaklar().length === 0;
      };

      // ---- yeniden çizim
      const cizListe = () => {
        $('#zp-ozet-kok').innerHTML = ozetKartlari().s; $('#zp-tablo-kok').innerHTML = tablo().s; $('#zp-secim-kok').innerHTML = seciliBar().s;
        $('#zp-firma-sayi').textContent = String(h.gorunen.length); $('#zp-plan-kok').innerHTML = planKarti().s; sayaclar();
      };
      const cizSecim = () => { $('#zp-secim-kok').innerHTML = seciliBar().s; };
      const tumunuGuncelle = (sigdir) => { yenidenHesapla(); cizListe(); haritayiGuncelle(sigdir); };

      // ---- iframe ile konuşma
      const hataGoster = (m) => { const e = $('#zp-harita-hata'); if (e) { e.textContent = m; e.hidden = false; } };
      const konumKaydet = async (firma, enlem, boylam, kaynak) => {
        const sorgu = adresSorgusu(firma);
        const g = await app.api.saveCompanyLocation({ company: firma.id, enlem, boylam, sorgu, kaynak });
        Object.assign(firma, { latitude: g.latitude, longitude: g.longitude, geo_query: g.geo_query, geo_source: g.geo_source, geo_at: g.geo_at });
      };
      const duzeltBari = (firma) => {
        const bar = $('#zp-duzelt-bar'); if (!bar) return;
        if (!firma) { bar.hidden = true; bar.textContent = ''; return; }
        bar.innerHTML = html`<strong>${firma.name}</strong>: iğneyi doğru yere sürükleyin; bıraktığınızda konum kaydedilir. <button type="button" class="btn btn-secondary btn-sm" id="zp-duzelt-bitti">Bitti</button>`.s; bar.hidden = false;
      };
      const mesajAl = async (e) => {
        if (!document.body.contains(cerceve)) { window.removeEventListener('message', mesajAl); return; }
        if (e.origin !== window.location.origin || e.source !== cerceve.contentWindow) return;
        const m = e.data; if (!m || typeof m.t !== 'string') return;
        if (m.t === 'cerceve') { if (anahtar) mesaj({ t: 'baslat', anahtar }); }
        else if (m.t === 'hazir') { hazir = true; haritayiGuncelle(true); sayaclar(); }
        else if (m.t === 'hata') hataGoster(m.mesaj);
        else if (m.t === 'sec') { if (durum.secili.has(m.id)) durum.secili.delete(m.id); else durum.secili.add(m.id); tumunuGuncelle(false); }
        else if (m.t === 'planla') { const f = firmaById.get(m.id); if (f) planFormu([f.id]); }
        else if (m.t === 'duzelt') { const f = firmaById.get(m.id); if (f) { durum.duzelt = f.id; mesaj({ t: 'duzelt', id: f.id }); duzeltBari(f); } }
        else if (m.t === 'tasindi') {
          const f = firmaById.get(m.id); if (!f || !planlayabilir) return;
          try { await konumKaydet(f, m.enlem, m.boylam, 'manuel'); toast(`${f.name} konumu kaydedildi.`); yenidenHesapla(); cizListe(); }
          catch (err) { toast(humanError(err), 'hata'); }
        } else if (m.t === 'bulundu' || m.t === 'bulunamadi') { const r = bekleyenler.get(m.id); if (r) { bekleyenler.delete(m.id); r(m); } }
      };
      window.addEventListener('message', mesajAl);

      // ---- konumları bul (sırayla; Google istek sınırına takılmamak için aralıklı)
      async function konumlariBul() {
        if (konumBulunuyor || !hazir) return;
        const liste = bulunacaklar(); if (!liste.length) return;
        konumBulunuyor = true; durdur = false; sayaclar();
        const il = $('#zp-ilerleme'); il.hidden = false; $('#zp-konum-dur').hidden = false;
        const sonuc = { bulundu: 0, yaklasik: [], bulunamayan: [], hata: 0 };
        for (let i = 0; i < liste.length && !durdur; i += 1) {
          const f = liste[i].firma; il.textContent = `Konum bulunuyor… ${i + 1} / ${liste.length} · ${f.name}`;
          const yanit = await new Promise((coz) => { bekleyenler.set(f.id, coz); mesaj({ t: 'bul', id: f.id, sorgu: adresSorgusu(f) }); setTimeout(() => { if (bekleyenler.delete(f.id)) coz({ t: 'bulunamadi', durum: 'ZAMAN_ASIMI' }); }, 15000); });
          if (yanit.t === 'bulundu') {
            try { await konumKaydet(f, yanit.enlem, yanit.boylam, 'google'); sonuc.bulundu += 1; if (yanit.kesinlik === 'dusuk') sonuc.yaklasik.push(f.name); } catch (err) { sonuc.hata += 1; toast(humanError(err), 'hata'); break; }
          } else sonuc.bulunamayan.push(f.name);
          await bekle(150);
        }
        konumBulunuyor = false; il.hidden = true; $('#zp-konum-dur').hidden = true;
        yenidenHesapla(); cizListe(); haritayiGuncelle(true);
        const par = (baslik, adlar) => (adlar.length ? html`<p><strong>${baslik}</strong> ${adlar.slice(0, 12).join(', ')}${adlar.length > 12 ? ` ve ${adlar.length - 12} firma daha` : ''}</p>` : '');
        $('#zp-konum-sonuc').innerHTML = html`<div class="notice notice-info" role="status" id="zp-sonuc-kutu"><p><strong>${sonuc.bulundu}</strong> firmanın konumu bulundu${durdur ? ' (işlem durduruldu)' : ''}.</p>
          ${par('Yaklaşık konum (ilçe/mahalle düzeyi — doğrusunu iğneyi sürükleyerek düzeltebilirsiniz):', sonuc.yaklasik)}${par('Adres bulunamadı (adresi tamamlayın ya da haritada elle işaretleyin):', sonuc.bulunamayan)}</div>`.s;
        toast(`${sonuc.bulundu} konum bulundu${sonuc.bulunamayan.length ? `, ${sonuc.bulunamayan.length} bulunamadı` : ''}.`);
      }

      // ---- ziyaret planı formu
      function planFormu(idler) {
        const firmaListesi = idler.map((id) => firmaById.get(id)).filter(Boolean); if (!firmaListesi.length) return;
        openFormModal({
          baslik: 'Ziyaret planla', altBaslik: firmaListesi.length === 1 ? firmaListesi[0].name : `${firmaListesi.length} firma`,
          govde: html`${field({ ad: 'planned_date', etiket: 'Ziyaret tarihi', tur: 'date', zorunlu: true, deger: bugunStr, tam: true })}
            ${checkbox({ ad: 'tur_uzman', etiket: 'İş güvenliği uzmanı ziyareti', isaretli: true })}${checkbox({ ad: 'tur_hekim', etiket: 'İşyeri hekimi ziyareti', isaretli: true })}
            ${field({ ad: 'note', etiket: 'Not (isteğe bağlı)', tur: 'textarea', tam: true, maksUzunluk: 500 })}
            <p class="fine field-full">Personel, o türde firmada tek görevli varsa otomatik atanır; birden fazlaysa atanmadan kaydedilir.</p>`,
          async onSubmit(fd) {
            const t = String(fd.get('planned_date') ?? ''); const turler = [fd.get('tur_uzman') === '1' && 'is_guvenligi_uzmani', fd.get('tur_hekim') === '1' && 'isyeri_hekimi'].filter(Boolean);
            const hatalar = {}; if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) hatalar.planned_date = 'Ziyaret tarihini seçin.'; if (!turler.length) hatalar.tur_uzman = 'En az bir ziyaret türü seçin.';
            if (Object.keys(hatalar).length) return { errors: hatalar };
            const not = String(fd.get('note') ?? '').trim() || null; const satirlar = []; let atlanan = 0;
            for (const f of firmaListesi) for (const tur of turler) {
              if (planlar.some((p) => !p.archived_at && p.company_id === f.id && p.staff_type === tur && p.planned_date === t)) { atlanan += 1; continue; }
              const idleri = h.durumlar.get(f.id)?.turler[tur].gorevliIdler ?? [];
              satirlar.push({ company_id: f.id, staff_type: tur, employee_id: idleri.length === 1 ? idleri[0] : null, planned_date: t, note: not });
            }
            if (!satirlar.length) return { errors: { planned_date: 'Seçilen tarih ve türler için plan zaten var.' } };
            await app.api.createVisitPlans(satirlar);
            toast(`${satirlar.length} ziyaret planlandı${atlanan ? `, ${atlanan} tanesi zaten vardı` : ''}.`);
          },
          onDone: async () => {
            const g = await ayYukle(durum.ay); if (g.planlar) planlar = g.planlar; zamanlar = g.zamanlar; durum.secili.clear(); tumunuGuncelle(false);
          },
        });
      }

      // ---- olaylar
      kok.addEventListener('change', async (e) => {
        const t = e.target;
        if (t.id === 'zp-ay') {
          durum.ay = t.value; durum.secili.clear();
          try { const g = await ayYukle(durum.ay); zamanlar = g.zamanlar; planlar = g.planlar ?? []; tumunuGuncelle(false); } catch (err) { toast(humanError(err), 'hata'); }
        } else if (['zp-il', 'zp-ilce', 'zp-gorevli', 'zp-ozet', 'zp-konum'].includes(t.id)) {
          const alan = { 'zp-il': 'il', 'zp-ilce': 'ilce', 'zp-gorevli': 'gorevli', 'zp-ozet': 'ozet', 'zp-konum': 'konum' }[t.id]; durum.filtre[alan] = t.value;
          if (t.id === 'zp-il') { durum.filtre.ilce = ''; $('#zp-ilce').innerHTML = filtreSecenek(ilceler().map((x) => [x, x]), '', 'Tüm ilçeler').s; }
          tumunuGuncelle(true);
        } else if (t.dataset?.sec) {
          if (t.checked) durum.secili.add(t.dataset.sec); else durum.secili.delete(t.dataset.sec); cizSecim(); haritayiGuncelle(false);
        } else if (t.id === 'zp-hepsini-sec') {
          for (const s of h.gorunen) { if (t.checked) durum.secili.add(s.firma.id); else durum.secili.delete(s.firma.id); }
          $('#zp-tablo-kok').innerHTML = tablo().s; cizSecim(); haritayiGuncelle(false);
        }
      });
      let araZamani = null;
      kok.addEventListener('input', (e) => {
        if (e.target.id !== 'zp-ara') return;
        durum.filtre.ara = e.target.value; clearTimeout(araZamani); araZamani = setTimeout(() => { yenidenHesapla(); $('#zp-tablo-kok').innerHTML = tablo().s; $('#zp-firma-sayi').textContent = String(h.gorunen.length); haritayiGuncelle(false); }, 150);
      });
      kok.addEventListener('click', async (e) => {
        const x = e.target;
        if (x.closest('#zp-konum-bul')) { konumlariBul(); return; }
        if (x.closest('#zp-konum-dur')) { durdur = true; return; }
        if (x.closest('#zp-duzelt-bitti')) { durum.duzelt = null; mesaj({ t: 'duzelt', id: null }); duzeltBari(null); haritayiGuncelle(false); return; }
        if (x.closest('#zp-temizle')) { durum.secili.clear(); cizListe(); haritayiGuncelle(false); return; }
        if (x.closest('#zp-planla')) { planFormu([...durum.secili]); return; }
        if (x.closest('#zp-rota')) {
          const r = rotaBaglantisi([...durum.secili].map((id) => firmaById.get(id)).filter(Boolean));
          if (!r.url) { toast('Seçilen firmaların hiçbirinin konumu yok. Önce "Konumları bul"u kullanın.', 'hata'); return; }
          window.open(r.url, '_blank', 'noopener');
          if (r.atlanan) toast(`Rota ${r.kullanilan.length} durakla açıldı; ${r.atlanan} firma konumsuz olduğu veya en fazla ${ROTA_AZAMI_DURAK} durak sığdığı için dışarıda kaldı.`, 'bilgi');
          return;
        }
        const pf = x.closest('[data-planla-firma]'); if (pf) { planFormu([pf.dataset.planlaFirma]); return; }
        const hr = x.closest('[data-haritada]');
        if (hr) {
          const f = firmaById.get(hr.dataset.haritada); if (!f) return;
          if (!hazir) { toast('Harita henüz hazır değil.', 'bilgi'); return; }
          if (f.latitude != null) { $('#zp-cerceve').scrollIntoView({ block: 'center' }); mesaj({ t: 'odak', id: f.id }); return; }
          if (!planlayabilir || !kurulu) { toast('Bu firmanın konumu yok. "Konumları bul" ile bulabilirsiniz.', 'bilgi'); return; }
          durum.duzelt = f.id; $('#zp-cerceve').scrollIntoView({ block: 'center' }); mesaj({ t: 'yerlestir', id: f.id, baslik: f.name }); duzeltBari(f); return;
        }
        const ps = x.closest('[data-plan-sil]');
        if (ps) {
          if (!(await confirmDialog({ baslik: 'Planı sil', onayEtiketi: 'Sil', tehlikeli: true, mesaj: 'Bu ziyaret planı kaldırılır (kayıt arşivlenir). Yapılmış ziyaret kayıtları etkilenmez.' }))) return;
          try { await app.api.archiveVisitPlan(ps.dataset.planSil); planlar = planlar.filter((p) => p.id !== ps.dataset.planSil); toast('Plan silindi.'); tumunuGuncelle(false); } catch (err) { toast(humanError(err), 'hata'); }
        }
      });
      sayaclar();
    },
  };
}
