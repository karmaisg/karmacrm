// OSGB 360 - Aylık gelir (fatura) Excel'i: ayrıştırma, firma eşleştirme, KDV ayrıştırma, unutulan fatura kontrolü.
// Saf fonksiyonlardır (ağ/DOM yok); tarayıcıda ve testlerde aynı çalışır.
import { trKucukAscii, adayFirmalar, adAnahtari, ESIK } from './katip.js';

export const AYLAR = ['ocak', 'subat', 'mart', 'nisan', 'mayis', 'haziran', 'temmuz', 'agustos', 'eylul', 'ekim', 'kasim', 'aralik'];
const AY_ADI = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
export const donemEtiketi = (d) => (d ? `${AY_ADI[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}` : '—');
export const KDV_TOLERANS = 0.05;
const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

/** Hücre -> sayı ("1.234,50" ve "1234.5" dahil). Boş/anlamsız -> null. */
export function sayiOku(h) {
  if (typeof h === 'number') return Number.isFinite(h) ? h : null;
  if (typeof h !== 'string') return null;
  let s = h.replace(/[^\d,.\-]/g, ''); if (!s) return null;
  if (s.includes(',') && s.includes('.')) s = s.lastIndexOf(',') > s.lastIndexOf('.') ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  else if (s.includes(',')) s = s.replace(',', '.');
  const n = Number(s); return Number.isFinite(n) ? n : null;
}

/** Fatura tarihi hücresi -> "YYYY-MM-DD" ("2026-10-22T00:00:00", "22.10.2026", "22/10/2026"). */
export function tarihOku(h) {
  if (typeof h !== 'string') return null;
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(h.trim());
  if (!m) { const t = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/.exec(h.trim()); if (t) m = [null, t[3], t[2].padStart(2, '0'), t[1].padStart(2, '0')]; }
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3] ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

function aySecimi(metin) {
  const t = trKucukAscii(metin).replace(/[^a-z ]+/g, ' ').split(/\s+/).filter(Boolean);
  return t.map((x) => AYLAR.indexOf(x)).filter((i) => i >= 0);
}
function yilBul(ay, faturaTarihi) {
  const y = +faturaTarihi.slice(0, 4); const m = +faturaTarihi.slice(5, 7);
  return ay > m + 6 ? y - 1 : (ay < m - 6 ? y + 1 : y);
}

/** "Alfa Gıda (Ekim)" -> { ad, donem: 'YYYY-MM-01'|null, donemNotu: null|'aralik'|'yok' } */
export function aciklamaAyristir(aciklama, faturaTarihi) {
  let ad = String(aciklama ?? '').replace(/\s+/g, ' ').trim(); let aylar = []; let bulundu = false;
  for (const par of ad.matchAll(/\(([^()]*)\)/g)) {
    const a = aySecimi(par[1]);
    if (a.length) { aylar = a; bulundu = true; ad = `${ad.slice(0, par.index)} ${ad.slice(par.index + par[0].length)}`.replace(/\s+/g, ' '); break; }
  }
  if (!bulundu) {
    const son = /[\s-]+([A-Za-zÇĞİÖŞÜçğıöşüÂâÎîÛû]+)\s*$/.exec(ad);
    if (son) { const a = aySecimi(son[1]); if (a.length === 1) { aylar = a; bulundu = true; ad = ad.slice(0, son.index); } }
  }
  ad = ad.replace(/[\s\-–,;:]+$/g, '').replace(/^[\s\-–]+/, '').trim();
  const fm = faturaTarihi ? faturaTarihi.slice(0, 7) + '-01' : null;
  if (!bulundu) return { ad, donem: fm, donemNotu: 'yok' };
  if (aylar.length > 1) return { ad, donem: null, donemNotu: 'aralik' };
  const yil = faturaTarihi ? yilBul(aylar[0] + 1, faturaTarihi) : new Date().getFullYear();
  return { ad, donem: `${yil}-${String(aylar[0] + 1).padStart(2, '0')}-01`, donemNotu: null };
}

