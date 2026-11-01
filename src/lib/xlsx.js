// OSGB 360 - Bağımlılıksız .xlsx okuyucu (yalnızca ilk sayfa, yalnızca değerler).
// Neden kendi okuyucumuz: sıkı içerik güvenlik politikası (CSP) dış betik yüklemeyi kısıtlar; dosya da hiçbir yere gönderilmez, tarayıcıda okunur.
// Zip içindeki "deflate" verisini tarayıcının DecompressionStream'i açar (Node 18+ ve güncel tarayıcılarda vardır).
// Dosya sayfasındaki <dimension> bilgisine güvenilmez (bazı sistemler yanlış yazar); hücreler tek tek okunur.

export const XLSX_BOYUT_SINIRI = 8 * 1024 * 1024; // bayt (sıkıştırılmış)
const ACILMIS_SINIR = 64 * 1024 * 1024;            // "zip bombası" koruması

const u16 = (v, o) => v.getUint16(o, true);
const u32 = (v, o) => v.getUint32(o, true);

async function ac(sikis, yontem, beklenenBoyut) {
  if (yontem === 0) return sikis;
  if (yontem !== 8) throw new Error('Bu dosyadaki sıkıştırma yöntemi desteklenmiyor.');
  if (typeof DecompressionStream !== 'function') throw new Error('Bu tarayıcı Excel dosyasını açamıyor. Güncel bir tarayıcı kullanın.');
  const akis = new Blob([sikis]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  const okuyucu = akis.getReader(); const parcalar = []; let toplam = 0;
  for (;;) {
    const { done, value } = await okuyucu.read(); if (done) break;
    toplam += value.length;
    if (toplam > ACILMIS_SINIR || toplam > beklenenBoyut + 1024) { await okuyucu.cancel(); throw new Error('Dosya beklenenden büyük açılıyor; güvenlik nedeniyle durduruldu.'); }
    parcalar.push(value);
  }
  const s = new Uint8Array(toplam); let o = 0; for (const p of parcalar) { s.set(p, o); o += p.length; }
  return s;
}

/** Zip içindeki dosyaları { ad: () => Promise<Uint8Array> } olarak döndürür. */
export function zipDizini(bayt) {
  const v = new DataView(bayt.buffer, bayt.byteOffset, bayt.byteLength);
  let e = -1;
  for (let i = bayt.length - 22; i >= Math.max(0, bayt.length - 65557); i--) { if (u32(v, i) === 0x06054b50) { e = i; break; } }
  if (e < 0) throw new Error('Bu dosya geçerli bir Excel (.xlsx) dosyası değil.');
  const adet = u16(v, e + 10); let o = u32(v, e + 16);
  const dosyalar = new Map(); const dec = new TextDecoder('utf-8');
  for (let n = 0; n < adet; n++) {
    if (u32(v, o) !== 0x02014b50) throw new Error('Excel dosyasının içi bozuk görünüyor.');
    const yontem = u16(v, o + 10); const csize = u32(v, o + 20); const usize = u32(v, o + 24);
    const ad = dec.decode(bayt.subarray(o + 46, o + 46 + u16(v, o + 28)));
    const yerel = u32(v, o + 42);
    dosyalar.set(ad, async () => {
      if (u32(v, yerel) !== 0x04034b50) throw new Error('Excel dosyasının içi bozuk görünüyor.');
      const bas = yerel + 30 + u16(v, yerel + 26) + u16(v, yerel + 28);
      return ac(bayt.subarray(bas, bas + csize), yontem, usize);
    });
    o += 46 + u16(v, o + 28) + u16(v, o + 30) + u16(v, o + 32);
  }
  return dosyalar;
}

const VARLIKLAR = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const cozum = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, k) => {
  if (k[0] === '#') { const n = k[1].toLowerCase() === 'x' ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10); return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : ''; }
  return VARLIKLAR[k.toLowerCase()] ?? m;
});
const metinler = (xml) => { let s = ''; for (const m of xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)) s += m[1]; return cozum(s); };

const sutunNo = (ref) => { let n = 0; for (const c of /^[A-Z]+/.exec(ref)[0]) n = n * 26 + (c.charCodeAt(0) - 64); return n - 1; };
const TARIH_FORMATLARI = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47]);

