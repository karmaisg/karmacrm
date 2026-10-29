-- OSGB 360 - Aşama 10 veri tabanı testleri (yerel PostgreSQL 16 + Supabase taklidi)
-- Sıra: supabase_stub.sql -> 01_sema.sql -> 03..09 -> 10_asama10.sql -> bu dosya (boş bir veri tabanında)
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
grant select on g to authenticated;
insert into companies(id,organization_id,name) values
 ('aaaaaaaa-1111-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001','Alfa Gıda'),
 ('aaaaaaaa-1111-0000-0000-000000000002','aaaaaaaa-0000-0000-0000-000000000001','Beta İnşaat'),
 ('aaaaaaaa-1111-0000-0000-000000000003','aaaaaaaa-0000-0000-0000-000000000001','Gama Tekstil'),
 ('aaaaaaaa-1111-0000-0000-000000000004','aaaaaaaa-0000-0000-0000-000000000001','Delta Metal'),
 ('aaaaaaaa-1111-0000-0000-000000000005','aaaaaaaa-0000-0000-0000-000000000001','Epsilon Lojistik'),
 ('bbbbbbbb-1111-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000002','Yabancı Firma');

-- faturalar (KDV dahil tutar = haric + kdv)
insert into invoices(id,organization_id,company_id,invoice_no,invoice_date,due_date,amount_excl_vat,vat_amount,flag)
select v.id::uuid, 'aaaaaaaa-0000-0000-0000-000000000001', v.firma::uuid, v.no, (select bugun from g) + least(v.vade, 0) - 5, (select bugun from g) + v.vade, v.haric, v.kdv, v.flag::collection_flag
from (values
  ('aaaaaaaa-2222-0000-0000-000000000001','aaaaaaaa-1111-0000-0000-000000000001','F-1',-40, 1000,200,null),   -- vadesi 40 gün geçti, 1200
  ('aaaaaaaa-2222-0000-0000-000000000002','aaaaaaaa-1111-0000-0000-000000000002','F-2',-10, 500,100,'itirazli'), -- 10 gün geçti, 600, kısmi tahsilat 100 -> 500
  ('aaaaaaaa-2222-0000-0000-000000000003','aaaaaaaa-1111-0000-0000-000000000003','F-3',-5, 100,20,null),       -- tamamen ödendi -> yok
  ('aaaaaaaa-2222-0000-0000-000000000004','aaaaaaaa-1111-0000-0000-000000000001','F-4', 3, 250,50,null),       -- 3 gün sonra vade, 300
  ('aaaaaaaa-2222-0000-0000-000000000005','aaaaaaaa-1111-0000-0000-000000000002','F-5', 20, 900,0,null),       -- 20 gün sonra: listede yok
  ('aaaaaaaa-2222-0000-0000-000000000007','aaaaaaaa-1111-0000-0000-000000000004','F-7', 0, 50,10,null)         -- bugün vade: yaklaşan, 0 gün
) v(id,firma,no,vade,haric,kdv,flag);
insert into invoices(organization_id,company_id,invoice_no,invoice_date,due_date,amount_excl_vat,vat_amount,archived_at)
  values ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-1111-0000-0000-000000000003','F-6',(select bugun from g)-100,(select bugun from g)-90,777,0,now());
insert into payments(organization_id,invoice_id,paid_at,amount) values
 ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-2222-0000-0000-000000000002',(select bugun from g)-1,100),
 ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-2222-0000-0000-000000000003',(select bugun from g)-1,120);
insert into payments(organization_id,invoice_id,paid_at,amount,archived_at) values
 ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-2222-0000-0000-000000000001',(select bugun from g)-2,999,now());   -- iptal edilmiş tahsilat sayılmaz
insert into invoices(organization_id,company_id,invoice_no,invoice_date,due_date,amount_excl_vat,vat_amount) values
 ('bbbbbbbb-0000-0000-0000-000000000002','bbbbbbbb-1111-0000-0000-000000000001','Y-1',(select bugun from g)-60,(select bugun from g)-30,9999,0);

