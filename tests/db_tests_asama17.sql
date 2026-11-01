-- OSGB 360 - Aşama 15 (personel rolleri, yönetim işareti, işyeri takma adı) veri tabanı testleri (yerel PostgreSQL 16 + Supabase taklidi)
-- Sıra: supabase_stub.sql -> 01_sema.sql -> 03..13 -> 17_asama16.sql -> bu dosya (boş bir veri tabanında)
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


insert into companies(id,organization_id,name) values
 ('aaaaaaaa-1111-0000-0000-000000000002','aaaaaaaa-0000-0000-0000-000000000001','Seterm Teknik');
insert into company_profiles(organization_id, company_id, employee_count, hazard_class, valid_from) values
 ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-1111-0000-0000-000000000002', 10, 'az_tehlikeli', '2026-01-01');




-- ---------------------------------------------------------------- elle işyeri
insert into company_sites(organization_id, company_id, sgk_no, site_name, is_manual, invoice_alias, employee_count) values
 ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-1111-0000-0000-000000000002','EL00000001','UKEM ŞUBE',true,'UKEM',12);
set role authenticated; select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false);
select tst.works('Katip yüklemesi çalışır', $$select public.katip_uygula('{"donem":"2026-10-01","dosya":"x.xlsx","yeni_firmalar":[],"isyerleri":[{"sicil":"22222222222222222222222222","unvan":"BAŞKA İŞYERİ","il":"İZMİR","calisan":10,"tehlike":"tehlikeli","firma_id":"aaaaaaaa-1111-0000-0000-000000000002"}],"satirlar":[],"kisiler":[],"pasif":[],"ozet":{}}'::jsonb)$$);
reset role;
select tst.ok('Elle girilen işyeri Katip yüklemesinde pasife alınmadı', (select is_active from company_sites where sgk_no = 'EL00000001'));
select tst.ok('Firma kartı yalnızca Katip işyerlerinin çalışanını yansıtır (elle girilen 12 katılmaz)', (select employee_count = 10 from company_profiles where company_id = 'aaaaaaaa-1111-0000-0000-000000000002' and valid_to is null));

-- ---------------------------------------------------------------- takvim
insert into calendar_items(id, organization_id, title, kind, start_date, recurrence, amount) values
 ('cccccccc-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001','SGK primi ödemesi','odeme','2026-01-31','aylik',15000),
 ('cccccccc-0000-0000-0000-000000000002','aaaaaaaa-0000-0000-0000-000000000001','Tek seferlik hatırlatma','hatirlatma','2026-03-10','yok',null);
insert into calendar_items(id, organization_id, title, kind, start_date, recurrence, end_date) values
 ('cccccccc-0000-0000-0000-000000000003','aaaaaaaa-0000-0000-0000-000000000001','Süreli ödeme','odeme','2026-01-05','aylik','2026-03-31');
select tst.ok('Aylık tekrar: 31. gün şubatta ayın son gününe düşer (28 Şubat)', exists (select 1 from app.takvim_olaylari('aaaaaaaa-0000-0000-0000-000000000001','2026-02-01','2026-02-28') where baslik = 'SGK primi ödemesi' and tarih = '2026-02-28'));
select tst.ok('Aylık tekrar: nisanda 30 Nisan, martta 31 Mart', (select count(*) from app.takvim_olaylari('aaaaaaaa-0000-0000-0000-000000000001','2026-03-01','2026-04-30') where baslik = 'SGK primi ödemesi' and tarih in ('2026-03-31','2026-04-30')) = 2);
select tst.ok('Tek seferlik kayıt yalnızca kendi gününde', (select count(*) from app.takvim_olaylari('aaaaaaaa-0000-0000-0000-000000000001','2026-01-01','2026-12-31') where baslik = 'Tek seferlik hatırlatma') = 1);
select tst.ok('Bitiş tarihinden sonra tekrar yok', (select count(*) from app.takvim_olaylari('aaaaaaaa-0000-0000-0000-000000000001','2026-01-01','2026-12-31') where baslik = 'Süreli ödeme') = 3);
select tst.ok('Başlangıçtan önceki aylar üretilmez', (select count(*) from app.takvim_olaylari('aaaaaaaa-0000-0000-0000-000000000001','2025-10-01','2025-12-31') where baslik = 'SGK primi ödemesi') = 0);
select tst.ok('Yıl aşan aralık', (select count(*) from app.takvim_olaylari('aaaaaaaa-0000-0000-0000-000000000001','2026-11-15','2027-02-15') where baslik = 'SGK primi ödemesi') = 3);
insert into calendar_completions(organization_id, item_id, occurrence_date) values ('aaaaaaaa-0000-0000-0000-000000000001','cccccccc-0000-0000-0000-000000000001','2026-02-28');
select tst.ok('Yapıldı işareti yalnızca o ayı etkiler', (select tamam from app.takvim_olaylari('aaaaaaaa-0000-0000-0000-000000000001','2026-02-01','2026-02-28') where baslik = 'SGK primi ödemesi')
  and not (select tamam from app.takvim_olaylari('aaaaaaaa-0000-0000-0000-000000000001','2026-03-01','2026-03-31') where baslik = 'SGK primi ödemesi'));
select tst.fails('Aynı gün için çift tamamlama olmaz', $$insert into calendar_completions(organization_id, item_id, occurrence_date) values ('aaaaaaaa-0000-0000-0000-000000000001','cccccccc-0000-0000-0000-000000000001','2026-02-28')$$, 'duplicate');
insert into tasks(organization_id, title, due_at, remind_at, status) values
 ('aaaaaaaa-0000-0000-0000-000000000001','Görev A','2026-05-20 12:00+03','2026-05-18 09:00+03','acik'),
 ('aaaaaaaa-0000-0000-0000-000000000001','Görev B (bitti)','2026-05-20 12:00+03',null,'tamamlandi');
