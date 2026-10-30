-- OSGB 360 - Aşama 11 veri tabanı testleri (yerel PostgreSQL 16 + Supabase taklidi)
-- Sıra: supabase_stub.sql -> 01_sema.sql -> 03..10 -> 11_asama11.sql -> bu dosya (boş bir veri tabanında)
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

-- denetim satırı üretecek veriler (tetikleyiciler yazar)
insert into companies(id,organization_id,name) values
 ('aaaaaaaa-1111-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001','Alfa Gıda'),
 ('bbbbbbbb-1111-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000002','Yabancı Firma');
insert into employees(id,organization_id,full_name,staff_type) values
 ('aaaaaaaa-3333-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001','Uzman Bir','is_guvenligi_uzmani');
insert into employee_costs(organization_id,employee_id,gross_salary,employer_sgk,valid_from) values
 ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-3333-0000-0000-000000000001',50000,10000,'2026-01-01');
-- satışçıya "Kullanıcılar" görüntüleme izni devredilmiş (yetki devri senaryosu)
update role_permissions set can_view = true
 where module = 'users' and role_id = (select id from roles where key='satis' and organization_id='aaaaaaaa-0000-0000-0000-000000000001');

-- ---------- Modül eşlemesi ----------
select tst.ok('audit_modul: maaş kaydı payroll modülüne bağlı', app.audit_modul('employee_costs') = 'payroll');
select tst.ok('audit_modul: firma kaydı companies modülüne bağlı', app.audit_modul('companies') = 'companies');
select tst.ok('audit_modul: bilinmeyen/yönetim tablosu users modülüne düşer', app.audit_modul('role_permissions') = 'users' and app.audit_modul('yedek') = 'users');

-- ---------- Okuma izni ----------
select tst.ok('Kayıt üretildi (kurulum)', (select count(*) from audit_logs where table_name in ('companies','employee_costs')) >= 3);
set role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false);
select tst.ok('Sahip: firma denetim kaydını görür', (select count(*) from audit_logs where table_name = 'companies') = 1);
select tst.ok('Sahip: maaş denetim kaydını görür', (select count(*) from audit_logs where table_name = 'employee_costs') = 1);
select tst.ok('Sahip: başka kurumun kaydını görmez', (select count(*) from audit_logs where record_id = 'bbbbbbbb-1111-0000-0000-000000000001') = 0);
select set_config('request.jwt.claim.sub','22222222-2222-2222-2222-222222222222',false);
select tst.ok('Yetkisi devredilen satışçı: firma kaydını görür (companies görüntüleyebiliyor)', (select count(*) from audit_logs where table_name = 'companies') = 1);
select tst.ok('Yetkisi devredilen satışçı: maaş kaydını GÖRMEZ (payroll izni yok)', (select count(*) from audit_logs where table_name = 'employee_costs') = 0);
select set_config('request.jwt.claim.sub','33333333-3333-3333-3333-333333333333',false);
select tst.ok('Finans: users izni olmadığından hiç denetim kaydı görmez', (select count(*) from audit_logs) = 0);
select set_config('request.jwt.claim.sub','44444444-4444-4444-4444-444444444444',false);
select tst.ok('Başka kurumun sahibi: yalnızca kendi kaydını görür', (select count(*) from audit_logs where organization_id <> 'bbbbbbbb-0000-0000-0000-000000000002') = 0
  and (select count(*) from audit_logs where table_name='companies') = 1);

-- ---------- Tam yetki ----------
select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false);
select tst.ok('tam_yetkili: sahip evet', app.tam_yetkili());
select set_config('request.jwt.claim.sub','22222222-2222-2222-2222-222222222222',false);
select tst.ok('tam_yetkili: satışçı hayır', not app.tam_yetkili());
select set_config('request.jwt.claim.sub','33333333-3333-3333-3333-333333333333',false);
select tst.ok('tam_yetkili: finans hayır', not app.tam_yetkili());
reset role;

-- ---------- yedek_kaydi ----------
set role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false);
select tst.works('Sahip yedek kaydı yazar', $$select public.yedek_kaydi(34, 1250, 'osgb360-yedek-2026-10-30.json')$$);
select tst.ok('Yedek kaydı denetimde görünür; yalnızca sayılar içerir', (select count(*) from audit_logs where table_name='yedek' and action='BACKUP'
  and (new_data->>'tablo_sayisi')::int = 34 and (new_data->>'satir_sayisi')::int = 1250 and user_id = '11111111-1111-1111-1111-111111111111'
  and organization_id = 'aaaaaaaa-0000-0000-0000-000000000001') = 1);
select tst.fails('Geçersiz tablo sayısı reddedilir', $$select public.yedek_kaydi(0, 10)$$, 'Geçersiz yedek');
select tst.fails('Negatif satır sayısı reddedilir', $$select public.yedek_kaydi(5, -1)$$, 'Geçersiz yedek');
select tst.fails('Boş değer reddedilir', $$select public.yedek_kaydi(null, null)$$, 'Geçersiz yedek');
do $$ declare v bigint; begin v := public.yedek_kaydi(1, 1, repeat('x', 500));
  perform tst.ok('Çok uzun dosya adı kısaltılır', (select length(new_data->>'dosya') from audit_logs where id = v) = 120); end $$;
select set_config('request.jwt.claim.sub','22222222-2222-2222-2222-222222222222',false);
select tst.fails('Satışçı (users izni devredilmiş olsa bile) yedek kaydı yazamaz', $$select public.yedek_kaydi(34, 10)$$, 'tüm modülleri');
select set_config('request.jwt.claim.sub','33333333-3333-3333-3333-333333333333',false);
select tst.fails('Finans yedek kaydı yazamaz', $$select public.yedek_kaydi(34, 10)$$, 'tüm modülleri');

-- ---------- Değiştirilemezlik ----------
select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false);
select tst.fails('Denetim kaydına doğrudan ekleme yapılamaz', $$insert into audit_logs(organization_id,table_name,action) values ('aaaaaaaa-0000-0000-0000-000000000001','x','INSERT')$$);
select tst.fails('Denetim kaydı güncellenemez', $$update audit_logs set action = 'X'$$);
select tst.fails('Denetim kaydı silinemez', $$delete from audit_logs$$);
reset role;
set role anon;
select tst.fails('Girişsiz kullanıcı yedek kaydı yazamaz', $$select public.yedek_kaydi(34, 10)$$);
reset role;

-- ---------- Yeniden çalıştırma güvenli ----------
select tst.works('11_asama11.sql ikinci kez çalıştırılabilir (politika yeniden kurulur)', $$drop policy if exists audit_sel on audit_logs$$);
