-- OSGB 360 - Aşama 18 (firma_sil, pasif firma) veri tabanı testleri (yerel PostgreSQL 16 + Supabase taklidi)
-- Sıra: supabase_stub.sql -> 01_sema.sql -> 03..13 -> 19_asama18.sql -> bu dosya (boş bir veri tabanında)
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

-- ---------------------------------------------------------------- kurulum: A firması (silinecek) ve B firması (kalacak)
insert into companies(id,organization_id,name,customer_status) values
 ('aaaaaaaa-1111-0000-0000-0000000000b1','aaaaaaaa-0000-0000-0000-000000000001','Beta Kalan','musteri'),
 ('aaaaaaaa-1111-0000-0000-0000000000c1','aaaaaaaa-0000-0000-0000-000000000001','Pasif Eski','eski_musteri');
insert into company_profiles(organization_id,company_id,employee_count,hazard_class,valid_from) values
 ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-1111-0000-0000-000000000001',20,'az_tehlikeli','2026-01-01'),
 ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-1111-0000-0000-0000000000b1',10,'az_tehlikeli','2026-01-01');
insert into company_sites(id,organization_id,company_id,sgk_no,site_name) values
 ('aaaaaaaa-2222-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-1111-0000-0000-000000000001','7777777777','Alfa Şube');
insert into contacts(id,organization_id,company_id,full_name) values
 ('aaaaaaaa-3333-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-1111-0000-0000-000000000001','Ali Kişi'),
 ('aaaaaaaa-3333-0000-0000-000000000002','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-1111-0000-0000-0000000000b1','Bora Kişi');
insert into sales_opportunities(id,organization_id,company_id,title) values
 ('aaaaaaaa-4444-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-1111-0000-0000-000000000001','Alfa fırsat');
insert into activities(organization_id,company_id,opportunity_id,kind,summary) values
 ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-1111-0000-0000-000000000001','aaaaaaaa-4444-0000-0000-000000000001','gorusme','Alfa görüşme');
insert into tasks(organization_id,company_id,title) values
 ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-1111-0000-0000-000000000001','Alfa görev'),
 ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-1111-0000-0000-0000000000b1','Beta görev');
insert into employees(id,organization_id,full_name,staff_type) values
 ('aaaaaaaa-5555-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001','Uzman U','is_guvenligi_uzmani');
insert into assignments(id,organization_id,company_id,employee_id,staff_type,share_pct,valid_from) values
 ('aaaaaaaa-6666-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-1111-0000-0000-000000000001','aaaaaaaa-5555-0000-0000-000000000001','is_guvenligi_uzmani',50,'2026-01-01'),
 ('aaaaaaaa-6666-0000-0000-000000000002','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-1111-0000-0000-0000000000b1','aaaaaaaa-5555-0000-0000-000000000001','is_guvenligi_uzmani',50,'2026-01-01');
insert into time_entries(organization_id,company_id,employee_id,activity_type,work_date,start_at,end_at,onsite_minutes) values
 ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-1111-0000-0000-000000000001','aaaaaaaa-5555-0000-0000-000000000001','ziyaret','2026-03-02','2026-03-02 09:00+03','2026-03-02 11:00+03',120),
 ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-1111-0000-0000-0000000000b1','aaaaaaaa-5555-0000-0000-000000000001','ziyaret','2026-03-02','2026-03-02 13:00+03','2026-03-02 14:00+03',60);
insert into offers(id,organization_id,company_id,offer_no,employee_count,hazard_class,pricing,fixed_monthly_price) values
 ('aaaaaaaa-7777-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-1111-0000-0000-000000000001','T-1',20,'az_tehlikeli','sabit_aylik',900);
insert into contracts(id,organization_id,company_id,start_date,end_date,status) values
 ('aaaaaaaa-8888-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-1111-0000-0000-000000000001','2026-01-01','2026-12-31','aktif'),
 ('aaaaaaaa-8888-0000-0000-000000000002','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-1111-0000-0000-0000000000b1','2026-01-01','2026-12-31','aktif'),
 ('aaaaaaaa-8888-0000-0000-000000000003','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-1111-0000-0000-0000000000c1','2026-01-01','2026-12-31','aktif');
