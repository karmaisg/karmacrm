-- ============================================================================
-- Aşama 35 — Yıllık bütçe: ayrı Personel Gider Tablosu ve gider kalemi ↔ Giderler kategorisi eşleştirme
-- * budget_personnel_lines: personel başına önceki yıl net maaş + SGK, artış oranı, sonraki yıl net maaş + SGK.
-- * budget_expense_lines.category_ids: kalemin hangi Giderler kategorilerinden önceki yıl ortalaması alınacağı.
-- * Eskiden "Personel Giderleri" altına girilen alt satırlar yeni tabloya taşınır. Tekrar çalıştırılabilir.
-- ============================================================================

create table if not exists budget_personnel_lines (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null default app.org_id() references organizations(id),
  budget_year      integer not null check (budget_year between 2000 and 2100),
  full_name        text not null check (char_length(btrim(full_name)) between 1 and 200),
  prev_net         numeric(14,2) check (prev_net is null or prev_net >= 0),     -- önceki yıl aylık net maaş
  prev_sgk         numeric(14,2) check (prev_sgk is null or prev_sgk >= 0),     -- önceki yıl aylık SGK gideri
  increase_pct     numeric(7,2),
  next_net         numeric(14,2) check (next_net is null or next_net >= 0),
  next_sgk         numeric(14,2) check (next_sgk is null or next_sgk >= 0),
  sort_order       integer not null default 0,
  created_by       uuid default auth.uid(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists budget_personnel_idx on budget_personnel_lines (organization_id, budget_year);

alter table budget_personnel_lines enable row level security;
drop policy if exists budget_personnel_sel on budget_personnel_lines;
create policy budget_personnel_sel on budget_personnel_lines for select to authenticated
  using (organization_id = app.org_id() and app.can('budget', 'view'));
drop policy if exists budget_personnel_ins on budget_personnel_lines;
create policy budget_personnel_ins on budget_personnel_lines for insert to authenticated
  with check (organization_id = app.org_id() and app.can('budget', 'create'));
drop policy if exists budget_personnel_upd on budget_personnel_lines;
create policy budget_personnel_upd on budget_personnel_lines for update to authenticated
  using (organization_id = app.org_id() and app.can('budget', 'edit')) with check (organization_id = app.org_id());
drop policy if exists budget_personnel_del on budget_personnel_lines;
create policy budget_personnel_del on budget_personnel_lines for delete to authenticated
  using (organization_id = app.org_id() and app.can('budget', 'edit'));
revoke all on budget_personnel_lines from anon, authenticated;
grant select, insert, update, delete on budget_personnel_lines to authenticated;

drop trigger if exists trg_budget_personnel_touch on budget_personnel_lines;
create trigger trg_budget_personnel_touch before update on budget_personnel_lines for each row execute function app.touch_updated_at();
drop trigger if exists trg_budget_personnel_audit on budget_personnel_lines;
create trigger trg_budget_personnel_audit after insert or update on budget_personnel_lines for each row execute function app.audit();

-- kalem ↔ Giderler kategorisi eşleşmesi
alter table budget_expense_lines add column if not exists category_ids uuid[] not null default '{}';
alter table budget_expense_lines drop constraint if exists budget_expense_category_ids_check;
alter table budget_expense_lines add constraint budget_expense_category_ids_check check (cardinality(category_ids) <= 200);

-- eski alt satırları (Personel Giderleri altındakiler) yeni tabloya taşı
with tasinan as (
  delete from budget_expense_lines c where c.parent_id is not null
  returning c.organization_id, c.budget_year, c.name, c.prev_avg_expense, c.increase_pct, c.next_avg_expense, c.created_at
)
insert into budget_personnel_lines(organization_id, budget_year, full_name, prev_net, prev_sgk, increase_pct, next_net, sort_order, created_at)
select organization_id, budget_year, name, prev_avg_expense, null, increase_pct, next_avg_expense, 0, created_at from tasinan;

-- denetim kaydı yeni tabloyu "budget" modülüne bağlar
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
    'signed_contracts','contracts','budget_lines','budget','budget_expense_lines','budget','budget_personnel_lines','budget') ->> p_table), 'users');
$$;
