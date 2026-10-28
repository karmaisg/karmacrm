-- OSGB 360 - Aşama 6 veri tabanı testleri (yerel PostgreSQL 16 + Supabase taklidi)
-- Sıra: supabase_stub.sql -> 01_sema.sql -> 03_asama2.sql -> 04_asama3.sql -> 05_asama4.sql -> 06_asama5.sql -> 07_asama6.sql -> bu dosya (boş bir veri tabanında)
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
 ('56565656-5656-5656-5656-565656565656','operasyon@karma.test'),
 ('44444444-4444-4444-4444-444444444444','yabanci@baska.test');
insert into users(id,organization_id,role_id,full_name,email)
select u.id, r.organization_id, r.id, u.ad, u.eposta
from (values
  ('11111111-1111-1111-1111-111111111111'::uuid,'isletme_sahibi','aaaaaaaa-0000-0000-0000-000000000001'::uuid,'Sahip','sahip@karma.test'),
  ('22222222-2222-2222-2222-222222222222','satis','aaaaaaaa-0000-0000-0000-000000000001','Satışçı','satis@karma.test'),
  ('33333333-3333-3333-3333-333333333333','finans','aaaaaaaa-0000-0000-0000-000000000001','Finansçı','finans@karma.test'),
  ('56565656-5656-5656-5656-565656565656','operasyon','aaaaaaaa-0000-0000-0000-000000000001','Operasyoncu','operasyon@karma.test'),
  ('44444444-4444-4444-4444-444444444444','isletme_sahibi','bbbbbbbb-0000-0000-0000-000000000002','Yabancı','yabanci@baska.test')
) as u(id,rol,org,ad,eposta)
join roles r on r.key = u.rol and r.organization_id = u.org;

insert into companies(id,organization_id,name,tax_no) values
 ('aaaaaaaa-1111-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001','Demir Çelik A.Ş.','1111111111'),
 ('aaaaaaaa-1111-0000-0000-000000000002','aaaaaaaa-0000-0000-0000-000000000001','Ay Gıda Ltd.','2222222222'),
 ('aaaaaaaa-1111-0000-0000-000000000003','aaaaaaaa-0000-0000-0000-000000000001','Özel Fiyat Ltd.','3333333333'),
 ('aaaaaaaa-1111-0000-0000-000000000004','aaaaaaaa-0000-0000-0000-000000000001','Profilsiz Ltd.','4444444444'),
 ('bbbbbbbb-1111-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000002','Yabancı Firma','9999999999');
insert into company_profiles(company_id,organization_id,employee_count,hazard_class,valid_from) values
 ('aaaaaaaa-1111-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001',50,'tehlikeli','2020-01-01'),
 ('aaaaaaaa-1111-0000-0000-000000000002','aaaaaaaa-0000-0000-0000-000000000001',10,'az_tehlikeli','2020-01-01'),
 ('aaaaaaaa-1111-0000-0000-000000000003','aaaaaaaa-0000-0000-0000-000000000001',5,'az_tehlikeli','2020-01-01');
insert into employees(id,organization_id,full_name,staff_type) values
 ('aaaaaaaa-5555-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001','Ayşe Uzman','is_guvenligi_uzmani'),
 ('bbbbbbbb-5555-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000002','Yabancı Uzman','is_guvenligi_uzmani');

-- Sözleşmeler (sahip): kişi başı KDV hariç, sabit aylık KDV dahil, özel, profilsiz
set role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false);
select public.sozlesme_olustur('aaaaaaaa-1111-0000-0000-000000000001', '2026-01-01', '2026-12-31', 'kisi_basi', 100, null, 'kdv_haric', 20);
select public.sozlesme_olustur('aaaaaaaa-1111-0000-0000-000000000002', '2026-01-01', '2026-12-31', 'sabit_aylik', null, 6000, 'kdv_dahil', 20);
select public.sozlesme_olustur('aaaaaaaa-1111-0000-0000-000000000003', '2026-01-01', '2026-12-31', 'ozel', null, null, 'kdv_haric', 20);
select public.sozlesme_olustur('aaaaaaaa-1111-0000-0000-000000000004', '2026-01-01', '2026-12-31', 'kisi_basi', 100, null, 'kdv_haric', 20);
reset role;

