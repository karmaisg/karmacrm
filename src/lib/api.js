// OSGB 360 - Veri erişim katmanı.
// Tüm veri tabanı çağrıları burada toplanır. Yetki kontrolü sunucuda (RLS) yapılır; buradaki
// kontroller yalnızca kullanıcıya anlaşılır mesaj göstermek içindir.

// ---------------------------------------------------------------- hata çevirisi
export class AppError extends Error {
  constructor(message, cause) {
    super(message);
    this.name = 'AppError';
    this.cause = cause;
    this.code = cause?.code;
  }
}

/** Postgres / PostgREST / Auth hatasını kullanıcıya gösterilecek Türkçe metne çevirir. */
export function humanError(e) {
  if (e instanceof AppError) return e.message;
  const msg = String(e?.message ?? e ?? '');
  const code = e?.code;
  if (code === '23505') {
    if (msg.includes('companies_tax_no_uq')) return 'Bu vergi numarasıyla kayıtlı aktif bir firma zaten var.';
    if (msg.includes('leads_tax_no_uq')) return 'Bu vergi numarasıyla kayıtlı aktif bir potansiyel müşteri zaten var.';
    if (msg.includes('offers_no_uq')) return 'Bu teklif numarası zaten kullanılıyor.';
    if (msg.includes('tasks_source_ref_uq')) return 'Bu iş için otomatik görev zaten oluşturulmuş.';
    return 'Bu kayıt zaten mevcut.';
  }
  if (code === '42501' || /row-level security|permission denied/i.test(msg)) return 'Bu işlem için yetkiniz yok.';
  if (code === '23P01' && msg.includes('contracts_aktif_cakisma')) return 'Bu firmanın aynı tarihlerde zaten aktif bir sözleşmesi var.';
  if (code === '23P01') return 'Tarih aralığı mevcut bir kayıtla çakışıyor.';
  if (code === '23514' && msg.includes('sales_opportunities_check')) return 'Kaybedilen fırsat için kayıp nedeni seçilmelidir.';
  if (code === '23514') return 'Girilen değerlerden biri izin verilen aralığın dışında.';
  if (code === '23503') return 'Bağlantılı kayıt bulunamadı.';
  if (code === 'PGRST116') return 'Kayıt bulunamadı ya da bu işlem için yetkiniz yok.';
  if (code === 'PGRST301' || /JWT/i.test(msg)) return 'Oturum süresi doldu. Lütfen yeniden giriş yapın.';
  if (code === 'P0001') return msg; // veri tabanındaki Türkçe "raise exception" mesajları
  if (/Failed to fetch|NetworkError|Load failed|network/i.test(msg)) {
    return 'Sunucuya ulaşılamadı. İnternet bağlantınızı kontrol edip tekrar deneyin.';
  }
  return msg ? `Beklenmeyen bir hata oluştu: ${msg}` : 'Beklenmeyen bir hata oluştu.';
}

function authError(e) {
  const msg = String(e?.message ?? '');
  const code = e?.code ?? '';
  if (/invalid login credentials/i.test(msg) || code === 'invalid_credentials') return new AppError('E-posta veya şifre hatalı.', e);
  if (/email not confirmed/i.test(msg) || code === 'email_not_confirmed') return new AppError('E-posta adresi onaylanmamış. Yöneticinizle iletişime geçin.', e);
  if (e?.status === 429 || /rate limit/i.test(msg) || code === 'over_request_rate_limit' || code === 'over_email_send_rate_limit') {
    return new AppError('Çok fazla deneme yapıldı. Birkaç dakika sonra tekrar deneyin.', e);
  }
  if (/password should be at least/i.test(msg) || code === 'weak_password') return new AppError('Şifre çok zayıf. Daha uzun ve tahmin edilmesi zor bir şifre seçin.', e);
  if (/same password|different from the old/i.test(msg) || code === 'same_password') return new AppError('Yeni şifre eskisinden farklı olmalıdır.', e);
  if (/Failed to fetch|NetworkError|Load failed/i.test(msg)) return new AppError('Sunucuya ulaşılamadı. İnternet bağlantınızı kontrol edip tekrar deneyin.', e);
  return new AppError(msg ? `Giriş işlemi başarısız: ${msg}` : 'Giriş işlemi başarısız.', e);
}

