// OSGB 360 - İSG-Katip "sözleşme listesi" Excel'inin okunması, işyeri (sicil) gruplama, firma adı eşleştirme,
// önceki yüklemeyle karşılaştırma ve uygulama paketi. Saf fonksiyonlar; arayüz ve veri tabanından bağımsızdır.
// Testler: tests/katip.test.js

// ====================================================================== metin yardımcıları
const TR_ASCII = { ç: 'c', ğ: 'g', ı: 'i', ö: 'o', ş: 's', ü: 'u', â: 'a', î: 'i', û: 'u' };
export const trKucukAscii = (s) => String(s ?? '').replace(/İ/g, 'i').replace(/I/g, 'ı').toLowerCase().replace(/[çğıöşüâîû]/g, (c) => TR_ASCII[c]).normalize('NFD').replace(/[̀-ͯ]/g, '');
const baslikAnahtari = (s) => trKucukAscii(s).replace(/[^a-z0-9/ ]+/g, ' ').replace(/\s+/g, ' ').trim();

// ====================================================================== sütunlar
export const KATIP_SUTUNLARI = [
  { alan: 'sozlesmeId', baslik: 'Sözleşme ID' },
  { alan: 'uygun', baslik: 'Sözleşme Mevzuata Uygun Mu' },
  { alan: 'tc', baslik: 'Görevlendirilen Kişi TC Kimlik No' },
  { alan: 'ad', baslik: 'Görevlendirilen Kişi Ad Soyad', zorunlu: true },
  { alan: 'sertTip', baslik: 'Görevlendirilen Kişi Sertifika Tipi', zorunlu: true },
  { alan: 'sertNo', baslik: 'Görevlendirilen Kişi Sertifika No' },
  { alan: 'dakika', baslik: 'Çalışma Süresi', zorunlu: true },
  { alan: 'unvan', baslik: 'Hizmet Alan İşyeri Unvanı', zorunlu: true },
  { alan: 'sicil', baslik: 'Hizmet Alan İşyeri SGK/DETSİS No', zorunlu: true },
  { alan: 'il', baslik: 'Hizmet Alan İşyeri İli' },
  { alan: 'calisan', baslik: 'Hizmet Alan İşyeri Çalışan Sayısı', zorunlu: true },
  { alan: 'tehlike', baslik: 'Hizmet Alan İşyeri Tehlike Sınıfı', zorunlu: true },
  { alan: 'baslangic', baslik: 'Sözleşme Başlangıç Tarihi' },
  { alan: 'bitis', baslik: 'Sözleşme Bitiş Tarihi' },
  { alan: 'statu', baslik: 'Sözleşme Statüsü' },
  { alan: 'onaylayan', baslik: 'Onaylayan Kişi Ad Soyad' },
];
const ANAHTAR_ALAN = new Map(KATIP_SUTUNLARI.map((s) => [baslikAnahtari(s.baslik), s.alan]));

export const PERSONEL_TURU = { is_guvenligi_uzmani: 'İş güvenliği uzmanı', isyeri_hekimi: 'İşyeri hekimi', diger_saglik: 'Diğer sağlık personeli' };
export const TEHLIKE_ADI = { az_tehlikeli: 'Az tehlikeli', tehlikeli: 'Tehlikeli', cok_tehlikeli: 'Çok tehlikeli' };
const TEHLIKE_SIRA = { az_tehlikeli: 1, tehlikeli: 2, cok_tehlikeli: 3 };
export const enYuksekTehlike = (liste) => liste.reduce((m, t) => (TEHLIKE_SIRA[t] > (TEHLIKE_SIRA[m] ?? 0) ? t : m), null);

export function personelTuru(sertTip) {
  const k = trKucukAscii(sertTip);
  if (k.includes('hekim')) return 'isyeri_hekimi';
  if (k.includes('guvenligi') || k.includes('uzman')) return 'is_guvenligi_uzmani';
  if (k.includes('saglik')) return 'diger_saglik';
  return null;
}
export function tehlikeSinifi(m) {
  const k = trKucukAscii(m);
  if (/\bcok\b/.test(k)) return 'cok_tehlikeli';
  if (/\baz\b/.test(k)) return 'az_tehlikeli';
  if (/tehlikeli/.test(k)) return 'tehlikeli';
  return null;
}

