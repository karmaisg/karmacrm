-- ============================================================================
-- Aşama 41 — Operasyon > Ziyaret Planlama
-- Firmalara harita konumu (enlem/boylam), aylık uzman/hekim ziyaret planı ve Google Haritalar anahtarı ayarı.
-- Ziyaretin "yapıldı" durumu mevcut "Zaman ve ziyaret takibi" kayıtlarından (activity_type = 'ziyaret') hesaplanır.
-- Tekrar çalıştırılabilir.
-- ============================================================================

-- 1) Firma konumu
alter table companies add column if not exists latitude  numeric(9,6);
alter table companies add column if not exists longitude numeric(9,6);
alter table companies add column if not exists geo_query text;          -- konum bulunurken kullanılan adres metni (adres değişirse eski konumu fark etmek için)
alter table companies add column if not exists geo_source text;         -- 'google' (otomatik bulundu) | 'manuel' (haritada elle işaretlendi)
alter table companies add column if not exists geo_at timestamptz;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'companies_geo_ck') then
    alter table companies add constraint companies_geo_ck check (
      ((latitude is null) = (longitude is null))
      and (latitude is null or (latitude between -90 and 90 and longitude between -180 and 180))
      and (geo_source is null or geo_source in ('google', 'manuel')));
  end if;
end $$;

-- Konumu yalnızca bu fonksiyonla yazılır (ziyaret planlayan rol firma düzenleme yetkisi olmasa da konum kaydedebilir)
create or replace function public.firma_konum_kaydet(p_company uuid, p_lat numeric, p_lng numeric, p_sorgu text, p_kaynak text)
returns companies language plpgsql security definer set search_path = public as $$
declare c companies;
begin
  if auth.uid() is null or not ((app.can('time', 'create') and not app.is_field_staff()) or app.can('companies', 'edit')) then
    raise exception 'Firma konumunu kaydetme yetkiniz yok.';
  end if;
  if p_lat is null or p_lng is null then
    update companies set latitude = null, longitude = null, geo_query = null, geo_source = null, geo_at = null
     where id = p_company and organization_id = app.org_id() and archived_at is null returning * into c;
  else
    if p_lat not between -90 and 90 or p_lng not between -180 and 180 then raise exception 'Konum geçerli değil.'; end if;
    if p_kaynak not in ('google', 'manuel') then raise exception 'Konum kaynağı geçerli değil.'; end if;
    update companies set latitude = round(p_lat, 6), longitude = round(p_lng, 6), geo_query = left(p_sorgu, 500), geo_source = p_kaynak, geo_at = now()
     where id = p_company and organization_id = app.org_id() and archived_at is null returning * into c;
  end if;
  if c.id is null then raise exception 'Firma bulunamadı.'; end if;
  return c;
end $$;
revoke all on function public.firma_konum_kaydet(uuid, numeric, numeric, text, text) from public, anon;
grant execute on function public.firma_konum_kaydet(uuid, numeric, numeric, text, text) to authenticated;

-- 2) Entegrasyon ayarı (Google Haritalar anahtarı). Anahtar yalnızca sizin sitenizden çalışacak şekilde Google'da kısıtlanmalıdır.
create table if not exists integration_settings (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null default app.org_id() references organizations(id),
  key             text not null check (key in ('google_maps_api_key')),
  value           text not null check (value ~ '^[A-Za-z0-9_-]{20,120}$'),
  updated_by      uuid default auth.uid(),
  updated_at      timestamptz not null default now(),
  unique (organization_id, key)
);
alter table integration_settings enable row level security;
drop policy if exists integration_settings_sel on integration_settings;
create policy integration_settings_sel on integration_settings for select to authenticated
  using (organization_id = app.org_id() and (app.can('time', 'view') or app.can('settings', 'view')));
revoke all on integration_settings from anon, authenticated;
grant select on integration_settings to authenticated;
drop trigger if exists trg_integration_settings_audit on integration_settings;

create or replace function public.entegrasyon_kaydet(p_anahtar text, p_deger text)
returns boolean language plpgsql security definer set search_path = public as $$
declare v text := btrim(coalesce(p_deger, ''));
begin
  if auth.uid() is null or not (app.can('settings', 'create') and app.can('settings', 'edit')) then
    raise exception 'Sistem ayarlarını değiştirme yetkiniz yok.';
  end if;
  if p_anahtar <> 'google_maps_api_key' then raise exception 'Bu ayar buradan değiştirilemez.'; end if;
  if v = '' then
    delete from integration_settings where organization_id = app.org_id() and key = p_anahtar;
    insert into audit_logs(organization_id, table_name, record_id, action, old_data, new_data, user_id)
    values (app.org_id(), 'integration_settings', p_anahtar, 'DELETE', jsonb_build_object('key', p_anahtar), null, auth.uid());
    return false;
  end if;
  if v !~ '^[A-Za-z0-9_-]{20,120}$' then raise exception 'Anahtar biçimi geçerli değil. Google Cloud''dan kopyaladığınız anahtarı boşluksuz yapıştırın.'; end if;
  insert into integration_settings(organization_id, key, value) values (app.org_id(), p_anahtar, v)
  on conflict (organization_id, key) do update set value = excluded.value, updated_by = auth.uid(), updated_at = now();
  -- denetim kaydına anahtarın kendisi yazılmaz
  insert into audit_logs(organization_id, table_name, record_id, action, old_data, new_data, user_id)
  values (app.org_id(), 'integration_settings', p_anahtar, 'UPDATE', null, jsonb_build_object('key', p_anahtar, 'degisti', true), auth.uid());
  return true;
