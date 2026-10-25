// OSGB 360 - Firmalar listesi ve firma formu.
import {
  html, raw, bugun, ayBasi, icerir, trSirala, sayi, TEHLIKE, TEHLIKE_SIRASI, MUSTERI_DURUMU, safeUrl,
} from '../lib/format.js';
import { icon } from '../ui/icons.js';
import {
  avatar, pill, emptyState, field, openFormModal, confirmDialog, toast, sayfalama,
} from '../ui/components.js';
import {
  profilleriGrupla, guncelProfil, vergiNoNormalize, bosIseNull, epostaGecerli, telefonGecerli, webGecerli, mukerrerFirmalar,
} from '../lib/veri.js';

const SAYFA_BASI = 25;

export const tehlikePill = (sinif) => (sinif
  ? html`<span class="pill pill-sev${TEHLIKE_SIRASI.indexOf(sinif) + 1}">${TEHLIKE[sinif]}</span>`
  : html`<span class="muted">—</span>`);

export function durumPill(firma) {
  if (firma.archived_at) return pill('Arşivde', 'warning');
  return firma.customer_status === 'eski_musteri' ? pill(MUSTERI_DURUMU.eski_musteri, 'neutral') : pill(MUSTERI_DURUMU.musteri, 'success');
}

export async function firmalarSayfasi(app) {
  const [firmalar, profiller, uyeler] = await Promise.all([
    app.api.listCompanies(),
    app.api.listAllProfiles(),
    app.api.listOrgMembers().catch(() => []),
  ]);
  const bugunStr = bugun();
  const profilHaritasi = profilleriGrupla(profiller);
  const uyeAdi = new Map(uyeler.map((u) => [u.id, u.full_name]));
  const guncel = new Map(firmalar.map((f) => [f.id, guncelProfil(profilHaritasi.get(f.id), bugunStr)]));
  const olusturabilir = app.can('companies', 'create');

  const durum = { filtre: 'tumu', q: '', alan: 'ad', yon: 1, sayfa: 1 };

  const sayilar = {
    tumu: firmalar.filter((f) => !f.archived_at).length,
    musteri: firmalar.filter((f) => !f.archived_at && f.customer_status === 'musteri').length,
    eski: firmalar.filter((f) => !f.archived_at && f.customer_status === 'eski_musteri').length,
    arsiv: firmalar.filter((f) => f.archived_at).length,
  };

  const SUTUNLAR = [
    { id: 'ad', ad: 'Firma' },
    { id: 'sektor', ad: 'Sektör', sinif: 'hide-md' },
    { id: 'tehlike', ad: 'Tehlike sınıfı' },
    { id: 'calisan', ad: 'Çalışan', sinif: 'num' },
    { id: 'konum', ad: 'Konum', sinif: 'hide-md' },
    { id: 'sorumlu', ad: 'Sorumlu', sinif: 'hide-lg' },
    { id: 'durum', ad: 'Durum', sirasiz: true },
  ];

  const anahtar = {
    ad: (f) => f.name,
    sektor: (f) => f.sector ?? '',
    tehlike: (f) => TEHLIKE_SIRASI.indexOf(guncel.get(f.id)?.hazard_class) ,
    calisan: (f) => guncel.get(f.id)?.employee_count ?? -1,
    konum: (f) => `${f.city ?? ''} ${f.district ?? ''}`,
    sorumlu: (f) => uyeAdi.get(f.responsible_user) ?? '',
  };

  function filtrele() {
    let liste = firmalar.filter((f) => {
      if (durum.filtre === 'arsiv') return !!f.archived_at;
      if (f.archived_at) return false;
      if (durum.filtre === 'musteri') return f.customer_status === 'musteri';
      if (durum.filtre === 'eski') return f.customer_status === 'eski_musteri';
      return true;
    });
    const q = durum.q.trim();
    if (q) {
      liste = liste.filter((f) => [f.name, f.tax_no, f.sector, f.city, f.district, f.phone, f.email].some((d) => d && icerir(d, q)));
    }
    const k = anahtar[durum.alan];
    liste.sort((a, b) => {
      const x = k(a), y = k(b);
      const sonuc = typeof x === 'number' && typeof y === 'number' ? x - y : trSirala(x, y);
      return (sonuc || trSirala(a.name, b.name)) * durum.yon;
    });
    return liste;
  }

  function satir(f) {
    const p = guncel.get(f.id);
    return html`<tr>
      <td><a class="cell-main" href="#/firmalar/${f.id}">${avatar(f.name)}<span><strong>${f.name}</strong>${f.tax_no ? html`<small>${f.tax_no}</small>` : ''}</span></a></td>
      <td class="hide-md">${f.sector || html`<span class="muted">—</span>`}</td>
      <td>${tehlikePill(p?.hazard_class)}</td>
      <td class="num">${p ? sayi(p.employee_count) : html`<span class="muted">—</span>`}</td>
      <td class="hide-md">${[f.city, f.district].filter(Boolean).join(' / ') || html`<span class="muted">—</span>`}</td>
      <td class="hide-lg">${uyeAdi.get(f.responsible_user) || html`<span class="muted">—</span>`}</td>
      <td>${durumPill(f)}</td>
    </tr>`;
  }

  function tablo() {
    const liste = filtrele();
    const sayfaSayisi = Math.max(1, Math.ceil(liste.length / SAYFA_BASI));
    durum.sayfa = Math.min(durum.sayfa, sayfaSayisi);
    const gorunen = liste.slice((durum.sayfa - 1) * SAYFA_BASI, durum.sayfa * SAYFA_BASI);

    if (!firmalar.length) {
      return emptyState({
        simge: 'building', baslik: 'Henüz firma eklenmedi',
        metin: 'Müşteri firmalarınızı ekleyin. Çalışan sayısı ve tehlike sınıfı girildiğinde teorik hizmet süresi otomatik hesaplanır.',
        eylem: olusturabilir ? html`<button type="button" class="btn btn-primary" data-action="yeni-firma">${icon('plus', 18)} İlk firmayı ekle</button>` : '',
      });
    }
    if (!liste.length) {
      return emptyState({
        simge: 'search', baslik: 'Eşleşen firma yok',
        metin: durum.q ? `"${durum.q}" aramasıyla eşleşen firma bulunamadı.` : 'Bu filtrede firma yok.',
        eylem: durum.q ? html`<button type="button" class="btn btn-secondary" data-action="aramayi-temizle">Aramayı temizle</button>` : '',
      });
    }
    return html`<div class="table-wrap"><table class="table">
      <thead><tr>${SUTUNLAR.map((s) => html`<th scope="col" class="${s.sinif ?? ''}" ${s.sirasiz ? '' : html`aria-sort="${durum.alan === s.id ? (durum.yon === 1 ? 'ascending' : 'descending') : 'none'}"`}>
        ${s.sirasiz ? s.ad : html`<button type="button" class="th-btn" data-sirala="${s.id}">${s.ad}${durum.alan === s.id ? icon(durum.yon === 1 ? 'chevronD' : 'chevronD', 14, durum.yon === 1 ? '' : 'flip') : ''}</button>`}
      </th>`)}</tr></thead>
      <tbody>${gorunen.map(satir)}</tbody>
    </table></div>
    ${sayfalama({ sayfa: durum.sayfa, sayfaSayisi, toplam: liste.length, sayfaBasi: SAYFA_BASI })}`;
  }

  const filtreler = [
    ['tumu', 'Tümü'], ['musteri', 'Müşteri'], ['eski', 'Eski müşteri'], ['arsiv', 'Arşivli'],
  ];
  const pillerHtml = () => html`${filtreler.map(([id, ad]) => html`<button type="button" class="chip ${durum.filtre === id ? 'chip-on' : ''}" data-filtre="${id}" aria-pressed="${durum.filtre === id}">${ad} <span class="chip-n">${sayilar[id]}</span></button>`)}`;

  return {
    baslik: 'Firmalar',
    altBaslik: 'Müşteri kartları, çalışan sayısı ve tehlike sınıfı geçmişi',
    eylemler: olusturabilir ? html`<button type="button" class="btn btn-primary" data-action="yeni-firma">${icon('plus', 18)} Yeni firma</button>` : '',
    govde: html`<section class="card card-flush">
      <div class="toolbar">
        <div class="search-field">${icon('search', 18)}<input type="search" id="firma-ara" placeholder="Firma, vergi no, sektör veya il ara" aria-label="Firmalarda ara" autocomplete="off"></div>
        <div class="chips" id="firma-filtre" role="group" aria-label="Firma filtresi">${pillerHtml()}</div>
      </div>
      <div id="firma-tablo">${tablo()}</div>
    </section>`,
    mount(kok) {
      const tabloEl = kok.querySelector('#firma-tablo');
      const ara = kok.querySelector('#firma-ara');
      const yenile = () => { tabloEl.innerHTML = tablo().s; };
      ara.addEventListener('input', () => { durum.q = ara.value; durum.sayfa = 1; yenile(); });
      kok.querySelector('#firma-filtre').addEventListener('click', (e) => {
        const d = e.target.closest('[data-filtre]');
        if (!d) return;
        durum.filtre = d.dataset.filtre; durum.sayfa = 1;
        kok.querySelector('#firma-filtre').innerHTML = pillerHtml().s;
        yenile();
      });
      kok.addEventListener('click', (e) => {
        const s = e.target.closest('[data-sirala]');
        if (s) {
          const id = s.dataset.sirala;
          if (durum.alan === id) durum.yon *= -1; else { durum.alan = id; durum.yon = 1; }
          yenile(); tabloEl.querySelector(`[data-sirala="${id}"]`)?.focus(); return;
        }
        const sf = e.target.closest('[data-sayfa]');
        if (sf && !sf.disabled) { durum.sayfa = Number(sf.dataset.sayfa); yenile(); tabloEl.scrollIntoView({ block: 'start' }); return; }
        if (e.target.closest('[data-action="yeni-firma"]')) firmaFormuAc(app);
        if (e.target.closest('[data-action="aramayi-temizle"]')) { ara.value = ''; durum.q = ''; yenile(); ara.focus(); }
      });
    },
  };
}

