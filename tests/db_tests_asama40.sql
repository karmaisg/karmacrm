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
insert into auth.users(id,email) values ('33333333-3333-3333-3333-333333333333','satis2@karma.test'),('44444444-4444-4444-4444-444444444444','sahipb@karma.test');
insert into users(id,organization_id,role_id,full_name,email)
select u.id, r.organization_id, r.id, u.ad, u.eposta from (values
  ('33333333-3333-3333-3333-333333333333'::uuid,'uzman_hekim','aaaaaaaa-0000-0000-0000-000000000001'::uuid,'Hekim','satis2@karma.test'),
  ('44444444-4444-4444-4444-444444444444','isletme_sahibi','bbbbbbbb-0000-0000-0000-000000000002','Sahip B','sahipb@karma.test')) as u(id,rol,org,ad,eposta)
join roles r on r.key = u.rol and r.organization_id = u.org;
create temp table sonuc(ad text, v jsonb); grant all on sonuc to authenticated, anon;
set role authenticated; select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false);
-- ---------- Teklif PDF'i ----------
insert into offers(id, company_id, employee_count, hazard_class, pricing, fixed_monthly_price) values ('a0a0a0a0-0000-0000-0000-000000000001','aaaaaaaa-1111-0000-0000-000000000001',6,'cok_tehlikeli','sabit_aylik',7000);
update offers set status = 'gonderildi' where id = 'a0a0a0a0-0000-0000-0000-000000000001';
-- "%PDF-1.4 test" → base64
select tst.works('PDF yüklenir', $$insert into sonuc select 'y1', public.teklif_pdf_yukle('a0a0a0a0-0000-0000-0000-000000000001', 'Teklif 2026.pdf', encode('%PDF-1.4 ornek icerik'::bytea, 'base64'))$$);
select tst.ok('Ad ve boyut döner', (select v ->> 'ad' = 'Teklif 2026.pdf' and (v ->> 'boyut')::int = 21 from sonuc where ad = 'y1'));
select tst.fails('PDF olmayan dosya reddedilir', $$select public.teklif_pdf_yukle('a0a0a0a0-0000-0000-0000-000000000001', 'x.pdf', encode('MZ exe dosyasi'::bytea, 'base64'))$$);
select tst.fails('.pdf uzantısı zorunlu', $$select public.teklif_pdf_yukle('a0a0a0a0-0000-0000-0000-000000000001', 'x.exe', encode('%PDF-1.4 x'::bytea, 'base64'))$$);
select tst.fails('Bozuk base64 reddedilir', $$select public.teklif_pdf_yukle('a0a0a0a0-0000-0000-0000-000000000001', 'x.pdf', '!!!bozuk###')$$);
select tst.fails('3 MB üstü reddedilir', $$select public.teklif_pdf_yukle('a0a0a0a0-0000-0000-0000-000000000001', 'x.pdf', encode('%PDF-1.4'::bytea || decode(repeat('00', 3145800), 'hex'), 'base64'))$$);
select tst.fails('Olmayan teklif', $$select public.teklif_pdf_yukle('99999999-0000-0000-0000-000000000009', 'x.pdf', encode('%PDF-1.4 x'::bytea, 'base64'))$$);
select tst.ok('Tek aktif PDF', (select count(*) = 1 from offer_pdfs where offer_id = 'a0a0a0a0-0000-0000-0000-000000000001' and archived_at is null));
select tst.works('İkinci yükleme öncekini arşive alır', $$select public.teklif_pdf_yukle('a0a0a0a0-0000-0000-0000-000000000001', 'Yeni.pdf', encode('%PDF-1.7 yeni'::bytea, 'base64'))$$);
select tst.ok('Aktif 1, arşiv 1', (select count(*) filter (where archived_at is null) = 1 and count(*) = 2 from offer_pdfs where offer_id = 'a0a0a0a0-0000-0000-0000-000000000001'));
select tst.ok('Yönetici getirir: içerik geri çözülür', (select convert_from(decode(public.teklif_pdf_getir('a0a0a0a0-0000-0000-0000-000000000001') ->> 'veri', 'base64'), 'UTF8') = '%PDF-1.7 yeni'));
select tst.ok('Meta okunabilir, içerik sütunu okunamaz', (select count(*) = 1 from offer_pdfs where archived_at is null));
select tst.fails('İçerik sütunu doğrudan okunamaz', $$select content from offer_pdfs$$);
select tst.fails('Doğrudan ekleme yok', $$insert into offer_pdfs(offer_id, file_name, size_bytes, content) values ('a0a0a0a0-0000-0000-0000-000000000001','x.pdf',1,'\x00')$$);
select tst.ok('Denetim kaydı yazıldı (içerik yok)', (select count(*) = 2 and bool_and(new_data ? 'file_name') and bool_and(not new_data::text like '%content%') and app.audit_modul('offer_pdfs') = 'offers' from audit_logs where table_name = 'offer_pdfs'));
-- müşteri tarafı (token)
select tst.works('Bağlantı oluşturulur', $$insert into sonuc select 'tok', to_jsonb(public.teklif_baglantisi_olustur('a0a0a0a0-0000-0000-0000-000000000001', 30, null))$$);
reset role; grant select on sonuc to anon;
set role anon;
select tst.ok('Müşteri: bilgi (içeriksiz)', (select (public.teklif_paylasim_pdf(v #>> '{}') ->> 'durum') = 'var' and public.teklif_paylasim_pdf(v #>> '{}') ->> 'ad' = 'Yeni.pdf' and not (public.teklif_paylasim_pdf(v #>> '{}') ? 'veri') from sonuc where ad = 'tok'));
select tst.ok('Müşteri: dosya indirilir', (select convert_from(decode(public.teklif_paylasim_pdf(v #>> '{}', true) ->> 'veri', 'base64'), 'UTF8') = '%PDF-1.7 yeni' from sonuc where ad = 'tok'));
select tst.ok('Geçersiz anahtar reddedilir', (public.teklif_paylasim_pdf(repeat('a', 64), true) ->> 'durum') = 'gecersiz' and (public.teklif_paylasim_pdf('zz') ->> 'durum') = 'gecersiz');
select tst.fails('Müşteri yükleyemez', $$select public.teklif_pdf_yukle('a0a0a0a0-0000-0000-0000-000000000001', 'x.pdf', encode('%PDF-1.4 x'::bytea, 'base64'))$$);
select tst.fails('Müşteri yönetici getirisini çağıramaz', $$select public.teklif_pdf_getir('a0a0a0a0-0000-0000-0000-000000000001')$$);
reset role;
-- yetkisiz rol (uzman_hekim: teklif yetkisi yok), başka kurum
set role authenticated; select set_config('request.jwt.claim.sub','33333333-3333-3333-3333-333333333333',false);
select tst.fails('Yetkisiz rol yükleyemez', $$select public.teklif_pdf_yukle('a0a0a0a0-0000-0000-0000-000000000001', 'x.pdf', encode('%PDF-1.4 x'::bytea, 'base64'))$$);
select tst.fails('Yetkisiz rol getiremez', $$select public.teklif_pdf_getir('a0a0a0a0-0000-0000-0000-000000000001')$$);
select tst.ok('Yetkisiz rol meta göremez', (select count(*) = 0 from offer_pdfs));
select set_config('request.jwt.claim.sub','44444444-4444-4444-4444-444444444444',false);
select tst.fails('Başka kurum yükleyemez', $$select public.teklif_pdf_yukle('a0a0a0a0-0000-0000-0000-000000000001', 'x.pdf', encode('%PDF-1.4 x'::bytea, 'base64'))$$);
select tst.ok('Başka kurum göremez', (select count(*) = 0 from offer_pdfs) and public.teklif_pdf_getir('a0a0a0a0-0000-0000-0000-000000000001') is null);
select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false);
select tst.works('Kaldır', $$select public.teklif_pdf_kaldir('a0a0a0a0-0000-0000-0000-000000000001')$$);
reset role; set role anon;
select tst.ok('Kaldırınca müşteride yok', (select (public.teklif_paylasim_pdf(v #>> '{}') ->> 'durum') = 'yok' from sonuc where ad = 'tok'));
reset role;
