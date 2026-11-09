-- OSGB 360 - Aşama 35 (personel gider tablosu, kategori eşleşmesi) veri tabanı testleri (yerel PostgreSQL 16 + Supabase taklidi)
-- Sıra: supabase_stub.sql -> 01_sema.sql -> 03..13 -> 36_asama35.sql -> bu dosya (boş bir veri tabanında)
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
-- ---------- Eski alt satırların taşınması (36_asama35.sql ikinci kez çalıştırılır) ----------
insert into budget_expense_lines(id, organization_id, budget_year, name, is_default, is_personnel, sort_order) values ('d0d0d0d0-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001',2027,'Personel Giderleri',true,true,20);
insert into budget_expense_lines(organization_id, budget_year, name, parent_id, prev_avg_expense, increase_pct, next_avg_expense) values ('aaaaaaaa-0000-0000-0000-000000000001',2027,'Ali Veli','d0d0d0d0-0000-0000-0000-000000000001',20000,50,30000);
\i supabase/36_asama35.sql
select tst.ok('Eski alt satır personel tablosuna taşındı', (select count(*) from budget_personnel_lines where full_name = 'Ali Veli' and prev_net = 20000 and next_net = 30000 and increase_pct = 50) = 1);
select tst.ok('Eski alt satır gider tablosundan kalktı', (select count(*) from budget_expense_lines where parent_id is not null) = 0 and (select count(*) from budget_expense_lines where is_default) = 1);
select tst.ok('Tekrar çalıştırmak çift kayıt üretmez', (select count(*) from budget_personnel_lines) = 1);

set role authenticated; select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false);
select tst.works('Personel eklenir', $$insert into budget_personnel_lines(budget_year, full_name, prev_net, prev_sgk, increase_pct, next_net, next_sgk) values (2027,'Ayşe Yılmaz',15000,6000,20,18000,7200)$$);
select tst.ok('Kurum otomatik atanır', (select count(*) from budget_personnel_lines where full_name = 'Ayşe Yılmaz' and organization_id = 'aaaaaaaa-0000-0000-0000-000000000001') = 1);
select tst.fails('Adsız personel reddedilir', $$insert into budget_personnel_lines(budget_year, full_name) values (2027,'  ')$$);
select tst.fails('Negatif maaş reddedilir', $$insert into budget_personnel_lines(budget_year, full_name, prev_net) values (2027,'X',-1)$$);
select tst.fails('Negatif SGK reddedilir', $$insert into budget_personnel_lines(budget_year, full_name, next_sgk) values (2027,'X',-1)$$);
select tst.fails('Geçersiz yıl reddedilir', $$insert into budget_personnel_lines(budget_year, full_name) values (1999,'X')$$);
select tst.works('Personel güncellenir', $$update budget_personnel_lines set prev_net = 16000, next_net = 19200 where full_name = 'Ayşe Yılmaz'$$);
select tst.ok('Güncelleme zamanı değişir', (select updated_at >= created_at from budget_personnel_lines where full_name = 'Ayşe Yılmaz'));
select tst.works('Kalem kategori eşleşmesi kaydedilir', $$update budget_expense_lines set category_ids = array['cccccccc-0000-0000-0000-000000000001'::uuid, 'cccccccc-0000-0000-0000-000000000002'::uuid] where id = 'd0d0d0d0-0000-0000-0000-000000000001'$$);
select tst.ok('Kategori eşleşmesi okunur', (select cardinality(category_ids) from budget_expense_lines where id = 'd0d0d0d0-0000-0000-0000-000000000001') = 2);
select tst.works('Personel silinir', $$delete from budget_personnel_lines where full_name = 'Ali Veli'$$);
select tst.ok('Silinen personel gitti', (select count(*) from budget_personnel_lines where full_name = 'Ali Veli') = 0 and (select count(*) from budget_personnel_lines) = 1);
select set_config('request.jwt.claim.sub','22222222-2222-2222-2222-222222222222',false);
select tst.ok('Finans rolü personel tablosunu göremez', (select count(*) from budget_personnel_lines) = 0);
select tst.fails('Finans rolü personel ekleyemez', $$insert into budget_personnel_lines(budget_year, full_name) values (2027,'Y')$$);
reset role;
select tst.ok('Denetim kaydı personel tablosunu bütçe modülüne bağlar', app.audit_modul('budget_personnel_lines') = 'budget' and app.audit_modul('budget_lines') = 'budget' and app.audit_modul('signed_contracts') = 'contracts');
select tst.ok('Denetim kaydı yazıldı', (select count(*) from audit_logs where table_name = 'budget_personnel_lines') >= 1);
select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false);
insert into budget_personnel_lines(organization_id, budget_year, full_name) values ('bbbbbbbb-0000-0000-0000-000000000002',2027,'Başka kurum');
set role authenticated;
select tst.ok('Başka kurumun personeli görünmez', (select count(*) from budget_personnel_lines where full_name = 'Başka kurum') = 0);
reset role;
