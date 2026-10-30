-- OSGB 360 - Aşama 12 veri tabanı testleri (yerel PostgreSQL 16 + Supabase taklidi)
-- Sıra: supabase_stub.sql -> 01_sema.sql -> 03..11 -> 12_asama12.sql -> bu dosya (boş bir veri tabanında)
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

-- ---------- Bağlantı oluşturma ----------
set role authenticated;
select set_config('request.jwt.claim.sub','22222222-2222-2222-2222-222222222222',false);
select tst.works('Satış (teklif düzenleme izni var): bağlantı oluşturur', $$insert into jt select 't1', public.teklif_baglantisi_olustur('aaaaaaaa-5555-0000-0000-000000000001', 30, '  Merhaba, teklifimiz ektedir.  ')$$);
select tst.ok('Anahtar 64 onaltılık karakter', (select token ~ '^[0-9a-f]{64}$' from jt where ad = 't1'));
select tst.fails('Taslak teklif için bağlantı oluşturulamaz', $$select public.teklif_baglantisi_olustur('aaaaaaaa-5555-0000-0000-000000000002')$$, 'Gönderildi');
select tst.fails('Başka kurumun teklifi için oluşturulamaz', $$select public.teklif_baglantisi_olustur('bbbbbbbb-5555-0000-0000-000000000003')$$, 'bulunamadı');
select tst.fails('Süre 0 gün reddedilir', $$select public.teklif_baglantisi_olustur('aaaaaaaa-5555-0000-0000-000000000005', 0)$$, '1 ile 90');
select tst.fails('Süre 91 gün reddedilir', $$select public.teklif_baglantisi_olustur('aaaaaaaa-5555-0000-0000-000000000005', 91)$$, '1 ile 90');
select tst.fails('1001 karakterlik not reddedilir', $$select public.teklif_baglantisi_olustur('aaaaaaaa-5555-0000-0000-000000000005', 30, repeat('x', 1001))$$, '1000 karakter');
select set_config('request.jwt.claim.sub','33333333-3333-3333-3333-333333333333',false);
select tst.fails('Finans (teklif izni yok) bağlantı oluşturamaz', $$select public.teklif_baglantisi_olustur('aaaaaaaa-5555-0000-0000-000000000001')$$, 'yetkiniz yok');
select tst.fails('Finans bağlantı iptal edemez', $$select public.teklif_baglantisi_iptal('aaaaaaaa-5555-0000-0000-000000000001')$$, 'yetkiniz yok');
select set_config('request.jwt.claim.sub','44444444-4444-4444-4444-444444444444',false);
select tst.fails('Başka kurumun sahibi bu teklif için bağlantı oluşturamaz', $$select public.teklif_baglantisi_olustur('aaaaaaaa-5555-0000-0000-000000000001')$$, 'bulunamadı');
select tst.fails('Başka kurumun sahibi iptal edemez', $$select public.teklif_baglantisi_iptal('aaaaaaaa-5555-0000-0000-000000000001')$$, 'bulunamadı');
reset role;

select tst.ok('Veri tabanında anahtarın kendisi yok, yalnızca SHA-256 özeti var',
  (select count(*) from offer_shares where token_hash = (select token from jt where ad='t1')) = 0
  and (select token_hash from offer_shares limit 1) = encode(sha256(convert_to((select token from jt where ad='t1'), 'UTF8')), 'hex'));
select tst.ok('Not kırpılarak saklanır', (select customer_note from offer_shares limit 1) = 'Merhaba, teklifimiz ektedir.');
select tst.ok('Süre ~30 gün', (select expires_at between now() + interval '29 days 23 hours' and now() + interval '30 days 1 hour' from offer_shares limit 1));

-- ---------- Girişsiz görüntüleme ----------
set role anon;
select set_config('request.jwt.claim.sub','',false);
select tst.ok('Anon: geçerli anahtarla teklif görünür', (select public.teklif_paylasim_goruntule((select token from jt where ad='t1')) ->> 'durum') = 'gecerli');
select tst.ok('Anon: alıcı, kurum, teklif no, kalem doğru', (select r ->> 'alici' = 'Alfa Gıda' and r ->> 'kurum' = 'Karma OSGB' and r ->> 'teklif_no' = 'T-1'
    and jsonb_array_length(r -> 'kalemler') = 1 and r -> 'kalemler' -> 0 ->> 'aciklama' = 'Risk analizi eğitimi' and r ->> 'musteri_notu' = 'Merhaba, teklifimiz ektedir.'
  from (select public.teklif_paylasim_goruntule((select token from jt where ad='t1')) as r) q));
