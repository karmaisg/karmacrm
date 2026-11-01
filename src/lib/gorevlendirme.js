// OSGB 360 - Aşama 14: İSG-Katip satırlarından görevlendirme önerisi (saf fonksiyonlar, veritabanına dokunmaz).
// Mantık: firma + personel türü bazında kişinin Katip dakikası / firmanın o ayki teorik ihtiyacı = hizmet payı (%).
import { trKucukAscii } from './katip.js';
import { firmaAylikIhtiyac } from './hesaplama.js';
import { aktifMi, PERSONEL_TURU_KISA } from './operasyon.js';

const TURLER = ['is_guvenligi_uzmani', 'isyeri_hekimi'];
const yuzde = (x) => Math.floor(x * 100 + 1e-9) / 100;     // aşağı yuvarla: toplam asla %100'ü aşmasın
const kisiAnahtari = (s) => (s.cert_no ? `s:${String(s.cert_no).trim()}` : `a:${trKucukAscii(s.person_name)}`);

/**
 * @param satirlar   katip_rows kayıtları (site_id dolu olanlar)
 * @param siteler    company_sites kayıtları (id → company_id)
 * @param firmalar   companies
 * @param profilHaritasi Map(company_id → profil listesi)
 * @param kurallar   service_time_rules
 * @param calisanlar employees
 * @param atamalar   assignments
 * @param tarih      geçerlilik tarihi (YYYY-MM-DD, genellikle dönemin ilk günü)
 */
export function gorevlendirmeOnerisi({ satirlar, siteler, firmalar, profilHaritasi, kurallar, calisanlar, atamalar, tarih }) {
  const siteFirma = new Map(siteler.map((s) => [s.id, s.company_id]));
  const firmaAdi = new Map(firmalar.map((f) => [f.id, f.name]));
  const personel = calisanlar.filter((e) => !e.archived_at);
  const sertHaritasi = new Map(personel.filter((e) => e.certificate_no).map((e) => [String(e.certificate_no).trim(), e]));
  const adHaritasi = new Map();
  for (const e of personel) { const k = `${e.staff_type}|${trKucukAscii(e.full_name)}`; if (!adHaritasi.has(k)) adHaritasi.set(k, e); }

  const atlanan = []; const gruplar = new Map(); const uyarilar = [];
  for (const s of satirlar) {
    const firmaId = siteFirma.get(s.site_id);
    if (!firmaId || !firmaAdi.has(firmaId)) continue;
    if (!TURLER.includes(s.staff_type)) { atlanan.push({ firmaId, ad: s.person_name, tur: s.staff_type }); continue; }
    const g = `${firmaId}|${s.staff_type}|${kisiAnahtari(s)}`;
    const o = gruplar.get(g) ?? { firmaId, tur: s.staff_type, anahtar: kisiAnahtari(s), ad: s.person_name, sertNo: s.cert_no ?? null, sertTip: s.cert_type ?? null, dakika: 0, sozlesmeler: new Set(), baslangic: null };
    o.dakika += Number(s.minutes_per_month) || 0;
    if (s.contract_id) o.sozlesmeler.add(String(s.contract_id));
    if (s.start_date && (!o.baslangic || s.start_date < o.baslangic)) o.baslangic = s.start_date;
    gruplar.set(g, o);
  }

  // kişiyi personele bağla
  const yeniKisiler = new Map(); const baglar = new Map();
  const coz = (o) => {
    let e = o.sertNo ? sertHaritasi.get(String(o.sertNo).trim()) : null;
    if (e && e.staff_type !== o.tur) { uyarilar.push(`${o.ad}: sertifika numarası başka türdeki personele (${e.full_name}) ait; yeni personel olarak önerildi.`); e = null; }
    if (!e) {
      const a = adHaritasi.get(`${o.tur}|${trKucukAscii(o.ad)}`);
      if (a && (!a.certificate_no || !o.sertNo || String(a.certificate_no).trim() === String(o.sertNo).trim())) {
        e = a;
        if (o.sertNo && !a.certificate_no) baglar.set(a.id, { employee_id: a.id, sertifika_no: String(o.sertNo).trim() });
      }
    }
    if (e) return { empId: e.id, ref: null, yeni: false, ad: e.full_name };
    const ref = `k:${o.tur}:${o.anahtar}`;
    if (!yeniKisiler.has(ref)) yeniKisiler.set(ref, { ref, ad: o.ad, tur: o.tur, sertifika_tipi: o.sertTip, sertifika_no: o.sertNo });
    return { empId: null, ref, yeni: true, ad: o.ad };
  };

  const firmaIdleri = [...new Set([...gruplar.values()].map((o) => o.firmaId))];
  const sonuc = [];
  for (const firmaId of firmaIdleri) {
    const ih = firmaAylikIhtiyac({ profiller: profilHaritasi.get(firmaId) ?? [], kurallar, ay: `${tarih.slice(0, 7)}-01` });
    const turler = [];
    for (const tur of TURLER) {
      const kisiler = [...gruplar.values()].filter((o) => o.firmaId === firmaId && o.tur === tur);
      const mevcut = atamalar.filter((a) => a.company_id === firmaId && a.staff_type === tur && aktifMi(a, tarih));
      if (!kisiler.length && !mevcut.length) continue;
      const ihtiyac = tur === 'is_guvenligi_uzmani' ? ih.uzmanDakika : ih.hekimDakika;
      const t = { tur, ihtiyac, satirlar: [], bitenler: [], uyarilar: [] };
      if (!kisiler.length) { turler.push({ ...t, atla: true }); continue; }   // Katip'te bu tür hiç yok: dokunma, sadece bilgi
      if (!ihtiyac || ihtiyac <= 0) {
        t.atla = true; t.uyarilar.push(`${PERSONEL_TURU_KISA[tur]} payı hesaplanamadı: ${ih.eksik ?? 'firmanın teorik ihtiyacı sıfır.'} Önce firma kartında çalışan sayısı/tehlike sınıfını tamamlayın.`);
        turler.push(t); continue;
      }
      const ham = kisiler.map((o) => ({ o, ham: (o.dakika / ihtiyac) * 100 }));
      const toplam = ham.reduce((s, x) => s + x.ham, 0);
      if (toplam > 100.0001) t.uyarilar.push(`${PERSONEL_TURU_KISA[tur]} Katip süreleri toplamı firmanın teorik ihtiyacının %${Math.round(toplam)}'i; paylar %100'e oranlandı. Çalışan sayısı/tehlike sınıfı güncel mi kontrol edin.`);
      else if (toplam < 99) t.uyarilar.push(`${PERSONEL_TURU_KISA[tur]} Katip süreleri teorik ihtiyacın %${Math.round(toplam)}'ini karşılıyor; kalan kısım atanmamış görünecek.`);
      const olcek = toplam > 100 ? 100 / toplam : 1;
      const eslesen = new Set();
      for (const { o, ham: h } of ham) {
        const k = coz(o);
        const pay = Math.max(0.01, yuzde(h * olcek));
        const eski = k.empId ? mevcut.find((a) => a.employee_id === k.empId) : null;
        if (eski) eslesen.add(eski.id);
        const resmi = [...o.sozlesmeler].join(', ') || null;
        let islem = 'ekle';
        if (eski) islem = Math.abs(Number(eski.share_pct) - pay) < 0.01 ? 'degismedi' : 'degistir';
        t.satirlar.push({ kisi: k, tur, dakika: o.dakika, pay, eskiPay: eski ? Number(eski.share_pct) : null, assignmentId: eski?.id ?? null, islem, resmi, resmiBaslangic: o.baslangic });
      }
      for (const a of mevcut) {
        if (eslesen.has(a.id)) continue;
        const e = calisanlar.find((x) => x.id === a.employee_id);
        t.bitenler.push({ assignmentId: a.id, ad: e?.full_name ?? '—', pay: Number(a.share_pct) });
      }
      const yeniAdlar = t.satirlar.filter((x) => x.islem === 'ekle').map((x) => x.kisi.ad);
      if (t.bitenler.length || (yeniAdlar.length && mevcut.length)) {
        t.uyarilar.push(`${PERSONEL_TURU_KISA[tur]} değişikliği: ${t.bitenler.length ? `${t.bitenler.map((b) => b.ad).join(', ')} görevden çıkıyor` : ''}${t.bitenler.length && yeniAdlar.length ? '; ' : ''}${yeniAdlar.length ? `${yeniAdlar.join(', ')} ${mevcut.length ? 'ekleniyor' : 'atanıyor'}` : ''}.`);
      }
      turler.push(t);
    }
    if (turler.length) sonuc.push({ firmaId, ad: firmaAdi.get(firmaId), turler, uyari: turler.some((t) => t.uyarilar.length) });
  }
  sonuc.sort((a, b) => a.ad.localeCompare(b.ad, 'tr'));
  const sayim = { eklenecek: 0, degisecek: 0, bitecek: 0, degismeyen: 0 };
  for (const f of sonuc) for (const t of f.turler) { if (t.atla) continue; for (const x of t.satirlar) sayim[{ ekle: 'eklenecek', degistir: 'degisecek', degismedi: 'degismeyen' }[x.islem]]++; sayim.bitecek += t.bitenler.length; }
  return { firmalar: sonuc, yeniKisiler: [...yeniKisiler.values()], baglar: [...baglar.values()], atlanan, uyarilar, sayim, tarih };
}