// ---------------------------------------------------------------- firma formu
export async function firmaFormuAc(app, { firma = null } = {}) {
  const duzenle = firma !== null;
  let uyeler = [];
  let tum = [];
  try {
    [uyeler, tum] = await Promise.all([app.api.listOrgMembers().catch(() => []), app.api.listCompanies().catch(() => [])]);
  } catch { /* alt kontroller sunucuda da yapılır */ }

  const uyeSecenekleri = [{ deger: '', etiket: 'Atanmamış' }].concat(
    uyeler.filter((u) => u.is_active || u.id === firma?.responsible_user).map((u) => ({ deger: u.id, etiket: u.is_active ? u.full_name : `${u.full_name} (pasif)` })),
  );
  const v = (k) => firma?.[k] ?? '';

  const govde = html`
    ${field({ ad: 'name', etiket: 'Firma adı', deger: v('name'), zorunlu: true, tam: true, maksUzunluk: 200, otomatik: 'organization' })}
    ${field({ ad: 'tax_no', etiket: 'Vergi numarası veya kurum tanımlayıcısı', deger: v('tax_no'), inputmode: 'numeric', maksUzunluk: 30, ipucu: 'Vergi no 10, TC kimlik no 11 haneli olur. Aynı numaralı ikinci aktif firma açılamaz.' })}
    ${field({ ad: 'sector', etiket: 'Sektör', deger: v('sector'), maksUzunluk: 100 })}
    ${field({ ad: 'city', etiket: 'İl', deger: v('city'), maksUzunluk: 60 })}
    ${field({ ad: 'district', etiket: 'İlçe', deger: v('district'), maksUzunluk: 60 })}
    ${field({ ad: 'address', etiket: 'Adres', deger: v('address'), tam: true, maksUzunluk: 300 })}
    ${field({ ad: 'phone', etiket: 'Telefon', tur: 'tel', deger: v('phone'), otomatik: 'tel', maksUzunluk: 25 })}
    ${field({ ad: 'email', etiket: 'E-posta', tur: 'email', deger: v('email'), maksUzunluk: 120 })}
    ${field({ ad: 'website', etiket: 'Web sitesi', deger: v('website'), yerTutucu: 'www.firma.com', maksUzunluk: 200 })}
    ${field({ ad: 'current_provider', etiket: 'Mevcut OSGB (biliniyorsa)', deger: v('current_provider'), maksUzunluk: 120 })}
    ${field({ ad: 'customer_status', etiket: 'Müşteri durumu', deger: firma?.customer_status ?? 'musteri', secenekler: [{ deger: 'musteri', etiket: 'Müşteri' }, { deger: 'eski_musteri', etiket: 'Eski müşteri' }] })}
    ${field({ ad: 'responsible_user', etiket: 'Sorumlu kullanıcı', deger: v('responsible_user'), secenekler: uyeSecenekleri })}
    ${field({ ad: 'notes', etiket: 'Notlar', tur: 'textarea', deger: v('notes'), tam: true, maksUzunluk: 2000 })}
    ${duzenle ? '' : html`<div class="form-section field-full">
      <h3>Hizmet ihtiyacı <span class="muted">(isteğe bağlı)</span></h3>
      <p class="form-section-sub">Çalışan sayısı ve tehlike sınıfını şimdi girerseniz teorik hizmet süresi hemen hesaplanır. Sonradan "Çalışan sayısı" sekmesinden de eklenebilir.</p>
    </div>
    ${field({ ad: 'employee_count', etiket: 'Çalışan sayısı', tur: 'number', min: 0, adim: 1, inputmode: 'numeric' })}
    ${field({ ad: 'hazard_class', etiket: 'Tehlike sınıfı', deger: '', secenekler: [{ deger: '', etiket: 'Seçiniz' }].concat(TEHLIKE_SIRASI.map((k) => ({ deger: k, etiket: TEHLIKE[k] }))) })}
    ${field({ ad: 'valid_from', etiket: 'Geçerlilik başlangıcı', tur: 'date', deger: ayBasi(bugun()), ipucu: 'Bu bilgi hangi tarihten itibaren geçerli? Ay içinde eklenen firmanın o ayki süresi hesaplansın diye varsayılan, ayın ilk günüdür.' })}`}`;

  let yeniId = null;

  openFormModal({
    baslik: duzenle ? 'Firma bilgilerini düzenle' : 'Yeni firma',
    altBaslik: duzenle ? firma.name : 'Müşteri kartı oluşturun',
    govde, boyut: 'lg', gonderEtiketi: duzenle ? 'Değişiklikleri kaydet' : 'Firmayı oluştur',
    async onSubmit(fd) {
      const g = (k) => String(fd.get(k) ?? '').trim();
      const hatalar = {};
      const ad = g('name');
      if (!ad) hatalar.name = 'Firma adı zorunludur.';
      const eposta = g('email');
      if (eposta && !epostaGecerli(eposta)) hatalar.email = 'Geçerli bir e-posta adresi yazın.';
      const tel = g('phone');
      if (tel && !telefonGecerli(tel)) hatalar.phone = 'Telefon numarasında yalnızca rakam, boşluk, + ( ) - kullanın (en az 7 rakam).';
      const web = g('website');
      if (web && !webGecerli(web)) hatalar.website = 'Geçerli bir web adresi yazın (örn. www.firma.com).';
      let profil = null;
      if (!duzenle) {
        const sayiMetni = g('employee_count');
        if (sayiMetni !== '') {
          if (!/^\d{1,7}$/.test(sayiMetni)) hatalar.employee_count = 'Çalışan sayısı 0 veya daha büyük bir tam sayı olmalıdır.';
          if (!g('hazard_class')) hatalar.hazard_class = 'Çalışan sayısı girildiyse tehlike sınıfı da seçilmelidir.';
          if (!/^\d{4}-\d{2}-\d{2}$/.test(g('valid_from'))) hatalar.valid_from = 'Geçerlilik başlangıç tarihini seçin.';
          if (!hatalar.employee_count && !hatalar.hazard_class && !hatalar.valid_from) {
            profil = { calisanSayisi: Number(sayiMetni), tehlike: g('hazard_class'), baslangic: g('valid_from') };
          }
        } else if (g('hazard_class')) {
          hatalar.employee_count = 'Tehlike sınıfı seçildiyse çalışan sayısı da girilmelidir.';
        }
      }
      if (Object.keys(hatalar).length) return { errors: hatalar };

      const vergi = vergiNoNormalize(g('tax_no'));
      const m = mukerrerFirmalar(tum, { vergiNo: vergi, ad, kendiId: firma?.id ?? null });
      if (m.vergiNoAktif) return { errors: { tax_no: `Bu numara "${m.vergiNoAktif.name}" firmasında kayıtlı.` } };
      if (m.vergiNoArsiv && !(await confirmDialog({
        baslik: 'Arşivde aynı numaralı firma var', onayEtiketi: 'Yine de kaydet',
        mesaj: `"${m.vergiNoArsiv.name}" firması aynı vergi numarasıyla arşivde duruyor. Bunu yeni bir kayıt olarak eklemek istiyor musunuz?`,
      }))) return { kal: true };
      if (m.adAktif && !(await confirmDialog({
        baslik: 'Aynı adda firma var', onayEtiketi: 'Yine de kaydet',
        mesaj: `"${m.adAktif.name}" adında aktif bir firma zaten kayıtlı. Yine de kaydedilsin mi?`,
      }))) return { kal: true };

      const degerler = {
        name: ad, tax_no: bosIseNull(vergi), sector: bosIseNull(g('sector')), city: bosIseNull(g('city')),
        district: bosIseNull(g('district')), address: bosIseNull(g('address')), phone: bosIseNull(tel),
        email: bosIseNull(eposta), website: bosIseNull(web), current_provider: bosIseNull(g('current_provider')),
        customer_status: g('customer_status') || 'musteri', responsible_user: bosIseNull(g('responsible_user')),
        notes: bosIseNull(g('notes')),
      };
      if (duzenle) {
        await app.api.updateCompany(firma.id, degerler);
        toast('Firma bilgileri güncellendi.');
      } else {
        const yeni = await app.api.createCompany(degerler, profil);
        yeniId = yeni.id;
        toast('Firma oluşturuldu.');
      }
      app.aramaOnbellegiTemizle();
    },
    onDone: () => (yeniId ? app.git(`firmalar/${yeniId}`) : app.yenile()),
  });
}

export const webBaglantisi = (w) => safeUrl(w);
export { raw };
