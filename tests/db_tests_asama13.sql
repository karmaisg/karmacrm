-- OSGB 360 - Aşama 12.1 (yanıt bildirimi) veri tabanı testleri (yerel PostgreSQL 16 + Supabase taklidi)
-- Sıra: supabase_stub.sql -> 01_sema.sql -> 03..12 -> 12_asama12.sql -> 13_asama13.sql -> bu dosya (boş bir veri tabanında)
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

insert into offers(id,organization_id,offer_no,company_id,offer_date,valid_until,employee_count,hazard_class,pricing,unit_price,discount_pct,est_expert_cost,est_physician_cost,est_travel_other_cost,description,created_by)
select v.id::uuid, v.org::uuid, v.no, v.firma::uuid, (select bugun from g) - 10, (select bugun from g) + v.vade, 25, 'tehlikeli', 'kisi_basi', 100, 10, 12345.67, 7654.32, 999.99, 'GİZLİ İÇ NOT', '22222222-2222-2222-2222-222222222222'
from (values
  ('aaaaaaaa-5555-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001','T-1','aaaaaaaa-1111-0000-0000-000000000001', 20),
  ('aaaaaaaa-5555-0000-0000-000000000002','aaaaaaaa-0000-0000-0000-000000000001','T-2','aaaaaaaa-1111-0000-0000-000000000001', 20),   -- taslak kalacak
  ('aaaaaaaa-5555-0000-0000-000000000004','aaaaaaaa-0000-0000-0000-000000000001','T-4','aaaaaaaa-1111-0000-0000-000000000001', -1),   -- süresi dolmuş
  ('aaaaaaaa-5555-0000-0000-000000000005','aaaaaaaa-0000-0000-0000-000000000001','T-5','aaaaaaaa-1111-0000-0000-000000000001', 20),
  ('bbbbbbbb-5555-0000-0000-000000000003','bbbbbbbb-0000-0000-0000-000000000002','Y-1','bbbbbbbb-1111-0000-0000-000000000001', 20)
) v(id,org,no,firma,vade);
insert into offer_items(organization_id,offer_id,description,quantity,unit_price) values
 ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-5555-0000-0000-000000000001','Risk analizi eğitimi',2,500);
insert into offer_items(organization_id,offer_id,description,quantity,unit_price,archived_at) values
 ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-5555-0000-0000-000000000001','Kaldırılmış kalem',1,1,now());

update offers set status = 'gonderildi' where id in ('aaaaaaaa-5555-0000-0000-000000000001','aaaaaaaa-5555-0000-0000-000000000004','aaaaaaaa-5555-0000-0000-000000000005','bbbbbbbb-5555-0000-0000-000000000003');
create temp table jt(ad text primary key, token text);
grant all on jt to authenticated, anon;


-- Vault ve pg_net taklidi (yerelde yok): çağrılar kaydedilir
create schema vault;
create table vault.decrypted_secrets(name text, decrypted_secret text);
create schema net;
create table net.cagrilar(id serial, url text, headers jsonb, body jsonb);
create function net.http_post(url text, body jsonb default '{}', params jsonb default '{}', headers jsonb default '{}', timeout_milliseconds int default 5000)
  returns bigint language plpgsql as $f$ begin insert into net.cagrilar(url, headers, body) values (url, headers, body); return 1; end $f$;

-- bağlantılar
set role authenticated; select set_config('request.jwt.claim.sub','22222222-2222-2222-2222-222222222222',false);
select tst.works('Bağlantı T-1', $$insert into jt select 't1', public.teklif_baglantisi_olustur('aaaaaaaa-5555-0000-0000-000000000001', 30)$$);
select tst.works('Bağlantı T-5', $$insert into jt select 't5', public.teklif_baglantisi_olustur('aaaaaaaa-5555-0000-0000-000000000005', 30)$$);
select tst.works('Bağlantı T-4', $$insert into jt select 't4', public.teklif_baglantisi_olustur('aaaaaaaa-5555-0000-0000-000000000004', 30)$$);
reset role;

-- 1) Gizli kayıtlar yokken: yanıt kaydedilir, görev düşer, çağrı yapılmaz, hata yok
set role anon; select set_config('request.jwt.claim.sub','',false);
select tst.works('Vault boşken müşteri yanıtı yine de kaydedilir', format($$select public.teklif_paylasim_yanitla(%L, 'kabul', 'Ali Veli')$$, (select token from jt where ad='t1')));
reset role;
select tst.ok('Vault boşken: yanıt ve görev var, e-posta çağrısı yok', (select response from offer_shares where offer_id = 'aaaaaaaa-5555-0000-0000-000000000001') = 'kabul'
  and (select count(*) from tasks where source_ref like 'offer_share:%') = 1 and (select count(*) from net.cagrilar) = 0);

-- 2) Gizli kayıtlar varken: tek çağrı, doğru adres, başlık ve gövde
insert into vault.decrypted_secrets values ('ozet_cron_sirri', 'GIZLI-SIR'), ('ozet_fonksiyon_adresi', 'https://ornek.supabase.co/functions/v1/gunluk-ozet');
set role anon; select set_config('request.jwt.claim.sub','',false);
select tst.works('Red yanıtı', format($$select public.teklif_paylasim_yanitla(%L, 'red', 'Ayşe Kaya', 'Fiyat yüksek')$$, (select token from jt where ad='t5')));
reset role;
select tst.ok('Tam olarak bir bildirim çağrısı yapıldı', (select count(*) from net.cagrilar) = 1);
select tst.ok('Çağrı: doğru adres', (select url from net.cagrilar) = 'https://ornek.supabase.co/functions/v1/gunluk-ozet');
select tst.ok('Çağrı: gizli başlık ve içerik türü', (select headers ->> 'x-ozet-sirri' = 'GIZLI-SIR' and headers ->> 'Content-Type' = 'application/json' from net.cagrilar));
select tst.ok('Çağrı gövdesi yalnızca olay ve yanıt kimliği içerir (müşteri metni, ad, not YOK)',
  (select body ->> 'olay' = 'teklif_yaniti' and body ->> 'paylasim' = (select id::text from offer_shares where offer_id = 'aaaaaaaa-5555-0000-0000-000000000005')
     and (select array(select jsonb_object_keys(body) order by 1)) = array['olay','paylasim'] and body::text !~ '(Ayşe|Fiyat yüksek)' from net.cagrilar));

