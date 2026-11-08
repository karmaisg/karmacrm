-- ============================================================================
-- Aşama 31 — Gider türü "Personel"
-- Giderler menüsünde gider türü: Ortak / Doğrudan / Personel.
-- "Personel" olarak işaretlenen kalemler personel maliyetinin TEK kaynağıdır:
-- ortak havuza girmez, personel kartındaki maliyet ayrıca eklenmez.
-- NOT: Bu dosyayı tek başına, olduğu gibi çalıştırın.
-- ============================================================================

alter type cost_type add value if not exists 'personel';

-- Doğrudan gider dışındaki türlerde firma/personel zorunlu değildir
alter table expenses drop constraint if exists expenses_check;
alter table expenses drop constraint if exists expenses_doğrudan_check;
do $$
declare c record;
begin
  for c in select conname from pg_constraint
            where conrelid = 'public.expenses'::regclass and contype = 'c'
              and pg_get_constraintdef(oid) ilike '%cost_type%' loop
    execute format('alter table public.expenses drop constraint %I', c.conname);
  end loop;
end $$;
alter table expenses add constraint expenses_bag_check
  check (cost_type <> 'dogrudan' or company_id is not null or employee_id is not null);

create or replace function app.expense_before_write() returns trigger
language plpgsql as $$
declare v_pay boolean; v_old_pay boolean := false; v_ekle numeric;
begin
  new.description := nullif(btrim(coalesce(new.description, '')), '');
  if tg_op = 'UPDATE' and old.archived_at is not null and new.archived_at is not null then
    raise exception 'Arşivdeki gider değiştirilemez. Önce arşivden çıkarın.';
  end if;
  -- Excel aktarımı: varsayılan türü "personel" olan kategoriler personel gideri olarak kaydedilir
  if tg_op = 'INSERT' and new.import_id is not null and new.cost_type::text = 'ortak'
     and exists (select 1 from expense_categories c where c.id = new.category_id and c.default_cost_type::text = 'personel') then
    new.cost_type := 'personel'::cost_type;
  end if;
  if new.cost_type::text <> 'dogrudan' and (new.company_id is not null or new.employee_id is not null) then
    raise exception 'Ortak giderde (veya personel giderinde) firma/personel seçilemez. Bir firmaya ya da personele ait gider "doğrudan" olmalıdır.';
  end if;
  if new.cost_type = 'dogrudan' and new.company_id is not null and new.employee_id is not null then
    raise exception 'Doğrudan giderde firma ya da personelden yalnızca biri seçilmelidir.';
  end if;
  if new.cost_type = 'dogrudan' and new.company_id is null and new.employee_id is null then
    raise exception 'Doğrudan gider için firma veya personel seçilmelidir.';
  end if;

  v_pay := app.is_payroll_category(new.category_id) or new.cost_type::text = 'personel';
  if tg_op = 'UPDATE' then v_old_pay := app.is_payroll_category(old.category_id) or old.cost_type::text = 'personel'; end if;
  if tg_op = 'INSERT' and v_pay and auth.uid() is not null and not app.can('payroll', 'create') then
    raise exception 'Maaş ve personel maliyeti giderleri için maaş (payroll) yetkisi gerekir.';
  end if;
  if tg_op = 'UPDATE' and (v_pay or v_old_pay) and auth.uid() is not null and not app.can('payroll', 'edit') then
    raise exception 'Maaş ve personel maliyeti giderlerini değiştirmek için maaş (payroll) yetkisi gerekir.';
  end if;

  if tg_op = 'UPDATE' and old.cost_type = 'ortak' and old.archived_at is null then
    v_ekle := case when new.cost_type = 'ortak' and new.archived_at is null and new.category_id = old.category_id
                        and date_trunc('month', new.expense_date) = date_trunc('month', old.expense_date)
                   then new.amount_excl_vat else 0 end;
    perform app.expense_pool_check(old.organization_id, old.category_id, date_trunc('month', old.expense_date)::date, old.id, v_ekle);
  end if;
  return new;
end $$;

-- Toplu dönüştürme: bir kategorideki mevcut giderlerin türünü değiştirir
-- (ör. Excel ile "ortak" gelmiş personel giderlerini "personel" yapmak için).
-- Dağıtımı yapılmış ortak giderler dönüştürülemez (havuz kontrolü tetikleyicisi engeller).
create or replace function public.gider_kategori_turu_degistir(p_kategori uuid, p_tur text)
returns integer
language plpgsql as $$
declare n integer;
begin
  if not app.can('expenses', 'edit') then raise exception 'Gider düzenleme yetkiniz yok.'; end if;
  if p_tur not in ('ortak', 'personel') then raise exception 'Tür yalnızca ortak veya personel olabilir.'; end if;
  if p_tur = 'personel' and not app.can('payroll', 'edit') then raise exception 'Personel gideri için maaş (payroll) yetkisi gerekir.'; end if;
  update expenses set cost_type = p_tur::cost_type
   where category_id = p_kategori and archived_at is null
     and cost_type::text <> 'dogrudan' and cost_type::text <> p_tur;
  get diagnostics n = row_count;
  update expense_categories set default_cost_type = p_tur::cost_type where id = p_kategori;
  return n;
end $$;
revoke all on function public.gider_kategori_turu_degistir(uuid, text) from public, anon;
grant execute on function public.gider_kategori_turu_degistir(uuid, text) to authenticated;
