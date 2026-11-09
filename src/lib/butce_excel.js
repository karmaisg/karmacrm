// OSGB 360 - Yıllık bütçe Excel çıktısı: Gelirler Tablosu, Giderler Tablosu ve Kâr Durumu tek sayfada.
// Toplamlar, ağırlıklı artış ve kâr canlı formüldür (Excel'de değer değiştirince yeniden hesaplanır).
import { xlsxYaz } from './xlsxyaz.js';
import { DURUMLAR, FIYAT_TURU } from './butce.js';

const KOYU = '1F2937'; const KIRMIZI = 'D62A2A'; const GRI = 'F3F4F6'; const SOLUK = 'FDECEC';
const STILLER = {
  baslik: { font: { b: true, sz: 20, renk: 'FFFFFF' }, dolgu: KOYU, yatay: 'left' },
  altBaslik: { font: { i: true, sz: 10, renk: '6B7280' }, yatay: 'left' },
  bant: { font: { b: true, sz: 12, renk: 'FFFFFF' }, dolgu: KIRMIZI, yatay: 'left' },
  kolon: { font: { b: true, sz: 10, renk: 'FFFFFF' }, dolgu: KOYU, kenar: 'ince', yatay: 'center', saril: true },
  metin: { kenar: 'ince', yatay: 'left' },
  metinOrta: { kenar: 'ince', yatay: 'center' },
  not: { kenar: 'ince', yatay: 'left', saril: true, font: { sz: 10 } },
  yesil: { font: { b: true, renk: '15803D' }, kenar: 'ince', yatay: 'left' },
  kirmizi: { font: { b: true, renk: 'B91C1C' }, kenar: 'ince', yatay: 'left' },
  turuncu: { font: { b: true, renk: 'C2410C' }, kenar: 'ince', yatay: 'left' },
  cocuk: { font: { i: true, renk: '374151' }, kenar: 'ince', yatay: 'left' },
  ust: { font: { b: true }, kenar: 'ince', yatay: 'left' },
  tl: { bicim: 'tl', kenar: 'ince', yatay: 'right' },
  tlKalin: { bicim: 'tl', kenar: 'ince', yatay: 'right', font: { b: true } },
  yuzde: { bicim: 'yuzde', kenar: 'ince', yatay: 'right' },
  tam: { bicim: 'tam', kenar: 'ince', yatay: 'right' },
  topMetin: { font: { b: true }, dolgu: GRI, kenar: 'ust', yatay: 'left' },
  topTl: { font: { b: true }, bicim: 'tl', dolgu: GRI, kenar: 'ust', yatay: 'right' },
  topYuzde: { font: { b: true }, bicim: 'yuzde', dolgu: GRI, kenar: 'ust', yatay: 'right' },
  topBos: { dolgu: GRI, kenar: 'ust' },
  karKolon: { font: { b: true, sz: 10, renk: 'FFFFFF' }, dolgu: KOYU, kenar: 'ince', yatay: 'center' },
  karEtiket: { font: { b: true }, kenar: 'ince', yatay: 'left' },
  karTl: { bicim: 'tl', kenar: 'ince', yatay: 'right' },
  karYuzde: { bicim: 'yuzde', kenar: 'ince', yatay: 'right' },
  karBuyukEtiket: { font: { b: true, sz: 13 }, dolgu: SOLUK, kenar: 'ince', yatay: 'left' },
  karBuyukTl: { font: { b: true, sz: 13 }, bicim: 'tl', dolgu: SOLUK, kenar: 'ince', yatay: 'right' },
  karBuyukEksi: { font: { b: true, sz: 13, renk: 'B91C1C' }, bicim: 'tl', dolgu: SOLUK, kenar: 'ince', yatay: 'right' },
  dipnot: { font: { i: true, sz: 9, renk: '6B7280' }, yatay: 'left', saril: true },
};
const DURUM_STIL = { kabul: 'yesil', sona_erdi: 'kirmizi', gorusme_bilgi_yok: 'turuncu', bilgi_verildi: 'turuncu' };
const SUT = 'ABCDEFGHIJKLMNO';
const n2 = (x) => (x === null || x === undefined ? null : Math.round(Number(x) * 100) / 100);

