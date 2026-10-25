-- OSGB 360 - Aşama 2 veri tabanı testleri (yerel PostgreSQL 16 + Supabase taklidi)
-- Sıra: supabase_stub.sql -> 01_sema.sql -> 03_asama2.sql -> bu dosya (boş bir veri tabanında)
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
 ('44444444-4444-4444-4444-444444444444','yabanci@baska.test'),
 ('66666666-6666-6666-6666-666666666666','Yeni.Kisi@Karma.test'),
 ('77777777-7777-7777-7777-777777777777','yeni2@karma.test');

insert into users(id,organization_id,role_id,full_name,email)
select u.id, r.organization_id, r.id, u.ad, u.eposta
from (values
  ('11111111-1111-1111-1111-111111111111'::uuid,'isletme_sahibi','aaaaaaaa-0000-0000-0000-000000000001'::uuid,'Sahip','sahip@karma.test'),
  ('22222222-2222-2222-2222-222222222222','satis','aaaaaaaa-0000-0000-0000-000000000001','Satışçı','satis@karma.test'),
  ('33333333-3333-3333-3333-333333333333','finans','aaaaaaaa-0000-0000-0000-000000000001','Finansçı','finans@karma.test'),
  ('55555555-5555-5555-5555-555555555555','uzman_hekim','aaaaaaaa-0000-0000-0000-000000000001','Uzman','uzman@karma.test'),
  ('44444444-4444-4444-4444-444444444444','isletme_sahibi','bbbbbbbb-0000-0000-0000-000000000002','Yabancı','yabanci@baska.test')
) as u(id,rol,org,ad,eposta)
join roles r on r.key = u.rol and r.organization_id = u.org;

insert into companies(id,organization_id,name,tax_no) values
 ('bbbbbbbb-1111-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000002','Yabancı Firma','9999999999');

-- =====================================================================
-- A) firma_olustur
-- =====================================================================
set role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false);

select tst.works('Sahip: firma + ilk profil tek işlemde oluşturulur',
  $$select public.firma_olustur('{"name":"  Atlas Yapı  ","tax_no":"1111111111","city":"Ankara","customer_status":"musteri"}'::jsonb, 30, 'tehlikeli', '2026-01-01')$$);
select tst.ok('Firma adı kırpıldı, kayıt var',
  (select count(*) from companies where name = 'Atlas Yapı' and tax_no = '1111111111') = 1);
select tst.ok('İlk profil açık dönemli: 30 çalışan / tehlikeli',
  (select count(*) from company_profiles p join companies c on c.id = p.company_id
    where c.name = 'Atlas Yapı' and p.employee_count = 30 and p.hazard_class = 'tehlikeli' and p.valid_to is null) = 1);
select tst.ok('Kurum otomatik atandı',
  (select organization_id from companies where name = 'Atlas Yapı') = 'aaaaaaaa-0000-0000-0000-000000000001');
select tst.works('Çalışan bilgisi olmadan da firma oluşturulabilir',
  $$select public.firma_olustur('{"name":"Toros Yapı","tax_no":"2222222222"}'::jsonb)$$);
select tst.ok('Çalışan bilgisi verilmeyince profil oluşmaz',
  (select count(*) from company_profiles p join companies c on c.id = p.company_id where c.name = 'Toros Yapı') = 0);
select tst.fails('Aynı vergi numarası reddedilir (mükerrer firma)',
  $$select public.firma_olustur('{"name":"Atlas Kopya","tax_no":"1111111111"}'::jsonb)$$, 'companies_tax_no_uq');
select tst.fails('Boş firma adı reddedilir',
  $$select public.firma_olustur('{"name":"   "}'::jsonb)$$, 'Firma adı zorunludur');
select tst.fails('Çalışan sayısı var, tehlike sınıfı yok -> reddedilir',
  $$select public.firma_olustur('{"name":"Eksik Bilgi"}'::jsonb, 10, null, '2026-01-01')$$, 'tehlike sınıfı');
select tst.fails('Negatif çalışan sayısı reddedilir ve firma da oluşmaz (atomik)',
  $$select public.firma_olustur('{"name":"Negatif Firma"}'::jsonb, -5, 'tehlikeli', '2026-01-01')$$);