insert into contract_prices(organization_id,contract_id,valid_from,pricing,fixed_monthly_price,vat_mode) values
 ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-8888-0000-0000-000000000001','2026-01-01','sabit_aylik',1000,'kdv_haric'),
 ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-8888-0000-0000-000000000002','2026-01-01','sabit_aylik',1000,'kdv_haric'),
 ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-8888-0000-0000-000000000003','2026-01-01','sabit_aylik',1000,'kdv_haric');
insert into invoices(id,organization_id,company_id,invoice_no,invoice_date,due_date,amount_excl_vat,vat_amount) values
 ('aaaaaaaa-9999-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-1111-0000-0000-000000000001','A-1','2026-02-01','2026-03-01',1000,200),
 ('aaaaaaaa-9999-0000-0000-000000000002','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-1111-0000-0000-0000000000b1','B-1','2026-02-01','2026-03-01',1000,200);
insert into invoice_items(organization_id,invoice_id,description,unit_price_excl,vat_rate) values
 ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-9999-0000-0000-000000000001','x',1000,20);
insert into payments(organization_id,invoice_id,paid_at,amount) values
 ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-9999-0000-0000-000000000001','2026-02-10',500);
insert into expenses(organization_id,company_id,expense_date,amount_excl_vat,vat_amount,category_id,cost_type,description)
 select 'aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-1111-0000-0000-000000000001','2026-02-10',100,20,id,'dogrudan','Alfa gider' from expense_categories where organization_id='aaaaaaaa-0000-0000-0000-000000000001' limit 1;
insert into calendar_items(organization_id,company_id,title,kind,start_date) values
 ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-1111-0000-0000-000000000001','Alfa hatırlatma','hatirlatma','2026-05-01');

-- ---------------------------------------------------------------- firma_sil
set role authenticated; select set_config('request.jwt.claim.sub','22222222-2222-2222-2222-222222222222',false);
select tst.fails('Satış rolü firma silemez', $$select public.firma_sil('aaaaaaaa-1111-0000-0000-000000000001','Alfa Gıda')$$, 'yetkisi');
select set_config('request.jwt.claim.sub','33333333-3333-3333-3333-333333333333',false);
select tst.fails('Finans rolü firma silemez', $$select public.firma_sil('aaaaaaaa-1111-0000-0000-000000000001','Alfa Gıda')$$, 'yetkisi');
select set_config('request.jwt.claim.sub','44444444-4444-4444-4444-444444444444',false);
select tst.fails('Başka kurumun sahibi bu firmayı silemez', $$select public.firma_sil('aaaaaaaa-1111-0000-0000-000000000001','Alfa Gıda')$$, 'bulunamadı');
select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false);
select tst.fails('Ad yanlış yazılırsa silinmez', $$select public.firma_sil('aaaaaaaa-1111-0000-0000-000000000001','Alfa')$$, 'doğru yazılmadı');
select tst.fails('Ad boşsa silinmez', $$select public.firma_sil('aaaaaaaa-1111-0000-0000-000000000001','')$$, 'doğru yazılmadı');
reset role;
select tst.ok('Hatalı denemelerde firma ve faturası duruyor', (select count(*) = 1 from companies where id = 'aaaaaaaa-1111-0000-0000-000000000001') and (select count(*) = 1 from invoices where invoice_no = 'A-1'));

