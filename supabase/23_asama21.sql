-- OSGB 360 - Aşama 21: takvimde yıllık tekrar + İdari İşler (özlük belgeleri, personel izinleri, şirket araçları, şirket belgeleri)
-- Güvenle yeniden çalıştırılabilir. Önce 22_asama20.sql çalışmış olmalıdır.

-- ===================================================================== 1) Takvim: yıllık tekrar
alter table calendar_items drop constraint if exists calendar_items_recurrence_check;
alter table calendar_items add constraint calendar_items_recurrence_check check (recurrence in ('yok', 'aylik', 'yillik'));

create or replace function app.takvim_olaylari(p_org uuid, p_bas date, p_bit date)
returns table (tarih date, kaynak text, ref uuid, baslik text, firma text, tutar numeric, tamam boolean, tekrar boolean, tur text, oncelik text)
language sql stable security definer set search_path = public as $$
  with aylar as (
    select (date_trunc('month', p_bas) + (n || ' month')::interval)::date as ay
      from generate_series(0, ((extract(year from p_bit) - extract(year from p_bas)) * 12 + extract(month from p_bit) - extract(month from p_bas))::int) n
  ), yillar as (
    select y::int as yil from generate_series(extract(year from p_bas)::int, extract(year from p_bit)::int) y
  ), ogeler as (
    select i.*, case when i.recurrence = 'yok' then i.start_date
                     when i.recurrence = 'aylik' then least((a.ay + (extract(day from i.start_date)::int - 1)), (a.ay + interval '1 month - 1 day')::date)
                     else least(make_date(y.yil, extract(month from i.start_date)::int, 1) + (extract(day from i.start_date)::int - 1),
                                (make_date(y.yil, extract(month from i.start_date)::int, 1) + interval '1 month - 1 day')::date) end as gun
      from calendar_items i
      left join aylar a on i.recurrence = 'aylik'
      left join yillar y on i.recurrence = 'yillik'
     where i.organization_id = p_org and i.archived_at is null
       and (i.recurrence = 'yok' or (i.recurrence = 'aylik' and a.ay is not null) or (i.recurrence = 'yillik' and y.yil is not null))
  )
  select o.gun, 'takvim'::text, o.id, o.title, c.name, o.amount,
         exists (select 1 from calendar_completions k where k.item_id = o.id and k.occurrence_date = o.gun),
         o.recurrence in ('aylik', 'yillik'), o.kind, null::text
    from ogeler o left join companies c on c.id = o.company_id
   where o.gun between p_bas and p_bit and o.gun >= o.start_date and (o.end_date is null or o.gun <= o.end_date)
  union all
  select (t.due_at at time zone 'Europe/Istanbul')::date, 'gorev_son', t.id, t.title, c.name, null::numeric, false, false, 'gorev', t.priority::text
    from tasks t left join companies c on c.id = t.company_id
   where t.organization_id = p_org and t.archived_at is null and t.status in ('acik', 'devam_ediyor') and t.due_at is not null
     and (t.due_at at time zone 'Europe/Istanbul')::date between p_bas and p_bit
  union all
  select (t.remind_at at time zone 'Europe/Istanbul')::date, 'gorev_hatirlatma', t.id, t.title, c.name, null::numeric, false, false, 'gorev', t.priority::text
    from tasks t left join companies c on c.id = t.company_id
   where t.organization_id = p_org and t.archived_at is null and t.status in ('acik', 'devam_ediyor') and t.remind_at is not null
     and (t.remind_at at time zone 'Europe/Istanbul')::date between p_bas and p_bit
$$;
revoke all on function app.takvim_olaylari(uuid, date, date) from public, anon, authenticated;

-- ===================================================================== 2) İdari İşler: yetki modülü
-- Yeni modül: admin_affairs. Varsayılan olarak yalnızca sistem yöneticisi ve işletme sahibi (özlük belgeleri hassastır);
-- diğer roller için Kullanıcılar ve yetkiler ekranından açılabilir.
insert into role_permissions(role_id, module, can_view, can_create, can_edit, can_archive)
select r.id, 'admin_affairs', r.key in ('sistem_yoneticisi', 'isletme_sahibi'), r.key in ('sistem_yoneticisi', 'isletme_sahibi'),
       r.key in ('sistem_yoneticisi', 'isletme_sahibi'), r.key in ('sistem_yoneticisi', 'isletme_sahibi')
  from roles r
on conflict (role_id, module) do nothing;

create or replace function app.roles_idari_yetki() returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into role_permissions(role_id, module, can_view, can_create, can_edit, can_archive)
  values (new.id, 'admin_affairs', new.key in ('sistem_yoneticisi', 'isletme_sahibi'), new.key in ('sistem_yoneticisi', 'isletme_sahibi'),
          new.key in ('sistem_yoneticisi', 'isletme_sahibi'), new.key in ('sistem_yoneticisi', 'isletme_sahibi'))
  on conflict do nothing;
  return new;
