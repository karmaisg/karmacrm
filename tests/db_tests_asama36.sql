-- OSGB 360 - Aşama 36 (patlamadan korunma teklifi, geçmiş hatırlatmalar) veri tabanı testleri (yerel PostgreSQL 16 + Supabase taklidi)
-- Sıra: supabase_stub.sql -> 01_sema.sql -> 03..13 -> 37_asama36.sql -> bu dosya (boş bir veri tabanında)
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
insert into organizations(id,name) values ('aaaaaaaa-0000-0000-0000-000000000001','Karma OSGB'),('bbbbbbbb-0000-0000-0000-000000000002','Başka OSGB');
select app.seed_organization('aaaaaaaa-0000-0000-0000-000000000001');
select app.seed_organization('bbbbbbbb-0000-0000-0000-000000000002');
insert into auth.users(id,email) values ('11111111-1111-1111-1111-111111111111','sahip@karma.test'),('22222222-2222-2222-2222-222222222222','satis@karma.test');
insert into users(id,organization_id,role_id,full_name,email)
select u.id, r.organization_id, r.id, u.ad, u.eposta from (values
  ('11111111-1111-1111-1111-111111111111'::uuid,'isletme_sahibi','aaaaaaaa-0000-0000-0000-000000000001'::uuid,'Sahip','sahip@karma.test'),
  ('22222222-2222-2222-2222-222222222222','finans','aaaaaaaa-0000-0000-0000-000000000001','Finansçı','satis@karma.test')) as u(id,rol,org,ad,eposta)