-- 3) Reddedilen/başarısız yanıt bildirim göndermez
set role anon; select set_config('request.jwt.claim.sub','',false);
select tst.fails('Süresi dolmuş teklif: reddedilir', format($$select public.teklif_paylasim_yanitla(%L, 'kabul', 'Ali Veli')$$, (select token from jt where ad='t4')), 'geçerlilik süresi dolmuş');
select tst.fails('İkinci yanıt: reddedilir', format($$select public.teklif_paylasim_yanitla(%L, 'red', 'Ali Veli')$$, (select token from jt where ad='t5')), 'zaten yanıt verilmiş');
reset role;
select tst.ok('Başarısız denemeler ek bildirim üretmedi', (select count(*) from net.cagrilar) = 1);

-- 4) pg_net hata verirse müşteri yanıtı yine kaydedilir
create or replace function net.http_post(url text, body jsonb default '{}', params jsonb default '{}', headers jsonb default '{}', timeout_milliseconds int default 5000)
  returns bigint language plpgsql as $f$ begin raise exception 'pg_net kapalı'; end $f$;
set role authenticated; select set_config('request.jwt.claim.sub','22222222-2222-2222-2222-222222222222',false);
reset role;
update offers set status = 'gonderildi' where id = 'aaaaaaaa-5555-0000-0000-000000000002';
set role authenticated; select set_config('request.jwt.claim.sub','22222222-2222-2222-2222-222222222222',false);
select tst.works('Bağlantı T-2', $$insert into jt select 't2', public.teklif_baglantisi_olustur('aaaaaaaa-5555-0000-0000-000000000002', 30)$$);
reset role;
set role anon; select set_config('request.jwt.claim.sub','',false);
select tst.fails('Geçersiz ad: reddedilir', format($$select public.teklif_paylasim_yanitla(%L, 'kabul', 'A')$$, (select token from jt where ad='t2')), 'adınızı');
select tst.works('pg_net hata verse de müşteri yanıtı başarılı döner', format($$select public.teklif_paylasim_yanitla(%L, 'kabul', 'Veli Can')$$, (select token from jt where ad='t2')));
reset role;
select tst.ok('pg_net hatasında yanıt ve görev kaydedildi', (select response from offer_shares where offer_id = 'aaaaaaaa-5555-0000-0000-000000000002') = 'kabul'
  and (select count(*) from tasks where title = 'Müşteri teklifi KABUL ETTİ: T-2') = 1);

-- 5) Yetki ve günlük tablosu
set role anon; select set_config('request.jwt.claim.sub','',false);
select tst.fails('Anon: bildirim yardımcısını doğrudan çağıramaz', $$select app.sahibe_yanit_bildir(gen_random_uuid())$$, 'permission denied');
reset role;
set role authenticated; select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false);
select tst.fails('Girişli kullanıcı da çağıramaz', $$select app.sahibe_yanit_bildir(gen_random_uuid())$$, 'permission denied');
reset role;
select tst.works('Günlük tablosu yanit türünü kabul eder', $$insert into email_digest_log(organization_id, gun, tur, durum, kaynak, ayrinti) values ('aaaaaaaa-0000-0000-0000-000000000001', current_date, 'yanit', 'gonderildi', 'paylasim:x1', 'ok')$$);
select tst.fails('Aynı yanıt için ikinci başarılı bildirim engellenir', $$insert into email_digest_log(organization_id, gun, tur, durum, kaynak, ayrinti) values ('aaaaaaaa-0000-0000-0000-000000000001', current_date, 'yanit', 'gonderildi', 'paylasim:x1', 'ok')$$, 'duplicate key');
select tst.works('Hata kaydı tekrar edilebilir (yeniden denemeler)', $$insert into email_digest_log(organization_id, gun, tur, durum, kaynak, ayrinti) values ('aaaaaaaa-0000-0000-0000-000000000001', current_date, 'yanit', 'hata', 'paylasim:x1', 'x'), ('aaaaaaaa-0000-0000-0000-000000000001', current_date, 'yanit', 'hata', 'paylasim:x1', 'y')$$);
select tst.fails('Geçersiz tür reddedilir', $$insert into email_digest_log(organization_id, gun, tur, durum) values ('aaaaaaaa-0000-0000-0000-000000000001', current_date, 'baska', 'hata')$$, 'check');
select tst.works('Günlük özet kuralı etkilenmedi (aynı gün tek başarılı günlük)', $$insert into email_digest_log(organization_id, gun, tur, durum) values ('aaaaaaaa-0000-0000-0000-000000000001', current_date, 'gunluk', 'gonderildi')$$);
select tst.fails('İkinci günlük başarılı kayıt hâlâ engelli', $$insert into email_digest_log(organization_id, gun, tur, durum) values ('aaaaaaaa-0000-0000-0000-000000000001', current_date, 'gunluk', 'gonderildi')$$, 'duplicate key');
select tst.ok('Yanıt, durum ve sayı: teklif durumları kendiliğinden değişmedi', (select count(*) from offers where status = 'gonderildi') = 5);
