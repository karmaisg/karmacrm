-- OSGB 360 - Aşama 5 veri tabanı testleri (yerel PostgreSQL 16 + Supabase taklidi)
-- Sıra: supabase_stub.sql -> 01_sema.sql -> 03_asama2.sql -> 04_asama3.sql -> 05_asama4.sql -> 06_asama5.sql -> bu dosya (boş bir veri tabanında)
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
 ('55555555-5555-5555-5555-555555555555','uzman@karma.test'),
 ('56565656-5656-5656-5656-565656565656','operasyon@karma.test'),
 ('57575757-5757-5757-5757-575757575757','uzman2@karma.test'),
 ('44444444-4444-4444-4444-444444444444','yabanci@baska.test');

insert into users(id,organization_id,role_id,full_name,email)
select u.id, r.organization_id, r.id, u.ad, u.eposta
from (values
  ('11111111-1111-1111-1111-111111111111'::uuid,'isletme_sahibi','aaaaaaaa-0000-0000-0000-000000000001'::uuid,'Sahip','sahip@karma.test'),
  ('22222222-2222-2222-2222-222222222222','satis','aaaaaaaa-0000-0000-0000-000000000001','Satışçı','satis@karma.test'),
  ('33333333-3333-3333-3333-333333333333','finans','aaaaaaaa-0000-0000-0000-000000000001','Finansçı','finans@karma.test'),
  ('55555555-5555-5555-5555-555555555555','uzman_hekim','aaaaaaaa-0000-0000-0000-000000000001','Uzman','uzman@karma.test'),
  ('56565656-5656-5656-5656-565656565656','operasyon','aaaaaaaa-0000-0000-0000-000000000001','Operasyoncu','operasyon@karma.test'),
  ('57575757-5757-5757-5757-575757575757','uzman_hekim','aaaaaaaa-0000-0000-0000-000000000001','Uzman İki','uzman2@karma.test'),
  ('44444444-4444-4444-4444-444444444444','isletme_sahibi','bbbbbbbb-0000-0000-0000-000000000002','Yabancı','yabanci@baska.test')
) as u(id,rol,org,ad,eposta)
join roles r on r.key = u.rol and r.organization_id = u.org;

insert into companies(id,organization_id,name,tax_no) values
 ('aaaaaaaa-1111-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001','Demir Çelik A.Ş.','1111111111'),
 ('aaaaaaaa-1111-0000-0000-000000000002','aaaaaaaa-0000-0000-0000-000000000001','Ay Gıda Ltd.','2222222222'),
 ('bbbbbbbb-1111-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000002','Yabancı Firma','9999999999');
insert into employees(id,organization_id,full_name,staff_type) values
 ('bbbbbbbb-5555-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000002','Yabancı Uzman','is_guvenligi_uzmani');

-- =====================================================================
-- A) Personel (operasyon)
-- =====================================================================
set role authenticated;
select set_config('request.jwt.claim.sub','56565656-5656-5656-5656-565656565656',false);

select tst.works('Operasyon: uzman kaydı açar',
  $$insert into employees(id,full_name,staff_type,monthly_capacity_min) values ('aaaaaaaa-5555-0000-0000-000000000001','  Ayşe Uzman  ','is_guvenligi_uzmani',11700)$$);
select tst.ok('Ad soyad kırpılır', (select full_name = 'Ayşe Uzman' from employees where id='aaaaaaaa-5555-0000-0000-000000000001'));
select tst.works('Operasyon: hekim kaydı açar',
  $$insert into employees(id,full_name,staff_type) values ('aaaaaaaa-5555-0000-0000-000000000002','Dr. Mehmet Hekim','isyeri_hekimi')$$);
select tst.works('İkinci uzman', $$insert into employees(id,full_name,staff_type) values ('aaaaaaaa-5555-0000-0000-000000000003','Can Uzman','is_guvenligi_uzmani')$$);
select tst.fails('Boş ad reddedilir', $$insert into employees(full_name,staff_type) values ('   ','is_guvenligi_uzmani')$$, 'Ad soyad');
select tst.fails('Ayrılış tarihi başlangıçtan önce olamaz',
  $$insert into employees(full_name,staff_type,start_date,end_date) values ('Hatalı','isyeri_hekimi','2026-05-01','2026-04-01')$$, 'Ayrılış');