select tst.ok('Atomiklik: başarısız çağrıdan firma kalmadı',
  (select count(*) from companies where name in ('Negatif Firma','Eksik Bilgi')) = 0);
select tst.fails('Başka kurumun kullanıcısı sorumlu olarak atanamaz',
  $$select public.firma_olustur('{"name":"Yanlış Sorumlu","responsible_user":"44444444-4444-4444-4444-444444444444"}'::jsonb)$$, 'kuruma ait değil');
select tst.works('Kendi kurumundaki kullanıcı sorumlu olarak atanabilir',
  $$select public.firma_olustur('{"name":"Sorumlulu Firma","responsible_user":"22222222-2222-2222-2222-222222222222"}'::jsonb)$$);

-- satış sorumlusu firma ekleyebilir (vce); finans ve uzman/hekim ekleyemez
select set_config('request.jwt.claim.sub','22222222-2222-2222-2222-222222222222',false);
select tst.works('Satış sorumlusu firma oluşturabilir',
  $$select public.firma_olustur('{"name":"Satış Firması","tax_no":"3333333333"}'::jsonb, 12, 'az_tehlikeli', '2026-02-01')$$);
select set_config('request.jwt.claim.sub','33333333-3333-3333-3333-333333333333',false);
select tst.fails('Finans sorumlusu firma oluşturamaz',
  $$select public.firma_olustur('{"name":"Finans Firması"}'::jsonb)$$, 'yetkiniz yok');
select set_config('request.jwt.claim.sub','55555555-5555-5555-5555-555555555555',false);
select tst.fails('Uzman/hekim firma oluşturamaz',
  $$select public.firma_olustur('{"name":"Uzman Firması"}'::jsonb)$$, 'yetkiniz yok');
select tst.ok('Uzman/hekim firmaları görebilir (companies: görüntüle)',
  (select count(*) from companies) >= 4);

-- =====================================================================
-- B) firma_profili_ekle  (Test 9: geçmiş bozulmaz)
-- =====================================================================
select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false);
create temp table t_fid as select id from companies where name = 'Atlas Yapı';
grant select on t_fid to authenticated;

select tst.works('Yeni dönem: 1 Nisan''dan itibaren 45 çalışan',
  $$select public.firma_profili_ekle((select id from t_fid), 45, 'tehlikeli', '2026-04-01', 'Yeni işe alımlar')$$);
select tst.ok('Eski dönem bir gün önce kapandı (31 Mart), silinmedi',
  (select valid_to from company_profiles where company_id = (select id from t_fid) and employee_count = 30) = '2026-03-31');
select tst.ok('Eski dönemin çalışan sayısı ve başlangıcı aynı kaldı',
  (select count(*) from company_profiles where company_id = (select id from t_fid) and employee_count = 30 and valid_from = '2026-01-01') = 1);
select tst.ok('Yeni dönem açık ve notu kayıtlı',
  (select count(*) from company_profiles where company_id = (select id from t_fid) and employee_count = 45 and valid_to is null and note = 'Yeni işe alımlar') = 1);
select tst.ok('Test 9: ocak için 30, nisan için 45 çalışan görünür',
  (select employee_count from company_profiles where company_id = (select id from t_fid) and '2026-01-15'::date between valid_from and coalesce(valid_to,'infinity')) = 30
  and (select employee_count from company_profiles where company_id = (select id from t_fid) and '2026-04-15'::date between valid_from and coalesce(valid_to,'infinity')) = 45);
select tst.fails('Mevcut dönemin başlangıcından önceki tarih reddedilir',
  $$select public.firma_profili_ekle((select id from t_fid), 50, 'tehlikeli', '2026-03-01')$$, 'sonra olmalıdır');
select tst.fails('Aynı başlangıç tarihi reddedilir',
  $$select public.firma_profili_ekle((select id from t_fid), 50, 'tehlikeli', '2026-04-01')$$, 'sonra olmalıdır');
select tst.fails('Negatif çalışan sayısı reddedilir',
  $$select public.firma_profili_ekle((select id from t_fid), -1, 'tehlikeli', '2026-06-01')$$, 'Çalışan sayısı');
