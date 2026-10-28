// Test amaçlı sahte supabase-js. Tarayıcıda jsDelivr isteğinin yerine sunulur (Playwright route).
// Gerçek RLS/PostgREST davranışını TAKLİT ETMEZ; yalnızca arayüz akışlarını denemek içindir.
const uid = (() => { let n = 0; return () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`; })();
const ORG = uid();
const roleKeys = ['sistem_yoneticisi', 'isletme_sahibi', 'satis', 'operasyon', 'finans', 'uzman_hekim'];
const roles = roleKeys.map((key) => ({ id: uid(), organization_id: ORG, key, name: key, is_system: true }));
const rid = (k) => roles.find((r) => r.key === k).id;
const MODULLER = ['dashboard', 'crm', 'companies', 'contacts', 'opportunities', 'offers', 'contracts', 'staff', 'assignments', 'time', 'invoices', 'expenses', 'payroll', 'staff_profit', 'company_profit', 'capacity', 'reports', 'tasks', 'import_export', 'users', 'settings'];
const izin = (tablo) => (m) => { const d = tablo[m] ?? ''; return [d.includes('v'), d.includes('c'), d.includes('e'), d.includes('a')].map(Number); };
// 01_sema.sql içindeki varsayılan matrisin aynısı (v,c,e,a)
const matris = {
  sistem_yoneticisi: () => [1, 1, 1, 1], isletme_sahibi: () => [1, 1, 1, 1],
  satis: izin({ dashboard: 'v', crm: 'vcea', companies: 'vce', contacts: 'vcea', opportunities: 'vcea', offers: 'vcea', contracts: 'v', tasks: 'vcea', reports: 'v', capacity: 'v', import_export: 'v' }),
  operasyon: izin({ dashboard: 'v', companies: 'vce', contacts: 'vce', contracts: 'v', staff: 'vce', assignments: 'vcea', time: 'vcea', capacity: 'v', tasks: 'vcea', reports: 'v', import_export: 'v' }),
  finans: izin({ dashboard: 'v', companies: 'v', contracts: 'v', invoices: 'vcea', expenses: 'vcea', payroll: 'vce', staff_profit: 'v', company_profit: 'vce', reports: 'v', tasks: 'vce', import_export: 'vc', staff: 'v' }),
  uzman_hekim: izin({ time: 'vce', tasks: 'vce', companies: 'v', assignments: 'v' }),
};
const role_permissions = [];
for (const k of roleKeys) for (const m of MODULLER) { const [v, c, e, a] = matris[k](m); role_permissions.push({ role_id: rid(k), module: m, can_view: !!v, can_create: !!c, can_edit: !!e, can_archive: !!a }); }

const kullaniciKayit = (id, email, ad, rol, sifre) => ({ id, email, sifre, row: { id, organization_id: ORG, role_id: rid(rol), full_name: ad, email, employee_id: null, is_active: true, created_at: '2026-10-01T09:00:00Z' } });
const hesaplar = [
  kullaniciKayit(uid(), 'sahip@test.com', 'Barış Sahip', 'isletme_sahibi', 'GucluSifre123'),
  kullaniciKayit(uid(), 'satis@test.com', 'Selin Satış', 'satis', 'GucluSifre123'),
  kullaniciKayit(uid(), 'finans@test.com', 'Fatih Finans', 'finans', 'GucluSifre123'),
  kullaniciKayit(uid(), 'uzman@test.com', 'Uzman Kişi', 'uzman_hekim', 'GucluSifre123'),
  kullaniciKayit(uid(), 'operasyon@test.com', 'Oya Operasyon', 'operasyon', 'GucluSifre123'),
];
// Supabase Authentication'da olup henüz kuruma eklenmemiş kullanıcı
const authSadece = [{ id: uid(), email: 'yeni@test.com' }];

const tablo = {
  organizations: [{ id: ORG, name: 'Test OSGB' }],
  roles, role_permissions,
  users: hesaplar.map((h) => h.row),
  companies: [], company_profiles: [], contacts: [], leads: [],
  sales_opportunities: [], opportunity_stage_history: [], activities: [], tasks: [],
  offers: [], offer_items: [], contracts: [], contract_prices: [],
  employees: [], employee_costs: [], assignments: [], time_entries: [],
  invoices: [], invoice_items: [], payments: [], expenses: [], allocation_rules: [], overhead_allocations: [],
  expense_categories: [['Kira', 'isletme', 'ortak', false], ['Araç yakıtı', 'isletme', 'ortak', false], ['Uzman maaşları', 'personel', 'dogrudan', true]]
    .map(([name, nature, tur, payroll], i) => ({ id: uid(), organization_id: ORG, name, nature, default_cost_type: tur, is_payroll: payroll, is_income_tax: false, sort_order: i + 1 })),
  settings: [{ key: 'kapasite_dakika', value: 11700, valid_from: '2000-01-01' }, { key: 'marj_esigi_yuzde', value: 20, valid_from: '2000-01-01' }, { key: 'varsayilan_kdv_orani', value: 20, valid_from: '2000-01-01' }],
  service_time_rules: [
    ['is_guvenligi_uzmani', 'az_tehlikeli', 10], ['is_guvenligi_uzmani', 'tehlikeli', 20], ['is_guvenligi_uzmani', 'cok_tehlikeli', 40],
    ['isyeri_hekimi', 'az_tehlikeli', 5], ['isyeri_hekimi', 'tehlikeli', 10], ['isyeri_hekimi', 'cok_tehlikeli', 15],
  ].map(([s, h, m]) => ({ id: uid(), organization_id: ORG, staff_type: s, hazard_class: h, minutes_per_employee: m, valid_from: '2000-01-01', valid_to: null })),
};
let oturum = null;
const dinleyiciler = new Set();
const gunluk = [];
globalThis.__fake = { tablo, gunluk, hesaplar };

const hata = (message, code) => ({ message, code });
const bugun = () => new Date().toISOString().slice(0, 10);
const kopya = (x) => JSON.parse(JSON.stringify(x));
const bildir = (olay, o) => { for (const cb of dinleyiciler) cb(olay, o); };

function kurucu(ad) {
  const durum = { islem: 'select', filtre: [], sira: null, aralik: null, tek: null, yukle: null };
  const calistir = () => {
    gunluk.push(`${durum.islem} ${ad}`);
    const satirlar = tablo[ad];
    if (!satirlar) return { data: null, error: hata(`tablo yok: ${ad}`) };
    let eslesen = satirlar.filter((r) => durum.filtre.every(([k, v, op]) => (op === 'gte' ? r[k] >= v : op === 'lte' ? r[k] <= v : r[k] === v)));
    const ben = tablo.users.find((u) => u.id === oturum?.user?.id);
    const alanPersoneli = ben && ben.role_id === rid('uzman_hekim');
    if (durum.islem !== 'insert' && alanPersoneli && ['time_entries', 'assignments'].includes(ad)) eslesen = eslesen.filter((r) => r.employee_id === ben.employee_id);
    if (durum.islem === 'insert') {
      const simdi = new Date().toISOString();
      const yeni = { id: uid(), organization_id: ORG, created_at: simdi, updated_at: simdi, archived_at: null, ...durum.yukle };
      if (ad === 'sales_opportunities') { yeni.stage ??= 'yeni_aday'; tablo.opportunity_stage_history.push({ id: uid(), opportunity_id: yeni.id, from_stage: null, to_stage: yeni.stage, changed_at: simdi, changed_by: oturum?.user?.id }); }
      if (ad === 'tasks') { yeni.status ??= 'acik'; yeni.priority ??= 'orta'; yeni.kind ??= 'diger'; }
      if (ad === 'offers') {
        yeni.status = 'taslak'; yeni.offer_date = bugun(); yeni.created_by = oturum?.user?.id;
        yeni.offer_no = `TKL-${yeni.offer_date.slice(0, 4)}-${String(tablo.offers.length + 1).padStart(4, '0')}`;
        if (!yeni.company_id === !yeni.lead_id) return { data: null, error: hata('Teklif için firma veya potansiyel müşteriden yalnızca biri seçilmelidir.', 'P0001') };
      }
      if (ad === 'employees') { yeni.is_active ??= true; yeni.monthly_capacity_min ??= 11700; yeni.full_name = String(yeni.full_name ?? '').trim(); if (!yeni.full_name) return { data: null, error: hata('Ad soyad zorunludur.', 'P0001') }; }
      if (ad === 'assignments') {
        const e = tablo.employees.find((x) => x.id === yeni.employee_id);
        if (!e) return { data: null, error: hata('Personel bulunamadı.', 'P0001') };
        if (e.staff_type !== yeni.staff_type) return { data: null, error: hata(`Görevlendirme türü personelin türüyle (${e.staff_type}) aynı olmalıdır.`, 'P0001') };
        if (!e.is_active || e.archived_at) return { data: null, error: hata('Pasif veya arşivdeki personel görevlendirilemez.', 'P0001') };
        const ortusen = tablo.assignments.filter((x) => !x.archived_at && x.company_id === yeni.company_id && (x.valid_from <= (yeni.valid_to ?? '9999-12-31')) && ((x.valid_to ?? '9999-12-31') >= yeni.valid_from));
        if (ortusen.some((x) => x.employee_id === yeni.employee_id && x.staff_type === yeni.staff_type)) return { data: null, error: hata('conflicting key value violates exclusion constraint "assignments_company_id_employee_id_staff_type_daterange_excl"', '23P01') };
        const toplam = ortusen.filter((x) => x.staff_type === yeni.staff_type).reduce((t, x) => t + Number(x.share_pct), 0);
        if (toplam + Number(yeni.share_pct) > 100) return { data: null, error: hata(`Bu firmada aynı dönemde ${yeni.staff_type} hizmet payı toplamı %100'ü aşıyor (mevcut: ${toplam}).`, 'P0001') };
        yeni.valid_to ??= null;
      }
      if (ad === 'time_entries') {
        const e = tablo.employees.find((x) => x.id === yeni.employee_id);
        if (!e) return { data: null, error: hata('Personel bulunamadı.', 'P0001') };
        if (alanPersoneli && yeni.employee_id !== ben.employee_id) return { data: null, error: hata('Yalnızca kendi adınıza zaman kaydı girebilirsiniz.', 'P0001') };
        yeni.work_date = new Date(new Date(yeni.start_at).getTime() + 3 * 3600000).toISOString().slice(0, 10);
        yeni.total_minutes = Math.round((new Date(yeni.end_at) - new Date(yeni.start_at)) / 60000);
        if (yeni.total_minutes <= 0) return { data: null, error: hata('check constraint', '23514') };
        if (['onsite_minutes', 'travel_minutes', 'waiting_minutes', 'reporting_minutes', 'admin_minutes'].reduce((t, k) => t + Number(yeni[k] ?? 0), 0) > yeni.total_minutes) return { data: null, error: hata('check constraint', '23514') };
        if (tablo.time_entries.some((x) => !x.archived_at && x.employee_id === yeni.employee_id && x.start_at < yeni.end_at && x.end_at > yeni.start_at)) return { data: null, error: hata('conflicting key value violates exclusion constraint "time_entries_employee_id_tstzrange_excl"', '23P01') };
        for (const k of ['onsite_minutes', 'travel_minutes', 'waiting_minutes', 'reporting_minutes', 'admin_minutes']) yeni[k] ??= 0;
      }
      if (ad === 'payments') {
        const inv = tablo.invoices.find((x) => x.id === yeni.invoice_id);
        if (!inv) return { data: null, error: hata('Fatura bulunamadı.', 'P0001') };
        if (inv.archived_at) return { data: null, error: hata('Arşivdeki faturaya tahsilat girilemez.', 'P0001') };
        if (yeni.paid_at > bugun()) return { data: null, error: hata('Tahsilat tarihi gelecekte olamaz.', 'P0001') };
        if (!(Number(yeni.amount) > 0)) return { data: null, error: hata('check constraint', '23514') };
      }
      if (ad === 'expense_categories') {
        yeni.name = String(yeni.name ?? '').trim();
        if (!yeni.name) return { data: null, error: hata('Kategori adı boş olamaz.', 'P0001') };
        if (tablo.expense_categories.some((k) => k.name === yeni.name)) return { data: null, error: hata('duplicate key value violates unique constraint "expense_categories_organization_id_name_key"', '23505') };
        yeni.is_payroll ??= false;
      }
      satirlar.push(yeni);
      if (ad === 'payments') odemeSonrasi(yeni.invoice_id);
      return { data: kopya(yeni), error: null };
    }
    if (durum.islem === 'update') {
      if (ad === 'users') {
        const u = eslesen[0];
        if (u && u.id === oturum?.user?.id && ('role_id' in durum.yukle || 'is_active' in durum.yukle)) return { data: null, error: hata('Kendi rolünüzü veya durumunuzu değiştiremezsiniz.', 'P0001') };
      }
      if (ad === 'role_permissions' && ['sistem_yoneticisi', 'isletme_sahibi'].some((k) => eslesen[0]?.role_id === rid(k))) return { data: null, error: hata('Sistem yöneticisi ve işletme sahibi yetkileri değiştirilemez.', 'P0001') };
      if (ad === 'sales_opportunities') {
        const r0 = eslesen[0];
        if (r0 && durum.yukle.stage === 'kaybedildi' && !durum.yukle.lost_reason) return { data: null, error: hata('new row violates check constraint "sales_opportunities_check"', '23514') };
        if (r0 && durum.yukle.stage && durum.yukle.stage !== r0.stage) tablo.opportunity_stage_history.push({ id: uid(), opportunity_id: r0.id, from_stage: r0.stage, to_stage: durum.yukle.stage, changed_at: new Date().toISOString(), changed_by: oturum?.user?.id });
      }
      if (ad === 'offers' && eslesen[0]) {
        const o = eslesen[0], y = durum.yukle;
        const GEC = { taslak: ['onay_bekliyor', 'gonderildi'], onay_bekliyor: ['taslak', 'gonderildi'], gonderildi: ['gorusuluyor', 'kabul_edildi', 'reddedildi', 'suresi_doldu'], gorusuluyor: ['gonderildi', 'kabul_edildi', 'reddedildi', 'suresi_doldu'], suresi_doldu: ['gonderildi', 'reddedildi'] };
        if (y.status && y.status !== o.status && !(GEC[o.status] ?? []).includes(y.status)) return { data: null, error: hata('Teklif durumu bu şekilde değiştirilemez.', 'P0001') };
        const kilit = !['taslak', 'onay_bekliyor'].includes(o.status);
        if (kilit && ['unit_price', 'fixed_monthly_price', 'employee_count', 'discount_pct', 'vat_rate', 'pricing'].some((k) => k in y && y[k] !== o[k])) return { data: null, error: hata('Gönderilmiş teklifin fiyat bilgileri değiştirilemez.', 'P0001') };
      }
      if (ad === 'contracts' && eslesen[0] && ['sona_erdi', 'feshedildi', 'yenilendi'].includes(eslesen[0].status) && !('archived_at' in durum.yukle)) return { data: null, error: hata('Sona ermiş sözleşme değiştirilemez.', 'P0001') };
      if (ad === 'assignments' && eslesen[0]) {
        const a0 = eslesen[0]; const y = durum.yukle;
        if (a0.valid_from <= bugun() && ('share_pct' in y && Number(y.share_pct) !== Number(a0.share_pct) || 'valid_from' in y && y.valid_from !== a0.valid_from)) return { data: null, error: hata('Başlamış görevlendirmenin payı ve başlangıcı değiştirilemez.', 'P0001') };
      }
      if (ad === 'employees' && eslesen[0] && durum.yukle.archived_at && tablo.assignments.some((x) => x.employee_id === eslesen[0].id && !x.archived_at && (!x.valid_to || x.valid_to >= bugun()))) return { data: null, error: hata('Açık görevlendirmesi olan personel arşivlenemez. Önce görevlendirmelerini bitirin.', 'P0001') };
      if (ad === 'time_entries' && eslesen[0]) {
        const t0 = { ...eslesen[0], ...durum.yukle };
        if ('start_at' in durum.yukle) {
          t0.total_minutes = Math.round((new Date(t0.end_at) - new Date(t0.start_at)) / 60000);
          if (tablo.time_entries.some((x) => x.id !== t0.id && !x.archived_at && x.employee_id === t0.employee_id && x.start_at < t0.end_at && x.end_at > t0.start_at)) return { data: null, error: hata('conflicting key value violates exclusion constraint "time_entries_employee_id_tstzrange_excl"', '23P01') };
          durum.yukle.total_minutes = t0.total_minutes; durum.yukle.work_date = new Date(new Date(t0.start_at).getTime() + 3 * 3600000).toISOString().slice(0, 10);
        }
      }
      if (ad === 'invoices' && eslesen[0] && durum.yukle.archived_at && tablo.payments.some((x) => x.invoice_id === eslesen[0].id && !x.archived_at)) return { data: null, error: hata('Tahsilatı olan fatura arşivlenemez. Önce tahsilat kayıtlarını iptal edin.', 'P0001') };
      if (ad === 'payments' && eslesen[0]?.archived_at) return { data: null, error: hata('İptal edilmiş tahsilat değiştirilemez.', 'P0001') };
      if (ad === 'tasks' && durum.yukle.status === 'tamamlandi') durum.yukle.completed_at = new Date().toISOString();
      if (ad === 'tasks' && durum.yukle.status && durum.yukle.status !== 'tamamlandi') durum.yukle.completed_at = null;
      eslesen.forEach((r) => Object.assign(r, durum.yukle, { updated_at: new Date().toISOString() }));
      if (ad === 'payments') eslesen.forEach((r) => odemeSonrasi(r.invoice_id));
      return durum.tek ? { data: eslesen[0] ? kopya(eslesen[0]) : null, error: eslesen[0] ? null : hata('yok', 'PGRST116') } : { data: kopya(eslesen), error: null };
    }
    let sonuc = kopya(eslesen);
    if (durum.sira) sonuc.sort((a, b) => (a[durum.sira.k] > b[durum.sira.k] ? 1 : -1) * (durum.sira.artan ? 1 : -1));
    if (durum.aralik) sonuc = sonuc.slice(durum.aralik[0], durum.aralik[1] + 1);
    if (durum.tek === 'single') return sonuc.length === 1 ? { data: sonuc[0], error: null } : { data: null, error: hata('yok', 'PGRST116') };
    if (durum.tek === 'maybe') return { data: sonuc[0] ?? null, error: null };
    return { data: sonuc, error: null };
  };
  const q = {
    select() { return q; },
    insert(v) { durum.islem = 'insert'; durum.yukle = v; return q; },
    update(v) { durum.islem = 'update'; durum.yukle = v; return q; },
    eq(k, v) { durum.filtre.push([k, v]); return q; },
    gte(k, v) { durum.filtre.push([k, v, 'gte']); return q; },
    lte(k, v) { durum.filtre.push([k, v, 'lte']); return q; },
    is(k, v) { durum.filtre.push([k, v]); return q; },
    order(k, o = {}) { durum.sira = { k, artan: o.ascending !== false }; return q; },
    range(a, b) { durum.aralik = [a, b]; return q; },
    single() { durum.tek = 'single'; return q; },
    maybeSingle() { durum.tek = 'maybe'; return q; },
    then(res, rej) { return new Promise((r) => setTimeout(r, 5)).then(calistir).then(res, rej); },
  };
  return q;
}