select tst.fails('Kapasite sıfır olamaz', $$insert into employees(full_name,staff_type,monthly_capacity_min) values ('Hatalı','isyeri_hekimi',0)$$, 'check');
select tst.ok('Uzman/hekim kayıtları listelenir', (select count(*) = 3 from employees));

-- =====================================================================
-- B) Görevlendirme
-- =====================================================================
select tst.works('Uzman, Demir Çelik''e %60 payla görevlendirilir',
  $$insert into assignments(id,company_id,employee_id,staff_type,share_pct,valid_from) values
    ('aaaaaaaa-6666-0000-0000-000000000001','aaaaaaaa-1111-0000-0000-000000000001','aaaaaaaa-5555-0000-0000-000000000001','is_guvenligi_uzmani',60,current_date-30)$$);
select tst.works('İkinci uzman aynı firmada %40 alır (toplam 100)',
  $$insert into assignments(id,company_id,employee_id,staff_type,share_pct,valid_from) values
    ('aaaaaaaa-6666-0000-0000-000000000002','aaaaaaaa-1111-0000-0000-000000000001','aaaaaaaa-5555-0000-0000-000000000003','is_guvenligi_uzmani',40,current_date-30)$$);
select tst.fails('Aynı firmada uzman payları %100''ü aşamaz',
  $$insert into assignments(company_id,employee_id,staff_type,share_pct,valid_from) values
    ('aaaaaaaa-1111-0000-0000-000000000001','aaaaaaaa-5555-0000-0000-000000000003','is_guvenligi_uzmani',10,current_date+10)$$, 'aşıyor');
select tst.works('Hekim aynı firmada ayrı hizmet türü olarak %100 alabilir',
  $$insert into assignments(id,company_id,employee_id,staff_type,share_pct,valid_from) values
    ('aaaaaaaa-6666-0000-0000-000000000003','aaaaaaaa-1111-0000-0000-000000000001','aaaaaaaa-5555-0000-0000-000000000002','isyeri_hekimi',100,current_date-30)$$);
select tst.fails('Görevlendirme türü personelin türüyle uyuşmalı',
  $$insert into assignments(company_id,employee_id,staff_type,share_pct,valid_from) values
    ('aaaaaaaa-1111-0000-0000-000000000002','aaaaaaaa-5555-0000-0000-000000000001','isyeri_hekimi',100,current_date)$$, 'aynı olmalıdır');
select tst.fails('Aynı personel aynı firmada çakışan dönemde tekrar görevlendirilemez',
  $$insert into assignments(company_id,employee_id,staff_type,share_pct,valid_from) values
    ('aaaaaaaa-1111-0000-0000-000000000001','aaaaaaaa-5555-0000-0000-000000000001','is_guvenligi_uzmani',5,current_date)$$);
select tst.fails('Pay 100''ü aşamaz', $$insert into assignments(company_id,employee_id,staff_type,share_pct,valid_from) values
    ('aaaaaaaa-1111-0000-0000-000000000002','aaaaaaaa-5555-0000-0000-000000000001','is_guvenligi_uzmani',101,current_date)$$, '100');
select tst.fails('Yabancı kurumun personeli görevlendirilemez',
  $$insert into assignments(company_id,employee_id,staff_type,share_pct,valid_from) values
    ('aaaaaaaa-1111-0000-0000-000000000002','bbbbbbbb-5555-0000-0000-000000000001','is_guvenligi_uzmani',100,current_date)$$, 'kuruma ait değil');
select tst.fails('Yabancı kurumun firmasına görevlendirme yapılamaz',
  $$insert into assignments(company_id,employee_id,staff_type,share_pct,valid_from) values
    ('bbbbbbbb-1111-0000-0000-000000000001','aaaaaaaa-5555-0000-0000-000000000001','is_guvenligi_uzmani',100,current_date)$$, 'kuruma ait değil');
select tst.fails('Başlamış görevlendirmenin payı doğrudan değiştirilemez',
  $$update assignments set share_pct=50 where id='aaaaaaaa-6666-0000-0000-000000000001'$$, 'değiştirilemez');
select tst.fails('Başlamış görevlendirmenin firması değiştirilemez',
  $$update assignments set company_id='aaaaaaaa-1111-0000-0000-000000000002' where id='aaaaaaaa-6666-0000-0000-000000000001'$$, 'değiştirilemez');
