-- OSGB 360 - Aşama 36 (patlamadan korunma teklifi, geçmiş hatırlatmalar) veri tabanı testleri (yerel PostgreSQL 16 + Supabase taklidi)
-- Sıra: supabase_stub.sql -> 01_sema.sql -> 03..13 -> 37_asama36.sql -> bu dosya (boş bir veri tabanında)
\set ON_ERROR_STOP off
create schema tst;
grant usage on schema tst to authenticated, anon;

create function tst.ok(label text, cond boolean) returns void language plpgsql as $$
begin
  if cond is true then raise notice 'PASS | %', label; else raise notice 'FAIL | %', label; end if;
end $$;

-- stmt HATA vermeli (beklenen metin verilirse hata iletisi onu içermeli)
create function tst.fails(label text, stmt text, expect text default null) returns void language plpgsql as $$
begin
  begin
    execute stmt;
    raise notice 'FAIL | % (hata beklenirdi, ama işlem başarılı oldu)', label;
  exception when others then
    if sqlerrm like '%does not exist%' then
      raise notice 'FAIL | % (test geçersiz: %)', label, sqlerrm;
    elsif expect is not null and sqlerrm not like '%' || expect || '%' then
      raise notice 'FAIL | % (beklenen "%" yerine: %)', label, expect, left(sqlerrm, 120);
    else
      raise notice 'PASS | % [%]', label, left(sqlerrm, 90);
    end if;
  end;
end $$;

create function tst.works(label text, stmt text) returns void language plpgsql as $$
begin
  begin
    execute stmt;
    raise notice 'PASS | %', label;
  exception when others then
    raise notice 'FAIL | % [%]', label, sqlerrm;
  end;
end $$;
create function tst.rows(stmt text) returns bigint language plpgsql as $$
declare n bigint; begin execute stmt; get diagnostics n = row_count; return n; end $$;
grant execute on all functions in schema tst to authenticated, anon;

-- ---------- Kurulum (superuser) ----------
insert into organizations(id,name) values ('aaaaaaaa-0000-0000-0000-000000000001','Karma OSGB'),('bbbbbbbb-0000-0000-0000-000000000002','Başka OSGB');
select app.seed_organization('aaaaaaaa-0000-0000-0000-000000000001');
select app.seed_organization('bbbbbbbb-0000-0000-0000-000000000002');
insert into auth.users(id,email) values ('11111111-1111-1111-1111-111111111111','sahip@karma.test'),('22222222-2222-2222-2222-222222222222','satis@karma.test');
insert into users(id,organization_id,role_id,full_name,email)
select u.id, r.organization_id, r.id, u.ad, u.eposta from (values
  ('11111111-1111-1111-1111-111111111111'::uuid,'isletme_sahibi','aaaaaaaa-0000-0000-0000-000000000001'::uuid,'Sahip','sahip@karma.test'),
  ('22222222-2222-2222-2222-222222222222','finans','aaaaaaaa-0000-0000-0000-000000000001','Finansçı','satis@karma.test')) as u(id,rol,org,ad,eposta)
join roles r on r.key = u.rol and r.organization_id = u.org;
create temp table g as select app.today_tr() as bugun; grant select on g to authenticated, anon;
insert into companies(id,organization_id,name,customer_status) values ('aaaaaaaa-1111-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001','Firma A','musteri');
insert into companies(id,organization_id,name,customer_status) values ('bbbbbbbb-1111-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000002','Firma B','musteri');
insert into auth.users(id,email) values ('33333333-3333-3333-3333-333333333333','ops@karma.test'),('44444444-4444-4444-4444-444444444444','sahipb@karma.test'),('55555555-5555-5555-5555-555555555555','uzman@karma.test');
insert into users(id,organization_id,role_id,full_name,email)
select u.id, r.organization_id, r.id, u.ad, u.eposta from (values
  ('33333333-3333-3333-3333-333333333333'::uuid,'operasyon','aaaaaaaa-0000-0000-0000-000000000001'::uuid,'Operasyon','ops@karma.test'),
  ('44444444-4444-4444-4444-444444444444','isletme_sahibi','bbbbbbbb-0000-0000-0000-000000000002','Sahip B','sahipb@karma.test'),
  ('55555555-5555-5555-5555-555555555555','uzman_hekim','aaaaaaaa-0000-0000-0000-000000000001','Uzman','uzman@karma.test')) as u(id,rol,org,ad,eposta)
join roles r on r.key = u.rol and r.organization_id = u.org;
insert into employees(id, organization_id, full_name, staff_type) values
  ('e0e0e0e0-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001','Uzman Ali','is_guvenligi_uzmani'),
  ('e0e0e0e0-0000-0000-0000-000000000002','aaaaaaaa-0000-0000-0000-000000000001','Hekim Veli','isyeri_hekimi');