/** Bir faturanın KDV'si: Excel'deki KDV TUTARLARI esastır; oran tutardan türetilir. */
export function kalemleriCoz({ ucret, k20, k10, toplam }) {
  const uyari = []; const kalemler = [];
  const haricGirdi = r2(ucret ?? 0); const a20 = r2(k20 ?? 0); const a10 = r2(k10 ?? 0);
  if (a20 > 0 && a10 > 0) {
    let b20 = r2(a20 / 0.2); let b10 = r2(a10 / 0.1); const fark = r2(haricGirdi - b20 - b10);
    if (Math.abs(fark) > 0 && Math.abs(fark) <= KDV_TOLERANS) { if (b20 >= b10) b20 = r2(b20 + fark); else b10 = r2(b10 + fark); }
    else if (Math.abs(fark) > KDV_TOLERANS) uyari.push(`%20 ve %10 KDV tutarlarından bulunan matrah (${r2(b20 + b10)}) Ücret sütunuyla (${haricGirdi}) uyuşmuyor`);
    kalemler.push({ oran: 20, haric: b20, kdv: a20 }, { oran: 10, haric: b10, kdv: a10 });
  } else if (a20 > 0 || a10 > 0) {
    const kdv = a20 > 0 ? a20 : a10; const sutun = a20 > 0 ? 20 : 10; const diger = sutun === 20 ? 10 : 20;
    const oranlar = [sutun, diger];
    const uyan = oranlar.find((o) => Math.abs(r2(kdv / (o / 100)) - haricGirdi) <= KDV_TOLERANS);
    if (uyan === sutun) kalemler.push({ oran: sutun, haric: haricGirdi, kdv });
    else if (uyan === diger) { kalemler.push({ oran: diger, haric: haricGirdi, kdv }); uyari.push(`KDV %${sutun} sütununa yazılmış ama tutar %${diger}'a uyuyor; %${diger} olarak alındı`); }
    else {
      const oran = haricGirdi > 0 ? r2((kdv / haricGirdi) * 100) : 0;
      kalemler.push({ oran, haric: haricGirdi, kdv }); uyari.push(`KDV tutarı %${sutun} veya %${diger} ile uyuşmuyor (etkin oran %${oran}); kontrol edin`);
    }
  } else {
    kalemler.push({ oran: 0, haric: haricGirdi, kdv: 0 });
    if (toplam != null && r2(toplam) - haricGirdi > KDV_TOLERANS) uyari.push('KDV sütunları boş ama Toplam, Ücret\'ten büyük');
  }
  const haric = r2(kalemler.reduce((t, k) => t + k.haric, 0)); const kdv = r2(kalemler.reduce((t, k) => t + k.kdv, 0));
  if (toplam != null && Math.abs(r2(haric + kdv) - r2(toplam)) > KDV_TOLERANS) uyari.push(`Ücret + KDV (${r2(haric + kdv)}) Toplam sütunundan (${r2(toplam)}) farklı`);
  return { kalemler, haric, kdv, toplam: r2(haric + kdv), ortOran: haric > 0 ? r2((kdv / haric) * 100) : 0, uyari };
}

const baslikAnahtari = (h) => trKucukAscii(h ?? '').replace(/[^a-z0-9% ]+/g, ' ').replace(/\s+/g, ' ').trim();