select tst.works('Başlamış görevlendirmenin notu güncellenebilir',
  $$update assignments set notes='Resmî bildirim yapıldı', official_ref='ISG-KATIP-123' where id='aaaaaaaa-6666-0000-0000-000000000001'$$);
select tst.works('Pay değiştir: %60 -> %50 (yarından itibaren)',
  $$select public.gorevlendirme_degistir('aaaaaaaa-6666-0000-0000-000000000001', 50, current_date+1, 'Pay güncellendi')$$);
select tst.ok('Eski dönem dün kapandı, yeni dönem %50 ile açık',
  (select (select valid_to from assignments where id='aaaaaaaa-6666-0000-0000-000000000001') = current_date
      and (select count(*) from assignments where employee_id='aaaaaaaa-5555-0000-0000-000000000001' and share_pct=50 and valid_to is null and valid_from=current_date+1) = 1
      and (select official_ref from assignments where employee_id='aaaaaaaa-5555-0000-0000-000000000001' and share_pct=50) = 'ISG-KATIP-123'));
select tst.fails('Pay değiştirirken başlangıç eski başlangıçtan sonra olmalı',
  $$select public.gorevlendirme_degistir((select id from assignments where employee_id='aaaaaaaa-5555-0000-0000-000000000001' and share_pct=50), 40, current_date-100)$$, 'sonra olmalıdır');
select tst.works('Gelecekteki görevlendirmenin payı doğrudan değiştirilebilir',
  $$update assignments set share_pct=45 where employee_id='aaaaaaaa-5555-0000-0000-000000000001' and share_pct=50$$);
select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false);
select tst.fails('Açık görevlendirmesi olan personel arşivlenemez',
  $$update employees set archived_at=now() where id='aaaaaaaa-5555-0000-0000-000000000001'$$, 'Açık görevlendirmesi');
select set_config('request.jwt.claim.sub','56565656-5656-5656-5656-565656565656',false);
select tst.fails('Görevlendirmesi olan personelin hizmet türü değiştirilemez',
  $$update employees set staff_type='isyeri_hekimi' where id='aaaaaaaa-5555-0000-0000-000000000001'$$, 'hizmet türü');
select tst.works('Görevlendirme arşivlenir (operasyon arşivleyebilir)',
  $$update assignments set archived_at=now() where id='aaaaaaaa-6666-0000-0000-000000000002'$$);
select tst.works('Arşivlenen payın yerine yeni pay girilebilir',
  $$insert into assignments(company_id,employee_id,staff_type,share_pct,valid_from) values
    ('aaaaaaaa-1111-0000-0000-000000000001','aaaaaaaa-5555-0000-0000-000000000003','is_guvenligi_uzmani',40,current_date)$$);
select tst.fails('Bugün 60+40 doluyken bir kişi daha %5 eklenemez',
  $$insert into assignments(company_id,employee_id,staff_type,share_pct,valid_from) values
    ('aaaaaaaa-1111-0000-0000-000000000001','aaaaaaaa-5555-0000-0000-000000000002','is_guvenligi_uzmani',5,current_date)$$, 'aşıyor');
select tst.ok('Ardışık dönemler çakışıyormuş gibi sayılmaz: bugün 60+40, yarından itibaren 45+40 (hepsi <=100)', true);
select tst.fails('Aynı personele çakışan ikinci görevlendirme reddedilir',
  $$insert into assignments(company_id,employee_id,staff_type,share_pct,valid_from) values
    ('aaaaaaaa-1111-0000-0000-000000000001','aaaaaaaa-5555-0000-0000-000000000001','is_guvenligi_uzmani',10,current_date+400)$$, 'exclusion');
select tst.fails('Fiziksel silme yok', $$delete from assignments where id='aaaaaaaa-6666-0000-0000-000000000003'$$, 'permission denied');

-- =====================================================================
-- C) Zaman kaydı (operasyon)
-- =====================================================================
select tst.works('Zaman kaydı girilir (ziyaret, 3 saat: 150 dk saha + 30 yol)',
  $$insert into time_entries(id,employee_id,company_id,activity_type,work_date,start_at,end_at,onsite_minutes,travel_minutes) values
    ('aaaaaaaa-7777-0000-0000-000000000001','aaaaaaaa-5555-0000-0000-000000000001','aaaaaaaa-1111-0000-0000-000000000001','ziyaret','2000-01-01',
     date_trunc('day', now() - interval '2 day') + interval '9 hours', date_trunc('day', now() - interval '2 day') + interval '12 hours', 150, 30)$$);
