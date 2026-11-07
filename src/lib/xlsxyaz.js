// OSGB 360 - Bağımlılıksız minimal .xlsx yazıcı (boş şablon indirme için). Sıkıştırmasız ("stored") zip üretir.
// Hücre değeri: metin | sayı | null | { t: 'tarih', v: 'YYYY-MM-DD' } | { kalin: true, v: metin }
const kodlayici = new TextEncoder();

const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
export function crc32(bayt) { let c = 0xffffffff; for (let i = 0; i < bayt.length; i++) c = CRC[(c ^ bayt[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }

const xmlKac = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
const sutunHarfi = (i) => { let s = ''; for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s; };
const excelSeri = (iso) => { const [y, m, d] = iso.split('-').map(Number); return Math.round(Date.UTC(y, m - 1, d) / 86400000) + 25569; };

// Adlandırılmış hücre stilleri (cari ekstre gibi biçimli çıktılar için): { st: 'ad', v: değer }
const STIL_NO = { etiket: 4, deger: 5, baslik: 6, tarih: 7, sayi: 8, kirmizi: 9, italik: 10, topSayi: 11, topKirmizi: 12, topEtiket: 13, buyuk: 14, orta: 15, kalin: 1, solKalin: 16 };

function sayfaXml(satirlar, genislikler, birlesik = [], resim = null, satirYuk = {}) {
  const cols = genislikler?.length ? `<cols>${genislikler.map((g, i) => `<col min="${i + 1}" max="${i + 1}" width="${g}" customWidth="1"/>`).join('')}</cols>` : '';
  const govde = satirlar.map((satir, r) => `<row r="${r + 1}"${satirYuk[r] ? ` ht="${satirYuk[r]}" customHeight="1"` : ''}>${satir.map((h, c) => {
    if (h === null || h === undefined) return '';
    const ref = `${sutunHarfi(c)}${r + 1}`;
    if (typeof h === 'object' && h.st) {
      const no = STIL_NO[h.st] ?? 0;
      if (h.v === null || h.v === undefined || h.v === '') return `<c r="${ref}" s="${no}"/>`;
      if (typeof h.v === 'number') return `<c r="${ref}" s="${no}"><v>${h.v}</v></c>`;
      if (h.st === 'tarih') return `<c r="${ref}" s="${no}"><v>${excelSeri(h.v)}</v></c>`;
      return `<c r="${ref}" t="inlineStr" s="${no}"><is><t xml:space="preserve">${xmlKac(h.v)}</t></is></c>`;
    }
    if (h === '') return '';
    if (typeof h === 'number') return `<c r="${ref}" s="3"><v>${h}</v></c>`;
    if (typeof h === 'object' && h.t === 'tarih') return `<c r="${ref}" s="2"><v>${excelSeri(h.v)}</v></c>`;
    const kalin = typeof h === 'object' && h.kalin; const metin = typeof h === 'object' ? h.v : h;
    return `<c r="${ref}" t="inlineStr"${kalin ? ' s="1"' : ''}><is><t xml:space="preserve">${xmlKac(metin)}</t></is></c>`;
  }).join('')}</row>`).join('');
  const bir = birlesik.length ? `<mergeCells count="${birlesik.length}">${birlesik.map((b) => `<mergeCell ref="${b}"/>`).join('')}</mergeCells>` : '';
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>${cols}<sheetData>${govde}</sheetData>${bir}<pageSetup paperSize="9" fitToWidth="1" fitToHeight="0"/>${resim ? '<drawing r:id="rId1"/>' : ''}</worksheet>`;
}

const emu = (px) => Math.round(px * 9525);
const cizimXml = (r) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><xdr:oneCellAnchor><xdr:from><xdr:col>${r.kol}</xdr:col><xdr:colOff>${emu(r.solPx ?? 0)}</xdr:colOff><xdr:row>${r.satir}</xdr:row><xdr:rowOff>${emu(r.ustPx ?? 0)}</xdr:rowOff></xdr:from><xdr:ext cx="${emu(r.genislikPx)}" cy="${emu(r.yukseklikPx)}"/><xdr:pic><xdr:nvPicPr><xdr:cNvPr id="2" name="Logo" descr="Logo"/><xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr></xdr:nvPicPr><xdr:blipFill><a:blip xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:embed="rId1"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill><xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${emu(r.genislikPx)}" cy="${emu(r.yukseklikPx)}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic><xdr:clientData/></xdr:oneCellAnchor></xdr:wsDr>`;

const STIL = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="dd\\.mm\\.yyyy"/></numFmts><fonts count="7"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font><font><b/><i/><sz val="11"/><name val="Calibri"/></font><font><i/><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFE02020"/><name val="Calibri"/></font><font><b/><sz val="14"/><name val="Calibri"/></font><font><sz val="13"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color auto="1"/></left><right style="thin"><color auto="1"/></right><top style="thin"><color auto="1"/></top><bottom style="thin"><color auto="1"/></bottom><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="17"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="14" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="4" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="0" fontId="2" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1"/><xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1"/><xf numFmtId="0" fontId="1" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center"/></xf><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="right"/></xf><xf numFmtId="4" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="4" fontId="4" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/><xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="4" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/><xf numFmtId="4" fontId="4" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1"/><xf numFmtId="0" fontId="1" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center"/></xf><xf numFmtId="0" fontId="5" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="center"/></xf><xf numFmtId="0" fontId="6" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="center"/></xf><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;

/** sayfalar: [{ ad, satirlar: [[hücre,...]], genislikler?: [sayı,...] }] -> Uint8Array (.xlsx) */
export function xlsxYaz(sayfalar) {
  const dosyalar = [
    ['[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sayfalar.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}${sayfalar.map((sf, i) => (sf.resim ? `<Override PartName="/xl/drawings/drawing${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>` : '')).join('')}</Types>`],
    ['_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
    ['xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sayfalar.map((s, i) => `<sheet name="${xmlKac(s.ad).slice(0, 31)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`],
    ['xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sayfalar.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${sayfalar.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`],
    ['xl/styles.xml', STIL],
    ...sayfalar.map((s, i) => [`xl/worksheets/sheet${i + 1}.xml`, sayfaXml(s.satirlar, s.genislikler, s.birlesik, s.resim, s.satirYuksekligi)]),
    ...sayfalar.flatMap((s, i) => (s.resim ? [
      [`xl/worksheets/_rels/sheet${i + 1}.xml.rels`, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing${i + 1}.xml"/></Relationships>`],
      [`xl/drawings/drawing${i + 1}.xml`, cizimXml(s.resim)],
      [`xl/drawings/_rels/drawing${i + 1}.xml.rels`, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image${i + 1}.png"/></Relationships>`],
      [`xl/media/image${i + 1}.png`, s.resim.bayt],
    ] : [])),
  ].map(([ad, icerik]) => ({ ad: kodlayici.encode(ad), veri: typeof icerik === 'string' ? kodlayici.encode(icerik) : icerik }));

  const parcalar = []; const dizin = []; let konum = 0;
  const yaz = (b) => { parcalar.push(b); konum += b.length; };
  for (const d of dosyalar) {
    const crc = crc32(d.veri); const yerel = new Uint8Array(30); const v = new DataView(yerel.buffer);
    v.setUint32(0, 0x04034b50, true); v.setUint16(4, 20, true); v.setUint16(6, 0x0800, true); v.setUint16(8, 0, true);
    v.setUint32(14, crc, true); v.setUint32(18, d.veri.length, true); v.setUint32(22, d.veri.length, true); v.setUint16(26, d.ad.length, true);
    dizin.push({ d, crc, konum }); yaz(yerel); yaz(d.ad); yaz(d.veri);
  }
  const dizinBas = konum;
  for (const { d, crc, konum: k } of dizin) {
    const m = new Uint8Array(46); const v = new DataView(m.buffer);
    v.setUint32(0, 0x02014b50, true); v.setUint16(4, 20, true); v.setUint16(6, 20, true); v.setUint16(8, 0x0800, true);
    v.setUint32(16, crc, true); v.setUint32(20, d.veri.length, true); v.setUint32(24, d.veri.length, true); v.setUint16(28, d.ad.length, true); v.setUint32(42, k, true);
    yaz(m); yaz(d.ad);
  }
  const son = new Uint8Array(22); const sv = new DataView(son.buffer);
  sv.setUint32(0, 0x06054b50, true); sv.setUint16(8, dosyalar.length, true); sv.setUint16(10, dosyalar.length, true);
  sv.setUint32(12, konum - dizinBas, true); sv.setUint32(16, dizinBas, true); yaz(son);
  const cikti = new Uint8Array(konum); let o = 0; for (const p of parcalar) { cikti.set(p, o); o += p.length; }
  return cikti;
}

/** Gelir (fatura) Excel'i için boş şablon: başlık satırı + yönerge sayfası. */
export function gelirSablonu() {
  const b = (v) => ({ kalin: true, v });
  return xlsxYaz([
    { ad: 'Gelirler', genislikler: [14, 14, 44, 14, 12, 12, 14],
      satirlar: [['Fatura No', 'Fatura Tarihi', 'Açıklama', 'Ücret', '%20 KDV', '%10 KDV', 'Toplam'].map(b)] },
    { ad: 'Yönerge', genislikler: [100], satirlar: [
      [b('Gelir şablonu nasıl doldurulur?')],
      ['Her satır bir faturadır. "Ücret" KDV hariç tutardır; "%20 KDV" ve "%10 KDV" sütunlarına KDV TUTARI yazılır (oran değil).'],
      ['Açıklama sütunu firma adını içermelidir; hizmet ayı parantez içinde yazılabilir. Örnek: Alfa Gıda (Ekim)'],
      ['Bir faturada hem %20 hem %10 KDV varsa iki sütun da doldurulur. KDV\'siz satırda iki KDV sütunu boş bırakılır.'],
      ['Fatura tarihi gün.ay.yıl biçiminde tarih hücresi olmalıdır. Fatura numarası boşsa sistem numara verir.'],
      ['Spot iş ve elden ödemeler bu dosyayla değil, Fatura Takip sayfasındaki "Gelir ekle" ile elle girilir.'],
    ] },
  ]);
}

/** Boş aylık gider şablonu: satır = gider kalemi, sütun = ay. */
export function giderSablonu(yil = new Date().getFullYear(), kalemler = null) {
  const b = (v) => ({ kalin: true, v });
  const ad = kalemler ?? ['Şirket Açılış Giderleri', 'Yönetime Ödenen', 'Personel Giderleri', 'Vergi', '3th Party Ödeme', 'Kira ve Aidat', 'Araç Masrafları', 'Elektrik', 'Su', 'Doğal Gaz',
    'Cep telefonu', 'İnternet / Telefon', 'Kırtasiye Giderleri', 'Ofis Genel Giderler', 'Ofis Mobilya', 'Elektronik', 'Reklam, Pzarlama, Web', 'Avukatlık Giderleri',
    'Muhasebe Giderleri', 'Yeme ve İçme', 'KKD Giderleri', 'Diğer Giderler'];
  const aylar = Array.from({ length: 12 }, (_, i) => ({ t: 'tarih', v: `${yil}-${String(i + 1).padStart(2, '0')}-01` }));
  return xlsxYaz([
    { ad: 'Giderler', genislikler: [30, ...aylar.map(() => 14)],
      satirlar: [[b('Gider kalemi'), ...aylar], ...ad.map((k) => [k])] },
    { ad: 'Yönerge', genislikler: [100], satirlar: [
      [b('Gider şablonu nasıl doldurulur?')],
      ['Her satır bir gider kalemi, her sütun bir aydır. Tutarlar aylık toplamdır; boş veya 0 bırakılan hücre aktarılmaz.'],
      ['"Yönetime Ödenen" satırı yönetim olarak işaretli uzman/hekim maliyetidir; firma kârlılığında yönetim giderine yazılır.'],
      ['"Personel Giderleri" satırı toplam personel maliyetidir ve gider olarak alınır; firma kârlılığında personelin kart maliyetiyle çift sayılmaz. Kişi bazlı maliyet (personel kârlılığı için) ayrıca girilir.'],
      ['Aylar tarih hücresi olmalıdır (01.01.2026 gibi). Yeni kalem eklemek için satır ekleyin; aktarım sırasında kategori eşleştirilir.'],
      ['Her yüklenen dosya, içindeki aylar için önceki Excel aktarımının yerine geçer (eski kayıtlar silinmez, arşivlenir). Elle girilen giderlere dokunulmaz.'],
    ] },
  ]);
}
