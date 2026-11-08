-- ============================================================================
-- Aşama 33 — Yıllık bütçe (fiyat artışı planlama) modülü
-- Her firma için bir sonraki yılın hizmet bedeli çalışması: önceki yıl fiyatı, talep edilen artış,
-- kabul edilen bedel, görüşme durumu ve notlar. Tekrar çalıştırılabilir.
-- Yetki: yeni "budget" modülü; varsayılan olarak yalnızca sistem yöneticisi ve işletme sahibi.
-- ============================================================================

insert into role_permissions(role_id, module, can_view, can_create, can_edit, can_archive)
select r.id, 'budget', r.key in ('sistem_yoneticisi', 'isletme_sahibi'), r.key in ('sistem_yoneticisi', 'isletme_sahibi'),
       r.key in ('sistem_yoneticisi', 'isletme_sahibi'), r.key in ('sistem_yoneticisi', 'isletme_sahibi')
  from roles r
on conflict (role_id, module) do nothing;

create or replace function app.roles_butce_yetki() returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into role_permissions(role_id, module, can_view, can_create, can_edit, can_archive)
  values (new.id, 'budget', new.key in ('sistem_yoneticisi', 'isletme_sahibi'), new.key in ('sistem_yoneticisi', 'isletme_sahibi'),
          new.key in ('sistem_yoneticisi', 'isletme_sahibi'), new.key in ('sistem_yoneticisi', 'isletme_sahibi'))
  on conflict do nothing;
  return new;
end $$;
drop trigger if exists trg_roles_butce_yetki on roles;
create trigger trg_roles_butce_yetki after insert on roles for each row execute function app.roles_butce_yetki();

create table if not exists budget_lines (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null default app.org_id() references organizations(id),
  budget_year      integer not null check (budget_year between 2000 and 2100),   -- bütçesi yapılan (sonraki) yıl
  company_id       uuid not null references companies(id) on delete cascade,
  price_type       text not null default 'sabit' check (price_type in ('sabit', 'kisi_basi')),
  unit_price       numeric(14,2) check (unit_price is null or unit_price >= 0),  -- önceki yıl: sabit aylık fiyat veya kişi başı fiyat (KDV hariç)
  employee_count   integer check (employee_count is null or employee_count >= 0),
  prev_avg_income  numeric(14,2) check (prev_avg_income is null or prev_avg_income >= 0),  -- boşsa faturalardan otomatik hesaplanır
  increase_pct     numeric(7,2),
  increase_price   numeric(14,2) check (increase_price is null or increase_price >= 0),
  accepted_price   numeric(14,2) check (accepted_price is null or accepted_price >= 0),
  status           text check (status is null or status in ('kabul', 'gorusme_bilgi_yok', 'bilgi_verildi', 'sona_erdi')),
  note             text check (note is null or char_length(note) <= 4000),
  created_by       uuid default auth.uid(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (organization_id, budget_year, company_id)
);
create index if not exists budget_lines_idx on budget_lines (organization_id, budget_year);

alter table budget_lines enable row level security;
drop policy if exists budget_lines_sel on budget_lines;
create policy budget_lines_sel on budget_lines for select to authenticated
  using (organization_id = app.org_id() and app.can('budget', 'view'));
drop policy if exists budget_lines_ins on budget_lines;
create policy budget_lines_ins on budget_lines for insert to authenticated
  with check (organization_id = app.org_id() and app.can('budget', 'create'));
drop policy if exists budget_lines_upd on budget_lines;
create policy budget_lines_upd on budget_lines for update to authenticated
  using (organization_id = app.org_id() and app.can('budget', 'edit'))
  with check (organization_id = app.org_id());
revoke all on budget_lines from anon, authenticated;
grant select, insert, update on budget_lines to authenticated;

drop trigger if exists trg_budget_lines_touch on budget_lines;
create trigger trg_budget_lines_touch before update on budget_lines for each row execute function app.touch_updated_at();
drop trigger if exists trg_budget_lines_audit on budget_lines;
create trigger trg_budget_lines_audit after insert or update on budget_lines for each row execute function app.audit();
drop trigger if exists trg_budget_lines_org on budget_lines;
create trigger trg_budget_lines_org before insert or update on budget_lines for each row execute function app.check_same_org('companies:company_id');

-- denetim kaydı bu tabloyu "budget" modülüne bağlar
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
    'signed_contracts','contracts','budget_lines','budget') ->> p_table), 'users');
$$;