/**
 * gelirler: [{ ad, durum, tur, birim, adet, aylik, ortalama, yuzde(%), yeniTur, talepFiyat, kabul, artisOrani(kesir), artisTutari, beklenen, not }]
 * personel: [{ ad, prevNet, prevSgk, pct(%), nextNet, nextSgk }] — Personel Gider Tablosu; varsa "Personel Giderleri" kalemi buradaki toplamlara bağlanır
 * giderler: sıralı liste [{ ad, cocuk, prev, pct(%), next, toplamli }] — personel altındaki isimler `cocuk: true`, kendi kalemi `toplamli: true`
 */
export function butceExcel({ yil, gelirler, giderler, personel = [], gelirToplam, tarih }) {
  const satirlar = []; const birlesik = []; const yuk = {};
  const bos = (n) => Array.from({ length: n }, () => null);
  const hs = (r) => r + 1;                                           // 0 tabanlı satır dizini → Excel satır no
  const tum = (o, v) => ({ o, v: v ?? '' });

  // ---- başlık
  satirlar.push([tum('baslik', `YILLIK BÜTÇE ${yil}`), ...bos(14).map(() => tum('baslik', ''))]); birlesik.push('A1:O1'); yuk[0] = 36;
  satirlar.push([tum('altBaslik', `Hazırlanma: ${tarih} · Tutarlar KDV hariç, aylık (TL) · Beklenen aylık gelir = ${yil - 1} aylık ortalama gelir × (1 + gerçekleşen artış oranı)`)]); birlesik.push('A2:O2');
  satirlar.push([]);

  // ---- gelirler tablosu
  satirlar.push([tum('bant', 'GELİRLER TABLOSU'), ...bos(14).map(() => tum('bant', ''))]); birlesik.push(`A${hs(satirlar.length - 1)}:O${hs(satirlar.length - 1)}`); yuk[satirlar.length - 1] = 22;
  const kolonlar = ['Firma / gelir kalemi', `${yil - 1} fiyat türü`, `${yil - 1} fiyatı (sabit aylık / kişi başı)`, 'Çalışan sayısı', 'Aylık hizmet fiyatı', `${yil - 1} aylık ort. gelir`, 'Talep edilen artış %', `${yil} fiyat türü`, 'Talep edilen fiyat', 'Kabul edilen bedel', 'Gerçekleşen artış %', 'Gerçekleşen artış (aylık TL)', `${yil} beklenen aylık gelir`, 'Durum', 'Açıklama'];
  satirlar.push(kolonlar.map((k) => tum('kolon', k))); yuk[satirlar.length - 1] = 46;
  const g0 = hs(satirlar.length);                                      // ilk gelir satırı (Excel no)
  for (const g of gelirler) {
    satirlar.push([
      tum(DURUM_STIL[g.durum] ?? 'metin', g.ad), tum('metinOrta', g.tur ? FIYAT_TURU[g.tur] : ''), tum('tl', n2(g.birim)), tum('tam', g.adet || null), tum('tl', n2(g.aylik)),
      tum('tl', n2(g.ortalama)), tum('yuzde', g.yuzde === null || g.yuzde === undefined ? null : g.yuzde / 100), tum('metinOrta', g.yeniTur ? FIYAT_TURU[g.yeniTur] : ''), tum('tl', n2(g.talepFiyat)), tum('tl', n2(g.kabul)),
      tum('yuzde', g.artisOrani ?? null), tum('tl', n2(g.artisTutari)), tum('tlKalin', n2(g.beklenen)), tum('metin', g.durum ? DURUMLAR[g.durum] : ''), tum('not', g.not ?? ''),
    ]);
  }
  const g1 = hs(satirlar.length - 1);
  const topla = (alan) => n2(gelirler.reduce((t, g) => t + (Number(g[alan]) || 0), 0));
  const bosGelir = gelirler.length === 0;
  const f = (kol) => (bosGelir ? null : `SUM(${kol}${g0}:${kol}${g1})`);
  const gelirTopSatir = hs(satirlar.length);
  satirlar.push([
    tum('topMetin', `TOPLAM (${gelirler.length} satır)`), tum('topBos', ''), tum('topBos', ''), tum('topBos', ''),
    { o: 'topTl', f: f('E'), v: topla('aylik') }, { o: 'topTl', f: f('F'), v: topla('ortalama') }, tum('topBos', ''), tum('topBos', ''), tum('topBos', ''), tum('topBos', ''),
    tum('topYuzde', gelirToplam.artisOrani ?? null), { o: 'topTl', f: f('L'), v: topla('artisTutari') }, { o: 'topTl', f: f('M'), v: topla('beklenen') }, tum('topBos', ''), tum('topBos', ''),
  ]);
  satirlar.push([{ o: 'dipnot', v: 'Gerçekleşen artış % toplamı, yalnızca beklenen geliri hesaplanabilen firmalar üzerinden bulunur; sözleşmesi sona eren firma 0 sayılır.' }]); birlesik.push(`A${hs(satirlar.length - 1)}:O${hs(satirlar.length - 1)}`);
  satirlar.push([]);

  // ---- giderler tablosu
  satirlar.push([tum('bant', 'GİDERLER TABLOSU'), ...bos(14).map(() => tum('bant', ''))]); birlesik.push(`A${hs(satirlar.length - 1)}:O${hs(satirlar.length - 1)}`); yuk[satirlar.length - 1] = 22;
  satirlar.push([tum('kolon', 'Gider kalemi'), tum('kolon', `${yil - 1} aylık ort. gider`), tum('kolon', '% artış'), tum('kolon', `${yil} aylık ort. gider`)]); yuk[satirlar.length - 1] = 46;
  let pToplamNo = 0; let pOnce = 0; let pSonra = 0; const satirNo = new Map(); const ustSatirlar = []; let sonUst = null; const cocukSatirlari = new Map();
  giderler.forEach((g, i) => {
    const no = hs(satirlar.length + 0);
    satirNo.set(i, no);
    if (g.cocuk) { if (sonUst !== null) cocukSatirlari.get(sonUst).push(no); } else { ustSatirlar.push(no); sonUst = i; cocukSatirlari.set(i, []); }
    satirlar.push(null);                                               // aşağıda doldurulur (çocuk satır aralıkları bilinmeli)
  });
  giderler.forEach((g, i) => {
    const no = satirNo.get(i); const ch = g.cocuk ? [] : (cocukSatirlari.get(i) ?? []);
    const aralik = ch.length ? [ch[0], ch[ch.length - 1]] : null;
    const prevF = aralik ? `SUM(B${aralik[0]}:B${aralik[1]})` : null; const nextF = aralik ? `SUM(D${aralik[0]}:D${aralik[1]})` : null;
    const yuzdeF = aralik ? `IF(B${no}>0,D${no}/B${no}-1,"")` : null;
    satirlar[no - 1] = [
      tum(g.cocuk ? 'cocuk' : (aralik ? 'ust' : 'metin'), g.cocuk ? `    ${g.ad}` : g.ad),
      { o: 'tl', f: prevF, v: n2(g.prev) },
      { o: 'yuzde', f: yuzdeF, v: g.pct === null || g.pct === undefined ? null : g.pct / 100 },
      { o: 'tl', f: nextF, v: n2(g.next) },
    ];
  });
  const gToplam = hs(satirlar.length);
  const prevT = n2(giderler.filter((g) => !g.cocuk).reduce((t, g) => t + (g.prev ?? 0), 0));
  const nextT = n2(giderler.filter((g) => !g.cocuk).reduce((t, g) => t + (g.next ?? g.prev ?? 0), 0));
  const refToplam = (kol) => (ustSatirlar.length ? ustSatirlar.map((r) => `${kol}${r}`).join('+') : null);
  satirlar.push([
    tum('topMetin', 'TOPLAM GİDER'), { o: 'topTl', f: refToplam('B'), v: prevT },
    { o: 'topYuzde', f: ustSatirlar.length ? `IF(B${gToplam}>0,D${gToplam}/B${gToplam}-1,"")` : null, v: prevT > 0 ? nextT / prevT - 1 : null }, { o: 'topTl', f: refToplam('D'), v: nextT },
  ]);
  satirlar.push([{ o: 'dipnot', v: 'Toplam gider satırındaki % artış, kalem tutarlarına göre ağırlıklı ortalamadır (Σ sonraki yıl ÷ Σ önceki yıl − 1). Sonraki yıl tutarı girilmeyen kalem, önceki yılla aynı sayılır.' }]); birlesik.push(`A${hs(satirlar.length - 1)}:O${hs(satirlar.length - 1)}`);
  satirlar.push([]);

  // ---- personel gider tablosu
  if (personel.length) {
    satirlar.push([tum('bant', 'PERSONEL GİDER TABLOSU'), ...bos(14).map(() => tum('bant', ''))]); birlesik.push(`A${hs(satirlar.length - 1)}:O${hs(satirlar.length - 1)}`); yuk[satirlar.length - 1] = 22;
    satirlar.push([`Ad Soyad`, `${yil - 1} net maaş`, `${yil - 1} SGK gideri`, `${yil - 1} toplam gider`, 'Artış oranı %', `${yil} net maaş`, `${yil} SGK gideri`, `${yil} toplam gider`].map((k) => tum('kolon', k))); yuk[satirlar.length - 1] = 34;
    const p0 = hs(satirlar.length);
    for (const p of personel) {
      const r = hs(satirlar.length);
      satirlar.push([tum('metin', p.ad), tum('tl', n2(p.prevNet)), tum('tl', n2(p.prevSgk)), { o: 'tl', f: `B${r}+C${r}`, v: n2((p.prevNet ?? 0) + (p.prevSgk ?? 0)) },
        tum('yuzde', p.pct === null || p.pct === undefined ? null : p.pct / 100), tum('tl', n2(p.nextNet)), tum('tl', n2(p.nextSgk)), { o: 'tl', f: `F${r}+G${r}`, v: n2((p.nextNet ?? 0) + (p.nextSgk ?? 0)) }]);
    }
    const p1 = hs(satirlar.length - 1); pToplamNo = hs(satirlar.length);
    const ps = (alan) => n2(personel.reduce((t, p) => t + (Number(p[alan]) || 0), 0));
    const sonT = n2(ps('nextNet') + ps('nextSgk')); const onceT = n2(ps('prevNet') + ps('prevSgk'));
    pOnce = onceT; pSonra = sonT;
    satirlar.push([tum('topMetin', `TOPLAM (${personel.length} personel)`), { o: 'topTl', f: `SUM(B${p0}:B${p1})`, v: ps('prevNet') }, { o: 'topTl', f: `SUM(C${p0}:C${p1})`, v: ps('prevSgk') }, { o: 'topTl', f: `SUM(D${p0}:D${p1})`, v: onceT },
      { o: 'topYuzde', f: `IF(D${pToplamNo}>0,H${pToplamNo}/D${pToplamNo}-1,"")`, v: onceT > 0 ? sonT / onceT - 1 : null }, { o: 'topTl', f: `SUM(F${p0}:F${p1})`, v: ps('nextNet') }, { o: 'topTl', f: `SUM(G${p0}:G${p1})`, v: ps('nextSgk') }, { o: 'topTl', f: `SUM(H${p0}:H${p1})`, v: sonT }]);
    satirlar.push([{ o: 'dipnot', v: 'Bu tablonun toplamı, Giderler tablosundaki "Personel Giderleri" satırına aktarılır (net maaş + SGK).' }]); birlesik.push(`A${hs(satirlar.length - 1)}:O${hs(satirlar.length - 1)}`);
    satirlar.push([]);
    for (const [i, g] of giderler.entries()) {
      if (g.toplamli && !g.cocuk) { const row = satirlar[satirNo.get(i) - 1]; row[1] = { ...row[1], f: `D${pToplamNo}`, v: pOnce }; row[3] = { ...row[3], f: `H${pToplamNo}`, v: pSonra }; row[2] = { ...row[2], f: `IF(B${satirNo.get(i)}>0,D${satirNo.get(i)}/B${satirNo.get(i)}-1,"")` }; }
    }
  }

  // ---- kâr durumu
  satirlar.push([tum('bant', 'KÂR DURUMU'), ...bos(14).map(() => tum('bant', ''))]); birlesik.push(`A${hs(satirlar.length - 1)}:O${hs(satirlar.length - 1)}`); yuk[satirlar.length - 1] = 22;
  satirlar.push([tum('karKolon', ''), tum('karKolon', `${yil - 1} (ortalama)`), tum('karKolon', `${yil} (beklenen)`)]); yuk[satirlar.length - 1] = 30;
  const gelirOnce = topla('ortalama'); const gelirSonra = topla('beklenen');
  const k0 = hs(satirlar.length);
  satirlar.push([tum('karEtiket', 'Aylık gelir'), { o: 'karTl', f: `F${gelirTopSatir}`, v: gelirOnce }, { o: 'karTl', f: `M${gelirTopSatir}`, v: gelirSonra }]);
  satirlar.push([tum('karEtiket', 'Aylık gider'), { o: 'karTl', f: `B${gToplam}`, v: prevT }, { o: 'karTl', f: `D${gToplam}`, v: nextT }]);
  const karOnce = n2(gelirOnce - prevT); const karSonra = n2(gelirSonra - nextT);
  satirlar.push([tum('karBuyukEtiket', 'KÂR DURUMU (aylık)'), { o: karOnce < 0 ? 'karBuyukEksi' : 'karBuyukTl', f: `B${k0}-B${k0 + 1}`, v: karOnce }, { o: karSonra < 0 ? 'karBuyukEksi' : 'karBuyukTl', f: `C${k0}-C${k0 + 1}`, v: karSonra }]); yuk[satirlar.length - 1] = 26;
  satirlar.push([tum('karEtiket', 'Yıllık kâr (aylık × 12)'), { o: 'karTl', f: `B${k0 + 2}*12`, v: n2(karOnce * 12) }, { o: 'karTl', f: `C${k0 + 2}*12`, v: n2(karSonra * 12) }]);
  satirlar.push([tum('karEtiket', 'Kâr marjı'), { o: 'karYuzde', f: `IF(B${k0}>0,B${k0 + 2}/B${k0},"")`, v: gelirOnce > 0 ? karOnce / gelirOnce : null }, { o: 'karYuzde', f: `IF(C${k0}>0,C${k0 + 2}/C${k0},"")`, v: gelirSonra > 0 ? karSonra / gelirSonra : null }]);
  satirlar.push([{ o: 'dipnot', v: `Kâr durumu = ${yil} beklenen aylık gelir toplamı − ${yil} aylık gider toplamı.` }]); birlesik.push(`A${hs(satirlar.length - 1)}:O${hs(satirlar.length - 1)}`);

  const genislikler = [38, 17, 18, 17, 18, 20, 14, 17, 17, 18, 15, 19, 21, 32, 44];
  return xlsxYaz([{ ad: `Yıllık Bütçe ${yil}`, satirlar, genislikler, birlesik, satirYuksekligi: yuk, dondur: { x: 1 }, izgaraGizle: true, yatay: true }], { stiller: STILLER });
}
