-- OSGB 360 - Aşama 19 (gider Excel aktarımı) veri tabanı testleri (yerel PostgreSQL 16 + Supabase taklidi)
-- Sıra: supabase_stub.sql -> 01_sema.sql -> 03..13 -> 20_asama19.sql -> bu dosya (boş bir veri tabanında)
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
insert into expense_categories(id,organization_id,name,nature,default_cost_type) values
 ('aaaaaaaa-cccc-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001','Test Kira','isletme','ortak');

-- ---------------------------------------------------------------- ilk yükleme
set role authenticated; select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false);
select tst.works('İlk gider yüklemesi', $$select public.gider_aktar('{"dosya":"g1.xlsx","aylar":["2026-01-01","2026-02-01","2026-03-01"],"kdv_modu":"kdv_haric","kdv_orani":20,
 "satirlar":[
  {"anahtar":"kira","etiket":"Kira ve Aidat","islem":"kategori","kategori_id":"aaaaaaaa-cccc-0000-0000-000000000001","tutarlar":{"2026-01-01":1000,"2026-02-01":1000,"2026-03-01":0}},
  {"anahtar":"muhasebe","etiket":"Muhasebe Giderleri","islem":"kategori","yeni_kategori":{"ad":"Muhasebe Giderleri","tur":"isletme"},"tutarlar":{"2026-01-01":500.5}},
  {"anahtar":"vergi","etiket":"Vergi","islem":"kategori","yeni_kategori":{"ad":"Vergi","tur":"vergi"},"tutarlar":{"2026-02-01":300}},
  {"anahtar":"yonetim","etiket":"Yönetime Ödenen","islem":"yonetim","tutarlar":{"2026-01-01":5000,"2026-02-01":6000}},
  {"anahtar":"personel","etiket":"Personel Giderleri","islem":"atla","tutarlar":{"2026-01-01":99999}}
 ]}'::jsonb)$$);
reset role;
select tst.ok('Kayıt sayısı: kira 2 + muhasebe 1 + vergi 1 + yönetim 2 = 6 (sıfır ve atlanan yazılmaz)', (select count(*) = 6 from expenses where import_id is not null));
select tst.ok('Personel Giderleri satırı hiç yazılmadı', (select count(*) = 0 from expenses where description like '%Personel Giderleri%'));
select tst.ok('Tutarlar KDV hariç, KDV 0, ortak gider', (select bool_and(vat_amount = 0 and cost_type = 'ortak') from expenses where import_id is not null));
select tst.ok('Muhasebe yeni kategori olarak açıldı', (select count(*) = 1 from expense_categories where name = 'Muhasebe Giderleri' and nature = 'isletme' and not is_income_tax));
select tst.ok('Vergi kategorisi vergi niteliğinde (gelir vergisi işaretli)', (select is_income_tax and nature = 'vergi' from expense_categories where name = 'Vergi'));
select tst.ok('Yönetime ödenen kategorisi işaretli ve tek', (select count(*) = 1 from expense_categories where is_management_pay));
select tst.ok('Yönetim satırı yönetim kategorisine yazıldı (2 ay)', (select count(*) = 2 from expenses e join expense_categories c on c.id = e.category_id where c.is_management_pay and e.import_id is not null));
select tst.ok('Satır eşleşmeleri hatırlandı (5 satır)', (select count(*) = 5 from expense_row_map));
select tst.ok('Geçmiş aylar ödendi, tarih ayın ilk günü', (select bool_and(expense_date = date_trunc('month', expense_date)::date) from expenses where import_id is not null));
select tst.ok('Yükleme geçmişi', (select row_count = 6 and archived_count = 0 and total_excl_vat = 13800.5 from expense_imports where file_name = 'g1.xlsx'));

-- elle girilen gider (Excel dışı) yerine geçmeyi etkilememeli
insert into expenses(organization_id,category_id,expense_date,amount_excl_vat,cost_type,description) values
 ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-cccc-0000-0000-000000000001','2026-01-10',77,'ortak','Elle girilen');

-- ---------------------------------------------------------------- ikinci yükleme: öncekinin yerine geçer
set role authenticated; select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false);
select tst.works('İkinci yükleme (Şubat ve Mart güncel, Ocak yok)', $$select public.gider_aktar('{"dosya":"g2.xlsx","aylar":["2026-02-01","2026-03-01"],"kdv_modu":"kdv_haric",
 "satirlar":[
  {"anahtar":"kira","etiket":"Kira ve Aidat","islem":"kategori","kategori_id":"aaaaaaaa-cccc-0000-0000-000000000001","tutarlar":{"2026-02-01":1200,"2026-03-01":1200}},
  {"anahtar":"yonetim","etiket":"Yönetime Ödenen","islem":"yonetim","tutarlar":{"2026-03-01":7000}}
 ]}'::jsonb)$$);
reset role;
select tst.ok('Ocak kayıtlarına dokunulmadı (dosyada ay yoktu)', (select count(*) = 3 from expenses where import_id = (select id from expense_imports where file_name = 'g1.xlsx') and expense_date = '2026-01-01' and archived_at is null));
select tst.ok('Şubat: eski Excel kayıtları arşivde (kira, vergi, yönetim)', (select count(*) = 3 from expenses where expense_date = '2026-02-01' and import_id = (select id from expense_imports where file_name = 'g1.xlsx') and archived_at is not null));
select tst.ok('Şubat: vergi eski kaydı yerine yenisi yok (yeni dosyada vergi satırı yoktu) → aktif Şubat toplamı yalnız 1200', (select sum(amount_excl_vat) = 1200 from expenses where expense_date = '2026-02-01' and archived_at is null and import_id is not null));
select tst.ok('Mart: yönetim 7000 ve kira 1200 aktif', (select count(*) = 2 and sum(amount_excl_vat) = 8200 from expenses where expense_date = '2026-03-01' and archived_at is null and import_id is not null));
select tst.ok('Elle girilen gider korunuyor', (select count(*) = 1 from expenses where description = 'Elle girilen' and archived_at is null));
select tst.ok('Yükleme geçmişinde arşivlenen sayısı 3', (select archived_count = 3 from expense_imports where file_name = 'g2.xlsx'));
select tst.ok('Aynı kategori ikinci kez oluşmadı', (select count(*) = 1 from expense_categories where is_management_pay));

-- KDV dahil
set role authenticated; select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false);
select tst.works('KDV dahil yükleme: %20 ayrılır', $$select public.gider_aktar('{"dosya":"g3.xlsx","aylar":["2026-04-01"],"kdv_modu":"kdv_dahil","kdv_orani":20,"satirlar":[{"anahtar":"kira","etiket":"Kira ve Aidat","islem":"kategori","kategori_id":"aaaaaaaa-cccc-0000-0000-000000000001","tutarlar":{"2026-04-01":1200}}]}'::jsonb)$$);
reset role;
select tst.ok('KDV dahil 1200 → hariç 1000 + KDV 200', (select amount_excl_vat = 1000 and vat_amount = 200 from expenses where expense_date = '2026-04-01' and import_id is not null));