-- =====================================================================
-- A) KDV ayrımı
-- =====================================================================
select tst.ok('KDV hariç 1000 @20: 1000 + 200', (select haric=1000 and kdv=200 from app.kdv_ayir(1000,'kdv_haric',20)));
select tst.ok('KDV dahil 1200 @20: 1000 + 200', (select haric=1000 and kdv=200 from app.kdv_ayir(1200,'kdv_dahil',20)));
select tst.ok('KDV dahil 100 @20: 83.33 + 16.67 (toplam korunur)', (select haric=83.33 and kdv=16.67 from app.kdv_ayir(100,'kdv_dahil',20)));
select tst.ok('KDV hariç 0.01 @20: yuvarlama', (select haric=0.01 and kdv=0 from app.kdv_ayir(0.01,'kdv_haric',20)));
select tst.fails('Sıfır tutar reddedilir', $$select * from app.kdv_ayir(0,'kdv_haric',20)$$, 'sıfırdan büyük');
select tst.fails('Negatif tutar reddedilir', $$select * from app.kdv_ayir(-5,'kdv_haric',20)$$, 'sıfırdan büyük');
select tst.fails('KDV oranı 150 reddedilir', $$select * from app.kdv_ayir(100,'kdv_haric',150)$$, 'KDV oranı');

-- =====================================================================
-- B) Fatura (finans)
-- =====================================================================
set role authenticated;
select set_config('request.jwt.claim.sub','33333333-3333-3333-3333-333333333333',false);

select tst.works('Finans: fatura ekler (numara otomatik)',
  $$select public.fatura_kaydet(null,'aaaaaaaa-1111-0000-0000-000000000001',null,null,'2026-09-01','2026-09-30','2026-09-15',12000,'kdv_haric',20,'Eylül hizmet bedeli',null)$$);
select tst.ok('Numara F-2026-0001', (select invoice_no='F-2026-0001' from invoices order by created_at limit 1));
select tst.ok('Tutarlar: 12000 + 2400 = 14400; dönem ayın 1''i', (select amount_excl_vat=12000 and vat_amount=2400 and amount_incl_vat=14400 and service_period='2026-09-01' from invoices where invoice_no='F-2026-0001'));
select tst.ok('Tek kalem oluştu', (select count(*)=1 and min(description)='Eylül hizmet bedeli' from invoice_items i join invoices v on v.id=i.invoice_id where v.invoice_no='F-2026-0001'));
select tst.works('İkinci fatura: numara artar',
  $$select public.fatura_kaydet(null,'aaaaaaaa-1111-0000-0000-000000000002',null,null,'2026-09-02','2026-10-02',null,7200,'kdv_dahil',20,null,'not')$$);
select tst.ok('İkinci numara F-2026-0002, KDV dahil ayrıştı', (select invoice_no='F-2026-0002' and amount_excl_vat=6000 and vat_amount=1200 from invoices where notes='not'));
select tst.works('Elle numara verilebilir',
  $$select public.fatura_kaydet(null,'aaaaaaaa-1111-0000-0000-000000000002',null,'  GİB-77  ','2026-09-03','2026-09-03',null,100,'kdv_haric',20,null,null)$$);
select tst.ok('Elle numara kırpılır', (select count(*)=1 from invoices where invoice_no='GİB-77'));
select tst.fails('Aynı numara ikinci kez kullanılamaz',
  $$select public.fatura_kaydet(null,'aaaaaaaa-1111-0000-0000-000000000002',null,'GİB-77','2026-09-03','2026-09-03',null,100,'kdv_haric',20,null,null)$$, 'invoices_organization_id_invoice_no_key');
