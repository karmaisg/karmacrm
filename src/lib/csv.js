// OSGB 360 - CSV okuma/yazma (Excel uyumlu). Tarayıcıdan bağımsız; testleri tests/csv.test.js içindedir.
// Yazma: noktalı virgül ayırıcı, UTF-8 BOM, CRLF (Türkçe Excel'de çift tıkla doğru açılır).
// Okuma: ayırıcı (; , sekme) otomatik bulunur, tırnaklı alan ve alan içi satır sonu desteklenir.

export const BOM = '﻿';
const AYIRACLAR = [';', ',', '\t'];

/** İlk dolu satırdan, tırnak dışındaki en sık geçen ayırıcıyı bulur; hiçbiri yoksa ';' döner. */
export function ayiracBul(metin) {
  const sayac = Object.fromEntries(AYIRACLAR.map((a) => [a, 0]));
  let tirnak = false;
  for (const c of String(metin)) {
    if (c === '"') tirnak = !tirnak;
    else if (!tirnak && (c === '\n' || c === '\r')) { if (Object.values(sayac).some((n) => n > 0)) break; }
    else if (!tirnak && c in sayac) sayac[c] += 1;
  }
  let en = ';'; let enSayi = 0;
  for (const a of AYIRACLAR) if (sayac[a] > enSayi) { en = a; enSayi = sayac[a]; }
  return en;
}

/**
 * CSV metnini satır/hücre dizisine çevirir.
 * Tamamen boş satırlar atlanır. Kapanmamış tırnak varsa hata fırlatır (bozuk dosya sessizce okunmasın).
 * @returns {{ayirac: string, satirlar: string[][]}}
 */
export function csvAyristir(metin, ayirac = null) {
  let s = String(metin ?? '');
  if (s.charCodeAt(0) === 0xFEFF) s = s.slice(1);
  const ay = ayirac ?? ayiracBul(s);
  const satirlar = [];
  let satir = []; let hucre = ''; let tirnak = false; let hucreTirnakli = false;
  const hucreBitir = () => { satir.push(hucre); hucre = ''; hucreTirnakli = false; };
  const satirBitir = () => {
    hucreBitir();
    if (satir.some((h) => h.trim() !== '')) satirlar.push(satir);
    satir = [];
  };
  for (let i = 0; i < s.length; i += 1) {
    const c = s[i];
    if (tirnak) {
      if (c === '"') {
        if (s[i + 1] === '"') { hucre += '"'; i += 1; } else tirnak = false;
      } else hucre += c;
    } else if (c === '"' && hucre === '' && !hucreTirnakli) { tirnak = true; hucreTirnakli = true; }
    else if (c === ay) hucreBitir();
    else if (c === '\r') { if (s[i + 1] === '\n') i += 1; satirBitir(); }
    else if (c === '\n') satirBitir();
    else hucre += c;
  }
  if (tirnak) throw new Error('CSV dosyasında kapatılmamış tırnak işareti var; dosya bozuk görünüyor.');
  if (hucre !== '' || satir.length) satirBitir();
  return { ayirac: ay, satirlar };
}

/** Formül enjeksiyonunu önler: metin =, +, -, @, sekme veya CR ile başlıyorsa başına ' konur. */
export function guvenliMetin(v) {
  const s = String(v);
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
}

/** Tek hücreyi yazıya çevirir. Sayı: ondalık ayırıcı virgül (ayırıcı ';' iken); metin: formül korumalı. */
export function hucreMetni(v, ayirac = ';') {
  if (v === null || v === undefined) return '';
  let s;
  if (typeof v === 'number') s = Number.isFinite(v) ? String(v).replace('.', ayirac === ';' ? ',' : '.') : '';
  else if (typeof v === 'boolean') s = v ? 'Evet' : 'Hayır';
  else s = guvenliMetin(v);
  return s.includes(ayirac) || /["\r\n]/.test(s) || s !== s.trim() ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Başlık + satırlardan CSV metni üretir (BOM'lu, CRLF). */
export function csvUret(basliklar, satirlar, ayirac = ';') {
  const yaz = (l) => l.map((h) => hucreMetni(h, ayirac)).join(ayirac);
  return BOM + [yaz(basliklar), ...satirlar.map(yaz)].join('\r\n') + '\r\n';
}

/** Başlıkları (ilk satır) ve veri satırlarını nesne dizisine çevirir; satır numarası dosyadaki numaradır (1 = başlık). */
export function csvTablo(satirlar) {
  if (!satirlar.length) return { basliklar: [], kayitlar: [] };
  const basliklar = satirlar[0].map((b) => b.trim());
  const kayitlar = satirlar.slice(1).map((s, i) => ({ satirNo: i + 2, hucreler: basliklar.map((_, k) => (s[k] ?? '').trim()), fazla: s.length > basliklar.length && s.slice(basliklar.length).some((x) => x.trim() !== '') }));
  return { basliklar, kayitlar };
}