/** Excel tablosu -> { satirlar, hatalar }. satirlar[i].kalemler her KDV oranı için ayrı kalem içerir. */
export function gelirSatirlari(tablo) {
  const bi = tablo.findIndex((s) => { const k = (s ?? []).map(baslikAnahtari); return k.some((x) => x.includes('fatura no')) && k.some((x) => x.includes('aciklama')); });
  if (bi < 0) return { satirlar: [], hatalar: ['Başlık satırı bulunamadı. Şablondaki gibi "Fatura No", "Fatura Tarihi", "Açıklama", "Ücret", "%20 KDV", "%10 KDV", "Toplam" sütunları olmalıdır.'] };
  const k = tablo[bi].map(baslikAnahtari); const bul = (f) => k.findIndex(f);
  const c = {
    no: bul((x) => x.includes('fatura no')), tarih: bul((x) => x.includes('tarih')), aciklama: bul((x) => x.includes('aciklama')),
    ucret: bul((x) => x.startsWith('ucret') || x.startsWith('tutar') || x.includes('kdv haric')),
    k20: bul((x) => x.includes('20')), k10: bul((x) => x.includes('10')), toplam: bul((x) => x.startsWith('toplam') || x.includes('genel')),
  };
  const eksik = ['tarih', 'ucret'].filter((a) => c[a] < 0);
  if (eksik.length) return { satirlar: [], hatalar: [`Eksik sütun: ${eksik.map((a) => ({ tarih: 'Fatura Tarihi', ucret: 'Ücret' }[a])).join(', ')}`] };
  const satirlar = []; const hatalar = [];
  for (let i = bi + 1; i < tablo.length; i++) {
    const s = tablo[i] ?? []; const dolu = s.some((h) => h !== null && h !== undefined && String(h).trim() !== '');
    if (!dolu) continue;
    const excelSatir = i + 1;
    const no = c.no >= 0 && s[c.no] != null && String(s[c.no]).trim() ? String(s[c.no]).trim() : null;
    const aciklama = String(s[c.aciklama] ?? '').trim(); const ucret = sayiOku(s[c.ucret]);
    if (!aciklama && ucret == null) continue;
    const tarih = tarihOku(s[c.tarih]);
    if (!tarih) { hatalar.push(`Satır ${excelSatir}${no ? ` (${no})` : ''}: fatura tarihi okunamadı`); continue; }
    if (!aciklama) { hatalar.push(`Satır ${excelSatir}${no ? ` (${no})` : ''}: açıklama boş`); continue; }
    if (!(ucret > 0)) { hatalar.push(`Satır ${excelSatir}${no ? ` (${no})` : ''}: Ücret sıfırdan büyük bir sayı değil`); continue; }
    const ay = aciklamaAyristir(aciklama, tarih);
    const kd = kalemleriCoz({ ucret, k20: c.k20 >= 0 ? sayiOku(s[c.k20]) : 0, k10: c.k10 >= 0 ? sayiOku(s[c.k10]) : 0, toplam: c.toplam >= 0 ? sayiOku(s[c.toplam]) : null });
    const uyarilar = [...kd.uyari];
    if (ay.donemNotu === 'aralik') uyarilar.push('Açıklamada birden çok ay var; hizmet dönemi boş bırakıldı');
    if (ay.donemNotu === 'yok') uyarilar.push('Açıklamada ay yok; dönem olarak fatura ayı alındı');
    if (!ay.ad) { hatalar.push(`Satır ${excelSatir}: açıklamada firma adı yok`); continue; }
    satirlar.push({ satir: excelSatir, no, tarih, aciklama, ad: ay.ad, anahtar: adAnahtari(ay.ad) || trKucukAscii(ay.ad), donem: ay.donem, donemNotu: ay.donemNotu,
      kalemler: kd.kalemler, haric: kd.haric, kdv: kd.kdv, toplam: kd.toplam, ortOran: kd.ortOran, uyarilar });
  }
  const gorulen = new Map();
  for (const s of satirlar) { if (!s.no) continue; if (gorulen.has(s.no)) { s.uyarilar.push(`Aynı fatura numarası dosyada satır ${gorulen.get(s.no)} ile tekrar ediyor`); s.tekrar = true; } else gorulen.set(s.no, s.satir); }
  return { satirlar, hatalar };
}

/** Dosya geneli KDV özeti (toplam + oran kırılımı + ortalama). */
export function kdvOzeti(satirlar) {
  const o = { adet: satirlar.length, haric: 0, kdv: 0, toplam: 0, ortOran: 0, oranlar: {} };
  for (const s of satirlar) for (const k of s.kalemler) { o.haric += k.haric; o.kdv += k.kdv; const r = (o.oranlar[k.oran] ??= { haric: 0, kdv: 0 }); r.haric = r2(r.haric + k.haric); r.kdv = r2(r.kdv + k.kdv); }
  o.haric = r2(o.haric); o.kdv = r2(o.kdv); o.toplam = r2(o.haric + o.kdv); o.ortOran = o.haric > 0 ? r2((o.kdv / o.haric) * 100) : 0;
  return o;
}