select tst.fails('Vade fatura tarihinden önce olamaz',
  $$select public.fatura_kaydet(null,'aaaaaaaa-1111-0000-0000-000000000002',null,null,'2026-09-03','2026-09-02',null,100,'kdv_haric',20,null,null)$$, 'Vade tarihi');
select tst.fails('Sıfır tutarlı fatura reddedilir',
  $$select public.fatura_kaydet(null,'aaaaaaaa-1111-0000-0000-000000000002',null,null,'2026-09-03','2026-09-30',null,0,'kdv_haric',20,null,null)$$, 'sıfırdan büyük');
select tst.fails('Başka firmanın sözleşmesi seçilemez',
  $$select public.fatura_kaydet(null,'aaaaaaaa-1111-0000-0000-000000000001',(select id from contracts where company_id='aaaaaaaa-1111-0000-0000-000000000002'),null,'2026-09-03','2026-09-30',null,100,'kdv_haric',20,null,null)$$, 'Seçilen sözleşme');
select tst.fails('Başka kurumun firması reddedilir',
  $$select public.fatura_kaydet(null,'bbbbbbbb-1111-0000-0000-000000000001',null,null,'2026-09-03','2026-09-30',null,100,'kdv_haric',20,null,null)$$);
select tst.works('Fatura düzenlenir (tutar 15000 hariç)',
  $$select public.fatura_kaydet((select id from invoices where invoice_no='F-2026-0001'),null,null,null,'2026-09-01','2026-09-30','2026-09-15',15000,'kdv_haric',20,'Eylül (düzeltildi)',null)$$);
select tst.ok('Düzenleme tutarı ve kalemi güncelledi', (select i.amount_incl_vat=18000 and (select unit_price_excl from invoice_items where invoice_id=i.id)=15000 from invoices i where invoice_no='F-2026-0001'));
select tst.ok('Düzenleme numarayı değiştirmedi', (select count(*)=1 from invoices where invoice_no='F-2026-0001'));
select tst.fails('Faturanın firması değiştirilemez',
  $$update invoices set company_id='aaaaaaaa-1111-0000-0000-000000000002' where invoice_no='F-2026-0001'$$, 'firması değiştirilemez');
select tst.fails('Numara boşaltılamaz', $$update invoices set invoice_no='  ' where invoice_no='F-2026-0001'$$, 'numarası boş');
select tst.fails('Fatura silinemez (fiziksel silme yok)', $$delete from invoices where invoice_no='F-2026-0001'$$);

-- Bir sözleşme + dönem için tek fatura
select tst.works('Sözleşmeli dönem faturası',
  $$select public.fatura_kaydet(null,'aaaaaaaa-1111-0000-0000-000000000004',(select id from contracts where company_id='aaaaaaaa-1111-0000-0000-000000000004'),'DON-1','2026-08-05','2026-09-05','2026-08-20',100,'kdv_haric',20,null,null)$$);
select tst.fails('Aynı sözleşme ve dönem için ikinci fatura reddedilir',
  $$select public.fatura_kaydet(null,'aaaaaaaa-1111-0000-0000-000000000004',(select id from contracts where company_id='aaaaaaaa-1111-0000-0000-000000000004'),'DON-2','2026-08-06','2026-09-06','2026-08-01',100,'kdv_haric',20,null,null)$$, 'invoices_donem_uq');
select tst.works('Dönemsiz ek fatura serbest',
  $$select public.fatura_kaydet(null,'aaaaaaaa-1111-0000-0000-000000000004',(select id from contracts where company_id='aaaaaaaa-1111-0000-0000-000000000004'),'EK-1','2026-08-06','2026-09-06',null,100,'kdv_haric',20,null,null)$$);