const kdvAyir = (t, mod, oran) => {
  if (!(Number(t) > 0)) throw new Error('Tutar sıfırdan büyük olmalıdır.');
  const k = Math.round(Number(t) * 100);
  if (mod === 'kdv_dahil') { const h = Math.round((k * 100) / (100 + Number(oran))); return { haric: h / 100, kdv: (k - h) / 100 }; }
  return { haric: k / 100, kdv: Math.round((k * Number(oran)) / 100) / 100 };
};
function faturaToplami(i) { return Math.round((Number(i.amount_excl_vat) + Number(i.vat_amount)) * 100) / 100; }
function odenen(id) { return Math.round(tablo.payments.filter((p) => p.invoice_id === id && !p.archived_at).reduce((t, p) => t + Number(p.amount) * 100, 0)) / 100; }
function odemeSonrasi(invoiceId) {
  const i = tablo.invoices.find((x) => x.id === invoiceId);
  if (i && odenen(i.id) >= faturaToplami(i)) tablo.tasks.filter((t) => t.source_ref === `fatura:${i.id}` && ['acik', 'devam_ediyor'].includes(t.status)).forEach((t) => { t.status = 'tamamlandi'; t.completed_at = new Date().toISOString(); });
}
function faturaYaz(a, id) {
  let k; try { k = kdvAyir(a.p_tutar, a.p_kdv_modu, a.p_kdv_orani); } catch (e) { return { error: hata(e.message, 'P0001') }; }
  if (a.p_vade < a.p_tarih) return { error: hata('Vade tarihi fatura tarihinden önce olamaz.', 'P0001') };
  const donem = a.p_donem ? `${a.p_donem.slice(0, 7)}-01` : null;
  const no = String(a.p_no ?? '').trim();
  if (id) {
    const i = tablo.invoices.find((x) => x.id === id); if (!i) return { error: hata('Fatura bulunamadı.', 'P0001') };
    if (no && tablo.invoices.some((x) => x.id !== id && x.invoice_no === no)) return { error: hata('duplicate key value violates unique constraint "invoices_organization_id_invoice_no_key"', '23505') };
    Object.assign(i, { contract_id: a.p_sozlesme, invoice_no: no || i.invoice_no, invoice_date: a.p_tarih, due_date: a.p_vade, service_period: donem, amount_excl_vat: k.haric, vat_amount: k.kdv, amount_incl_vat: k.haric + k.kdv, notes: a.p_not });
    const kalemler = tablo.invoice_items.filter((x) => x.invoice_id === id && !x.archived_at);
    if (kalemler.length === 1) Object.assign(kalemler[0], { description: a.p_aciklama || 'Hizmet bedeli', unit_price_excl: k.haric, vat_rate: a.p_kdv_orani });
    return { data: kopya(i) };
  }
  if (no && tablo.invoices.some((x) => x.invoice_no === no)) return { error: hata('duplicate key value violates unique constraint "invoices_organization_id_invoice_no_key"', '23505') };
  if (a.p_sozlesme && donem && tablo.invoices.some((x) => !x.archived_at && x.contract_id === a.p_sozlesme && x.service_period === donem)) return { error: hata('duplicate key value violates unique constraint "invoices_donem_uq"', '23505') };
  const yil = a.p_tarih.slice(0, 4);
  const sayac = Math.max(0, ...tablo.invoices.map((x) => { const m = x.invoice_no.match(new RegExp(`^F-${yil}-(\\d+)$`)); return m ? Number(m[1]) : 0; })) + 1;
  const simdi = new Date().toISOString();
  const i = { id: uid(), organization_id: ORG, company_id: a.p_firma, contract_id: a.p_sozlesme, invoice_no: no || `F-${yil}-${String(sayac).padStart(4, '0')}`, invoice_date: a.p_tarih, due_date: a.p_vade, service_period: donem,
    amount_excl_vat: k.haric, vat_amount: k.kdv, amount_incl_vat: k.haric + k.kdv, flag: null, notes: a.p_not, created_at: simdi, updated_at: simdi, archived_at: null };
  tablo.invoices.push(i);
  tablo.invoice_items.push({ id: uid(), organization_id: ORG, invoice_id: i.id, description: a.p_aciklama || 'Hizmet bedeli', quantity: 1, unit_price_excl: k.haric, vat_rate: a.p_kdv_orani, created_at: simdi, archived_at: null });
  return { data: kopya(i) };
}