select tst.ok('Çalışma tarihi başlangıç anından otomatik atanır (girilen 2000-01-01 yok sayılır)',
  (select work_date = ((start_at at time zone 'Europe/Istanbul')::date) and work_date > '2000-01-01' from time_entries where id='aaaaaaaa-7777-0000-0000-000000000001'));
select tst.ok('Toplam dakika otomatik hesaplanır (180)', (select total_minutes = 180 from time_entries where id='aaaaaaaa-7777-0000-0000-000000000001'));
select tst.fails('Aynı personelde çakışan zaman kaydı reddedilir',
  $$insert into time_entries(employee_id,company_id,activity_type,work_date,start_at,end_at,onsite_minutes) values
    ('aaaaaaaa-5555-0000-0000-000000000001','aaaaaaaa-1111-0000-0000-000000000002','ziyaret',current_date,
     date_trunc('day', now() - interval '2 day') + interval '11 hours', date_trunc('day', now() - interval '2 day') + interval '13 hours', 60)$$, 'exclusion');
select tst.works('Başka personelin aynı saatteki kaydı çakışmaz',
  $$insert into time_entries(employee_id,company_id,activity_type,work_date,start_at,end_at,onsite_minutes) values
    ('aaaaaaaa-5555-0000-0000-000000000003','aaaaaaaa-1111-0000-0000-000000000001','ziyaret',current_date,
     date_trunc('day', now() - interval '2 day') + interval '9 hours', date_trunc('day', now() - interval '2 day') + interval '10 hours', 60)$$);
select tst.works('Bitişi başka kaydın başlangıcına denk gelen kayıt çakışmaz (12:00-13:00)',
  $$insert into time_entries(employee_id,activity_type,work_date,start_at,end_at,admin_minutes) values
    ('aaaaaaaa-5555-0000-0000-000000000001','idari',current_date,
     date_trunc('day', now() - interval '2 day') + interval '12 hours', date_trunc('day', now() - interval '2 day') + interval '13 hours', 60)$$);
select tst.fails('Dakika kırılımı toplam süreyi aşamaz',
  $$insert into time_entries(employee_id,activity_type,work_date,start_at,end_at,onsite_minutes) values
    ('aaaaaaaa-5555-0000-0000-000000000001','ziyaret',current_date,
     date_trunc('day', now() - interval '3 day') + interval '9 hours', date_trunc('day', now() - interval '3 day') + interval '10 hours', 90)$$, 'check');
select tst.fails('Bitiş başlangıçtan sonra olmalı',
  $$insert into time_entries(employee_id,activity_type,work_date,start_at,end_at) values
    ('aaaaaaaa-5555-0000-0000-000000000001','ziyaret',current_date, now() - interval '3 day', now() - interval '3 day')$$, 'check');
select tst.fails('Gelecek tarihli kayıt girilemez',
  $$insert into time_entries(employee_id,activity_type,work_date,start_at,end_at) values
    ('aaaaaaaa-5555-0000-0000-000000000001','ziyaret',current_date, now() + interval '3 day', now() + interval '3 day 1 hour')$$, 'Gelecek');
select tst.fails('24 saatten uzun kayıt girilemez',
  $$insert into time_entries(employee_id,activity_type,work_date,start_at,end_at) values
    ('aaaaaaaa-5555-0000-0000-000000000001','ziyaret',current_date, now() - interval '10 day', now() - interval '8 day')$$, '24 saat');
select tst.fails('Faaliyet türü boş olamaz',
  $$insert into time_entries(employee_id,activity_type,work_date,start_at,end_at) values
    ('aaaaaaaa-5555-0000-0000-000000000001','  ',current_date, now() - interval '4 day', now() - interval '4 day' + interval '1 hour')$$, 'Faaliyet');
select tst.fails('Yabancı kurumun personeline zaman kaydı girilemez',
  $$insert into time_entries(employee_id,activity_type,work_date,start_at,end_at) values
    ('bbbbbbbb-5555-0000-0000-000000000001','ziyaret',current_date, now() - interval '4 day', now() - interval '4 day' + interval '1 hour')$$, 'kuruma ait değil');
