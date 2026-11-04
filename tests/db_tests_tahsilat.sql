-- OSGB 360 - supabase/21_toplu_tahsilat_tek_sefer.sql testi (ana şemalar yüklendikten sonra boş veri tabanında)
\set ON_ERROR_STOP off
create schema tst;
create function tst.ok(label text, cond boolean) returns void language plpgsql as $$
begin if cond is true then raise notice 'PASS | %', label; else raise notice 'FAIL | %', label; end if; end $$;

insert into organizations(id,name) values ('dddddddd-0000-0000-0000-000000000001','Karma OSGB');
select app.seed_organization('dddddddd-0000-0000-0000-000000000001');
insert into companies(id,organization_id,name,customer_status) values ('cccccccc-0000-0000-0000-000000000001','dddddddd-0000-0000-0000-000000000001','Alfa','musteri');
insert into invoices(id,organization_id,company_id,invoice_no,invoice_date,due_date,amount_excl_vat,vat_amount) values
 ('10000000-0000-0000-0000-000000000001','dddddddd-0000-0000-0000-000000000001','cccccccc-0000-0000-0000-000000000001','EAR-001','2026-03-01','2026-03-31',1000,200),
 ('10000000-0000-0000-0000-000000000002','dddddddd-0000-0000-0000-000000000001','cccccccc-0000-0000-0000-000000000001','EAR-008','2026-03-01','2026-03-31',1000,200),
 ('10000000-0000-0000-0000-000000000003','dddddddd-0000-0000-0000-000000000001','cccccccc-0000-0000-0000-000000000001','eft-053 ','2026-03-01','2026-03-31',500,0),
 ('10000000-0000-0000-0000-000000000004','dddddddd-0000-0000-0000-000000000001','cccccccc-0000-0000-0000-000000000001','EFT-777','2026-04-01','2026-05-01',1000,200),
 ('10000000-0000-0000-0000-000000000005','dddddddd-0000-0000-0000-000000000001','cccccccc-0000-0000-0000-000000000001','F-2026-0001','2026-04-01','2026-05-01',1000,200);
insert into payments(organization_id,invoice_id,paid_at,amount) values ('dddddddd-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000004','2026-04-10',400);

\i supabase/21_toplu_tahsilat_tek_sefer.sql

select tst.ok('Listede olmayan EAR-001 tamamen tahsil edildi', (select balance = 0 from invoice_balances where invoice_no = 'EAR-001'));
select tst.ok('Listedeki EAR-008 açık kaldı', (select balance = 1200 from invoice_balances where invoice_no = 'EAR-008'));
select tst.ok('Listedeki eft-053 (küçük harf/boşluk) açık kaldı', (select balance = 500 from invoice_balances where invoice_no like 'eft-053%'));
select tst.ok('Kısmi ödenmiş EFT-777 bakiye kadar kapandı (toplam 1200)', (select balance = 0 and paid_total = 1200 from invoice_balances where invoice_no = 'EFT-777'));
select tst.ok('EAR-/EFT- dışı F-2026-0001 açık kaldı', (select balance = 1200 from invoice_balances where invoice_no = 'F-2026-0001'));
select tst.ok('Tahsilat tarihi fatura tarihi, notu işaretli', (select paid_at = '2026-03-01' and notes like 'Toplu işaretleme%' from payments where invoice_id = '10000000-0000-0000-0000-000000000001'));
\i supabase/21_toplu_tahsilat_tek_sefer.sql
select tst.ok('İkinci çalıştırma yeni tahsilat eklemez', (select count(*) = 3 from payments));
