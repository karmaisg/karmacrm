-- OSGB 360 - Aşama 31 (gider türü personel) veri tabanı testleri (yerel PostgreSQL 16 + Supabase taklidi)
-- Sıra: supabase_stub.sql -> 01_sema.sql -> 03..13 -> 32_asama31.sql -> bu dosya (boş bir veri tabanında)
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
insert into expense_categories(id, organization_id, name, nature, default_cost_type) values
 ('eeeeeeee-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001','Excel Maaş','isletme','ortak');
insert into employees(id, organization_id, full_name, staff_type, monthly_capacity_min, is_active) values ('ffffffff-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001','Uzman','is_guvenligi_uzmani',2000,true);
set role authenticated; select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false);
select tst.works('Personel türü: firma/personel olmadan kaydedilir', $$select public.gider_kaydet(null,'eeeeeeee-0000-0000-0000-000000000001','2026-10-03',40000,'kdv_haric',0,'personel',null,null,true,'Maaşlar')$$);
select tst.fails('Personel türünde firma seçilemez', $$select public.gider_kaydet(null,'eeeeeeee-0000-0000-0000-000000000001','2026-10-03',100,'kdv_haric',0,'personel','aaaaaaaa-1111-0000-0000-000000000001',null,true,null)$$, 'personel giderinde');
select tst.fails('Doğrudan hâlâ firma/personel ister', $$select public.gider_kaydet(null,'eeeeeeee-0000-0000-0000-000000000001','2026-10-03',100,'kdv_haric',0,'dogrudan',null,null,true,null)$$, 'Doğrudan gider için');
select tst.ok('Personel gideri ortak havuza sayılmaz', (select coalesce(sum(amount_excl_vat),0) from expenses where cost_type='ortak') = 0);
select tst.works('Ortak gider eklenir', $$select public.gider_kaydet(null,(select id from expense_categories where name='Kira'),'2026-10-03',3000,'kdv_haric',0,'ortak',null,null,true,'Kira')$$);
-- Excel aktarımı: varsayılan türü personel olan kategori -> personel olarak kaydedilir
reset role;
update expense_categories set default_cost_type = 'personel' where id = 'eeeeeeee-0000-0000-0000-000000000001';
insert into expense_imports(id, organization_id, file_name) values ('99999999-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001','x.xlsx');
insert into expenses(organization_id, category_id, expense_date, amount_excl_vat, cost_type, import_id) values
 ('aaaaaaaa-0000-0000-0000-000000000001','eeeeeeee-0000-0000-0000-000000000001','2026-10-01',500,'ortak','99999999-0000-0000-0000-000000000001');
select tst.ok('Excel aktarımı: personel varsayılanlı kategori personel türüne çevrilir', (select count(*) from expenses where import_id is not null and cost_type::text='personel') = 1);
-- toplu dönüştürme
update expense_categories set default_cost_type = 'ortak' where id = 'eeeeeeee-0000-0000-0000-000000000001';
insert into expenses(organization_id, category_id, expense_date, amount_excl_vat, cost_type) values
 ('aaaaaaaa-0000-0000-0000-000000000001','eeeeeeee-0000-0000-0000-000000000001','2026-09-01',700,'ortak'),
 ('aaaaaaaa-0000-0000-0000-000000000001','eeeeeeee-0000-0000-0000-000000000001','2026-08-01',800,'ortak');
set role authenticated; select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false);
select tst.ok('Toplu dönüştürme 2 ortak kaydı personel yapar', public.gider_kategori_turu_degistir('eeeeeeee-0000-0000-0000-000000000001','personel') = 2);
select tst.ok('Dönüştürme sonrası kategori ortak gider kalmaz', (select count(*) from expenses where category_id='eeeeeeee-0000-0000-0000-000000000001' and cost_type='ortak') = 0);
select tst.ok('Kategori varsayılanı personel olur', (select default_cost_type::text from expense_categories where id='eeeeeeee-0000-0000-0000-000000000001') = 'personel');
select tst.fails('Geçersiz tür reddedilir', $$select public.gider_kategori_turu_degistir('eeeeeeee-0000-0000-0000-000000000001','dogrudan')$$, 'yalnızca');
