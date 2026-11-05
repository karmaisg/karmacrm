// OSGB 360 - Takvim yardımcıları (saf fonksiyonlar). Üretim mantığı veritabanındaki app.takvim_olaylari ile aynıdır;
// bu kopya ekran testleri (sahte veritabanı) ve birim testleri içindir.
const gunDizgesi = (d) => d.toISOString().slice(0, 10);
const utc = (iso) => new Date(`${iso}T00:00:00Z`);
export const gunEkle = (iso, n) => { const d = utc(iso); d.setUTCDate(d.getUTCDate() + n); return gunDizgesi(d); };
export const ayBasi = (iso) => `${String(iso).slice(0, 7)}-01`;
export const ayEkle = (iso, n) => { const d = utc(ayBasi(iso)); d.setUTCMonth(d.getUTCMonth() + n); return gunDizgesi(d); };
export const ayinSonu = (iso) => { const d = utc(ayEkle(iso, 1)); d.setUTCDate(0); return gunDizgesi(d); };
export const gunFarki = (a, b) => Math.round((utc(a) - utc(b)) / 86400000);

/** Ayın görünür ızgarası: pazartesi başlangıçlı, tam haftalardan oluşan gün dizgeleri. */
export function ayIzgarasi(ayIso) {
  const ilk = ayBasi(ayIso); const son = ayinSonu(ayIso);
  const gunNo = (utc(ilk).getUTCDay() + 6) % 7;        // pazartesi = 0
  let g = gunEkle(ilk, -gunNo); const haftalar = [];
  while (g <= son) { haftalar.push(Array.from({ length: 7 }, (_, i) => gunEkle(g, i))); g = gunEkle(g, 7); }
  return haftalar;
}

export const kalanGunMetni = (n) => (n === 0 ? 'bugün' : n === 1 ? 'yarın' : n > 1 ? `${n} gün kaldı` : `${-n} gün önce`);

/** Aylık tekrar: ilk tarihin günü her ay; ayda o gün yoksa ayın son günü. Yıllık tekrar: her yıl aynı gün ve ay (29 Şubat → olmayan yıllarda 28 Şubat). */
export function ogeGunleri(oge, bas, bit) {
  if (oge.recurrence === 'yillik') {
    const ay = Number(oge.start_date.slice(5, 7)); const gun = Number(oge.start_date.slice(8, 10)); const l = [];
    for (let y = Number(bas.slice(0, 4)); y <= Number(bit.slice(0, 4)); y++) {
      const ayIlk = `${y}-${String(ay).padStart(2, '0')}-01`; const son = Number(ayinSonu(ayIlk).slice(8, 10));
      const g = `${y}-${String(ay).padStart(2, '0')}-${String(Math.min(gun, son)).padStart(2, '0')}`;
      if (g >= bas && g <= bit && g >= oge.start_date && (!oge.end_date || g <= oge.end_date)) l.push(g);
    }
    return l;
  }
  if (oge.recurrence !== 'aylik') return oge.start_date >= bas && oge.start_date <= bit ? [oge.start_date] : [];
  const gun = Number(oge.start_date.slice(8, 10)); const l = [];
  for (let ay = ayBasi(bas); ay <= bit; ay = ayEkle(ay, 1)) {
    const son = ayinSonu(ay); const g = `${ay.slice(0, 8)}${String(Math.min(gun, Number(son.slice(8, 10)))).padStart(2, '0')}`;
    if (g >= bas && g <= bit && g >= oge.start_date && (!oge.end_date || g <= oge.end_date)) l.push(g);
  }
  return l;
}

const istanbulGunu = (ts) => new Date(ts).toLocaleDateString('sv-SE', { timeZone: 'Europe/Istanbul' });

export function olaylariUret({ ogeler = [], tamamlamalar = [], gorevler = [], firmaAdi = new Map(), bas, bit }) {
  const l = [];
  for (const o of ogeler) {
    if (o.archived_at) continue;
    for (const g of ogeGunleri(o, bas, bit)) {
      l.push({ tarih: g, kaynak: 'takvim', ref: o.id, baslik: o.title, firma: firmaAdi.get(o.company_id) ?? null, tutar: o.amount ?? null,
        tamam: tamamlamalar.some((k) => k.item_id === o.id && k.occurrence_date === g), tekrar: o.recurrence === 'aylik' || o.recurrence === 'yillik', tur: o.kind, oncelik: null });
    }
  }
  for (const t of gorevler) {
    if (t.archived_at || !['acik', 'devam_ediyor'].includes(t.status)) continue;
    for (const [alan, kaynak] of [['due_at', 'gorev_son'], ['remind_at', 'gorev_hatirlatma']]) {
      if (!t[alan]) continue; const g = istanbulGunu(t[alan]);
      if (g >= bas && g <= bit) l.push({ tarih: g, kaynak, ref: t.id, baslik: t.title, firma: firmaAdi.get(t.company_id) ?? null, tutar: null, tamam: false, tekrar: false, tur: 'gorev', oncelik: t.priority ?? null });
    }
  }
  return l.sort((a, b) => a.tarih.localeCompare(b.tarih) || a.baslik.localeCompare(b.baslik, 'tr'));
}

/** Günlere göre grupla: Map(tarih → olaylar) */
export function gunlereGore(olaylar) {
  const m = new Map(); for (const o of olaylar) { if (!m.has(o.tarih)) m.set(o.tarih, []); m.get(o.tarih).push(o); }
  return m;
}