const rpcler = {
  kurum_kullanicilari: () => tablo.users.map((u) => ({ id: u.id, full_name: u.full_name, is_active: u.is_active })),
  firma_olustur({ p_firma, p_calisan_sayisi, p_tehlike, p_baslangic }) {
    const vn = p_firma.tax_no;
    if (vn && tablo.companies.some((c) => !c.archived_at && c.tax_no === vn)) return { error: hata('duplicate key value violates unique constraint "companies_tax_no_uq"', '23505') };
    const yeni = { id: uid(), organization_id: ORG, created_at: new Date().toISOString(), archived_at: null, ...p_firma };
    tablo.companies.push(yeni);
    if (p_calisan_sayisi !== null && p_calisan_sayisi !== undefined) {
      tablo.company_profiles.push({ id: uid(), organization_id: ORG, company_id: yeni.id, employee_count: p_calisan_sayisi, hazard_class: p_tehlike, valid_from: p_baslangic, valid_to: null, note: null });
    }
    return { data: kopya(yeni) };
  },
  firma_profili_ekle({ p_firma, p_calisan_sayisi, p_tehlike, p_baslangic, p_not }) {
    const acik = tablo.company_profiles.find((p) => p.company_id === p_firma && !p.valid_to);
    if (acik) {
      if (p_baslangic <= acik.valid_from) return { error: hata('Yeni dönem, açık dönemin başlangıcından sonra olmalıdır.', 'P0001') };
      const d = new Date(`${p_baslangic}T00:00:00Z`); d.setUTCDate(d.getUTCDate() - 1);
      acik.valid_to = d.toISOString().slice(0, 10);
    }
    const yeni = { id: uid(), organization_id: ORG, company_id: p_firma, employee_count: p_calisan_sayisi, hazard_class: p_tehlike, valid_from: p_baslangic, valid_to: null, note: p_not };
    tablo.company_profiles.push(yeni);
    return { data: kopya(yeni) };
  },
  potansiyel_olustur({ p_veri }) {
    if (p_veri.tax_no && tablo.leads.some((l) => !l.archived_at && l.tax_no === p_veri.tax_no)) return { error: hata('duplicate key value violates unique constraint "leads_tax_no_uq"', '23505') };
    const simdi = new Date().toISOString();
    const yeni = { id: uid(), organization_id: ORG, created_at: simdi, updated_at: simdi, archived_at: null, converted_company_id: null, last_contact_date: null, ...p_veri };
    tablo.leads.push(yeni);
    const rol = tablo.roles.find((r) => r.id === tablo.users.find((u) => u.id === oturum?.user?.id)?.role_id);
    const izin = tablo.role_permissions.find((x) => x.role_id === rol?.id && x.module === 'opportunities');
    if (izin?.can_create) {
      const f = { id: uid(), organization_id: ORG, lead_id: yeni.id, company_id: null, title: yeni.name, stage: 'yeni_aday', expected_monthly: yeni.est_monthly_revenue ?? null, owner_user: yeni.sales_owner ?? null, created_at: simdi, updated_at: simdi, archived_at: null };
      tablo.sales_opportunities.push(f);
      tablo.opportunity_stage_history.push({ id: uid(), opportunity_id: f.id, from_stage: null, to_stage: 'yeni_aday', changed_at: simdi, changed_by: oturum?.user?.id });
    }
    return { data: kopya(yeni) };
  },
  potansiyel_firmaya_donustur({ p_lead }) {
    const l = tablo.leads.find((x) => x.id === p_lead);
    if (!l) return { error: hata('Potansiyel müşteri bulunamadı.', 'P0001') };
    if (l.converted_company_id) return { error: hata('Bu potansiyel müşteri zaten firmaya dönüştürülmüş.', 'P0001') };
    const simdi = new Date().toISOString();
    const c = { id: uid(), organization_id: ORG, created_at: simdi, archived_at: null, name: l.name, tax_no: l.tax_no, sector: l.sector, city: l.city, district: l.district, address: l.address, phone: l.phone, email: l.email, website: l.website, current_provider: l.current_provider, customer_status: 'musteri', responsible_user: l.sales_owner, notes: l.notes };
    tablo.companies.push(c);
    if (l.employee_count !== null && l.hazard_class) tablo.company_profiles.push({ id: uid(), organization_id: ORG, company_id: c.id, employee_count: l.employee_count, hazard_class: l.hazard_class, valid_from: bugun(), valid_to: null, note: 'Potansiyel müşteriden aktarıldı' });
    if (l.contact_name && !tablo.contacts.some((k) => k.lead_id === l.id && !k.archived_at)) tablo.contacts.push({ id: uid(), organization_id: ORG, company_id: c.id, lead_id: l.id, full_name: l.contact_name, title: l.contact_title, is_decision_maker: false, archived_at: null, created_at: simdi });
    tablo.contacts.filter((k) => k.lead_id === l.id && !k.company_id).forEach((k) => { k.company_id = c.id; });
    tablo.sales_opportunities.filter((f) => f.lead_id === l.id).forEach((f) => { f.company_id ??= c.id; if (!['kazanildi', 'kaybedildi', 'ertelendi'].includes(f.stage) && !f.archived_at) { tablo.opportunity_stage_history.push({ id: uid(), opportunity_id: f.id, from_stage: f.stage, to_stage: 'kazanildi', changed_at: simdi, changed_by: oturum?.user?.id }); f.stage = 'kazanildi'; } });
    tablo.activities.filter((a) => a.lead_id === l.id && !a.company_id).forEach((a) => { a.company_id = c.id; });
    tablo.tasks.filter((t) => t.lead_id === l.id && !t.company_id).forEach((t) => { t.company_id = c.id; });
    l.converted_company_id = c.id;
    return { data: kopya(c) };
  },
  teklif_kopyala({ p_offer }) {
    const o = tablo.offers.find((x) => x.id === p_offer);
    if (!o) return { error: hata('Teklif bulunamadı.', 'P0001') };
    const yeni = { ...o, id: uid(), status: 'taslak', offer_date: bugun(), created_at: new Date().toISOString(), archived_at: null, source_offer_id: o.id };
    yeni.offer_no = `TKL-${yeni.offer_date.slice(0, 4)}-${String(tablo.offers.length + 1).padStart(4, '0')}`;
    tablo.offers.push(yeni);
    tablo.offer_items.filter((k) => k.offer_id === o.id && !k.archived_at).forEach((k) => tablo.offer_items.push({ ...k, id: uid(), offer_id: yeni.id }));
    return { data: kopya(yeni) };
  },
  teklif_kabul_et({ p_offer, p_baslangic, p_bitis, p_odeme, p_yenileme, p_fiyat_guncelleme }) {
    const o = tablo.offers.find((x) => x.id === p_offer);
    if (!o) return { error: hata('Teklif bulunamadı.', 'P0001') };
    if (!['gonderildi', 'gorusuluyor'].includes(o.status)) return { error: hata('Yalnızca gönderilmiş teklif kabul edilebilir.', 'P0001') };
    if (!o.company_id) return { error: hata('Teklifi kabul etmeden önce potansiyel müşteriyi firmaya dönüştürün.', 'P0001') };
    if (tablo.contracts.some((c) => c.company_id === o.company_id && !c.archived_at && ['aktif'].includes(c.status) && c.start_date <= p_bitis && c.end_date >= p_baslangic)) return { error: hata('violates exclusion constraint "contracts_aktif_cakisma"', '23P01') };
    o.status = 'kabul_edildi';
    const simdi = new Date().toISOString();
    const c = { id: uid(), organization_id: ORG, company_id: o.company_id, offer_id: o.id, previous_contract_id: null, start_date: p_baslangic, end_date: p_bitis, status: 'aktif', expert_service: true, physician_service: true, payment_terms: p_odeme, renewal_terms: p_yenileme, price_update_terms: p_fiyat_guncelleme, owner_user: oturum?.user?.id, created_at: simdi, updated_at: simdi, archived_at: null };
    tablo.contracts.push(c);
    const indirim = 1 - Number(o.discount_pct ?? 0) / 100;
    const birim = o.pricing === 'kisi_basi' ? Math.round(Number(o.unit_price) * indirim * 100) / 100 : null;
    const sabit = o.pricing === 'kisi_basi' ? null : Math.round(Number(o.fixed_monthly_price) * indirim * 100) / 100;
    tablo.contract_prices.push({ id: uid(), organization_id: ORG, contract_id: c.id, pricing: o.pricing, unit_price: birim, fixed_monthly_price: sabit, vat_mode: o.vat_mode, vat_rate: o.vat_rate, valid_from: p_baslangic, valid_to: null, note: null, created_at: simdi });
    if (o.opportunity_id) { const f = tablo.sales_opportunities.find((x) => x.id === o.opportunity_id); if (f) f.stage = 'kazanildi'; }
    return { data: kopya(c) };
  },
  sozlesme_olustur(a) {
    if (!tablo.companies.some((c) => c.id === a.p_firma)) return { error: hata('Firma bulunamadı.', 'P0001') };
    if (a.p_durum === 'aktif' && tablo.contracts.some((c) => c.company_id === a.p_firma && !c.archived_at && c.status === 'aktif' && c.start_date <= a.p_bitis && c.end_date >= a.p_baslangic)) return { error: hata('conflicting key value violates exclusion constraint "contracts_aktif_cakisma"', '23P01') };
    const simdi = new Date().toISOString();
    const c = { id: uid(), organization_id: ORG, company_id: a.p_firma, offer_id: a.p_teklif ?? null, previous_contract_id: null, start_date: a.p_baslangic, end_date: a.p_bitis, status: a.p_durum, expert_service: a.p_uzman, physician_service: a.p_hekim, payment_terms: a.p_odeme, renewal_terms: a.p_yenileme, price_update_terms: a.p_fiyat_guncelleme, owner_user: oturum?.user?.id, created_at: simdi, updated_at: simdi, archived_at: null };
    tablo.contracts.push(c);
    tablo.contract_prices.push({ id: uid(), organization_id: ORG, contract_id: c.id, pricing: a.p_fiyatlama, unit_price: a.p_birim, fixed_monthly_price: a.p_sabit, vat_mode: a.p_kdv_modu, vat_rate: a.p_kdv_orani, valid_from: a.p_baslangic, valid_to: null, note: a.p_not, created_at: simdi });
    return { data: kopya(c) };
  },
  sozlesme_fiyat_ekle(a) {
    const acik = tablo.contract_prices.find((p) => p.contract_id === a.p_contract && !p.valid_to);
    if (acik) {
      if (a.p_baslangic <= acik.valid_from) return { error: hata('Yeni fiyat dönemi mevcut fiyatın başlangıcından sonra olmalıdır.', 'P0001') };
      const d = new Date(`${a.p_baslangic}T00:00:00Z`); d.setUTCDate(d.getUTCDate() - 1); acik.valid_to = d.toISOString().slice(0, 10);
    }
    const yeni = { id: uid(), organization_id: ORG, contract_id: a.p_contract, pricing: a.p_fiyatlama, unit_price: a.p_birim, fixed_monthly_price: a.p_sabit, vat_mode: a.p_kdv_modu, vat_rate: a.p_kdv_orani, valid_from: a.p_baslangic, valid_to: null, note: a.p_not, created_at: new Date().toISOString() };
    tablo.contract_prices.push(yeni);
    return { data: kopya(yeni) };
  },
  sozlesme_yenile(a) {
    const c = tablo.contracts.find((x) => x.id === a.p_contract);
    if (!c || c.status !== 'aktif') return { error: hata('Yalnızca aktif sözleşme yenilenebilir.', 'P0001') };
    c.status = 'yenilendi';
    const simdi = new Date().toISOString();
    const y = { ...c, id: uid(), previous_contract_id: c.id, start_date: a.p_baslangic, end_date: a.p_bitis, status: 'aktif', created_at: simdi, archived_at: null };
    tablo.contracts.push(y);
    const son = tablo.contract_prices.filter((p) => p.contract_id === c.id).sort((p, q) => (p.valid_from < q.valid_from ? 1 : -1))[0];
    if (son) tablo.contract_prices.push({ ...son, id: uid(), contract_id: y.id, valid_from: a.p_baslangic, valid_to: null, note: a.p_fiyat_notu });
    return { data: kopya(y) };
  },
  sozlesme_yenileme_gorevleri() {
    const bugunS = bugun(); let n = 0;
    for (const c of tablo.contracts.filter((x) => x.status === 'aktif' && !x.archived_at)) {
      const gun = Math.round((new Date(`${c.end_date}T00:00:00Z`) - new Date(`${bugunS}T00:00:00Z`)) / 86400000);
      const esik = [30, 60, 90].find((e) => gun <= e && gun >= 0);
      if (!esik) continue;
      const ref = `sozlesme:${c.id}:${esik}`;
      if (tablo.tasks.some((t) => t.source_ref === ref)) continue;
      tablo.tasks.push({ id: uid(), organization_id: ORG, company_id: c.company_id, title: 'Sözleşme yenileme görüşmesi', status: 'acik', priority: 'yuksek', kind: 'yenileme', source_ref: ref, due_at: null, created_at: new Date().toISOString(), archived_at: null }); n += 1;
    }
    return { data: n };
  },
  personel_listesi() {
    const ben = tablo.users.find((u) => u.id === oturum?.user?.id);
    const alan = ben && ben.role_id === rid('uzman_hekim');
    return tablo.employees.filter((e) => !alan || e.id === ben.employee_id).map((e) => ({ id: e.id, full_name: e.full_name, staff_type: e.staff_type, is_active: e.is_active, monthly_capacity_min: e.monthly_capacity_min, archived_at: e.archived_at }));
  },
  personel_kullanici_bagla({ p_employee, p_user }) {
    tablo.users.forEach((u) => { if (u.employee_id === p_employee) u.employee_id = null; });
    if (p_user) { const u = tablo.users.find((x) => x.id === p_user); if (!u) return { error: hata('Kullanıcı bulunamadı.', 'P0001') }; u.employee_id = p_employee; }
    return { data: null };
  },
  personel_maliyeti_ekle({ p_employee, p_brut, p_sgk, p_diger, p_baslangic }) {
    const acik = tablo.employee_costs.find((c) => c.employee_id === p_employee && !c.valid_to);
    if (acik) {
      if (p_baslangic <= acik.valid_from) return { error: hata('Yeni dönem, mevcut dönemin başlangıcından sonra olmalıdır.', 'P0001') };
      const d = new Date(`${p_baslangic}T00:00:00Z`); d.setUTCDate(d.getUTCDate() - 1); acik.valid_to = d.toISOString().slice(0, 10);
    }
    const y = { id: uid(), organization_id: ORG, employee_id: p_employee, gross_salary: p_brut, employer_sgk: p_sgk, other_benefits: p_diger, total_monthly_cost: Number(p_brut) + Number(p_sgk) + Number(p_diger), valid_from: p_baslangic, valid_to: null };
    tablo.employee_costs.push(y);
    return { data: kopya(y) };
  },
  gorevlendirme_degistir({ p_id, p_pay, p_baslangic, p_not }) {
    const a = tablo.assignments.find((x) => x.id === p_id && !x.archived_at);
    if (!a) return { error: hata('Görevlendirme bulunamadı.', 'P0001') };
    if (p_baslangic <= a.valid_from) return { error: hata('Yeni dönem, mevcut dönemin başlangıcından sonra olmalıdır.', 'P0001') };
    const d = new Date(`${p_baslangic}T00:00:00Z`); d.setUTCDate(d.getUTCDate() - 1);
    const eskiBitis = a.valid_to; a.valid_to = d.toISOString().slice(0, 10);
    const y = { ...a, id: uid(), share_pct: p_pay, valid_from: p_baslangic, valid_to: eskiBitis, notes: p_not ?? a.notes, created_at: new Date().toISOString() };
    tablo.assignments.push(y);
    return { data: kopya(y) };
  },
  fatura_kaydet(a) { return faturaYaz(a, a.p_id); },
  donem_faturalari_olustur({ p_donem, p_fatura_tarihi, p_vade_gun }) {
    const donem = `${p_donem.slice(0, 7)}-01`; const bit = new Date(Date.UTC(Number(donem.slice(0, 4)), Number(donem.slice(5, 7)), 0)).toISOString().slice(0, 10);
    const tarih = p_fatura_tarihi ?? bugun(); const vade = new Date(`${tarih}T00:00:00Z`); vade.setUTCDate(vade.getUTCDate() + p_vade_gun);
    let n = 0; const atlanan = [];
    for (const c of tablo.contracts.filter((x) => !x.archived_at && ['aktif', 'yenilendi', 'sona_erdi'].includes(x.status) && x.start_date <= bit && x.end_date >= donem)) {
      const firma = tablo.companies.find((x) => x.id === c.company_id)?.name ?? 'Firma';
      if (tablo.invoices.some((i) => !i.archived_at && i.contract_id === c.id && i.service_period === donem)) { atlanan.push({ firma, neden: 'Bu dönem için fatura zaten var' }); continue; }
      const gun = c.start_date > donem ? c.start_date : donem;
      const f = tablo.contract_prices.find((x) => x.contract_id === c.id && x.valid_from <= gun && (!x.valid_to || x.valid_to >= gun));
      if (!f) { atlanan.push({ firma, neden: 'Bu dönem için geçerli fiyat yok' }); continue; }
      if (f.pricing === 'ozel') { atlanan.push({ firma, neden: 'Özel fiyatlı sözleşme: faturayı elle girin' }); continue; }
      let tutar;
      if (f.pricing === 'sabit_aylik') tutar = Number(f.fixed_monthly_price);
      else {
        const pr = tablo.company_profiles.find((x) => x.company_id === c.company_id && x.valid_from <= gun && (!x.valid_to || x.valid_to >= gun));
        if (!pr) { atlanan.push({ firma, neden: 'Firma profilinde o tarih için çalışan sayısı yok' }); continue; }
        tutar = Number(f.unit_price) * pr.employee_count;
      }
      if (!(tutar > 0)) { atlanan.push({ firma, neden: 'Hesaplanan tutar sıfır' }); continue; }
      const r = faturaYaz({ p_firma: c.company_id, p_sozlesme: c.id, p_no: null, p_tarih: tarih, p_vade: vade.toISOString().slice(0, 10), p_donem: donem, p_tutar: tutar, p_kdv_modu: f.vat_mode, p_kdv_orani: f.vat_rate, p_aciklama: `İSG hizmet bedeli - ${donem.slice(0, 7)}`, p_not: null }, null);
      if (r.error) return r;
      n += 1;
    }
    return { data: { olusturulan: n, atlanan } };
  },
  tahsilat_gecikme_gorevleri() {
    let n = 0;
    for (const i of tablo.invoices.filter((x) => !x.archived_at && x.flag !== 'itirazli' && x.due_date < bugun() && faturaToplami(x) - odenen(x.id) > 0)) {
      const ref = `fatura:${i.id}`; if (tablo.tasks.some((t) => t.source_ref === ref)) continue;
      const firma = tablo.companies.find((x) => x.id === i.company_id);
      tablo.tasks.push({ id: uid(), organization_id: ORG, company_id: i.company_id, title: `${firma?.name} - ${i.invoice_no} faturasının vadesi geçti`, status: 'acik', priority: 'orta', kind: 'tahsilat_takibi', source_ref: ref, due_at: new Date().toISOString(), assignee: oturum?.user?.id, created_at: new Date().toISOString(), archived_at: null }); n += 1;
    }
    return { data: n };
  },
  gider_kaydet(a) {
    let k; try { k = kdvAyir(a.p_tutar, a.p_kdv_modu, a.p_kdv_orani); } catch (e) { return { error: hata(e.message, 'P0001') }; }
    if (a.p_tur === 'ortak' && (a.p_firma || a.p_personel)) return { error: hata('Ortak giderde firma veya personel seçilemez.', 'P0001') };
    if (a.p_tur === 'dogrudan' && !a.p_firma && !a.p_personel) return { error: hata('Doğrudan gider için firma veya personel seçilmelidir.', 'P0001') };
    if (a.p_tur === 'dogrudan' && a.p_firma && a.p_personel) return { error: hata('Doğrudan giderde firma ya da personelden yalnızca biri seçilmelidir.', 'P0001') };
    const simdi = new Date().toISOString();
    const alanlar = { category_id: a.p_kategori, expense_date: a.p_tarih, amount_excl_vat: k.haric, vat_amount: k.kdv, amount_incl_vat: k.haric + k.kdv, cost_type: a.p_tur, company_id: a.p_firma, employee_id: a.p_personel, paid: !!a.p_odendi, description: a.p_aciklama };
    if (a.p_id) { const e = tablo.expenses.find((x) => x.id === a.p_id); if (!e) return { error: hata('Gider bulunamadı.', 'P0001') }; Object.assign(e, alanlar, { updated_at: simdi }); return { data: kopya(e) }; }
    const e = { id: uid(), organization_id: ORG, created_at: simdi, updated_at: simdi, archived_at: null, ...alanlar };
    tablo.expenses.push(e); return { data: kopya(e) };
  },
  karlilik_girdileri({ p_ay }) {
    const bas = `${p_ay.slice(0, 7)}-01`; const bit = new Date(Date.UTC(Number(bas.slice(0, 4)), Number(bas.slice(5, 7)), 0)).toISOString().slice(0, 10);
    return { data: {
      atamalar: tablo.assignments.filter((a) => !a.archived_at && a.valid_from <= bit && (!a.valid_to || a.valid_to >= bas)).map((a) => ({ id: a.id, company_id: a.company_id, employee_id: a.employee_id, staff_type: a.staff_type, share_pct: a.share_pct, valid_from: a.valid_from, valid_to: a.valid_to, archived_at: null })),
      zaman: tablo.time_entries.filter((t) => !t.archived_at && t.work_date >= bas && t.work_date <= bit).map((t) => ({ employee_id: t.employee_id, company_id: t.company_id, work_date: t.work_date, activity_type: t.activity_type, onsite_minutes: t.onsite_minutes, reporting_minutes: t.reporting_minutes, archived_at: null })),
      personeller: tablo.employees.map((e) => ({ id: e.id, full_name: e.full_name, staff_type: e.staff_type, is_active: e.is_active, archived_at: e.archived_at, monthly_capacity_min: e.monthly_capacity_min })),
    } };
  },
  dagitim_olcutu_ayarla({ p_kategori, p_olcut, p_baslangic }) {
    const acik = tablo.allocation_rules.find((r) => r.category_id === p_kategori && !r.valid_to);
    if (acik) {
      if (acik.basis === p_olcut) return { data: kopya(acik) };
      if (p_baslangic <= acik.valid_from) return { error: hata('Yeni ölçüt, mevcut ölçütün başlangıcından sonra olmalıdır.', 'P0001') };
      const d = new Date(`${p_baslangic}T00:00:00Z`); d.setUTCDate(d.getUTCDate() - 1); acik.valid_to = d.toISOString().slice(0, 10);
    }
    const y = { id: uid(), organization_id: ORG, category_id: p_kategori, basis: p_olcut, valid_from: p_baslangic, valid_to: null };
    tablo.allocation_rules.push(y); return { data: kopya(y) };
  },
  ortak_gider_dagitimini_kaydet({ p_donem, p_kategori, p_olcut, p_satirlar }) {
    const donem = `${p_donem.slice(0, 7)}-01`;
    const havuz = tablo.expenses.filter((e) => !e.archived_at && e.category_id === p_kategori && e.cost_type === 'ortak' && e.expense_date.slice(0, 7) === donem.slice(0, 7)).reduce((t, e) => t + Number(e.amount_excl_vat), 0);
    const toplam = p_satirlar.reduce((t, x) => t + Number(x.amount), 0);
    if (toplam > havuz + 0.005) return { error: hata(`Dağıtılan toplam (${toplam}) ilgili ortak gider havuzunu (${havuz}) aşıyor.`, 'P0001') };
    tablo.overhead_allocations.filter((a) => a.category_id === p_kategori && a.period === donem && !a.archived_at).forEach((a) => { a.amount = 0; a.basis = p_olcut; });
    for (const x of p_satirlar) {
      const var_ = tablo.overhead_allocations.find((a) => a.category_id === p_kategori && a.period === donem && a.company_id === x.company_id && !a.archived_at);
      if (var_) { var_.amount = Number(x.amount); var_.basis = p_olcut; } else tablo.overhead_allocations.push({ id: uid(), organization_id: ORG, period: donem, category_id: p_kategori, company_id: x.company_id, basis: p_olcut, amount: Number(x.amount), archived_at: null });
    }
    return { data: p_satirlar.length };
  },
  kullanici_ekle({ p_email, p_ad_soyad, p_rol }) {
    const a = authSadece.find((x) => x.email === p_email.toLowerCase());
    if (!a) return { error: hata('Bu e-posta ile Authentication içinde hesabı bulunamadı.', 'P0001') };
    const row = { id: a.id, organization_id: ORG, role_id: rid(p_rol), full_name: p_ad_soyad, email: p_email, employee_id: null, is_active: true, created_at: new Date().toISOString() };
    tablo.users.push(row);
    return { data: kopya(row) };
  },
};

