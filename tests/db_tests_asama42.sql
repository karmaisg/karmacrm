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
set role authenticated; select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false);
select tst.works('İşyeri adresi yazılır', $$update companies set workplace_city='İzmir', workplace_district='Gaziemir', workplace_address='Sanayi Cd. No:5' where id='aaaaaaaa-1111-0000-0000-000000000001'$$);
select tst.ok('İşyeri ve fatura adresi ayrı', (select workplace_city='İzmir' and workplace_address='Sanayi Cd. No:5' from companies where id='aaaaaaaa-1111-0000-0000-000000000001'));
select tst.fails('İşyeri adresi 500 karakteri aşamaz', $$update companies set workplace_address=repeat('a',501) where id='aaaaaaaa-1111-0000-0000-000000000001'$$);
select tst.fails('İşyeri ili 80 karakteri aşamaz', $$update companies set workplace_city=repeat('a',81) where id='aaaaaaaa-1111-0000-0000-000000000001'$$);
select tst.works('Konum işyeri adresiyle kaydedilir', $$select public.firma_konum_kaydet('aaaaaaaa-1111-0000-0000-000000000001', 38.3, 27.1, 'Sanayi Cd. No:5, Gaziemir, İzmir, Türkiye', 'google')$$);
reset role;