function tarihStilleri(stilXml) {
  const ozel = new Map();
  for (const m of stilXml.matchAll(/<numFmt\b[^>]*numFmtId="(\d+)"[^>]*formatCode="([^"]*)"/g)) ozel.set(Number(m[1]), m[2]);
  const bolum = /<cellXfs[\s\S]*?<\/cellXfs>/.exec(stilXml)?.[0] ?? '';
  const stiller = [];
  for (const m of bolum.matchAll(/<xf\b[^>]*?numFmtId="(\d+)"/g)) {
    const id = Number(m[1]); const kod = (ozel.get(id) ?? '').replace(/\[[^\]]*\]|"[^"]*"/g, '');
    stiller.push(TARIH_FORMATLARI.has(id) || (ozel.has(id) && /[dy]/i.test(kod)));
  }
  return stiller;
}

/** Excel seri numarasını (1900 sistemi) "YYYY-MM-DDTHH:MM:SS" dizgesine çevirir (saat dilimi uygulanmaz). */
export function excelTarihi(seri) {
  const ms = Math.round((Number(seri) - 25569) * 86400000);
  return new Date(ms).toISOString().slice(0, 19);
}

/** Dosyayı okur: { sayfa, satirlar: [[hücre,...],...] }. Değerler: metin | sayı | boolean | null; tarih hücreleri "YYYY-MM-DDTHH:MM:SS" metni. */
export async function xlsxOku(arabellek) {
  const bayt = arabellek instanceof Uint8Array ? arabellek : new Uint8Array(arabellek);
  if (bayt.length > XLSX_BOYUT_SINIRI) throw new Error('Dosya 8 MB sınırını aşıyor.');
  const dizin = zipDizini(bayt); const dec = new TextDecoder('utf-8');
  const oku = async (ad) => { const f = dizin.get(ad); return f ? dec.decode(await f()) : null; };
  const kitap = await oku('xl/workbook.xml');
  if (!kitap) throw new Error('Bu dosya bir Excel (.xlsx) çalışma kitabı değil. Eski .xls dosyasını Excel\'de .xlsx olarak kaydedin.');
  // ilk sayfa
  const iliskiler = (await oku('xl/_rels/workbook.xml.rels')) ?? '';
  const ilk = /<sheet\b[^>]*?name="([^"]*)"[^>]*?r:id="([^"]+)"/.exec(kitap) ?? /<sheet\b[^>]*?r:id="([^"]+)"[^>]*?name="([^"]*)"/.exec(kitap);
  let yol = 'xl/worksheets/sheet1.xml'; let sayfaAdi = '';
  if (ilk) {
    const [ad, rid] = /name="/.test(ilk[0]) && ilk[0].indexOf('name=') < ilk[0].indexOf('r:id=') ? [ilk[1], ilk[2]] : [ilk[2], ilk[1]];
    sayfaAdi = cozum(ad);
    for (const m of iliskiler.matchAll(/<Relationship\b[^>]*>/g)) {
      if (new RegExp(`Id="${rid}"`).test(m[0])) { const hedef = /Target="([^"]+)"/.exec(m[0])?.[1]; if (hedef) yol = hedef.startsWith('/') ? hedef.slice(1) : `xl/${hedef}`; }
    }
  }
  const sayfa = await oku(yol);
  if (!sayfa) throw new Error('Excel dosyasında okunabilir bir sayfa bulunamadı.');
  const ortak = [];
  const ortakXml = await oku('xl/sharedStrings.xml');
  if (ortakXml) for (const m of ortakXml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)) ortak.push(metinler(m[1]));
  const tarihStili = tarihStilleri((await oku('xl/styles.xml')) ?? '');

  const satirlar = [];
  for (const sm of sayfa.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const satir = [];
    for (const hm of sm[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const oz = hm[1]; const ic = hm[2] ?? '';
      const ref = /\br="([A-Z]+\d+)"/.exec(oz)?.[1]; if (!ref) continue;
      const tip = /\bt="(\w+)"/.exec(oz)?.[1] ?? 'n'; const stil = Number(/\bs="(\d+)"/.exec(oz)?.[1] ?? -1);
      let deger = null;
      if (tip === 'inlineStr') deger = metinler(ic);
      else {
        const v = /<v>([\s\S]*?)<\/v>/.exec(ic)?.[1];
        if (v !== undefined) {
          if (tip === 's') deger = ortak[Number(v)] ?? '';
          else if (tip === 'str' || tip === 'e') deger = cozum(v);
          else if (tip === 'b') deger = v === '1';
          else if (tip === 'd') deger = cozum(v);
          else { const n = Number(v); deger = Number.isFinite(n) ? (tarihStili[stil] ? excelTarihi(n) : n) : cozum(v); }
        }
      }
      satir[sutunNo(ref)] = deger;
    }
    satirlar.push(Array.from(satir, (x) => x ?? null));
  }
  return { sayfa: sayfaAdi, satirlar };
}