select tst.ok('Görev son tarihi ve hatırlatma tarihi takvime otomatik düşer', (select count(*) from app.takvim_olaylari('aaaaaaaa-0000-0000-0000-000000000001','2026-05-01','2026-05-31') where baslik = 'Görev A') = 2);
select tst.ok('Tamamlanan görev takvimde yok', (select count(*) from app.takvim_olaylari('aaaaaaaa-0000-0000-0000-000000000001','2026-05-01','2026-05-31') where baslik like 'Görev B%') = 0);
select tst.ok('Başka kurumun kayıtları görünmez', (select count(*) from app.takvim_olaylari('bbbbbbbb-0000-0000-0000-000000000002','2026-01-01','2026-12-31')) = 0);

set role authenticated; select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false);
select tst.works('Yönetici takvimi okur', $$select * from public.takvim_olaylari('2026-02-01','2026-02-28')$$);
select tst.fails('Aralık 400 günü aşamaz', $$select * from public.takvim_olaylari('2026-01-01','2027-12-31')$$, 'geçersiz');
select tst.works('Yönetici kayıt ekler', $$insert into calendar_items(title, start_date) values ('Elle kayıt','2026-06-01')$$);
select tst.fails('Yabancı firma ile kayıt eklenemez', $$insert into calendar_items(title, start_date, company_id) values ('X','2026-06-01','bbbbbbbb-1111-0000-0000-000000000001')$$, 'Firma bulunamadı');
select tst.fails('Bitiş başlangıçtan önce olamaz', $$insert into calendar_items(title, start_date, end_date) values ('X','2026-06-10','2026-06-01')$$, 'check');
reset role;
set role anon; select set_config('request.jwt.claim.sub','',false);
select tst.fails('Anon takvimi okuyamaz', $$select * from public.takvim_olaylari('2026-02-01','2026-02-28')$$, 'permission denied');
reset role;

-- ---------------------------------------------------------------- günlük özet
delete from calendar_items; delete from tasks;
insert into calendar_items(organization_id, title, kind, start_date, recurrence, amount) values
 ('aaaaaaaa-0000-0000-0000-000000000001','Bugünkü ödeme','odeme', app.today_tr(), 'yok', 500),
 ('aaaaaaaa-0000-0000-0000-000000000001','Yarın hatırlatma','hatirlatma', app.today_tr() + 1, 'yok', null),
 ('aaaaaaaa-0000-0000-0000-000000000001','Üç gün sonra','hatirlatma', app.today_tr() + 3, 'yok', null),
 ('aaaaaaaa-0000-0000-0000-000000000001','Dört gün sonra','hatirlatma', app.today_tr() + 4, 'yok', null);
insert into calendar_items(organization_id, title, kind, start_date, recurrence) values ('aaaaaaaa-0000-0000-0000-000000000001','Aylık: bugün','odeme', date_trunc('month', app.today_tr() - interval '2 month')::date + (extract(day from app.today_tr())::int - 1), 'aylik');
insert into tasks(organization_id, title, due_at, status) values
 ('aaaaaaaa-0000-0000-0000-000000000001','Bugün biten görev', (app.today_tr() + time '12:00') at time zone 'Europe/Istanbul', 'acik'),
 ('aaaaaaaa-0000-0000-0000-000000000001','Dünkü görev', ((app.today_tr() - 1) + time '12:00') at time zone 'Europe/Istanbul', 'acik'),
 ('aaaaaaaa-0000-0000-0000-000000000001','Yarın hatırlatılacak', ((app.today_tr() + 2) + time '12:00') at time zone 'Europe/Istanbul', 'acik');
update tasks set remind_at = ((app.today_tr() + 2) + time '09:00') at time zone 'Europe/Istanbul' where title = 'Yarın hatırlatılacak';
create temp table oz as select public.gunluk_ozet('aaaaaaaa-0000-0000-0000-000000000001') j;
select tst.ok('Bugün Yapılacaklar: bugünkü ödeme, bugün biten görev, aylık tekrar', (select (j->'bugun'->>'adet')::int = 3 from oz));
select tst.ok('Bugün listesinde ödeme tutarı ve türü var', (select j->'bugun'->'liste' @> '[{"baslik":"Bugünkü ödeme","tutar":500,"tur":"odeme"}]'::jsonb from oz));
select tst.ok('Yaklaşan Program: yarın, +2 (görev son tarihi ve hatırlatma), +3; +4 dahil değil', (select (j->'program'->>'adet')::int = 4 from oz));
select tst.ok('Yaklaşan Program: kalan gün sayısı', (select j->'program'->'liste' @> '[{"baslik":"Yarın hatırlatma","kalan_gun":1},{"baslik":"Üç gün sonra","kalan_gun":3}]'::jsonb from oz));
select tst.ok('Dört gün sonrası programda yok', (select not (j->'program'->'liste' @> '[{"baslik":"Dört gün sonra"}]'::jsonb) from oz));
select tst.ok('Eski görev bölümü yalnızca gecikmişler (bugünküler Bugün Yapılacaklar''da)', (select (j->'gorev'->>'adet')::int = 1 and j->'gorev'->'liste' @> '[{"baslik":"Dünkü görev"}]'::jsonb from oz));
insert into calendar_completions(organization_id, item_id, occurrence_date) select organization_id, id, start_date from calendar_items where title = 'Bugünkü ödeme';
select tst.ok('Yapıldı işaretli kayıt bugün listesinden düşer', (select (public.gunluk_ozet('aaaaaaaa-0000-0000-0000-000000000001')->'bugun'->>'adet')::int = 2));