update employees set email = 'ali.uzman@karma.test' where id = 'e0e0e0e0-0000-0000-0000-000000000001';
update companies set short_code = 'ANA' where id = 'aaaaaaaa-1111-0000-0000-000000000001';
create function tst.isle(k jsonb) returns jsonb language sql as $$ select public.karma_ziyaret_isle('aaaaaaaa-0000-0000-0000-000000000001', jsonb_build_array(k), 's1') $$;

set role authenticated; select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false);
select tst.works('işyeri eklenir (adres boş: firmanın işyeri adresi geçerli)', $$insert into company_sites(company_id, sgk_no, site_name, short_code, is_manual) values ('aaaaaaaa-1111-0000-0000-000000000001', 'MAN00001', 'Ege Çelik Ankara Şubesi', 'EGE-ANK', true)$$);
select tst.works('farklı adresli işyeri eklenir', $$insert into company_sites(company_id, sgk_no, site_name, short_code, is_manual, city, district, address) values ('aaaaaaaa-1111-0000-0000-000000000001', 'MAN00002', 'Ege Çelik Gebze Fabrika', 'EGE-GEB', true, 'Kocaeli', 'Gebze', 'OSB 5. Cd.')$$);
select tst.fails('aynı kısaltma iki işyerinde olamaz (Türkçe karakter/harf farkı yok)', $$insert into company_sites(company_id, sgk_no, site_name, short_code, is_manual) values ('aaaaaaaa-1111-0000-0000-000000000001', 'MAN00003', 'X', 'ege-ank', true)$$);
select tst.fails('işyeri kısaltması firma kısaltmasıyla çakışamaz', $$insert into company_sites(company_id, sgk_no, site_name, short_code, is_manual) values ('aaaaaaaa-1111-0000-0000-000000000001', 'MAN00004', 'X', 'ana', true)$$);
select tst.fails('firma kısaltması işyeri kısaltmasıyla çakışamaz', $$update companies set short_code = 'EGE-GEB' where id = 'aaaaaaaa-1111-0000-0000-000000000001'$$);
select tst.works('işyeri konumu kaydedilir', $$select public.isyeri_konum_kaydet((select id from company_sites where short_code = 'EGE-GEB'), 40.8, 29.4, 'OSB 5. Cd., Gebze, Kocaeli', 'google')$$);
select tst.ok('konum işyerinde saklandı', (select latitude = 40.8 and geo_source = 'google' from company_sites where short_code = 'EGE-GEB'));
select set_config('request.jwt.claim.sub','55555555-5555-5555-5555-555555555555',false);
select tst.fails('saha personeli işyeri ekleyemez', $$insert into company_sites(company_id, sgk_no, site_name, short_code, is_manual) values ('aaaaaaaa-1111-0000-0000-000000000001', 'MAN00005', 'X', 'ZZ1', true)$$);
select tst.fails('saha personeli işyeri konumunu kaydedemez', $$select public.isyeri_konum_kaydet((select id from company_sites where short_code = 'EGE-GEB'), 1, 1, 'x', 'manuel')$$);
select set_config('request.jwt.claim.sub','44444444-4444-4444-4444-444444444444',false);
select tst.ok('başka kurum işyerlerini görmez', (select count(*) = 0 from company_sites));
reset role; select set_config('request.jwt.claim.sub','',false);
select tst.isle(jsonb_build_object('id','w1','firma_kisaltma','ege-gebze','personel_eposta','ali.uzman@karma.test','tarih',(current_date - 3)::text,'sure_dakika',60));
select tst.ok('bilinmeyen kısaltma eşleşmez', (select son_sonuc->>'eslesmedi' = '1' from karma_senkron));
select tst.isle(jsonb_build_object('id','w2','firma_kisaltma','EGE-GEB','personel_eposta','ali.uzman@karma.test','tarih',(current_date - 3)::text,'sure_dakika',60));
select tst.ok('Karma ziyareti işyeri kısaltmasıyla firmaya yazılır', (select son_sonuc->>'islendi' = '1' from karma_senkron)
  and (select company_id = 'aaaaaaaa-1111-0000-0000-000000000001' and site_id is not null from karma_ziyaretler where dis_id = 'w2'));
select tst.ok('zaman kaydı notunda işyeri unvanı var', (select notes like '%Ege Çelik Gebze Fabrika%' from time_entries t join karma_ziyaretler z on z.time_entry_id = t.id where z.dis_id = 'w2'));
select tst.isle(jsonb_build_object('id','w3','firma_kisaltma','ANA','personel_eposta','ali.uzman@karma.test','tarih',(current_date - 2)::text,'sure_dakika',45));
select tst.ok('firma kısaltması hâlâ çalışır', (select son_sonuc->>'islendi' = '1' from karma_senkron));
