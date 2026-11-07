// OSGB 360 - Küçük SVG grafikler (kütüphanesiz, CSP uyumlu: satır içi style yok; renkler CSS sınıflarından gelir).
import { html, para2, ayAdi, sayi } from '../lib/format.js';

const AY_KISA = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];
export const kisaAy = (iso) => `${AY_KISA[Number(String(iso).slice(5, 7)) - 1]} ${String(iso).slice(2, 4)}`;
const nf1 = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 1 });
/** Eksen etiketi: 1,2 Mn · 800 B · 0 */
export function kisaTutar(n) {
  const a = Math.abs(n); const s = n < 0 ? '-' : '';
  if (a >= 1e6) return `${s}${nf1.format(a / 1e6)} Mn`;
  if (a >= 1e3) return `${s}${nf1.format(a / 1e3)} B`;
  return `${s}${Math.round(a)}`;
}
/** Yuvarlak eksen sınırları ve adımı: [min, max, adım]. */
export function eksenAraligi(min, max, adet = 4) {
  const lo = Math.min(0, min); const hi = Math.max(0, max);
  if (hi === lo) return [0, 1, 1];
  const ham = (hi - lo) / adet; const us = 10 ** Math.floor(Math.log10(ham)); const f = ham / us;
  const adim = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * us;
  return [Math.floor(lo / adim) * adim, Math.ceil(hi / adim) * adim, adim];
}

const G = { w: 640, h: 260, sol: 52, sag: 12, ust: 14, alt: 32 };
const G_BUYUK = { w: 1040, h: 440, sol: 64, sag: 16, ust: 18, alt: 36 };
const G_GENIS = { w: 1040, h: 300, sol: 56, sag: 14, ust: 14, alt: 32 };
let G_AKTIF = G;
function iskelet(min, max, etiketler) {
  const [lo, hi, adim] = eksenAraligi(min, max); const { w, h, sol, sag, ust, alt } = G_AKTIF;
  const y = (v) => ust + (1 - (v - lo) / (hi - lo)) * (h - ust - alt); const gx = (w - sol - sag);
  const cizgiler = []; for (let v = lo; v <= hi + adim / 1000; v += adim) cizgiler.push(v);
  const n = etiketler.length; const x = (i) => sol + (gx / n) * (i + 0.5);
  const zemin = html`${cizgiler.map((v) => html`<line class="g-grid ${v === 0 ? 'g-sifir' : ''}" x1="${sol}" x2="${w - sag}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}"/><text class="g-eksen" x="${sol - 8}" y="${(y(v) + 4).toFixed(1)}" text-anchor="end">${kisaTutar(v)}</text>`)}
    ${etiketler.map((e, i) => html`<text class="g-eksen" x="${x(i).toFixed(1)}" y="${h - 10}" text-anchor="middle">${kisaAy(e)}</text>`)}`;
  return { y, x, zemin, gx, n, lo, hi };
}
const sarmal = (ad, aciklama, icerik) => html`<svg class="grafik" viewBox="0 0 ${G_AKTIF.w} ${G_AKTIF.h}" role="img" aria-label="${ad}. ${aciklama}" preserveAspectRatio="xMidYMid meet"><title>${ad}</title>${icerik}</svg>`;
const olcuyle = (buyuk, f) => { G_AKTIF = buyuk === 'genis' ? G_GENIS : buyuk ? G_BUYUK : G; try { return f(); } finally { G_AKTIF = G; } };

