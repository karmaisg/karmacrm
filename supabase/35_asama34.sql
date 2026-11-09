-- ============================================================================
-- Aşama 34 — Yıllık bütçe: gider tablosu, kendi gelir satırları, yeni fiyat türü, elle beklenen gelir
-- 34_asama33.sql çalıştırıldıktan sonra çalıştırılmalıdır. Tekrar çalıştırılabilir.
-- ============================================================================

-- Gelir satırı artık firmasız ("kendi eklediğim gelir") olabilir
alter table budget_lines alter column company_id drop not null;
alter table budget_lines add column if not exists custom_name text;
alter table budget_lines add column if not exists next_price_type text;   -- gelecek yılın fiyat türü (boşsa önceki yılla aynı)
alter table budget_lines add column if not exists expected_manual numeric(14,2);   -- beklenen aylık geliri elle girmek için
alter table budget_lines drop constraint if exists budget_lines_custom_name_check;
alter table budget_lines add constraint budget_lines_custom_name_check check (custom_name is null or char_length(btrim(custom_name)) between 1 and 200);
alter table budget_lines drop constraint if exists budget_lines_next_price_type_check;
alter table budget_lines add constraint budget_lines_next_price_type_check check (next_price_type is null or next_price_type in ('sabit', 'kisi_basi'));
alter table budget_lines drop constraint if exists budget_lines_expected_manual_check;
alter table budget_lines add constraint budget_lines_expected_manual_check check (expected_manual is null or expected_manual >= 0);
alter table budget_lines drop constraint if exists budget_lines_hedef_check;
alter table budget_lines add constraint budget_lines_hedef_check check (company_id is not null or custom_name is not null);

-- Yalnızca firmasız (kendi eklenen) gelir satırları silinebilir
drop policy if exists budget_lines_del on budget_lines;
create policy budget_lines_del on budget_lines for delete to authenticated
  using (organization_id = app.org_id() and company_id is null and app.can('budget', 'edit'));
grant delete on budget_lines to authenticated;

-- Gider tablosu: kalem başına önceki yıl aylık ortalama gider, % artış, gelecek yıl aylık ortalama gider.
-- parent_id: "Personel Giderleri" kaleminin altına elle girilen personel adları.
create table if not exists budget_expense_lines (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null default app.org_id() references organizations(id),
  budget_year     integer not null check (budget_year between 2000 and 2100),
  name            text not null check (char_length(btrim(name)) between 1 and 200),
  parent_id       uuid references budget_expense_lines(id) on delete cascade,
  is_personnel    boolean not null default false,      -- altına personel adı eklenebilen kalem
  is_default      boolean not null default false,      -- hazır gelen kalem (silinemez)
  sort_order      integer not null default 0,
  prev_avg_expense numeric(14,2) check (prev_avg_expense is null or prev_avg_expense >= 0),
  increase_pct    numeric(7,2),
  next_avg_expense numeric(14,2) check (next_avg_expense is null or next_avg_expense >= 0),
  created_by      uuid default auth.uid(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists budget_expense_lines_idx on budget_expense_lines (organization_id, budget_year);

create or replace function app.butce_gider_kontrol() returns trigger language plpgsql as $$
begin
  if new.parent_id is not null then
    if not exists (select 1 from budget_expense_lines p where p.id = new.parent_id and p.organization_id = new.organization_id
                    and p.budget_year = new.budget_year and p.is_personnel and p.parent_id is null) then
      raise exception 'Alt satır yalnızca aynı yılın "Personel Giderleri" kaleminin altına eklenebilir.';
    end if;
  end if;
  return new;
end $$;

alter table budget_expense_lines enable row level security;
drop policy if exists budget_expense_sel on budget_expense_lines;
create policy budget_expense_sel on budget_expense_lines for select to authenticated
  using (organization_id = app.org_id() and app.can('budget', 'view'));
drop policy if exists budget_expense_ins on budget_expense_lines;
create policy budget_expense_ins on budget_expense_lines for insert to authenticated
  with check (organization_id = app.org_id() and app.can('budget', 'create'));
drop policy if exists budget_expense_upd on budget_expense_lines;
create policy budget_expense_upd on budget_expense_lines for update to authenticated
  using (organization_id = app.org_id() and app.can('budget', 'edit')) with check (organization_id = app.org_id());
drop policy if exists budget_expense_del on budget_expense_lines;
create policy budget_expense_del on budget_expense_lines for delete to authenticated
  using (organization_id = app.org_id() and not is_default and app.can('budget', 'edit'));
revoke all on budget_expense_lines from anon, authenticated;
grant select, insert, update, delete on budget_expense_lines to authenticated;

drop trigger if exists trg_budget_expense_touch on budget_expense_lines;
create trigger trg_budget_expense_touch before update on budget_expense_lines for each row execute function app.touch_updated_at();
drop trigger if exists trg_budget_expense_chk on budget_expense_lines;
create trigger trg_budget_expense_chk before insert or update on budget_expense_lines for each row execute function app.butce_gider_kontrol();
drop trigger if exists trg_budget_expense_audit on budget_expense_lines;
create trigger trg_budget_expense_audit after insert or update on budget_expense_lines for each row execute function app.audit();

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
    'signed_contracts','contracts','budget_lines','budget','budget_expense_lines','budget') ->> p_table), 'users');
$$;