select tst.fails('Kaydın personeli sonradan değiştirilemez',
  $$update time_entries set employee_id='aaaaaaaa-5555-0000-0000-000000000003' where id='aaaaaaaa-7777-0000-0000-000000000001'$$, 'değiştirilemez');
select tst.works('Kayıt düzeltilir (not eklenir)', $$update time_entries set notes='Yol trafiği' where id='aaaaaaaa-7777-0000-0000-000000000001'$$);
select tst.works('Zaman kaydı arşivlenir', $$update time_entries set archived_at=now() where id='aaaaaaaa-7777-0000-0000-000000000001'$$);
select tst.works('Arşivlenen kaydın saatine yeni kayıt girilebilir',
  $$insert into time_entries(employee_id,company_id,activity_type,work_date,start_at,end_at,onsite_minutes) values
    ('aaaaaaaa-5555-0000-0000-000000000001','aaaaaaaa-1111-0000-0000-000000000001','ziyaret',current_date,
     date_trunc('day', now() - interval '2 day') + interval '9 hours', date_trunc('day', now() - interval '2 day') + interval '11 hours', 120)$$);

-- =====================================================================
-- D) Uzman/hekim rolü: yalnızca kendi kaydı
-- =====================================================================
reset role;
update users set employee_id='aaaaaaaa-5555-0000-0000-000000000001' where id='55555555-5555-5555-5555-555555555555';
update users set employee_id='aaaaaaaa-5555-0000-0000-000000000003' where id='57575757-5757-5757-5757-575757575757';
set role authenticated;
select set_config('request.jwt.claim.sub','55555555-5555-5555-5555-555555555555',false);

select tst.ok('Uzman yalnızca kendi zaman kayıtlarını görür',
  (select count(*) > 0 and bool_and(employee_id = 'aaaaaaaa-5555-0000-0000-000000000001') from time_entries));
select tst.ok('Uzman yalnızca kendi görevlendirmelerini görür',
  (select count(*) > 0 and bool_and(employee_id = 'aaaaaaaa-5555-0000-0000-000000000001') from assignments));
select tst.works('Uzman kendi adına zaman kaydı girer',
  $$insert into time_entries(employee_id,company_id,activity_type,work_date,start_at,end_at,onsite_minutes) values
    ('aaaaaaaa-5555-0000-0000-000000000001','aaaaaaaa-1111-0000-0000-000000000001','egitim',current_date,
     date_trunc('day', now() - interval '5 day') + interval '9 hours', date_trunc('day', now() - interval '5 day') + interval '10 hours', 60)$$);
select tst.fails('Uzman başkası adına zaman kaydı giremez',
  $$insert into time_entries(employee_id,activity_type,work_date,start_at,end_at) values
    ('aaaaaaaa-5555-0000-0000-000000000003','egitim',current_date, now() - interval '6 day', now() - interval '6 day' + interval '1 hour')$$, 'kendi adınıza');
select tst.ok('Uzman başkasının kaydını güncelleyemez (0 satır)',
  tst.rows($$update time_entries set notes='x' where employee_id='aaaaaaaa-5555-0000-0000-000000000003'$$) = 0);
select tst.ok('personel_listesi uzmana yalnızca kendini verir', (select count(*) = 1 and min(full_name) = 'Ayşe Uzman' from public.personel_listesi()));
select tst.ok('Uzman personel tablosunu doğrudan göremez', (select count(*) = 0 from employees));
select tst.fails('Uzman görevlendirme ekleyemez',
  $$insert into assignments(company_id,employee_id,staff_type,share_pct,valid_from) values
    ('aaaaaaaa-1111-0000-0000-000000000002','aaaaaaaa-5555-0000-0000-000000000001','is_guvenligi_uzmani',100,current_date)$$, 'row-level security');

-- =====================================================================
-- E) Diğer roller, maliyet, kullanıcı bağlama, kurumlar arası
-- =====================================================================
select set_config('request.jwt.claim.sub','22222222-2222-2222-2222-222222222222',false);  -- satış
select tst.ok('Satış personel listesinde adları görür (capacity yetkisi), maliyeti göremez',
  (select count(*) = 3 from public.personel_listesi()) and (select count(*) = 0 from employee_costs));
select tst.ok('Satış zaman kayıtlarını göremez', (select count(*) = 0 from time_entries));
select tst.fails('Satış personel kaydı açamaz', $$insert into employees(full_name,staff_type) values ('X','isyeri_hekimi')$$, 'row-level security');

