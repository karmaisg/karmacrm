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
      const yeni = { id: uid(), organization_id: ORG, created_at: new Date().toISOString(), archived_at: null, ...durum.yukle };
      satirlar.push(yeni);
      return { data: kopya(yeni), error: null };
    }
    if (durum.islem === 'update') {
      if (ad === 'users') {
        const u = eslesen[0];
        if (u && u.id === oturum?.user?.id && ('role_id' in durum.yukle || 'is_active' in durum.yukle)) return { data: null, error: hata('Kendi rolünüzü veya durumunuzu değiştiremezsiniz.', 'P0001') };
      }
      if (ad === 'role_permissions' && ['sistem_yoneticisi', 'isletme_sahibi'].some((k) => eslesen[0]?.role_id === rid(k))) return { data: null, error: hata('Sistem yöneticisi ve işletme sahibi yetkileri değiştirilemez.', 'P0001') };
      eslesen.forEach((r) => Object.assign(r, durum.yukle));
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