select tst.fails('Tehlike sınıfı zorunlu',
  $$select public.firma_profili_ekle((select id from t_fid), 10, null, '2026-06-01')$$, 'Tehlike sınıfı');
select tst.fails('Başka kurumun firmasına profil eklenemez',
  $$select public.firma_profili_ekle('bbbbbbbb-1111-0000-0000-000000000001', 10, 'tehlikeli', '2026-06-01')$$, 'bulunamadı');
select tst.works('Dönem değişimi sınıf da değiştirebilir (çok tehlikeli)',
  $$select public.firma_profili_ekle((select id from t_fid), 60, 'cok_tehlikeli', '2026-07-01')$$);
select tst.ok('Üç dönem var, hiçbiri çakışmıyor',
  (select count(*) from company_profiles where company_id = (select id from t_fid)) = 3);

select set_config('request.jwt.claim.sub','33333333-3333-3333-3333-333333333333',false);
select tst.fails('Finans (firma düzenleme yetkisi yok) profil ekleyemez',
  $$select public.firma_profili_ekle((select id from t_fid), 70, 'tehlikeli', '2026-09-01')$$);
select tst.ok('Finans başarısız denemeden sonra veri aynı',
  (select count(*) from company_profiles where company_id = (select id from t_fid)) = 3);

-- =====================================================================
-- C) hizmet_suresi_kurallari / kurum_kullanicilari / anon erişimi
-- =====================================================================
select set_config('request.jwt.claim.sub','22222222-2222-2222-2222-222222222222',false);
select tst.ok('Satışçı (ayarlar yetkisi yok) hizmet süresi kurallarını okuyabilir: 6 satır (referans tablo)',
  (select count(*) from service_time_rules) = 6);
select tst.fails('Satışçı hizmet süresi kuralı ekleyemez (ayarlar yetkisi yok)',
  $$insert into service_time_rules(staff_type,hazard_class,minutes_per_employee,valid_from) values ('isyeri_hekimi','tehlikeli',99,'2030-01-01')$$);
select tst.ok('Kurum kullanıcıları: yalnızca kendi kurumu (4 kişi)',
  (select count(*) from public.kurum_kullanicilari()) = 4);
select tst.ok('Kurum kullanıcıları listesinde yabancı kurumun kullanıcısı yok',
  (select count(*) from public.kurum_kullanicilari() where full_name = 'Yabancı') = 0);
select set_config('request.jwt.claim.sub','44444444-4444-4444-4444-444444444444',false);
select tst.ok('Yabancı kurum yalnızca kendi 6 kuralını görür, bizimkileri görmez',
  (select count(*) from service_time_rules) = 6
  and (select count(*) from service_time_rules where organization_id = 'aaaaaaaa-0000-0000-0000-000000000001') = 0);

reset role;
set role anon;
select tst.fails('Girişsiz kullanıcı hizmet süresi kurallarını okuyamaz', $$select * from service_time_rules$$, 'permission denied');
select tst.fails('Girişsiz kullanıcı firma_olustur çağıramaz', $$select public.firma_olustur('{"name":"X"}'::jsonb)$$, 'permission denied');
select tst.fails('Girişsiz kullanıcı kullanici_ekle çağıramaz', $$select public.kullanici_ekle('a@b.c','A','satis')$$, 'permission denied');
select tst.fails('Girişsiz kullanıcı firma_profili_ekle çağıramaz', $$select public.firma_profili_ekle(gen_random_uuid(),1,'tehlikeli','2026-01-01')$$, 'permission denied');
select tst.fails('Girişsiz kullanıcı kurum_kullanicilari çağıramaz', $$select * from public.kurum_kullanicilari()$$, 'permission denied');

-- =====================================================================
-- D) kullanici_ekle ve kullanıcı koruması
-- =====================================================================
reset role; set role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false);

select tst.works('Sahip: Supabase hesabını (büyük/küçük harf farkıyla) satış rolüyle ekler',
  $$select public.kullanici_ekle('  yeni.kisi@karma.TEST ', 'Yeni Kişi', 'satis')$$);