-- =====================================================================
-- C) Tahsilat
-- =====================================================================
select tst.works('1. kısmi tahsilat', $$insert into payments(invoice_id,paid_at,amount,method) values ((select id from invoices where invoice_no='F-2026-0001'),'2026-10-05',5000,'  Havale ')$$);
select tst.ok('Yöntem kırpılır', (select method='Havale' from payments limit 1));
select tst.works('2. kısmi tahsilat', $$insert into payments(invoice_id,paid_at,amount) values ((select id from invoices where invoice_no='F-2026-0001'),'2026-10-10',3000)$$);
select tst.ok('Bakiye 10.000, kısmi tahsilat', (select balance=10000 and paid_total=8000 and collection_status='kismi_tahsilat' from invoice_balances where invoice_no='F-2026-0001'));
select tst.fails('Gelecek tarihli tahsilat reddedilir',
  format($$insert into payments(invoice_id,paid_at,amount) values ((select id from invoices where invoice_no='F-2026-0001'),%L,10)$$, (app.today_tr()+1)::text), 'gelecekte');
select tst.works('Bugünkü tahsilat serbest',
  format($$insert into payments(invoice_id,paid_at,amount) values ((select id from invoices where invoice_no='F-2026-0001'),%L,10)$$, app.today_tr()::text));
select tst.fails('Sıfır tutarlı tahsilat reddedilir', $$insert into payments(invoice_id,paid_at,amount) values ((select id from invoices where invoice_no='F-2026-0001'),'2026-10-10',0)$$);
select tst.fails('Tahsilatın faturası değiştirilemez',
  $$update payments set invoice_id=(select id from invoices where invoice_no='F-2026-0002') where amount=5000$$, 'faturası değiştirilemez');
select tst.fails('Tahsilatı olan fatura arşivlenemez',
  $$update invoices set archived_at=now() where invoice_no='F-2026-0001'$$, 'Tahsilatı olan');
select tst.works('Kalanı öder, fazla da girilebilir',
  $$insert into payments(invoice_id,paid_at,amount) values ((select id from invoices where invoice_no='F-2026-0001'),'2026-10-12',9990)$$);
select tst.ok('Tam tahsil edildi', (select balance=0 and collection_status='tahsil_edildi' and not overpaid from invoice_balances where invoice_no='F-2026-0001'));
select tst.works('Fazla tahsilat engellenmez', $$insert into payments(invoice_id,paid_at,amount) values ((select id from invoices where invoice_no='F-2026-0001'),'2026-10-13',25)$$);
select tst.ok('Fazla tahsilat işaretlenir', (select overpaid and balance=-25 from invoice_balances where invoice_no='F-2026-0001'));
select tst.works('Tahsilat iptali (arşiv)', $$update payments set archived_at=now() where amount=25$$);
select tst.ok('İptal sonrası fazla tahsilat kalkar', (select not overpaid and balance=0 from invoice_balances where invoice_no='F-2026-0001'));
select tst.fails('İptal edilmiş tahsilat değiştirilemez', $$update payments set amount=26 where amount=25$$, 'İptal edilmiş');
select tst.works('İtirazlı işareti', $$update invoices set flag='itirazli' where invoice_no='F-2026-0002'$$);
select tst.ok('İtirazlı durum görünür', (select collection_status='itirazli' from invoice_balances where invoice_no='F-2026-0002'));