join roles r on r.key = u.rol and r.organization_id = u.org;
create temp table g as select app.today_tr() as bugun; grant select on g to authenticated, anon;
insert into companies(id,organization_id,name,customer_status) values ('aaaaaaaa-1111-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001','Firma A','musteri');
insert into companies(id,organization_id,name,customer_status) values ('bbbbbbbb-1111-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000002','Firma B','musteri');
set role authenticated; select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false);
-- ---------- Patlamadan korunma teklifi ----------
select tst.works('OSGB teklifi eskisi gibi eklenir', $$insert into offers(id, company_id, employee_count, hazard_class, pricing, fixed_monthly_price) values ('a0a0a0a0-0000-0000-0000-000000000001','aaaaaaaa-1111-0000-0000-000000000001',20,'tehlikeli','sabit_aylik',5000)$$);
select tst.works('Patlamadan korunma teklifi: yalnızca hizmet bedeli, KDV, açıklama, kapsam', $$insert into offers(id, company_id, offer_type, pricing, service_fee, vat_rate, description, scope) values ('a0a0a0a0-0000-0000-0000-000000000002','aaaaaaaa-1111-0000-0000-000000000001','patlamadan_korunma','ozel',12000,20,'Açıklama','Kapsam metni')$$);
select tst.ok('Teklif numarası verilir, çalışan ve tehlike boş', (select offer_no like 'TKL-%' and employee_count is null and hazard_class is null and offer_type = 'patlamadan_korunma' from offers where id = 'a0a0a0a0-0000-0000-0000-000000000002'));
select tst.fails('Hizmet bedeli olmadan eklenemez', $$insert into offers(company_id, offer_type, pricing) values ('aaaaaaaa-1111-0000-0000-000000000001','patlamadan_korunma','ozel')$$);
select tst.fails('Negatif hizmet bedeli reddedilir', $$insert into offers(company_id, offer_type, pricing, service_fee) values ('aaaaaaaa-1111-0000-0000-000000000001','patlamadan_korunma','ozel',-1)$$);
select tst.fails('Patlamadan korunmada indirim kullanılmaz', $$insert into offers(company_id, offer_type, pricing, service_fee, discount_pct) values ('aaaaaaaa-1111-0000-0000-000000000001','patlamadan_korunma','ozel',100,10)$$, 'indirim');
select tst.fails('OSGB teklifinde çalışan sayısı zorunlu kalır', $$insert into offers(company_id, hazard_class, pricing, fixed_monthly_price) values ('aaaaaaaa-1111-0000-0000-000000000001','tehlikeli','sabit_aylik',1)$$);
select tst.fails('Geçersiz teklif türü reddedilir', $$insert into offers(company_id, offer_type, pricing, service_fee) values ('aaaaaaaa-1111-0000-0000-000000000001','baska','ozel',1)$$);
select tst.works('Kapsam ve bedel taslakta düzenlenir', $$update offers set service_fee = 13000, scope = 'Yeni kapsam' where id = 'a0a0a0a0-0000-0000-0000-000000000002'$$);
select tst.works('Kopyalama tür, bedel ve kapsamı taşır', $$select public.teklif_kopyala('a0a0a0a0-0000-0000-0000-000000000002')$$);
select tst.ok('Kopya doğru alanlarla oluştu', (select count(*) from offers where offer_type = 'patlamadan_korunma' and service_fee = 13000 and scope = 'Yeni kapsam') = 2);
select tst.works('Gönderildi olarak işaretlenir', $$update offers set status = 'gonderildi' where id = 'a0a0a0a0-0000-0000-0000-000000000002'$$);
select tst.fails('Gönderilmiş teklifin hizmet bedeli değiştirilemez', $$update offers set service_fee = 1 where id = 'a0a0a0a0-0000-0000-0000-000000000002'$$, 'değiştirilemez');
select tst.fails('Gönderilmiş teklifin kapsamı değiştirilemez', $$update offers set scope = 'x' where id = 'a0a0a0a0-0000-0000-0000-000000000002'$$, 'değiştirilemez');
select tst.works('Gönderilmiş patlamadan korunma teklifi kabul edildi olur', $$update offers set status = 'kabul_edildi' where id = 'a0a0a0a0-0000-0000-0000-000000000002'$$);
select tst.fails('Patlamadan korunma teklifi sözleşmeye çevrilemez', $$insert into contracts(company_id, offer_id, start_date, end_date, status) values ('aaaaaaaa-1111-0000-0000-000000000001','a0a0a0a0-0000-0000-0000-000000000002','2026-01-01','2026-12-31','aktif')$$, 'sözleşme oluşturulmaz');
-- müşteri sayfası
insert into offers(id, organization_id, company_id, offer_type, pricing, service_fee, vat_rate, description, scope, status, offer_no)
values ('a0a0a0a0-0000-0000-0000-000000000003','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-1111-0000-0000-000000000001','patlamadan_korunma','ozel',8000,20,'Açıklama X','Kapsam X','taslak','TKL-TEST-1');
update offers set status = 'gonderildi' where id = 'a0a0a0a0-0000-0000-0000-000000000003';
create temp table jt(ad text primary key, token text); grant all on jt to authenticated, anon;
set role authenticated; select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false);
select tst.works('Müşteri bağlantısı oluşturulur', $$insert into jt select 't1', public.teklif_baglantisi_olustur('a0a0a0a0-0000-0000-0000-000000000003', 30, null)$$);
reset role; set role anon;
select tst.ok('Müşteri görünümü tür, bedel, açıklama ve kapsamı verir', (select r ->> 'teklif_turu' = 'patlamadan_korunma' and (r ->> 'hizmet_bedeli')::numeric = 8000 and r ->> 'aciklama' = 'Açıklama X' and r ->> 'kapsam' = 'Kapsam X' and r ->> 'calisan_sayisi' is null
  from (select public.teklif_paylasim_goruntule((select token from jt where ad='t1')) as r) q));
