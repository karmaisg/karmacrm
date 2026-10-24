-- OSGB 360 - Veri tabanı düzeyi testler (yerel PostgreSQL 16 + Supabase taklidi)
-- Kapsar: Test 3 (mükerrer süre), 5 (kısmi tahsilat), 6 (çift gider), 9 (tarihçe), 11 (kurum/yetki izolasyonu), 12 (mükerrer kayıt - DB kısmı)
\set ON_ERROR_STOP off
create schema tst;
grant usage on schema tst to authenticated, anon;

create function tst.ok(label text, cond boolean) returns void language plpgsql as $$
begin
  if cond is true then raise notice 'PASS | %', label; else raise notice 'FAIL | %', label; end if;
end $$;

-- stmt çalıştırılır; HATA vermesi beklenir
create function tst.fails(label text, stmt text) returns void language plpgsql as $$
begin
  begin
    execute stmt;
    raise notice 'FAIL | % (hata beklenirdi, ama işlem başarılı oldu)', label;
  exception when others then
    if sqlerrm like '%does not exist%' then
      raise notice 'FAIL | % (test geçersiz: %)', label, sqlerrm;
    else
      raise notice 'PASS | % [%]', label, left(sqlerrm, 90);
    end if;
  end;
end $$;

-- stmt çalıştırılır; BAŞARILI olması beklenir
create function tst.works(label text, stmt text) returns void language plpgsql as $$
begin
  begin
    execute stmt;
    raise notice 'PASS | %', label;
  exception when others then
    raise notice 'FAIL | % [%]', label, sqlerrm;
  end;
end $$;
grant execute on all functions in schema tst to authenticated;

-- ---------- Kurulum (superuser; RLS atlanır) ----------
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

insert into users(id,organization_id,role_id,full_name)
select '11111111-1111-1111-1111-111111111111', organization_id, id, 'Sahip'   from roles where key='isletme_sahibi' and organization_id='aaaaaaaa-0000-0000-0000-000000000001';
insert into users(id,organization_id,role_id,full_name)
select '22222222-2222-2222-2222-222222222222', organization_id, id, 'Satışçı' from roles where key='satis'          and organization_id='aaaaaaaa-0000-0000-0000-000000000001';
insert into users(id,organization_id,role_id,full_name)
select '33333333-3333-3333-3333-333333333333', organization_id, id, 'Finansçı' from roles where key='finans'        and organization_id='aaaaaaaa-0000-0000-0000-000000000001';
insert into users(id,organization_id,role_id,full_name)
select '44444444-4444-4444-4444-444444444444', organization_id, id, 'Yabancı' from roles where key='isletme_sahibi' and organization_id='bbbbbbbb-0000-0000-0000-000000000002';

-- Başka kurumun verisi (Test 11 için)
insert into companies(id,organization_id,name,tax_no) values
 ('bbbbbbbb-1111-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000002','Yabancı Firma','9999999999');

-- ---------- Sahip olarak işlemler ----------
set role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false);

select tst.works('Sahip firma ekleyebilir (organization_id otomatik atanır)',
  $$insert into companies(id,name,tax_no) values ('cccccccc-0000-0000-0000-000000000001','Atlas Yapı','1111111111')$$);
select tst.fails('Test 12 (DB): aynı vergi numarasıyla ikinci firma açılamaz',
  $$insert into companies(name,tax_no) values ('Atlas Yapı Kopya','1111111111')$$);
select tst.works('İkinci firma eklenebilir',
  $$insert into companies(id,name,tax_no) values ('cccccccc-0000-0000-0000-000000000002','Toros Yapı','2222222222')$$);

-- Test 9: çalışan sayısı geçmişi
select tst.works('Firma profili ocak-mart: 30 çalışan / tehlikeli',
  $$insert into company_profiles(company_id,employee_count,hazard_class,valid_from,valid_to) values ('cccccccc-0000-0000-0000-000000000001',30,'tehlikeli','2026-01-01','2026-03-31')$$);
select tst.works('Nisan ve sonrası: 45 çalışan (yeni satır, eskisi değişmez)',
  $$insert into company_profiles(company_id,employee_count,hazard_class,valid_from) values ('cccccccc-0000-0000-0000-000000000001',45,'tehlikeli','2026-04-01')$$);
select tst.fails('Çakışan profil dönemi reddedilir',
  $$insert into company_profiles(company_id,employee_count,hazard_class,valid_from,valid_to) values ('cccccccc-0000-0000-0000-000000000001',50,'tehlikeli','2026-03-15','2026-05-01')$$);
