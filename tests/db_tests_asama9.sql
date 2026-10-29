-- OSGB 360 - Aşama 9 veri tabanı testleri (yerel PostgreSQL 16 + Supabase taklidi)
-- Sıra: supabase_stub.sql -> 01_sema.sql -> 03..08 -> 09_asama9.sql -> bu dosya (boş bir veri tabanında)
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
create temp table bu_ay as select date_trunc('month', app.today_tr())::date as d, (date_trunc('month', app.today_tr()) + interval '1 month')::date as sonraki, (date_trunc('month', app.today_tr()) - interval '1 month')::date as onceki, (date_trunc('month', app.today_tr()) + interval '2 month')::date as iki;
grant select on bu_ay to authenticated;

-- =====================================================================
-- A) Sayısal ayarlar
-- =====================================================================
set role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false);
select tst.works('Sahip: kapasiteyi bu ayın 1''inden 10.000 yapar',
  $$select public.ayar_kaydet('kapasite_dakika','10000'::jsonb,(select d from bu_ay))$$);
select tst.ok('Değer kaydedildi', (select value = '10000'::jsonb from settings where key='kapasite_dakika' and valid_from=(select d from bu_ay) and organization_id='aaaaaaaa-0000-0000-0000-000000000001'));
select tst.ok('Eski kayıt (2000-01-01) korunuyor', (select value = '11700'::jsonb from settings where key='kapasite_dakika' and valid_from='2000-01-01' and organization_id='aaaaaaaa-0000-0000-0000-000000000001'));
select tst.works('Aynı tarihe tekrar kayıt değeri düzeltir (çift satır oluşmaz)',
  $$select public.ayar_kaydet('kapasite_dakika','10500'::jsonb,(select d from bu_ay))$$);
