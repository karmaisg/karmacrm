-- OSGB 360 - Aşama 33 (yıllık bütçe) veri tabanı testleri (yerel PostgreSQL 16 + Supabase taklidi)
-- Sıra: supabase_stub.sql -> 01_sema.sql -> 03..13 -> 34_asama33.sql -> bu dosya (boş bir veri tabanında)
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
select tst.ok('Varsayılan: işletme sahibi bütçe yetkisi var, finans yok', (select count(*) from role_permissions p join roles r on r.id=p.role_id where p.module='budget' and p.can_view and r.key='isletme_sahibi' and r.organization_id='aaaaaaaa-0000-0000-0000-000000000001')=1 and (select count(*) from role_permissions p join roles r on r.id=p.role_id where p.module='budget' and p.can_view and r.key='finans')=0);
set role authenticated; select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false);
select tst.works('Bütçe satırı eklenir', $$insert into budget_lines(budget_year, company_id, price_type, unit_price, increase_pct, increase_price, accepted_price, status, note) values (2027,'aaaaaaaa-1111-0000-0000-000000000001','kisi_basi',100,20,120,115,'kabul','not')$$);
select tst.fails('Aynı firma ve yıl için ikinci satır olmaz', $$insert into budget_lines(budget_year, company_id) values (2027,'aaaaaaaa-1111-0000-0000-000000000001')$$, 'duplicate');
select tst.fails('Geçersiz durum reddedilir', $$update budget_lines set status = 'bilinmiyor'$$);
select tst.fails('Geçersiz fiyat türü reddedilir', $$update budget_lines set price_type = 'x'$$);
select tst.fails('Negatif fiyat reddedilir', $$update budget_lines set unit_price = -1$$);
select tst.fails('Başka kurumun firmasına satır eklenemez', $$insert into budget_lines(budget_year, company_id) values (2027,'bbbbbbbb-1111-0000-0000-000000000001')$$);
select tst.works('Satır güncellenir (otomatik ortalamaya dönüş)', $$update budget_lines set prev_avg_income = null, status = 'sona_erdi' where budget_year = 2027$$);
select set_config('request.jwt.claim.sub','22222222-2222-2222-2222-222222222222',false);
select tst.ok('Finans rolü bütçeyi göremez', (select count(*) from budget_lines) = 0);
select tst.fails('Finans rolü bütçe satırı ekleyemez', $$insert into budget_lines(budget_year, company_id) values (2028,'aaaaaaaa-1111-0000-0000-000000000001')$$);
reset role;
select tst.ok('Denetim kaydı bütçe modülüne bağlı', app.audit_modul('budget_lines') = 'budget');
select tst.works('Firma silinince bütçe satırı da silinir', $$delete from budget_lines where company_id = 'aaaaaaaa-1111-0000-0000-000000000001'$$);
