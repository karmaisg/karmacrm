-- OSGB 360 - Aşama 32 (imzalı sözleşmeler) veri tabanı testleri (yerel PostgreSQL 16 + Supabase taklidi)
-- Sıra: supabase_stub.sql -> 01_sema.sql -> 03..13 -> 33_asama32.sql -> bu dosya (boş bir veri tabanında)
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
insert into contracts(id,organization_id,company_id,start_date,end_date,status) values ('c0c0c0c0-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-1111-0000-0000-000000000001','2026-01-01','2026-12-31','aktif');
set role authenticated; select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false);
select tst.works('İmzalı sözleşme kaydı eklenir', $$insert into signed_contracts(company_id, contract_id, title, signed_date, storage_path, file_name, mime_type, size_bytes) values ('aaaaaaaa-1111-0000-0000-000000000001','c0c0c0c0-0000-0000-0000-000000000001','2026 sözleşmesi','2026-01-02','aaaaaaaa-0000-0000-0000-000000000001/sozlesme/x1.pdf','x.pdf','application/pdf',1000)$$);
select tst.fails('Başka kurumun dosya yolu reddedilir', $$insert into signed_contracts(company_id, storage_path, file_name, mime_type, size_bytes) values ('aaaaaaaa-1111-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000002/sozlesme/x2.pdf','x.pdf','application/pdf',1000)$$, 'kuruma ait');
select tst.fails('Geçersiz dosya türü reddedilir', $$insert into signed_contracts(company_id, storage_path, file_name, mime_type, size_bytes) values ('aaaaaaaa-1111-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001/sozlesme/x3.exe','x.exe','application/x-msdownload',1000)$$);
select tst.fails('10 MB üstü reddedilir', $$insert into signed_contracts(company_id, storage_path, file_name, mime_type, size_bytes) values ('aaaaaaaa-1111-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001/sozlesme/x4.pdf','x.pdf','application/pdf',10485761)$$);
select tst.fails('Başka kurumun firmasına kayıt eklenemez', $$insert into signed_contracts(company_id, storage_path, file_name, mime_type, size_bytes) values ('bbbbbbbb-1111-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001/sozlesme/x5.pdf','x.pdf','application/pdf',1000)$$);
select tst.ok('Sahip kaydı görür', (select count(*) from signed_contracts) = 1);
select tst.works('Kayıt arşive alınır', $$update signed_contracts set archived_at = now() where title = '2026 sözleşmesi'$$);
select set_config('request.jwt.claim.sub','22222222-2222-2222-2222-222222222222',false);
select tst.ok('Finans rolü kaydı görür (görüntüleme yetkisi var)', (select count(*) from signed_contracts) = 1);
select tst.fails('Finans rolü (oluşturma yetkisi yok) kayıt ekleyemez', $$insert into signed_contracts(company_id, storage_path, file_name, mime_type, size_bytes) values ('aaaaaaaa-1111-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001/sozlesme/x6.pdf','x.pdf','application/pdf',1000)$$);
reset role;
select tst.ok('Denetim kaydı sözleşme modülüne bağlı', app.audit_modul('signed_contracts') = 'contracts');
delete from companies where id = 'bbbbbbbb-1111-0000-0000-000000000001';