// ------------------------------------------------------------------ firma eşleştirme
/**
 * Her benzersiz ad (anahtar) için bir öneri üretir.
 * durum: 'kayitli' (daha önce onaylanmış takma ad) | 'isyeri' (işyeri takma adı/adı) | 'tam' (firma adı aynı) | 'guclu' | 'olasi' | 'yok'
 * Yalnızca 'olasi' ve 'yok' kullanıcı kararı bekler.
 */
export function eslestir(satirlar, { firmalar, siteler = [], aliaslar = [] }) {
  const aktif = firmalar.filter((f) => !f.archived_at);
  const firmaAdi = new Map(firmalar.map((f) => [f.id, f.name]));
  const aliasHarita = new Map(aliaslar.map((a) => [a.alias_key, a]));
  const siteHarita = new Map();
  for (const s of siteler.filter((x) => !x.archived_at)) for (const ad of [s.invoice_alias, s.site_name]) { if (ad) { const a = adAnahtari(ad) || trKucukAscii(ad); if (!siteHarita.has(a)) siteHarita.set(a, s); } }
  const firmaHarita = new Map(); for (const f of aktif) { const a = adAnahtari(f.name) || trKucukAscii(f.name); if (!firmaHarita.has(a)) firmaHarita.set(a, f); }
  const adaylarListesi = [...aktif.map((f) => ({ name: f.name, id: f.id, firma_id: f.id, site_id: null })),
    ...siteler.filter((s) => !s.archived_at && s.invoice_alias).map((s) => ({ name: s.invoice_alias, id: `s:${s.id}`, firma_id: s.company_id, site_id: s.id }))];
  const sonuc = new Map();
  for (const s of satirlar) {
    if (sonuc.has(s.anahtar)) { sonuc.get(s.anahtar).satirlar.push(s.satir); continue; }
    const e = { anahtar: s.anahtar, ad: s.ad, durum: 'yok', firma_id: null, site_id: null, adaylar: [], satirlar: [s.satir] };
    const al = aliasHarita.get(s.anahtar);
    if (al && firmaAdi.has(al.company_id)) { e.durum = 'kayitli'; e.firma_id = al.company_id; e.site_id = al.site_id ?? null; }
    else if (siteHarita.has(s.anahtar)) { const st = siteHarita.get(s.anahtar); e.durum = 'isyeri'; e.firma_id = st.company_id; e.site_id = st.id; }
    else if (firmaHarita.has(s.anahtar)) { e.durum = 'tam'; e.firma_id = firmaHarita.get(s.anahtar).id; }
    else {
      const ad = adayFirmalar(s.ad, adaylarListesi, { sinir: 8 }); const goruldu = new Set();
      e.adaylar = ad.filter((x) => { const f = x.firma.firma_id; if (goruldu.has(f)) return false; goruldu.add(f); return true; }).slice(0, 3)
        .map((x) => ({ firma_id: x.firma.firma_id, site_id: x.firma.site_id, ad: firmaAdi.get(x.firma.firma_id) ?? x.firma.name, skor: Math.round(x.skor * 100) / 100 }));
      if (e.adaylar[0]?.skor >= ESIK.guclu) { e.durum = 'guclu'; e.firma_id = e.adaylar[0].firma_id; e.site_id = e.adaylar[0].site_id; }
      else if (e.adaylar.length) e.durum = 'olasi';
    }
    sonuc.set(s.anahtar, e);
  }
  return [...sonuc.values()];
}

/** Varsayılan kararlar: otomatik eşleşenler 'esle'; olası/yok kullanıcıdan bekler (tur: null). */
export function varsayilanKararlar(eslesmeler) {
  const k = {};
  for (const e of eslesmeler) k[e.anahtar] = e.firma_id ? { tur: 'esle', firma_id: e.firma_id, site_id: e.site_id } : { tur: null };
  return k;
}
export const bekleyenler = (eslesmeler, kararlar) => eslesmeler.filter((e) => !kararlar[e.anahtar]?.tur || (kararlar[e.anahtar].tur === 'yeni' && !String(kararlar[e.anahtar].yeniAd ?? '').trim()) || (kararlar[e.anahtar].tur === 'esle' && !kararlar[e.anahtar].firma_id));

