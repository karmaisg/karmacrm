-- =====================================================================
-- OSGB 360 (karmacrm) - Veri tabanı şeması v0.1  (Aşama 1)
-- Hedef: Supabase (PostgreSQL 15+)
--
-- Temel ilkeler
--  * Her tabloda organization_id var (şimdilik tek işletme, ileride SaaS).
--  * Satırlar fiziksel silinmez: archived_at / archived_by ile arşivlenir.
--  * Tarihçeli veriler valid_from / valid_to ile tutulur.
--  * Para numeric(14,2); KDV hariç / KDV tutarı / KDV dahil ayrı saklanır.
--  * Erişim kuralları (RLS) veri tabanında uygulanır.
--
-- Bu dosya Supabase > SQL Editor'da bir kez çalıştırılır.
-- =====================================================================

create extension if not exists pgcrypto;
create extension if not exists btree_gist;

create schema if not exists app;

-- ---------------------------------------------------------------------
-- 1. Sabit listeler (enum)
-- ---------------------------------------------------------------------
create type hazard_class     as enum ('az_tehlikeli','tehlikeli','cok_tehlikeli');
create type staff_type       as enum ('is_guvenligi_uzmani','isyeri_hekimi');
create type pricing_type     as enum ('kisi_basi','sabit_aylik','ozel');
create type vat_mode         as enum ('kdv_haric','kdv_dahil');
create type lead_source      as enum ('tavsiye','google_web','telefon','saha_ziyareti','sosyal_medya','reklam','etkinlik','diger');
create type opp_stage        as enum ('yeni_aday','ilk_temas_bekleniyor','ilk_gorusme_yapildi','ihtiyac_analizi_yapildi',
                                      'teklif_hazirlaniyor','teklif_gonderildi','pazarlik','kazanildi','kaybedildi','ertelendi');
create type lost_reason      as enum ('fiyat','rakip','karar_degisti','hizmet_bolgesi','zamanlama','ihtiyac_kalmadi','diger');
create type offer_status     as enum ('taslak','onay_bekliyor','gonderildi','gorusuluyor','kabul_edildi','reddedildi','suresi_doldu');
create type contract_status  as enum ('taslak','aktif','yenilendi','sona_erdi','feshedildi');
create type activity_kind    as enum ('gorusme','arama','eposta','ziyaret','not','sikayet','cozum');
create type task_kind        as enum ('potansiyel_arama','teklif_takibi','musteri_ziyareti','sozlesme_yenileme',
                                      'tahsilat_takibi','musteri_sikayeti','fiyat_guncelleme','diger');
create type task_status      as enum ('acik','devam_ediyor','tamamlandi','iptal');
create type priority_level   as enum ('dusuk','orta','yuksek','kritik');
create type collection_flag  as enum ('itirazli','takip_gerekiyor');
create type cost_type        as enum ('dogrudan','ortak');
create type allocation_basis as enum ('fiili_sure','gelir_orani','musteri_sayisi','personel_sayisi','ziyaret_sayisi','kilometre','manuel');
create type message_channel  as enum ('eposta','sms','whatsapp','uygulama_ici');
create type message_status   as enum ('beklemede','gonderildi','basarisiz','iptal');

-- ---------------------------------------------------------------------
-- 2. Kurum, rol ve kullanıcı tabloları
-- ---------------------------------------------------------------------
create table organizations (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  tax_no      text,
  created_at  timestamptz not null default now()
);

create table roles (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references organizations(id),
  key              text not null,            -- sistem_yoneticisi, isletme_sahibi, satis, operasyon, finans, uzman_hekim
  name             text not null,
  is_system        boolean not null default true,
  unique (organization_id, key)
);

-- Modül bazında yetki matrisi (rol x modül)
create table role_permissions (
  role_id      uuid not null references roles(id) on delete cascade,
  module       text not null,
  can_view     boolean not null default false,
  can_create   boolean not null default false,
  can_edit     boolean not null default false,
  can_archive  boolean not null default false,
  primary key (role_id, module)
);

