-- OSGB 360 - Aşama 34 (bütçe gider tablosu, kendi gelir satırı) veri tabanı testleri (yerel PostgreSQL 16 + Supabase taklidi)
-- Sıra: supabase_stub.sql -> 01_sema.sql -> 03..13 -> 35_asama34.sql -> bu dosya (boş bir veri tabanında)
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
set role authenticated; select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false);
select tst.works('Kendi gelir satırı (firmasız) eklenir', $$insert into budget_lines(budget_year, custom_name, price_type, prev_avg_income, expected_manual) values (2027,'Eğitim geliri','sabit',1000,1500)$$);
select tst.fails('Firmasız ve adsız satır reddedilir', $$insert into budget_lines(budget_year) values (2027)$$, 'hedef_check');
select tst.fails('Geçersiz yeni fiyat türü reddedilir', $$insert into budget_lines(budget_year, company_id, next_price_type) values (2027,'aaaaaaaa-1111-0000-0000-000000000001','x')$$);
select tst.works('Firma satırı yeni fiyat türü ve elle beklenen gelirle kaydedilir', $$insert into budget_lines(budget_year, company_id, next_price_type, expected_manual) values (2027,'aaaaaaaa-1111-0000-0000-000000000001','kisi_basi',3000)$$);
select tst.works('Firmasız satır silinebilir', $$delete from budget_lines where custom_name = 'Eğitim geliri'$$);
select tst.fails('Firmalı satır silinemez (RLS)', $$with d as (delete from budget_lines where company_id is not null returning 1) select case when count(*) = 0 then 1/0 end from d$$, 'division by zero');
-- gider tablosu
select tst.works('Hazır gider kalemi eklenir', $$insert into budget_expense_lines(id, budget_year, name, is_default, is_personnel, sort_order) values ('d0d0d0d0-0000-0000-0000-000000000001', 2027, 'Personel Giderleri', true, true, 20)$$);
select tst.works('Personel kalemi altına isim eklenir', $$insert into budget_expense_lines(id, budget_year, name, parent_id, prev_avg_expense, increase_pct, next_avg_expense) values ('d0d0d0d0-0000-0000-0000-000000000002', 2027, 'Ali Veli', 'd0d0d0d0-0000-0000-0000-000000000001', 20000, 50, 30000)$$);
select tst.works('Kendi gider kalemi eklenir', $$insert into budget_expense_lines(id, budget_year, name, sort_order) values ('d0d0d0d0-0000-0000-0000-000000000003', 2027, 'Sigorta', 500)$$);
select tst.fails('Personel dışı kalemin altına satır eklenemez', $$insert into budget_expense_lines(budget_year, name, parent_id) values (2027,'X','d0d0d0d0-0000-0000-0000-000000000003')$$, 'Personel Giderleri');
select tst.fails('Negatif gider reddedilir', $$update budget_expense_lines set prev_avg_expense = -5 where name = 'Sigorta'$$);
select tst.works('Gider güncellenir', $$update budget_expense_lines set prev_avg_expense = 500, increase_pct = 10, next_avg_expense = 550 where name = 'Sigorta'$$);
select tst.fails('Hazır kalem silinemez', $$with d as (delete from budget_expense_lines where is_default returning 1) select case when count(*) = 0 then 1/0 end from d$$, 'division by zero');
select tst.ok('Hazır kalem ve firmalı satır hâlâ duruyor', (select count(*) from budget_expense_lines where is_default) = 1 and (select count(*) from budget_lines where company_id is not null) = 1);
select tst.works('Kendi eklenen kalem silinir', $$delete from budget_expense_lines where name = 'Sigorta'$$);
select set_config('request.jwt.claim.sub','22222222-2222-2222-2222-222222222222',false);
select tst.ok('Finans rolü gider tablosunu göremez', (select count(*) from budget_expense_lines) = 0);
select tst.fails('Finans rolü gider satırı ekleyemez', $$insert into budget_expense_lines(budget_year, name) values (2027,'Y')$$);
reset role;
select tst.ok('Denetim kaydı gider tablosunu bütçe modülüne bağlar', app.audit_modul('budget_expense_lines') = 'budget');
select tst.works('Personel kalemi silinince altındakiler de silinir (cascade)', $$delete from budget_expense_lines where id = 'd0d0d0d0-0000-0000-0000-000000000001'$$);
select tst.ok('Alt satır da gitti', (select count(*) from budget_expense_lines where name = 'Ali Veli') = 0);
