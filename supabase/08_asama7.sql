-- =====================================================================
-- OSGB 360 - Aşama 7 eki (ortak gider dağıtımı ve kârlılık)
--
-- 01_sema.sql ... 07_asama6.sql çalıştırıldıktan SONRA, BİR KEZ çalıştırılır.
-- Mevcut verilere dokunmaz. Tekrar çalıştırmak zarar vermez.
--
--   1) Dağıtım ölçütü kuralları artık "firma kârlılığı" yetkisiyle yönetilir (Finans de değiştirebilir)
--   2) Aynı dönem + kategori + firma için tek aktif dağıtım satırı
--   3) dagitim_olcutu_ayarla : ölçüt değişimi tarihçeli (eski dönem kapanır, geçmiş ay bozulmaz)
--   4) ortak_gider_dagitimini_kaydet : bir ayın bir kategorisi için dağıtımı kaydeder / yeniler
--      (toplam, o ayın ortak gider havuzunu aşamaz; eski satırlar sıfırlanır, silinmez)
-- =====================================================================

-- 1) Dağıtım kuralları: okuma herkese (01_sema), yazma 'company_profit' yetkisiyle
drop policy if exists allocation_rules_ins on allocation_rules;
create policy allocation_rules_ins on allocation_rules for insert to authenticated
  with check (organization_id = app.org_id() and app.can('company_profit', 'create'));
drop policy if exists allocation_rules_upd on allocation_rules;
create policy allocation_rules_upd on allocation_rules for update to authenticated
  using (organization_id = app.org_id() and app.can('company_profit', 'edit'))
  with check (organization_id = app.org_id());

drop trigger if exists trg_allocation_rules_org on allocation_rules;
create trigger trg_allocation_rules_org before insert or update on allocation_rules
  for each row execute function app.check_same_org('expense_categories:category_id');

-- 2) Aynı dönem/kategori/firma için tek aktif dağıtım satırı
create unique index if not exists overhead_alloc_uq on overhead_allocations(organization_id, period, category_id, company_id)
  where archived_at is null and company_id is not null;

-- Dağıtılabilir kategori: ortak gider kategorisi (maaş ve gelir vergisi kategorileri dağıtılmaz)
create or replace function app.dagitilabilir_kategori(p_category uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.expense_categories c
                  where c.id = p_category and c.organization_id = app.org_id() and not c.is_payroll and not c.is_income_tax)
$$;

-- 3) Dağıtım ölçütü (tarihçeli)
create or replace function public.dagitim_olcutu_ayarla(p_kategori uuid, p_olcut allocation_basis, p_baslangic date)
returns allocation_rules
language plpgsql as $$
declare acik allocation_rules; yeni allocation_rules;
begin
  if not app.can('company_profit', 'edit') or not app.can('company_profit', 'create') then
    raise exception 'Dağıtım ölçütünü değiştirme yetkiniz yok.';
  end if;
  if not app.dagitilabilir_kategori(p_kategori) then
    raise exception 'Bu kategori için dağıtım ölçütü tanımlanamaz (maaş ve vergi kategorileri dağıtılmaz).';
  end if;
  if p_baslangic is null or extract(day from p_baslangic) <> 1 then
    raise exception 'Ölçüt ayın 1''inden itibaren geçerli olmalıdır.';
  end if;
  select * into acik from allocation_rules where category_id = p_kategori and valid_to is null order by valid_from desc limit 1;
  if found then
    if acik.basis = p_olcut then return acik; end if;
    if p_baslangic <= acik.valid_from then
      raise exception 'Yeni ölçüt, mevcut ölçütün başlangıcından (%) sonra olmalıdır.', to_char(acik.valid_from, 'DD.MM.YYYY');
    end if;
    update allocation_rules set valid_to = p_baslangic - 1 where id = acik.id;
  end if;
  insert into allocation_rules(category_id, basis, valid_from) values (p_kategori, p_olcut, p_baslangic) returning * into yeni;
  return yeni;
end $$;

-- 4) Bir ayın bir kategorisi için dağıtımı kaydet / yenile. p_satirlar: [{"company_id": "...", "amount": 123.45}, ...]
create or replace function public.ortak_gider_dagitimini_kaydet(p_donem date, p_kategori uuid, p_olcut allocation_basis, p_satirlar jsonb)
returns integer
language plpgsql as $$
declare r record; n integer := 0; v_donem date;
begin
  if not app.can('company_profit', 'edit') or not app.can('company_profit', 'create') then
    raise exception 'Gider dağıtımını kaydetme yetkiniz yok.';
  end if;
  if p_donem is null then raise exception 'Dönem seçilmelidir.'; end if;
  v_donem := date_trunc('month', p_donem)::date;
  if not app.dagitilabilir_kategori(p_kategori) then
    raise exception 'Bu kategori dağıtılamaz (maaş ve vergi kategorileri dağıtılmaz).';
  end if;
  if jsonb_typeof(coalesce(p_satirlar, '[]'::jsonb)) <> 'array' then raise exception 'Dağıtım satırları liste olmalıdır.'; end if;

  -- önce mevcut satırlar sıfırlanır (havuz kontrolü geçici olarak aşılmasın)
  update overhead_allocations set amount = 0, basis = p_olcut
   where category_id = p_kategori and period = v_donem and archived_at is null and company_id is not null;

  for r in select (e ->> 'company_id')::uuid as company_id, round((e ->> 'amount')::numeric, 2) as amount
             from jsonb_array_elements(coalesce(p_satirlar, '[]'::jsonb)) e
  loop
    if r.amount is null or r.amount < 0 then raise exception 'Dağıtım tutarı negatif olamaz.'; end if;
    insert into overhead_allocations(period, category_id, company_id, basis, amount)
    values (v_donem, p_kategori, r.company_id, p_olcut, r.amount)
    on conflict (organization_id, period, category_id, company_id) where archived_at is null and company_id is not null
    do update set amount = excluded.amount, basis = excluded.basis;
    n := n + 1;
  end loop;
  return n;
end $$;

revoke all on function public.dagitim_olcutu_ayarla(uuid, allocation_basis, date) from public, anon;
revoke all on function public.ortak_gider_dagitimini_kaydet(date, uuid, allocation_basis, jsonb) from public, anon;
grant execute on function public.dagitim_olcutu_ayarla(uuid, allocation_basis, date) to authenticated;
grant execute on function public.ortak_gider_dagitimini_kaydet(date, uuid, allocation_basis, jsonb) to authenticated;

-- ---------------------------------------------------------------------
-- 5) Kârlılık girdileri: Finans rolünün görevlendirme ve zaman kaydı tablolarına erişimi YOKTUR.
--    Bu fonksiyon yalnızca hesap için gereken en az alanı (kim, hangi firma, kaç dakika, pay) döndürür;
--    not, saat, resmî görevlendirme bilgisi gibi alanlar verilmez. Yetki: firma veya personel kârlılığı görüntüleme.
-- ---------------------------------------------------------------------
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
    'personeller', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'full_name', e.full_name, 'staff_type', e.staff_type, 'is_active', e.is_active,
                'archived_at', e.archived_at, 'monthly_capacity_min', e.monthly_capacity_min))
              from employees e where e.organization_id = v_org), '[]'::jsonb));
end $$;
revoke all on function public.karlilik_girdileri(date) from public, anon;
grant execute on function public.karlilik_girdileri(date) to authenticated;
