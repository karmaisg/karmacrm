// OSGB 360 - Yedek dosyası oluşturma ve doğrulama (saf fonksiyonlar; DOM'a dokunmaz). Testler: tests/yedek.test.js
// Biçim: tek JSON dosyası. "ozet_sha256" tüm tablo verisinin SHA-256 özetidir; dosya sonradan bozulur/değiştirilirse doğrulama yakalar.
// Not: Bu bir geri yükleme aracı değildir; veriyi güvenle saklamak ve gerektiğinde geliştirici tarafından geri yüklemek içindir.

export const YEDEK_SURUMU = 1;
export const UYGULAMA = 'osgb360';

/** Yedeğe girecek tablolar ve sayfalamada kullanılacak sıralama sütunu. */
export const YEDEK_TABLOLARI = [
  ['organizations', 'id'], ['roles', 'id'], ['role_permissions', 'role_id'], ['users', 'id'],
  ['companies', 'id'], ['company_profiles', 'id'], ['contacts', 'id'], ['leads', 'id'], ['sales_opportunities', 'id'], ['opportunity_stage_history', 'id'],
  ['activities', 'id'], ['tasks', 'id'], ['offers', 'id'], ['offer_items', 'id'], ['contracts', 'id'], ['contract_prices', 'id'],
  ['employees', 'id'], ['employee_costs', 'id'], ['assignments', 'id'], ['time_entries', 'id'],
  ['invoices', 'id'], ['invoice_items', 'id'], ['payments', 'id'], ['expense_categories', 'id'], ['expenses', 'id'],
  ['allocation_rules', 'id'], ['overhead_allocations', 'id'], ['settings', 'id'], ['service_time_rules', 'id'],
  ['attachments', 'id'], ['notifications', 'id'], ['outbound_messages', 'id'], ['email_digest_log', 'id'], ['audit_logs', 'id'],
].map(([ad, sira]) => ({ ad, sira }));

/** Tam yedek için kullanıcının görüntüleme izni olması gereken tüm modüller (veri tabanındaki app.tam_yetkili ile aynı). */
export const TUM_MODULLER = ['dashboard', 'crm', 'companies', 'contacts', 'opportunities', 'offers', 'contracts', 'staff', 'assignments', 'time', 'invoices', 'expenses',
  'payroll', 'staff_profit', 'company_profit', 'capacity', 'reports', 'tasks', 'import_export', 'users', 'settings'];

async function sha256(metin) {
  const b = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(metin));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
}

const pad = (n) => String(n).padStart(2, '0');
export const yedekDosyaAdi = (d = new Date()) => `osgb360-yedek-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.json`;

/** tablolar: { tabloAdi: satirDizisi }. Okunamayan tablolar `eksik` listesiyle gelir; paket yine üretilir ama uyarı taşır. */
export async function yedekPaketi(tablolar, { kurum = null, simdi = new Date(), eksik = [] } = {}) {
  const sayilar = Object.fromEntries(Object.entries(tablolar).map(([a, s]) => [a, s.length]));
  const govde = JSON.stringify(tablolar);
  const paket = {
    uygulama: UYGULAMA, surum: YEDEK_SURUMU, olusturma: simdi.toISOString(), kurum,
    sayilar, toplam_satir: Object.values(sayilar).reduce((t, n) => t + n, 0), eksik_tablolar: eksik,
    ozet_sha256: await sha256(govde), tablolar,
  };
  return { dosyaAdi: yedekDosyaAdi(simdi), metin: JSON.stringify(paket), tabloSayisi: Object.keys(sayilar).length, satirSayisi: paket.toplam_satir };
}

/** Yedek dosyasının sağlam olup olmadığını denetler (veri yazmaz). */
export async function yedekDogrula(metin) {
  const sonuc = { gecerli: false, hatalar: [], uyarilar: [], tablolar: [], olusturma: null, toplamSatir: 0 };
  let p;
  try { p = JSON.parse(String(metin ?? '')); } catch { sonuc.hatalar.push('Dosya geçerli bir JSON değil; bozulmuş ya da yanlış dosya seçilmiş olabilir.'); return sonuc; }
  if (!p || typeof p !== 'object' || p.uygulama !== UYGULAMA) { sonuc.hatalar.push('Bu bir OSGB 360 yedek dosyası değil.'); return sonuc; }
  if (p.surum !== YEDEK_SURUMU) { sonuc.hatalar.push(`Desteklenmeyen yedek sürümü: ${p.surum}.`); return sonuc; }
  if (!p.tablolar || typeof p.tablolar !== 'object' || Array.isArray(p.tablolar)) { sonuc.hatalar.push('Yedekte tablo verisi yok.'); return sonuc; }
  for (const [ad, satirlar] of Object.entries(p.tablolar)) {
    if (!Array.isArray(satirlar)) { sonuc.hatalar.push(`"${ad}" tablosu bozuk (satır listesi değil).`); continue; }
    sonuc.tablolar.push({ ad, adet: satirlar.length });
    if (p.sayilar && p.sayilar[ad] !== satirlar.length) sonuc.hatalar.push(`"${ad}" tablosunda ${satirlar.length} satır var, dosya başlığı ${p.sayilar[ad]} diyor.`);
  }
  sonuc.toplamSatir = sonuc.tablolar.reduce((t, x) => t + x.adet, 0);
  sonuc.olusturma = p.olusturma ?? null;
  if (await sha256(JSON.stringify(p.tablolar)) !== p.ozet_sha256) sonuc.hatalar.push('Özet (SHA-256) tutmuyor: dosya sonradan değiştirilmiş ya da bozulmuş.');
  const beklenen = YEDEK_TABLOLARI.map((t) => t.ad).filter((a) => !(a in p.tablolar));
  if (beklenen.length) sonuc.uyarilar.push(`Bazı tablolar yedekte yok: ${beklenen.join(', ')}.`);
  if (Array.isArray(p.eksik_tablolar) && p.eksik_tablolar.length) sonuc.uyarilar.push(`Yedek alınırken okunamayan tablolar: ${p.eksik_tablolar.join(', ')}.`);
  sonuc.gecerli = sonuc.hatalar.length === 0;
  return sonuc;
}

/** Son yedekten bu yana geçen gün (tam sayı); hiç yoksa null. */
export function yedekYasi(sonIso, simdi = new Date()) {
  if (!sonIso) return null;
  const t = Date.parse(sonIso); if (Number.isNaN(t)) return null;
  return Math.max(0, Math.floor((simdi.getTime() - t) / 86400000));
}