-- hatalar: hiçbir şey değişmez
set role authenticated; select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false);
select tst.fails('Kategorisiz satır reddedilir', $$select public.gider_aktar('{"aylar":["2026-05-01"],"satirlar":[{"anahtar":"x","etiket":"X","islem":"kategori","tutarlar":{"2026-05-01":5}}]}'::jsonb)$$, 'kategori seçilmemiş');
select tst.fails('Maaş kategorisi atanamaz', $$select public.gider_aktar(('{"aylar":["2026-05-01"],"satirlar":[{"anahtar":"x","etiket":"X","islem":"kategori","kategori_id":"' || (select id from expense_categories where is_payroll limit 1) || '","tutarlar":{"2026-05-01":5}}]}')::jsonb)$$, 'Maaş');
select tst.fails('Ay listesi dışında ay reddedilir', $$select public.gider_aktar('{"aylar":["2026-05-01"],"satirlar":[{"anahtar":"x","etiket":"X","islem":"kategori","kategori_id":"aaaaaaaa-cccc-0000-0000-000000000001","tutarlar":{"2026-06-01":5}}]}'::jsonb)$$, 'ay listesinde yok');
select tst.fails('Ay yoksa reddedilir', $$select public.gider_aktar('{"aylar":[],"satirlar":[]}'::jsonb)$$, 'ay sütunu');
reset role;
select tst.ok('Hatalı pakette Mayıs kaydı oluşmadı', (select count(*) = 0 from expenses where expense_date = '2026-05-01'));
select tst.ok('Hatalı pakette yükleme geçmişi de oluşmadı', (select count(*) = 3 from expense_imports));

-- yetki
set role authenticated; select set_config('request.jwt.claim.sub','22222222-2222-2222-2222-222222222222',false);
select tst.fails('Satış rolü gider aktaramaz', $$select public.gider_aktar('{"aylar":["2026-05-01"],"satirlar":[]}'::jsonb)$$, 'yetki');
select set_config('request.jwt.claim.sub','44444444-4444-4444-4444-444444444444',false);
select tst.ok('Başka kurum yükleme geçmişini göremez', (select count(*) = 0 from expense_imports));
reset role;
