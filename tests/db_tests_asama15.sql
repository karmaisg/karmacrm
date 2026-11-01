-- OSGB 360 - Aşama 14 (Katip görevlendirme aktarımı) veri tabanı testleri (yerel PostgreSQL 16 + Supabase taklidi)
-- Sıra: supabase_stub.sql -> 01_sema.sql -> 03..13 -> 15_asama14.sql -> bu dosya (boş bir veri tabanında)
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


insert into employees(id, organization_id, full_name, staff_type) values
 ('eeeeeeee-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001','Mevcut Uzman','is_guvenligi_uzmani'),
 ('eeeeeeee-0000-0000-0000-000000000002','aaaaaaaa-0000-0000-0000-000000000001','Mevcut Hekim','isyeri_hekimi'),
 ('eeeeeeee-0000-0000-0000-000000000003','aaaaaaaa-0000-0000-0000-000000000001','Eski Uzman','is_guvenligi_uzmani');
insert into assignments(id, organization_id, company_id, employee_id, staff_type, share_pct, valid_from) values
 ('dddddddd-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-1111-0000-0000-000000000002','eeeeeeee-0000-0000-0000-000000000001','is_guvenligi_uzmani',60,'2026-01-01'),
 ('dddddddd-0000-0000-0000-000000000002','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-1111-0000-0000-000000000002','eeeeeeee-0000-0000-0000-000000000003','is_guvenligi_uzmani',40,'2026-01-01');
create temp table paket(ad text, j jsonb); grant select, insert on paket to authenticated;
insert into paket values ('p1', $j$
{"tarih":"2026-10-01",
 "baglar":[{"employee_id":"eeeeeeee-0000-0000-0000-000000000001","sertifika_no":"İGU-1"}],
 "kisiler":[{"ref":"k1","ad":"YENİ HEKİM","tur":"isyeri_hekimi","sertifika_tipi":"İşyeri Hekimliği Sertifikası","sertifika_no":"İH-9"}],
 "islemler":[
  {"islem":"bitir","assignment_id":"dddddddd-0000-0000-0000-000000000002"},
  {"islem":"degistir","assignment_id":"dddddddd-0000-0000-0000-000000000001","pay":70,"resmi_ref":"S-100"},
  {"islem":"ekle","company_id":"aaaaaaaa-1111-0000-0000-000000000002","employee_ref":"k1","tur":"isyeri_hekimi","pay":100,"resmi_ref":"S-101","resmi_baslangic":"2026-10-01"},
  {"islem":"ekle","company_id":"aaaaaaaa-1111-0000-0000-000000000002","employee_id":"eeeeeeee-0000-0000-0000-000000000003","tur":"is_guvenligi_uzmani","pay":30,"resmi_ref":"S-102"}]}
$j$);

set role authenticated; select set_config('request.jwt.claim.sub','22222222-2222-2222-2222-222222222222',false);
select tst.fails('Satış rolü görevlendirme aktaramaz', $$select public.katip_gorevlendir((select j from paket where ad='p1'))$$, 'yetkisi');
reset role;
set role anon; select set_config('request.jwt.claim.sub','',false);
select tst.fails('Anon çağıramaz', $$select public.katip_gorevlendir('{}'::jsonb)$$, 'permission denied');
reset role;
select tst.ok('Yetkisiz denemeler hiçbir şey yazmadı', (select count(*) from assignments) = 2 and (select count(*) from employees) = 3);

set role authenticated; select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false);
select tst.fails('Tarihsiz paket reddedilir', $$select public.katip_gorevlendir('{"islemler":[]}'::jsonb)$$, 'tarihi zorunlu');
select tst.fails('Pay %100''ü aşarsa her şey geri alınır', $$select public.katip_gorevlendir('{"tarih":"2026-10-01","kisiler":[{"ref":"z","ad":"GEÇİCİ","tur":"isyeri_hekimi","sertifika_no":"İH-77"}],"islemler":[{"islem":"ekle","company_id":"aaaaaaaa-1111-0000-0000-000000000002","employee_ref":"z","pay":80},{"islem":"ekle","company_id":"aaaaaaaa-1111-0000-0000-000000000002","employee_id":"eeeeeeee-0000-0000-0000-000000000002","pay":30}]}'::jsonb)$$, 'aşıyor');
select tst.fails('Yabancı kurum firması reddedilir', $$select public.katip_gorevlendir('{"tarih":"2026-10-01","islemler":[{"islem":"ekle","company_id":"bbbbbbbb-1111-0000-0000-000000000001","employee_id":"eeeeeeee-0000-0000-0000-000000000002","pay":10}]}'::jsonb)$$, 'Firma bulunamadı');
select tst.fails('Geçersiz işlem reddedilir', $$select public.katip_gorevlendir('{"tarih":"2026-10-01","islemler":[{"islem":"sil"}]}'::jsonb)$$, 'Bilinmeyen');
reset role;
select tst.ok('Hatalı paketler geri alındı (geçici personel yok, atamalar aynı)', (select count(*) from employees) = 3 and (select count(*) from assignments) = 2);

