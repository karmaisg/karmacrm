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
insert into auth.users(id,email) values ('33333333-3333-3333-3333-333333333333','ops@karma.test'),('44444444-4444-4444-4444-444444444444','sahipb@karma.test'),('55555555-5555-5555-5555-555555555555','uzman@karma.test');
insert into users(id,organization_id,role_id,full_name,email)
select u.id, r.organization_id, r.id, u.ad, u.eposta from (values
  ('33333333-3333-3333-3333-333333333333'::uuid,'operasyon','aaaaaaaa-0000-0000-0000-000000000001'::uuid,'Operasyon','ops@karma.test'),
  ('44444444-4444-4444-4444-444444444444','isletme_sahibi','bbbbbbbb-0000-0000-0000-000000000002','Sahip B','sahipb@karma.test'),
  ('55555555-5555-5555-5555-555555555555','uzman_hekim','aaaaaaaa-0000-0000-0000-000000000001','Uzman','uzman@karma.test')) as u(id,rol,org,ad,eposta)
join roles r on r.key = u.rol and r.organization_id = u.org;
insert into employees(id, organization_id, full_name, staff_type) values
  ('e0e0e0e0-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001','Uzman Ali','is_guvenligi_uzmani'),
  ('e0e0e0e0-0000-0000-0000-000000000002','aaaaaaaa-0000-0000-0000-000000000001','Hekim Veli','isyeri_hekimi');
update employees set email = 'Ali.Uzman@karma.test' where id = 'e0e0e0e0-0000-0000-0000-000000000001';
update employees set email = 'veli.hekim@karma.test' where id = 'e0e0e0e0-0000-0000-0000-000000000002';
update companies set short_code = 'EGE-Çelik' where id = 'aaaaaaaa-1111-0000-0000-000000000001';
create function tst.isle(k jsonb) returns jsonb language sql as $$ select public.karma_ziyaret_isle('aaaaaaaa-0000-0000-0000-000000000001', jsonb_build_array(k), 's1') $$;
create function tst.k(id text, kis text, ep text, tarih text, sure int, silindi boolean default false) returns jsonb language sql as $$
  select jsonb_build_object('id', id, 'firma_kisaltma', kis, 'personel_eposta', ep, 'tarih', tarih, 'sure_dakika', sure, 'silindi', silindi) $$;

select tst.isle(tst.k('r1', 'ege-celik', 'ALI.UZMAN@karma.test', (current_date - 3)::text, 90));
select tst.ok('kayıt işlenir (Türkçe karakter/büyük-küçük harf farkı yok sayılır)', (select son_sonuc->>'islendi' = '1' from karma_senkron));
select tst.ok('zaman kaydı oluştu: ziyaret, 90 dk, doğru firma', (select count(*) = 1 and max(total_minutes) = 90 and bool_and(activity_type = 'ziyaret' and company_id = 'aaaaaaaa-1111-0000-0000-000000000001') from time_entries where employee_id = 'e0e0e0e0-0000-0000-0000-000000000001' and archived_at is null));
select tst.isle(tst.k('r1', 'EGE-Çelik', 'ali.uzman@karma.test', (current_date - 3)::text, 90));
select tst.ok('aynı kayıt tekrar gelince çoğalmaz', (select son_sonuc->>'degismedi' = '1' from karma_senkron) and (select count(*) from time_entries where employee_id = 'e0e0e0e0-0000-0000-0000-000000000001' and archived_at is null) = 1);
select tst.isle(tst.k('r1', 'EGE-Çelik', 'ali.uzman@karma.test', (current_date - 3)::text, 120));
select tst.ok('süre değişince eski arşivlenir, tek aktif kayıt kalır', (select son_sonuc->>'islendi' = '1' from karma_senkron)
  and (select count(*) = 1 and max(total_minutes) = 120 from time_entries where employee_id = 'e0e0e0e0-0000-0000-0000-000000000001' and archived_at is null)
  and (select count(*) = 1 from time_entries where employee_id = 'e0e0e0e0-0000-0000-0000-000000000001' and archived_at is not null));
