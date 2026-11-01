-- OSGB 360 - Aşama 15: personel rolleri, yönetim gideri işareti, işyeri takma adı ve işyeri bazlı fatura işareti.
-- Güvenle yeniden çalıştırılabilir.

-- 1) Personel: uzman/hekim dışındaki roller (DSP, satın alma, satış, sekreter, temizlik, yönetim, diğer)
alter table employees alter column staff_type drop not null;
alter table employees add column if not exists role_kind text;
alter table employees add column if not exists is_management boolean not null default false;
alter table employees drop constraint if exists employees_role_kind_chk;
alter table employees add constraint employees_role_kind_chk check (
  (staff_type is not null and role_kind is null)
  or (staff_type is null and coalesce(role_kind in ('diger_saglik','satin_alma','satis','sekreter','temizlik','yonetim','diger'), false)));
comment on column employees.is_management is 'true ise personelin maliyeti firma kârlılığına değil, genel (yönetim) giderine yazılır; görevlendirmesi olsa bile.';

-- Uzman/hekim listesi (zaman, görevlendirme, kapasite): yalnızca hizmet türü olanlar
create or replace function public.personel_listesi()
returns table (id uuid, full_name text, staff_type staff_type, is_active boolean, monthly_capacity_min integer, archived_at timestamptz)
language sql stable security definer set search_path = public as $$
  select e.id, e.full_name, e.staff_type, e.is_active, e.monthly_capacity_min, e.archived_at
  from public.employees e
  where e.organization_id = app.org_id() and e.staff_type is not null
    and (app.can('staff','view') or app.can('assignments','view') or app.can('time','view') or app.can('capacity','view'))
    and (not app.is_field_staff() or e.id = app.my_employee_id())
  order by e.full_name
$$;

-- Hizmet türü olmayan personele görevlendirme yapılamaz (anlaşılır mesaj)
create or replace function app.assignment_requires_service_type() returns trigger language plpgsql as $$
declare t staff_type;
begin
  select staff_type into t from employees where id = new.employee_id;
  if found and t is null then raise exception 'Bu personel uzman veya hekim değil; firmaya görevlendirilemez.'; end if;
  return new;
end $$;
drop trigger if exists trg_assignment_requires_service_type on assignments;
create trigger trg_assignment_requires_service_type before insert or update of employee_id on assignments
  for each row execute function app.assignment_requires_service_type();

-- Kârlılık girdilerine rol ve yönetim işareti ekle
create or replace function public.karlilik_girdileri(p_ay date)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_bas date; v_bit date; v_org uuid := app.org_id();
begin
  if not (app.can('company_profit', 'view') or app.can('staff_profit', 'view')) then
    raise exception 'Kârlılık verilerini görüntüleme yetkiniz yok.';
  end if;
  if p_ay is null then raise exception 'Ay seçilmelidir.'; end if;
  v_bas := date_trunc('month', p_ay)::date;
  v_bit := (v_bas + interval '1 month - 1 day')::date;
  return jsonb_build_object(
    'atamalar', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'company_id', a.company_id, 'employee_id', a.employee_id,
                'staff_type', a.staff_type, 'share_pct', a.share_pct, 'valid_from', a.valid_from, 'valid_to', a.valid_to, 'archived_at', null))
              from assignments a where a.organization_id = v_org and a.archived_at is null
               and a.valid_from <= v_bit and (a.valid_to is null or a.valid_to >= v_bas)), '[]'::jsonb),
    'zaman', coalesce((select jsonb_agg(jsonb_build_object('employee_id', t.employee_id, 'company_id', t.company_id, 'work_date', t.work_date,
                'activity_type', t.activity_type, 'onsite_minutes', t.onsite_minutes, 'reporting_minutes', t.reporting_minutes, 'archived_at', null))
              from time_entries t where t.organization_id = v_org and t.archived_at is null and t.work_date between v_bas and v_bit), '[]'::jsonb),
    'personeller', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'full_name', e.full_name, 'staff_type', e.staff_type, 'role_kind', e.role_kind,
                'title', e.title, 'is_management', e.is_management, 'is_active', e.is_active,
                'archived_at', e.archived_at, 'monthly_capacity_min', e.monthly_capacity_min))
              from employees e where e.organization_id = v_org), '[]'::jsonb));
end $$;
revoke all on function public.karlilik_girdileri(date) from public, anon;
grant execute on function public.karlilik_girdileri(date) to authenticated;

-- 2) İşyeri: fatura/takma ad ve işyeri bazlı ayrı fatura işareti
alter table company_sites add column if not exists invoice_alias text check (invoice_alias is null or char_length(invoice_alias) <= 120);
alter table company_sites add column if not exists separate_invoice boolean not null default false;
comment on column company_sites.invoice_alias is 'Faturada geçen kısa/takma işyeri adı (ör. UKEM). Fatura Excel''inde bu ad tanınır.';
comment on column company_sites.separate_invoice is 'true ise bu işyerine ayrı fatura kesilir.';

notify pgrst, 'reload schema';
