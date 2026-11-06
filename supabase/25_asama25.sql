-- OSGB 360 - Aşama 25: cari hesap ekstresi
--   * companies.tax_office : vergi dairesi (cari ekstre Excel başlığında kullanılır). İsteğe bağlı.
-- Yeniden çalıştırılabilir.

alter table companies add column if not exists tax_office text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'companies_tax_office_len') then
    alter table companies add constraint companies_tax_office_len check (tax_office is null or char_length(tax_office) <= 100);
  end if;
end $$;