-- sözleşmeler
insert into contracts(organization_id,company_id,start_date,end_date,status)
select 'aaaaaaaa-0000-0000-0000-000000000001', v.firma::uuid, (select bugun from g) - 300, (select bugun from g) + v.bitis, v.durum::contract_status
from (values
  ('aaaaaaaa-1111-0000-0000-000000000001', 30,'aktif'),   -- 30 gün
  ('aaaaaaaa-1111-0000-0000-000000000002', 200,'aktif'),  -- 90 gün dışında
  ('aaaaaaaa-1111-0000-0000-000000000003', -1,'aktif'),   -- süresi dolmuş ama hâlâ aktif
  ('aaaaaaaa-1111-0000-0000-000000000004', 10,'aktif'),
  ('aaaaaaaa-1111-0000-0000-000000000005', 90,'aktif')    -- tam 90 gün: dahil
) v(firma,bitis,durum);

update contracts set status = 'sona_erdi' where company_id = 'aaaaaaaa-1111-0000-0000-000000000004';

-- görevler
insert into tasks(organization_id,title,company_id,priority,due_at,status)
select 'aaaaaaaa-0000-0000-0000-000000000001', v.baslik, v.firma::uuid, v.oncelik::priority_level, ((select bugun from g) + v.gun)::timestamp at time zone 'Europe/Istanbul' + interval '10 hours', v.durum::task_status
from (values
  ('Dünkü görev','aaaaaaaa-1111-0000-0000-000000000001',-1,'yuksek','acik'),
  ('Bugünkü görev',null,0,'orta','devam_ediyor'),
  ('Yarınki görev',null,1,'orta','acik'),
  ('Biten görev',null,-3,'orta','tamamlandi')
) v(baslik,firma,gun,oncelik,durum);
insert into tasks(organization_id,title,priority,due_at,status,archived_at)
  values ('aaaaaaaa-0000-0000-0000-000000000001','Arşivli görev','orta',((select bugun from g)-2)::timestamp at time zone 'Europe/Istanbul',  'acik', now());
insert into tasks(organization_id,title,priority,status) values ('aaaaaaaa-0000-0000-0000-000000000001','Tarihsiz görev','orta','acik');

