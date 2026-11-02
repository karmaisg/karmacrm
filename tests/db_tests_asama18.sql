-- OSGB 360 - Aşama 17 (gelir Excel aktarımı, spot/elden gelir) veri tabanı testleri (yerel PostgreSQL 16 + Supabase taklidi)
-- Sıra: supabase_stub.sql -> 01_sema.sql -> 03..13 -> 18_asama17.sql -> bu dosya (boş bir veri tabanında)
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
insert into company_sites(id,organization_id,company_id,sgk_no,site_name,invoice_alias) values
 ('aaaaaaaa-2222-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-1111-0000-0000-000000000002','5555555555',  'UKEM ŞUBE','UKEM');

-- ---------------------------------------------------------------- gelir_aktar
set role authenticated; select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false);
select tst.works('Excel aktarımı: iki fatura + yeni firma', $$select public.gelir_aktar('{"dosya":"t.xlsx","vade_gun":30,
 "yeni_firmalar":[{"anahtar":"y1","ad":"Yeni Ltd"}],
 "faturalar":[
  {"no":"EFT-1","tarih":"2026-10-05","donem":"2026-10-01","aciklama":"Alfa Gıda (Ekim)","firma_id":"aaaaaaaa-1111-0000-0000-000000000001","alias_key":"alfa gida","alias_text":"Alfa Gıda",
   "kalemler":[{"aciklama":"İSG (Ekim)","haric":1000,"oran":20,"kdv":200},{"aciklama":"İSG (Ekim)","haric":500,"oran":10,"kdv":50}]},
  {"no":"EFT-2","tarih":"2026-10-06","donem":null,"aciklama":"Yeni","yeni_firma":"y1","kalemler":[{"aciklama":"Hizmet","haric":300,"oran":0,"kdv":0}]},
  {"no":"EFT-3","tarih":"2026-10-07","donem":"2026-10-01","firma_id":"aaaaaaaa-1111-0000-0000-000000000002","site_id":"aaaaaaaa-2222-0000-0000-000000000001","kalemler":[{"aciklama":"UKEM","haric":100,"oran":20,"kdv":20}]}
 ]}'::jsonb)$$);
reset role;
select tst.ok('EFT-1 toplamları: 1500 hariç, 250 KDV, 1750 dahil', (select amount_excl_vat = 1500 and vat_amount = 250 and amount_incl_vat = 1750 from invoices where invoice_no = 'EFT-1'));
select tst.ok('EFT-1 iki kalem (%20 ve %10)', (select count(*) = 2 and count(*) filter (where vat_rate = 10) = 1 from invoice_items ii join invoices i on i.id = ii.invoice_id where i.invoice_no = 'EFT-1'));
select tst.ok('Vade = fatura tarihi + 30', (select due_date = invoice_date + 30 from invoices where invoice_no = 'EFT-1'));
select tst.ok('Yeni firma oluşturuldu ve faturaya bağlandı', (select c.name = 'Yeni Ltd' from invoices i join companies c on c.id = i.company_id where i.invoice_no = 'EFT-2'));
select tst.ok('Dönem boş bırakılabilir', (select service_period is null from invoices where invoice_no = 'EFT-2'));
select tst.ok('İşyeri bağlandı', (select site_id is not null from invoices where invoice_no = 'EFT-3'));
select tst.ok('Takma ad hafızaya yazıldı', (select count(*) = 1 from invoice_aliases where alias_key = 'alfa gida'));
select tst.ok('Gelir türü fatura', (select income_kind = 'fatura' from invoices where invoice_no = 'EFT-1'));

set role authenticated; select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false);
select tst.ok('Aynı numara tekrar yüklenince atlanır', (select (public.gelir_aktar('{"faturalar":[{"no":"EFT-1","tarih":"2026-10-05","firma_id":"aaaaaaaa-1111-0000-0000-000000000001","kalemler":[{"aciklama":"x","haric":10,"oran":20,"kdv":2}]}]}'::jsonb) -> 'atlanan' -> 0 ->> 'no') = 'EFT-1'));
select tst.fails('Hata olursa hiçbiri yazılmaz (ikinci satır firmasız)', $$select public.gelir_aktar('{"yeni_firmalar":[{"anahtar":"z","ad":"Hayalet AŞ"}],"faturalar":[
  {"no":"EFT-9","tarih":"2026-10-05","yeni_firma":"z","kalemler":[{"aciklama":"x","haric":10,"oran":20,"kdv":2}]},
  {"no":"EFT-10","tarih":"2026-10-05","kalemler":[{"aciklama":"x","haric":10,"oran":20,"kdv":2}]}]}'::jsonb)$$, 'Firma belirlenmemiş');
