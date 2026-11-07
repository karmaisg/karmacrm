-- OSGB 360 - Aşama 28: bağlı firmalar (ana firma)
--   * companies.parent_company_id : bu firma, belirtilen ANA firmaya bağlıdır (tek fatura/tahsilat, kârlılıkta tek firma).
--     Bağlı firmanın çalışan sayısı ve tehlike sınıfı ana firmaya eklenir. Tek seviye: ana firmanın kendisi başka bir firmaya bağlanamaz.
-- Yeniden çalıştırılabilir.

alter table companies add column if not exists parent_company_id uuid references companies(id);
create index if not exists companies_parent_idx on companies(parent_company_id) where parent_company_id is not null;

create or replace function app.companies_parent_check() returns trigger language plpgsql as $$
begin
  if new.parent_company_id is null then return new; end if;
  if new.parent_company_id = new.id then raise exception 'Bir firma kendisine bağlanamaz.'; end if;
  if exists (select 1 from companies where id = new.parent_company_id and parent_company_id is not null) then
    raise exception 'Seçilen ana firma zaten başka bir firmaya bağlı; yalnızca tek seviye desteklenir.';
  end if;
  if exists (select 1 from companies where parent_company_id = new.id) then
    raise exception 'Bu firmaya bağlı firmalar var; önce onların bağlantısını kaldırın.';
  end if;
  if not exists (select 1 from companies where id = new.parent_company_id and organization_id = new.organization_id) then
    raise exception 'Ana firma bulunamadı.';
  end if;
  return new;
end $$;

drop trigger if exists trg_companies_parent_check on companies;
create trigger trg_companies_parent_check before insert or update of parent_company_id on companies
  for each row execute function app.companies_parent_check();

notify pgrst, 'reload schema';