/** Gruplu çubuk grafik: seriler [{ad, sinif, degerler}] */
export function cubukGrafik({ ad, etiketler, seriler, buyuk = false, birim = 'para' }) {
  return olcuyle(buyuk, () => cubukGrafikCiz({ ad, etiketler, seriler, birim }));
}
function cubukGrafikCiz({ ad, etiketler, seriler, birim }) {
  const bicim = birim === 'kisi' ? (v) => `${sayi(v)} kişi` : para2;
  const hepsi = seriler.flatMap((s) => s.degerler); const t = iskelet(Math.min(...hepsi, 0), Math.max(...hepsi, 0), etiketler);
  const grup = t.gx / t.n; const kalin = Math.max(4, Math.min(22, (grup * 0.7) / seriler.length));
  const cubuklar = etiketler.map((e, i) => seriler.map((s, k) => {
    const v = s.degerler[i]; const x = t.x(i) - (kalin * seriler.length) / 2 + k * kalin; const y0 = t.y(0); const y1 = t.y(v);
    return html`<rect class="g-s-${s.sinif}" x="${x.toFixed(1)}" y="${Math.min(y0, y1).toFixed(1)}" width="${(kalin - 2).toFixed(1)}" height="${Math.max(0, Math.abs(y0 - y1)).toFixed(1)}" rx="2" data-ipucu="${kisaAy(e)} · ${s.ad}: ${bicim(v)}"/>`;
  }));
  const ozet = etiketler.map((e, i) => `${ayAdi(e)}: ${seriler.map((s) => `${s.ad} ${bicim(s.degerler[i])}`).join(', ')}`).join('; ');
  return sarmal(ad, ozet, html`${t.zemin}${cubuklar}`);
}

/** Çizgi grafik: seriler [{ad, sinif, degerler, kesik}] */
export function cizgiGrafik({ ad, etiketler, seriler, buyuk = false }) {
  return olcuyle(buyuk, () => cizgiGrafikCiz({ ad, etiketler, seriler }));
}
function cizgiGrafikCiz({ ad, etiketler, seriler }) {
  const hepsi = seriler.flatMap((s) => s.degerler); const t = iskelet(Math.min(...hepsi, 0), Math.max(...hepsi, 0), etiketler);
  const cizgi = seriler.map((s) => {
    const nokta = s.degerler.map((v, i) => [t.x(i), t.y(v), v, etiketler[i]]);
    return html`<polyline class="g-l-${s.sinif} ${s.kesik ? 'g-kesik' : ''}" fill="none" points="${nokta.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ')}"/>
      ${nokta.map((p) => html`<circle class="g-n-${s.sinif}" cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="${G_AKTIF === G ? 4.5 : 6}" data-ipucu="${kisaAy(p[3])} · ${s.ad}: ${para2(p[2])}"/>`)}`;
  });
  const ozet = etiketler.map((e, i) => `${ayAdi(e)}: ${seriler.map((s) => `${s.ad} ${para2(s.degerler[i])}`).join(', ')}`).join('; ');
  return sarmal(ad, ozet, html`${t.zemin}${cizgi}`);
}

export const lejant = (seriler) => html`<ul class="g-lejant">${seriler.map((s) => html`<li><span class="g-k g-s-${s.sinif}" aria-hidden="true"></span>${s.ad}</li>`)}</ul>`;

/**
 * Fare/odak ipucu: [data-ipucu] taşıyan her öğenin üzerine gelince tutar baloncukta görünür (olay yetkilendirme; kök başına bir kez bağlanır).
 * CSP satır içi style özniteliğine izin vermediğinden konum CSSOM ile verilir.
 */
export function ipucuBagla(kok) {
  if (kok.__ipucu) return; kok.__ipucu = true;
  let balon = null;
  const goster = (e) => {
    const h = e.target.closest?.('[data-ipucu]'); if (!h) { if (balon) balon.hidden = true; return; }
    if (!balon) { balon = document.createElement('div'); balon.className = 'g-ipucu'; balon.setAttribute('role', 'tooltip'); document.body.appendChild(balon); }
    balon.textContent = h.dataset.ipucu; balon.hidden = false;
    const r = h.getBoundingClientRect(); const x = e.clientX && e.type !== 'focusin' ? e.clientX : r.left + r.width / 2; const y = e.clientX && e.type !== 'focusin' ? e.clientY : r.top;
    const b = balon.getBoundingClientRect();
    balon.style.left = `${Math.max(4, Math.min(window.innerWidth - b.width - 4, x - b.width / 2))}px`;
    balon.style.top = `${Math.max(4, y - b.height - 12)}px`;
  };
  const gizle = () => { if (balon) balon.hidden = true; };
  kok.addEventListener('pointermove', goster); kok.addEventListener('pointerleave', gizle); kok.addEventListener('focusin', goster); kok.addEventListener('focusout', gizle);
  kok.addEventListener('pointerdown', (e) => { if (e.pointerType === 'touch') goster(e); });
}
