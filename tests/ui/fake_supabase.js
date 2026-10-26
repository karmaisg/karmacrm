// Test amaçlı sahte supabase-js. Tarayıcıda jsDelivr isteğinin yerine sunulur (Playwright route).
// Gerçek RLS/PostgREST davranışını TAKLİT ETMEZ; yalnızca arayüz akışlarını denemek içindir.
const uid = (() => { let n = 0; return () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`; })();
const ORG = uid();
const roleKeys = ['sistem_yoneticisi', 'isletme_sahibi', 'satis', 'operasyon', 'finans', 'uzman_hekim'];
const roles = roleKeys.map((key) => ({ id: uid(), organization_id: ORG, key, name: key, is_system: true }));
const rid = (k) => roles.find((r) => r.key === k).id;
const MODULLER = ['dashboard', 'crm', 'companies', 'contacts', 'opportunities', 'offers', 'contracts', 'staff', 'assignments', 'time', 'invoices', 'expenses', 'payroll', 'staff_profit', 'company_profit', 'capacity', 'reports', 'tasks', 'import_export', 'users', 'settings'];
const matris = {
  sistem_yoneticisi: () => [1, 1, 1, 1], isletme_sahibi: () => [1, 1, 1, 1],
  satis: (m) => (['dashboard', 'crm', 'companies', 'contacts', 'opportunities', 'offers', 'contracts', 'tasks'].includes(m) ? [1, 1, 1, 0] : [0, 0, 0, 0]),
  operasyon: (m) => (['dashboard', 'companies', 'contacts', 'staff', 'assignments', 'time', 'capacity', 'tasks'].includes(m) ? [1, 1, 1, 0] : [0, 0, 0, 0]),
  finans: (m) => (['dashboard', 'companies', 'invoices', 'expenses'].includes(m) ? [1, 1, 1, 0] : [0, 0, 0, 0]),
  uzman_hekim: (m) => (['time'].includes(m) ? [1, 1, 0, 0] : [0, 0, 0, 0]),
};
const role_permissions = [];
for (const k of roleKeys) for (const m of MODULLER) { const [v, c, e, a] = matris[k](m); role_permissions.push({ role_id: rid(k), module: m, can_view: !!v, can_create: !!c, can_edit: !!e, can_archive: !!a }); }

const kullaniciKayit = (id, email, ad, rol, sifre) => ({ id, email, sifre, row: { id, organization_id: ORG, role_id: rid(rol), full_name: ad, email, employee_id: null, is_active: true, created_at: '2026-10-01T09:00:00Z' } });
const hesaplar = [
  kullaniciKayit(uid(), 'sahip@test.com', 'Barış Sahip', 'isletme_sahibi', 'GucluSifre123'),
  kullaniciKayit(uid(), 'satis@test.com', 'Selin Satış', 'satis', 'GucluSifre123'),
  kullaniciKayit(uid(), 'finans@test.com', 'Fatih Finans', 'finans', 'GucluSifre123'),
  kullaniciKayit(uid(), 'uzman@test.com', 'Uzman Kişi', 'uzman_hekim', 'GucluSifre123'),
];
// Supabase Authentication'da olup henüz kuruma eklenmemiş kullanıcı
const authSadece = [{ id: uid(), email: 'yeni@test.com' }];

const tablo = {
  organizations: [{ id: ORG, name: 'Test OSGB' }],
  roles, role_permissions,
  users: hesaplar.map((h) => h.row),
  companies: [], company_profiles: [], contacts: [], leads: [],
  sales_opportunities: [], opportunity_stage_history: [], activities: [], tasks: [],
  settings: [{ key: 'kapasite_dakika', value: 11700, valid_from: '2000-01-01' }],
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
    const eslesen = satirlar.filter((r) => durum.filtre.every(([k, v]) => r[k] === v));
    if (durum.islem === 'insert') {
      const simdi = new Date().toISOString();
      const yeni = { id: uid(), organization_id: ORG, created_at: simdi, updated_at: simdi, archived_at: null, ...durum.yukle };
      if (ad === 'sales_opportunities') { yeni.stage ??= 'yeni_aday'; tablo.opportunity_stage_history.push({ id: uid(), opportunity_id: yeni.id, from_stage: null, to_stage: yeni.stage, changed_at: simdi, changed_by: oturum?.user?.id }); }
      if (ad === 'tasks') { yeni.status ??= 'acik'; yeni.priority ??= 'orta'; yeni.kind ??= 'diger'; }
      satirlar.push(yeni);
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
      if (ad === 'tasks' && durum.yukle.status === 'tamamlandi') durum.yukle.completed_at = new Date().toISOString();
      if (ad === 'tasks' && durum.yukle.status && durum.yukle.status !== 'tamamlandi') durum.yukle.completed_at = null;
      eslesen.forEach((r) => Object.assign(r, durum.yukle, { updated_at: new Date().toISOString() }));
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
    is(k, v) { durum.filtre.push([k, v]); return q; },
    order(k, o = {}) { durum.sira = { k, artan: o.ascending !== false }; return q; },
    range(a, b) { durum.aralik = [a, b]; return q; },
    single() { durum.tek = 'single'; return q; },
    maybeSingle() { durum.tek = 'maybe'; return q; },
    then(res, rej) { return new Promise((r) => setTimeout(r, 5)).then(calistir).then(res, rej); },
  };
  return q;
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