const bosMu = (v) => v === null || v === undefined || String(v).trim() === '';
const metin = (v) => (bosMu(v) ? '' : String(v).replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim());
const tarihGunu = (v) => { const m = /^(\d{4}-\d{2}-\d{2})/.exec(String(v ?? '')) ?? (/^(\d{2})\.(\d{2})\.(\d{4})/.test(String(v ?? '')) ? [null, String(v).replace(/^(\d{2})\.(\d{2})\.(\d{4}).*/, '$3-$2-$1')] : null); return m ? m[1] : null; };

/**
 * Excel satırlarını (ilk satır başlık) okur.
 * @returns {{ hata: string|null, eksikSutunlar: string[], kayitlar: object[], uyarilar: string[], atlanan: number }}
 */
export function katipSatirlari(tablo) {
  const bos = { hata: null, eksikSutunlar: [], kayitlar: [], uyarilar: [], atlanan: 0 };
  if (!Array.isArray(tablo) || tablo.length < 2) return { ...bos, hata: 'Dosyada başlık satırı ve en az bir veri satırı olmalıdır.' };
  const eslesme = new Map(); // sütun no -> alan
  tablo[0].forEach((b, i) => { const a = ANAHTAR_ALAN.get(baslikAnahtari(b)); if (a && ![...eslesme.values()].includes(a)) eslesme.set(i, a); });
  const eksik = KATIP_SUTUNLARI.filter((s) => s.zorunlu && ![...eslesme.values()].includes(s.alan)).map((s) => s.baslik);
  if (eksik.length) return { ...bos, eksikSutunlar: eksik, hata: `Bu dosya İSG-Katip sözleşme listesine benzemiyor. Eksik sütunlar: ${eksik.join(', ')}.` };

  const kayitlar = []; const uyarilar = []; let atlanan = 0;
  for (let i = 1; i < tablo.length; i++) {
    const h = tablo[i] ?? []; if (h.every(bosMu)) continue;
    const r = { satirNo: i + 1 };
    for (const [c, a] of eslesme) r[a] = h[c];
    const unvan = metin(r.unvan); const sicil = metin(r.sicil).replace(/\s+/g, '');
    const hatalar = [];
    if (!unvan) hatalar.push('hizmet alan işyeri unvanı boş');
    if (!/^[0-9A-Za-z]{5,40}$/.test(sicil)) hatalar.push('SGK/DETSİS sicil numarası geçersiz');
    if (typeof r.sicil === 'number') hatalar.push('sicil numarası sayı olarak kaydedilmiş (hane kaybı olabilir); hücreyi metin biçimine çevirin');
    const tur = personelTuru(r.sertTip); if (!tur) hatalar.push(`sertifika tipi tanınmadı (${metin(r.sertTip) || 'boş'})`);
    const th = tehlikeSinifi(r.tehlike); if (!th) hatalar.push(`tehlike sınıfı tanınmadı (${metin(r.tehlike) || 'boş'})`);
    const calisan = Number(r.calisan); if (!Number.isInteger(calisan) || calisan < 0) hatalar.push('çalışan sayısı geçersiz');
    const dk = Number(r.dakika); if (!Number.isFinite(dk) || dk < 0) hatalar.push('çalışma süresi geçersiz');
    const ad = metin(r.ad); if (ad.length < 2) hatalar.push('görevli adı boş');
    if (hatalar.length) { uyarilar.push(`Satır ${r.satirNo}: ${hatalar.join('; ')}. Bu satır aktarılmaz.`); atlanan++; continue; }
    const statu = trKucukAscii(r.statu);
    if (statu && !statu.includes('devam')) { uyarilar.push(`Satır ${r.satirNo}: sözleşme durumu "${metin(r.statu)}" (devam etmiyor); atlandı.`); atlanan++; continue; }
    let tc = bosMu(r.tc) ? null : String(r.tc).replace(/\D/g, '');
    if (tc !== null && tc.length < 11 && tc.length >= 9) tc = tc.padStart(11, '0');
    if (tc !== null && tc.length !== 11) { uyarilar.push(`Satır ${r.satirNo}: TC kimlik numarası 11 hane değil; kaydedilmeyecek.`); tc = null; }
    kayitlar.push({
      satirNo: r.satirNo, sozlesmeId: bosMu(r.sozlesmeId) ? null : String(r.sozlesmeId).replace(/\.0$/, ''), tc, ad, personelTuru: tur, sertTip: metin(r.sertTip), sertNo: metin(r.sertNo) || null,
      dakika: Math.round(dk), unvan, sicil, il: metin(r.il) || null, calisan, tehlike: th, baslangic: tarihGunu(r.baslangic), onaylayan: metin(r.onaylayan) || null,
      uygun: bosMu(r.uygun) ? null : trKucukAscii(r.uygun).startsWith('uygun') && !trKucukAscii(r.uygun).includes('degil'),
    });
  }
  if (!kayitlar.length) return { ...bos, hata: 'Dosyada aktarılabilir sözleşme satırı bulunamadı.', uyarilar, atlanan };
  return { ...bos, kayitlar, uyarilar, atlanan };
}