select tst.isle(tst.k('r2', 'EGE-Çelik', 'ali.uzman@karma.test', (current_date - 3)::text, 30));
select tst.ok('aynı gün ikinci ziyaret çakışmadan sonraya yerleşir', (select son_sonuc->>'islendi' = '1' from karma_senkron)
  and (select count(*) = 2 from time_entries where employee_id = 'e0e0e0e0-0000-0000-0000-000000000001' and archived_at is null));
select tst.isle(tst.k('r3', 'YOK', 'ali.uzman@karma.test', (current_date - 2)::text, 60));
select tst.ok('bilinmeyen kısaltma eşleşmedi olarak saklanır', (select son_sonuc->>'eslesmedi' = '1' from karma_senkron) and (select neden like '%YOK%' from karma_ziyaretler where dis_id = 'r3'));
select tst.isle(tst.k('r4', 'YOK', 'kimse@karma.test', (current_date - 2)::text, 60));
select tst.ok('bilinmeyen e-posta/firma eşleşmedi', (select son_sonuc->>'eslesmedi' = '1' from karma_senkron));
select tst.isle(tst.k('r5', 'EGE-Çelik', 'ali.uzman@karma.test', (current_date + 5)::text, 60));
select tst.ok('gelecek tarih hata olarak saklanır, zaman kaydı oluşmaz', (select son_sonuc->>'hata' = '1' from karma_senkron) and (select time_entry_id is null from karma_ziyaretler where dis_id = 'r5'));
update companies set short_code = 'YOK' where id = 'aaaaaaaa-1111-0000-0000-000000000001';
update employees set email = 'kimse@karma.test' where id = 'e0e0e0e0-0000-0000-0000-000000000002';
select public.karma_eslesmeyenleri_yeniden_dene('aaaaaaaa-0000-0000-0000-000000000001');
select tst.ok('kısaltma/e-posta düzeltilince yeniden denenir', (select count(*) = 2 from karma_ziyaretler where dis_id in ('r3', 'r4') and durum = 'islendi')
  and (select count(*) = 1 from karma_ziyaretler where durum = 'hata'));
select tst.isle(tst.k('r3', 'YOK', 'ali.uzman@karma.test', (current_date - 2)::text, 60, true));
select tst.ok('silindi:true kaydı zaman kaydını arşivler', (select son_sonuc->>'silindi' = '1' from karma_senkron)
  and (select archived_at is not null from time_entries t join karma_ziyaretler z on z.time_entry_id = t.id where z.dis_id = 'r3'));
select tst.ok('imleç ve son durum saklanır', (select imlec = 's1' and son_durum = 'tamam' from karma_senkron where organization_id = 'aaaaaaaa-0000-0000-0000-000000000001'));
select tst.fails('aynı kısaltma iki firmada kullanılamaz', $$insert into companies(organization_id,name,customer_status,short_code) values ('aaaaaaaa-0000-0000-0000-000000000001','Firma C','musteri','yok')$$);
select tst.works('başka kurumda aynı kısaltma olabilir', $$insert into companies(organization_id,name,customer_status,short_code) values ('bbbbbbbb-0000-0000-0000-000000000002','Firma D','musteri','yok')$$);

set role authenticated; select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false);
select tst.fails('oturumlu kullanıcı toplu işleme fonksiyonunu çalıştıramaz', $$select public.karma_ziyaret_isle('aaaaaaaa-0000-0000-0000-000000000001', '[]'::jsonb, null)$$);
select tst.works('sahip eşleşmeyenleri yeniden deneyebilir', $$select public.karma_eslesmeyenleri_yeniden_dene()$$);
select tst.ok('sahip aktarım kayıtlarını görür', (select count(*) > 0 from karma_ziyaretler));
select set_config('request.jwt.claim.sub','55555555-5555-5555-5555-555555555555',false);
select tst.ok('saha personeli aktarım kayıtlarını göremez', (select count(*) = 0 from karma_ziyaretler));
select tst.fails('saha personeli yeniden deneyemez', $$select public.karma_eslesmeyenleri_yeniden_dene()$$);
select set_config('request.jwt.claim.sub','44444444-4444-4444-4444-444444444444',false);
select tst.ok('başka kurum kayıtları görmez', (select count(*) = 0 from karma_ziyaretler));
reset role;