select set_config('request.jwt.claim.sub','33333333-3333-3333-3333-333333333333',false);  -- finans
select tst.works('Finans personel maliyeti dönemi açar',
  $$select public.personel_maliyeti_ekle('aaaaaaaa-5555-0000-0000-000000000001', 50000, 12000, 3000, '2026-01-01')$$);
select tst.ok('Toplam maliyet 65000', (select total_monthly_cost = 65000 from employee_costs where employee_id='aaaaaaaa-5555-0000-0000-000000000001'));
select tst.works('Yeni maliyet dönemi eskisini kapatır',
  $$select public.personel_maliyeti_ekle('aaaaaaaa-5555-0000-0000-000000000001', 60000, 14000, 3000, '2026-07-01')$$);
select tst.ok('Eski dönem 30 Haziran''da kapandı',
  (select valid_to = '2026-06-30' from employee_costs where employee_id='aaaaaaaa-5555-0000-0000-000000000001' and valid_from='2026-01-01'));
select tst.fails('Maliyet dönemi geriye dönük çakışamaz',
  $$select public.personel_maliyeti_ekle('aaaaaaaa-5555-0000-0000-000000000001', 1, 1, 1, '2026-03-01')$$, 'sonra olmalıdır');
select tst.fails('Negatif maliyet reddedilir',
  $$select public.personel_maliyeti_ekle('aaaaaaaa-5555-0000-0000-000000000001', -1, 0, 0, '2027-01-01')$$, 'negatif');
select set_config('request.jwt.claim.sub','56565656-5656-5656-5656-565656565656',false);  -- operasyon
select tst.fails('Operasyon personel maliyetini giremez',
  $$select public.personel_maliyeti_ekle('aaaaaaaa-5555-0000-0000-000000000001', 1, 1, 1, '2027-01-01')$$, 'yetkiniz yok');
select tst.ok('Operasyon personel maliyetini göremez', (select count(*) = 0 from employee_costs));

select tst.fails('Operasyon kullanıcı bağlayamaz (kullanıcı yetkisi yok)',
  $$select public.personel_kullanici_bagla('aaaaaaaa-5555-0000-0000-000000000002','55555555-5555-5555-5555-555555555555')$$, 'yetkiniz');
select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false);  -- sahip
select tst.works('Sahip hekimi uzman2 kullanıcısına bağlar',
  $$select public.personel_kullanici_bagla('aaaaaaaa-5555-0000-0000-000000000002','57575757-5757-5757-5757-575757575757')$$);
select tst.ok('Bağ kuruldu, eski bağ (uzman2 -> Can Uzman) çözüldü',
  (select employee_id = 'aaaaaaaa-5555-0000-0000-000000000002' from users where id='57575757-5757-5757-5757-575757575757')
  and (select count(*) = 0 from users where employee_id='aaaaaaaa-5555-0000-0000-000000000003'));
select tst.works('Bağı kaldırma', $$select public.personel_kullanici_bagla('aaaaaaaa-5555-0000-0000-000000000002', null)$$);
select tst.fails('Yabancı kurumun kullanıcısı bağlanamaz',
  $$select public.personel_kullanici_bagla('aaaaaaaa-5555-0000-0000-000000000002','44444444-4444-4444-4444-444444444444')$$, 'bulunamadı');
select tst.fails('Pay değiştir: kurumlar arası kayıt görünmez',
  $$select public.gorevlendirme_degistir('00000000-0000-0000-0000-000000000000', 50, current_date)$$, 'bulunamadı');

select set_config('request.jwt.claim.sub','44444444-4444-4444-4444-444444444444',false);  -- yabancı
select tst.ok('Yabancı kurum bizim personelimizi göremez', (select count(*) = 1 from employees));
select tst.ok('Yabancı kurum bizim zaman/görevlendirme kayıtlarımızı göremez', (select count(*) = 0 from time_entries) and (select count(*) = 0 from assignments));
select tst.ok('personel_listesi yabancıya yalnızca kendi kurumunu verir', (select count(*) = 1 and min(full_name) = 'Yabancı Uzman' from public.personel_listesi()));

-- Denetim
reset role;
select tst.ok('Denetim kaydı: personel ve zaman kayıtları yazıldı',
  (select count(*) > 0 from audit_logs where table_name = 'employees') and (select count(*) > 0 from audit_logs where table_name = 'time_entries'));
