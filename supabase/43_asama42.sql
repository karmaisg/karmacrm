-- Aşama 42: İşyeri adresi (fatura adresinden ayrı). Mevcut city/district/address alanları artık "fatura adresi"dir.
-- Harita konumu işyeri adresinden bulunur. Tekrar çalıştırılabilir.
alter table companies add column if not exists workplace_city text;
alter table companies add column if not exists workplace_district text;
alter table companies add column if not exists workplace_address text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'companies_workplace_len_ck') then
    alter table companies add constraint companies_workplace_len_ck check (
      char_length(coalesce(workplace_city, '')) <= 80 and char_length(coalesce(workplace_district, '')) <= 80
      and char_length(coalesce(workplace_address, '')) <= 500);
  end if;
end $$;

-- Daha önce fatura adresinden bulunmuş konumlar işyerini göstermez: temizlenir (elle işaretlenenler dahil).
-- Yalnızca işyeri adresi henüz girilmemiş firmalar etkilenir; yeni konum işyeri adresinden bulunacaktır.
do $$ begin
  update companies set latitude = null, longitude = null, geo_query = null, geo_source = null, geo_at = null
   where latitude is not null and workplace_address is null and workplace_city is null and workplace_district is null;
end $$;
