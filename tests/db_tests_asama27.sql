-- OSGB 360 - Aşama 27 (işyeri → firma profili) veri tabanı testleri (yerel PostgreSQL 16 + Supabase taklidi)
-- Sıra: supabase_stub.sql -> 01_sema.sql -> 03..13 -> 27_asama27.sql -> bu dosya (boş bir veri tabanında)
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

insert into companies(id,organization_id,name,customer_status) values ('aaaaaaaa-1111-0000-0000-000000000002','aaaaaaaa-0000-0000-0000-000000000001','Firma B','musteri');
-- varsayılan kurulumda firma profili boş; iki işyeri ile oluşur
set role authenticated; select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false);
select tst.works('Firma A profil', $$select public.firma_profili_ekle('aaaaaaaa-1111-0000-0000-000000000001', 10, 'az_tehlikeli', date_trunc('month', (select bugun from g))::date - 90)$$);
reset role;
insert into company_sites(organization_id, company_id, sgk_no, site_name, employee_count, hazard_class, is_manual) values
  ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-1111-0000-0000-000000000001','EL0001','Şube 1',10,'az_tehlikeli',true),
  ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-1111-0000-0000-000000000001','EL0002','Şube 2',20,'tehlikeli',true);
set role authenticated; select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false);
select tst.works('Eşitleme çalışır', $$select public.isyeri_profil_esitle('aaaaaaaa-1111-0000-0000-000000000001')$$);
select tst.ok('Açık profil: 30 çalışan, tehlikeli', (select employee_count = 30 and hazard_class = 'tehlikeli' from company_profiles where company_id = 'aaaaaaaa-1111-0000-0000-000000000001' and valid_to is null));
select tst.ok('Döküm iki sınıf', (select jsonb_array_length(site_breakdown) = 2 from company_profiles where company_id = 'aaaaaaaa-1111-0000-0000-000000000001' and valid_to is null));
select tst.ok('Geçmiş profil korundu (10 çalışan, az tehlikeli)', (select count(*) = 1 from company_profiles where company_id = 'aaaaaaaa-1111-0000-0000-000000000001' and valid_to is not null and employee_count = 10 and hazard_class = 'az_tehlikeli'));
select tst.ok('Tekrar çağrı değişiklik yapmaz', (select (public.isyeri_profil_esitle('aaaaaaaa-1111-0000-0000-000000000001') ->> 'guncellendi') = 'false'));
update company_sites set archived_at = now() where sgk_no = 'EL0002';
select tst.works('Silinen işyeri sonrası eşitleme', $$select public.isyeri_profil_esitle('aaaaaaaa-1111-0000-0000-000000000001')$$);
select tst.ok('Tek sınıf kaldı: 10 çalışan az tehlikeli, döküm yok', (select employee_count = 10 and hazard_class = 'az_tehlikeli' and site_breakdown is null from company_profiles where company_id = 'aaaaaaaa-1111-0000-0000-000000000001' and valid_to is null));
select tst.works('Silinmiş işyeri başka firmaya taşınır', $$select public.isyeri_firmaya_tasi((select id from company_sites where sgk_no = 'EL0002'), 'aaaaaaaa-1111-0000-0000-000000000002')$$);
select tst.ok('Taşınan işyeri artık aktif ve Firma B’de', (select company_id = 'aaaaaaaa-1111-0000-0000-000000000002' and archived_at is null from company_sites where sgk_no = 'EL0002'));
select tst.ok('Firma B profili işyerinden oluştu (20 çalışan tehlikeli)', (select employee_count = 20 and hazard_class = 'tehlikeli' from company_profiles where company_id = 'aaaaaaaa-1111-0000-0000-000000000002' and valid_to is null));
select tst.ok('Firma A tehlike sınıfı yine az tehlikeli', (select hazard_class = 'az_tehlikeli' from company_profiles where company_id = 'aaaaaaaa-1111-0000-0000-000000000001' and valid_to is null));
select set_config('request.jwt.claim.sub','22222222-2222-2222-2222-222222222222',false);
select tst.fails('Yetkisiz rol eşitleyemez', $$select public.isyeri_profil_esitle('aaaaaaaa-1111-0000-0000-000000000001')$$);
-- Aşama 27 düzeltmesi: işyerlerinin tamamı taşınınca eski firma profili 0 çalışana iner
select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false);
select tst.works('Firma A son işyerini taşır', $$select public.isyeri_firmaya_tasi((select id from company_sites where sgk_no = 'EL0001'), 'aaaaaaaa-1111-0000-0000-000000000002')$$);
select tst.ok('Firma A açık profili 0 çalışan', (select employee_count = 0 from company_profiles where company_id = 'aaaaaaaa-1111-0000-0000-000000000001' and valid_to is null));
select tst.ok('Firma B tüm işyerlerini toplar (30 çalışan, 2 sınıf)', (select employee_count = 30 and jsonb_array_length(site_breakdown) = 2 from company_profiles where company_id = 'aaaaaaaa-1111-0000-0000-000000000002' and valid_to is null));