select tst.ok('Test 9: ocak ayı için hâlâ 30 çalışan görünüyor',
  (select employee_count from company_profiles where company_id='cccccccc-0000-0000-0000-000000000001' and '2026-01-15'::date between valid_from and coalesce(valid_to,'infinity')) = 30);

-- Test 3: aynı firmaya iki uzman -> paylar %100'ü aşamaz
reset role;
insert into employees(id,organization_id,full_name,staff_type) values
 ('eeeeeeee-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001','Uzman 1','is_guvenligi_uzmani'),
 ('eeeeeeee-0000-0000-0000-000000000002','aaaaaaaa-0000-0000-0000-000000000001','Uzman 2','is_guvenligi_uzmani');
set role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false);
select tst.works('Uzman 1 firmaya %60 pay ile atanır',
  $$insert into assignments(company_id,employee_id,staff_type,share_pct,valid_from) values ('cccccccc-0000-0000-0000-000000000001','eeeeeeee-0000-0000-0000-000000000001','is_guvenligi_uzmani',60,'2026-01-01')$$);
select tst.works('Uzman 2 aynı firmaya %40 pay ile atanır (toplam %100)',
  $$insert into assignments(company_id,employee_id,staff_type,share_pct,valid_from) values ('cccccccc-0000-0000-0000-000000000001','eeeeeeee-0000-0000-0000-000000000002','is_guvenligi_uzmani',40,'2026-01-01')$$);
select tst.fails('Test 3: toplam pay %100''ü aşan üçüncü atama reddedilir (süre mükerrer sayılmaz)',
  $$insert into assignments(company_id,employee_id,staff_type,share_pct,valid_from) values ('cccccccc-0000-0000-0000-000000000001','eeeeeeee-0000-0000-0000-000000000001','is_guvenligi_uzmani',10,'2026-02-01')$$);

-- Zaman çakışması
select tst.works('Zaman kaydı eklenir',
  $$insert into time_entries(employee_id,company_id,activity_type,work_date,start_at,end_at,onsite_minutes,travel_minutes) values ('eeeeeeee-0000-0000-0000-000000000001','cccccccc-0000-0000-0000-000000000001','Saha ziyareti','2026-10-01','2026-10-01 09:00+03','2026-10-01 11:00+03',90,30)$$);
select tst.fails('Aynı personelde çakışan zaman kaydı reddedilir',
  $$insert into time_entries(employee_id,company_id,activity_type,work_date,start_at,end_at,onsite_minutes) values ('eeeeeeee-0000-0000-0000-000000000001','cccccccc-0000-0000-0000-000000000002','Saha ziyareti','2026-10-01','2026-10-01 10:30+03','2026-10-01 12:00+03',60)$$);
select tst.fails('Alt süreler toplam süreyi aşamaz',
  $$insert into time_entries(employee_id,company_id,activity_type,work_date,start_at,end_at,onsite_minutes) values ('eeeeeeee-0000-0000-0000-000000000002','cccccccc-0000-0000-0000-000000000002','Saha','2026-10-02','2026-10-02 09:00+03','2026-10-02 10:00+03',120)$$);

-- Test 5: kısmi tahsilat
select tst.works('Fatura 12.000 + 2.400 KDV = 14.400 eklenir',
  $$insert into invoices(id,company_id,invoice_no,invoice_date,due_date,amount_excl_vat,vat_amount) values ('f0000000-0000-0000-0000-000000000001','cccccccc-0000-0000-0000-000000000001','TST-0001','2026-09-01','2026-09-30',12000,2400)$$);
select tst.works('1. kısmi tahsilat 5.000', $$insert into payments(invoice_id,paid_at,amount) values ('f0000000-0000-0000-0000-000000000001','2026-10-05',5000)$$);
select tst.works('2. kısmi tahsilat 3.400', $$insert into payments(invoice_id,paid_at,amount) values ('f0000000-0000-0000-0000-000000000001','2026-10-10',3400)$$);
select tst.ok('Test 5: toplam KDV dahil 14.400, tahsil 8.400, kalan 6.000',
  (select amount_incl_vat = 14400 and paid_total = 8400 and balance = 6000 and collection_status = 'kismi_tahsilat' from invoice_balances where invoice_id='f0000000-0000-0000-0000-000000000001'));
