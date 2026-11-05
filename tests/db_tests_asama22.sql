-- OSGB 360 - Aşama 21 (İdari İşler, yıllık takvim) veri tabanı testleri (yerel PostgreSQL 16 + Supabase taklidi)
-- Sıra: supabase_stub.sql -> 01_sema.sql -> 03..13 -> 23_asama21.sql -> bu dosya (boş bir veri tabanında)
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

insert into employees(id,organization_id,full_name,staff_type) values
 ('eeeeeeee-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001','Maaşlı Uzman','is_guvenligi_uzmani');
select tst.ok('Yetki: işletme sahibi admin_affairs tam, satış ve finans yok', (
  select bool_and(case when r.key in ('isletme_sahibi','sistem_yoneticisi') then p.can_view and p.can_create and p.can_edit and p.can_archive else not p.can_view end)
    from roles r join role_permissions p on p.role_id = r.id and p.module = 'admin_affairs' where r.organization_id = 'aaaaaaaa-0000-0000-0000-000000000001'));
select tst.ok('Kova özel ve 10 MB sınırlı', (select not public and file_size_limit = 10485760 from storage.buckets where id = 'idari-belgeler'));
select tst.ok('Depolama politikaları var (sel, ins, del)', (select count(*) = 3 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname like 'idari_belgeler_%'));

-- takvim: yıllık tekrar
set role authenticated; select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false);
insert into calendar_items(title,kind,start_date,recurrence) values ('Ruhsat yenileme','hatirlatma','2024-02-29','yillik'), ('Aylık','odeme','2026-01-31','aylik');
select tst.works('Yıllık recurrence kabul edilir', $$select 1$$);
select tst.ok('Yıllık: 2024 29 Şubat, 2025 ve 2026 28 Şubat, bir yıl 1 kayıt', (select count(*) = 3 and min(tarih) = '2024-02-29' and bool_or(tarih = '2026-02-28') from (select * from public.takvim_olaylari('2024-01-01','2024-12-31') union all select * from public.takvim_olaylari('2025-01-01','2025-12-31') union all select * from public.takvim_olaylari('2026-01-01','2026-12-31')) x where baslik = 'Ruhsat yenileme' and kaynak = 'takvim'));
select tst.ok('Yıllık olay tekrar=true', (select bool_and(tekrar) from public.takvim_olaylari('2025-01-01','2025-12-31') where baslik = 'Ruhsat yenileme'));
select tst.ok('Başlangıçtan önce yıllık olay yok', (select count(*) = 0 from public.takvim_olaylari('2023-01-01','2023-12-31') where baslik = 'Ruhsat yenileme'));
select tst.fails('Geçersiz tekrar türü', $$insert into calendar_items(title,start_date,recurrence) values ('x','2026-01-01','haftalik')$$);
reset role;

-- araç
set role authenticated; select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false);
select tst.works('Araç eklenir', $$insert into vehicles(id,plate,brand,model,model_year) values ('aaaa0000-0000-0000-0000-000000000001','34 abc 123','Fiat','Egea',2022)$$);
select tst.ok('Plaka büyük harf ve boşluksuz saklanır', (select plate = '34ABC123' from vehicles));
select tst.fails('Aynı plaka ikinci kez eklenemez', $$insert into vehicles(plate,brand) values ('34ABC123','Renault')$$);
select tst.works('Araç kaydı: kasko', $$insert into vehicle_records(vehicle_id,kind,record_date,expiry_date,amount,value_text) values ('aaaa0000-0000-0000-0000-000000000001','kasko','2026-01-01','2026-12-31',12000,'POL-1')$$);
select tst.fails('"diğer" kaydı adsız olamaz', $$insert into vehicle_records(vehicle_id,kind) values ('aaaa0000-0000-0000-0000-000000000001','diger')$$);
select tst.works('"diğer" kaydı adla', $$insert into vehicle_records(vehicle_id,kind,label,value_text) values ('aaaa0000-0000-0000-0000-000000000001','diger','Lastik değişimi','4 adet')$$);
select tst.fails('Bitiş başlangıçtan önce olamaz', $$insert into vehicle_records(vehicle_id,kind,record_date,expiry_date) values ('aaaa0000-0000-0000-0000-000000000001','bakim','2026-05-01','2026-04-01')$$);