create table users (
  id               uuid primary key references auth.users(id) on delete cascade,
  organization_id  uuid not null references organizations(id),
  role_id          uuid not null references roles(id),
  full_name        text not null,
  email            text,
  employee_id      uuid,                      -- uzman/hekim kullanıcısı ise bağlanır (FK aşağıda)
  is_active        boolean not null default true,
  created_at       timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 3. Yardımcı fonksiyonlar (RLS bunları kullanır)
-- ---------------------------------------------------------------------
create or replace function app.org_id() returns uuid
language sql stable security definer set search_path = public as $$
  select organization_id from public.users where id = auth.uid() and is_active
$$;

create or replace function app.can(p_module text, p_action text default 'view') returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((
    select case p_action
             when 'view'    then rp.can_view
             when 'create'  then rp.can_create
             when 'edit'    then rp.can_edit
             when 'archive' then rp.can_archive
             else false end
    from public.users u
    join public.role_permissions rp on rp.role_id = u.role_id and rp.module = p_module
    where u.id = auth.uid() and u.is_active
  ), false)
$$;

create or replace function app.touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

-- Arşivleme: archived_at doluyorsa kullanıcı ve yetki kaydedilir
create or replace function app.guard_archive() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.archived_at is null and new.archived_at is not null then
    if not app.can(tg_argv[0], 'archive') then
      raise exception 'Bu kaydı arşivleme yetkiniz yok (%).', tg_argv[0];
    end if;
    new.archived_by := auth.uid();
  end if;
  return new;
end $$;

-- Denetim geçmişi
create table audit_logs (
  id               bigint generated always as identity primary key,
  organization_id  uuid,
  table_name       text not null,
  record_id        text,
  action           text not null,            -- INSERT / UPDATE
  old_data         jsonb,
  new_data         jsonb,
  user_id          uuid,
  created_at       timestamptz not null default now()
);

create or replace function app.audit() returns trigger
language plpgsql security definer set search_path = public as $$
declare rec jsonb := to_jsonb(coalesce(new, old));
begin
  insert into audit_logs(organization_id, table_name, record_id, action, old_data, new_data, user_id)
  values ((rec->>'organization_id')::uuid, tg_table_name, rec->>'id', tg_op,
          case when tg_op = 'UPDATE' then to_jsonb(old) end, to_jsonb(new), auth.uid());
  return new;
end $$;

-- ---------------------------------------------------------------------
-- 4. Ayarlar ve parametreler (tarihçeli)
-- ---------------------------------------------------------------------
create table settings (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null default app.org_id() references organizations(id),
  key              text not null,            -- ör. kapasite_dakika, kurumlar_vergisi_orani, marj_esigi, yenileme_gunleri
  value            jsonb not null,
  valid_from       date not null default current_date,
  created_at       timestamptz not null default now(),
  created_by       uuid default auth.uid(),
  unique (organization_id, key, valid_from)
);

-- Teorik hizmet süresi kuralları (çalışan başına dakika). Mevzuat değişince YENİ satır eklenir, eskisi düzenlenmez.
create table service_time_rules (
  id                   uuid primary key default gen_random_uuid(),
  organization_id      uuid not null default app.org_id() references organizations(id),
  staff_type           staff_type not null,
  hazard_class         hazard_class not null,
  minutes_per_employee numeric(8,2) not null check (minutes_per_employee >= 0),
  valid_from           date not null,
  valid_to             date,
  note                 text,
  created_at           timestamptz not null default now(),
  check (valid_to is null or valid_to >= valid_from),
  exclude using gist (organization_id with =, staff_type with =, hazard_class with =,
                      daterange(valid_from, coalesce(valid_to,'infinity'),'[]') with &&)
);

-- ---------------------------------------------------------------------
-- 5. Firmalar, kişiler, potansiyel müşteriler
-- ---------------------------------------------------------------------
create table companies (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null default app.org_id() references organizations(id),
  name             text not null,
  tax_no           text,                      -- vergi no / kurum tanımlayıcısı
  sector           text,
  city             text, district text, address text,
  phone            text, email text, website text,
  current_provider text,                      -- mevcut OSGB, biliniyorsa
  customer_status  text not null default 'musteri' check (customer_status in ('musteri','eski_musteri')),
  responsible_user uuid references users(id),
  notes            text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  archived_at      timestamptz,
  archived_by      uuid
);
-- Mükerrer firma koruması (vergi numarası dolu ve arşivde olmayan kayıtlar için)
create unique index companies_tax_no_uq on companies(organization_id, tax_no)
  where tax_no is not null and archived_at is null;

-- Çalışan sayısı + tehlike sınıfı geçmişi (geçmiş ay raporları bozulmasın diye)
create table company_profiles (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null default app.org_id() references organizations(id),
  company_id       uuid not null references companies(id),
  employee_count   integer not null check (employee_count >= 0),
  hazard_class     hazard_class not null,
  valid_from       date not null,
  valid_to         date,
  note             text,
  created_at       timestamptz not null default now(),
  created_by       uuid default auth.uid(),
  check (valid_to is null or valid_to >= valid_from),
  exclude using gist (company_id with =, daterange(valid_from, coalesce(valid_to,'infinity'),'[]') with &&)
);

create table contacts (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null default app.org_id() references organizations(id),
  company_id       uuid references companies(id),
  lead_id          uuid,                      -- FK aşağıda
  full_name        text not null,
  title            text,
  phone            text, email text,
  is_decision_maker boolean not null default false,
  notes            text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  archived_at      timestamptz,
  archived_by      uuid,
  check (company_id is not null or lead_id is not null)
);

create table leads (
  id                    uuid primary key default gen_random_uuid(),
  organization_id       uuid not null default app.org_id() references organizations(id),
  name                  text not null,
  tax_no                text,
  sector                text,
  hazard_class          hazard_class,
  employee_count        integer check (employee_count >= 0),
  city text, district text, address text,
  phone text, email text, website text,
  contact_name          text, contact_title text,
  source                lead_source,
  current_provider      text,
  est_monthly_revenue   numeric(14,2),
  est_service_minutes   integer,
  est_direct_cost       numeric(14,2),
  est_contribution      numeric(14,2),
  sales_owner           uuid references users(id),
  last_contact_date     date,
  next_follow_up_date   date,
  priority              priority_level not null default 'orta',
  score                 numeric(5,2),          -- puanlama sonucu (açıklaması score_details'te)
  score_details         jsonb,
  converted_company_id  uuid references companies(id),
  notes                 text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  archived_at           timestamptz,
  archived_by           uuid
);
create unique index leads_tax_no_uq on leads(organization_id, tax_no)
  where tax_no is not null and archived_at is null;

alter table contacts add constraint contacts_lead_fk foreign key (lead_id) references leads(id);

-- ---------------------------------------------------------------------
-- 6. Satış fırsatları ve aktiviteler
-- ---------------------------------------------------------------------
create table sales_opportunities (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null default app.org_id() references organizations(id),
  lead_id          uuid references leads(id),
  company_id       uuid references companies(id),
  title            text not null,
  stage            opp_stage not null default 'yeni_aday',
  expected_monthly numeric(14,2),
  lost_reason      lost_reason,
  lost_note        text,
  owner_user       uuid references users(id),
  closed_at        timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  archived_at      timestamptz,
  archived_by      uuid,
  check (lead_id is not null or company_id is not null),
  check (stage <> 'kaybedildi' or lost_reason is not null)
);

create table opportunity_stage_history (
  id               bigint generated always as identity primary key,
  organization_id  uuid not null default app.org_id() references organizations(id),
  opportunity_id   uuid not null references sales_opportunities(id),
  from_stage       opp_stage,
  to_stage         opp_stage not null,
  changed_at       timestamptz not null default now(),
  changed_by       uuid default auth.uid()
);

create or replace function app.log_stage_change() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' or old.stage is distinct from new.stage then
    insert into opportunity_stage_history(organization_id, opportunity_id, from_stage, to_stage)
    values (new.organization_id, new.id, case when tg_op='UPDATE' then old.stage end, new.stage);
  end if;
  return new;
end $$;
create trigger trg_opp_stage after insert or update on sales_opportunities
  for each row execute function app.log_stage_change();

create table activities (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null default app.org_id() references organizations(id),
  company_id       uuid references companies(id),
  lead_id          uuid references leads(id),
  opportunity_id   uuid references sales_opportunities(id),
  contact_id       uuid references contacts(id),
  kind             activity_kind not null,
  occurred_at      timestamptz not null default now(),
  summary          text not null,
  details          text,
  created_by       uuid default auth.uid(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  archived_at      timestamptz,
  archived_by      uuid,
  check (company_id is not null or lead_id is not null or opportunity_id is not null)
);

create table tasks (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null default app.org_id() references organizations(id),
  kind             task_kind not null default 'diger',
  title            text not null,
  company_id       uuid references companies(id),
  lead_id          uuid references leads(id),
  assignee         uuid references users(id),
  priority         priority_level not null default 'orta',
  due_at           timestamptz,
  remind_at        timestamptz,
  status           task_status not null default 'acik',
  description      text,
  completed_at     timestamptz,
  source_ref       text,                      -- otomatik görevlerde kaynak (ör. invoice:<id>) - mükerrer görevi önler
  created_by       uuid default auth.uid(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  archived_at      timestamptz,
  archived_by      uuid
);
create unique index tasks_source_ref_uq on tasks(organization_id, source_ref)
  where source_ref is not null and archived_at is null;

-- ---------------------------------------------------------------------
-- 7. Uzman / hekim, maliyet, görevlendirme
-- ---------------------------------------------------------------------
create table employees (
  id                    uuid primary key default gen_random_uuid(),
  organization_id       uuid not null default app.org_id() references organizations(id),
  full_name             text not null,
  staff_type            staff_type not null,
  title                 text,
  qualifications        text,
  phone text, email text,
  start_date            date,
  end_date              date,
  is_active             boolean not null default true,
  monthly_capacity_min  integer not null default 11700 check (monthly_capacity_min > 0),
  notes                 text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  archived_at           timestamptz,
  archived_by           uuid
);
alter table users add constraint users_employee_fk foreign key (employee_id) references employees(id);

-- Maaş ve işveren maliyetleri: HASSAS (yalnızca 'payroll' yetkisi olanlar görür)
create table employee_costs (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null default app.org_id() references organizations(id),
  employee_id        uuid not null references employees(id),
  gross_salary       numeric(14,2) not null default 0,
  employer_sgk       numeric(14,2) not null default 0,
  other_benefits     numeric(14,2) not null default 0,
  total_monthly_cost numeric(14,2) generated always as (gross_salary + employer_sgk + other_benefits) stored,
  valid_from         date not null,
  valid_to           date,
  created_at         timestamptz not null default now(),
  created_by         uuid default auth.uid(),
  check (valid_to is null or valid_to >= valid_from),
  exclude using gist (employee_id with =, daterange(valid_from, coalesce(valid_to,'infinity'),'[]') with &&)
);

-- Görevlendirme: firma + personel + dönem.
-- Firmanın TOPLAM hizmet ihtiyacı company_profiles x service_time_rules'tan hesaplanır;
-- burada yalnızca bu ihtiyacın kişiye düşen PAYI (share_pct) tutulur. Böylece süre mükerrer sayılmaz.
create table assignments (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null default app.org_id() references organizations(id),
  company_id         uuid not null references companies(id),
  employee_id        uuid not null references employees(id),
  staff_type         staff_type not null,
  share_pct          numeric(5,2) not null default 100 check (share_pct > 0 and share_pct <= 100),
  valid_from         date not null,
  valid_to           date,
  official_ref       text,                    -- resmî görevlendirme/bildirim referansı (sözleşme tarihlerinden AYRI)
  official_start     date,
  official_end       date,
  notes              text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  archived_at        timestamptz,
  archived_by        uuid,
  check (valid_to is null or valid_to >= valid_from),
  exclude using gist (company_id with =, employee_id with =, staff_type with =,
                      daterange(valid_from, coalesce(valid_to,'infinity'),'[]') with &&)
    where (archived_at is null)
);

-- Bir firmada aynı hizmet türü için paylar aynı dönemde %100'ü aşamaz
create or replace function app.check_assignment_shares() returns trigger
language plpgsql security definer set search_path = public as $$
declare total numeric;
begin
  select coalesce(sum(share_pct),0) into total
  from assignments a
  where a.company_id = new.company_id and a.staff_type = new.staff_type
    and a.archived_at is null and a.id <> new.id
    and daterange(a.valid_from, coalesce(a.valid_to,'infinity'),'[]') && daterange(new.valid_from, coalesce(new.valid_to,'infinity'),'[]');
  if total + new.share_pct > 100 then
    raise exception 'Bu firmada aynı dönemde % hizmet payı toplamı %%100''ü aşıyor (mevcut: %).', new.staff_type, total;
  end if;
  return new;
end $$;
create trigger trg_assignment_shares before insert or update on assignments
  for each row when (new.archived_at is null) execute function app.check_assignment_shares();

-- Fiilî çalışma kayıtları
create table time_entries (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null default app.org_id() references organizations(id),
  employee_id        uuid not null references employees(id),
  company_id         uuid references companies(id),   -- yol/idari kayıtlarda boş olabilir
  activity_type      text not null,
  work_date          date not null,
  start_at           timestamptz not null,
  end_at             timestamptz not null,
  total_minutes      integer generated always as ((extract(epoch from (end_at - start_at))/60)::int) stored,
  onsite_minutes     integer not null default 0 check (onsite_minutes >= 0),
  travel_minutes     integer not null default 0 check (travel_minutes >= 0),
  waiting_minutes    integer not null default 0 check (waiting_minutes >= 0),
  reporting_minutes  integer not null default 0 check (reporting_minutes >= 0),
  admin_minutes      integer not null default 0 check (admin_minutes >= 0),
  trip_group_id      uuid,                    -- aynı yolculuğun birden fazla firmaya paylaştırılması için
  trip_share_pct     numeric(5,2) check (trip_share_pct is null or (trip_share_pct > 0 and trip_share_pct <= 100)),
  notes              text,
  created_by         uuid default auth.uid(),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  archived_at        timestamptz,
  archived_by        uuid,
  check (end_at > start_at),
  check (onsite_minutes + travel_minutes + waiting_minutes + reporting_minutes + admin_minutes
         <= (extract(epoch from (end_at - start_at))/60)::int),
  -- Aynı personelde zaman çakışması engellenir
  exclude using gist (employee_id with =, tstzrange(start_at, end_at) with &&) where (archived_at is null)
);

-- ---------------------------------------------------------------------
-- 8. Teklifler ve sözleşmeler
-- ---------------------------------------------------------------------
create table offers (
  id                    uuid primary key default gen_random_uuid(),
  organization_id       uuid not null default app.org_id() references organizations(id),
  offer_no              text,
  company_id            uuid references companies(id),
  lead_id               uuid references leads(id),
  opportunity_id        uuid references sales_opportunities(id),
  offer_date            date not null default current_date,
  valid_until           date,
  employee_count        integer not null check (employee_count >= 0),
  hazard_class          hazard_class not null,
  pricing               pricing_type not null,
  unit_price            numeric(14,2),        -- kişi başı aylık
  fixed_monthly_price   numeric(14,2),        -- sabit aylık
  vat_mode              vat_mode not null default 'kdv_haric',
  vat_rate              numeric(5,2) not null default 20,
  discount_pct          numeric(5,2) not null default 0 check (discount_pct >= 0 and discount_pct <= 100),
  est_expert_cost       numeric(14,2),
  est_physician_cost    numeric(14,2),
  est_travel_other_cost numeric(14,2),
  status                offer_status not null default 'taslak',
  description           text,
  created_by            uuid default auth.uid(),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  archived_at           timestamptz,
  archived_by           uuid,
  check (company_id is not null or lead_id is not null)
);

create table offer_items (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null default app.org_id() references organizations(id),
  offer_id         uuid not null references offers(id),
  description      text not null,
  quantity         numeric(10,2) not null default 1,
  unit_price       numeric(14,2) not null,
  vat_mode         vat_mode not null default 'kdv_haric',
  vat_rate         numeric(5,2) not null default 20,
  created_at       timestamptz not null default now(),
  archived_at      timestamptz,
  archived_by      uuid
);

create table contracts (
  id                    uuid primary key default gen_random_uuid(),
  organization_id       uuid not null default app.org_id() references organizations(id),
  company_id            uuid not null references companies(id),
  offer_id              uuid references offers(id),
  previous_contract_id  uuid references contracts(id),   -- yenileme zinciri
  start_date            date not null,
  end_date              date not null,
  status                contract_status not null default 'taslak',
  expert_service        boolean not null default true,
  physician_service     boolean not null default true,
  payment_terms         text,
  renewal_terms         text,
  price_update_terms    text,
  owner_user            uuid references users(id),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  archived_at           timestamptz,
  archived_by           uuid,
  check (end_date >= start_date)
);

-- Sözleşme fiyat geçmişi: eski fiyatlar korunur
create table contract_prices (
  id                   uuid primary key default gen_random_uuid(),
  organization_id      uuid not null default app.org_id() references organizations(id),
  contract_id          uuid not null references contracts(id),
  pricing              pricing_type not null,
  unit_price           numeric(14,2),
  fixed_monthly_price  numeric(14,2),
  vat_mode             vat_mode not null,
  vat_rate             numeric(5,2) not null default 20,
  valid_from           date not null,
  valid_to             date,
  note                 text,
  created_at           timestamptz not null default now(),
  created_by           uuid default auth.uid(),
  check (valid_to is null or valid_to >= valid_from),
  exclude using gist (contract_id with =, daterange(valid_from, coalesce(valid_to,'infinity'),'[]') with &&)
);

-- ---------------------------------------------------------------------
-- 9. Gelir ve tahsilat
-- ---------------------------------------------------------------------
create table invoices (
  id                   uuid primary key default gen_random_uuid(),
  organization_id      uuid not null default app.org_id() references organizations(id),
  company_id           uuid not null references companies(id),
  contract_id          uuid references contracts(id),
  invoice_no           text not null,
  invoice_date         date not null,
  due_date             date not null,
  service_period       date,                      -- hizmet dönemi (ayın 1'i)
  amount_excl_vat      numeric(14,2) not null check (amount_excl_vat >= 0),
  vat_amount           numeric(14,2) not null check (vat_amount >= 0),
  amount_incl_vat      numeric(14,2) generated always as (amount_excl_vat + vat_amount) stored,
  flag                 collection_flag,           -- elle işaretlenen: itirazlı / takip gerekiyor
  notes                text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  archived_at          timestamptz,
  archived_by          uuid,
  check (service_period is null or extract(day from service_period) = 1),
  unique (organization_id, invoice_no)
);

create table invoice_items (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null default app.org_id() references organizations(id),
  invoice_id       uuid not null references invoices(id),
  description      text not null,
  quantity         numeric(10,2) not null default 1,
  unit_price_excl  numeric(14,2) not null,
  vat_rate         numeric(5,2) not null default 20,
  created_at       timestamptz not null default now(),
  archived_at      timestamptz,
  archived_by      uuid
);

-- Bir faturaya birden çok (kısmi) tahsilat girilebilir. Tutar KDV DAHİL.
create table payments (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null default app.org_id() references organizations(id),
  invoice_id       uuid not null references invoices(id),
  paid_at          date not null,
  amount           numeric(14,2) not null check (amount > 0),
  method           text,
  notes            text,
  created_by       uuid default auth.uid(),
  created_at       timestamptz not null default now(),
  archived_at      timestamptz,
  archived_by      uuid
);

-- Fatura bakiyesi ve tahsilat durumu (hesaplanır, saklanmaz)
create view invoice_balances with (security_invoker = true) as
select i.id as invoice_id, i.organization_id, i.company_id, i.invoice_no, i.due_date,
       i.amount_incl_vat,
       coalesce(p.paid_total, 0)                         as paid_total,
       i.amount_incl_vat - coalesce(p.paid_total, 0)     as balance,
       (coalesce(p.paid_total,0) > i.amount_incl_vat)    as overpaid,
       case
         when i.flag = 'itirazli'        then 'itirazli'
         when i.flag = 'takip_gerekiyor' then 'takip_gerekiyor'
         when coalesce(p.paid_total,0) >= i.amount_incl_vat then 'tahsil_edildi'
         when coalesce(p.paid_total,0) > 0                  then 'kismi_tahsilat'
         else 'tahsil_edilmedi'
       end as collection_status,
       greatest(current_date - i.due_date, 0)            as days_overdue
from invoices i
left join (select invoice_id, sum(amount) as paid_total from payments where archived_at is null group by invoice_id) p
       on p.invoice_id = i.id
where i.archived_at is null;

-- ---------------------------------------------------------------------
-- 10. Giderler ve ortak gider dağıtımı
-- ---------------------------------------------------------------------
create table expense_categories (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null default app.org_id() references organizations(id),
  name             text not null,
  nature           text not null default 'isletme' check (nature in ('isletme','personel','vergi','stopaj','sgk')),
  default_cost_type cost_type not null default 'ortak',
  is_payroll       boolean not null default false,   -- true ise 'payroll' yetkisi gerekir
  is_income_tax    boolean not null default false,   -- kurumlar vergisi: tahmini vergiyle ikinci kez düşülmesin
  sort_order       integer not null default 0,
  unique (organization_id, name)
);

create table expenses (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null default app.org_id() references organizations(id),
  category_id        uuid not null references expense_categories(id),
  expense_date       date not null,
  amount_excl_vat    numeric(14,2) not null check (amount_excl_vat >= 0),
  vat_amount         numeric(14,2) not null default 0 check (vat_amount >= 0),
  amount_incl_vat    numeric(14,2) generated always as (amount_excl_vat + vat_amount) stored,
  cost_type          cost_type not null default 'ortak',
  company_id         uuid references companies(id),
  employee_id        uuid references employees(id),
  paid               boolean not null default false,
  description        text,
  created_by         uuid default auth.uid(),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  archived_at        timestamptz,
  archived_by        uuid,
  -- Doğrudan gider bir firmaya veya personele bağlı olmalı
  check (cost_type = 'ortak' or company_id is not null or employee_id is not null)
);

-- Gider kategorisi için dağıtım kuralı (tarihçeli)
create table allocation_rules (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null default app.org_id() references organizations(id),
  category_id      uuid not null references expense_categories(id),
  basis            allocation_basis not null,
  valid_from       date not null,
  valid_to         date,
  created_at       timestamptz not null default now(),
  created_by       uuid default auth.uid(),
  check (valid_to is null or valid_to >= valid_from),
  exclude using gist (category_id with =, daterange(valid_from, coalesce(valid_to,'infinity'),'[]') with &&)
);

-- Ortak gider dağıtım satırları (dönem + kategori + firma)
create table overhead_allocations (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null default app.org_id() references organizations(id),
  period           date not null check (extract(day from period) = 1),
  category_id      uuid not null references expense_categories(id),
  company_id       uuid references companies(id),
  employee_id      uuid references employees(id),
  basis            allocation_basis not null,
  amount           numeric(14,2) not null check (amount >= 0),
  created_at       timestamptz not null default now(),
  created_by       uuid default auth.uid(),
  archived_at      timestamptz,
  archived_by      uuid,
  check (company_id is not null or employee_id is not null)
);

-- Dağıtılan toplam, ilgili dönem/kategori havuzunu aşamaz.
-- Havuz = yalnızca 'ortak' işaretli giderler (doğrudan giderler asla dağıtılmaz -> çift sayım yok).
create or replace function app.check_allocation_pool() returns trigger
language plpgsql security definer set search_path = public as $$
declare pool numeric; allocated numeric;
begin
  select coalesce(sum(amount_excl_vat),0) into pool
  from expenses
  where organization_id = new.organization_id and category_id = new.category_id
    and cost_type = 'ortak' and archived_at is null
    and date_trunc('month', expense_date)::date = new.period;

  select coalesce(sum(amount),0) into allocated
  from overhead_allocations
  where organization_id = new.organization_id and category_id = new.category_id
    and period = new.period and archived_at is null and id <> new.id;

  if allocated + new.amount > pool + 0.005 then
    raise exception 'Dağıtılan toplam (%) ilgili ortak gider havuzunu (%) aşıyor.', allocated + new.amount, pool;
  end if;
  return new;
end $$;
create trigger trg_allocation_pool before insert or update on overhead_allocations
  for each row when (new.archived_at is null) execute function app.check_allocation_pool();

-- ---------------------------------------------------------------------
-- 11. Belgeler, bildirimler, giden mesajlar
-- ---------------------------------------------------------------------
create table attachments (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null default app.org_id() references organizations(id),
  company_id       uuid references companies(id),
  contract_id      uuid references contracts(id),
  offer_id         uuid references offers(id),
  file_name        text not null,
  storage_path     text not null,              -- Supabase Storage (özel kova)
  mime_type        text,
  size_bytes       bigint,
  uploaded_by      uuid default auth.uid(),
  created_at       timestamptz not null default now(),
  archived_at      timestamptz,
  archived_by      uuid
);

create table notifications (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null default app.org_id() references organizations(id),
  user_id          uuid references users(id),  -- boşsa yöneticilere
  kind             text not null,              -- sozlesme_bitisi, tahsilat_gecikti, kapasite_asimi ...
  title            text not null,
  body             text,
  ref_table        text, ref_id uuid,
  dedupe_key       text,                       -- aynı uyarı tekrar tekrar üretilmesin
  read_at          timestamptz,
  created_at       timestamptz not null default now()
);
create unique index notifications_dedupe_uq on notifications(organization_id, dedupe_key) where dedupe_key is not null;

-- Gerçek gönderim yapılmadan 'gonderildi' yazılamaz; deneme/hata/yeniden deneme kayıtlıdır
create table outbound_messages (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null default app.org_id() references organizations(id),
  channel          message_channel not null,
  to_address       text not null,
  subject          text,
  body             text not null,
  company_id       uuid references companies(id),
  status           message_status not null default 'beklemede',
  attempts         integer not null default 0,
  last_error       text,
  last_attempt_at  timestamptz,
  sent_at          timestamptz,
  approved_by      uuid references users(id),  -- müşteriye giden her mesaj kullanıcı onayı ister
  approved_at      timestamptz,
  created_by       uuid default auth.uid(),
  created_at       timestamptz not null default now(),
  check (status <> 'gonderildi' or sent_at is not null)
);

-- ---------------------------------------------------------------------
-- 12. Tetikleyiciler: updated_at, arşiv koruması, denetim
-- ---------------------------------------------------------------------
do $$
declare
  r record;
  -- tablo -> yetki modülü
  m jsonb := '{
    "settings":"settings","service_time_rules":"settings","expense_categories":"settings","allocation_rules":"settings",
    "companies":"companies","company_profiles":"companies","contacts":"contacts","leads":"crm",
    "sales_opportunities":"opportunities","opportunity_stage_history":"opportunities","activities":"contacts",
    "tasks":"tasks","employees":"staff","employee_costs":"payroll","assignments":"assignments","time_entries":"time",
    "offers":"offers","offer_items":"offers","contracts":"contracts","contract_prices":"contracts",
    "invoices":"invoices","invoice_items":"invoices","payments":"invoices",
    "expenses":"expenses","overhead_allocations":"company_profit",
    "attachments":"companies","notifications":"tasks","outbound_messages":"crm"
  }';
  t text; tbl text;
begin
  for tbl, t in select key, value #>> '{}' from jsonb_each(m) loop
    execute format('alter table %I enable row level security', tbl);
    execute format('revoke delete on %I from anon, authenticated', tbl);   -- fiziksel silme yok

    -- Okuma / ekleme / güncelleme politikaları (kurum + modül yetkisi)
    execute format($f$create policy %1$s_sel on %1$I for select to authenticated
                      using (organization_id = app.org_id() and app.can(%2$L,'view'))$f$, tbl, t);
    execute format($f$create policy %1$s_ins on %1$I for insert to authenticated
                      with check (organization_id = app.org_id() and app.can(%2$L,'create'))$f$, tbl, t);
    execute format($f$create policy %1$s_upd on %1$I for update to authenticated
                      using (organization_id = app.org_id() and app.can(%2$L,'edit'))
                      with check (organization_id = app.org_id())$f$, tbl, t);

    -- updated_at
    if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = tbl and column_name = 'updated_at') then
      execute format('create trigger trg_%1$s_touch before update on %1$I for each row execute function app.touch_updated_at()', tbl);
    end if;
    -- arşiv koruması
    if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = tbl and column_name = 'archived_at') then
      execute format('create trigger trg_%1$s_arch before update on %1$I for each row execute function app.guard_archive(%2$L)', tbl, t);
    end if;
    -- denetim geçmişi
    execute format('create trigger trg_%1$s_audit after insert or update on %1$I for each row execute function app.audit()', tbl);
  end loop;
end $$;

-- Maaş kategorisi kontrolü RLS'e takılmasın diye SECURITY DEFINER fonksiyonla yapılır
create or replace function app.is_payroll_category(p_category uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select is_payroll from public.expense_categories where id = p_category), false)
$$;

-- Maaş ve personel maliyeti içeren giderler yalnızca 'payroll' yetkisiyle görünür
drop policy expenses_sel on expenses;
create policy expenses_sel on expenses for select to authenticated
  using (organization_id = app.org_id() and app.can('expenses','view')
         and (app.can('payroll','view') or not app.is_payroll_category(category_id)));

-- Referans tabloları: kurumdaki her aktif kullanıcı OKUYABİLİR (açılır listeler, hesaplamalar için);
-- değiştirmek 'settings' yetkisi ister (ekleme/güncelleme politikaları yukarıda).
do $$
declare tbl text;
begin
  foreach tbl in array array['expense_categories','service_time_rules','settings','allocation_rules'] loop
    execute format('drop policy %1$s_sel on %1$I', tbl);
    execute format('create policy %1$s_sel on %1$I for select to authenticated using (organization_id = app.org_id())', tbl);
  end loop;
end $$;

-- app şemasındaki yardımcı fonksiyonlar tetikleyicilerde çalışabilsin
grant usage on schema app to authenticated;

-- Kurum, rol, kullanıcı tabloları
alter table organizations    enable row level security;
alter table roles            enable row level security;
alter table role_permissions enable row level security;
alter table users            enable row level security;
alter table audit_logs       enable row level security;

create policy org_sel   on organizations for select to authenticated using (id = app.org_id());
create policy roles_sel on roles for select to authenticated using (organization_id = app.org_id());
create policy roles_mod on roles for all    to authenticated
  using (organization_id = app.org_id() and app.can('users','edit'))
  with check (organization_id = app.org_id() and app.can('users','edit'));
create policy rp_sel on role_permissions for select to authenticated
  using (exists (select 1 from roles r where r.id = role_id and r.organization_id = app.org_id()));
create policy rp_mod on role_permissions for all to authenticated
  using (app.can('users','edit') and exists (select 1 from roles r where r.id = role_id and r.organization_id = app.org_id()))
  with check (app.can('users','edit') and exists (select 1 from roles r where r.id = role_id and r.organization_id = app.org_id()));
create policy users_sel on users for select to authenticated
  using (organization_id = app.org_id() and (id = auth.uid() or app.can('users','view')));
create policy users_mod on users for update to authenticated
  using (organization_id = app.org_id() and app.can('users','edit'))
  with check (organization_id = app.org_id());
create policy audit_sel on audit_logs for select to authenticated
  using (organization_id = app.org_id() and app.can('users','view'));

revoke delete on organizations, roles, role_permissions, users, audit_logs from anon, authenticated;
revoke update, delete on audit_logs from anon, authenticated;   -- denetim kaydı değiştirilemez

-- Aynı tabloların anon (girişsiz) erişimini tamamen kapat
revoke all on all tables in schema public from anon;

-- ---------------------------------------------------------------------
-- 13. Yeni işletme için varsayılan veriler (roller, yetkiler, parametreler)
--     Kullanım: select app.seed_organization('<kurum-id>');
-- ---------------------------------------------------------------------
create or replace function app.seed_organization(p_org uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_names jsonb := '{"sistem_yoneticisi":"Sistem yöneticisi","isletme_sahibi":"İşletme sahibi",
    "satis":"Satış sorumlusu","operasyon":"Operasyon sorumlusu","finans":"Finans sorumlusu","uzman_hekim":"Uzman / hekim"}';
  v_modules text[] := array['dashboard','crm','companies','contacts','opportunities','offers','contracts','staff',
    'assignments','time','invoices','expenses','payroll','staff_profit','company_profit','capacity','reports',
    'tasks','import_export','users','settings'];
  v_role uuid; k text; mod text; v jsonb;
  -- v,c,e,a = görüntüle, oluştur, düzenle, arşivle
  matrix jsonb := '{
   "sistem_yoneticisi":{"*":"vcea"},
   "isletme_sahibi":{"*":"vcea"},
   "satis":{"dashboard":"v","crm":"vcea","companies":"vce","contacts":"vcea","opportunities":"vcea","offers":"vcea",
            "contracts":"v","tasks":"vcea","reports":"v","capacity":"v","import_export":"v"},
   "operasyon":{"dashboard":"v","companies":"vce","contacts":"vce","contracts":"v","staff":"vce","assignments":"vcea",
                "time":"vcea","capacity":"v","tasks":"vcea","reports":"v","import_export":"v"},
   "finans":{"dashboard":"v","companies":"v","contracts":"v","invoices":"vcea","expenses":"vcea","payroll":"vce",
             "staff_profit":"v","company_profit":"vce","reports":"v","tasks":"vce","import_export":"vc","staff":"v"},
   "uzman_hekim":{"time":"vce","tasks":"vce","companies":"v","assignments":"v"}
  }';
