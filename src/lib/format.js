// OSGB 360 - Biçimlendirme ve güvenli HTML yardımcıları (Türkçe).
//
// GÜVENLİK: Arayüz HTML'i yalnızca `html` etiketli şablonuyla üretilir. Şablona giren her değer
// otomatik olarak kaçışlanır (<, >, &, tırnaklar). Kaçışsız HTML için raw() yalnızca kod içindeki
// sabit metinlerde kullanılır; kullanıcı verisi asla raw() içine girmez.

class Safe {
  constructor(s) { this.s = s; }
  toString() { return this.s; }
}

export const raw = (s) => new Safe(String(s));
export const isSafe = (v) => v instanceof Safe;

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

function part(v) {
  if (v instanceof Safe) return v.s;
  if (Array.isArray(v)) return v.map(part).join('');
  if (v === false || v === null || v === undefined) return '';
  return esc(v);
}

/** html`<p>${kullaniciMetni}</p>` -> Safe (değerler kaçışlanır). Öznitelikleri her zaman tırnak içinde yazın. */
export function html(strings, ...vals) {
  let out = strings[0];
  for (let i = 0; i < vals.length; i++) out += part(vals[i]) + strings[i + 1];
  return new Safe(out);
}

export function mount(el, safe) {
  el.innerHTML = safe instanceof Safe ? safe.s : esc(safe);
}

// ---------------------------------------------------------------- bağlantılar
/** Yalnızca http/https adreslerine izin verir (javascript: gibi şemalar engellenir). Geçersizse null. */
export function safeUrl(value) {
  const v = String(value ?? '').trim();
  if (!v) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(v) ? v : `https://${v}`;
  try {
    const u = new URL(withScheme);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null;
  } catch { return null; }
}

export const telHref = (v) => {
  const d = String(v ?? '').replace(/[^\d+]/g, '');
  return d.length >= 3 ? `tel:${d}` : null;
};

export const mailHref = (v) => {
  const s = String(v ?? '').trim();
  return /^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/.test(s) ? `mailto:${s}` : null;
};

// ---------------------------------------------------------------- tarih
const pad = (n) => String(n).padStart(2, '0');

/** Yerel saat dilimine göre bugünün tarihi: 'YYYY-MM-DD' (toISOString UTC verdiği için kullanılmaz). */
export function bugun(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export const ayBasi = (iso) => `${String(iso).slice(0, 7)}-01`;

/** 'YYYY-MM-DD' -> '05.10.2026' */
export function tarih(iso) {
  if (!iso) return '—';
  const [y, m, d] = String(iso).slice(0, 10).split('-');
  return `${d}.${m}.${y}`;
}

const AYLAR = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
const GUNLER = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'];

/** '2026-10-23' -> '23 Ekim 2026, Cuma' */
export function tarihUzun(iso) {
  const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
  const gun = GUNLER[new Date(y, m - 1, d).getDay()];
  return `${d} ${AYLAR[m - 1]} ${y}, ${gun}`;
}

/** '2026-10-01' -> 'Ekim 2026' */
export function ayAdi(iso) {
  const [y, m] = String(iso).slice(0, 7).split('-').map(Number);
  return `${AYLAR[m - 1]} ${y}`;
}

export const gunEkle = (iso, n) => {
  const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
  return bugun(new Date(y, m - 1, d + n));
};

export function selamlama(saat = new Date().getHours()) {
  if (saat >= 5 && saat < 12) return 'Günaydın';
  if (saat >= 12 && saat < 18) return 'İyi günler';
  if (saat >= 18 && saat < 23) return 'İyi akşamlar';
  return 'İyi geceler';
}

// ---------------------------------------------------------------- sayı
const NF = new Intl.NumberFormat('tr-TR');
export const sayi = (n) => (n === null || n === undefined || Number.isNaN(n) ? '—' : NF.format(n));
const NF1 = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 1 });
export const ondalik = (n) => (n === null || n === undefined || Number.isNaN(n) ? '—' : NF1.format(n));

const NF2 = new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const ondalik2 = (n) => (n === null || n === undefined || Number.isNaN(n) ? '—' : NF2.format(n));

export function dakikaSaat(dk) {
  if (dk === null || dk === undefined) return '—';
  return `${sayi(dk)} dk (${ondalik(dk / 60)} saat)`;
}

// ---------------------------------------------------------------- metin
export const trKucuk = (s) => String(s ?? '').toLocaleLowerCase('tr-TR');

/** Türkçe harflere duyarlı, büyük/küçük harften bağımsız "içerir" karşılaştırması. */
export const icerir = (metin, aranan) => trKucuk(metin).includes(trKucuk(aranan).trim());

export const trSirala = (a, b) => String(a ?? '').localeCompare(String(b ?? ''), 'tr');

export function bastaHarfler(ad) {
  const kelimeler = String(ad ?? '').trim().split(/\s+/).filter(Boolean);
  if (!kelimeler.length) return '?';
  const ilk = kelimeler[0][0];
  const son = kelimeler.length > 1 ? kelimeler[kelimeler.length - 1][0] : '';
  return (ilk + son).toLocaleUpperCase('tr-TR');
}

/** Ad -> 1..6 arası sabit renk numarası (avatar rengi). */
export function renkNo(ad) {
  let h = 0;
  for (const ch of String(ad ?? '')) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  return (h % 6) + 1;
}

export const ilkAd = (adSoyad) => String(adSoyad ?? '').trim().split(/\s+/)[0] || '';

// ---------------------------------------------------------------- etiketler
export const TEHLIKE = {
  az_tehlikeli: 'Az tehlikeli',
  tehlikeli: 'Tehlikeli',
  cok_tehlikeli: 'Çok tehlikeli',
};
export const TEHLIKE_SIRASI = ['az_tehlikeli', 'tehlikeli', 'cok_tehlikeli'];

export const MUSTERI_DURUMU = { musteri: 'Müşteri', eski_musteri: 'Eski müşteri' };

// ---------------------------------------------------------------- Aşama 3 eklemeleri
const NF_TL = new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY', maximumFractionDigits: 0 });
export const para = (n) => (n === null || n === undefined || n === '' || Number.isNaN(Number(n)) ? '—' : NF_TL.format(Number(n)));

/** ISO zaman damgası -> '25.10.2026 14:30' (tarayıcının yerel saat diliminde). */
export function tarihSaat(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return `${tarih(bugun(d))} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** Yerel 'YYYY-MM-DDTHH:MM' (datetime-local alanı) -> ISO zaman damgası; boşsa null. */
export function yerelIso(deger) {
  if (!deger) return null;
  const d = new Date(deger);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** ISO zaman damgası -> datetime-local alanının değeri (yerel saat). */
export function yerelDeger(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${bugun(d)}T${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** İki 'YYYY-MM-DD' tarihi arasındaki gün farkı (b - a). */
export function gunFarki(a, b) {
  const [y1, m1, d1] = String(a).slice(0, 10).split('-').map(Number);
  const [y2, m2, d2] = String(b).slice(0, 10).split('-').map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000);
}

// ---------------------------------------------------------------- Aşama 6: kuruşlu tutar
const NF_TL2 = new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY', minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** Fatura, tahsilat ve gider tutarları için kuruşlu para biçimi ('₺1.234,50'). */
export const para2 = (n) => (n === null || n === undefined || n === '' || Number.isNaN(Number(n)) ? '—' : NF_TL2.format(Number(n)));