end $$;
revoke all on function public.entegrasyon_kaydet(text, text) from public, anon;
grant execute on function public.entegrasyon_kaydet(text, text) to authenticated;

-- 3) Ziyaret planı
create table if not exists visit_plans (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null default app.org_id() references organizations(id),
  company_id      uuid not null references companies(id),
  staff_type      staff_type not null,
  employee_id     uuid references employees(id),
  planned_date    date not null,
  note            text check (note is null or char_length(note) <= 500),
  created_by      uuid default auth.uid(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  archived_at     timestamptz,
  archived_by     uuid
);
create unique index if not exists visit_plans_aktif_uq on visit_plans (company_id, staff_type, planned_date) where archived_at is null;
create index if not exists visit_plans_tarih_idx on visit_plans (organization_id, planned_date) where archived_at is null;

create or replace function app.visit_plan_before_write() returns trigger language plpgsql as $$
begin
  if not exists (select 1 from companies c where c.id = new.company_id and c.organization_id = new.organization_id) then
    raise exception 'Firma bulunamadı.';
  end if;
  if new.employee_id is not null and not exists (
       select 1 from employees e where e.id = new.employee_id and e.organization_id = new.organization_id and e.staff_type = new.staff_type) then
    raise exception 'Seçilen personel bu ziyaret türüne (uzman/hekim) uygun değil.';
  end if;
  return new;
end $$;
drop trigger if exists trg_visit_plans_write on visit_plans;
create trigger trg_visit_plans_write before insert or update on visit_plans for each row execute function app.visit_plan_before_write();
drop trigger if exists trg_visit_plans_touch on visit_plans;
create trigger trg_visit_plans_touch before update on visit_plans for each row execute function app.touch_updated_at();
drop trigger if exists trg_visit_plans_arch on visit_plans;
create trigger trg_visit_plans_arch before update on visit_plans for each row execute function app.guard_archive('time');
drop trigger if exists trg_visit_plans_audit on visit_plans;
create trigger trg_visit_plans_audit after insert or update on visit_plans for each row execute function app.audit();

alter table visit_plans enable row level security;
drop policy if exists visit_plans_sel on visit_plans;
create policy visit_plans_sel on visit_plans for select to authenticated
  using (organization_id = app.org_id() and app.can('time', 'view')
         and (not app.is_field_staff() or employee_id = app.my_employee_id()));
drop policy if exists visit_plans_ins on visit_plans;
create policy visit_plans_ins on visit_plans for insert to authenticated
  with check (organization_id = app.org_id() and app.can('time', 'create') and not app.is_field_staff());
drop policy if exists visit_plans_upd on visit_plans;
create policy visit_plans_upd on visit_plans for update to authenticated
  using (organization_id = app.org_id() and (app.can('time', 'edit') or app.can('time', 'archive')) and not app.is_field_staff())
  with check (organization_id = app.org_id());
revoke all on visit_plans from anon, authenticated;
grant select, insert, update on visit_plans to authenticated;

-- 4) Denetim ekranı: yeni tablolar "Zaman" ve "Ayarlar" modüllerinde görünür
create or replace function app.audit_modul(p_table text) returns text
language sql immutable as $$
  select coalesce((jsonb_build_object(
    'settings','settings','service_time_rules','settings','expense_categories','settings','allocation_rules','settings',
    'companies','companies','company_profiles','companies','contacts','contacts','leads','crm',
    'sales_opportunities','opportunities','opportunity_stage_history','opportunities','activities','contacts',
    'tasks','tasks','employees','staff','employee_costs','payroll','assignments','assignments','time_entries','time',
    'offers','offers','offer_items','offers','offer_shares','offers','contracts','contracts','contract_prices','contracts',
    'invoices','invoices','invoice_items','invoices','payments','invoices',
    'expenses','expenses','overhead_allocations','company_profit',
    'attachments','companies','notifications','tasks','outbound_messages','crm','calendar_items','tasks',
    'employee_leaves','admin_affairs','vehicles','admin_affairs','vehicle_records','admin_affairs','admin_documents','admin_affairs',
    'signed_contracts','contracts','budget_lines','budget','budget_expense_lines','budget','budget_personnel_lines','budget','salary_calcs','payroll','offer_pdfs','offers','visit_plans','time','integration_settings','settings') ->> p_table), 'users');
$$;
