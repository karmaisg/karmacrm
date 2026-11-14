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
set role authenticated; select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false);
-- ---------- Firma konumu ----------
select tst.works('Konum kaydedilir', $$select public.firma_konum_kaydet('aaaaaaaa-1111-0000-0000-000000000001', 38.4237, 27.1428, 'Gaziemir İzmir', 'google')$$);
select tst.ok('Konum ve kaynak yazıldı', (select latitude = 38.4237 and longitude = 27.1428 and geo_source = 'google' and geo_query = 'Gaziemir İzmir' and geo_at is not null from companies where id = 'aaaaaaaa-1111-0000-0000-000000000001'));
select tst.works('Elle düzeltme', $$select public.firma_konum_kaydet('aaaaaaaa-1111-0000-0000-000000000001', 38.43, 27.15, 'Gaziemir İzmir', 'manuel')$$);
select tst.fails('Enlem sınırı', $$select public.firma_konum_kaydet('aaaaaaaa-1111-0000-0000-000000000001', 95, 27, 'x', 'google')$$);
select tst.fails('Boylam sınırı', $$select public.firma_konum_kaydet('aaaaaaaa-1111-0000-0000-000000000001', 38, 190, 'x', 'google')$$);
select tst.fails('Kaynak geçersiz', $$select public.firma_konum_kaydet('aaaaaaaa-1111-0000-0000-000000000001', 38, 27, 'x', 'baska')$$);
select tst.fails('Tablo kısıtı: tek koordinat olmaz', $$update companies set latitude = 38 , longitude = null where id = 'aaaaaaaa-1111-0000-0000-000000000001'$$);
select tst.fails('Başka kurumun firması', $$select public.firma_konum_kaydet('bbbbbbbb-1111-0000-0000-000000000001', 38, 27, 'x', 'google')$$);
select tst.works('Konum temizlenir', $$select public.firma_konum_kaydet('aaaaaaaa-1111-0000-0000-000000000001', null, null, null, null)$$);
select tst.ok('Temizlendi', (select latitude is null and longitude is null and geo_source is null from companies where id = 'aaaaaaaa-1111-0000-0000-000000000001'));
select tst.ok('Denetim kaydı yazıldı', (select count(*) >= 3 from audit_logs where table_name = 'companies' and record_id = 'aaaaaaaa-1111-0000-0000-000000000001'));
-- ---------- Anahtar ayarı ----------
select tst.works('Anahtar kaydedilir', $$select public.entegrasyon_kaydet('google_maps_api_key', ' AIzaSyD-ornekAnahtar0123456789abcdefgh ')$$);
select tst.ok('Anahtar okunur (boşluksuz)', (select value = 'AIzaSyD-ornekAnahtar0123456789abcdefgh' from integration_settings where key = 'google_maps_api_key'));
select tst.fails('Biçim geçersiz', $$select public.entegrasyon_kaydet('google_maps_api_key', 'kısa anahtar!')$$);
select tst.fails('Başka anahtar adı yok', $$select public.entegrasyon_kaydet('baska', 'AIzaSyD-ornekAnahtar0123456789abcdefgh')$$);
select tst.fails('Doğrudan ekleme yok', $$insert into integration_settings(key, value) values ('google_maps_api_key','AIzaSyD-ornekAnahtar0123456789abcdefgh')$$);
select tst.ok('Denetim kaydında anahtar yok', (select count(*) = 1 and not bool_or(coalesce(new_data::text, '') like '%AIza%') from audit_logs where table_name = 'integration_settings'));
-- ---------- Ziyaret planı ----------
select tst.works('Plan eklenir', $$insert into visit_plans(id, company_id, staff_type, employee_id, planned_date) values ('b0b0b0b0-0000-0000-0000-000000000001','aaaaaaaa-1111-0000-0000-000000000001','is_guvenligi_uzmani','e0e0e0e0-0000-0000-0000-000000000001','2026-11-20')$$);
select tst.works('Personelsiz de eklenir (hekim)', $$insert into visit_plans(company_id, staff_type, planned_date) values ('aaaaaaaa-1111-0000-0000-000000000001','isyeri_hekimi','2026-11-20')$$);
select tst.fails('Aynı firma+tür+gün tekrarı', $$insert into visit_plans(company_id, staff_type, planned_date) values ('aaaaaaaa-1111-0000-0000-000000000001','isyeri_hekimi','2026-11-20')$$);
select tst.fails('Uzman türüne hekim atanamaz', $$insert into visit_plans(company_id, staff_type, employee_id, planned_date) values ('aaaaaaaa-1111-0000-0000-000000000001','is_guvenligi_uzmani','e0e0e0e0-0000-0000-0000-000000000002','2026-11-21')$$);
select tst.fails('Başka kurumun firması', $$insert into visit_plans(company_id, staff_type, planned_date) values ('bbbbbbbb-1111-0000-0000-000000000001','is_guvenligi_uzmani','2026-11-21')$$);
select tst.fails('Uzun not', $$insert into visit_plans(company_id, staff_type, planned_date, note) values ('aaaaaaaa-1111-0000-0000-000000000001','is_guvenligi_uzmani','2026-11-22', repeat('x', 501))$$);
select tst.works('Tarih değiştirilir', $$update visit_plans set planned_date = '2026-11-25' where id = 'b0b0b0b0-0000-0000-0000-000000000001'$$);
select tst.ok('audit_modul eşlemesi', app.audit_modul('visit_plans') = 'time' and app.audit_modul('integration_settings') = 'settings' and app.audit_modul('offer_pdfs') = 'offers' and app.audit_modul('salary_calcs') = 'payroll');
-- operasyon rolü
select set_config('request.jwt.claim.sub','33333333-3333-3333-3333-333333333333',false);
select tst.works('Operasyon konum kaydeder', $$select public.firma_konum_kaydet('aaaaaaaa-1111-0000-0000-000000000001', 38.4, 27.1, 'x', 'google')$$);
select tst.works('Operasyon plan ekler', $$insert into visit_plans(company_id, staff_type, planned_date) values ('aaaaaaaa-1111-0000-0000-000000000001','is_guvenligi_uzmani','2026-12-01')$$);
select tst.ok('Operasyon anahtarı okur', (select count(*) = 1 from integration_settings));
select tst.fails('Operasyon anahtarı değiştiremez', $$select public.entegrasyon_kaydet('google_maps_api_key', 'AIzaSyD-baskaAnahtar0123456789abcdefgh')$$);
select tst.works('Operasyon planı arşive alır', $$update visit_plans set archived_at = now() where planned_date = '2026-12-01'$$);
-- finans (zaman yetkisi yok)
select set_config('request.jwt.claim.sub','22222222-2222-2222-2222-222222222222',false);
select tst.ok('Finans planı göremez', (select count(*) = 0 from visit_plans));
select tst.fails('Finans plan ekleyemez', $$insert into visit_plans(company_id, staff_type, planned_date) values ('aaaaaaaa-1111-0000-0000-000000000001','is_guvenligi_uzmani','2026-12-02')$$);
select tst.fails('Finans konum kaydedemez', $$select public.firma_konum_kaydet('aaaaaaaa-1111-0000-0000-000000000001', 38.4, 27.1, 'x', 'google')$$);
-- uzman/hekim (saha personeli): plan oluşturamaz, konum kaydedemez
select set_config('request.jwt.claim.sub','55555555-5555-5555-5555-555555555555',false);
select tst.fails('Saha personeli plan ekleyemez', $$insert into visit_plans(company_id, staff_type, planned_date) values ('aaaaaaaa-1111-0000-0000-000000000001','is_guvenligi_uzmani','2026-12-03')$$);
select tst.fails('Saha personeli konum kaydedemez', $$select public.firma_konum_kaydet('aaaaaaaa-1111-0000-0000-000000000001', 38.4, 27.1, 'x', 'google')$$);
-- başka kurum
select set_config('request.jwt.claim.sub','44444444-4444-4444-4444-444444444444',false);
select tst.ok('Başka kurum plan/anahtar göremez', (select count(*) = 0 from visit_plans) and (select count(*) = 0 from integration_settings));
reset role;