select tst.ok('Tek satır, yeni değer', (select count(*)=1 and bool_and(value='10500'::jsonb) from settings where key='kapasite_dakika' and valid_from=(select d from bu_ay) and organization_id='aaaaaaaa-0000-0000-0000-000000000001'));
select tst.works('Gelecek aya KDV oranı 10', $$select public.ayar_kaydet('varsayilan_kdv_orani','10'::jsonb,(select sonraki from bu_ay))$$);
select tst.works('Ondalık vergi oranı (22,5)', $$select public.ayar_kaydet('kurumlar_vergisi_orani','22.5'::jsonb,(select d from bu_ay))$$);
select tst.ok('Ondalık değer korunur', (select (value #>> '{}')::numeric = 22.5 from settings where key='kurumlar_vergisi_orani' and valid_from=(select d from bu_ay) and organization_id='aaaaaaaa-0000-0000-0000-000000000001'));
select tst.works('Marj eşiği 15', $$select public.ayar_kaydet('marj_esigi_yuzde','15'::jsonb,(select d from bu_ay))$$);
select tst.fails('Geçmiş aya ayar yazılamaz', $$select public.ayar_kaydet('marj_esigi_yuzde','15'::jsonb,(select onceki from bu_ay))$$, 'Geçmiş aylar');
select tst.fails('Ayın 1''i olmayan tarih reddedilir', $$select public.ayar_kaydet('marj_esigi_yuzde','15'::jsonb,(select d + 14 from bu_ay))$$, 'ayın 1');
select tst.fails('Boş tarih reddedilir', $$select public.ayar_kaydet('marj_esigi_yuzde','15'::jsonb,null)$$, 'ayın 1');
select tst.fails('Vergi oranı %101 olamaz', $$select public.ayar_kaydet('kurumlar_vergisi_orani','101'::jsonb,(select d from bu_ay))$$, 'arasında');
select tst.fails('Negatif KDV olamaz', $$select public.ayar_kaydet('varsayilan_kdv_orani','-1'::jsonb,(select d from bu_ay))$$, 'arasında');
select tst.fails('Kapasite 59 dakika olamaz', $$select public.ayar_kaydet('kapasite_dakika','59'::jsonb,(select d from bu_ay))$$, 'arasında');
select tst.fails('Kapasite ayın dakikasından fazla olamaz', $$select public.ayar_kaydet('kapasite_dakika','50000'::jsonb,(select d from bu_ay))$$, 'arasında');
select tst.fails('Kapasite tam sayı olmalı', $$select public.ayar_kaydet('kapasite_dakika','11700.5'::jsonb,(select d from bu_ay))$$, 'tam sayı');
select tst.fails('Metin değer reddedilir', $$select public.ayar_kaydet('marj_esigi_yuzde','"yirmi"'::jsonb,(select d from bu_ay))$$, 'sayı olmalı');
select tst.fails('Dizi değer reddedilir', $$select public.ayar_kaydet('marj_esigi_yuzde','[20]'::jsonb,(select d from bu_ay))$$, 'sayı olmalı');
select tst.fails('NULL değer reddedilir', $$select public.ayar_kaydet('marj_esigi_yuzde',null,(select d from bu_ay))$$, 'sayı olmalı');
select tst.fails('Tanımsız anahtar reddedilir', $$select public.ayar_kaydet('gizli_anahtar','1'::jsonb,(select d from bu_ay))$$, 'değiştirilemez');
select tst.fails('Yenileme uyarı günleri buradan değişmez', $$select public.ayar_kaydet('yenileme_uyari_gunleri','30'::jsonb,(select d from bu_ay))$$, 'değiştirilemez');

-- =====================================================================
-- B) Hizmet süresi kuralları
-- =====================================================================
select tst.works('Uzman/tehlikeli 20 → 25 dk, gelecek ayın 1''inden',
  $$select public.hizmet_suresi_kurali_ekle('is_guvenligi_uzmani','tehlikeli',25,(select sonraki from bu_ay),'Yeni parametre')$$);
select tst.ok('Eski kural bir gün önce kapandı, yenisi açık',
  (select count(*)=2 and bool_or(minutes_per_employee=20 and valid_to=(select sonraki-1 from bu_ay)) and bool_or(minutes_per_employee=25 and valid_to is null and note='Yeni parametre') from service_time_rules where staff_type='is_guvenligi_uzmani' and hazard_class='tehlikeli' and organization_id='aaaaaaaa-0000-0000-0000-000000000001'));
select tst.works('Aynı dakika tekrar: değişiklik yok',
  $$select public.hizmet_suresi_kurali_ekle('is_guvenligi_uzmani','tehlikeli',25,(select iki from bu_ay),null)$$);
select tst.ok('Hâlâ iki kural', (select count(*)=2 from service_time_rules where staff_type='is_guvenligi_uzmani' and hazard_class='tehlikeli' and organization_id='aaaaaaaa-0000-0000-0000-000000000001'));
select tst.fails('Başlangıçtan önceki/aynı tarihe kural eklenemez',
  $$select public.hizmet_suresi_kurali_ekle('is_guvenligi_uzmani','tehlikeli',30,(select sonraki from bu_ay),null)$$, 'sonra olmalıdır');
select tst.fails('Sonradan başlayan kural varken önceye eklenemez',
  $$select public.hizmet_suresi_kurali_ekle('is_guvenligi_uzmani','tehlikeli',30,(select d from bu_ay),null)$$, 'zaten var');
select tst.fails('Geçmiş aya kural eklenemez', $$select public.hizmet_suresi_kurali_ekle('isyeri_hekimi','tehlikeli',12,(select onceki from bu_ay),null)$$, 'Geçmiş aylar');
select tst.fails('Ayın 1''i olmayan tarih reddedilir', $$select public.hizmet_suresi_kurali_ekle('isyeri_hekimi','tehlikeli',12,(select d + 3 from bu_ay),null)$$, 'ayın 1');
select tst.fails('Negatif dakika reddedilir', $$select public.hizmet_suresi_kurali_ekle('isyeri_hekimi','tehlikeli',-1,(select sonraki from bu_ay),null)$$, '0 ile 600');
select tst.fails('600 dakikadan fazla reddedilir', $$select public.hizmet_suresi_kurali_ekle('isyeri_hekimi','tehlikeli',601,(select sonraki from bu_ay),null)$$, '0 ile 600');
select tst.works('Sıfır dakika geçerli (hizmet yok)', $$select public.hizmet_suresi_kurali_ekle('isyeri_hekimi','az_tehlikeli',0,(select sonraki from bu_ay),'   ')$$);
select tst.ok('Boş not NULL yazılır', (select note is null from service_time_rules where staff_type='isyeri_hekimi' and hazard_class='az_tehlikeli' and valid_to is null and organization_id='aaaaaaaa-0000-0000-0000-000000000001'));
select tst.ok('Diğer kombinasyonlar etkilenmedi', (select count(*)=1 from service_time_rules where staff_type='is_guvenligi_uzmani' and hazard_class='cok_tehlikeli' and organization_id='aaaaaaaa-0000-0000-0000-000000000001'));
select tst.fails('Doğrudan tabloya çakışan kural eklenemez (dışlama kısıtı)',
  $$insert into service_time_rules(staff_type,hazard_class,minutes_per_employee,valid_from) values ('is_guvenligi_uzmani','cok_tehlikeli',50,'2030-01-01')$$, 'conflicting key');

-- =====================================================================
-- C) Yetki ve kurum yalıtımı
-- =====================================================================
select set_config('request.jwt.claim.sub','22222222-2222-2222-2222-222222222222',false);
select tst.fails('Satış: ayar değiştiremez', $$select public.ayar_kaydet('marj_esigi_yuzde','30'::jsonb,(select d from bu_ay))$$, 'yetkiniz');
select tst.fails('Satış: kural ekleyemez', $$select public.hizmet_suresi_kurali_ekle('isyeri_hekimi','tehlikeli',30,(select iki from bu_ay),null)$$, 'yetkiniz');
select tst.fails('Satış: ayar tablosuna doğrudan yazamaz', $$insert into settings(key,value,valid_from) values ('marj_esigi_yuzde','99'::jsonb,'2031-01-01')$$, 'row-level security');
select tst.ok('Satış: ayarları okuyabilir (hesaplamalar için)', (select count(*)>0 from settings));
select set_config('request.jwt.claim.sub','33333333-3333-3333-3333-333333333333',false);
select tst.fails('Finans: ayar değiştiremez', $$select public.ayar_kaydet('marj_esigi_yuzde','30'::jsonb,(select d from bu_ay))$$, 'yetkiniz');
select tst.fails('Finans: kural ekleyemez', $$select public.hizmet_suresi_kurali_ekle('isyeri_hekimi','tehlikeli',30,(select iki from bu_ay),null)$$, 'yetkiniz');
select set_config('request.jwt.claim.sub','44444444-4444-4444-4444-444444444444',false);
select tst.works('Yabancı kurumun sahibi kendi ayarını değiştirir', $$select public.ayar_kaydet('marj_esigi_yuzde','40'::jsonb,(select d from bu_ay))$$);
select tst.ok('Yabancı kurum kendi kurumunu görür, diğerini görmez', (select count(*)>0 and bool_and(organization_id='bbbbbbbb-0000-0000-0000-000000000002') from settings));
reset role;
select tst.ok('Kurumlar birbirinden bağımsız: ilk kurumun marj eşiği 15, ikincinin 40',
  (select (select value from settings where key='marj_esigi_yuzde' and valid_from=(select d from bu_ay) and organization_id='aaaaaaaa-0000-0000-0000-000000000001') = '15'::jsonb
      and (select value from settings where key='marj_esigi_yuzde' and valid_from=(select d from bu_ay) and organization_id='bbbbbbbb-0000-0000-0000-000000000002') = '40'::jsonb));
select tst.ok('Yabancı kurumun kuralları değişmedi', (select count(*)=6 from service_time_rules where organization_id='bbbbbbbb-0000-0000-0000-000000000002'));
select tst.ok('Denetim kaydı: ayar değişimi loglandı', (select count(*)>0 from audit_logs where table_name='settings'));

-- Sonuç özeti
do $$ begin raise notice 'ÖZET: tamamlandı'; end $$;