// ====================================================================== işyerleri (sicil)
const enCok = (liste) => { const s = new Map(); for (const x of liste) s.set(x, (s.get(x) ?? 0) + 1); return [...s.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null; };

/** Satırları sicile göre gruplar. Aynı sicilde çelişen bilgi varsa uyarı üretir (en sık değer kullanılır). */
export function isyerleriniGrupla(kayitlar) {
  const harita = new Map();
  for (const k of kayitlar) { if (!harita.has(k.sicil)) harita.set(k.sicil, []); harita.get(k.sicil).push(k); }
  const isyerleri = []; const uyarilar = [];
  for (const [sicil, satirlar] of harita) {
    const calisan = enCok(satirlar.map((s) => s.calisan)); const tehlike = enCok(satirlar.map((s) => s.tehlike)); const unvan = enCok(satirlar.map((s) => s.unvan));
    if (new Set(satirlar.map((s) => s.calisan)).size > 1) uyarilar.push(`${unvan} (${sicil}): satırlarda farklı çalışan sayıları var (${[...new Set(satirlar.map((s) => s.calisan))].join(', ')}); ${calisan} kullanıldı.`);
    if (new Set(satirlar.map((s) => s.tehlike)).size > 1) uyarilar.push(`${unvan} (${sicil}): satırlarda farklı tehlike sınıfları var; ${TEHLIKE_ADI[tehlike]} kullanıldı.`);
    if (new Set(satirlar.map((s) => s.unvan)).size > 1) uyarilar.push(`${sicil} sicilinde farklı unvanlar var; "${unvan}" kullanıldı.`);
    isyerleri.push({ sicil, unvan, il: enCok(satirlar.map((s) => s.il).filter(Boolean)), calisan, tehlike, onaylayan: enCok(satirlar.map((s) => s.onaylayan).filter(Boolean)), satirlar });
  }
  isyerleri.sort((a, b) => a.unvan.localeCompare(b.unvan, 'tr') || a.sicil.localeCompare(b.sicil));
  return { isyerleri, uyarilar };
}

// ====================================================================== firma adı eşleştirme
const HUKUKI = new Set(['as', 'anonim', 'sirketi', 'sirket', 'limited', 'ltd', 'sti', 'ltdsti', 'koll', 'kollektif', 'sti', 'ticaret', 'tic', 'sanayi', 'san', 've', 'ile', 'ic', 'dis', 'tic', 'a.s', 'ltd.', 'sti.']);
const GENEL = new Set(['turizm', 'gida', 'insaat', 'otomotiv', 'tasimacilik', 'nakliyat', 'nakliye', 'lojistik', 'hizmetleri', 'hizmet', 'danismanlik', 'muhendislik', 'teknik', 'servis',
  'pazarlama', 'yatirim', 'gayrimenkul', 'enerji', 'tekstil', 'saglik', 'egitim', 'tarim', 'hayvancilik', 'metal', 'makine', 'elektrik', 'elektronik', 'bilisim', 'yazilim', 'sistemleri', 'sistem',
  'grup', 'holding', 'ithalat', 'ihracat', 'dagitim', 'depolama', 'organizasyon', 'ozel', 'ticari', 'urunleri', 'malzemeleri', 'yapi', 'dis', 'sitesi', 'otel', 'restoran', 'kafe', 'matbaacilik', 'reklam',
  'tanitim', 'kimya', 'plastik', 'ambalaj', 'mobilya', 'ilac', 'medikal', 'temizlik', 'temizleme', 'kuru', 'oto', 'kiralama', 'insa', 'taahhut', 'madencilik', 'gumruk', 'musavirlik', 'denizcilik']);
const GENEL_AGIRLIK = 0.3;

/** Firma adını eşleştirme için anlamlı sözcüklere ayırır: [{ s: sözcük, w: ağırlık }]. */
export function adSozcukleri(ad) {
  const parcalar = trKucukAscii(ad).replace(/[._\-/\\]+/g, ' ').replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter(Boolean);
  const cikti = [];
  for (let i = 0; i < parcalar.length; i++) {
    const t = parcalar[i];
    if (HUKUKI.has(t)) continue;
    if (t === 'a' && parcalar[i + 1] === 's') { i++; continue; }   // "A.Ş."
    if (t === 'l' && parcalar[i + 1] === 'td') { i++; continue; }
    cikti.push({ s: t, w: GENEL.has(t) ? GENEL_AGIRLIK : 1 });
  }
  if (!cikti.length) return parcalar.map((s) => ({ s, w: 1 }));
  return cikti;
}
export const adAnahtari = (ad) => adSozcukleri(ad).map((x) => x.s).join(' ');

function ciftler(s) { const k = ` ${s} `; const m = new Map(); for (let i = 0; i < k.length - 1; i++) { const c = k.slice(i, i + 2); m.set(c, (m.get(c) ?? 0) + 1); } return m; }
function dice(a, b) {
  if (a === b) return 1; if (a.length < 2 || b.length < 2) return 0;
  const A = ciftler(a); const B = ciftler(b); let ort = 0;
  for (const [c, n] of A) ort += Math.min(n, B.get(c) ?? 0);
  return (2 * ort) / ([...A.values()].reduce((x, y) => x + y, 0) + [...B.values()].reduce((x, y) => x + y, 0));
}
function sozcukBenzerligi(a, b) {
  if (a === b) return 1;
  const k = a.length <= b.length ? a : b; const u = a.length <= b.length ? b : a;
  if (k.length >= 3 && u.startsWith(k)) return 0.9;       // kısaltma: "tem" ~ "temizleme"
  const d = dice(a, b); return d >= 0.8 ? d * 0.95 : 0;   // yazım hatası: "veticaret" ~ "ve ticaret"
}

/** İki firma adı arasındaki benzerlik (0–1). Hukuki ekler yok sayılır; sektör sözcükleri düşük ağırlıklıdır. */
export function adBenzerligi(a, b) {
  const A = adSozcukleri(a); const B = adSozcukleri(b);
  if (!A.length || !B.length) return 0;
  const ka = A.map((x) => x.s).join(' '); const kb = B.map((x) => x.s).join(' ');
  if (ka === kb) return 1;
  const WA = A.reduce((t, x) => t + x.w, 0); const WB = B.reduce((t, x) => t + x.w, 0);
  const kullanilan = new Set(); let eslesen = 0;
  const adaylar = [];
  A.forEach((x, i) => B.forEach((y, j) => { const s = sozcukBenzerligi(x.s, y.s); if (s > 0) adaylar.push({ i, j, s, w: Math.max(x.w, y.w) }); }));
  adaylar.sort((p, q) => q.s * q.w - p.s * p.w);
  const kb2 = new Set();
  for (const c of adaylar) { if (kullanilan.has(c.i) || kb2.has(c.j)) continue; kullanilan.add(c.i); kb2.add(c.j); eslesen += c.s * c.w; }
  const sozcukSkoru = eslesen / Math.max(WA, WB);
  // Marka (ağırlığı yüksek) sözcükleri hiç örtüşmüyorsa yalnızca sektör sözcükleri benzemiştir: eşleşme sayılmaz
  const gucluA = A.filter((x) => x.w === 1); const gucluB = B.filter((x) => x.w === 1);
  if (gucluA.length && gucluB.length && !gucluA.some((x) => gucluB.some((y) => sozcukBenzerligi(x.s, y.s) > 0))) return Math.min(0.4, sozcukSkoru);
  // yazım bozuklukları için bütün dizgenin bigram benzerliği ile yumuşatma
  const bigram = dice(ka.replace(/ /g, ''), kb.replace(/ /g, ''));
  return Math.min(1, Math.max(sozcukSkoru, Math.min(bigram * 0.92, 0.5 + sozcukSkoru / 2)));
}

export const ESIK = { guclu: 0.85, olasi: 0.55 };

/** Bir unvan için sistemdeki firmalar arasında en iyi adaylar. */
export function adayFirmalar(unvan, firmalar, { sinir = 3, alt = ESIK.olasi } = {}) {
  return firmalar.map((f) => ({ firma: f, skor: adBenzerligi(unvan, f.name) }))
    .filter((x) => x.skor >= alt).sort((a, b) => b.skor - a.skor || Number(!!a.firma.archived_at) - Number(!!b.firma.archived_at)).slice(0, sinir);
}

// ====================================================================== birimler ve kararlar
/**
 * Eşleştirme birimleri: aynı unvanlı sicil grupları (kayıtlı eşleşmesi farklı olanlar ayrı birim).
 * Her birimin varsayılan kararı önerilir:
 *  - kayitli:   sicil daha önce bir firmaya bağlanmış (kalıcı eşleşme) -> esle
 *  - esle:      sistemde güçlü eşleşme (>= 0.85) -> esle (soru: hayır, ama listede gösterilir)
 *  - soru:      olası eşleşme (0.55–0.85) veya başka bir Excel unvanıyla benzer -> kullanıcıya sorulur
 *  - yeni:      eşleşme yok -> yeni firma önerilir
 */
export function birimleriHazirla({ isyerleri, firmalar, siteler }) {
  const siteHaritasi = new Map((siteler ?? []).filter((s) => !s.archived_at).map((s) => [s.sgk_no, s]));
  const firmaHaritasi = new Map(firmalar.map((f) => [f.id, f]));
  const gruplar = new Map();
  for (const i of isyerleri) {
    const kayitli = siteHaritasi.get(i.sicil)?.company_id ?? null;
    const anahtar = `${i.unvan}||${kayitli && firmaHaritasi.has(kayitli) ? kayitli : ''}`;
    if (!gruplar.has(anahtar)) gruplar.set(anahtar, { anahtar, unvan: i.unvan, kayitliFirmaId: kayitli && firmaHaritasi.has(kayitli) ? kayitli : null, isyerleri: [] });
    gruplar.get(anahtar).isyerleri.push(i);
  }
  const birimler = [...gruplar.values()].sort((a, b) => a.unvan.localeCompare(b.unvan, 'tr'));
  for (const b of birimler) {
    b.calisan = b.isyerleri.reduce((t, i) => t + i.calisan, 0);
    b.adaylar = b.kayitliFirmaId ? [] : adayFirmalar(b.unvan, firmalar);
    b.karar = null; b.soru = false; b.not = null;
    if (b.kayitliFirmaId) { b.karar = { tip: 'esle', firmaId: b.kayitliFirmaId }; b.not = 'Önceki yüklemeden kayıtlı eşleşme'; continue; }
    const en = b.adaylar[0];
    if (en && en.skor >= ESIK.guclu) { b.karar = { tip: 'esle', firmaId: en.firma.id }; b.not = `Sistemdeki "${en.firma.name}" ile eşleşti (%${Math.round(en.skor * 100)})`; b.soru = en.skor < 0.999; }
    else if (en) { b.karar = { tip: 'esle', firmaId: en.firma.id }; b.soru = true; b.not = `"${en.firma.name}" ile benzer (%${Math.round(en.skor * 100)}): birleştirilsin mi?`; }
    else b.karar = { tip: 'yeni', ad: b.unvan };
  }
  // Excel içinde birbirine benzeyen farklı unvanlar (ör. SETERM TEKNİK / SETERM SERVİS): aynı firmada birleştirme sorusu
  const sistemdeKarari = (b) => b.karar?.tip === 'esle';
  for (let i = 0; i < birimler.length; i++) {
    const b = birimler[i]; if (b.kayitliFirmaId) continue;
    for (let j = 0; j < i; j++) {
      const a = birimler[j]; if (a.kayitliFirmaId || a.karar?.tip === 'birlestir') continue;
      if (a.unvan === b.unvan) continue;
      const skor = adBenzerligi(a.unvan, b.unvan); if (skor < ESIK.olasi) continue;
      if (sistemdeKarari(b) && sistemdeKarari(a) && a.karar.firmaId === b.karar.firmaId) { b.soru = true; b.not = `${b.not ? `${b.not}. ` : ''}Aynı firmaya bağlanıyor: "${a.unvan}" ile birleşecek.`; break; }
      if (b.karar?.tip === 'yeni') { b.karar = { tip: 'birlestir', hedef: a.anahtar }; b.soru = true; b.not = `"${a.unvan}" ile benzer (%${Math.round(skor * 100)}): aynı firmada birleştirilsin mi? (çalışan sayıları toplanır)`; break; }
    }
  }
  return birimler;
}

/** Bir birimin kararını çözer: { tip:'esle', firmaId } | { tip:'yeni', ad, ref } | { tip:'yoksay' } (birlestir zincirlerini izler). */
export function kararCoz(birimler, anahtar, ziyaret = new Set()) {
  const b = birimler.find((x) => x.anahtar === anahtar); if (!b) return { tip: 'yoksay' };
  const k = b.karar ?? { tip: 'yoksay' };
  if (k.tip !== 'birlestir') return k.tip === 'yeni' ? { tip: 'yeni', ad: k.ad || b.unvan, ref: `y:${b.anahtar}` } : k;
  if (ziyaret.has(anahtar)) return { tip: 'yoksay' };
  ziyaret.add(anahtar); return kararCoz(birimler, k.hedef, ziyaret);
}

/** Karar sonucu firma başına özet: hangi işyerleri hangi firmaya gidecek. */
export function firmaOzetleri({ birimler, firmalar }) {
  const ad = new Map(firmalar.map((f) => [f.id, f.name])); const harita = new Map();
  for (const b of birimler) {
    const k = kararCoz(birimler, b.anahtar); if (k.tip === 'yoksay') continue;
    const anahtar = k.tip === 'esle' ? k.firmaId : k.ref;
    if (!harita.has(anahtar)) harita.set(anahtar, { anahtar, firmaId: k.tip === 'esle' ? k.firmaId : null, yeni: k.tip === 'yeni', ad: k.tip === 'esle' ? ad.get(k.firmaId) : k.ad, isyerleri: [], unvanlar: new Set() });
    const o = harita.get(anahtar); o.isyerleri.push(...b.isyerleri); o.unvanlar.add(b.unvan);
  }
  return [...harita.values()].map((o) => ({ ...o, unvanlar: [...o.unvanlar], calisan: o.isyerleri.reduce((t, i) => t + i.calisan, 0), tehlikeler: [...new Set(o.isyerleri.map((i) => i.tehlike))], enYuksek: enYuksekTehlike(o.isyerleri.map((i) => i.tehlike)) }))
    .sort((a, b) => String(a.ad).localeCompare(String(b.ad), 'tr'));
}

// ====================================================================== uyarılar
/** Excel'de karşılığı olmayan, aktif müşteri firmalar (pasife alınabilir). */
export function excelDisiFirmalar({ firmalar, ozetler }) {
  const kullanilan = new Set(ozetler.filter((o) => o.firmaId).map((o) => o.firmaId));
  return firmalar.filter((f) => !f.archived_at && f.customer_status === 'musteri' && !kullanilan.has(f.id)).sort((a, b) => a.name.localeCompare(b.name, 'tr'));
}

/** Önceki yükleme satırlarını ({ sgk_no, ... }) sicile göre işyeri özetine çevirir. */
export function oncekiOzet(satirlar) {
  const h = new Map();
  for (const s of satirlar ?? []) {
    if (!h.has(s.sgk_no)) h.set(s.sgk_no, { sicil: s.sgk_no, unvan: s.site_name, calisan: s.employee_count, tehlike: s.hazard_class, onaylayan: s.approver_name ?? null, kisiler: new Map() });
    const o = h.get(s.sgk_no);
    if (s.approver_name && !o.onaylayan) o.onaylayan = s.approver_name;
    const anahtar = `${s.staff_type}|${s.cert_no || s.person_name}`;
    o.kisiler.set(anahtar, { ad: s.person_name, tur: s.staff_type, dakika: s.minutes_per_month });
  }
  return h;
}

/**
 * Yeni dosya ile önceki yükleme arasındaki değişiklikler.
 * Her öğe: { tur, onem: 'yuksek'|'orta'|'bilgi', sicil, unvan, mesaj }
 */
export function degisiklikler({ isyerleri, onceki }) {
  const eski = onceki instanceof Map ? onceki : oncekiOzet(onceki);
  if (!eski.size) return [];
  const liste = []; const ekle = (tur, onem, i, mesaj) => liste.push({ tur, onem, sicil: i.sicil, unvan: i.unvan, mesaj });
  const yeniSicil = new Set();
  for (const i of isyerleri) {
    yeniSicil.add(i.sicil);
    const o = eski.get(i.sicil);
    if (!o) { ekle('yeni_isyeri', 'orta', i, `Yeni işyeri (önceki yüklemede yok): ${i.calisan} çalışan, ${TEHLIKE_ADI[i.tehlike]}.`); continue; }
    if (o.calisan !== i.calisan) ekle('calisan', 'orta', i, `Çalışan sayısı ${o.calisan} → ${i.calisan}.`);
    if (o.tehlike !== i.tehlike) ekle('tehlike', 'yuksek', i, `Tehlike sınıfı ${TEHLIKE_ADI[o.tehlike]} → ${TEHLIKE_ADI[i.tehlike]} (hizmet süreleri değişir).`);
    if ((o.onaylayan ?? '') !== (i.onaylayan ?? '') && (o.onaylayan || i.onaylayan)) ekle('kisi', 'orta', i, `Firma kişisi (onaylayan) ${o.onaylayan ?? 'yok'} → ${i.onaylayan ?? 'yok'}.`);
    const yeniKisiler = new Map(i.satirlar.map((s) => [`${s.personelTuru}|${s.sertNo || s.ad}`, { ad: s.ad, tur: s.personelTuru, dakika: s.dakika }]));
    for (const tur of ['is_guvenligi_uzmani', 'isyeri_hekimi', 'diger_saglik']) {
      const e = [...o.kisiler.entries()].filter(([, v]) => v.tur === tur); const y = [...yeniKisiler.entries()].filter(([, v]) => v.tur === tur);
      const eAd = (l) => l.map(([, v]) => v.ad).sort((a, b) => a.localeCompare(b, 'tr')).join(', ') || 'yok';
      const ayni = e.length === y.length && e.every(([k]) => yeniKisiler.has(k));
      if (!ayni) ekle('gorevli', 'yuksek', i, `${PERSONEL_TURU[tur]} değişti: ${eAd(e)} → ${eAd(y)}.`);
      else for (const [k, v] of y) { const ev = o.kisiler.get(k); if (ev.dakika !== v.dakika) ekle('sure', 'orta', i, `${PERSONEL_TURU[tur]} ${v.ad}: çalışma süresi ${ev.dakika} → ${v.dakika} dk.`); }
    }
  }
  for (const [sicil, o] of eski) if (!yeniSicil.has(sicil)) liste.push({ tur: 'ayrildi', onem: 'yuksek', sicil, unvan: o.unvan, mesaj: 'Önceki yüklemede vardı, bu dosyada yok (sözleşme bitmiş olabilir).' });
  const sira = { yuksek: 0, orta: 1, bilgi: 2 };
  return liste.sort((a, b) => sira[a.onem] - sira[b.onem] || String(a.unvan).localeCompare(String(b.unvan), 'tr'));
}

/** Firma kartındaki (company_profiles) güncel değerle toplam farkı. */
export function profilFarklari({ ozetler, profilHaritasi }) {
  const liste = [];
  for (const o of ozetler) {
    if (!o.firmaId) continue;
    const p = profilHaritasi.get(o.firmaId); if (!p) continue;
    if (p.employee_count !== o.calisan || p.hazard_class !== o.enYuksek) liste.push({ firmaId: o.firmaId, ad: o.ad, eskiCalisan: p.employee_count, yeniCalisan: o.calisan, eskiTehlike: p.hazard_class, yeniTehlike: o.enYuksek });
  }
  return liste;
}

// ====================================================================== uygulama paketi
/**
 * Veri tabanına gidecek paket (RPC katip_uygula).
 * @param {object} g { donem, dosyaAdi, birimler, firmalar, pasif: string[] (firma id), mevcutKisiler: [{company_id, full_name}] , ozet }
 */
export function uygulamaPaketi({ donem, dosyaAdi, birimler, firmalar, pasif = [], mevcutKisiler = [], ozet = {} }) {
  const yeniFirmalar = new Map(); const isyerleri = []; const satirlar = []; const kisiler = []; const goruldu = new Set();
  const kisiVar = new Set(mevcutKisiler.map((k) => `${k.company_id}|${trKucukAscii(k.full_name)}`));
  for (const b of birimler) {
    const k = kararCoz(birimler, b.anahtar); if (k.tip === 'yoksay') continue;
    if (k.tip === 'yeni' && !yeniFirmalar.has(k.ref)) yeniFirmalar.set(k.ref, { ref: k.ref, ad: k.ad, il: b.isyerleri[0]?.il ?? null });
    const firmaId = k.tip === 'esle' ? k.firmaId : null; const firmaRef = k.tip === 'yeni' ? k.ref : null;
    for (const i of b.isyerleri) {
      isyerleri.push({ sicil: i.sicil, unvan: i.unvan, il: i.il, calisan: i.calisan, tehlike: i.tehlike, firma_id: firmaId, firma_ref: firmaRef });
      for (const s of i.satirlar) {
        satirlar.push({ sicil: i.sicil, sozlesme_id: s.sozlesmeId, tur: s.personelTuru, sertifika_tipi: s.sertTip, sertifika_no: s.sertNo, ad: s.ad, tc: s.tc, dakika: s.dakika, baslangic: s.baslangic, onaylayan: s.onaylayan, uygun: s.uygun });
      }
      if (i.onaylayan) {
        const an = `${firmaId ?? firmaRef}|${trKucukAscii(i.onaylayan)}`;
        if (!goruldu.has(an) && !kisiVar.has(an)) { goruldu.add(an); kisiler.push({ firma_id: firmaId, firma_ref: firmaRef, ad: i.onaylayan }); }
      }
    }
  }
  return { donem, dosya: dosyaAdi, yeni_firmalar: [...yeniFirmalar.values()], isyerleri, satirlar, kisiler, pasif, ozet };
}
