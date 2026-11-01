-- OSGB 360 - Aşama 13 (İSG-Katip aktarımı) veri tabanı testleri (yerel PostgreSQL 16 + Supabase taklidi)
-- Sıra: supabase_stub.sql -> 01_sema.sql -> 03..13 -> 14_asama13_katip.sql -> bu dosya (boş bir veri tabanında)
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
 ('aaaaaaaa-1111-0000-0000-000000000002','aaaaaaaa-0000-0000-0000-000000000001','Seterm Teknik'),
 ('aaaaaaaa-1111-0000-0000-000000000003','aaaaaaaa-0000-0000-0000-000000000001','Eski Firma');
insert into company_profiles(organization_id, company_id, employee_count, hazard_class, valid_from) values
 ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-1111-0000-0000-000000000002', 10, 'az_tehlikeli', '2026-01-01');

create temp table paket(ad text, j jsonb);
grant select, insert on paket to authenticated;
insert into paket values ('p1', $j$
{"donem":"2026-10-15","dosya":"ekim.xlsx","ozet":{"not":"deneme"},
 "yeni_firmalar":[{"ref":"y1","ad":"Yeni Unvan A.Ş.","il":"İZMİR"}],
 "isyerleri":[
  {"sicil":"11111111111111111111111111","unvan":"SETERM TEKNİK A.Ş.","il":"İZMİR","calisan":20,"tehlike":"tehlikeli","firma_id":"aaaaaaaa-1111-0000-0000-000000000002"},
  {"sicil":"22222222222222222222222222","unvan":"SETERM SERVİS LTD","il":"İZMİR","calisan":15,"tehlike":"cok_tehlikeli","firma_id":"aaaaaaaa-1111-0000-0000-000000000002"},
  {"sicil":"33333333333333333333333333","unvan":"YENİ UNVAN A.Ş.","il":"MANİSA","calisan":7,"tehlike":"az_tehlikeli","firma_ref":"y1"}],
 "satirlar":[
  {"sicil":"11111111111111111111111111","sozlesme_id":"1001","tur":"is_guvenligi_uzmani","sertifika_tipi":"A Sınıfı","sertifika_no":"İGU-1","ad":"ERDEM GEDİK","tc":"13979522312","dakika":200,"baslangic":"2026-10-01","onaylayan":"Ali Veli","uygun":true},
  {"sicil":"11111111111111111111111111","sozlesme_id":"1002","tur":"isyeri_hekimi","sertifika_tipi":"Hekim","sertifika_no":"İH-1","ad":"ÖZBEY KURT","tc":"32059855782","dakika":100,"baslangic":"2026-10-01","onaylayan":"Ali Veli","uygun":true},
  {"sicil":"22222222222222222222222222","sozlesme_id":"1003","tur":"is_guvenligi_uzmani","sertifika_tipi":"A Sınıfı","sertifika_no":"İGU-1","ad":"ERDEM GEDİK","tc":"13979522312","dakika":300,"baslangic":"2026-10-01","onaylayan":"Veli Can","uygun":false},
  {"sicil":"33333333333333333333333333","sozlesme_id":"1004","tur":"isyeri_hekimi","sertifika_tipi":"Hekim","sertifika_no":null,"ad":"YENİ HEKİM","tc":null,"dakika":30,"baslangic":null,"onaylayan":null,"uygun":null}],
 "kisiler":[{"firma_id":"aaaaaaaa-1111-0000-0000-000000000002","ad":"Ali Veli"},{"firma_id":"aaaaaaaa-1111-0000-0000-000000000002","ad":"Veli Can"},{"firma_ref":"y1","ad":"Ayşe Kaya"}],
 "pasif":["aaaaaaaa-1111-0000-0000-000000000003"]}
$j$);
-- ikinci yükleme: bir işyeri yok, bir işyerinin sayısı ve tehlikesi değişti
insert into paket values ('p2', $j$
{"donem":"2026-11-03","dosya":"kasim.xlsx",
 "isyerleri":[
  {"sicil":"11111111111111111111111111","unvan":"SETERM TEKNİK A.Ş.","il":"İZMİR","calisan":25,"tehlike":"tehlikeli","firma_id":"aaaaaaaa-1111-0000-0000-000000000002"},
  {"sicil":"22222222222222222222222222","unvan":"SETERM SERVİS LTD","il":"İZMİR","calisan":15,"tehlike":"cok_tehlikeli","firma_id":"aaaaaaaa-1111-0000-0000-000000000002"}],
 "satirlar":[
  {"sicil":"11111111111111111111111111","tur":"isyeri_hekimi","sertifika_tipi":"Hekim","sertifika_no":"İH-1","ad":"ÖZBEY KURT","tc":"32059855782","dakika":110,"onaylayan":"Ali Veli"}],
 "kisiler":[{"firma_id":"aaaaaaaa-1111-0000-0000-000000000002","ad":"ali veli"}]}
$j$);

