// OSGB 360 - Personel maliyeti hesabı (saf fonksiyonlar). Sunucudaki app.sgk_primi ve personel_maliyeti_kaydet ile aynı kurallar.
const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const sayi = (v) => { const n = Number(String(v ?? '').replace(',', '.')); return String(v ?? '').trim() === '' || !Number.isFinite(n) ? null : n; };

/** Brüt maaş üzerinden işveren SGK primi. Emekli: %2,25 + %30. Emekli değil: %2,25 + %21 + %12,5 + %3. */
export const SGK_ORANLARI = {
  emekli: { oran: 0.0225 + 0.30, parcalar: [['SGK işçi payı', 2.25], ['Emekli SGK', 30]] },
  normal: { oran: 0.0225 + 0.21 + 0.125 + 0.03, parcalar: [['SGK', 2.25], ['SGK', 21], ['SGK', 12.5], ['SGK', 3]] },
};
export const sgkOrani = (emekli) => (emekli ? SGK_ORANLARI.emekli.oran : SGK_ORANLARI.normal.oran);
export const sgkPrimi = (brut, emekli) => r2((Number(brut) || 0) * sgkOrani(emekli));

/** Toplam işveren maliyeti = net maaş + SGK primi + elden verilen. Hiçbiri zorunlu değildir. */
export const toplamMaliyet = ({ net = 0, sgk = 0, elden = 0 }) => r2((Number(net) || 0) + (Number(sgk) || 0) + (Number(elden) || 0));

/** Form girdisinden kayıt: SGK boşsa otomatik (brütten), doluysa elle. */
export function maliyetHesapla({ brut, net, emekli, sgk, elden }) {
  const b = sayi(brut) ?? 0; const n = sayi(net) ?? 0; const e = sayi(elden) ?? 0; const elle = sayi(sgk);
  const sgkTutar = elle !== null ? r2(elle) : sgkPrimi(b, !!emekli);
  return { brut: b, net: n, elden: e, sgk: sgkTutar, sgkElle: elle !== null, toplam: toplamMaliyet({ net: n, sgk: sgkTutar, elden: e }) };
}

/** Kaydın toplamı: yeni sürüm (net+SGK+elden) ya da eski (brüt+SGK+diğer). */
export const kayitToplami = (m) => (Number(m.cost_version) === 2
  ? toplamMaliyet({ net: m.net_salary, sgk: m.employer_sgk, elden: m.cash_paid })
  : r2((Number(m.gross_salary) || 0) + (Number(m.employer_sgk) || 0) + (Number(m.other_benefits) || 0)));
