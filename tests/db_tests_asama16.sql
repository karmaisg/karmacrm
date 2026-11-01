-- OSGB 360 - Aşama 15 (personel rolleri, yönetim işareti, işyeri takma adı) veri tabanı testleri (yerel PostgreSQL 16 + Supabase taklidi)
-- Sıra: supabase_stub.sql -> 01_sema.sql -> 03..13 -> 16_asama15.sql -> bu dosya (boş bir veri tabanında)
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
insert into organizations(id,name) values
 ('aaaaaaaa-0000-0000-0000-000000000001','Karma OSGB'),
 ('bbbbbbbb-0000-0000-0000-000000000002','Başka OSGB');
select app.seed_organization('aaaaaaaa-0000-0000-0000-000000000001');
select app.seed_organization('bbbbbbbb-0000-0000-0000-000000000002');
insert into auth.users(id,email) values
 ('11111111-1111-1111-1111-111111111111','sahip@karma.test'),
 ('22222222-2222-2222-2222-222222222222','satis@karma.test'),
 ('33333333-3333-3333-3333-333333333333','finans@karma.test'),
 ('44444444-4444-4444-4444-444444444444','yabanci@baska.test');
insert into users(id,organization_id,role_id,full_name,email)
select u.id, r.organization_id, r.id, u.ad, u.eposta
from (values
  ('11111111-1111-1111-1111-111111111111'::uuid,'isletme_sahibi','aaaaaaaa-0000-0000-0000-000000000001'::uuid,'Sahip','sahip@karma.test'),
  ('22222222-2222-2222-2222-222222222222','satis','aaaaaaaa-0000-0000-0000-000000000001','Satışçı','satis@karma.test'),
  ('33333333-3333-3333-3333-333333333333','finans','aaaaaaaa-0000-0000-0000-000000000001','Finansçı','finans@karma.test'),
  ('44444444-4444-4444-4444-444444444444','isletme_sahibi','bbbbbbbb-0000-0000-0000-000000000002','Yabancı','yabanci@baska.test')
) as u(id,rol,org,ad,eposta)
join roles r on r.key = u.rol and r.organization_id = u.org;
create temp table g as select app.today_tr() as bugun;
grant select on g to authenticated, anon;
insert into companies(id,organization_id,name) values
 ('aaaaaaaa-1111-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001','Alfa Gıda'),
 ('bbbbbbbb-1111-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000002','Yabancı Firma');


insert into companies(id,organization_id,name) values
 ('aaaaaaaa-1111-0000-0000-000000000002','aaaaaaaa-0000-0000-0000-000000000001','Seterm Teknik');
insert into company_profiles(organization_id, company_id, employee_count, hazard_class, valid_from) values
 ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-1111-0000-0000-000000000002', 10, 'az_tehlikeli', '2026-01-01');



insert into employees(id, organization_id, full_name, staff_type) values ('eeeeeeee-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001','Uzman Bir','is_guvenligi_uzmani');
insert into employees(id, organization_id, full_name, staff_type, role_kind, title, is_management) values
 ('eeeeeeee-0000-0000-0000-000000000005','aaaaaaaa-0000-0000-0000-000000000001','Sema DSP',null,'diger_saglik','Hemşire',false),
 ('eeeeeeee-0000-0000-0000-000000000006','aaaaaaaa-0000-0000-0000-000000000001','Sekreter Ayşe',null,'sekreter',null,true);
select tst.ok('Uzman/hekim dışı rol kaydedilir (hizmet türü boş)', (select count(*) from employees where staff_type is null) = 2);
select tst.fails('Hizmet türü ve rol birlikte olamaz', $$insert into employees(organization_id, full_name, staff_type, role_kind) values ('aaaaaaaa-0000-0000-0000-000000000001','X','isyeri_hekimi','satis')$$, 'employees_role_kind_chk');
select tst.fails('İkisi de boş olamaz', $$insert into employees(organization_id, full_name) values ('aaaaaaaa-0000-0000-0000-000000000001','Y')$$, 'employees_role_kind_chk');
select tst.fails('Geçersiz rol reddedilir', $$insert into employees(organization_id, full_name, staff_type, role_kind) values ('aaaaaaaa-0000-0000-0000-000000000001','Z',null,'astronot')$$, 'employees_role_kind_chk');
select tst.fails('Rol sahibi personele görevlendirme yapılamaz', $$insert into assignments(organization_id, company_id, employee_id, staff_type, share_pct, valid_from) values ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-1111-0000-0000-000000000002','eeeeeeee-0000-0000-0000-000000000005','is_guvenligi_uzmani',10,'2026-01-01')$$, 'uzman veya hekim değil');
set role authenticated; select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false);
select tst.ok('personel_listesi yalnızca uzman/hekim döndürür', (select count(*) from public.personel_listesi()) = 1);
select tst.ok('Kârlılık girdileri rol ve yönetim işaretini taşır', (select (j->'personeller') @> '[{"full_name":"Sekreter Ayşe","role_kind":"sekreter","is_management":true}]'::jsonb from (select public.karlilik_girdileri('2026-10-01') j) x));
reset role;
-- uzman da yönetim gideri olarak işaretlenebilir ve görevlendirilebilir
update employees set is_management = true where id = 'eeeeeeee-0000-0000-0000-000000000001';
select tst.works('Yönetimdeki uzmana görevlendirme yapılabilir', $$insert into assignments(organization_id, company_id, employee_id, staff_type, share_pct, valid_from) values ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-1111-0000-0000-000000000002','eeeeeeee-0000-0000-0000-000000000001','is_guvenligi_uzmani',50,'2026-01-01')$$);
-- işyeri takma adı
insert into company_sites(organization_id, company_id, sgk_no, site_name) values ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-1111-0000-0000-000000000002','11111111111111111111111111','UKEM SAĞLIK LTD');
select tst.works('İşyeri takma adı ve ayrı fatura işareti yazılır', $$update company_sites set invoice_alias = 'UKEM', separate_invoice = true where sgk_no = '11111111111111111111111111'$$);
select tst.ok('Takma ad okunur', (select invoice_alias = 'UKEM' and separate_invoice from company_sites where sgk_no = '11111111111111111111111111'));
select tst.fails('Çok uzun takma ad reddedilir', format($f$update company_sites set invoice_alias = %L where sgk_no = '11111111111111111111111111'$f$, repeat('x', 121)), 'invoice_alias');
select tst.ok('Varsayılan: ayrı fatura yok', (select count(*) from company_sites where separate_invoice) = 1);