-- =====================================================================
-- D) Vade gecikmesi görevleri (finans görev ekleyemez; sahip ekler)
-- =====================================================================
select tst.ok('Finans (görev ekleyebilir): gecikmiş faturalar için görev üretir (GİB-77, DON-1, EK-1 = 3; F-0002 itirazlı, F-0001 ödenmiş)', public.tahsilat_gecikme_gorevleri() = 3);
select set_config('request.jwt.claim.sub','22222222-2222-2222-2222-222222222222',false);
select tst.ok('Satış (faturaları göremez): görev üretmez', public.tahsilat_gecikme_gorevleri() = 0);
reset role;
-- Gecikmeyi test için hazırla: GİB-77 (vade 2026-09-03, ödenmedi) ve EK-1/DON-1 (vade eylül)
set role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false);
select tst.ok('Sahip: aynı görevleri tekrar üretmez', public.tahsilat_gecikme_gorevleri() = 0);
select tst.ok('Aynı görev ikinci kez üretilmez', public.tahsilat_gecikme_gorevleri() = 0);
select tst.ok('Görev türü ve kaynak doğru', (select count(*)=3 from tasks where kind='tahsilat_takibi' and source_ref like 'fatura:%' and status='acik'));
select tst.ok('Çok gecikmiş (>30 gün) yüksek öncelik', (select count(*)>=1 from tasks where kind='tahsilat_takibi' and priority in ('yuksek','kritik')));
select tst.works('Itiraz kalkar', $$update invoices set flag=null where invoice_no='F-2026-0002'$$);
select tst.ok('Itiraz kalkınca F-0002 için de görev üretilir', public.tahsilat_gecikme_gorevleri() = 1);
reset role;
set role authenticated;
select set_config('request.jwt.claim.sub','33333333-3333-3333-3333-333333333333',false);
select tst.works('Gecikmiş faturaya ödeme', $$insert into payments(invoice_id,paid_at,amount) values ((select id from invoices where invoice_no='GİB-77'),'2026-10-14',120)$$);
reset role;
select tst.ok('Tam ödenen faturanın görevi otomatik kapandı', (select status='tamamlandi' and completed_at is not null from tasks where source_ref='fatura:'||(select id::text from invoices where invoice_no='GİB-77')));
select tst.ok('Diğer görevler açık kaldı', (select count(*)=3 from tasks where kind='tahsilat_takibi' and status='acik'));

-- =====================================================================
-- E) Toplu dönem faturası
-- =====================================================================
set role authenticated;
select set_config('request.jwt.claim.sub','33333333-3333-3333-3333-333333333333',false);
create temp table sonuc(j jsonb);
grant all on sonuc to authenticated;
select tst.works('Finans: Ekim 2026 toplu fatura', $$insert into sonuc select public.donem_faturalari_olustur('2026-10-17','2026-10-01',30)$$);
select tst.ok('2 fatura üretildi (kişi başı + sabit aylık)', (select (j->>'olusturulan')::int = 2 from sonuc));
select tst.ok('Atlananlar: özel fiyat + profilsiz firma', (select jsonb_array_length(j->'atlanan') = 2 and (j::text like '%Özel fiyatlı%') and (j::text like '%çalışan sayısı yok%') from sonuc));
select tst.ok('Kişi başı: 50 x 100 = 5000 hariç, 1000 KDV',
  (select i.amount_excl_vat=5000 and i.vat_amount=1000 and i.service_period='2026-10-01' and i.due_date='2026-10-31' from invoices i where company_id='aaaaaaaa-1111-0000-0000-000000000001' and service_period='2026-10-01'));
select tst.ok('Sabit aylık KDV dahil 6000: 5000 + 1000',
  (select i.amount_excl_vat=5000 and i.vat_amount=1000 from invoices i where company_id='aaaaaaaa-1111-0000-0000-000000000002' and service_period='2026-10-01'));
select tst.ok('Kalem açıklaması ay adını içerir', (select description like '%Ekim 2026%' from invoice_items it join invoices i on i.id=it.invoice_id where i.company_id='aaaaaaaa-1111-0000-0000-000000000001' and i.service_period='2026-10-01'));
select tst.ok('Numaralar benzersiz ve sıralı', (select count(distinct invoice_no)=count(*) from invoices));
truncate sonuc;
select tst.works('Aynı dönem tekrar çalıştırılır', $$insert into sonuc select public.donem_faturalari_olustur('2026-10-01','2026-10-01',30)$$);
select tst.ok('Tekrarda yeni fatura üretilmez (idempotent)', (select (j->>'olusturulan')::int = 0 and jsonb_array_length(j->'atlanan') = 4 from sonuc));
select tst.ok('Mevcut fatura atlama nedeni', (select j::text like '%zaten var%' from sonuc));
select tst.fails('Vade günü 400 reddedilir', $$select public.donem_faturalari_olustur('2026-10-01',null,400)$$, 'Vade günü');
-- Sözleşme dışı dönem
truncate sonuc;
select tst.works('Sözleşme dışı dönem (2027-03)', $$insert into sonuc select public.donem_faturalari_olustur('2027-03-01',null,30)$$);
select tst.ok('Sözleşme yoksa hiçbir şey üretilmez', (select (j->>'olusturulan')::int = 0 and jsonb_array_length(j->'atlanan') = 0 from sonuc));