select tst.fails('Başka kurumun firması kullanılamaz', $$select public.gelir_aktar('{"faturalar":[{"no":"EFT-11","tarih":"2026-10-05","firma_id":"bbbbbbbb-1111-0000-0000-000000000001","kalemler":[{"aciklama":"x","haric":10,"oran":20,"kdv":2}]}]}'::jsonb)$$, 'Firma bulunamadı');
select tst.fails('İşyeri başka firmaya ait olamaz', $$select public.gelir_aktar('{"faturalar":[{"no":"EFT-12","tarih":"2026-10-05","firma_id":"aaaaaaaa-1111-0000-0000-000000000001","site_id":"aaaaaaaa-2222-0000-0000-000000000001","kalemler":[{"aciklama":"x","haric":10,"oran":20,"kdv":2}]}]}'::jsonb)$$, 'İşyeri bu firmaya ait değil');
select tst.fails('Sıfır tutarlı fatura reddedilir', $$select public.gelir_aktar('{"faturalar":[{"no":"EFT-13","tarih":"2026-10-05","firma_id":"aaaaaaaa-1111-0000-0000-000000000001","kalemler":[{"aciklama":"x","haric":0,"oran":20,"kdv":0}]}]}'::jsonb)$$, 'sıfırdan büyük');
select tst.fails('Boş paket reddedilir', $$select public.gelir_aktar('{"faturalar":[]}'::jsonb)$$, 'Aktarılacak');
reset role;
select tst.ok('Hatalı pakette Hayalet AŞ oluşmadı', (select count(*) = 0 from companies where name = 'Hayalet AŞ'));
select tst.ok('Hatalı pakette EFT-9 oluşmadı', (select count(*) = 0 from invoices where invoice_no = 'EFT-9'));

-- yetki: satış rolü fatura ekleyemez
set role authenticated; select set_config('request.jwt.claim.sub','22222222-2222-2222-2222-222222222222',false);
select tst.fails('Satış rolü gelir aktaramaz', $$select public.gelir_aktar('{"faturalar":[{"no":"EFT-20","tarih":"2026-10-05","firma_id":"aaaaaaaa-1111-0000-0000-000000000001","kalemler":[{"aciklama":"x","haric":10,"oran":20,"kdv":2}]}]}'::jsonb)$$, 'yetki');
select tst.ok('Satış rolü takma adları göremez', (select count(*) = 0 from invoice_aliases));
reset role;

-- ---------------------------------------------------------------- spot / elden
set role authenticated; select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false);
select tst.works('Spot iş: %20 KDV hariç', $$select public.gelir_kalemi_ekle('aaaaaaaa-1111-0000-0000-000000000001','spot',(select bugun from g),'Ek eğitim',1000,'kdv_haric',20,false,null)$$);
select tst.works('Elden ödeme: KDV yok', $$select public.gelir_kalemi_ekle('aaaaaaaa-1111-0000-0000-000000000001','elden',(select bugun from g),'Nakit muayene',500,'kdv_haric',20,true,null)$$);
select tst.fails('Açıklamasız gelir reddedilir', $$select public.gelir_kalemi_ekle('aaaaaaaa-1111-0000-0000-000000000001','spot',(select bugun from g),' ',100)$$, 'ne olduğunu');
select tst.fails('Geçersiz tür reddedilir', $$select public.gelir_kalemi_ekle('aaaaaaaa-1111-0000-0000-000000000001','fatura',(select bugun from g),'x',100)$$, 'spot veya elden');
reset role;
select tst.ok('Spot: 1000 + 200 KDV, tahsil edilmedi', (select amount_excl_vat = 1000 and vat_amount = 200 and not exists (select 1 from payments p where p.invoice_id = i.id) from invoices i where i.income_kind = 'spot'));
select tst.ok('Elden: KDV 0 (oran girilse bile), kalem oranı 0', (select i.vat_amount = 0 and i.amount_incl_vat = 500 and (select vat_rate from invoice_items where invoice_id = i.id) = 0 from invoices i where i.income_kind = 'elden'));
select tst.ok('Elden: otomatik tahsilat yöntemi Elden', (select p.method = 'Elden' and p.amount = 500 from payments p join invoices i on i.id = p.invoice_id where i.income_kind = 'elden'));
select tst.ok('Fatura numarası otomatik verildi', (select invoice_no like 'F-%' from invoices where income_kind = 'spot'));
select tst.fails('Geçersiz gelir türü veri tabanında da engelli', $$update invoices set income_kind = 'x'$$, 'invoices_income_kind_chk');