set role authenticated; select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false);
select tst.works('Paket uygulanır', $$create temp table sonuc as select public.katip_gorevlendir((select j from paket where ad='p1')) j$$);
reset role;
select tst.ok('Sonuç sayıları', (select j->>'yeni_personel' = '1' and j->>'sertifika_baglanan' = '1' and j->>'eklenen' = '2' and j->>'degisen' = '1' and j->>'biten' = '1' from sonuc));
select tst.ok('Mevcut personele sertifika no bağlandı', (select certificate_no = 'İGU-1' from employees where id = 'eeeeeeee-0000-0000-0000-000000000001'));
select tst.ok('Yeni personel açıldı (hekim, sertifika no, Katip notu)', (select staff_type = 'isyeri_hekimi' and certificate_no = 'İH-9' and notes like '%İSG-Katip%' from employees where full_name = 'YENİ HEKİM'));
select tst.ok('Bitirilen görevlendirme önceki günde kapandı', (select valid_to = '2025-12-31' or valid_to = '2026-09-30' from assignments where id = 'dddddddd-0000-0000-0000-000000000002'));
select tst.ok('Bitirilen: dönem sonu tarihin bir gün öncesi (30.09.2026)', (select valid_to = '2026-09-30' from assignments where id = 'dddddddd-0000-0000-0000-000000000002'));
select tst.ok('Pay değişikliği: eski dönem kapandı, yeni dönem %70 açıldı (geçmiş korundu)', (select valid_to = '2026-09-30' from assignments where id = 'dddddddd-0000-0000-0000-000000000001')
  and (select share_pct = 70 and valid_from = '2026-10-01' and valid_to is null and official_ref = 'S-100' from assignments where company_id = 'aaaaaaaa-1111-0000-0000-000000000002' and employee_id = 'eeeeeeee-0000-0000-0000-000000000001' and valid_from = '2026-10-01'));
select tst.ok('Yeni görevlendirme: hekim %100, resmî referans ve başlangıç', (select share_pct = 100 and valid_from = '2026-10-01' and official_ref = 'S-101' and official_start = '2026-10-01' from assignments a join employees e on e.id = a.employee_id where e.full_name = 'YENİ HEKİM'));
select tst.ok('Uzman payları toplamı %100 (70 + 30)', (select sum(share_pct) from assignments where company_id = 'aaaaaaaa-1111-0000-0000-000000000002' and staff_type = 'is_guvenligi_uzmani' and valid_to is null and archived_at is null) = 100);
select tst.ok('Aynı personel için yeniden eklenen (bitmiş) görevlendirme yeni kayıt', (select count(*) from assignments where employee_id = 'eeeeeeee-0000-0000-0000-000000000003') = 2);

-- başlamamış görevlendirmeyi bitirmek arşivler
insert into companies(id,organization_id,name) values ('aaaaaaaa-1111-0000-0000-000000000009','aaaaaaaa-0000-0000-0000-000000000001','Gelecek Firma');
insert into assignments(id, organization_id, company_id, employee_id, staff_type, share_pct, valid_from) values ('dddddddd-0000-0000-0000-000000000009','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-1111-0000-0000-000000000009','eeeeeeee-0000-0000-0000-000000000002','isyeri_hekimi',0.01,'2027-01-01');
set role authenticated; select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false);
select tst.works('Başlamamış görevlendirme bitirilince arşivlenir', $$select public.katip_gorevlendir('{"tarih":"2026-11-01","islemler":[{"islem":"bitir","assignment_id":"dddddddd-0000-0000-0000-000000000009"}]}'::jsonb)$$);
reset role;
select tst.ok('Arşivlendi', (select archived_at is not null from assignments where id = 'dddddddd-0000-0000-0000-000000000009'));
-- aynı gün başlamış kaydın payı: başlangıç + 1 gün kuralı (çakışma olmaz)
set role authenticated; select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false);
select tst.works('Aynı gün başlayan kayıt değiştirilebilir (yeni dönem ertesi gün)', $$select public.katip_gorevlendir((select format('{"tarih":"2026-10-01","islemler":[{"islem":"degistir","assignment_id":"%s","pay":60}]}', id)::jsonb from assignments where employee_id = 'eeeeeeee-0000-0000-0000-000000000001' and valid_from = '2026-10-01'))$$);
reset role;
select tst.ok('Eski kayıt aynı gün başladığı için tek günlük dönem + yeni dönem ertesi gün', (select count(*) from assignments where employee_id = 'eeeeeeee-0000-0000-0000-000000000001' and valid_from = '2026-10-02' and share_pct = 60) = 1);
select tst.ok('Başka kurum etkilenmedi', (select count(*) from assignments a join companies c on c.id = a.company_id where c.organization_id = 'bbbbbbbb-0000-0000-0000-000000000002') = 0);