end $$;
drop trigger if exists trg_roles_idari_yetki on roles;
create trigger trg_roles_idari_yetki after insert on roles for each row execute function app.roles_idari_yetki();

-- ===================================================================== 3) Personel: doğum tarihi (izin hakkı için yaş kuralı)
alter table employees add column if not exists birth_date date check (birth_date is null or birth_date between date '1900-01-01' and current_date);

-- ===================================================================== 4) Personel izinleri
create table if not exists employee_leaves (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null default app.org_id() references organizations(id),
  employee_id     uuid not null references employees(id),
  start_date      date not null,
  end_date        date not null,
  days            numeric(5,1) not null check (days > 0 and days <= 366),   -- kullanılan iş günü
  note            text check (note is null or char_length(note) <= 1000),
  created_by      uuid default auth.uid(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  archived_at     timestamptz,
  archived_by     uuid,
  check (end_date >= start_date)
);
create index if not exists employee_leaves_emp_idx on employee_leaves (organization_id, employee_id, start_date) where archived_at is null;

-- ===================================================================== 5) Şirket araçları
create table if not exists vehicles (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null default app.org_id() references organizations(id),
  plate           text not null check (char_length(plate) between 3 and 15),
  brand           text not null check (char_length(btrim(brand)) between 1 and 80),
  model           text check (model is null or char_length(model) <= 80),
  model_year      integer check (model_year is null or model_year between 1950 and 2100),
  note            text check (note is null or char_length(note) <= 1000),
  created_by      uuid default auth.uid(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  archived_at     timestamptz,
  archived_by     uuid
);
create unique index if not exists vehicles_plate_uq on vehicles (organization_id, plate) where archived_at is null;

create table if not exists vehicle_records (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null default app.org_id() references organizations(id),
  vehicle_id      uuid not null references vehicles(id),
  kind            text not null check (kind in ('ruhsat', 'trafik_sigortasi', 'kasko', 'bakim', 'muayene', 'diger')),
  label           text check (label is null or char_length(btrim(label)) between 1 and 120),   -- "diğer" için zorunlu ad
  record_date     date,            -- başlangıç / yapıldığı tarih (bakım tarihi, poliçe başlangıcı)
  expiry_date     date,            -- bitiş / geçerlilik / sonraki bakım tarihi
  amount          numeric(14,2) check (amount is null or amount >= 0),
  value_text      text check (value_text is null or char_length(value_text) <= 300),    -- poliçe no, km, serbest ek bilgi
  note            text check (note is null or char_length(note) <= 1000),
  created_by      uuid default auth.uid(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  archived_at     timestamptz,
  archived_by     uuid,
  check (kind <> 'diger' or label is not null),
  check (expiry_date is null or record_date is null or expiry_date >= record_date)
);
create index if not exists vehicle_records_idx on vehicle_records (organization_id, vehicle_id) where archived_at is null;

-- ===================================================================== 6) Belgeler (özlük, araç, şirket) — dosyalar özel depolama kovasındadır
create table if not exists admin_documents (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null default app.org_id() references organizations(id),
  scope             text not null check (scope in ('personel', 'arac', 'sirket')),
  employee_id       uuid references employees(id),
  vehicle_id        uuid references vehicles(id),
  vehicle_record_id uuid references vehicle_records(id),
  doc_type          text not null default 'diger' check (doc_type in ('ise_giris_bildirgesi', 'kimlik', 'nufus_kayit', 'ikametgah', 'adli_sicil',
                      'diploma', 'sertifika', 'isg_egitimi', 'saglik_raporu', 'ruhsat', 'trafik_sigortasi', 'kasko', 'bakim', 'diger')),
  title             text check (title is null or char_length(btrim(title)) between 1 and 200),   -- "diğer" ve şirket belgeleri için ad
  doc_date          date,
  valid_until       date,
  description       text check (description is null or char_length(description) <= 2000),
  storage_path      text not null,
  file_name         text not null,
  mime_type         text not null check (mime_type in ('application/pdf', 'image/jpeg', 'image/png', 'image/webp')),
  size_bytes        bigint not null check (size_bytes > 0 and size_bytes <= 10485760),
  uploaded_by       uuid default auth.uid(),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  archived_at       timestamptz,
  archived_by       uuid,
  check ((scope = 'personel' and employee_id is not null and vehicle_id is null)
      or (scope = 'arac' and vehicle_id is not null and employee_id is null)
      or (scope = 'sirket' and employee_id is null and vehicle_id is null)),
  check (doc_type <> 'diger' or title is not null),
  check (scope <> 'sirket' or title is not null),
  check (valid_until is null or doc_date is null or valid_until >= doc_date),
  unique (storage_path)
);
create index if not exists admin_documents_idx on admin_documents (organization_id, scope, employee_id, vehicle_id) where archived_at is null;

create or replace function app.idari_kontrol() returns trigger language plpgsql as $$
begin
  if tg_table_name = 'vehicles' then
    new.plate := upper(regexp_replace(new.plate, '\s+', '', 'g'));
    if char_length(new.plate) < 3 then raise exception 'Plaka geçerli değil.'; end if;
  elsif tg_table_name = 'admin_documents' then
    if new.storage_path not like new.organization_id::text || '/%' then raise exception 'Dosya yolu kuruma ait değil.'; end if;
    if new.vehicle_record_id is not null and not exists (select 1 from vehicle_records r where r.id = new.vehicle_record_id and r.vehicle_id = new.vehicle_id) then
      raise exception 'Kayıt bu araca ait değil.';
    end if;
  end if;
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['employee_leaves', 'vehicles', 'vehicle_records', 'admin_documents'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists %1$s_sel on %1$I', t);
    execute format('create policy %1$s_sel on %1$I for select to authenticated using (organization_id = app.org_id() and app.can(''admin_affairs'', ''view''))', t);
    execute format('drop policy if exists %1$s_ins on %1$I', t);
    execute format('create policy %1$s_ins on %1$I for insert to authenticated with check (organization_id = app.org_id() and app.can(''admin_affairs'', ''create''))', t);
    execute format('drop policy if exists %1$s_upd on %1$I', t);
    execute format('create policy %1$s_upd on %1$I for update to authenticated using (organization_id = app.org_id() and (app.can(''admin_affairs'', ''edit'') or app.can(''admin_affairs'', ''archive''))) with check (organization_id = app.org_id())', t);
    execute format('revoke all on %I from anon, authenticated', t);
    execute format('grant select, insert, update on %I to authenticated', t);
    execute format('drop trigger if exists trg_%1$s_touch on %1$I', t);
    execute format('create trigger trg_%1$s_touch before update on %1$I for each row execute function app.touch_updated_at()', t);
    execute format('drop trigger if exists trg_%1$s_arch on %1$I', t);
    execute format('create trigger trg_%1$s_arch before update on %1$I for each row execute function app.guard_archive(''admin_affairs'')', t);
    execute format('drop trigger if exists trg_%1$s_audit on %1$I', t);
    execute format('create trigger trg_%1$s_audit after insert or update on %1$I for each row execute function app.audit()', t);
  end loop;
end $$;

drop trigger if exists trg_employee_leaves_org on employee_leaves;
create trigger trg_employee_leaves_org before insert or update on employee_leaves for each row execute function app.check_same_org('employees:employee_id');
drop trigger if exists trg_vehicle_records_org on vehicle_records;
create trigger trg_vehicle_records_org before insert or update on vehicle_records for each row execute function app.check_same_org('vehicles:vehicle_id');
drop trigger if exists trg_admin_documents_org on admin_documents;
create trigger trg_admin_documents_org before insert or update on admin_documents for each row execute function app.check_same_org('employees:employee_id', 'vehicles:vehicle_id');
drop trigger if exists trg_vehicles_chk on vehicles;
create trigger trg_vehicles_chk before insert or update on vehicles for each row execute function app.idari_kontrol();
drop trigger if exists trg_admin_documents_chk on admin_documents;
create trigger trg_admin_documents_chk before insert or update on admin_documents for each row execute function app.idari_kontrol();

-- denetim kaydı: bu tablolar "admin_affairs" modülüne bağlanır (yalnızca bu yetkiye sahipler denetim satırlarını görür)
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
    'employee_leaves','admin_affairs','vehicles','admin_affairs','vehicle_records','admin_affairs','admin_documents','admin_affairs') ->> p_table), 'users');