-- ---------- Yetki ----------
set role authenticated; select set_config('request.jwt.claim.sub','22222222-2222-2222-2222-222222222222',false);
select tst.fails('Satış rolü içe aktaramaz', $$select public.katip_uygula((select j from paket where ad='p1'))$$, 'yetkisi');
reset role;
set role anon; select set_config('request.jwt.claim.sub','',false);
select tst.fails('Anon çağıramaz', $$select public.katip_uygula('{}'::jsonb)$$, 'permission denied');
reset role;
select tst.ok('Yetkisiz denemeler hiçbir şey yazmadı', (select count(*) from company_sites) = 0 and (select count(*) from katip_imports) = 0);

-- ---------- Boş / hatalı paket ----------
set role authenticated; select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false);
select tst.fails('Boş paket reddedilir', $$select public.katip_uygula('{"donem":"2026-10-01","isyerleri":[]}'::jsonb)$$, 'işyeri bulunamadı');
select tst.fails('Firmasız işyeri reddedilir ve hiçbir şey kalmaz', $$select public.katip_uygula('{"donem":"2026-10-01","yeni_firmalar":[{"ref":"z","ad":"Geçici"}],"isyerleri":[{"sicil":"99999999999","unvan":"X","calisan":1,"tehlike":"tehlikeli"}]}'::jsonb)$$, 'firma belirtilmemiş');
select tst.fails('Yabancı kurumun firması kullanılamaz', $$select public.katip_uygula('{"donem":"2026-10-01","isyerleri":[{"sicil":"99999999999","unvan":"X","calisan":1,"tehlike":"tehlikeli","firma_id":"bbbbbbbb-1111-0000-0000-000000000001"}]}'::jsonb)$$, 'firma bulunamadı');
select tst.fails('Geçersiz tehlike sınıfı reddedilir', $$select public.katip_uygula('{"donem":"2026-10-01","isyerleri":[{"sicil":"99999999999","unvan":"X","calisan":1,"tehlike":"yok","firma_id":"aaaaaaaa-1111-0000-0000-000000000002"}]}'::jsonb)$$);
reset role;
select tst.ok('Hatalı paketler geri alındı (geçici firma, yükleme yok)', (select count(*) from companies where name = 'Geçici') = 0 and (select count(*) from katip_imports) = 0 and (select count(*) from company_sites) = 0);