export function createClient() {
  return {
    auth: {
      async getSession() { return { data: { session: oturum }, error: null }; },
      async signInWithPassword({ email, password }) {
        await new Promise((r) => setTimeout(r, 20));
        const h = hesaplar.find((x) => x.email === email && x.sifre === password);
        if (!h) return { data: { session: null }, error: { message: 'Invalid login credentials', code: 'invalid_credentials', status: 400 } };
        oturum = { user: { id: h.id, email: h.email } };
        setTimeout(() => bildir('SIGNED_IN', oturum), 0);
        return { data: { session: oturum }, error: null };
      },
      async signOut() { oturum = null; setTimeout(() => bildir('SIGNED_OUT', null), 0); return { error: null }; },
      async resetPasswordForEmail(email, o) { gunluk.push(`reset ${email} ${o?.redirectTo}`); return { error: null }; },
      async updateUser({ password }) { gunluk.push(`updateUser ${password.length}`); return { data: {}, error: null }; },
      onAuthStateChange(cb) {
        dinleyiciler.add(cb);
        setTimeout(() => cb('INITIAL_SESSION', oturum), 0);
        return { data: { subscription: { unsubscribe: () => dinleyiciler.delete(cb) } } };
      },
    },
    from: kurucu,
    async rpc(ad, args) {
      gunluk.push(`rpc ${ad}`);
      await new Promise((r) => setTimeout(r, 5));
      const f = rpcler[ad];
      if (!f) return { data: null, error: hata(`rpc yok: ${ad}`) };
      const s = f(args ?? {});
      return { data: s.data ?? (Array.isArray(s) ? s : null), error: s.error ?? null };
    },
  };
}
export { bugun };