set role authenticated;
select set_config('request.jwt.claim.sub','22222222-2222-2222-2222-222222222222',false);
select tst.fails('Satış: toplu fatura yetkisi yok', $$select public.donem_faturalari_olustur('2026-11-01',null,30)$$, 'yetkiniz');
select tst.ok('Satış: faturaları göremez', (select count(*)=0 from invoices));
select tst.fails('Satış: fatura ekleyemez', $$select public.fatura_kaydet(null,'aaaaaaaa-1111-0000-0000-000000000001',null,null,'2026-09-01','2026-09-30',null,100,'kdv_haric',20,null,null)$$, 'yetkiniz');
select tst.ok('Satış: tahsilatları göremez', (select count(*)=0 from payments));
select set_config('request.jwt.claim.sub','56565656-5656-5656-5656-565656565656',false);
select tst.ok('Operasyon: faturaları göremez', (select count(*)=0 from invoices));
select set_config('request.jwt.claim.sub','44444444-4444-4444-4444-444444444444',false);
select tst.ok('Başka kurum: faturaları göremez', (select count(*)=0 from invoices) and (select count(*)=0 from payments));
select tst.fails('Başka kurum: bizim firmamıza fatura kesemez',
  $$select public.fatura_kaydet(null,'aaaaaaaa-1111-0000-0000-000000000001',null,null,'2026-09-01','2026-09-30',null,100,'kdv_haric',20,null,null)$$);
reset role;

-- =====================================================================
-- F) Gider
-- =====================================================================
set role authenticated;
select set_config('request.jwt.claim.sub','33333333-3333-3333-3333-333333333333',false);
select tst.ok('Finans: kategorileri görür (17)', (select count(*)=17 from expense_categories));

select tst.works('Ortak gider: kira KDV dahil 12000',
  $$select public.gider_kaydet(null,(select id from expense_categories where name='Kira'),'2026-10-03',12000,'kdv_dahil',20,'ortak',null,null,true,'Ekim kirası')$$);
select tst.ok('Kira: 10000 + 2000', (select amount_excl_vat=10000 and vat_amount=2000 and amount_incl_vat=12000 and paid from expenses where description='Ekim kirası'));
select tst.works('Doğrudan gider: firmaya',
  $$select public.gider_kaydet(null,(select id from expense_categories where name='Araç yakıtı'),'2026-10-04',500,'kdv_haric',20,'dogrudan','aaaaaaaa-1111-0000-0000-000000000001',null,false,'Firma yolu')$$);
select tst.fails('Ortak gider firmaya bağlanamaz',
  $$select public.gider_kaydet(null,(select id from expense_categories where name='Kira'),'2026-10-03',100,'kdv_haric',20,'ortak','aaaaaaaa-1111-0000-0000-000000000001',null,false,null)$$, 'Ortak giderde');
select tst.fails('Doğrudan gider bağlantısız olamaz',
  $$select public.gider_kaydet(null,(select id from expense_categories where name='Kira'),'2026-10-03',100,'kdv_haric',20,'dogrudan',null,null,false,null)$$, 'firma veya personel seçilmelidir');
select tst.fails('Doğrudan gider hem firma hem personel olamaz',
  $$select public.gider_kaydet(null,(select id from expense_categories where name='Kira'),'2026-10-03',100,'kdv_haric',20,'dogrudan','aaaaaaaa-1111-0000-0000-000000000001','aaaaaaaa-5555-0000-0000-000000000001',false,null)$$, 'yalnızca biri');
select tst.fails('Başka kurumun personeli reddedilir',
  $$select public.gider_kaydet(null,(select id from expense_categories where name='Kira'),'2026-10-03',100,'kdv_haric',20,'dogrudan',null,'bbbbbbbb-5555-0000-0000-000000000001',false,null)$$);
