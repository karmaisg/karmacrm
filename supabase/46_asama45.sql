-- Aşama 45: Firma ve işyeri kısaltması uzunluğu 30 -> 150 karakter. Tekrar çalıştırılabilir.
alter table companies drop constraint if exists companies_short_code_ck;
alter table companies add constraint companies_short_code_ck check (short_code is null or (char_length(btrim(short_code)) between 1 and 150 and short_code !~ '[[:cntrl:]]'));
alter table company_sites drop constraint if exists company_sites_extra_ck;
alter table company_sites add constraint company_sites_extra_ck check (
  (short_code is null or (char_length(btrim(short_code)) between 1 and 150 and short_code !~ '[[:cntrl:]]'))
  and char_length(coalesce(district, '')) <= 80 and char_length(coalesce(address, '')) <= 500
  and ((latitude is null and longitude is null and geo_source is null)
       or (latitude between -90 and 90 and longitude between -180 and 180 and geo_source in ('google', 'manuel'))));