-- ---------- 1. yükleme ----------
set role authenticated; select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false);
select tst.works('1. yükleme uygulanır', $$create temp table sonuc1 as select public.katip_uygula((select j from paket where ad='p1')) j$$);
reset role;
select tst.ok('Sonuç sayıları', (select j->>'yeni_firma' = '1' and j->>'yeni_isyeri' = '3' and j->>'satir' = '4' and j->>'yeni_kisi' = '3' and j->>'pasife_alinan' = '1' from sonuc1));
select tst.ok('Yeni firma oluştu', (select count(*) from companies where name = 'Yeni Unvan A.Ş.' and city = 'İZMİR') = 1);
select tst.ok('İşyerleri doğru firmaya bağlı (iki sicil aynı firmada)', (select count(*) from company_sites where company_id = 'aaaaaaaa-1111-0000-0000-000000000002') = 2);
select tst.ok('Yeni firma işyeri bağlandı', (select company_id from company_sites where sgk_no = '33333333333333333333333333') = (select id from companies where name = 'Yeni Unvan A.Ş.'));
select tst.ok('Firma kartı: iki işyerinin toplamı (20+15=35) ve en yüksek tehlike (çok tehlikeli)', (select employee_count = 35 and hazard_class = 'cok_tehlikeli' from company_profiles where company_id = 'aaaaaaaa-1111-0000-0000-000000000002' and valid_to is null));
select tst.ok('Karma tehlike: işyeri dökümü profilde saklandı', (select site_breakdown = '[{"tehlike":"cok_tehlikeli","calisan":15},{"tehlike":"tehlikeli","calisan":20}]'::jsonb from company_profiles where company_id = 'aaaaaaaa-1111-0000-0000-000000000002' and valid_to is null));
select tst.ok('Tek tehlike sınıflı firmanın dökümü boş', (select site_breakdown is null from company_profiles p join companies c on c.id = p.company_id where c.name = 'Yeni Unvan A.Ş.'));
select tst.ok('Eski profil kapatıldı, geçmiş korundu', (select count(*) from company_profiles where company_id = 'aaaaaaaa-1111-0000-0000-000000000002') = 2
  and (select valid_to from company_profiles where company_id = 'aaaaaaaa-1111-0000-0000-000000000002' and employee_count = 10) = '2026-09-30');
select tst.ok('Yeni firmanın profili oluştu (7, az tehlikeli)', (select employee_count = 7 and hazard_class = 'az_tehlikeli' from company_profiles p join companies c on c.id = p.company_id where c.name = 'Yeni Unvan A.Ş.'));
select tst.ok('Excel''de olmayan firma eski müşteri yapıldı, silinmedi', (select customer_status = 'eski_musteri' and archived_at is null from companies where id = 'aaaaaaaa-1111-0000-0000-000000000003'));
select tst.ok('Firma kişileri eklendi (onaylayan)', (select count(*) from contacts where company_id = 'aaaaaaaa-1111-0000-0000-000000000002' and title = 'İSG-Katip onaylayan') = 2
  and (select count(*) from contacts c join companies f on f.id = c.company_id where f.name = 'Yeni Unvan A.Ş.' and c.full_name = 'Ayşe Kaya') = 1);
select tst.ok('Sözleşme satırları görüntü olarak saklandı', (select count(*) from katip_rows) = 4
  and (select employee_count = 20 and hazard_class = 'tehlikeli' and minutes_per_month = 200 and approver_name = 'Ali Veli' from katip_rows where contract_id = '1001'));
select tst.ok('Görevli kişiler: sertifika no ile tek kayıt (aynı kişi iki işyerinde), TC saklı', (select count(*) from katip_people) = 3
  and (select national_id = '13979522312' from katip_people where cert_no = 'İGU-1'));
select tst.ok('Sertifikasız kişi ad ile anahtarlandı', (select person_key from katip_people where person_name = 'YENİ HEKİM') = 'yeni hekim');