reset role;
-- ---------- Günlük özet: Geçmiş Hatırlatmalar ----------
delete from calendar_items;
insert into calendar_items(id, organization_id, title, kind, start_date, recurrence, amount) values
 ('c3c3c3c3-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001','Gecikmiş hatırlatma','hatirlatma',(select bugun - 10 from g),'yok',null),
 ('c3c3c3c3-0000-0000-0000-000000000002','aaaaaaaa-0000-0000-0000-000000000001','Yapıldı işaretli','odeme',(select bugun - 5 from g),'yok',700),
 ('c3c3c3c3-0000-0000-0000-000000000003','aaaaaaaa-0000-0000-0000-000000000001','Çok eski','hatirlatma',(select bugun - 200 from g),'yok',null),
 ('c3c3c3c3-0000-0000-0000-000000000004','aaaaaaaa-0000-0000-0000-000000000001','Bugünkü','hatirlatma',(select bugun from g),'yok',null),
 ('c3c3c3c3-0000-0000-0000-000000000005','aaaaaaaa-0000-0000-0000-000000000001','Gecikmiş ödeme','odeme',(select bugun - 3 from g),'yok',2500);
insert into calendar_completions(organization_id, item_id, occurrence_date) values ('aaaaaaaa-0000-0000-0000-000000000001','c3c3c3c3-0000-0000-0000-000000000002',(select bugun - 5 from g));
create temp table oz as select public.gunluk_ozet('aaaaaaaa-0000-0000-0000-000000000001') j;
select tst.ok('Geçmiş hatırlatmalar: yalnızca işaretlenmemiş, son 90 gün, bugün hariç (2 kayıt)', (select (j->'gecmis_hatirlatma'->>'adet')::int = 2 from oz));
select tst.ok('Gecikme günü doğru (10 ve 3 gün), en eski önce', (select j->'gecmis_hatirlatma'->'liste'->0->>'baslik' = 'Gecikmiş hatırlatma' and (j->'gecmis_hatirlatma'->'liste'->0->>'gecikme_gun')::int = 10 and (j->'gecmis_hatirlatma'->'liste'->1->>'gecikme_gun')::int = 3 from oz));
select tst.ok('Ödeme tutarı ve türü listede', (select j->'gecmis_hatirlatma'->'liste' @> '[{"baslik":"Gecikmiş ödeme","tutar":2500,"tur":"odeme"}]'::jsonb from oz));
select tst.ok('Eski alanlar bozulmadı', (select j ? 'bugun' and j ? 'program' from oz));
insert into calendar_items(organization_id, title, kind, start_date, recurrence) values ('bbbbbbbb-0000-0000-0000-000000000002','Başka kurum','hatirlatma',(select bugun - 2 from g),'yok');
select tst.ok('Başka kurumun hatırlatması karışmaz', (select (public.gunluk_ozet('aaaaaaaa-0000-0000-0000-000000000001')->'gecmis_hatirlatma'->>'adet')::int = 2));
insert into calendar_items(organization_id, title, kind, start_date, recurrence, amount) values ('aaaaaaaa-0000-0000-0000-000000000001','Aylık SGK','odeme',(select bugun - 65 from g),'aylik',100);
select tst.ok('Aylık tekrar eden işaretsiz kayıtlar son 90 günde sayılır', (select (public.gunluk_ozet('aaaaaaaa-0000-0000-0000-000000000001')->'gecmis_hatirlatma'->>'adet')::int >= 4));
update offers set description = 'GİZLİ iç not', status = 'gonderildi' where id = 'a0a0a0a0-0000-0000-0000-000000000001';
set role authenticated; select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false);
insert into jt select 't2', public.teklif_baglantisi_olustur('a0a0a0a0-0000-0000-0000-000000000001', 30, null);
reset role;
select tst.ok('OSGB teklifinin iç açıklaması müşteri görünümünde yok', (select r ->> 'aciklama' is null and r ->> 'kapsam' is null and r ->> 'teklif_turu' = 'osgb' and r::text not like '%GİZLİ%' from (select public.teklif_paylasim_goruntule((select token from jt where ad='t2')) as r) q));
