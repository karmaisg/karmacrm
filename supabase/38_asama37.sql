-- ============================================================================
-- Aşama 37 — İdari İşler > Maaş hesaplayıcı
-- Personel adı soyadı, net maaş (değiştirilene kadar kayıtlı kalır) ve bordrodaki banka tutarı; "Diğer" = net maaş − banka.
-- Maaş bilgisi hassas olduğundan yetki "payroll" (maaş) modülündendir. Tekrar çalıştırılabilir.
-- ============================================================================

create table if not exists salary_calcs (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null default app.org_id() references organizations(id),
  full_name       text not null check (char_length(btrim(full_name)) between 1 and 200),
  net_salary      numeric(14,2) not null check (net_salary >= 0),
  bank_amount     numeric(14,2) check (bank_amount is null or bank_amount >= 0),   -- bordroda yazan banka tutarı
  created_by      uuid default auth.uid(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  archived_at     timestamptz,
  archived_by     uuid,
  check (bank_amount is null or bank_amount <= net_salary)
);
create index if not exists salary_calcs_idx on salary_calcs (organization_id) where archived_at is null;

alter table salary_calcs enable row level security;
drop policy if exists salary_calcs_sel on salary_calcs;
create policy salary_calcs_sel on salary_calcs for select to authenticated
  using (organization_id = app.org_id() and app.can('payroll', 'view'));
drop policy if exists salary_calcs_ins on salary_calcs;
create policy salary_calcs_ins on salary_calcs for insert to authenticated
  with check (organization_id = app.org_id() and app.can('payroll', 'create'));
drop policy if exists salary_calcs_upd on salary_calcs;
create policy salary_calcs_upd on salary_calcs for update to authenticated
  using (organization_id = app.org_id() and (app.can('payroll', 'edit') or app.can('payroll', 'archive')))
  with check (organization_id = app.org_id());
revoke all on salary_calcs from anon, authenticated;
grant select, insert, update on salary_calcs to authenticated;

drop trigger if exists trg_salary_calcs_touch on salary_calcs;
create trigger trg_salary_calcs_touch before update on salary_calcs for each row execute function app.touch_updated_at();
drop trigger if exists trg_salary_calcs_arch on salary_calcs;
create trigger trg_salary_calcs_arch before update on salary_calcs for each row execute function app.guard_archive('payroll');
drop trigger if exists trg_salary_calcs_audit on salary_calcs;
create trigger trg_salary_calcs_audit after insert or update on salary_calcs for each row execute function app.audit();

-- denetim kaydı bu tabloyu "payroll" modülüne bağlar
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
    'signed_contracts','contracts','budget_lines','budget','budget_expense_lines','budget','budget_personnel_lines','budget','salary_calcs','payroll') ->> p_table), 'users');
$$;