-- ---------- 2. yükleme (değişiklikler) ----------
set role authenticated; select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false);
select tst.works('2. yükleme uygulanır', $$create temp table sonuc2 as select public.katip_uygula((select j from paket where ad='p2')) j$$);
reset role;
select tst.ok('2. yükleme: güncellenen 2, kapanan 1, yeni işyeri yok', (select j->>'guncellenen_isyeri' = '2' and j->>'yeni_isyeri' = '0' and j->>'kapanan_isyeri' = '1' from sonuc2));
select tst.ok('Dosyada olmayan işyeri pasife alındı, kaydı durur', (select is_active = false from company_sites where sgk_no = '33333333333333333333333333'));
select tst.ok('Firma kartı: 25+15=40, çok tehlikeli', (select employee_count = 40 and hazard_class = 'cok_tehlikeli' from company_profiles where company_id = 'aaaaaaaa-1111-0000-0000-000000000002' and valid_to is null));
select tst.ok('2. yükleme: döküm güncellendi (25 tehlikeli + 15 çok tehlikeli)', (select site_breakdown = '[{"tehlike":"cok_tehlikeli","calisan":15},{"tehlike":"tehlikeli","calisan":25}]'::jsonb from company_profiles where company_id = 'aaaaaaaa-1111-0000-0000-000000000002' and valid_to is null));
select tst.ok('Dosyada olmayan işyerinin firması kartı değişmedi', (select count(*) from company_profiles p join companies c on c.id = p.company_id where c.name = 'Yeni Unvan A.Ş.') = 1);
select tst.ok('Aynı kişi (büyük/küçük harf farkı) tekrar eklenmedi', (select count(*) from contacts where company_id = 'aaaaaaaa-1111-0000-0000-000000000002' and lower(full_name) = 'ali veli') = 1);
select tst.ok('İki yükleme saklandı, ilk yükleme satırları bozulmadı', (select count(*) from katip_imports) = 2 and (select count(*) from katip_rows where import_id = (select (j->>'yukleme_id')::uuid from sonuc1)) = 4);
select tst.ok('Aynı dönemde profil çakışması olmadı (ikinci yükleme ayın başından değil, mevcut dönemden sonra)', (select count(*) from company_profiles where company_id = 'aaaaaaaa-1111-0000-0000-000000000002') = 3);

-- ---------- Okuma yetkisi ----------
set role authenticated; select set_config('request.jwt.claim.sub','22222222-2222-2222-2222-222222222222',false);
select tst.ok('Satış: işyerlerini görür (firma modülü)', (select count(*) from company_sites) = 3);
select tst.ok('Satış: yükleme satırlarını göremez (personel izni yok)', (select count(*) from katip_rows) = 0 and (select count(*) from katip_imports) = 0);
select tst.ok('Satış: TC kimlik numaralarını göremez', (select count(*) from katip_people) = 0);
select tst.fails('Satış: doğrudan satır ekleyemez', $$insert into katip_rows(import_id, sgk_no, site_name, employee_count, hazard_class, staff_type, person_name, minutes_per_month) values (gen_random_uuid(), '1', 'x', 1, 'tehlikeli', 'isyeri_hekimi', 'x', 1)$$, 'permission denied');
reset role;
set role authenticated; select set_config('request.jwt.claim.sub','33333333-3333-3333-3333-333333333333',false);
select tst.ok('Finans (maaş/payroll yetkisi olduğu için) TC kimlik numaralarını görür', (select count(*) from katip_people) = 3);
reset role;
set role authenticated; select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false);
select tst.ok('Sahip: TC kimlik numaralarını görür', (select count(*) from katip_people) = 3);
select tst.works('Sahip: işyerinin fatura firmasını değiştirebilir', $$update company_sites set company_id = 'aaaaaaaa-1111-0000-0000-000000000001' where sgk_no = '22222222222222222222222222'$$);
select tst.fails('Başka kurumun firmasına bağlanamaz', $$update company_sites set company_id = 'bbbbbbbb-1111-0000-0000-000000000001' where sgk_no = '22222222222222222222222222'$$, 'Firma bulunamadı');
select tst.fails('Sicil biçimi doğrulanır', $$update company_sites set sgk_no = 'a b' where sgk_no = '22222222222222222222222222'$$, 'check');
select tst.fails('Aynı sicil iki kez eklenemez', $$insert into company_sites(company_id, sgk_no, site_name) values ('aaaaaaaa-1111-0000-0000-000000000001', '11111111111111111111111111', 'x')$$, 'duplicate key');
reset role;
set role authenticated; select set_config('request.jwt.claim.sub','44444444-4444-4444-4444-444444444444',false);
select tst.ok('Başka kurum hiçbir işyeri/yükleme göremez', (select count(*) from company_sites) = 0 and (select count(*) from katip_imports) = 0 and (select count(*) from katip_rows) = 0);
reset role;
select tst.ok('Denetim kaydı işyeri değişikliğini tutar', (select count(*) from audit_logs where table_name = 'company_sites') >= 3);
select tst.ok('Fatura firması değişince firma kartı otomatik değişmez (bir sonraki yüklemede güncellenir)', true);