/** Seçili firmalar için RPC paketini kurar; işlem sırası: bitir → azalt → artır → ekle (toplam pay hiçbir adımda %100'ü aşmasın). */
export function gorevlendirmePaketi(oneri, secili, yuklemeId) {
  const islemler = []; const kullanilanRef = new Set(); const kullanilanBag = new Set();
  const sirali = { bitir: [], azalt: [], artir: [], ekle: [] };
  for (const f of oneri.firmalar) {
    if (!secili.has(f.firmaId)) continue;
    for (const t of f.turler) {
      if (t.atla) continue;
      for (const b of t.bitenler) sirali.bitir.push({ islem: 'bitir', assignment_id: b.assignmentId });
      for (const x of t.satirlar) {
        if (x.islem === 'degismedi') continue;
        if (x.kisi.empId && oneri.baglar.some((b) => b.employee_id === x.kisi.empId)) kullanilanBag.add(x.kisi.empId);
        if (x.islem === 'degistir') sirali[x.pay < x.eskiPay ? 'azalt' : 'artir'].push({ islem: 'degistir', assignment_id: x.assignmentId, pay: x.pay, resmi_ref: x.resmi, resmi_baslangic: x.resmiBaslangic });
        else {
          if (x.kisi.ref) kullanilanRef.add(x.kisi.ref);
          sirali.ekle.push({ islem: 'ekle', company_id: f.firmaId, employee_id: x.kisi.empId, employee_ref: x.kisi.ref, tur: x.tur, pay: x.pay, resmi_ref: x.resmi, resmi_baslangic: x.resmiBaslangic });
        }
      }
    }
  }
  islemler.push(...sirali.bitir, ...sirali.azalt, ...sirali.artir, ...sirali.ekle);
  return {
    yukleme_id: yuklemeId ?? null, tarih: oneri.tarih,
    kisiler: oneri.yeniKisiler.filter((k) => kullanilanRef.has(k.ref)),
    baglar: oneri.baglar.filter((b) => kullanilanBag.has(b.employee_id)),
    islemler,
  };
}