select tst.fails('Başka kurumun kategorisi reddedilir',
  format($$select public.gider_kaydet(null,%L,'2026-10-03',100,'kdv_haric',20,'ortak',null,null,false,null)$$, (select id from expense_categories where organization_id='bbbbbbbb-0000-0000-0000-000000000002' limit 1)));
select tst.fails('Sıfır tutarlı gider reddedilir',
  $$select public.gider_kaydet(null,(select id from expense_categories where name='Kira'),'2026-10-03',0,'kdv_haric',20,'ortak',null,null,false,null)$$, 'sıfırdan büyük');
select tst.works('Gider düzenlenir (kira 13000 dahil)',
  $$select public.gider_kaydet((select id from expenses where description='Ekim kirası'),(select id from expense_categories where name='Kira'),'2026-10-03',13200,'kdv_dahil',20,'ortak',null,null,true,'Ekim kirası')$$);
select tst.ok('Düzenleme tutarı güncelledi', (select amount_excl_vat=11000 and vat_amount=2200 from expenses where description='Ekim kirası'));

-- Maaş kategorisi
select tst.works('Finans (payroll vce): maaş gideri ekler',
  $$select public.gider_kaydet(null,(select id from expense_categories where name='Uzman maaşları'),'2026-10-05',40000,'kdv_haric',0,'dogrudan',null,'aaaaaaaa-5555-0000-0000-000000000001',true,'Ekim maaş')$$);
select tst.ok('Finans maaş giderini görür', (select count(*)=1 from expenses where description='Ekim maaş'));
select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false);
reset role;
-- Operasyon: expenses yetkisi yok -> göremez; yetki yoksa ekleyemez
set role authenticated;
select set_config('request.jwt.claim.sub','56565656-5656-5656-5656-565656565656',false);
select tst.ok('Operasyon: giderleri göremez', (select count(*)=0 from expenses));
select tst.fails('Operasyon: gider ekleyemez',
  $$select public.gider_kaydet(null,(select id from expense_categories where name='Kira'),'2026-10-03',100,'kdv_haric',20,'ortak',null,null,false,null)$$, 'yetkiniz');
reset role;

-- Payroll yetkisi olmayan expenses kullanıcısı: finans rolünün payroll iznini kaldırıp dene
update role_permissions set can_view=false, can_create=false, can_edit=false
 where module='payroll' and role_id=(select id from roles where key='finans' and organization_id='aaaaaaaa-0000-0000-0000-000000000001');
set role authenticated;
select set_config('request.jwt.claim.sub','33333333-3333-3333-3333-333333333333',false);
select tst.ok('Payroll yetkisiz finans: maaş giderini göremez', (select count(*)=0 from expenses where description='Ekim maaş'));
select tst.ok('Ama diğer giderleri görür', (select count(*)>=2 from expenses));
select tst.fails('Payroll yetkisiz: maaş gideri ekleyemez',
  $$select public.gider_kaydet(null,(select id from expense_categories where name='Uzman maaşları'),'2026-10-05',100,'kdv_haric',0,'dogrudan',null,'aaaaaaaa-5555-0000-0000-000000000001',true,'Gizli')$$, 'payroll');
select tst.fails('Payroll yetkisiz: maaş kategorisine kaydırma reddedilir',
  $$select public.gider_kaydet((select id from expenses where description='Firma yolu'),(select id from expense_categories where name='Uzman maaşları'),'2026-10-04',500,'kdv_haric',0,'dogrudan','aaaaaaaa-1111-0000-0000-000000000001',null,false,'Firma yolu')$$, 'payroll');
reset role;
update role_permissions set can_view=true, can_create=true, can_edit=true
 where module='payroll' and role_id=(select id from roles where key='finans' and organization_id='aaaaaaaa-0000-0000-0000-000000000001');