select tst.ok('Eklenen kullanıcı kurumda, rol satış, e-posta küçük harf',
  (select count(*) from users u join roles r on r.id = u.role_id
    where u.id = '66666666-6666-6666-6666-666666666666' and r.key = 'satis'
      and u.organization_id = 'aaaaaaaa-0000-0000-0000-000000000001' and u.email = 'yeni.kisi@karma.test') = 1);
select tst.fails('Aynı kullanıcı ikinci kez eklenemez',
  $$select public.kullanici_ekle('yeni.kisi@karma.test', 'Yeni Kişi', 'satis')$$, 'zaten tanımlı');
select tst.fails('Supabase''de olmayan e-posta reddedilir',
  $$select public.kullanici_ekle('yok@karma.test', 'Yok', 'satis')$$, 'hesabı bulunamadı');
select tst.fails('Geçersiz rol reddedilir',
  $$select public.kullanici_ekle('yeni2@karma.test', 'Yeni İki', 'olmayan_rol')$$, 'Geçersiz rol');
select tst.fails('Ad soyad boş olamaz',
  $$select public.kullanici_ekle('yeni2@karma.test', '  ', 'satis')$$, 'Ad soyad');

select set_config('request.jwt.claim.sub','22222222-2222-2222-2222-222222222222',false);
select tst.fails('Satışçı kullanıcı ekleyemez (yetki yok)',
  $$select public.kullanici_ekle('yeni2@karma.test', 'Yeni İki', 'satis')$$, 'yetkiniz yok');

select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false);
select tst.fails('Sahip kendi rolünü değiştiremez',
  $$update users set role_id = (select id from roles where key = 'satis' and organization_id = 'aaaaaaaa-0000-0000-0000-000000000001') where id = '11111111-1111-1111-1111-111111111111'$$, 'Kendi hesabınızın');
select tst.fails('Sahip kendini pasifleştiremez',
  $$update users set is_active = false where id = '11111111-1111-1111-1111-111111111111'$$, 'Kendi hesabınızın');
select tst.works('Sahip başkasının rolünü değiştirebilir (satış -> operasyon)',
  $$update users set role_id = (select id from roles where key = 'operasyon' and organization_id = 'aaaaaaaa-0000-0000-0000-000000000001') where id = '66666666-6666-6666-6666-666666666666'$$);
select tst.works('Sahip başkasını pasifleştirebilir',
  $$update users set is_active = false where id = '66666666-6666-6666-6666-666666666666'$$);
select tst.fails('Kullanıcı başka kuruma taşınamaz',
  $$update users set organization_id = 'bbbbbbbb-0000-0000-0000-000000000002' where id = '66666666-6666-6666-6666-666666666666'$$);
select tst.fails('Başka kurumun rolü atanamaz',
  $$update users set role_id = (select id from roles where key = 'satis' and organization_id = 'bbbbbbbb-0000-0000-0000-000000000002') where id = '66666666-6666-6666-6666-666666666666'$$);
select tst.ok('Kullanıcı değişiklikleri denetim kaydına yazıldı',
  (select count(*) from audit_logs where table_name = 'users' and record_id = '66666666-6666-6666-6666-666666666666') >= 3);

-- Yetki yükseltme denemeleri: satışçıya users yetkisi verilse bile sahip rolüne yükseltme yapamaz
reset role;
update role_permissions set can_view = true, can_create = true, can_edit = true
 where module = 'users' and role_id = (select id from roles where key = 'satis' and organization_id = 'aaaaaaaa-0000-0000-0000-000000000001');
set role authenticated;
select set_config('request.jwt.claim.sub','22222222-2222-2222-2222-222222222222',false);
select tst.fails('users yetkisi olan satışçı bile işletme sahibi rolü veremez (kullanici_ekle)',
  $$select public.kullanici_ekle('yeni2@karma.test', 'Yeni İki', 'isletme_sahibi')$$, 'yalnızca bu rollerdeki');
select tst.fails('users yetkisi olan satışçı kullanıcıyı işletme sahibi yapamaz (güncelleme)',
  $$update users set role_id = (select id from roles where key = 'isletme_sahibi' and organization_id = 'aaaaaaaa-0000-0000-0000-000000000001') where id = '33333333-3333-3333-3333-333333333333'$$, 'yalnızca bu rollerdeki');