-- belgeler
select tst.works('Özlük belgesi (kimlik)', $$insert into admin_documents(scope,employee_id,doc_type,storage_path,file_name,mime_type,size_bytes) values ('personel','eeeeeeee-0000-0000-0000-000000000001','kimlik','aaaaaaaa-0000-0000-0000-000000000001/personel/a1.pdf','kimlik.pdf','application/pdf',1000)$$);
select tst.works('Özlük belgesi (diğer, ad ile)', $$insert into admin_documents(scope,employee_id,doc_type,title,storage_path,file_name,mime_type,size_bytes) values ('personel','eeeeeeee-0000-0000-0000-000000000001','diger','Askerlik belgesi','aaaaaaaa-0000-0000-0000-000000000001/personel/a2.jpg','a.jpg','image/jpeg',500)$$);
select tst.fails('"diğer" belge adsız olamaz', $$insert into admin_documents(scope,employee_id,doc_type,storage_path,file_name,mime_type,size_bytes) values ('personel','eeeeeeee-0000-0000-0000-000000000001','diger','aaaaaaaa-0000-0000-0000-000000000001/personel/a3.pdf','x.pdf','application/pdf',1)$$);
select tst.fails('Personel belgesi personelsiz olamaz', $$insert into admin_documents(scope,doc_type,storage_path,file_name,mime_type,size_bytes) values ('personel','kimlik','aaaaaaaa-0000-0000-0000-000000000001/p/a4.pdf','x.pdf','application/pdf',1)$$);
select tst.fails('Şirket belgesi adsız olamaz', $$insert into admin_documents(scope,storage_path,file_name,mime_type,size_bytes) values ('sirket','aaaaaaaa-0000-0000-0000-000000000001/sirket/a5.pdf','x.pdf','application/pdf',1)$$);
select tst.works('Şirket belgesi', $$insert into admin_documents(scope,title,doc_date,description,storage_path,file_name,mime_type,size_bytes) values ('sirket','Vergi levhası','2026-01-01','2026 levhası','aaaaaaaa-0000-0000-0000-000000000001/sirket/a6.pdf','levha.pdf','application/pdf',2048)$$);
select tst.works('Araç belgesi (kayda bağlı)', $$insert into admin_documents(scope,vehicle_id,vehicle_record_id,doc_type,storage_path,file_name,mime_type,size_bytes) values ('arac','aaaa0000-0000-0000-0000-000000000001',(select id from vehicle_records where kind='kasko'),'kasko','aaaaaaaa-0000-0000-0000-000000000001/arac/a7.pdf','kasko.pdf','application/pdf',3000)$$);
select tst.fails('Başka kurumun klasörüne dosya yolu', $$insert into admin_documents(scope,title,storage_path,file_name,mime_type,size_bytes) values ('sirket','x','bbbbbbbb-0000-0000-0000-000000000002/sirket/a8.pdf','x.pdf','application/pdf',1)$$, 'kuruma ait değil');
select tst.fails('10 MB üstü dosya', $$insert into admin_documents(scope,title,storage_path,file_name,mime_type,size_bytes) values ('sirket','x','aaaaaaaa-0000-0000-0000-000000000001/sirket/a9.pdf','x.pdf','application/pdf',10485761)$$);
select tst.fails('İzinsiz dosya türü (exe)', $$insert into admin_documents(scope,title,storage_path,file_name,mime_type,size_bytes) values ('sirket','x','aaaaaaaa-0000-0000-0000-000000000001/sirket/b1.exe','x.exe','application/x-msdownload',10)$$);
select tst.fails('Araç belgesi başka aracın kaydına bağlanamaz', $$insert into admin_documents(scope,vehicle_id,vehicle_record_id,doc_type,storage_path,file_name,mime_type,size_bytes) values ('arac','aaaa0000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000000','diger','aaaaaaaa-0000-0000-0000-000000000001/arac/b2.pdf','x.pdf','application/pdf',1)$$);

-- izinler
select tst.works('İzin kaydı', $$insert into employee_leaves(employee_id,start_date,end_date,days,note) values ('eeeeeeee-0000-0000-0000-000000000001','2026-07-06','2026-07-10',5,'Yaz izni')$$);
select tst.fails('İzin günü sıfır olamaz', $$insert into employee_leaves(employee_id,start_date,end_date,days) values ('eeeeeeee-0000-0000-0000-000000000001','2026-07-06','2026-07-10',0)$$);
select tst.fails('İzin bitişi başlangıçtan önce olamaz', $$insert into employee_leaves(employee_id,start_date,end_date,days) values ('eeeeeeee-0000-0000-0000-000000000001','2026-07-10','2026-07-06',1)$$);
select tst.works('Doğum tarihi yazılır', $$update employees set birth_date = '1990-05-20' where id = 'eeeeeeee-0000-0000-0000-000000000001'$$);
select tst.fails('Gelecekte doğum tarihi olamaz', $$update employees set birth_date = current_date + 5 where id = 'eeeeeeee-0000-0000-0000-000000000001'$$);

-- arşivleme
select tst.works('Belge arşivlenir (sahip)', $$update admin_documents set archived_at = now() where title = 'Vergi levhası'$$);
reset role;

-- yetkisiz roller ve başka kurum
set role authenticated; select set_config('request.jwt.claim.sub','22222222-2222-2222-2222-222222222222',false);
select tst.ok('Satış rolü idari belgeleri göremez', (select count(*) = 0 from admin_documents) and (select count(*) = 0 from vehicles) and (select count(*) = 0 from employee_leaves));
select tst.fails('Satış rolü belge ekleyemez', $$insert into admin_documents(scope,title,storage_path,file_name,mime_type,size_bytes) values ('sirket','x','aaaaaaaa-0000-0000-0000-000000000001/sirket/c1.pdf','x.pdf','application/pdf',1)$$);
select tst.fails('Satış rolü araç ekleyemez', $$insert into vehicles(plate,brand) values ('06XYZ99','Ford')$$);
select set_config('request.jwt.claim.sub','33333333-3333-3333-3333-333333333333',false);
select tst.ok('Finans rolü idari belgeleri göremez', (select count(*) = 0 from admin_documents));
select set_config('request.jwt.claim.sub','44444444-4444-4444-4444-444444444444',false);
select tst.ok('Başka kurum hiçbir şey göremez', (select count(*) = 0 from admin_documents) and (select count(*) = 0 from vehicles) and (select count(*) = 0 from vehicle_records) and (select count(*) = 0 from employee_leaves));
reset role;
select tst.ok('Denetim kaydı admin_affairs modülüne bağlı', app.audit_modul('admin_documents') = 'admin_affairs' and app.audit_modul('vehicles') = 'admin_affairs');