-- =====================================================================
-- A) Özet içeriği (service_role gibi: yetkili çağrı)
-- =====================================================================
create temp table oz as select public.gunluk_ozet('aaaaaaaa-0000-0000-0000-000000000001') as j;
select tst.ok('Tarih bugün (İstanbul)', (select (j->>'tarih')::date = (select bugun from g) from oz));
select tst.ok('Vadesi geçmiş: 2 fatura (F-1, F-2)', (select (j#>>'{gecikmis_fatura,adet}')::int = 2 from oz));
select tst.ok('Vadesi geçmiş toplam 1.700 (1200 + 600-100)', (select (j#>>'{gecikmis_fatura,toplam}')::numeric = 1700 from oz));
select tst.ok('Önce en eski vade (F-1, 40 gün)', (select j#>>'{gecikmis_fatura,liste,0,no}' = 'F-1' and (j#>>'{gecikmis_fatura,liste,0,gun}')::int = 40 and j#>>'{gecikmis_fatura,liste,0,firma}' = 'Alfa Gıda' from oz));
select tst.ok('İptal edilen tahsilat sayılmadı (F-1 kalan 1.200)', (select (j#>>'{gecikmis_fatura,liste,0,kalan}')::numeric = 1200 from oz));
select tst.ok('Kısmi tahsilat düşüldü, itiraz işareti taşınır (F-2 kalan 500)', (select (j#>>'{gecikmis_fatura,liste,1,kalan}')::numeric = 500 and j#>>'{gecikmis_fatura,liste,1,isaret}' = 'itirazli' from oz));
select tst.ok('Tamamen ödenen fatura yok', (select not (j::text like '%F-3%') from oz));
select tst.ok('Arşivli fatura yok', (select not (j::text like '%F-6%') from oz));
select tst.ok('20 gün sonra vadesi gelen yok', (select not (j::text like '%F-5%') from oz));
select tst.ok('7 gün içinde vade: 2 fatura (F-7 bugün, F-4 3 gün)', (select (j#>>'{yaklasan_vade,adet}')::int = 2 and (j#>>'{yaklasan_vade,toplam}')::numeric = 360 from oz));
select tst.ok('Yaklaşanlar vade sırasıyla, gün sayısı doğru', (select j#>>'{yaklasan_vade,liste,0,no}' = 'F-7' and (j#>>'{yaklasan_vade,liste,0,gun}')::int = 0 and (j#>>'{yaklasan_vade,liste,1,gun}')::int = 3 from oz));
select tst.ok('Sözleşmeler: 90 gün içindeki aktifler (süresi geçen + 30 gün + tam 90 gün) = 3', (select (j#>>'{sozlesme,adet}')::int = 3 from oz));
select tst.ok('Sözleşme sırası: süresi geçen önce, kalan gün negatif', (select j#>>'{sozlesme,liste,0,firma}' = 'Gama Tekstil' and (j#>>'{sozlesme,liste,0,kalan_gun}')::int = -1 and (j#>>'{sozlesme,liste,2,kalan_gun}')::int = 90 from oz));
select tst.ok('Sona ermiş ve 200 gün sonra biten sözleşme yok', (select not (j#>>'{sozlesme}' like '%Delta Metal%') and not (j#>>'{sozlesme}' like '%Beta İnşaat%') from oz));
select tst.ok('Görevler: dünkü + bugünkü = 2 (yarın, biten, arşivli, tarihsiz hariç)', (select (j#>>'{gorev,adet}')::int = 2 from oz));
select tst.ok('Görev: dünkü gecikmiş, bugünkü değil; öncelik ve firma', (select (j#>>'{gorev,liste,0,gecikmis}')::boolean and not (j#>>'{gorev,liste,1,gecikmis}')::boolean and j#>>'{gorev,liste,0,baslik}' = 'Dünkü görev' and j#>>'{gorev,liste,0,oncelik}' = 'yuksek' and j#>>'{gorev,liste,0,firma}' = 'Alfa Gıda' from oz));
select tst.ok('Başka kurumun verisi sızmaz', (select not (j::text like '%Y-1%') and not (j::text like '%Yabancı%') from oz));
select tst.ok('Boş kurum testi için ikinci kurum: 1 vadesi geçmiş (Y-1)', (select (public.gunluk_ozet('bbbbbbbb-0000-0000-0000-000000000002')#>>'{gecikmis_fatura,toplam}')::numeric = 9999));
select tst.ok('Olmayan kurum: sıfırlar', (select (j#>>'{gecikmis_fatura,adet}')::int = 0 and (j#>>'{sozlesme,adet}')::int = 0 and j#>>'{gorev,liste}' = '[]' from (select public.gunluk_ozet('cccccccc-0000-0000-0000-000000000003') as j) q));
-- 10'dan fazla kayıt: liste 10 ile sınırlı, adet gerçek sayı
insert into invoices(organization_id,company_id,invoice_no,invoice_date,due_date,amount_excl_vat,vat_amount)
select 'aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-1111-0000-0000-000000000005','K-'||n,(select bugun from g)-100,(select bugun from g)-20-n,10,0 from generate_series(1,12) n;
select tst.ok('Liste en fazla 10 satır, adet tümü (14), toplam tümü', (select jsonb_array_length(j#>'{gecikmis_fatura,liste}') = 10 and (j#>>'{gecikmis_fatura,adet}')::int = 14 and (j#>>'{gecikmis_fatura,toplam}')::numeric = 1700 + 120 from (select public.gunluk_ozet('aaaaaaaa-0000-0000-0000-000000000001') as j) q));

-- =====================================================================
-- B) Erişim: özet fonksiyonu kullanıcıya kapalı
-- =====================================================================
set role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false);
select tst.fails('Sahip bile tarayıcıdan özet fonksiyonunu çağıramaz', $$select public.gunluk_ozet('aaaaaaaa-0000-0000-0000-000000000001')$$, 'permission denied');
select tst.fails('Başka kurumun özeti istenemez', $$select public.gunluk_ozet('bbbbbbbb-0000-0000-0000-000000000002')$$, 'permission denied');
reset role;
set role anon;
select tst.fails('Anonim çağıramaz', $$select public.gunluk_ozet('aaaaaaaa-0000-0000-0000-000000000001')$$, 'permission denied');
reset role;

-- =====================================================================
-- C) Gönderim kaydı
-- =====================================================================
insert into email_digest_log(organization_id,gun,tur,durum,ayrinti) values
 ('aaaaaaaa-0000-0000-0000-000000000001',(select bugun from g),'gunluk','gonderildi','ok'),
 ('aaaaaaaa-0000-0000-0000-000000000001',(select bugun from g),'gunluk','hata','önceki deneme'),
 ('aaaaaaaa-0000-0000-0000-000000000001',(select bugun from g),'test','gonderildi','test'),
 ('bbbbbbbb-0000-0000-0000-000000000002',(select bugun from g),'gunluk','gonderildi','yabancı');
select tst.fails('Aynı gün ikinci başarılı günlük kayıt reddedilir',
  $$insert into email_digest_log(organization_id,gun,tur,durum) values ('aaaaaaaa-0000-0000-0000-000000000001',(select bugun from g),'gunluk','gonderildi')$$, 'duplicate key');
select tst.works('Aynı gün birden çok hata/atlandı kaydı olabilir',
  $$insert into email_digest_log(organization_id,gun,tur,durum) values ('aaaaaaaa-0000-0000-0000-000000000001',(select bugun from g),'gunluk','atlandi')$$);
select tst.fails('Geçersiz durum reddedilir', $$insert into email_digest_log(organization_id,gun,tur,durum) values ('aaaaaaaa-0000-0000-0000-000000000001',(select bugun from g),'gunluk','belki')$$, 'check constraint');
select tst.fails('Geçersiz tür reddedilir', $$insert into email_digest_log(organization_id,gun,tur,durum) values ('aaaaaaaa-0000-0000-0000-000000000001',(select bugun from g),'haftalik','hata')$$, 'check constraint');
set role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false);
select tst.ok('Sahip kendi kurumunun kayıtlarını görür (4), yabancıyı görmez', (select count(*) = 4 and bool_and(organization_id='aaaaaaaa-0000-0000-0000-000000000001') from email_digest_log));
select tst.fails('Sahip bile kayıt ekleyemez', $$insert into email_digest_log(organization_id,gun,tur,durum) values ('aaaaaaaa-0000-0000-0000-000000000001',(select bugun from g),'test','hata')$$, 'permission denied');
select tst.fails('Sahip kayıt güncelleyemez', $$update email_digest_log set durum='gonderildi'$$, 'permission denied');
select tst.fails('Sahip kayıt silemez', $$delete from email_digest_log$$, 'permission denied');
select set_config('request.jwt.claim.sub','22222222-2222-2222-2222-222222222222',false);
select tst.ok('Satış kayıtları göremez (ayarlar izni yok)', (select count(*) = 0 from email_digest_log));
select set_config('request.jwt.claim.sub','44444444-4444-4444-4444-444444444444',false);
select tst.ok('Yabancı kurum yalnızca kendi kaydını görür', (select count(*) = 1 and min(ayrinti) = 'yabancı' from email_digest_log));
reset role;
do $$ begin raise notice 'ÖZET: tamamlandı'; end $$;