select tst.works('Kalan 6.000 tahsil edilir', $$insert into payments(invoice_id,paid_at,amount) values ('f0000000-0000-0000-0000-000000000001','2026-10-15',6000)$$);
select tst.ok('Tamamı ödenince durum tahsil_edildi, kalan 0',
  (select balance = 0 and collection_status = 'tahsil_edildi' from invoice_balances where invoice_id='f0000000-0000-0000-0000-000000000001'));
select tst.works('Fazla tahsilat kaydedilebilir (uyarı olarak işaretlenir, engellenmez)', $$insert into payments(invoice_id,paid_at,amount) values ('f0000000-0000-0000-0000-000000000001','2026-10-16',100)$$);
select tst.ok('Fazla tahsilatta overpaid=true',
  (select overpaid from invoice_balances where invoice_id='f0000000-0000-0000-0000-000000000001'));

-- Test 6: doğrudan gider ortak giderden ikinci kez düşülmez
select tst.works('Ortak gider (Kira 10.000) eklenir',
  $$insert into expenses(category_id,expense_date,amount_excl_vat,vat_amount,cost_type,description) select id,'2026-10-03',10000,2000,'ortak','Ekim kirası' from expense_categories where name='Kira'$$);
select tst.works('Doğrudan gider (Araç yakıtı, Atlas Yapı için 3.000) eklenir',
  $$insert into expenses(category_id,expense_date,amount_excl_vat,vat_amount,cost_type,company_id) select id,'2026-10-04',3000,600,'dogrudan','cccccccc-0000-0000-0000-000000000001' from expense_categories where name='Araç yakıtı'$$);
select tst.fails('Doğrudan gider firma/personel olmadan kaydedilemez',
  $$insert into expenses(category_id,expense_date,amount_excl_vat,cost_type) select id,'2026-10-04',500,'dogrudan' from expense_categories where name='Ofis giderleri'$$);
select tst.works('Kira havuzundan 6.000 dağıtılır',
  $$insert into overhead_allocations(period,category_id,company_id,basis,amount) select '2026-10-01',id,'cccccccc-0000-0000-0000-000000000001','gelir_orani',6000 from expense_categories where name='Kira'$$);
select tst.fails('Kira havuzunu (10.000) aşan dağıtım reddedilir',
  $$insert into overhead_allocations(period,category_id,company_id,basis,amount) select '2026-10-01',id,'cccccccc-0000-0000-0000-000000000002','gelir_orani',4500 from expense_categories where name='Kira'$$);
select tst.fails('Test 6: doğrudan giderin kategorisinde ortak havuz yok -> dağıtım yapılamaz (çift sayım engeli)',
  $$insert into overhead_allocations(period,category_id,company_id,basis,amount) select '2026-10-01',id,'cccccccc-0000-0000-0000-000000000002','fiili_sure',3000 from expense_categories where name='Araç yakıtı'$$);
select tst.works('Havuzun kalanı (4.000) dağıtılabilir',
  $$insert into overhead_allocations(period,category_id,company_id,basis,amount) select '2026-10-01',id,'cccccccc-0000-0000-0000-000000000002','gelir_orani',4000 from expense_categories where name='Kira'$$);

-- Maaş gideri (hassas)
select tst.works('Uzman maaşı gideri eklenir (hassas kategori)',
  $$insert into expenses(category_id,expense_date,amount_excl_vat,cost_type,employee_id) select id,'2026-10-01',45000,'dogrudan','eeeeeeee-0000-0000-0000-000000000001' from expense_categories where name='Uzman maaşları'$$);

-- Denetim ve arşiv
select tst.ok('Denetim kaydı oluşuyor', (select count(*) from audit_logs) > 0);
select tst.works('Sahip firmayı arşivleyebilir (yetkisi var)',
  $$update companies set archived_at = now() where id='cccccccc-0000-0000-0000-000000000002'$$);
select tst.ok('Arşivleyen kullanıcı kaydedildi',
  (select archived_by = '11111111-1111-1111-1111-111111111111' from companies where id='cccccccc-0000-0000-0000-000000000002'));
select tst.fails('Fiziksel silme yasak', $$delete from companies where id='cccccccc-0000-0000-0000-000000000001'$$);
select tst.fails('Denetim kaydı değiştirilemez', $$update audit_logs set action='X'$$);

-- ---------- Test 11: kurum izolasyonu ----------
select set_config('request.jwt.claim.sub','44444444-4444-4444-4444-444444444444',false);
select tst.ok('Test 11: Başka kurumun kullanıcısı bizim firmaları göremiyor',
  (select count(*) from companies where organization_id='aaaaaaaa-0000-0000-0000-000000000001') = 0);
