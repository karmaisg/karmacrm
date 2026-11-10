-- Aşama 38: Maaş hesaplayıcı — banka tutarı net maaştan büyük olabilir (Diğer eksi çıkar). Tekrar çalıştırılabilir.
do $$
declare c text;
begin
  for c in select conname from pg_constraint
           where conrelid = 'public.salary_calcs'::regclass and contype = 'c'
             and pg_get_constraintdef(oid) ilike '%bank_amount <= net_salary%' loop
    execute format('alter table public.salary_calcs drop constraint %I', c);
  end loop;
end $$;