select tst.fails('users yetkisi olan satışçı kendini yükseltemez',
  $$update users set role_id = (select id from roles where key = 'isletme_sahibi' and organization_id = 'aaaaaaaa-0000-0000-0000-000000000001') where id = '22222222-2222-2222-2222-222222222222'$$, 'Kendi hesabınızın');
select tst.fails('Sahibin rolü satışçı tarafından düşürülemez',
  $$update users set role_id = (select id from roles where key = 'satis' and organization_id = 'aaaaaaaa-0000-0000-0000-000000000001') where id = '11111111-1111-1111-1111-111111111111'$$, 'yalnızca bu rollerdeki');
reset role;
update role_permissions set can_view = false, can_create = false, can_edit = false
 where module = 'users' and role_id = (select id from roles where key = 'satis' and organization_id = 'aaaaaaaa-0000-0000-0000-000000000001');

-- =====================================================================
-- E) Yetki matrisi koruması ve denetimi
-- =====================================================================
set role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false);
select tst.works('Sahip satış rolüne firma arşivleme yetkisi verebilir',
  $$update role_permissions set can_archive = true where module = 'companies' and role_id = (select id from roles where key = 'satis' and organization_id = 'aaaaaaaa-0000-0000-0000-000000000001')$$);
select tst.ok('Yetki değişikliği denetim kaydına yazıldı',
  (select count(*) from audit_logs where table_name = 'role_permissions' and action = 'UPDATE' and (new_data->>'can_archive')::boolean is true) = 1);
select tst.fails('İşletme sahibi rolünün yetkileri değiştirilemez (kilitlenme koruması)',
  $$update role_permissions set can_view = false where module = 'users' and role_id = (select id from roles where key = 'isletme_sahibi' and organization_id = 'aaaaaaaa-0000-0000-0000-000000000001')$$, 'değiştirilemez');
select tst.fails('Sistem yöneticisi rolünün yetkileri değiştirilemez',
  $$update role_permissions set can_edit = false where module = 'users' and role_id = (select id from roles where key = 'sistem_yoneticisi' and organization_id = 'aaaaaaaa-0000-0000-0000-000000000001')$$, 'değiştirilemez');
select tst.fails('Başka kurumun rolünün yetkisi değiştirilemez (RLS)',
  $q$do $d$ begin
      update role_permissions set can_view = true where module = 'users' and role_id = (select id from roles where key = 'satis' and organization_id = 'bbbbbbbb-0000-0000-0000-000000000002');
      if not found then raise exception 'RLS: satır görünmüyor'; end if;
    end $d$$q$, 'RLS');
select set_config('request.jwt.claim.sub','22222222-2222-2222-2222-222222222222',false);
select tst.fails('Satışçı yetki matrisini değiştiremez',
  $q$do $d$ begin
      update role_permissions set can_view = true where module = 'payroll' and role_id = (select id from roles where key = 'satis' and organization_id = 'aaaaaaaa-0000-0000-0000-000000000001');
      if not found then raise exception 'RLS: satır güncellenemedi'; end if;
    end $d$$q$, 'RLS');
select tst.ok('Satışçı denetim kayıtlarını göremez', (select count(*) from audit_logs) = 0);

-- =====================================================================
-- F) Arşiv / arşivden çıkarma
-- =====================================================================
select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false);
create temp table t_toros as select id from companies where name = 'Toros Yapı';
grant select on t_toros to authenticated;

select tst.works('Sahip firmayı arşivler',
  $$update companies set archived_at = now() where id = (select id from t_toros)$$);
select tst.ok('Arşivleyen kullanıcı kaydedildi',
  (select archived_by from companies where id = (select id from t_toros)) = '11111111-1111-1111-1111-111111111111');
select tst.fails('Arşiv tarihi başka bir güncellemeyle oynatılamaz (değişmeden kalır)',
  $q$do $d$ declare a timestamptz; b timestamptz; begin
      select archived_at into a from companies where id = (select id from t_toros);
      update companies set archived_at = a + interval '5 days', archived_by = null where id = (select id from t_toros);
      select archived_at into b from companies where id = (select id from t_toros);
      if b = a and (select archived_by from companies where id = (select id from t_toros)) is not null then
        raise exception 'KORUNDU: arşiv alanları değişmedi';
      end if;
    end $d$$q$, 'KORUNDU');
