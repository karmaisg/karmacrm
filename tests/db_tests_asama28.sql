-- OSGB 360 - Aşama 28 (bağlı firma) veri tabanı testleri (yerel PostgreSQL 16 + Supabase taklidi)
-- Sıra: supabase_stub.sql -> 01_sema.sql -> 03..13 -> 29_asama28.sql -> bu dosya (boş bir veri tabanında)
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
insert into companies(id,organization_id,name,customer_status) values ('aaaaaaaa-1111-0000-0000-000000000002','aaaaaaaa-0000-0000-0000-000000000001','Firma B','musteri'),('aaaaaaaa-1111-0000-0000-000000000003','aaaaaaaa-0000-0000-0000-000000000001','Firma C','musteri'),('bbbbbbbb-1111-0000-0000-000000000009','bbbbbbbb-0000-0000-0000-000000000002','Başka firma','musteri');
set role authenticated; select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false);
select tst.fails('Kendine bağlanamaz', $$update companies set parent_company_id = id where id='aaaaaaaa-1111-0000-0000-000000000001'$$);
select tst.works('B, A firmasına bağlanır', $$update companies set parent_company_id='aaaaaaaa-1111-0000-0000-000000000001' where id='aaaaaaaa-1111-0000-0000-000000000002'$$);
select tst.fails('Bağlı firma ana firma olamaz', $$update companies set parent_company_id='aaaaaaaa-1111-0000-0000-000000000002' where id='aaaaaaaa-1111-0000-0000-000000000003'$$);
select tst.fails('Alt firması olan firma bağlanamaz', $$update companies set parent_company_id='aaaaaaaa-1111-0000-0000-000000000003' where id='aaaaaaaa-1111-0000-0000-000000000001'$$);
select tst.fails('Başka kuruluşun firmasına bağlanamaz', $$update companies set parent_company_id='bbbbbbbb-1111-0000-0000-000000000009' where id='aaaaaaaa-1111-0000-0000-000000000003'$$);
select tst.works('Bağ kaldırılır', $$update companies set parent_company_id=null where id='aaaaaaaa-1111-0000-0000-000000000002'$$);
