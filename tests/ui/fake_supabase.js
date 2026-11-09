// Test amaçlı sahte supabase-js. Tarayıcıda jsDelivr isteğinin yerine sunulur (Playwright route).
// Gerçek RLS/PostgREST davranışını TAKLİT ETMEZ; yalnızca arayüz akışlarını denemek içindir.
const uid = (() => { let n = 0; return () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`; })();
const ORG = uid();
const roleKeys = ['sistem_yoneticisi', 'isletme_sahibi', 'satis', 'operasyon', 'finans', 'uzman_hekim'];
const roles = roleKeys.map((key) => ({ id: uid(), organization_id: ORG, key, name: key, is_system: true }));
const rid = (k) => roles.find((r) => r.key === k).id;
const MODULLER = ['dashboard', 'crm', 'companies', 'contacts', 'opportunities', 'offers', 'contracts', 'staff', 'assignments', 'time', 'invoices', 'expenses', 'payroll', 'staff_profit', 'company_profit', 'capacity', 'reports', 'tasks', 'import_export', 'users', 'settings', 'admin_affairs', 'budget'];
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
  email_digest_log: [],
  settings: [{ key: 'kapasite_dakika', value: 11700, valid_from: '2000-01-01' }, { key: 'marj_esigi_yuzde', value: 20, valid_from: '2000-01-01' }, { key: 'varsayilan_kdv_orani', value: 20, valid_from: '2000-01-01' }],
  service_time_rules: [
    ['is_guvenligi_uzmani', 'az_tehlikeli', 10], ['is_guvenligi_uzmani', 'tehlikeli', 20], ['is_guvenligi_uzmani', 'cok_tehlikeli', 40],
    ['isyeri_hekimi', 'az_tehlikeli', 5], ['isyeri_hekimi', 'tehlikeli', 10], ['isyeri_hekimi', 'cok_tehlikeli', 15],
  ].map(([s, h, m]) => ({ id: uid(), organization_id: ORG, staff_type: s, hazard_class: h, minutes_per_employee: m, valid_from: '2000-01-01', valid_to: null })),
};
// Aşama 11: yedeğe giren ama henüz tanımlı olmayan tablolar boş gelir; denetim kaydı testlerde doldurulur
for (const ad of ['budget_expense_lines', 'budget_lines', 'signed_contracts', 'offer_shares', 'company_profiles', 'leads', 'attachments', 'notifications', 'outbound_messages', 'email_digest_log', 'audit_logs', 'company_sites', 'katip_imports', 'katip_rows', 'katip_people', 'calendar_items', 'calendar_completions', 'invoice_aliases', 'expense_imports', 'expense_row_map', 'employee_leaves', 'vehicles', 'vehicle_records', 'admin_documents']) tablo[ad] ??= [];
if (globalThis.__fakeTohum) for (const [k, v] of Object.entries(JSON.parse(globalThis.__fakeTohum))) tablo[k] = v;
let oturum = null;
const izinVar = (modul, alan) => {
  const rol = tablo.roles.find((r) => r.id === tablo.users.find((u) => u.id === oturum?.user?.id)?.role_id);
  return !!tablo.role_permissions.find((x) => x.role_id === rol?.id && x.module === modul)?.[alan];
};

function paylasimBul(token) {
  if (!/^[0-9a-f]{64}$/.test(String(token ?? ''))) return null;
  const s = tablo.offer_shares.find((x) => x.token_hash === token && !x.revoked_at && new Date(x.expires_at).getTime() > Date.now());
  const o = s && tablo.offers.find((x) => x.id === s.offer_id);
  return s && o && !o.archived_at && !['taslak', 'onay_bekliyor'].includes(o.status) ? s : null;
}
const dinleyiciler = new Set();
const gunluk = [];
const ozetAyar = { varsa: true, sonuc: 'ok' }; // UI testleri: varsa=false → fonksiyon kurulu değil (404); sonuc: 'ok' | 'yapilandirma' | 'ag'
globalThis.__fake = { tablo, gunluk, hesaplar, ozetAyar, depoSayisi: () => depo.size };

const hata = (message, code) => ({ message, code });
const bugun = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Istanbul' });
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
    if (durum.islem === 'insert' && Array.isArray(durum.yukle)) {
      const simdi0 = new Date().toISOString();
      const eklenen = durum.yukle.map((y) => ({ id: uid(), organization_id: ORG, created_at: simdi0, updated_at: simdi0, ...y }));
      satirlar.push(...eklenen); return { data: eklenen, error: null };
    }
    if (durum.islem === 'insert') {
      const simdi = new Date().toISOString();
      const yeni = { id: uid(), organization_id: ORG, created_at: simdi, updated_at: simdi, archived_at: null, ...durum.yukle };
      if (ad === 'sales_opportunities') { yeni.stage ??= 'yeni_aday'; tablo.opportunity_stage_history.push({ id: uid(), opportunity_id: yeni.id, from_stage: null, to_stage: yeni.stage, changed_at: simdi, changed_by: oturum?.user?.id }); }
      if (ad === 'calendar_items' && !izinVar('tasks', 'can_create')) return { data: null, error: hata('new row violates row-level security policy for table "calendar_items"', '42501') };
      if (ad === 'calendar_completions' && tablo.calendar_completions.some((x) => x.item_id === yeni.item_id && x.occurrence_date === yeni.occurrence_date)) return { data: null, error: hata('duplicate key value violates unique constraint', '23505') };
      if (ad === 'tasks') { yeni.status ??= 'acik'; yeni.priority ??= 'orta'; yeni.kind ??= 'diger'; }
      if (ad === 'offers') {
        yeni.status = 'taslak'; yeni.offer_date = bugun(); yeni.created_by = oturum?.user?.id;
        yeni.offer_no = `TKL-${yeni.offer_date.slice(0, 4)}-${String(tablo.offers.length + 1).padStart(4, '0')}`;
        if (!yeni.company_id === !yeni.lead_id) return { data: null, error: hata('Teklif için firma veya potansiyel müşteriden yalnızca biri seçilmelidir.', 'P0001') };
      }
      if (ad === 'employees') { if (!yeni.staff_type && !yeni.role_kind) return { data: null, error: hata('new row for relation "employees" violates check constraint "employees_role_kind_chk"', '23514') }; yeni.monthly_capacity_min ??= 11700; yeni.is_management ??= false; yeni.is_active ??= true; yeni.monthly_capacity_min ??= 11700; yeni.full_name = String(yeni.full_name ?? '').trim(); if (!yeni.full_name) return { data: null, error: hata('Ad soyad zorunludur.', 'P0001') }; }
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
      if (['employee_leaves', 'vehicles', 'vehicle_records', 'admin_documents'].includes(ad) && !izinVar('admin_affairs', 'can_create')) return { data: null, error: hata(`new row violates row-level security policy for table "${ad}"`, '42501') };
      if (ad === 'admin_documents' && globalThis.__belgeKayitHata) return { data: null, error: hata('kayıt hatası', 'P0001') };
      if (ad === 'vehicles') {
        yeni.plate = String(yeni.plate ?? '').replace(/\s+/g, '').toUpperCase();
        if (tablo.vehicles.some((v) => !v.archived_at && v.plate === yeni.plate)) return { data: null, error: hata('duplicate key value violates unique constraint "vehicles_plate_uq"', '23505') };
      }
      if (ad === 'employee_leaves' && yeni.end_date < yeni.start_date) return { data: null, error: hata('check constraint', '23514') };
      if (ad === 'admin_documents' && !String(yeni.storage_path).startsWith(`${ORG}/`)) return { data: null, error: hata('Dosya yolu kuruma ait değil.', 'P0001') };
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
    if (durum.islem === 'delete') {
      if (ad === 'calendar_completions' && !izinVar('tasks', 'can_edit')) return { data: null, error: hata('new row violates row-level security policy', '42501') };
      for (const r of eslesen) satirlar.splice(satirlar.indexOf(r), 1);
      return { data: kopya(eslesen), error: null };
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
    delete() { durum.islem = 'delete'; return q; },
    eq(k, v) { durum.filtre.push([k, v]); return q; },
    gte(k, v) { durum.filtre.push([k, v, 'gte']); return q; },
    lte(k, v) { durum.filtre.push([k, v, 'lte']); return q; },
    is(k, v) { durum.filtre.push([k, v]); return q; },
    order(k, o = {}) { durum.sira = { k, artan: o.ascending !== false }; return q; },
    range(a, b) { durum.aralik = [a, b]; return q; },
    limit(n) { durum.aralik = [0, n - 1]; return q; },
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
  katip_aylik_calisan() {
    const en = new Map();   // (dönem, sicil) → en son aktarımdaki satır
    for (const r of tablo.katip_rows) {
      const imp = tablo.katip_imports.find((i) => i.id === r.import_id); const site = tablo.company_sites.find((x) => x.id === r.site_id); if (!imp || !site?.company_id) continue;
      const k = `${imp.period}|${r.sgk_no}`; const o = en.get(k);
      if (!o || String(imp.created_at) >= String(o.at)) en.set(k, { at: imp.created_at, period: imp.period, company_id: site.company_id, hazard_class: r.hazard_class, employee_count: r.employee_count });
    }
    const t = new Map();
    for (const x of en.values()) { const k = `${x.period}|${x.company_id}|${x.hazard_class}`; const e = t.get(k) ?? { period: x.period, company_id: x.company_id, hazard_class: x.hazard_class, employee_count: 0 }; e.employee_count += x.employee_count; t.set(k, e); }
    return { data: [...t.values()] };
  },
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
  // Aşama 16: takvim_olaylari'nın taklidi (gerçeği 17_asama16.sql, aynı mantık src/lib/takvim.js'te)
  takvim_olaylari({ p_bas, p_bit }) {
    if (!izinVar('tasks', 'can_view')) return { error: hata('Takvimi görme yetkiniz yok.', 'P0001') };
    const gunEkle = (iso, n) => { const x = new Date(`${iso}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
    const ayEkle = (iso, n) => { const x = new Date(`${iso.slice(0, 7)}-01T00:00:00Z`); x.setUTCMonth(x.getUTCMonth() + n); return x.toISOString().slice(0, 10); };
    const sonGun = (iso) => gunEkle(ayEkle(iso, 1), -1);
    const firma = (id) => tablo.companies.find((c) => c.id === id)?.name ?? null;
    const l = [];
    for (const o of tablo.calendar_items.filter((x) => !x.archived_at)) {
      const gunler = [];
      if (o.recurrence === 'yillik') { for (let y = Number(p_bas.slice(0, 4)); y <= Number(p_bit.slice(0, 4)); y++) { const ay = o.start_date.slice(5, 7); const son = new Date(Date.UTC(y, Number(ay), 0)).getUTCDate(); const g = `${y}-${ay}-${String(Math.min(Number(o.start_date.slice(8, 10)), son)).padStart(2, '0')}`; if (g >= p_bas && g <= p_bit && g >= o.start_date && (!o.end_date || g <= o.end_date)) gunler.push(g); } }
      else if (o.recurrence !== 'aylik') { if (o.start_date >= p_bas && o.start_date <= p_bit) gunler.push(o.start_date); }
      else { const dn = Number(o.start_date.slice(8, 10)); for (let ay = `${p_bas.slice(0, 7)}-01`; ay <= p_bit; ay = ayEkle(ay, 1)) { const g = `${ay.slice(0, 8)}${String(Math.min(dn, Number(sonGun(ay).slice(8)))).padStart(2, '0')}`; if (g >= p_bas && g <= p_bit && g >= o.start_date && (!o.end_date || g <= o.end_date)) gunler.push(g); } }
      for (const g of gunler) l.push({ tarih: g, kaynak: 'takvim', ref: o.id, baslik: o.title, firma: firma(o.company_id), tutar: o.amount ?? null, tamam: tablo.calendar_completions.some((k) => k.item_id === o.id && k.occurrence_date === g), tekrar: o.recurrence !== 'yok', tur: o.kind, oncelik: null });
    }
    const gun = (ts) => new Date(ts).toLocaleDateString('sv-SE', { timeZone: 'Europe/Istanbul' });
    for (const t of tablo.tasks.filter((x) => !x.archived_at && ['acik', 'devam_ediyor'].includes(x.status))) {
      for (const [alan, kaynak] of [['due_at', 'gorev_son'], ['remind_at', 'gorev_hatirlatma']]) { if (!t[alan]) continue; const g = gun(t[alan]); if (g >= p_bas && g <= p_bit) l.push({ tarih: g, kaynak, ref: t.id, baslik: t.title, firma: firma(t.company_id), tutar: null, tamam: false, tekrar: false, tur: 'gorev', oncelik: t.priority }); }
    }
    return { data: l.sort((a, b) => a.tarih.localeCompare(b.tarih) || a.baslik.localeCompare(b.baslik, 'tr')) };
  },
  // Aşama 14: gerçek katip_gorevlendir'in (15_asama14.sql) basitleştirilmiş taklidi
  katip_gorevlendir({ p_paket: p }) {
    if (!izinVar('assignments', 'can_create') || !izinVar('assignments', 'can_edit') || !izinVar('staff', 'can_create')) return { error: hata('Bu işlem için görevlendirme ve personel ekleme/düzenleme yetkisi gerekir.', 'P0001') };
    const tarih = p.tarih; const ref = {}; const simdi = new Date().toISOString(); let kisi = 0; let bag = 0; let ekle = 0; let degis = 0; let bitir = 0;
    const gun = (iso, n) => { const x = new Date(`${iso}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
    for (const b of p.baglar ?? []) { const e = tablo.employees.find((x) => x.id === b.employee_id); if (e && !e.certificate_no) { e.certificate_no = b.sertifika_no; bag += 1; } }
    for (const k of p.kisiler ?? []) { const e = { id: uid(), organization_id: ORG, full_name: k.ad, staff_type: k.tur, title: k.sertifika_tipi, certificate_no: k.sertifika_no, is_active: true, monthly_capacity_min: 11700, created_at: simdi, updated_at: simdi, archived_at: null }; tablo.employees.push(e); ref[k.ref] = e.id; kisi += 1; }
    const toplamPay = (firma, tur, hariç) => tablo.assignments.filter((x) => !x.archived_at && x.company_id === firma && x.staff_type === tur && x.id !== hariç && x.valid_from <= (tarih) && (!x.valid_to || x.valid_to >= tarih)).reduce((t, x) => t + Number(x.share_pct), 0);
    for (const i of p.islemler ?? []) {
      if (i.islem === 'bitir') { const a = tablo.assignments.find((x) => x.id === i.assignment_id && !x.archived_at); if (!a) return { error: hata('Bitirilecek görevlendirme bulunamadı.', 'P0001') }; if (a.valid_from > gun(tarih, -1)) a.archived_at = simdi; else a.valid_to = gun(tarih, -1); bitir += 1; }
      else if (i.islem === 'degistir') {
        const a = tablo.assignments.find((x) => x.id === i.assignment_id && !x.archived_at); if (!a) return { error: hata('Değiştirilecek görevlendirme bulunamadı.', 'P0001') };
        const bas = a.valid_from >= tarih ? gun(a.valid_from, 1) : tarih; const eskiBitis = a.valid_to; a.valid_to = gun(bas, -1);
        tablo.assignments.push({ ...a, id: uid(), share_pct: i.pay, valid_from: bas, valid_to: eskiBitis, official_ref: i.resmi_ref ?? a.official_ref, official_start: i.resmi_baslangic ?? a.official_start }); degis += 1;
      } else if (i.islem === 'ekle') {
        const emp = i.employee_id ?? ref[i.employee_ref]; const e = tablo.employees.find((x) => x.id === emp); if (!e) return { error: hata('Personel bulunamadı.', 'P0001') };
        if (toplamPay(i.company_id, e.staff_type) + Number(i.pay) > 100.0001) return { error: hata(`Bu firmada aynı dönemde ${e.staff_type} hizmet payı toplamı %100'ü aşıyor.`, 'P0001') };
        tablo.assignments.push({ id: uid(), organization_id: ORG, company_id: i.company_id, employee_id: emp, staff_type: e.staff_type, share_pct: i.pay, valid_from: tarih, valid_to: null, official_ref: i.resmi_ref ?? null, official_start: i.resmi_baslangic ?? null, created_at: simdi, updated_at: simdi, archived_at: null }); ekle += 1;
      }
    }
    return { data: { yeni_personel: kisi, sertifika_baglanan: bag, eklenen: ekle, degisen: degis, biten: bitir } };
  },
  // Aşama 13: gerçek katip_uygula'nın (14_asama13_katip.sql) basitleştirilmiş taklidi
  katip_uygula({ p_paket: p }) {
    if (!izinVar('import_export', 'can_create') || !izinVar('companies', 'can_create') || !izinVar('companies', 'can_edit')) return { error: hata('Bu aktarım için içe aktarma ve firma ekleme/düzenleme yetkisi gerekir.', 'P0001') };
    if (!p?.isyerleri?.length) return { error: hata('Aktarılacak işyeri bulunamadı.', 'P0001') };
    for (const i of p.isyerleri) {
      if (!i.firma_id && !(p.yeni_firmalar ?? []).some((y) => y.ref === i.firma_ref)) return { error: hata(`İşyeri ${i.sicil} için firma belirtilmemiş.`, 'P0001') };
      if (i.firma_id && !tablo.companies.some((c) => c.id === i.firma_id)) return { error: hata(`İşyeri ${i.sicil} için firma bulunamadı.`, 'P0001') };
    }
    const donem = `${String(p.donem).slice(0, 7)}-01`; const simdi = new Date().toISOString(); const ref = {}; let yeniFirma = 0; let yeniIsyeri = 0; let guncel = 0; let yeniKisi = 0; let pasife = 0; let profil = 0;
    for (const y of p.yeni_firmalar ?? []) { const c = { id: uid(), organization_id: ORG, name: y.ad, city: y.il ?? null, customer_status: 'musteri', created_at: simdi, updated_at: simdi, archived_at: null }; tablo.companies.push(c); ref[y.ref] = c.id; yeniFirma += 1; }
    const imp = { id: uid(), organization_id: ORG, period: donem, file_name: p.dosya, row_count: 0, site_count: p.isyerleri.length, new_company_count: yeniFirma, summary: p.ozet ?? {}, created_at: simdi };
    tablo.katip_imports.push(imp);
    const siteId = {};
    for (const i of p.isyerleri) {
      const firma = i.firma_id ?? ref[i.firma_ref]; let s = tablo.company_sites.find((x) => x.sgk_no === i.sicil);
      const v = { company_id: firma, site_name: i.unvan, city: i.il ?? null, employee_count: i.calisan, hazard_class: i.tehlike, is_active: true, valid_from: donem, last_import_id: imp.id, archived_at: null };
      if (s) { Object.assign(s, v); guncel += 1; } else { s = { id: uid(), organization_id: ORG, sgk_no: i.sicil, created_at: simdi, updated_at: simdi, ...v }; tablo.company_sites.push(s); yeniIsyeri += 1; }
      siteId[i.sicil] = s.id;
    }
    const kapanan = tablo.company_sites.filter((x) => x.is_active && !(x.sgk_no in siteId));
    kapanan.forEach((x) => { x.is_active = false; });
    for (const r of p.satirlar ?? []) {
      const s = tablo.company_sites.find((x) => x.id === siteId[r.sicil]); if (!s) continue;
      tablo.katip_rows.push({ id: uid(), organization_id: ORG, import_id: imp.id, site_id: s.id, sgk_no: s.sgk_no, site_name: s.site_name, city: s.city, employee_count: s.employee_count, hazard_class: s.hazard_class, contract_id: r.sozlesme_id ?? null,
        staff_type: r.tur, cert_type: r.sertifika_tipi, cert_no: r.sertifika_no ?? null, person_name: r.ad, minutes_per_month: r.dakika, start_date: r.baslangic ?? null, approver_name: r.onaylayan ?? null, compliant: r.uygun ?? null });
      imp.row_count += 1;
      const anahtar = r.sertifika_no || String(r.ad).toLowerCase(); let k = tablo.katip_people.find((x) => x.person_key === anahtar);
      if (!k) { k = { id: uid(), organization_id: ORG, person_key: anahtar }; tablo.katip_people.push(k); }
      Object.assign(k, { person_name: r.ad, cert_no: r.sertifika_no ?? null, national_id: r.tc ?? k.national_id ?? null, staff_type: r.tur });
    }
    for (const k of p.kisiler ?? []) {
      const firma = k.firma_id ?? ref[k.firma_ref]; if (!firma) continue;
      if (!tablo.contacts.some((c) => c.company_id === firma && !c.archived_at && c.full_name.toLowerCase().trim() === k.ad.toLowerCase().trim())) {
        tablo.contacts.push({ id: uid(), organization_id: ORG, company_id: firma, full_name: k.ad, title: 'İSG-Katip onaylayan', is_decision_maker: false, created_at: simdi, updated_at: simdi, archived_at: null }); yeniKisi += 1;
      }
    }
    for (const id of p.pasif ?? []) { const c = tablo.companies.find((x) => x.id === id && x.customer_status === 'musteri'); if (c) { c.customer_status = 'eski_musteri'; pasife += 1; } }
    const dokunulan = [...new Set(tablo.company_sites.filter((x) => x.last_import_id === imp.id).map((x) => x.company_id))];
    for (const cid of dokunulan) {
      const aktif = tablo.company_sites.filter((x) => x.company_id === cid && x.is_active && !x.archived_at);
      const toplam = aktif.reduce((t, x) => t + x.employee_count, 0); const sira = ['az_tehlikeli', 'tehlikeli', 'cok_tehlikeli'];
      const tehlike = aktif.reduce((m, x) => (sira.indexOf(x.hazard_class) > sira.indexOf(m) ? x.hazard_class : m), 'az_tehlikeli');
      const dagilim = {}; aktif.forEach((x) => { dagilim[x.hazard_class] = (dagilim[x.hazard_class] ?? 0) + x.employee_count; });
      const dokum = Object.keys(dagilim).length > 1 ? Object.keys(dagilim).sort().map((t) => ({ tehlike: t, calisan: dagilim[t] })) : null;
      const acik = tablo.company_profiles.find((x) => x.company_id === cid && !x.valid_to);
      if (acik && acik.employee_count === toplam && acik.hazard_class === tehlike && JSON.stringify(acik.site_breakdown ?? null) === JSON.stringify(dokum)) continue;
      let bas = donem; if (acik && bas <= acik.valid_from) { const d = new Date(`${acik.valid_from}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1); bas = d.toISOString().slice(0, 10); }
      if (acik) { const d = new Date(`${bas}T00:00:00Z`); d.setUTCDate(d.getUTCDate() - 1); acik.valid_to = d.toISOString().slice(0, 10); }
      tablo.company_profiles.push({ id: uid(), organization_id: ORG, company_id: cid, employee_count: toplam, hazard_class: tehlike, valid_from: bas, valid_to: null, note: `İSG-Katip aktarımı`, site_breakdown: dokum });
      profil += 1;
    }
    return { data: { yukleme_id: imp.id, yeni_firma: yeniFirma, yeni_isyeri: yeniIsyeri, guncellenen_isyeri: guncel, kapanan_isyeri: kapanan.length, satir: imp.row_count, yeni_kisi: yeniKisi, pasife_alinan: pasife, firma_karti_guncellenen: profil } };
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
    return tablo.employees.filter((e) => e.staff_type && (!alan || e.id === ben.employee_id)).map((e) => ({ id: e.id, full_name: e.full_name, staff_type: e.staff_type, is_active: e.is_active, monthly_capacity_min: e.monthly_capacity_min, archived_at: e.archived_at }));
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
  // Aşama 20: personel_maliyeti_kaydet (22_asama20.sql) taklidi
  personel_maliyeti_kaydet({ p_employee, p_baslangic, p_brut, p_net, p_emekli, p_sgk, p_elden }) {
    if (!izinVar('payroll', 'can_create') || !izinVar('payroll', 'can_edit')) return { error: hata('Personel maliyeti girme yetkiniz yok.', 'P0001') };
    if (!p_baslangic) return { error: hata('Geçerlilik başlangıcını girin.', 'P0001') };
    const b = Number(p_brut ?? 0); const n = Number(p_net ?? 0); const e = Number(p_elden ?? 0);
    if (b < 0 || n < 0 || e < 0 || Number(p_sgk ?? 0) < 0) return { error: hata('Tutarlar negatif olamaz.', 'P0001') };
    const sgk = p_sgk !== null && p_sgk !== undefined ? Math.round(Number(p_sgk) * 100) / 100 : Math.round(b * (p_emekli ? 0.0225 + 0.30 : 0.0225 + 0.21 + 0.125 + 0.03) * 100) / 100;
    const gun = (d, k) => { const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + k); return x.toISOString().slice(0, 10); };
    const liste = tablo.employee_costs.filter((c) => c.employee_id === p_employee);
    const on = liste.find((c) => c.valid_from <= p_baslangic && (!c.valid_to || c.valid_to >= p_baslangic));
    const alanlar = { gross_salary: b, net_salary: n, cash_paid: e, employer_sgk: sgk, other_benefits: 0, is_retired: !!p_emekli, sgk_manual: p_sgk !== null && p_sgk !== undefined, cost_version: 2, total_monthly_cost: Math.round((n + sgk + e) * 100) / 100 };
    if (on && on.valid_from === p_baslangic) { Object.assign(on, alanlar); return { data: kopya(on) }; }
    let son = null;
    if (on) { son = on.valid_to; on.valid_to = gun(p_baslangic, -1); }
    else { const sonraki = liste.filter((c) => c.valid_from > p_baslangic).map((c) => c.valid_from).sort()[0]; son = sonraki ? gun(sonraki, -1) : null; }
    const y = { id: uid(), organization_id: ORG, employee_id: p_employee, valid_from: p_baslangic, valid_to: son, ...alanlar };
    tablo.employee_costs.push(y); return { data: kopya(y) };
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
  // Aşama 18: gerçek firma_sil'in (19_asama18.sql) basitleştirilmiş taklidi
  firma_sil({ p_firma, p_ad }) {
    const ben = tablo.users.find((u) => u.id === oturum?.user?.id);
    const rol = tablo.roles.find((r) => r.id === ben?.role_id)?.key;
    if (!['isletme_sahibi', 'sistem_yoneticisi'].includes(rol)) return { error: hata('Firmayı kalıcı silme yetkisi yalnızca işletme sahibi ve sistem yöneticisindedir.', 'P0001') };
    const c = tablo.companies.find((x) => x.id === p_firma); if (!c) return { error: hata('Firma bulunamadı.', 'P0001') };
    if (String(p_ad ?? '').trim() !== c.name.trim()) return { error: hata('Firma adı doğru yazılmadı; silme yapılmadı.', 'P0001') };
    const sil = {}; const fat = tablo.invoices.filter((i) => i.company_id === p_firma).map((i) => i.id);
    const at = (ad, fn) => { const once = tablo[ad].length; tablo[ad] = tablo[ad].filter((x) => !fn(x)); sil[ad] = once - tablo[ad].length; };
    at('payments', (x) => fat.includes(x.invoice_id)); at('invoice_items', (x) => fat.includes(x.invoice_id)); at('invoices', (x) => x.company_id === p_firma);
    at('invoice_aliases', (x) => x.company_id === p_firma);
    const soz = tablo.contracts.filter((x) => x.company_id === p_firma).map((x) => x.id);
    at('contract_prices', (x) => soz.includes(x.contract_id)); at('contracts', (x) => x.company_id === p_firma);
    for (const ad of ['offers', 'sales_opportunities', 'contacts', 'activities', 'tasks', 'time_entries', 'assignments', 'expenses', 'company_sites', 'company_profiles', 'calendar_items', 'overhead_allocations']) if (tablo[ad]) at(ad, (x) => x.company_id === p_firma);
    at('companies', (x) => x.id === p_firma);
    return { data: { ad: c.name, silinen: sil } };
  },
  // Aşama 17: gerçek gelir_aktar / gelir_kalemi_ekle (18_asama17.sql) basitleştirilmiş taklidi (hepsi ya da hiçbiri)
  gelir_aktar({ p_paket: p }) {
    if (!izinVar('invoices', 'can_create') || !izinVar('import_export', 'can_create')) return { error: hata('Gelir aktarımı için fatura ekleme ve içe aktarma yetkisi gerekir.', 'P0001') };
    if (!p.faturalar?.length) return { error: hata('Aktarılacak fatura satırı yok.', 'P0001') };
    const yedek = { c: kopya(tablo.companies), i: kopya(tablo.invoices), it: kopya(tablo.invoice_items), a: kopya(tablo.invoice_aliases) };
    const geri = (m) => { tablo.companies = yedek.c; tablo.invoices = yedek.i; tablo.invoice_items = yedek.it; tablo.invoice_aliases = yedek.a; return { error: hata(m, 'P0001') }; };
    const harita = {}; const simdi = new Date().toISOString(); let yeni = 0; let eklenen = 0; const atlanan = [];
    for (const y of p.yeni_firmalar ?? []) { const f = { id: uid(), organization_id: ORG, name: y.ad, customer_status: 'musteri', created_at: simdi, archived_at: null }; tablo.companies.push(f); harita[y.anahtar] = f.id; yeni += 1; }
    for (const f of p.faturalar) {
      const firma = f.firma_id ?? harita[f.yeni_firma]; const no = String(f.no ?? '').trim();
      if (!firma) return geri(`Firma belirlenmemiş satır var (${no || '?'}).`);
      if (!tablo.companies.some((c) => c.id === firma)) return geri(`Firma bulunamadı (${no || '?'}).`);
      if (no && tablo.invoices.some((x) => x.invoice_no === no)) { atlanan.push({ no, neden: 'Bu fatura numarası zaten kayıtlı' }); continue; }
      const haric = f.kalemler.reduce((t, k) => t + k.haric, 0); const kdv = f.kalemler.reduce((t, k) => t + k.kdv, 0);
      if (!(haric > 0)) return geri(`Fatura tutarı sıfırdan büyük olmalıdır (${no || '?'}).`);
      const v = new Date(`${f.tarih}T00:00:00Z`); v.setUTCDate(v.getUTCDate() + (p.vade_gun ?? 30));
      const yil = f.tarih.slice(0, 4); const sayac = Math.max(0, ...tablo.invoices.map((x) => { const m = x.invoice_no.match(new RegExp(`^F-${yil}-(\\d+)$`)); return m ? Number(m[1]) : 0; })) + 1;
      const i = { id: uid(), organization_id: ORG, company_id: firma, contract_id: null, invoice_no: no || `F-${yil}-${String(sayac).padStart(4, '0')}`, invoice_date: f.tarih, due_date: v.toISOString().slice(0, 10),
        service_period: f.donem ? `${f.donem.slice(0, 7)}-01` : null, amount_excl_vat: haric, vat_amount: kdv, amount_incl_vat: haric + kdv, flag: null, notes: null, site_id: f.site_id ?? null, income_kind: 'fatura', created_at: simdi, updated_at: simdi, archived_at: null };
      tablo.invoices.push(i);
      for (const k of f.kalemler) tablo.invoice_items.push({ id: uid(), organization_id: ORG, invoice_id: i.id, description: k.aciklama, quantity: 1, unit_price_excl: k.haric, vat_rate: k.oran, created_at: simdi, archived_at: null });
      if (f.alias_key) { const m = tablo.invoice_aliases.find((x) => x.alias_key === f.alias_key); if (m) Object.assign(m, { company_id: firma, site_id: f.site_id ?? null }); else tablo.invoice_aliases.push({ id: uid(), organization_id: ORG, alias_key: f.alias_key, alias_text: f.alias_text, company_id: firma, site_id: f.site_id ?? null, created_at: simdi }); }
      eklenen += 1;
    }
    return { data: { eklenen, yeni_firma: yeni, atlanan, fatura_idleri: [] } };
  },
  // Aşama 19: gider_aktar (20_asama19.sql) basitleştirilmiş taklidi: yeni kayıtlar eklenir, önceki Excel kayıtları arşivlenir
  gider_aktar({ p_paket: p }) {
    if (!izinVar('expenses', 'can_create') || !izinVar('import_export', 'can_create') || !izinVar('expenses', 'can_archive')) return { error: hata('Gider aktarımı için gider ekleme, arşivleme ve içe aktarma yetkisi gerekir.', 'P0001') };
    if (!p.aylar?.length || !p.satirlar?.length) return { error: hata('Aktarılacak gider satırı yok.', 'P0001') };
    const simdi = new Date().toISOString(); const aylar = new Set(p.aylar);
    const eski = tablo.expenses.filter((e) => e.import_id && !e.archived_at && aylar.has(`${e.expense_date.slice(0, 7)}-01`));
    const imp = { id: uid(), organization_id: ORG, file_name: p.dosya, months: p.aylar, created_at: simdi, row_count: 0, archived_count: 0, total_excl_vat: 0 };
    tablo.expense_imports.push(imp); let eklenen = 0; let yeniKat = 0; let negatif = 0; let toplam = 0;
    const kdvAyirF = (t) => (p.kdv_modu === 'kdv_dahil' ? { haric: Math.round(t / (1 + p.kdv_orani / 100) * 100) / 100 } : { haric: t });
    let yonKat = tablo.expense_categories.find((k) => k.is_management_pay);
    for (const r of p.satirlar) {
      let kid = null;
      if (r.islem === 'yonetim') { if (!yonKat) { yonKat = { id: uid(), organization_id: ORG, name: 'Yönetime ödenen (yönetim personeli maliyeti)', nature: 'isletme', default_cost_type: 'ortak', is_payroll: false, is_management_pay: true, is_income_tax: false, sort_order: 99 }; tablo.expense_categories.push(yonKat); yeniKat += 1; } kid = yonKat.id; }
      else if (r.islem === 'kategori') {
        if (r.kategori_id) { const k = tablo.expense_categories.find((x) => x.id === r.kategori_id); if (!k || k.is_management_pay) return { error: hata('Kategori kullanılamaz.', 'P0001') }; kid = k.id; }
        else { const ad = String(r.yeni_kategori?.ad ?? '').trim(); let k = tablo.expense_categories.find((x) => x.name === ad); if (!k) { k = { id: uid(), organization_id: ORG, name: ad, nature: r.yeni_kategori.tur === 'vergi' ? 'vergi' : r.yeni_kategori.tur === 'personel' ? 'personel' : 'isletme', default_cost_type: r.yeni_kategori.tur === 'personel' ? 'dogrudan' : 'ortak', is_payroll: r.yeni_kategori.tur === 'personel', is_management_pay: false, is_income_tax: r.yeni_kategori.tur === 'vergi', sort_order: 100 }; tablo.expense_categories.push(k); yeniKat += 1; } kid = k.id; }
      }
      const m = tablo.expense_row_map.find((x) => x.row_key === r.anahtar);
      const kayit = { row_key: r.anahtar, row_label: r.etiket, action: r.islem, category_id: r.islem === 'kategori' ? kid : null };
      if (m) Object.assign(m, kayit); else tablo.expense_row_map.push({ id: uid(), organization_id: ORG, ...kayit });
      if (r.islem === 'atla') continue;
      for (const [ay, t] of Object.entries(r.tutarlar ?? {})) {
        if (!aylar.has(ay)) return { error: hata('Tutar, dosya aylarının dışında.', 'P0001') };
        if (!(t > 0)) { negatif += 1; continue; }
        const { haric } = kdvAyirF(t); const kdv = Math.round((t - haric) * 100) / 100;
        const h = p.kdv_modu === 'kdv_dahil' ? haric : t; const v = p.kdv_modu === 'kdv_dahil' ? kdv : Math.round(t * p.kdv_orani) / 100;
        tablo.expenses.push({ id: uid(), organization_id: ORG, category_id: kid, expense_date: ay, amount_excl_vat: h, vat_amount: v, amount_incl_vat: h + v, cost_type: 'ortak', company_id: null, employee_id: null, paid: ay < `${bugun().slice(0, 7)}-01`, description: `Excel aktarımı: ${r.etiket}`, import_id: imp.id, created_at: simdi, updated_at: simdi, archived_at: null });
        eklenen += 1; toplam += h;
      }
    }
    for (const e of eski) e.archived_at = simdi;
    Object.assign(imp, { row_count: eklenen, archived_count: eski.length, total_excl_vat: toplam });
    return { data: { import_id: imp.id, eklenen, arsivlenen: eski.length, yeni_kategori: yeniKat, negatif_atlanan: negatif } };
  },
  isyeri_profil_esitle(a) {
    if (!izinVar('companies', 'can_edit')) return { error: hata('Firma düzenleme yetkiniz yok.', 'P0001') };
    const sl = tablo.company_sites.filter((x) => x.company_id === a.p_firma && x.is_active !== false && !x.archived_at && x.hazard_class);
    if (!sl.length) return { data: { guncellendi: false } };
    const sira = { az_tehlikeli: 1, tehlikeli: 2, cok_tehlikeli: 3 };
    const toplam = sl.reduce((t, x) => t + (x.employee_count ?? 0), 0);
    const tehlike = sl.reduce((m, x) => (sira[x.hazard_class] > sira[m] ? x.hazard_class : m), sl[0].hazard_class);
    const sinif = [...new Set(sl.map((x) => x.hazard_class))].sort();
    const dokum = sinif.length > 1 ? sinif.map((h) => ({ tehlike: h, calisan: sl.filter((x) => x.hazard_class === h).reduce((t, x) => t + (x.employee_count ?? 0), 0) })) : null;
    const bas = `${bugun().slice(0, 7)}-01`;
    const acik = tablo.company_profiles.find((p) => p.company_id === a.p_firma && !p.valid_to);
    if (acik && acik.employee_count === toplam && acik.hazard_class === tehlike && JSON.stringify(acik.site_breakdown ?? null) === JSON.stringify(dokum)) return { data: { guncellendi: false } };
    if (acik && acik.valid_from >= bas) Object.assign(acik, { employee_count: toplam, hazard_class: tehlike, site_breakdown: dokum });
    else {
      if (acik) acik.valid_to = new Date(new Date(`${bas}T00:00:00Z`).getTime() - 86400000).toISOString().slice(0, 10);
      tablo.company_profiles.push({ id: uid(), organization_id: ORG, company_id: a.p_firma, employee_count: toplam, hazard_class: tehlike, valid_from: bas, valid_to: null, site_breakdown: dokum, note: 'İşyeri bilgilerinden güncellendi', created_at: new Date().toISOString() });
    }
    return { data: { guncellendi: true, calisan: toplam, tehlike } };
  },
  isyeri_firmaya_tasi(a) {
    if (!izinVar('companies', 'can_edit')) return { error: hata('Firma düzenleme yetkiniz yok.', 'P0001') };
    const x = tablo.company_sites.find((y) => y.id === a.p_site); if (!x) return { error: hata('İşyeri bulunamadı.', 'P0001') };
    const eski = x.company_id; Object.assign(x, { company_id: a.p_firma, archived_at: null });
    rpcler.isyeri_profil_esitle({ p_firma: a.p_firma });
    if (eski !== a.p_firma) {
      rpcler.isyeri_profil_esitle({ p_firma: eski });
      if (!tablo.company_sites.some((y) => y.company_id === eski && !y.archived_at && y.is_active !== false && y.hazard_class)) {
        const acik = tablo.company_profiles.find((p) => p.company_id === eski && !p.valid_to);
        if (acik && acik.employee_count > 0) {
          const bas = `${bugun().slice(0, 7)}-01`;
          if (acik.valid_from >= bas) Object.assign(acik, { employee_count: 0, site_breakdown: null });
          else { acik.valid_to = new Date(new Date(`${bas}T00:00:00Z`).getTime() - 86400000).toISOString().slice(0, 10); tablo.company_profiles.push({ id: uid(), organization_id: ORG, company_id: eski, employee_count: 0, hazard_class: acik.hazard_class, valid_from: bas, valid_to: null, site_breakdown: null, note: 'İşyerlerinin tamamı başka firmaya bağlandı', created_at: new Date().toISOString() }); }
        }
      }
    }
    return { data: { eski_firma: eski, yeni_firma: a.p_firma } };
  },
  firma_tahsilati_gir(a) {
    if (!izinVar('invoices', 'can_create')) return { error: hata('Tahsilat girme yetkiniz yok.', 'P0001') };
    if (a.p_tarih > bugun()) return { error: hata('Tahsilat tarihi gelecekte olamaz.', 'P0001') };
    if (!(a.p_tutar > 0)) return { error: hata('Tutar sıfırdan büyük olmalıdır.', 'P0001') };
    const odenen = (id) => tablo.payments.filter((p) => p.invoice_id === id && !p.archived_at).reduce((t, p) => t + Math.round(p.amount * 100), 0);
    const acikL = tablo.invoices.filter((i) => i.company_id === a.p_firma && !i.archived_at).map((i) => ({ i, acik: Math.round(i.amount_incl_vat * 100) - odenen(i.id) })).filter((x) => x.acik > 0)
      .sort((x, y) => String(x.i.invoice_date).localeCompare(String(y.i.invoice_date)) || String(x.i.invoice_no).localeCompare(String(y.i.invoice_no)));
    let kalan = Math.round(a.p_tutar * 100);
    if (kalan > acikL.reduce((t, x) => t + x.acik, 0)) return { error: hata('Tutar firmanın açık bakiyesini aşıyor.', 'P0001') };
    const grup = uid(); const dagitim = [];
    for (const { i, acik } of acikL) {
      if (kalan <= 0) break;
      const pay = Math.min(acik, kalan);
      tablo.payments.push({ id: uid(), organization_id: ORG, invoice_id: i.id, paid_at: a.p_tarih, amount: pay / 100, method: a.p_yontem ?? null, notes: a.p_not ?? null, group_id: grup, created_at: new Date().toISOString(), archived_at: null });
      dagitim.push({ fatura_no: i.invoice_no, tutar: pay / 100, kismi: pay < acik }); kalan -= pay;
    }
    return { data: { group_id: grup, dagitim } };
  },
  gelir_kalemi_ekle(a) {
    if (!['spot', 'elden'].includes(a.p_tur)) return { error: hata('Gelir türü spot veya elden olmalıdır.', 'P0001') };
    if (!String(a.p_aciklama ?? '').trim()) return { error: hata('Gelir kaleminin ne olduğunu yazın.', 'P0001') };
    const elden = a.p_tur === 'elden';
    if (!a.p_firma) {
      if (!izinVar('invoices', 'can_create')) return { error: hata('Fatura ekleme yetkiniz yok.', 'P0001') };
      if (!(a.p_tutar > 0)) return { error: hata('Tutar sıfırdan büyük olmalıdır.', 'P0001') };
      const oran = elden ? 0 : a.p_kdv_orani; const kdv = Math.round(a.p_tutar * oran) / 100; const yil = a.p_tarih.slice(0, 4);
      const haric = elden || a.p_kdv_modu !== 'kdv_dahil' ? a.p_tutar : Math.round((a.p_tutar / (1 + oran / 100)) * 100) / 100; const kdvT = elden || a.p_kdv_modu !== 'kdv_dahil' ? kdv : Math.round((a.p_tutar - haric) * 100) / 100;
      const sayac = Math.max(0, ...tablo.invoices.map((x) => { const m = x.invoice_no.match(new RegExp(`^F-${yil}-(\\d+)$`)); return m ? Number(m[1]) : 0; })) + 1;
      const i = { id: uid(), organization_id: ORG, company_id: null, contract_id: null, invoice_no: a.p_no || `F-${yil}-${String(sayac).padStart(4, '0')}`, invoice_date: a.p_tarih, due_date: a.p_tarih, service_period: `${a.p_tarih.slice(0, 7)}-01`,
        amount_excl_vat: haric, vat_amount: kdvT, amount_incl_vat: haric + kdvT, flag: null, notes: a.p_aciklama.trim(), income_kind: a.p_tur, customer_name: a.p_musteri ?? null, created_at: new Date().toISOString(), archived_at: null };
      tablo.invoices.push(i);
      if (a.p_tahsil) tablo.payments.push({ id: uid(), organization_id: ORG, invoice_id: i.id, paid_at: a.p_tarih, amount: i.amount_incl_vat, method: elden ? 'Elden' : null, notes: 'Gelir girişi sırasında tahsil edildi', created_at: new Date().toISOString(), archived_at: null });
      return { data: kopya(i) };
    }
    const r = faturaYaz({ p_id: null, p_firma: a.p_firma, p_sozlesme: null, p_no: a.p_no, p_tarih: a.p_tarih, p_vade: a.p_tarih, p_donem: `${a.p_tarih.slice(0, 7)}-01`,
      p_tutar: a.p_tutar, p_kdv_modu: elden ? 'kdv_haric' : a.p_kdv_modu, p_kdv_orani: elden ? 0 : a.p_kdv_orani, p_aciklama: a.p_aciklama.trim(), p_not: null }, null);
    if (r.error) return r;
    const i = tablo.invoices.find((x) => x.id === r.data.id); i.income_kind = a.p_tur;
    if (a.p_tahsil) tablo.payments.push({ id: uid(), organization_id: ORG, invoice_id: i.id, paid_at: a.p_tarih, amount: i.amount_incl_vat, method: elden ? 'Elden' : null, notes: 'Gelir girişi sırasında tahsil edildi', created_at: new Date().toISOString(), archived_at: null });
    return { data: kopya(i) };
  },
  donem_faturalari_olustur({ p_donem, p_fatura_tarihi, p_vade_gun }) {
    const donem = `${p_donem.slice(0, 7)}-01`; const bit = new Date(Date.UTC(Number(donem.slice(0, 4)), Number(donem.slice(5, 7)), 0)).toISOString().slice(0, 10);
    const tarih = p_fatura_tarihi ?? bugun(); const vade = new Date(`${tarih}T00:00:00Z`); vade.setUTCDate(vade.getUTCDate() + p_vade_gun);
    let n = 0; const atlanan = [];
    for (const c of tablo.contracts.filter((x) => !x.archived_at && ['aktif', 'yenilendi', 'sona_erdi'].includes(x.status) && x.start_date <= bit && x.end_date >= donem)) {
      const fk = tablo.companies.find((x) => x.id === c.company_id);
      if (!fk || fk.archived_at || fk.customer_status !== 'musteri') continue;
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
      personeller: tablo.employees.map((e) => ({ id: e.id, full_name: e.full_name, staff_type: e.staff_type ?? null, role_kind: e.role_kind ?? null, title: e.title ?? null, is_management: !!e.is_management, is_active: e.is_active, archived_at: e.archived_at, monthly_capacity_min: e.monthly_capacity_min })),
    } };
  },
  teklif_baglantisi_olustur({ p_offer, p_gun, p_not }) {
    if (!izinVar('offers', 'can_edit')) return { error: hata('Teklifi düzenleme yetkiniz yok.', 'P0001') };
    const o = tablo.offers.find((x) => x.id === p_offer && !x.archived_at);
    if (!o) return { error: hata('Teklif bulunamadı.', 'P0001') };
    if (!['gonderildi', 'gorusuluyor'].includes(o.status)) return { error: hata('Müşteri bağlantısı yalnızca "Gönderildi" veya "Görüşülüyor" durumundaki teklif için oluşturulabilir. Önce teklifi müşteriye gönderildi olarak işaretleyin.', 'P0001') };
    if (!(p_gun >= 1 && p_gun <= 90)) return { error: hata('Bağlantı süresi 1 ile 90 gün arasında olmalıdır.', 'P0001') };
    const token = Array.from({ length: 64 }, () => '0123456789abcdef'[Math.floor(Math.random() * 16)]).join('');
    const simdi = new Date().toISOString();
    tablo.offer_shares.filter((x) => x.offer_id === o.id && !x.revoked_at).forEach((x) => { x.revoked_at = simdi; });
    tablo.offer_shares.push({ id: uid(), organization_id: ORG, offer_id: o.id, token_hash: token, customer_note: (p_not ?? '').trim() || null, expires_at: new Date(Date.now() + p_gun * 864e5).toISOString(), revoked_at: null,
      created_at: simdi, first_viewed_at: null, last_viewed_at: null, view_count: 0, response: null, responded_at: null, responder_name: null, responder_note: null });
    return { data: token };
  },
  teklif_baglantisi_iptal({ p_offer }) {
    if (!izinVar('offers', 'can_edit')) return { error: hata('Teklifi düzenleme yetkiniz yok.', 'P0001') };
    const a = tablo.offer_shares.filter((x) => x.offer_id === p_offer && !x.revoked_at); a.forEach((x) => { x.revoked_at = new Date().toISOString(); });
    return { data: a.length };
  },
  teklif_paylasim_goruntule({ p_token }) {
    const s = paylasimBul(p_token);
    if (!s) return { data: { durum: 'gecersiz' } };
    const o = tablo.offers.find((x) => x.id === s.offer_id);
    const c = tablo.companies.find((x) => x.id === o.company_id);
    s.view_count += 1; s.last_viewed_at = new Date().toISOString(); s.first_viewed_at ??= s.last_viewed_at;
    return { data: { durum: 'gecerli', kurum: tablo.organizations[0].name, alici: c?.name ?? 'Müşteri', teklif_no: o.offer_no, teklif_tarihi: o.offer_date, gecerlilik: o.valid_until ?? null,
      calisan_sayisi: o.employee_count, tehlike: o.hazard_class, fiyatlama: o.pricing, birim_fiyat: o.unit_price ?? null, sabit_fiyat: o.fixed_monthly_price ?? null, kdv_modu: o.vat_mode, kdv_orani: o.vat_rate, indirim: o.discount_pct ?? 0,
      kalemler: tablo.offer_items.filter((i) => i.offer_id === o.id && !i.archived_at).map((i) => ({ aciklama: i.description, miktar: i.quantity, birim_fiyat: i.unit_price, kdv_modu: i.vat_mode, kdv_orani: i.vat_rate })),
      musteri_notu: s.customer_note, teklif_durumu: ['kabul_edildi', 'reddedildi', 'suresi_doldu'].includes(o.status) ? o.status : 'acik',
      sure_bitti: !!(o.valid_until && o.valid_until < bugun()),
      yanit: s.response ? { karar: s.response, tarih: s.responded_at, ad: s.responder_name } : null,
      yanit_verilebilir: !s.response && ['gonderildi', 'gorusuluyor'].includes(o.status) && !(o.valid_until && o.valid_until < bugun()) } };
  },
  teklif_paylasim_yanitla({ p_token, p_karar, p_ad, p_not }) {
    const s = paylasimBul(p_token);
    if (!s) return { error: hata('Bu bağlantı geçersiz ya da süresi dolmuş.', 'P0001') };
    const o = tablo.offers.find((x) => x.id === s.offer_id);
    if (s.response) return { error: hata('Bu teklife zaten yanıt verilmiş. Değişiklik için lütfen bizimle iletişime geçin.', 'P0001') };
    if (!['gonderildi', 'gorusuluyor'].includes(o.status)) return { error: hata('Bu teklif artık yanıt kabul etmiyor. Lütfen bizimle iletişime geçin.', 'P0001') };
    if (o.valid_until && o.valid_until < bugun()) return { error: hata('Teklifin geçerlilik süresi dolmuş. Lütfen bizimle iletişime geçin.', 'P0001') };
    if (!['kabul', 'red'].includes(p_karar)) return { error: hata('Geçersiz yanıt.', 'P0001') };
    const ad = String(p_ad ?? '').replace(/[\u0000-\u001f]+/g, ' ').trim();
    if (ad.length < 2 || ad.length > 80) return { error: hata('Lütfen adınızı ve soyadınızı yazın (2-80 karakter).', 'P0001') };
    const not = String(p_not ?? '').trim() || null;
    if (not && not.length > 500) return { error: hata('Notunuz en çok 500 karakter olabilir.', 'P0001') };
    Object.assign(s, { response: p_karar, responded_at: new Date().toISOString(), responder_name: ad, responder_note: not });
    tablo.tasks.push({ id: uid(), organization_id: ORG, kind: 'teklif_takibi', title: `${p_karar === 'kabul' ? 'Müşteri teklifi KABUL ETTİ: ' : 'Müşteri teklifi reddetti: '}${o.offer_no}`, company_id: o.company_id ?? null, lead_id: o.lead_id ?? null, assignee: o.created_by ?? null,
      priority: 'yuksek', due_at: new Date().toISOString(), status: 'acik', description: `Yanıtlayan: ${ad}`, source_ref: `offer_share:${s.id}`, created_at: new Date().toISOString(), archived_at: null });
    return { data: { ok: true, karar: p_karar } };
  },
  yedek_kaydi({ p_tablo_sayisi, p_satir_sayisi, p_dosya }) {
    const modul = ['dashboard', 'crm', 'companies', 'contacts', 'opportunities', 'offers', 'contracts', 'staff', 'assignments', 'time', 'invoices', 'expenses', 'payroll', 'staff_profit', 'company_profit', 'capacity', 'reports', 'tasks', 'import_export', 'users', 'settings'];
    if (!modul.every((m) => izinVar(m, 'can_view'))) return { error: hata('Yedek almak için tüm modülleri görüntüleme yetkisi gerekir.', 'P0001') };
    if (!(p_tablo_sayisi >= 1) || !(p_satir_sayisi >= 0)) return { error: hata('Geçersiz yedek bilgisi.', 'P0001') };
    const satir = { id: tablo.audit_logs.length + 1, organization_id: ORG, table_name: 'yedek', record_id: null, action: 'BACKUP', old_data: null, new_data: { tablo_sayisi: p_tablo_sayisi, satir_sayisi: p_satir_sayisi, dosya: p_dosya }, user_id: oturum?.user?.id ?? null, created_at: new Date().toISOString() };
    tablo.audit_logs.push(satir); return { data: satir.id };
  },
  ayar_kaydet({ p_anahtar, p_deger, p_gecerlilik }) {
    if (!izinVar('settings', 'can_create') || !izinVar('settings', 'can_edit')) return { error: hata('Sistem ayarlarını değiştirme yetkiniz yok.', 'P0001') };
    const sinir = { kapasite_dakika: [60, 44640, 'Aylık kapasite (dakika)'], kurumlar_vergisi_orani: [0, 100, 'Kurumlar vergisi oranı'], marj_esigi_yuzde: [0, 100, 'Kâr marjı eşiği'], varsayilan_kdv_orani: [0, 100, 'Varsayılan KDV oranı'] }[p_anahtar];
    if (typeof p_deger !== 'number') return { error: hata('Ayar değeri bir sayı olmalıdır.', 'P0001') };
    if (!sinir) return { error: hata(`Bu ayar buradan değiştirilemez: ${p_anahtar}`, 'P0001') };
    if (p_deger < sinir[0] || p_deger > sinir[1]) return { error: hata(`${sinir[2]} ${sinir[0]} ile ${sinir[1]} arasında olmalıdır.`, 'P0001') };
    if (p_anahtar === 'kapasite_dakika' && !Number.isInteger(p_deger)) return { error: hata('Aylık kapasite tam sayı (dakika) olmalıdır.', 'P0001') };
    if (!p_gecerlilik || p_gecerlilik.slice(8, 10) !== '01') return { error: hata('Ayar ayın 1\'inden itibaren geçerli olmalıdır.', 'P0001') };
    if (p_gecerlilik < `${bugun().slice(0, 7)}-01`) return { error: hata('Geçmiş aylar için ayar değiştirilemez (raporlar bozulmasın diye). En erken bu ayın 1\'inden itibaren geçerli olabilir.', 'P0001') };
    const var_ = tablo.settings.find((x) => x.key === p_anahtar && x.valid_from === p_gecerlilik);
    if (var_) { var_.value = p_deger; return { data: kopya(var_) }; }
    const yeni = { id: uid(), organization_id: ORG, key: p_anahtar, value: p_deger, valid_from: p_gecerlilik };
    tablo.settings.push(yeni); return { data: kopya(yeni) };
  },
  hizmet_suresi_kurali_ekle({ p_personel_turu, p_tehlike, p_dakika, p_gecerlilik, p_not }) {
    if (!izinVar('settings', 'can_create') || !izinVar('settings', 'can_edit')) return { error: hata('Hizmet süresi kurallarını değiştirme yetkiniz yok.', 'P0001') };
    if (typeof p_dakika !== 'number' || p_dakika < 0 || p_dakika > 600) return { error: hata('Çalışan başına dakika 0 ile 600 arasında olmalıdır.', 'P0001') };
    if (!p_gecerlilik || p_gecerlilik.slice(8, 10) !== '01') return { error: hata('Kural ayın 1\'inden itibaren geçerli olmalıdır.', 'P0001') };
    if (p_gecerlilik < `${bugun().slice(0, 7)}-01`) return { error: hata('Geçmiş aylar için kural değiştirilemez (raporlar bozulmasın diye). En erken bu ayın 1\'inden itibaren geçerli olabilir.', 'P0001') };
    const ayni = tablo.service_time_rules.filter((k) => k.staff_type === p_personel_turu && k.hazard_class === p_tehlike);
    if (ayni.some((k) => k.valid_from > p_gecerlilik)) return { error: hata('Bu tarihten sonra başlayan bir kural zaten var.', 'P0001') };
    const acik = ayni.find((k) => !k.valid_to);
    if (acik) {
      if (Number(acik.minutes_per_employee) === p_dakika) return { data: kopya(acik) };
      if (p_gecerlilik <= acik.valid_from) return { error: hata(`Yeni kural, mevcut kuralın başlangıcından (${acik.valid_from.split('-').reverse().join('.')}) sonra olmalıdır.`, 'P0001') };
      const d = new Date(`${p_gecerlilik}T00:00:00Z`); d.setUTCDate(d.getUTCDate() - 1); acik.valid_to = d.toISOString().slice(0, 10);
    }
    const yeni = { id: uid(), organization_id: ORG, staff_type: p_personel_turu, hazard_class: p_tehlike, minutes_per_employee: p_dakika, valid_from: p_gecerlilik, valid_to: null, note: (p_not ?? '').trim() || null };
    tablo.service_time_rules.push(yeni); return { data: kopya(yeni) };
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

export const depo = new Map();   // yol → { ad, tur, boyut }
export function createClient() {
  return {
    storage: { from: (kova) => ({
      async upload(yol, dosya, secenek) {
        if (globalThis.__depoHata) return { data: null, error: { message: 'Storage hatası', statusCode: '500' } };
        if (!((kova === 'idari-belgeler' && izinVar('admin_affairs', 'can_create')) || (kova === 'imzali-sozlesmeler' && izinVar('contracts', 'can_create')))) return { data: null, error: { message: 'new row violates row-level security policy', statusCode: '403' } };
        if (depo.has(yol)) return { data: null, error: { message: 'The resource already exists', statusCode: '409' } };
        depo.set(yol, { tur: secenek?.contentType, boyut: dosya.size }); return { data: { path: yol }, error: null };
      },
      async createSignedUrl(yol) { return depo.has(yol) ? { data: { signedUrl: `https://fake.supabase.test/storage/v1/object/sign/${kova}/${yol}?token=x` }, error: null } : { data: null, error: { message: 'Object not found' } }; },
      async remove(yollar) { yollar.forEach((y) => depo.delete(y)); return { data: [], error: null }; },
    }) },
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
    functions: {
      async invoke(ad, { body } = {}) {
        gunluk.push(`fn ${ad}`);
        await new Promise((r) => setTimeout(r, 5));
        const yanit = (durum, govde) => ({ data: null, error: { name: 'FunctionsHttpError', message: 'Edge Function returned a non-2xx status code', context: { status: durum, json: async () => govde } } });
        if (ad !== 'gunluk-ozet' || !ozetAyar.varsa) return yanit(404, { error: 'NOT_FOUND' });
        if (!izinVar('settings', 'can_create') || !izinVar('settings', 'can_edit')) return yanit(403, { ok: false, mesaj: 'Bu işlem için ayarlar modülünde oluşturma ve düzenleme izni gerekir.' });
        const kayit = (durum, ayrinti) => tablo.email_digest_log.push({ id: uid(), organization_id: ORG, gun: bugun(), tur: body?.test ? 'test' : 'gunluk', durum, ayrinti, created_at: new Date().toISOString() });
        if (ozetAyar.sonuc === 'yapilandirma') { kayit('hata', 'OZET_ALICI tanımlı değil.'); return { data: { ok: false, mesaj: 'OZET_ALICI tanımlı değil. Supabase gizli ayarlarına e-posta adresinizi ekleyin.' }, error: null }; }
        if (ozetAyar.sonuc === 'ag') return { data: null, error: { name: 'FunctionsFetchError', message: 'Failed to send a request to the Edge Function', context: undefined } };
        kayit('gonderildi', '[TEST] g***@gmail.com adresine gönderildi');
        return { data: { ok: true, mesaj: 'Gönderildi.' }, error: null };
      },
    },
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