const wrap = (error) => (error instanceof AppError ? error : new AppError(humanError(error), error));

// Supabase tek istekte en fazla 1000 satır döndürür; daha fazlası için sayfa sayfa okunur.
const SAYFA = 1000;
async function hepsiniOku(sorguUret) {
  const satirlar = [];
  for (let bas = 0; ; bas += SAYFA) {
    const { data, error } = await sorguUret().range(bas, bas + SAYFA - 1);
    if (error) throw wrap(error);
    satirlar.push(...data);
    if (data.length < SAYFA) break;
  }
  return satirlar;
}

async function bir(sorgu) {
  const { data, error } = await sorgu;
  if (error) throw wrap(error);
  return data;
}

// ---------------------------------------------------------------- API
export function createApi(db) {
  const T = (ad) => db.from(ad);

  return {
    // ----- kimlik
    async getSession() {
      const { data, error } = await db.auth.getSession();
      if (error) throw authError(error);
      return data.session;
    },
    async signIn(email, password) {
      const { data, error } = await db.auth.signInWithPassword({ email: String(email).trim(), password });
      if (error) throw authError(error);
      return data.session;
    },
    async signOut() {
      const { error } = await db.auth.signOut();
      if (error) throw authError(error);
    },
    async resetPassword(email, redirectTo) {
      const { error } = await db.auth.resetPasswordForEmail(String(email).trim(), { redirectTo });
      if (error) throw authError(error);
    },
    async updatePassword(password) {
      const { error } = await db.auth.updateUser({ password });
      if (error) throw authError(error);
    },
    onAuthChange(cb) {
      const { data } = db.auth.onAuthStateChange((olay, oturum) => cb(olay, oturum));
      return data.subscription;
    },

    /** Oturum açan kullanıcının kurum, rol ve yetki bilgisi. Kurumda tanımlı değilse null. */
    async loadContext(userId) {
      const { data: user, error } = await T('users').select('*').eq('id', userId).maybeSingle();
      if (error) throw wrap(error);
      if (!user || !user.is_active) return null;
      const [role, org, permRows] = await Promise.all([
        bir(T('roles').select('*').eq('id', user.role_id).single()),
        bir(T('organizations').select('*').eq('id', user.organization_id).single()),
        bir(T('role_permissions').select('*').eq('role_id', user.role_id)),
      ]);
      const perms = {};
      for (const p of permRows) {
        perms[p.module] = { view: p.can_view, create: p.can_create, edit: p.can_edit, archive: p.can_archive };
      }
      return { user, role, org, perms };
    },

    // ----- firmalar
    listCompanies: () => hepsiniOku(() => T('companies').select('*').order('id')),
    getCompany: async (id) => {
      const { data, error } = await T('companies').select('*').eq('id', id).maybeSingle();
      if (error) throw wrap(error);
      return data;
    },
    /** Firma + (varsa) ilk çalışan/tehlike kaydı tek işlemde. */
    createCompany: async (firma, profil) => bir(db.rpc('firma_olustur', {
      p_firma: firma,
      p_calisan_sayisi: profil?.calisanSayisi ?? null,
      p_tehlike: profil?.tehlike ?? null,
      p_baslangic: profil?.baslangic ?? null,
    })),
    updateCompany: (id, degerler) => bir(T('companies').update(degerler).eq('id', id).select().single()),
    archiveCompany: (id) => bir(T('companies').update({ archived_at: new Date().toISOString() }).eq('id', id).select().single()),
    unarchiveCompany: (id) => bir(T('companies').update({ archived_at: null }).eq('id', id).select().single()),

    // ----- çalışan sayısı / tehlike sınıfı geçmişi
    listAllProfiles: () => hepsiniOku(() => T('company_profiles').select('*').order('id')),
    listProfiles: (companyId) => bir(T('company_profiles').select('*').eq('company_id', companyId).order('valid_from', { ascending: false })),
    addProfile: ({ companyId, calisanSayisi, tehlike, baslangic, not }) => bir(db.rpc('firma_profili_ekle', {
      p_firma: companyId, p_calisan_sayisi: calisanSayisi, p_tehlike: tehlike, p_baslangic: baslangic, p_not: not ?? null,
    })),

    // ----- parametreler (kurumdaki herkes okuyabilir)
    listServiceRules: () => bir(T('service_time_rules').select('*')),
    listSettings: () => bir(T('settings').select('*')),

    // ----- kişiler
    listContacts: () => hepsiniOku(() => T('contacts').select('*').order('id')),
    listContactsByCompany: (companyId) => bir(T('contacts').select('*').eq('company_id', companyId).order('full_name')),
    createContact: (degerler) => bir(T('contacts').insert(degerler).select().single()),
    updateContact: (id, degerler) => bir(T('contacts').update(degerler).eq('id', id).select().single()),
    archiveContact: (id) => bir(T('contacts').update({ archived_at: new Date().toISOString() }).eq('id', id).select().single()),
    unarchiveContact: (id) => bir(T('contacts').update({ archived_at: null }).eq('id', id).select().single()),

    // ----- kullanıcılar ve yetkiler
    /** Sorumlu seçimi için: kurumdaki herkesin yalnızca adı ve durumu. */
    listOrgMembers: () => bir(db.rpc('kurum_kullanicilari')),
    listUsers: () => bir(T('users').select('*')),
    listRoles: () => bir(T('roles').select('*')),
    listRolePermissions: () => bir(T('role_permissions').select('*')),
    updateUser: (id, degerler) => bir(T('users').update(degerler).eq('id', id).select().single()),
    addUser: ({ email, adSoyad, rol }) => bir(db.rpc('kullanici_ekle', { p_email: email, p_ad_soyad: adSoyad, p_rol: rol })),
    setPermission: (roleId, module, degerler) =>
      bir(T('role_permissions').update(degerler).eq('role_id', roleId).eq('module', module).select().single()),

    // ----- potansiyel müşteriler (CRM)
    listLeads: () => hepsiniOku(() => T('leads').select('*').order('id')),
    getLead: async (id) => {
      const { data, error } = await T('leads').select('*').eq('id', id).maybeSingle();
      if (error) throw wrap(error);
      return data;
    },
    /** Potansiyel müşteri + (yetki varsa) ilk satış fırsatı tek işlemde. */
    createLead: (veri) => bir(db.rpc('potansiyel_olustur', { p_veri: veri })),
    updateLead: (id, degerler) => bir(T('leads').update(degerler).eq('id', id).select().single()),
    archiveLead: (id) => bir(T('leads').update({ archived_at: new Date().toISOString() }).eq('id', id).select().single()),
    unarchiveLead: (id) => bir(T('leads').update({ archived_at: null }).eq('id', id).select().single()),
    convertLead: (id) => bir(db.rpc('potansiyel_firmaya_donustur', { p_lead: id })),
    listContactsByLead: (leadId) => bir(T('contacts').select('*').eq('lead_id', leadId).order('full_name')),

    // ----- satış fırsatları
    listOpportunities: () => hepsiniOku(() => T('sales_opportunities').select('*').order('id')),
    createOpportunity: (degerler) => bir(T('sales_opportunities').insert(degerler).select().single()),
    updateOpportunity: (id, degerler) => bir(T('sales_opportunities').update(degerler).eq('id', id).select().single()),
    /** Aşama değişimi; "kaybedildi" için neden zorunludur. Geçmişe veri tabanı tetikleyicisi yazar. */
    moveOpportunity: (id, asama, { neden = null, not = null } = {}) =>
      bir(T('sales_opportunities').update(asama === 'kaybedildi'
        ? { stage: asama, lost_reason: neden, lost_note: not }
        : { stage: asama }).eq('id', id).select().single()),
    archiveOpportunity: (id) => bir(T('sales_opportunities').update({ archived_at: new Date().toISOString() }).eq('id', id).select().single()),
    listStageHistory: (opportunityId) =>
      bir(T('opportunity_stage_history').select('*').eq('opportunity_id', opportunityId).order('changed_at', { ascending: false })),

    // ----- görüşmeler ve notlar
    listActivitiesByCompany: (companyId) => bir(T('activities').select('*').eq('company_id', companyId).is('archived_at', null).order('occurred_at', { ascending: false })),
    listActivitiesByLead: (leadId) => bir(T('activities').select('*').eq('lead_id', leadId).is('archived_at', null).order('occurred_at', { ascending: false })),
    createActivity: (degerler) => bir(T('activities').insert(degerler).select().single()),
    updateActivity: (id, degerler) => bir(T('activities').update(degerler).eq('id', id).select().single()),
    archiveActivity: (id) => bir(T('activities').update({ archived_at: new Date().toISOString() }).eq('id', id).select().single()),

    // ----- görevler
    listTasks: () => hepsiniOku(() => T('tasks').select('*').order('id')),
    createTask: (degerler) => bir(T('tasks').insert(degerler).select().single()),
    updateTask: (id, degerler) => bir(T('tasks').update(degerler).eq('id', id).select().single()),
    archiveTask: (id) => bir(T('tasks').update({ archived_at: new Date().toISOString() }).eq('id', id).select().single()),

    // ----- teklifler
    listOffers: () => hepsiniOku(() => T('offers').select('*').order('id')),
    createOffer: (degerler) => bir(T('offers').insert(degerler).select().single()),
    updateOffer: (id, degerler) => bir(T('offers').update(degerler).eq('id', id).select().single()),
    setOfferStatus: (id, durum) => bir(T('offers').update({ status: durum }).eq('id', id).select().single()),
    archiveOffer: (id) => bir(T('offers').update({ archived_at: new Date().toISOString() }).eq('id', id).select().single()),
    listOfferItems: (offerId) => bir(T('offer_items').select('*').eq('offer_id', offerId).is('archived_at', null).order('created_at')),
    createOfferItem: (degerler) => bir(T('offer_items').insert(degerler).select().single()),
    archiveOfferItem: (id) => bir(T('offer_items').update({ archived_at: new Date().toISOString() }).eq('id', id).select().single()),
    copyOffer: (id) => bir(db.rpc('teklif_kopyala', { p_offer: id })),
    acceptOffer: ({ id, baslangic, bitis, odeme, yenileme, fiyatGuncelleme }) => bir(db.rpc('teklif_kabul_et', {
      p_offer: id, p_baslangic: baslangic, p_bitis: bitis, p_odeme: odeme ?? null, p_yenileme: yenileme ?? null, p_fiyat_guncelleme: fiyatGuncelleme ?? null,
    })),

    // ----- sözleşmeler
    listContracts: () => hepsiniOku(() => T('contracts').select('*').order('id')),
    getContract: async (id) => {
      const { data, error } = await T('contracts').select('*').eq('id', id).maybeSingle();
      if (error) throw wrap(error);
      return data;
    },
    listAllContractPrices: () => hepsiniOku(() => T('contract_prices').select('*').order('id')),
    listContractPrices: (contractId) => bir(T('contract_prices').select('*').eq('contract_id', contractId).order('valid_from', { ascending: false })),
    createContract: (k) => bir(db.rpc('sozlesme_olustur', {
      p_firma: k.firma, p_baslangic: k.baslangic, p_bitis: k.bitis, p_fiyatlama: k.fiyatlama, p_birim: k.birim ?? null, p_sabit: k.sabit ?? null,
      p_kdv_modu: k.kdvModu ?? 'kdv_haric', p_kdv_orani: k.kdvOrani ?? 20, p_durum: k.durum ?? 'aktif',
      p_uzman: k.uzman ?? true, p_hekim: k.hekim ?? true, p_odeme: k.odeme ?? null, p_yenileme: k.yenileme ?? null,
      p_fiyat_guncelleme: k.fiyatGuncelleme ?? null, p_teklif: k.teklif ?? null, p_not: k.not ?? null,
    })),
    updateContract: (id, degerler) => bir(T('contracts').update(degerler).eq('id', id).select().single()),
    archiveContract: (id) => bir(T('contracts').update({ archived_at: new Date().toISOString() }).eq('id', id).select().single()),
    addContractPrice: (k) => bir(db.rpc('sozlesme_fiyat_ekle', {
      p_contract: k.contractId, p_fiyatlama: k.fiyatlama, p_birim: k.birim ?? null, p_sabit: k.sabit ?? null,
      p_kdv_modu: k.kdvModu, p_kdv_orani: k.kdvOrani, p_baslangic: k.baslangic, p_not: k.not ?? null,
    })),
    renewContract: ({ id, baslangic, bitis, not }) => bir(db.rpc('sozlesme_yenile', { p_contract: id, p_baslangic: baslangic, p_bitis: bitis, p_fiyat_notu: not ?? null })),
    createRenewalTasks: () => bir(db.rpc('sozlesme_yenileme_gorevleri')),
  };
}
