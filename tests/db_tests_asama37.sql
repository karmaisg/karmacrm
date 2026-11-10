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
insert into auth.users(id,email) values ('33333333-3333-3333-3333-333333333333','satis2@karma.test'),('44444444-4444-4444-4444-444444444444','sahipb@karma.test');
insert into users(id,organization_id,role_id,full_name,email)
select u.id, r.organization_id, r.id, u.ad, u.eposta from (values
  ('33333333-3333-3333-3333-333333333333'::uuid,'satis','aaaaaaaa-0000-0000-0000-000000000001'::uuid,'Satışçı','satis2@karma.test'),
  ('44444444-4444-4444-4444-444444444444','isletme_sahibi','bbbbbbbb-0000-0000-0000-000000000002','Sahip B','sahipb@karma.test')) as u(id,rol,org,ad,eposta)
join roles r on r.key = u.rol and r.organization_id = u.org;
set role authenticated; select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false);
-- ---------- Maaş hesaplayıcı ----------
select tst.works('Personel net maaşla eklenir (banka boş)', $$insert into salary_calcs(id, full_name, net_salary) values ('c0c0c0c0-0000-0000-0000-000000000001','Ayşe Demir',35000.50)$$);
select tst.ok('Kurum otomatik atanır, banka boş', (select organization_id = 'aaaaaaaa-0000-0000-0000-000000000001' and bank_amount is null from salary_calcs where id = 'c0c0c0c0-0000-0000-0000-000000000001'));
select tst.works('Banka tutarı girilir', $$update salary_calcs set bank_amount = 28075.50 where id = 'c0c0c0c0-0000-0000-0000-000000000001'$$);
select tst.ok('Net maaş değişmeden kalır', (select net_salary = 35000.50 and bank_amount = 28075.50 from salary_calcs where id = 'c0c0c0c0-0000-0000-0000-000000000001'));
select tst.fails('Banka net maaştan büyük olamaz', $$update salary_calcs set bank_amount = 40000 where id = 'c0c0c0c0-0000-0000-0000-000000000001'$$);
select tst.fails('Negatif net maaş reddedilir', $$insert into salary_calcs(full_name, net_salary) values ('X', -1)$$);
select tst.fails('Negatif banka reddedilir', $$update salary_calcs set bank_amount = -5 where id = 'c0c0c0c0-0000-0000-0000-000000000001'$$);
select tst.fails('Boş ad reddedilir', $$insert into salary_calcs(full_name, net_salary) values ('', 100)$$);
select tst.fails('Ad olmadan eklenemez', $$insert into salary_calcs(net_salary) values (100)$$);
select tst.fails('Net maaş olmadan eklenemez', $$insert into salary_calcs(full_name) values ('Y')$$);
select tst.fails('Kalıcı silme yok', $$delete from salary_calcs where id = 'c0c0c0c0-0000-0000-0000-000000000001'$$);
select tst.ok('Denetim kaydı yazıldı (payroll modülü)', (select count(*) >= 1 from audit_logs where table_name = 'salary_calcs'));
select tst.ok('audit_modul salary_calcs = payroll', app.audit_modul('salary_calcs') = 'payroll');
-- finans (payroll görür/ekler)
select set_config('request.jwt.claim.sub','22222222-2222-2222-2222-222222222222',false);
select tst.ok('Finans maaş kayıtlarını görür', (select count(*) = 1 from salary_calcs));
select tst.works('Finans personel ekleyebilir', $$insert into salary_calcs(id, full_name, net_salary) values ('c0c0c0c0-0000-0000-0000-000000000002','Veli Kaya',20000)$$);
-- satış (payroll yetkisi yok)
select set_config('request.jwt.claim.sub','33333333-3333-3333-3333-333333333333',false);
select tst.ok('Satış maaş kayıtlarını göremez', (select count(*) = 0 from salary_calcs));
select tst.fails('Satış maaş kaydı ekleyemez', $$insert into salary_calcs(full_name, net_salary) values ('Z', 1)$$);
-- başka kurum
select set_config('request.jwt.claim.sub','44444444-4444-4444-4444-444444444444',false);
select tst.ok('Başka kurum göremez', (select count(*) = 0 from salary_calcs));
update salary_calcs set net_salary = 1;
select tst.ok('Başka kurum güncelleyemez', (select count(*) = 0 from salary_calcs));
-- arşiv
select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false);
select tst.works('Silme = arşivleme', $$update salary_calcs set archived_at = now() where id = 'c0c0c0c0-0000-0000-0000-000000000002'$$);
reset role;
select tst.ok('Arşivli kayıt veritabanında durur', (select archived_at is not null from salary_calcs where id = 'c0c0c0c0-0000-0000-0000-000000000002'));