-- pasif firma: aylık toplu faturada yer almaz
set role authenticated; select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false);
select tst.works('Aylık toplu fatura çalışır', $$select public.donem_faturalari_olustur('2026-04-01','2026-04-30',30)$$);
reset role;
select tst.ok('Aktif müşteriler için fatura üretildi (Alfa ve Beta)', (select count(*) = 2 from invoices where service_period = '2026-04-01'));
select tst.ok('Eski müşteri (pasif) firmaya fatura üretilmedi', (select count(*) = 0 from invoices where company_id = 'aaaaaaaa-1111-0000-0000-0000000000c1'));
update companies set customer_status = 'eski_musteri' where id = 'aaaaaaaa-1111-0000-0000-0000000000b1';
set role authenticated; select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false);
select tst.works('Mayıs için toplu fatura', $$select public.donem_faturalari_olustur('2026-05-01','2026-05-31',30)$$);
reset role;
select tst.ok('Pasife alınan Beta mayısta faturalanmadı, Alfa faturalandı', (select count(*) = 1 from invoices where service_period = '2026-05-01') and (select company_id = 'aaaaaaaa-1111-0000-0000-000000000001' from invoices where service_period = '2026-05-01'));
select tst.ok('Pasife alma kayıtları silmedi (Beta faturaları ve zaman kaydı duruyor)', (select count(*) >= 2 from invoices where company_id = 'aaaaaaaa-1111-0000-0000-0000000000b1') and (select count(*) = 1 from time_entries where company_id = 'aaaaaaaa-1111-0000-0000-0000000000b1'));
update companies set customer_status = 'musteri' where id = 'aaaaaaaa-1111-0000-0000-0000000000b1';

-- kalıcı silme
set role authenticated; select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false);
select tst.works('Sahip adı doğru yazarak siler', $$select public.firma_sil('aaaaaaaa-1111-0000-0000-000000000001','  Alfa Gıda ')$$);
reset role;
select tst.ok('Firma silindi', (select count(*) = 0 from companies where id = 'aaaaaaaa-1111-0000-0000-000000000001'));
select tst.ok('Fatura, kalem, tahsilat silindi', (select count(*) = 0 from invoices where company_id = 'aaaaaaaa-1111-0000-0000-000000000001') and (select count(*) = 0 from payments where invoice_id = 'aaaaaaaa-9999-0000-0000-000000000001') and (select count(*) = 0 from invoice_items where invoice_id = 'aaaaaaaa-9999-0000-0000-000000000001'));
select tst.ok('Sözleşme ve fiyat silindi', (select count(*) = 0 from contracts where id = 'aaaaaaaa-8888-0000-0000-000000000001') and (select count(*) = 0 from contract_prices where contract_id = 'aaaaaaaa-8888-0000-0000-000000000001'));
select tst.ok('Teklif, fırsat, görüşme, kişi, görev silindi', (select count(*) = 0 from offers where id = 'aaaaaaaa-7777-0000-0000-000000000001') and (select count(*) = 0 from sales_opportunities where id = 'aaaaaaaa-4444-0000-0000-000000000001') and (select count(*) = 0 from activities where summary = 'Alfa görüşme') and (select count(*) = 0 from contacts where id = 'aaaaaaaa-3333-0000-0000-000000000001') and (select count(*) = 0 from tasks where title = 'Alfa görev'));
select tst.ok('Görevlendirme, zaman kaydı, gider, işyeri, profil, takvim silindi', (select count(*) = 0 from assignments where id = 'aaaaaaaa-6666-0000-0000-000000000001') and (select count(*) = 0 from time_entries where company_id = 'aaaaaaaa-1111-0000-0000-000000000001') and (select count(*) = 0 from expenses where description = 'Alfa gider') and (select count(*) = 0 from company_sites where id = 'aaaaaaaa-2222-0000-0000-000000000001') and (select count(*) = 0 from company_profiles where company_id = 'aaaaaaaa-1111-0000-0000-000000000001') and (select count(*) = 0 from calendar_items where title = 'Alfa hatırlatma'));
select tst.ok('Diğer firmanın kayıtları dokunulmadı', (select count(*) = 1 from contacts where id = 'aaaaaaaa-3333-0000-0000-000000000002') and (select count(*) = 1 from tasks where title = 'Beta görev') and (select count(*) = 1 from assignments where id = 'aaaaaaaa-6666-0000-0000-000000000002') and (select count(*) = 1 from time_entries where company_id = 'aaaaaaaa-1111-0000-0000-0000000000b1' and onsite_minutes = 60) and (select count(*) >= 1 from invoices where invoice_no = 'B-1'));
select tst.ok('Silme denetim kaydına yazıldı', (select count(*) = 1 and bool_and((new_data -> 'silinen_kayit_sayilari' ->> 'fatura')::int = 3) from audit_logs where action = 'DELETE' and table_name = 'companies' and old_data ->> 'name' = 'Alfa Gıda'));