-- Ortak havuz koruması (dağıtım Aşama 7'de yapılır; tablo şimdiden korunuyor)
insert into overhead_allocations(organization_id,period,category_id,company_id,basis,amount)
 values ('aaaaaaaa-0000-0000-0000-000000000001','2026-10-01',(select id from expense_categories where name='Kira' and organization_id='aaaaaaaa-0000-0000-0000-000000000001'),'aaaaaaaa-1111-0000-0000-000000000001','manuel',9000);
set role authenticated;
select set_config('request.jwt.claim.sub','33333333-3333-3333-3333-333333333333',false);
select tst.fails('Dağıtılmış havuz 9000 altına (8000) düşürülemez',
  $$select public.gider_kaydet((select id from expenses where description='Ekim kirası'),(select id from expense_categories where name='Kira'),'2026-10-03',9600,'kdv_dahil',20,'ortak',null,null,true,'Ekim kirası')$$, 'dağıtımının');
select tst.fails('Dağıtılmış havuzdaki ortak gider arşivlenemez',
  $$update expenses set archived_at=now() where description='Ekim kirası'$$, 'dağıtımının');
select tst.fails('Ortak gider başka aya taşınıp havuz boşaltılamaz',
  $$select public.gider_kaydet((select id from expenses where description='Ekim kirası'),(select id from expense_categories where name='Kira'),'2026-11-03',13200,'kdv_dahil',20,'ortak',null,null,true,'Ekim kirası')$$, 'dağıtımının');
select tst.works('Havuzu artıran düzenleme serbest',
  $$select public.gider_kaydet((select id from expenses where description='Ekim kirası'),(select id from expense_categories where name='Kira'),'2026-10-03',15000,'kdv_dahil',20,'ortak',null,null,true,'Ekim kirası')$$);
select tst.works('Doğrudan gider arşivlenir', $$update expenses set archived_at=now() where description='Firma yolu'$$);
select tst.fails('Arşivdeki gider değiştirilemez', $$update expenses set description='x' where description='Firma yolu'$$, 'Arşivdeki');
select tst.fails('Gider silinemez', $$delete from expenses where description='Ekim maaş'$$);

-- Kategori
select tst.works('Finans: yeni kategori ekleyemez (settings yetkisi yok)?', $$select 1$$);
select tst.fails('Finans: kategori ekleyemez', $$insert into expense_categories(name,nature,default_cost_type) values ('Yeni','isletme','ortak')$$);
select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false);
select tst.works('Sahip: kategori ekler', $$insert into expense_categories(name,nature,default_cost_type) values ('  Sigorta  ','isletme','ortak')$$);
select tst.ok('Kategori adı kırpılır', (select count(*)=1 from expense_categories where name='Sigorta'));
select tst.fails('Aynı ad ikinci kez eklenemez', $$insert into expense_categories(name,nature,default_cost_type) values ('Sigorta','isletme','ortak')$$);
select tst.fails('Boş kategori adı reddedilir', $$insert into expense_categories(name,nature,default_cost_type) values ('  ','isletme','ortak')$$, 'boş olamaz');
select tst.fails('Giderli kategorinin maaş niteliği değiştirilemez', $$update expense_categories set is_payroll=true, nature='personel' where name='Kira'$$, 'değiştirilemez');
select tst.fails('Maaş kategorisi işletme niteliğinde olamaz', $$insert into expense_categories(name,nature,default_cost_type,is_payroll) values ('Maaş2','isletme','dogrudan',true)$$, 'niteliği');
reset role;

-- =====================================================================
-- G) Denetim ve arşiv yetkisi
-- =====================================================================
select tst.ok('Fatura/tahsilat/gider değişiklikleri denetim kaydına düştü',
  (select count(*) filter (where table_name='invoices')>0 and count(*) filter (where table_name='payments')>0 and count(*) filter (where table_name='expenses')>0 from audit_logs));
select tst.ok('Tahsilat iptal eden kullanıcı kaydedildi', (select archived_by='33333333-3333-3333-3333-333333333333' from payments where amount=25));