select tst.ok('Yabancı kullanıcı yalnızca kendi firmasını görüyor', (select count(*) from companies) = 1);
select tst.fails('Test 11: Başka kurum adına kayıt eklenemez',
  $$insert into companies(organization_id,name) values ('aaaaaaaa-0000-0000-0000-000000000001','Sızma denemesi')$$);
select tst.ok('Başka kurumun faturaları görünmüyor', (select count(*) from invoices) = 0);
select tst.ok('Başka kurumun personel/gider kayıtları görünmüyor', (select count(*) from expenses) = 0);

-- ---------- Rol bazlı yetki ----------
select set_config('request.jwt.claim.sub','22222222-2222-2222-2222-222222222222',false);
select tst.ok('Satış sorumlusu firmaları görebilir', (select count(*) from companies where archived_at is null) >= 1);
select tst.ok('Satış sorumlusu faturaları göremez (finansal veri)', (select count(*) from invoices) = 0);
select tst.ok('Satış sorumlusu giderleri göremez', (select count(*) from expenses) = 0);
select tst.ok('Satış sorumlusu personel maliyetini göremez', (select count(*) from employee_costs) = 0);
select tst.fails('Satış sorumlusu fatura ekleyemez',
  $$insert into invoices(company_id,invoice_no,invoice_date,due_date,amount_excl_vat,vat_amount) values ('cccccccc-0000-0000-0000-000000000001','HACK-1','2026-10-01','2026-10-30',1,0)$$);
select tst.works('Satış sorumlusu potansiyel müşteri ekleyebilir',
  $$insert into leads(name,tax_no) values ('Aday A.Ş.','5555555555')$$);
select tst.fails('Satış sorumlusu firma arşivleyemez (arşiv yetkisi yok)',
  $$update companies set archived_at = now() where id='cccccccc-0000-0000-0000-000000000001'$$);

select set_config('request.jwt.claim.sub','33333333-3333-3333-3333-333333333333',false);
select tst.ok('Finans sorumlusu faturaları görebilir', (select count(*) from invoices) = 1);
select tst.ok('Finans sorumlusu maaş giderini görebilir (payroll yetkisi var)',
  (select count(*) from expenses e join expense_categories c on c.id=e.category_id where c.is_payroll) = 1);
select tst.ok('Finans sorumlusu potansiyel müşteri (CRM) kayıtlarını göremez', (select count(*) from leads) = 0);

-- Maaş görünürlüğü: payroll yetkisi kaldırılınca finans de maaş giderini göremez (kategori RLS'e takılmadan kontrol edilir)
reset role;
update role_permissions set can_view=false where module='payroll' and role_id=(select id from roles where key='finans' and organization_id='aaaaaaaa-0000-0000-0000-000000000001');
set role authenticated;
select set_config('request.jwt.claim.sub','33333333-3333-3333-3333-333333333333',false);
select tst.ok('Payroll yetkisi yokken maaş gideri görünmüyor, diğer giderler görünüyor',
  (select count(*) from expenses e where app.is_payroll_category(e.category_id)) = 0 and (select count(*) from expenses) = 2);
reset role;
update role_permissions set can_view=true where module='payroll' and role_id=(select id from roles where key='finans' and organization_id='aaaaaaaa-0000-0000-0000-000000000001');

-- Girişsiz (anon) erişim
reset role;
set role anon;
select tst.fails('Girişsiz kullanıcı firma listesini okuyamaz', $$select * from companies$$);
reset role;

-- Seed doğrulaması
select tst.ok('Seed: 6 rol x 21 modül = 126 yetki satırı / kurum',
  (select count(*) from role_permissions rp join roles r on r.id=rp.role_id where r.organization_id='aaaaaaaa-0000-0000-0000-000000000001') = 126);
select tst.ok('Seed: 6 hizmet süresi kuralı', (select count(*) from service_time_rules where organization_id='aaaaaaaa-0000-0000-0000-000000000001') = 6);
select tst.ok('Seed: 17 gider kategorisi', (select count(*) from expense_categories where organization_id='aaaaaaaa-0000-0000-0000-000000000001') = 17);
select tst.fails('Hizmet süresi kuralı dönemleri çakışamaz',
  $$insert into service_time_rules(organization_id,staff_type,hazard_class,minutes_per_employee,valid_from) values ('aaaaaaaa-0000-0000-0000-000000000001','is_guvenligi_uzmani','tehlikeli',25,'2026-01-01')$$);