select tst.works('Sahip arşivden çıkarır',
  $$update companies set archived_at = null where id = (select id from t_toros)$$);
select tst.ok('Arşivden çıkınca arşivleyen bilgisi temizlendi',
  (select archived_by is null and archived_at is null from companies where id = (select id from t_toros)));
select tst.works('Firma yeniden arşivlenir',
  $$update companies set archived_at = now() where id = (select id from t_toros)$$);
select tst.works('Arşivli firmanın vergi numarası yeniden kullanılabilir (mükerrer kuralı yalnızca aktifler için)',
  $$select public.firma_olustur('{"name":"Toros Yapı Yeni","tax_no":"2222222222"}'::jsonb)$$);
select tst.fails('Aynı vergi numaralı aktif firma varken arşivden çıkarma reddedilir',
  $$update companies set archived_at = null where id = (select id from t_toros)$$, 'companies_tax_no_uq');

-- satışçı: arşiv yetkisi verilmişti (E bölümü); arşivle/çıkar çalışır, yetkisi alınınca çalışmaz
select set_config('request.jwt.claim.sub','22222222-2222-2222-2222-222222222222',false);
select tst.works('Arşiv yetkisi verilen satışçı arşivleyebilir',
  $$update companies set archived_at = now() where name = 'Satış Firması'$$);
select tst.works('Arşiv yetkisi verilen satışçı arşivden çıkarabilir',
  $$update companies set archived_at = null where name = 'Satış Firması'$$);
reset role;
update role_permissions set can_archive = false where module = 'companies' and role_id = (select id from roles where key = 'satis' and organization_id = 'aaaaaaaa-0000-0000-0000-000000000001');
set role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false);
update companies set archived_at = now() where name = 'Satış Firması';
select set_config('request.jwt.claim.sub','22222222-2222-2222-2222-222222222222',false);
select tst.fails('Arşiv yetkisi olmayan satışçı arşivden çıkaramaz',
  $$update companies set archived_at = null where name = 'Satış Firması'$$, 'arşivden çıkarma yetkiniz yok');
select tst.ok('Firma hâlâ arşivde', (select archived_at is not null from companies where name = 'Satış Firması'));

-- =====================================================================
-- G) Kurumlar arası bağlantı koruması
-- =====================================================================
select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false);
select tst.fails('Başka kurumun firmasına kişi eklenemez',
  $$insert into contacts(company_id, full_name) values ('bbbbbbbb-1111-0000-0000-000000000001','Casus Kişi')$$, 'kuruma ait değil');
select tst.fails('Başka kurumun firmasına doğrudan profil eklenemez',
  $$insert into company_profiles(company_id, employee_count, hazard_class, valid_from) values ('bbbbbbbb-1111-0000-0000-000000000001', 5, 'tehlikeli', '2026-01-01')$$, 'kuruma ait değil');
select tst.fails('Firmanın sorumlusu başka kurumdan seçilemez (güncelleme)',
  $$update companies set responsible_user = '44444444-4444-4444-4444-444444444444' where id = (select id from t_fid)$$, 'kuruma ait değil');
select tst.works('Kendi firmasına kişi eklenir',
  $$insert into contacts(company_id, full_name, title, is_decision_maker) values ((select id from t_fid), 'Ayşe Demir', 'İK Müdürü', true)$$);
select tst.fails('Firmasız ve potansiyel müşterisiz kişi eklenemez',
  $$insert into contacts(full_name) values ('Sahipsiz Kişi')$$);
select tst.works('Sahip kişiyi arşivler',
  $$update contacts set archived_at = now() where full_name = 'Ayşe Demir'$$);
select set_config('request.jwt.claim.sub','44444444-4444-4444-4444-444444444444',false);
select tst.ok('Yabancı kurum bizim firmalarımızı ve kişilerimizi göremez',
  (select count(*) from companies where name <> 'Yabancı Firma') = 0 and (select count(*) from contacts) = 0);
select tst.fails('Yabancı kurum bizim firmamıza profil ekleyemez',
  $$select public.firma_profili_ekle((select id from t_fid), 5, 'tehlikeli', '2026-12-01')$$, 'bulunamadı');
