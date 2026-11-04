-- OSGB 360 - Aşama 20: personel bazlı maliyet (net maaş, brüt maaş, emekli, otomatik SGK primi, elden ödenen).
-- İşverene toplam maliyet (yeni kayıtlar) = net maaş + SGK primi + elden verilen. Eski kayıtlar (brüt + SGK + diğer) aynen korunur.
-- SGK primi (brüt maaş üzerinden): emekli ise %2,25 + %30; emekli değilse %2,25 + %21 + %12,5 + %3. Brüt yoksa SGK elle girilebilir.
-- Yeni geçerlilik başlangıcı girilince, kayıt o tarihten sonraki aylara (başka bir başlangıç girilene kadar) aynen uygulanır.
-- Güvenle yeniden çalıştırılabilir.

alter table employee_costs add column if not exists net_salary numeric(14,2) not null default 0 check (net_salary >= 0);
alter table employee_costs add column if not exists cash_paid numeric(14,2) not null default 0 check (cash_paid >= 0);
alter table employee_costs add column if not exists is_retired boolean not null default false;
alter table employee_costs add column if not exists sgk_manual boolean not null default false;
alter table employee_costs add column if not exists cost_version smallint not null default 1 check (cost_version in (1, 2));

-- toplam: sürüm 2 = net + SGK + elden; sürüm 1 (eski) = brüt + SGK + diğer
do $$
begin
  if not exists (select 1 from information_schema.columns where table_name = 'employee_costs' and column_name = 'total_monthly_cost'
                  and generation_expression like '%cost_version%') then
    alter table employee_costs drop column total_monthly_cost;
    alter table employee_costs add column total_monthly_cost numeric(14,2) generated always as (
      case when cost_version = 2 then net_salary + employer_sgk + cash_paid else gross_salary + employer_sgk + other_benefits end) stored;
  end if;
end $$;

create or replace function app.sgk_primi(p_brut numeric, p_emekli boolean) returns numeric
language sql immutable as $$
  select round(coalesce(p_brut, 0) * case when p_emekli then 0.0225 + 0.30 else 0.0225 + 0.21 + 0.125 + 0.03 end, 2)
$$;

-- Kaydeder: zorunlu alan yok. p_sgk boşsa brüt maaştan otomatik hesaplanır; doluysa elle girilmiş sayılır.
-- Tarih geçmişte de olabilir: kapsayan dönem bölünür, sonraki dönemler korunur.
create or replace function public.personel_maliyeti_kaydet(p_employee uuid, p_baslangic date, p_brut numeric, p_net numeric, p_emekli boolean, p_sgk numeric, p_elden numeric)
returns employee_costs language plpgsql security invoker set search_path = public as $$
declare v_brut numeric := coalesce(p_brut, 0); v_net numeric := coalesce(p_net, 0); v_elden numeric := coalesce(p_elden, 0);
        v_sgk numeric; v_manuel boolean := p_sgk is not null; v_on employee_costs%rowtype; v_son date; v_sonraki date; y employee_costs%rowtype;
begin
  if not (app.can('payroll','create') and app.can('payroll','edit')) then raise exception 'Personel maliyeti girme yetkiniz yok.'; end if;
  if p_baslangic is null then raise exception 'Geçerlilik başlangıcını girin.'; end if;
  if v_brut < 0 or v_net < 0 or v_elden < 0 or coalesce(p_sgk, 0) < 0 then raise exception 'Tutarlar negatif olamaz.'; end if;
  if not exists (select 1 from employees where id = p_employee) then raise exception 'Personel bulunamadı.'; end if;
  v_sgk := case when v_manuel then round(p_sgk, 2) else app.sgk_primi(v_brut, coalesce(p_emekli, false)) end;

  select * into v_on from employee_costs where employee_id = p_employee and valid_from <= p_baslangic and (valid_to is null or valid_to >= p_baslangic);
  if found and v_on.valid_from = p_baslangic then
    -- aynı başlangıçlı dönem yeniden girilirse güncellenir
    update employee_costs set gross_salary = v_brut, net_salary = v_net, cash_paid = v_elden, employer_sgk = v_sgk, other_benefits = 0,
           is_retired = coalesce(p_emekli, false), sgk_manual = v_manuel, cost_version = 2
     where id = v_on.id returning * into y;
    return y;
  end if;
  if found then
    v_son := v_on.valid_to;                                  -- yeni dönem, kapsayan dönemin bitişine kadar sürer (açıksa açık kalır)
    update employee_costs set valid_to = p_baslangic - 1 where id = v_on.id;
  else
    select min(valid_from) into v_sonraki from employee_costs where employee_id = p_employee and valid_from > p_baslangic;
    v_son := case when v_sonraki is null then null else v_sonraki - 1 end;
  end if;
  insert into employee_costs(employee_id, gross_salary, net_salary, cash_paid, employer_sgk, other_benefits, is_retired, sgk_manual, cost_version, valid_from, valid_to)
  values (p_employee, v_brut, v_net, v_elden, v_sgk, 0, coalesce(p_emekli, false), v_manuel, 2, p_baslangic, v_son) returning * into y;
  return y;
end $$;
revoke all on function public.personel_maliyeti_kaydet(uuid, date, numeric, numeric, boolean, numeric, numeric) from public, anon;
grant execute on function public.personel_maliyeti_kaydet(uuid, date, numeric, numeric, boolean, numeric, numeric) to authenticated;