$$;

-- ===================================================================== 7) Özel dosya depolama kovası (Supabase Storage)
-- Dosyalar yalnızca "<kurum-id>/..." klasörü altında, admin_affairs yetkisi olanlarca okunur/yazılır. Kova herkese açık DEĞİLDİR.
do $$
begin
  if to_regclass('storage.buckets') is not null and to_regclass('storage.objects') is not null then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('idari-belgeler', 'idari-belgeler', false, 10485760, array['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])
    on conflict (id) do update set public = false, file_size_limit = 10485760,
      allowed_mime_types = array['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];

    drop policy if exists idari_belgeler_sel on storage.objects;
    create policy idari_belgeler_sel on storage.objects for select to authenticated
      using (bucket_id = 'idari-belgeler' and (storage.foldername(name))[1] = app.org_id()::text and app.can('admin_affairs', 'view'));
    drop policy if exists idari_belgeler_ins on storage.objects;
    create policy idari_belgeler_ins on storage.objects for insert to authenticated
      with check (bucket_id = 'idari-belgeler' and (storage.foldername(name))[1] = app.org_id()::text and app.can('admin_affairs', 'create'));
    drop policy if exists idari_belgeler_del on storage.objects;
    create policy idari_belgeler_del on storage.objects for delete to authenticated
      using (bucket_id = 'idari-belgeler' and (storage.foldername(name))[1] = app.org_id()::text and app.can('admin_affairs', 'create'));
  end if;
end $$;
