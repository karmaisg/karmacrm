-- ============================================================================
-- Aşama 32 — İmzalı sözleşmeler (PDF / resim yükleme)
-- Firma → Sözleşmeler sekmesinden imzalı sözleşme dosyaları yüklenir ve saklanır.
-- Dosyalar özel (herkese açık olmayan) "imzali-sozlesmeler" kovasında tutulur;
-- yetki "contracts" (sözleşmeler) modülündendir. Tekrar çalıştırılabilir.
-- ============================================================================

create table if not exists signed_contracts (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null default app.org_id() references organizations(id),
  company_id      uuid not null references companies(id) on delete cascade,
  contract_id     uuid references contracts(id) on delete cascade,
  title           text check (title is null or char_length(btrim(title)) between 1 and 200),
  signed_date     date,
  description     text check (description is null or char_length(description) <= 2000),
  storage_path    text not null,
  file_name       text not null,
  mime_type       text not null check (mime_type in ('application/pdf', 'image/jpeg', 'image/png', 'image/webp')),
  size_bytes      bigint not null check (size_bytes > 0 and size_bytes <= 10485760),
  uploaded_by     uuid default auth.uid(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  archived_at     timestamptz,
  archived_by     uuid,
  unique (storage_path)
);
create index if not exists signed_contracts_idx on signed_contracts (organization_id, company_id) where archived_at is null;

create or replace function app.imzali_sozlesme_kontrol() returns trigger language plpgsql as $$
begin
  if new.storage_path not like new.organization_id::text || '/%' then raise exception 'Dosya yolu kuruma ait değil.'; end if;
  if new.contract_id is not null and not exists (select 1 from contracts c where c.id = new.contract_id and c.company_id = new.company_id) then
    raise exception 'Sözleşme bu firmaya ait değil.';
  end if;
  return new;
end $$;

alter table signed_contracts enable row level security;
drop policy if exists signed_contracts_sel on signed_contracts;
create policy signed_contracts_sel on signed_contracts for select to authenticated
  using (organization_id = app.org_id() and app.can('contracts', 'view'));
drop policy if exists signed_contracts_ins on signed_contracts;
create policy signed_contracts_ins on signed_contracts for insert to authenticated
  with check (organization_id = app.org_id() and app.can('contracts', 'create'));
drop policy if exists signed_contracts_upd on signed_contracts;
create policy signed_contracts_upd on signed_contracts for update to authenticated
  using (organization_id = app.org_id() and (app.can('contracts', 'edit') or app.can('contracts', 'archive')))
  with check (organization_id = app.org_id());
revoke all on signed_contracts from anon, authenticated;
grant select, insert, update on signed_contracts to authenticated;

drop trigger if exists trg_signed_contracts_touch on signed_contracts;
create trigger trg_signed_contracts_touch before update on signed_contracts for each row execute function app.touch_updated_at();
drop trigger if exists trg_signed_contracts_arch on signed_contracts;
create trigger trg_signed_contracts_arch before update on signed_contracts for each row execute function app.guard_archive('contracts');
drop trigger if exists trg_signed_contracts_audit on signed_contracts;
create trigger trg_signed_contracts_audit after insert or update on signed_contracts for each row execute function app.audit();
drop trigger if exists trg_signed_contracts_org on signed_contracts;
create trigger trg_signed_contracts_org before insert or update on signed_contracts for each row execute function app.check_same_org('companies:company_id', 'contracts:contract_id');
drop trigger if exists trg_signed_contracts_chk on signed_contracts;
create trigger trg_signed_contracts_chk before insert or update on signed_contracts for each row execute function app.imzali_sozlesme_kontrol();

-- denetim kaydı bu tabloyu "contracts" modülüne bağlar
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
    'signed_contracts','contracts') ->> p_table), 'users');
$$;

-- Özel dosya kovası: yalnızca "<kurum-id>/..." klasörü, sözleşme yetkisi olanlarca okunur / yazılır
do $$
begin
  if to_regclass('storage.buckets') is not null and to_regclass('storage.objects') is not null then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('imzali-sozlesmeler', 'imzali-sozlesmeler', false, 10485760, array['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])
    on conflict (id) do update set public = false, file_size_limit = 10485760,
      allowed_mime_types = array['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];

    drop policy if exists imzali_sozlesme_sel on storage.objects;
    create policy imzali_sozlesme_sel on storage.objects for select to authenticated
      using (bucket_id = 'imzali-sozlesmeler' and (storage.foldername(name))[1] = app.org_id()::text and app.can('contracts', 'view'));
    drop policy if exists imzali_sozlesme_ins on storage.objects;
    create policy imzali_sozlesme_ins on storage.objects for insert to authenticated
      with check (bucket_id = 'imzali-sozlesmeler' and (storage.foldername(name))[1] = app.org_id()::text and app.can('contracts', 'create'));
    drop policy if exists imzali_sozlesme_del on storage.objects;
    create policy imzali_sozlesme_del on storage.objects for delete to authenticated
      using (bucket_id = 'imzali-sozlesmeler' and (storage.foldername(name))[1] = app.org_id()::text and app.can('contracts', 'create'));
  end if;
end $$;