select tst.ok('Anon: yalnızca izin verilen alanlar döner (maliyet, iç not, hazırlayan YOK)',
  (select array(select jsonb_object_keys(r) order by 1) = array['alici','birim_fiyat','calisan_sayisi','durum','fiyatlama','gecerlilik','indirim','kalemler','kdv_modu','kdv_orani','kurum',
      'musteri_notu','sabit_fiyat','sure_bitti','tehlike','teklif_durumu','teklif_no','teklif_tarihi','yanit','yanit_verilebilir']
  from (select public.teklif_paylasim_goruntule((select token from jt where ad='t1')) as r) q));
select tst.ok('Anon: yanıtta maliyet/iç not/hazırlayan değeri geçmez',
  (select r::text !~ '(12345|7654|999\.99|GİZLİ|22222222)' from (select public.teklif_paylasim_goruntule((select token from jt where ad='t1')) as r) q));
select tst.ok('Anon: arşivlenmiş kalem görünmez', (select r::text not like '%Kaldırılmış%' from (select public.teklif_paylasim_goruntule((select token from jt where ad='t1')) as r) q));
select tst.ok('Anon: yanıt verilebilir', (select (r ->> 'yanit_verilebilir')::boolean from (select public.teklif_paylasim_goruntule((select token from jt where ad='t1')) as r) q));
select tst.ok('Anon: yanlış anahtar → geçersiz', (select public.teklif_paylasim_goruntule(repeat('a', 64)) ->> 'durum') = 'gecersiz');
select tst.ok('Anon: biçimi bozuk anahtar → geçersiz', (select public.teklif_paylasim_goruntule('x'' or 1=1 --') ->> 'durum') = 'gecersiz' and (select public.teklif_paylasim_goruntule(null) ->> 'durum') = 'gecersiz' and (select public.teklif_paylasim_goruntule('') ->> 'durum') = 'gecersiz');
select tst.ok('Geçersiz yanıtta başka bilgi yok', (select public.teklif_paylasim_goruntule(repeat('b', 64))::text) = '{"durum": "gecersiz"}');
select tst.fails('Anon: tabloyu doğrudan okuyamaz', $$select * from offer_shares$$, 'permission denied');
select tst.fails('Anon: tabloya doğrudan yazamaz', $$insert into offer_shares(organization_id,offer_id,token_hash,expires_at) values ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-5555-0000-0000-000000000001','x',now())$$, 'permission denied');
select tst.fails('Anon: teklifler tablosunu okuyamaz', $$select * from offers$$, 'permission denied');
select tst.fails('Anon: sahip fonksiyonunu çağıramaz', $$select public.teklif_baglantisi_olustur('aaaaaaaa-5555-0000-0000-000000000001')$$, 'permission denied');
select tst.fails('Anon: iç yardımcıyı çağıramaz', $$select app.paylasim_bul(repeat('a', 64))$$, 'permission denied');
reset role;
select tst.ok('Görüntüleme sayacı işledi (3 geçerli görüntüleme sonrası)', (select view_count from offer_shares where offer_id = 'aaaaaaaa-5555-0000-0000-000000000001' and revoked_at is null) >= 3
  and (select first_viewed_at is not null and last_viewed_at is not null from offer_shares where offer_id = 'aaaaaaaa-5555-0000-0000-000000000001' and revoked_at is null));

-- ---------- Sahip: okuma yetkisi ve gizli sütun ----------
set role authenticated;
select set_config('request.jwt.claim.sub','22222222-2222-2222-2222-222222222222',false);
select tst.ok('Satış bağlantı durumunu okur (token_hash hariç sütunlar)', (select count(*) from (select id, offer_id, expires_at, view_count, response from offer_shares) q) = 1);
select tst.fails('Girişli kullanıcı token_hash sütununu okuyamaz', $$select token_hash from offer_shares$$, 'permission denied');
select tst.fails('Girişli kullanıcı select * yapamaz (token_hash sütunu kapalı)', $$select * from offer_shares$$, 'permission denied');
select tst.fails('Girişli kullanıcı doğrudan ekleyemez', $$insert into offer_shares(organization_id,offer_id,token_hash,expires_at) values ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-5555-0000-0000-000000000005','y',now())$$, 'permission denied');
select tst.fails('Girişli kullanıcı doğrudan güncelleyemez (yanıtı değiştirmek)', $$update offer_shares set response = 'kabul'$$, 'permission denied');
select tst.fails('Girişli kullanıcı silemez', $$delete from offer_shares$$, 'permission denied');
select set_config('request.jwt.claim.sub','33333333-3333-3333-3333-333333333333',false);
select tst.ok('Finans (teklif izni yok) bağlantıları görmez', (select count(*) from (select id from offer_shares) q) = 0);
select set_config('request.jwt.claim.sub','44444444-4444-4444-4444-444444444444',false);
select tst.ok('Başka kurum bağlantıları görmez', (select count(*) from (select id from offer_shares) q) = 0);
reset role;

-- ---------- Yanıt ----------
set role anon; select set_config('request.jwt.claim.sub','',false);
select tst.fails('Yanıt: geçersiz anahtar reddedilir', $$select public.teklif_paylasim_yanitla(repeat('c', 64), 'kabul', 'Ali Veli')$$, 'geçersiz ya da süresi dolmuş');
select tst.fails('Yanıt: geçersiz karar reddedilir', format($$select public.teklif_paylasim_yanitla(%L, 'belki', 'Ali Veli')$$, (select token from jt where ad='t1')), 'Geçersiz yanıt');
select tst.fails('Yanıt: çok kısa ad reddedilir', format($$select public.teklif_paylasim_yanitla(%L, 'kabul', 'A')$$, (select token from jt where ad='t1')), 'adınızı');
select tst.fails('Yanıt: boş ad reddedilir', format($$select public.teklif_paylasim_yanitla(%L, 'kabul', '   ')$$, (select token from jt where ad='t1')), 'adınızı');
select tst.fails('Yanıt: 81 karakterlik ad reddedilir', format($$select public.teklif_paylasim_yanitla(%L, 'kabul', %L)$$, (select token from jt where ad='t1'), repeat('a', 81)), 'adınızı');
select tst.fails('Yanıt: 501 karakterlik not reddedilir', format($$select public.teklif_paylasim_yanitla(%L, 'kabul', 'Ali Veli', %L)$$, (select token from jt where ad='t1'), repeat('n', 501)), '500 karakter');
reset role;
select tst.ok('Reddedilen denemeler hiçbir şey kaydetmedi', (select count(*) from offer_shares where response is not null) = 0 and (select count(*) from tasks where source_ref like 'offer_share:%') = 0);
set role anon; select set_config('request.jwt.claim.sub','',false);
select tst.works('Yanıt: müşteri KABUL eder', format($$select public.teklif_paylasim_yanitla(%L, 'kabul', E'  Ali\tVeli\n', 'Sözleşme taslağını bekliyoruz.')$$, (select token from jt where ad='t1')));
select tst.fails('Yanıt: ikinci kez yanıtlanamaz', format($$select public.teklif_paylasim_yanitla(%L, 'red', 'Ali Veli')$$, (select token from jt where ad='t1')), 'zaten yanıt verilmiş');
select tst.ok('Anon: yanıt görünür, tekrar yanıt verilemez', (select r -> 'yanit' ->> 'karar' = 'kabul' and r -> 'yanit' ->> 'ad' = 'Ali Veli' and not (r ->> 'yanit_verilebilir')::boolean
  from (select public.teklif_paylasim_goruntule((select token from jt where ad='t1')) as r) q));
reset role;
select tst.ok('Yanıt kaydı: kontrol karakterleri temizlenmiş ad, not, zaman', (select response = 'kabul' and responder_name = 'Ali Veli' and responder_note = 'Sözleşme taslağını bekliyoruz.' and responded_at is not null from offer_shares where offer_id = 'aaaaaaaa-5555-0000-0000-000000000001'));
select tst.ok('Teklif durumu kendiliğinden DEĞİŞMEDİ (karar sahipte)', (select status = 'gonderildi' from offers where id = 'aaaaaaaa-5555-0000-0000-000000000001'));
select tst.ok('Sözleşme oluşmadı', (select count(*) from contracts) = 0);
select tst.ok('Sahibe görev düştü: yüksek öncelik, açık, hazırlayana atanmış, teklif takibi', (select count(*) from tasks where source_ref like 'offer_share:%' and kind = 'teklif_takibi' and priority = 'yuksek' and status = 'acik'
  and assignee = '22222222-2222-2222-2222-222222222222' and title = 'Müşteri teklifi KABUL ETTİ: T-1' and company_id = 'aaaaaaaa-1111-0000-0000-000000000001' and description like '%Ali Veli%' and organization_id = 'aaaaaaaa-0000-0000-0000-000000000001') = 1);

-- ---------- Yanıt: reddetme, süre, durum ----------
set role authenticated; select set_config('request.jwt.claim.sub','22222222-2222-2222-2222-222222222222',false);
select tst.works('Yeni bağlantı (T-5)', $$insert into jt select 't5', public.teklif_baglantisi_olustur('aaaaaaaa-5555-0000-0000-000000000005', 7)$$);
select tst.works('Yeni bağlantı (T-4, süresi dolmuş teklif)', $$insert into jt select 't4', public.teklif_baglantisi_olustur('aaaaaaaa-5555-0000-0000-000000000004', 7)$$);
reset role;
set role anon; select set_config('request.jwt.claim.sub','',false);
select tst.ok('Süresi dolmuş teklif görüntülenir ama yanıt verilemez', (select (r ->> 'sure_bitti')::boolean and not (r ->> 'yanit_verilebilir')::boolean from (select public.teklif_paylasim_goruntule((select token from jt where ad='t4')) as r) q));
select tst.fails('Süresi dolmuş teklife yanıt verilemez', format($$select public.teklif_paylasim_yanitla(%L, 'kabul', 'Ali Veli')$$, (select token from jt where ad='t4')), 'geçerlilik süresi dolmuş');
select tst.works('Müşteri REDDEDER', format($$select public.teklif_paylasim_yanitla(%L, 'red', 'Ayşe Kaya')$$, (select token from jt where ad='t5')));
reset role;
select tst.ok('Red görevi oluştu', (select count(*) from tasks where title = 'Müşteri teklifi reddetti: T-5') = 1);
select tst.ok('Red sonrası teklif durumu değişmedi', (select status = 'gonderildi' from offers where id = 'aaaaaaaa-5555-0000-0000-000000000005'));

-- durum değişince / arşivlenince / iptal edilince / süre dolunca bağlantı kapanır
set role authenticated; select set_config('request.jwt.claim.sub','22222222-2222-2222-2222-222222222222',false);
select tst.works('T-1 için yeni bağlantı eskisini iptal eder', $$insert into jt select 't1b', public.teklif_baglantisi_olustur('aaaaaaaa-5555-0000-0000-000000000001', 5)$$);
reset role;
select tst.ok('Eski bağlantı iptal edildi, yeni aktif; teklif başına tek aktif bağlantı', (select count(*) from offer_shares where offer_id = 'aaaaaaaa-5555-0000-0000-000000000001' and revoked_at is null) = 1
  and (select count(*) from offer_shares where offer_id = 'aaaaaaaa-5555-0000-0000-000000000001') = 2);
set role anon; select set_config('request.jwt.claim.sub','',false);
select tst.ok('Anon: iptal edilen eski bağlantı artık geçersiz', (select public.teklif_paylasim_goruntule((select token from jt where ad='t1')) ->> 'durum') = 'gecersiz');
select tst.ok('Anon: yeni bağlantı geçerli ve yanıt sayfası boş', (select r ->> 'durum' = 'gecerli' and r -> 'yanit' = 'null'::jsonb from (select public.teklif_paylasim_goruntule((select token from jt where ad='t1b')) as r) q));
reset role;
set role authenticated; select set_config('request.jwt.claim.sub','22222222-2222-2222-2222-222222222222',false);
select tst.ok('İptal fonksiyonu 1 bağlantıyı kapatır', (select public.teklif_baglantisi_iptal('aaaaaaaa-5555-0000-0000-000000000001')) = 1);
select tst.ok('Tekrar iptal 0 döner', (select public.teklif_baglantisi_iptal('aaaaaaaa-5555-0000-0000-000000000001')) = 0);
reset role;
set role anon; select set_config('request.jwt.claim.sub','',false);
select tst.ok('Anon: iptal edilen bağlantı geçersiz', (select public.teklif_paylasim_goruntule((select token from jt where ad='t1b')) ->> 'durum') = 'gecersiz');
reset role;
-- süre dolması
set role authenticated; select set_config('request.jwt.claim.sub','22222222-2222-2222-2222-222222222222',false);
select tst.works('T-5 için bağlantı', $$insert into jt select 't5b', public.teklif_baglantisi_olustur('aaaaaaaa-5555-0000-0000-000000000005', 3)$$);
reset role;
update offer_shares set expires_at = now() - interval '1 second' where offer_id = 'aaaaaaaa-5555-0000-0000-000000000005' and revoked_at is null;
set role anon; select set_config('request.jwt.claim.sub','',false);
select tst.ok('Anon: süresi dolan bağlantı geçersiz', (select public.teklif_paylasim_goruntule((select token from jt where ad='t5b')) ->> 'durum') = 'gecersiz');
select tst.fails('Süresi dolan bağlantıyla yanıt verilemez', format($$select public.teklif_paylasim_yanitla(%L, 'kabul', 'Ali Veli')$$, (select token from jt where ad='t5b')), 'geçersiz ya da süresi dolmuş');
reset role;
-- arşiv ve durum
set role authenticated; select set_config('request.jwt.claim.sub','22222222-2222-2222-2222-222222222222',false);
select tst.works('T-5 yeni bağlantı', $$insert into jt select 't5c', public.teklif_baglantisi_olustur('aaaaaaaa-5555-0000-0000-000000000005', 3)$$);
reset role;
update offers set status = 'reddedildi' where id = 'aaaaaaaa-5555-0000-0000-000000000005';
set role anon; select set_config('request.jwt.claim.sub','',false);
select tst.ok('Teklif reddedildi olunca: görüntülenir, durum belirtilir, yanıt verilemez', (select r ->> 'teklif_durumu' = 'reddedildi' and not (r ->> 'yanit_verilebilir')::boolean from (select public.teklif_paylasim_goruntule((select token from jt where ad='t5c')) as r) q));
reset role;
set role authenticated; select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false);
update offers set archived_at = now() where id = 'aaaaaaaa-5555-0000-0000-000000000005';
reset role;
set role anon; select set_config('request.jwt.claim.sub','',false);
select tst.ok('Teklif arşivlenince bağlantı geçersiz', (select public.teklif_paylasim_goruntule((select token from jt where ad='t5c')) ->> 'durum') = 'gecersiz');
reset role;
-- reddedilmiş teklif için bağlantı oluşturulamaz
set role authenticated; select set_config('request.jwt.claim.sub','22222222-2222-2222-2222-222222222222',false);
select tst.fails('Arşivlenmiş/reddedilmiş teklif için bağlantı oluşturulamaz', $$select public.teklif_baglantisi_olustur('aaaaaaaa-5555-0000-0000-000000000005')$$);
reset role;

-- ---------- Denetim ----------
select tst.ok('Denetim: bağlantı oluşturma/yanıt kaydı var, token_hash içermez', (select count(*) from audit_logs where table_name = 'offer_shares') >= 4
  and (select count(*) from audit_logs where table_name = 'offer_shares' and (new_data ? 'token_hash' or old_data ? 'token_hash')) = 0);
select tst.ok('Denetim: yanıt güncellemesi görünür', (select count(*) from audit_logs where table_name = 'offer_shares' and action = 'UPDATE' and old_data ->> 'response' is null and new_data ->> 'response' = 'kabul') = 1);
select tst.ok('audit_modul: offer_shares → offers', app.audit_modul('offer_shares') = 'offers' and app.audit_modul('companies') = 'companies' and app.audit_modul('employee_costs') = 'payroll');