/** Veri tabanına gidecek paket (gelir_aktar). Karar 'yoksay' olan satırlar dışarıda kalır. */
export function gelirPaketi({ satirlar, eslesmeler, kararlar, dosyaAdi, vadeGun = 30 }) {
  const eHarita = new Map(eslesmeler.map((e) => [e.anahtar, e]));
  const yeniFirmalar = new Map(); const faturalar = [];
  for (const s of satirlar) {
    if (s.tekrar) continue;
    const k = kararlar[s.anahtar]; if (!k?.tur || k.tur === 'yoksay') continue;
    const e = eHarita.get(s.anahtar);
    const f = { no: s.no, tarih: s.tarih, donem: s.donem, aciklama: s.aciklama, kalemler: s.kalemler.map((x) => ({ aciklama: s.aciklama, haric: x.haric, oran: x.oran, kdv: x.kdv })) };
    if (k.tur === 'yeni') {
      const ad = String(k.yeniAd).trim(); const anahtar = `y:${trKucukAscii(ad)}`;
      if (!yeniFirmalar.has(anahtar)) yeniFirmalar.set(anahtar, { anahtar, ad });
      f.yeni_firma = anahtar; f.alias_key = s.anahtar; f.alias_text = s.ad;
    } else {
      f.firma_id = k.firma_id; if (k.site_id) f.site_id = k.site_id;
      if (!['kayitli', 'isyeri', 'tam'].includes(e?.durum) || k.firma_id !== e?.firma_id) { f.alias_key = s.anahtar; f.alias_text = s.ad; }
    }
    faturalar.push(f);
  }
  return { dosya: dosyaAdi ?? null, vade_gun: vadeGun, yeni_firmalar: [...yeniFirmalar.values()], faturalar };
}

// ------------------------------------------------------------------ unutulan fatura
const efektifDonem = (i) => (i.service_period ?? `${String(i.invoice_date).slice(0, 7)}-01`);

/**
 * Yüklenen dosyanın ana dönem(ler)i için, o dönemde aktif sözleşmesi olup sistemde de dosyada da faturası bulunmayan firmalar.
 * Ana dönem: satırların en az %20'sini (ve en az 2 satırı) oluşturan dönem.
 */
export function unutulanFaturalar({ satirlar, eslesmeler, kararlar, firmalar, sozlesmeler, faturalar }) {
  const sayac = new Map(); for (const s of satirlar) if (s.donem) sayac.set(s.donem, (sayac.get(s.donem) ?? 0) + 1);
  const ana = [...sayac].filter(([, n]) => n >= 2 && n >= satirlar.length * 0.2).map(([d]) => d).sort();
  if (!ana.length) return { donemler: [], firmalar: [] };
  const eHarita = new Map(eslesmeler.map((e) => [e.anahtar, e]));
  const dosyada = new Map(); // donem -> Set(firma_id)
  for (const s of satirlar) {
    const k = kararlar[s.anahtar]; const fid = k?.tur === 'esle' ? k.firma_id : null; if (!fid || !s.donem) continue;
    if (!dosyada.has(s.donem)) dosyada.set(s.donem, new Set()); dosyada.get(s.donem).add(fid);
    void eHarita;
  }
  const sistemde = new Map();
  for (const i of faturalar) { if (i.archived_at) continue; const d = efektifDonem(i); if (!sistemde.has(d)) sistemde.set(d, new Set()); sistemde.get(d).add(i.company_id); }
  const cikti = [];
  for (const d of ana) {
    const bas = d; const [y, m] = d.split('-').map(Number); const bit = `${y}-${String(m).padStart(2, '0')}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`;
    for (const f of firmalar) {
      if (f.archived_at || f.customer_status !== 'musteri') continue;
      const sozlesme = sozlesmeler.some((c) => c.company_id === f.id && !c.archived_at && ['aktif', 'yenilendi', 'sona_erdi'].includes(c.status) && c.start_date <= bit && c.end_date >= bas);
      if (!sozlesme) continue;
      if (dosyada.get(d)?.has(f.id) || sistemde.get(d)?.has(f.id)) continue;
      cikti.push({ firma_id: f.id, ad: f.name, donem: d });
    }
  }
  cikti.sort((a, b) => a.donem.localeCompare(b.donem) || a.ad.localeCompare(b.ad, 'tr'));
  return { donemler: ana, firmalar: cikti };
}
