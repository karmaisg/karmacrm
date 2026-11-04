-- OSGB 360 - Aşama 20 (personel maliyeti) veri tabanı testleri (yerel PostgreSQL 16 + Supabase taklidi)
-- Sıra: supabase_stub.sql -> 01_sema.sql -> 03..13 -> 22_asama20.sql -> bu dosya (boş bir veri tabanında)
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

insert into employees(id,organization_id,full_name,staff_type) values
 ('eeeeeeee-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001','Maaşlı Uzman','is_guvenligi_uzmani');
-- eski tür kayıt (Aşama 5 işlevi): toplam brüt + SGK + diğer kalır
set role authenticated; select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false);
select tst.works('Eski işlev hâlâ çalışır', $$select public.personel_maliyeti_ekle('eeeeeeee-0000-0000-0000-000000000001', 50000, 12000, 3000, '2025-12-01')$$);
reset role;
select tst.ok('Eski kayıt toplamı brüt+SGK+diğer = 65000', (select total_monthly_cost = 65000 and cost_version = 1 from employee_costs where valid_from = '2025-12-01'));

-- SGK primi hesabı
select tst.ok('Emekli değil: 100000 brüt → %38,75 = 38750', app.sgk_primi(100000, false) = 38750);
select tst.ok('Emekli: 100000 brüt → %32,25 = 32250', app.sgk_primi(100000, true) = 32250);
select tst.ok('Brüt boş → 0', app.sgk_primi(null, false) = 0);

set role authenticated; select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false);
-- 2026-01-01: net 30000, brüt 40000, emekli değil, SGK otomatik, elden 5000
select tst.works('Yeni dönem: otomatik SGK', $$select public.personel_maliyeti_kaydet('eeeeeeee-0000-0000-0000-000000000001', '2026-01-01', 40000, 30000, false, null, 5000)$$);
reset role;
select tst.ok('Ocak kaydı: SGK 15500 (otomatik), toplam = 30000+15500+5000 = 50500', (select employer_sgk = 15500 and total_monthly_cost = 50500 and not sgk_manual and cost_version = 2 and valid_to is null from employee_costs where valid_from = '2026-01-01'));
select tst.ok('Önceki eski dönem 2025-12-31de kapandı', (select valid_to = '2025-12-31' from employee_costs where valid_from = '2025-12-01'));

set role authenticated; select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false);
-- sonraki dönem: emekli oldu
select tst.works('Yeni başlangıç: emekli', $$select public.personel_maliyeti_kaydet('eeeeeeee-0000-0000-0000-000000000001', '2026-06-01', 40000, 30000, true, null, 0)$$);
reset role;
select tst.ok('Haziran: SGK 12900 (%32,25), toplam 42900, açık', (select employer_sgk = 12900 and total_monthly_cost = 42900 and is_retired and valid_to is null from employee_costs where valid_from = '2026-06-01'));
select tst.ok('Ocak dönemi 2026-05-31de kapandı', (select valid_to = '2026-05-31' from employee_costs where valid_from = '2026-01-01'));

-- geçmişe araya dönem: kapsayan dönem bölünür, sonrası korunur
set role authenticated; select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false);
select tst.works('Araya dönem (Mart)', $$select public.personel_maliyeti_kaydet('eeeeeeee-0000-0000-0000-000000000001', '2026-03-01', 0, 0, false, 1234.56, 0)$$);
reset role;
select tst.ok('Mart: yalnızca SGK elle 1234,56, toplam 1234,56, Mart–Mayıs', (select employer_sgk = 1234.56 and total_monthly_cost = 1234.56 and sgk_manual and valid_to = '2026-05-31' from employee_costs where valid_from = '2026-03-01'));
select tst.ok('Ocak dönemi artık Şubat sonunda biter', (select valid_to = '2026-02-28' from employee_costs where valid_from = '2026-01-01'));
select tst.ok('Haziran dönemi korundu', (select valid_to is null from employee_costs where valid_from = '2026-06-01'));
select tst.ok('Dönemler çakışmıyor: 4 kayıt', (select count(*) = 4 from employee_costs where employee_id = 'eeeeeeee-0000-0000-0000-000000000001'));

-- aynı başlangıç: güncelleme
set role authenticated; select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false);
select tst.works('Aynı başlangıç güncellenir', $$select public.personel_maliyeti_kaydet('eeeeeeee-0000-0000-0000-000000000001', '2026-03-01', 10000, 8000, false, null, 500)$$);
reset role;
select tst.ok('Mart güncellendi: SGK 3875, toplam 8000+3875+500, hâlâ 4 kayıt', (select employer_sgk = 3875 and total_monthly_cost = 12375 and not sgk_manual from employee_costs where valid_from = '2026-03-01') and (select count(*) = 4 from employee_costs where employee_id = 'eeeeeeee-0000-0000-0000-000000000001'));

-- tarihten önce ilk dönem: bir sonrakinin başlangıcına kadar sürer
set role authenticated; select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false);
select tst.works('En eski kayıttan önce', $$select public.personel_maliyeti_kaydet('eeeeeeee-0000-0000-0000-000000000001', '2025-06-01', 0, 0, false, 100, 0)$$);
reset role;
select tst.ok('2025-06-01 dönemi 2025-11-30da biter (eski dönem 2025-12-01 başlar)', (select valid_to = '2025-11-30' from employee_costs where valid_from = '2025-06-01'));

-- doğrulama ve yetki
set role authenticated; select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false);
select tst.fails('Negatif tutar', $$select public.personel_maliyeti_kaydet('eeeeeeee-0000-0000-0000-000000000001', '2027-01-01', -1, 0, false, null, 0)$$, 'negatif');
select tst.fails('Başlangıç zorunlu', $$select public.personel_maliyeti_kaydet('eeeeeeee-0000-0000-0000-000000000001', null, 1, 0, false, null, 0)$$, 'başlangıcını');
select tst.works('Tüm alanlar boş olabilir', $$select public.personel_maliyeti_kaydet('eeeeeeee-0000-0000-0000-000000000001', '2027-01-01', null, null, null, null, null)$$);
select set_config('request.jwt.claim.sub','22222222-2222-2222-2222-222222222222',false);
select tst.fails('Satış rolü maliyet giremez', $$select public.personel_maliyeti_kaydet('eeeeeeee-0000-0000-0000-000000000001', '2027-02-01', 1, 1, false, null, 0)$$, 'yetkiniz yok');
select set_config('request.jwt.claim.sub','44444444-4444-4444-4444-444444444444',false);
select tst.ok('Başka kurum maliyet göremez', (select count(*) = 0 from employee_costs));
reset role;