begin
  foreach k in array array['sistem_yoneticisi','isletme_sahibi','satis','operasyon','finans','uzman_hekim'] loop
    insert into roles(organization_id, key, name)
      values (p_org, k, v_names ->> k)
      on conflict (organization_id, key) do nothing;
    select id into v_role from roles where organization_id = p_org and key = k;
    v := matrix -> k;
    foreach mod in array v_modules loop
      insert into role_permissions(role_id, module, can_view, can_create, can_edit, can_archive)
      select v_role, mod,
             coalesce(v ->> mod, v ->> '*', '') like '%v%',
             coalesce(v ->> mod, v ->> '*', '') like '%c%',
             coalesce(v ->> mod, v ->> '*', '') like '%e%',
             coalesce(v ->> mod, v ->> '*', '') like '%a%'
      on conflict do nothing;
    end loop;
  end loop;

  -- Teorik hizmet süresi parametreleri (kullanıcının mevcut parametreleri; mevzuat ayrıca doğrulanmalıdır)
  insert into service_time_rules(organization_id, staff_type, hazard_class, minutes_per_employee, valid_from, note) values
    (p_org,'is_guvenligi_uzmani','az_tehlikeli', 10,'2000-01-01','Kullanıcı parametresi'),
    (p_org,'is_guvenligi_uzmani','tehlikeli',    20,'2000-01-01','Kullanıcı parametresi'),
    (p_org,'is_guvenligi_uzmani','cok_tehlikeli',40,'2000-01-01','Kullanıcı parametresi'),
    (p_org,'isyeri_hekimi','az_tehlikeli',        5,'2000-01-01','Kullanıcı parametresi'),
    (p_org,'isyeri_hekimi','tehlikeli',          10,'2000-01-01','Kullanıcı parametresi'),
    (p_org,'isyeri_hekimi','cok_tehlikeli',      15,'2000-01-01','Kullanıcı parametresi')
  on conflict do nothing;

  insert into settings(organization_id, key, value, valid_from) values
    (p_org,'kapasite_dakika',        '11700'::jsonb,                '2000-01-01'),
    (p_org,'kurumlar_vergisi_orani', '25'::jsonb,                   '2000-01-01'),
    (p_org,'marj_esigi_yuzde',       '20'::jsonb,                   '2000-01-01'),
    (p_org,'yenileme_uyari_gunleri', '[90,60,30]'::jsonb,           '2000-01-01'),
    (p_org,'varsayilan_kdv_orani',   '20'::jsonb,                   '2000-01-01')
  on conflict do nothing;

  insert into expense_categories(organization_id, name, nature, default_cost_type, is_payroll, is_income_tax, sort_order) values
    (p_org,'Uzman maaşları','personel','dogrudan',true,false,1),
    (p_org,'Hekim maaşları','personel','dogrudan',true,false,2),
    (p_org,'İşveren SGK maliyetleri','sgk','dogrudan',true,false,3),
    (p_org,'Diğer personel maliyetleri','personel','dogrudan',true,false,4),
    (p_org,'Araç yakıtı','isletme','ortak',false,false,5),
    (p_org,'Araç bakım ve onarım','isletme','ortak',false,false,6),
    (p_org,'Araç sigortası','isletme','ortak',false,false,7),
    (p_org,'Kira','isletme','ortak',false,false,8),
    (p_org,'Elektrik, su, internet ve telefon','isletme','ortak',false,false,9),
    (p_org,'Muhasebe','isletme','ortak',false,false,10),
    (p_org,'Reklam ve pazarlama','isletme','ortak',false,false,11),
    (p_org,'Yazılım ve teknoloji','isletme','ortak',false,false,12),
    (p_org,'Ofis giderleri','isletme','ortak',false,false,13),
    (p_org,'Banka ve finansman giderleri','isletme','ortak',false,false,14),
    (p_org,'Stopaj','stopaj','ortak',false,false,15),
    (p_org,'Kurumlar vergisi','vergi','ortak',false,true,16),
    (p_org,'Diğer giderler','isletme','ortak',false,false,17)
  on conflict do nothing;
end $$;

revoke execute on function app.seed_organization(uuid) from public, anon, authenticated;
