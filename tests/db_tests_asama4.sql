-- OSGB 360 - Aşama 4 veri tabanı testleri (yerel PostgreSQL 16 + Supabase taklidi)
-- Sıra: supabase_stub.sql -> 01_sema.sql -> 03_asama2.sql -> 04_asama3.sql -> 05_asama4.sql -> bu dosya (boş bir veri tabanında)
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
 ('55555555-5555-5555-5555-555555555555','uzman@karma.test'),
 ('44444444-4444-4444-4444-444444444444','yabanci@baska.test'),
 ('66666666-6666-6666-6666-666666666666','Yeni.Kisi@Karma.test'),
 ('77777777-7777-7777-7777-777777777777','yeni2@karma.test');

insert into users(id,organization_id,role_id,full_name,email)
select u.id, r.organization_id, r.id, u.ad, u.eposta
from (values
  ('11111111-1111-1111-1111-111111111111'::uuid,'isletme_sahibi','aaaaaaaa-0000-0000-0000-000000000001'::uuid,'Sahip','sahip@karma.test'),
  ('22222222-2222-2222-2222-222222222222','satis','aaaaaaaa-0000-0000-0000-000000000001','Satışçı','satis@karma.test'),
  ('33333333-3333-3333-3333-333333333333','finans','aaaaaaaa-0000-0000-0000-000000000001','Finansçı','finans@karma.test'),
  ('55555555-5555-5555-5555-555555555555','uzman_hekim','aaaaaaaa-0000-0000-0000-000000000001','Uzman','uzman@karma.test'),
  ('44444444-4444-4444-4444-444444444444','isletme_sahibi','bbbbbbbb-0000-0000-0000-000000000002','Yabancı','yabanci@baska.test')
) as u(id,rol,org,ad,eposta)
join roles r on r.key = u.rol and r.organization_id = u.org;

insert into companies(id,organization_id,name,tax_no) values
 ('bbbbbbbb-1111-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000002','Yabancı Firma','9999999999');

-- =====================================================================
-- Hazırlık: firma, potansiyel müşteri, fırsat (superuser)
-- =====================================================================
insert into companies(id,organization_id,name,tax_no) values
 ('aaaaaaaa-1111-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001','Demir Çelik A.Ş.','1111111111'),
 ('aaaaaaaa-1111-0000-0000-000000000002','aaaaaaaa-0000-0000-0000-000000000001','Ay Gıda Ltd.','2222222222');
insert into leads(id,organization_id,name) values
 ('aaaaaaaa-2222-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001','Aday Tekstil');
insert into sales_opportunities(id,organization_id,lead_id,title,stage) values
 ('aaaaaaaa-3333-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-2222-0000-0000-000000000001','Aday Tekstil fırsatı','teklif_gonderildi');

-- =====================================================================
-- A) Teklif
-- =====================================================================
set role authenticated;
select set_config('request.jwt.claim.sub','22222222-2222-2222-2222-222222222222',false);  -- satış

select tst.works('Satış: kişi başı fiyatlı teklif taslak olarak açılır',
  $$insert into offers(id,company_id,employee_count,hazard_class,pricing,unit_price,discount_pct,est_expert_cost,est_physician_cost,est_travel_other_cost)
    values ('aaaaaaaa-4444-0000-0000-000000000001','aaaaaaaa-1111-0000-0000-000000000001',30,'tehlikeli','kisi_basi',500,10,6000,3000,1000)$$);
select tst.ok('Teklif numarası otomatik: TKL-<yıl>-0001',
  (select offer_no = 'TKL-' || to_char(current_date,'YYYY') || '-0001' from offers where id='aaaaaaaa-4444-0000-0000-000000000001'));
select tst.works('İkinci teklif (potansiyel müşteriye bağlı, sabit fiyat)',
  $$insert into offers(id,lead_id,opportunity_id,employee_count,hazard_class,pricing,fixed_monthly_price,vat_mode,est_expert_cost)
    values ('aaaaaaaa-4444-0000-0000-000000000002','aaaaaaaa-2222-0000-0000-000000000001','aaaaaaaa-3333-0000-0000-000000000001',12,'az_tehlikeli','sabit_aylik',8000,'kdv_dahil',2000)$$);
select tst.ok('İkinci teklif 0002 numarasını aldı',
  (select offer_no = 'TKL-' || to_char(current_date,'YYYY') || '-0002' from offers where id='aaaaaaaa-4444-0000-0000-000000000002'));
select tst.fails('Teklif firma veya potansiyel müşteri olmadan açılamaz',
  $$insert into offers(employee_count,hazard_class,pricing,unit_price) values (5,'tehlikeli','kisi_basi',100)$$, 'check');
select tst.fails('Kişi başı fiyatlamada birim fiyat zorunlu',
  $$insert into offers(company_id,employee_count,hazard_class,pricing) values ('aaaaaaaa-1111-0000-0000-000000000001',5,'tehlikeli','kisi_basi')$$, 'birim fiyat');
select tst.fails('Sabit fiyatlamada aylık tutar zorunlu',
  $$insert into offers(company_id,employee_count,hazard_class,pricing) values ('aaaaaaaa-1111-0000-0000-000000000001',5,'tehlikeli','sabit_aylik')$$, 'aylık tutar');
select tst.fails('KDV oranı 100''ü aşamaz',
  $$insert into offers(company_id,employee_count,hazard_class,pricing,unit_price,vat_rate) values ('aaaaaaaa-1111-0000-0000-000000000001',5,'tehlikeli','kisi_basi',100,120)$$, 'KDV');
select tst.fails('Negatif maliyet reddedilir',
  $$insert into offers(company_id,employee_count,hazard_class,pricing,unit_price,est_expert_cost) values ('aaaaaaaa-1111-0000-0000-000000000001',5,'tehlikeli','kisi_basi',100,-1)$$, 'negatif');
select tst.fails('Geçerlilik tarihi teklif tarihinden önce olamaz',
  $$insert into offers(company_id,employee_count,hazard_class,pricing,unit_price,valid_until) values ('aaaaaaaa-1111-0000-0000-000000000001',5,'tehlikeli','kisi_basi',100,current_date-1)$$, 'Geçerlilik');
select tst.fails('Yeni teklif gönderilmiş olarak açılamaz',
  $$insert into offers(company_id,employee_count,hazard_class,pricing,unit_price,status) values ('aaaaaaaa-1111-0000-0000-000000000001',5,'tehlikeli','kisi_basi',100,'gonderildi')$$, 'taslak');
select tst.fails('Yabancı kurumun firmasına teklif açılamaz',
  $$insert into offers(company_id,employee_count,hazard_class,pricing,unit_price) values ('bbbbbbbb-1111-0000-0000-000000000001',5,'tehlikeli','kisi_basi',100)$$, 'kuruma ait değil');

select tst.works('Teklif kalemi eklenir',
  $$insert into offer_items(offer_id,description,quantity,unit_price) values ('aaaaaaaa-4444-0000-0000-000000000001','İlk yardım eğitimi',2,1500)$$);
select tst.fails('Kalem miktarı sıfır olamaz',
  $$insert into offer_items(offer_id,description,quantity,unit_price) values ('aaaaaaaa-4444-0000-0000-000000000001','Hatalı',0,100)$$, 'Miktar');

-- durum geçişleri
select tst.fails('Taslak teklif doğrudan kabul edilemez',
  $$update offers set status='kabul_edildi' where id='aaaaaaaa-4444-0000-0000-000000000001'$$, 'Geçersiz teklif durumu');
select tst.works('Taslak teklif gönderilir', $$update offers set status='gonderildi' where id='aaaaaaaa-4444-0000-0000-000000000001'$$);
select tst.fails('Gönderilmiş teklifin fiyatı değiştirilemez',
  $$update offers set unit_price=400 where id='aaaaaaaa-4444-0000-0000-000000000001'$$, 'değiştirilemez');
select tst.fails('Gönderilmiş teklifin indirimi değiştirilemez',
  $$update offers set discount_pct=20 where id='aaaaaaaa-4444-0000-0000-000000000001'$$, 'değiştirilemez');
select tst.fails('Gönderilmiş teklife kalem eklenemez',
  $$insert into offer_items(offer_id,description,quantity,unit_price) values ('aaaaaaaa-4444-0000-0000-000000000001','Geç eklenen',1,100)$$, 'kalemleri değiştirilemez');
select tst.fails('Teklif numarası değiştirilemez',
  $$update offers set offer_no='TKL-1999-0001' where id='aaaaaaaa-4444-0000-0000-000000000001'$$, 'numarası');
select tst.works('Gönderilmiş tekliste açıklama/geçerlilik notu güncellenebilir',
  $$update offers set description='Müşteri görüşmesi sonrası not' where id='aaaaaaaa-4444-0000-0000-000000000001'$$);
select tst.works('Gönderilen teklif görüşülüyor aşamasına geçer', $$update offers set status='gorusuluyor' where id='aaaaaaaa-4444-0000-0000-000000000001'$$);
select tst.works('Görüşülen teklif geri gönderildiye dönebilir', $$update offers set status='gonderildi' where id='aaaaaaaa-4444-0000-0000-000000000001'$$);

-- kopyalama
select tst.works('Teklif yeni taslak sürüm olarak kopyalanır',
  $$create temp table kopya as select (public.teklif_kopyala('aaaaaaaa-4444-0000-0000-000000000001')).id as id$$);
select tst.ok('Kopya taslak, yeni numaralı, aynı fiyat ve kalemlerle',
  (select o.status='taslak' and o.offer_no = 'TKL-' || to_char(current_date,'YYYY') || '-0003' and o.unit_price=500 and o.discount_pct=10
          and (select count(*) from offer_items i where i.offer_id=o.id)=1
     from offers o join kopya k on k.id=o.id));
select tst.works('Kopyanın fiyatı değiştirilebilir (taslak)',
  $$update offers set unit_price=450 where id=(select id from kopya)$$);
select tst.ok('Eski teklif etkilenmedi', (select unit_price=500 from offers where id='aaaaaaaa-4444-0000-0000-000000000001'));

select set_config('request.jwt.claim.sub','55555555-5555-5555-5555-555555555555',false);  -- uzman/hekim
select tst.ok('Uzman/hekim teklifleri göremez', (select count(*) from offers) = 0);
select tst.fails('Uzman/hekim teklif kopyalayamaz', $$select public.teklif_kopyala('aaaaaaaa-4444-0000-0000-000000000001')$$, 'yetkiniz yok');
select set_config('request.jwt.claim.sub','44444444-4444-4444-4444-444444444444',false);  -- başka kurum
select tst.ok('Başka kurum teklifleri göremez', (select count(*) from offers) = 0);
select tst.fails('Başka kurum teklifi kopyalayamaz', $$select public.teklif_kopyala('aaaaaaaa-4444-0000-0000-000000000001')$$, 'bulunamadı');

-- =====================================================================
-- B) Teklifi kabul et -> sözleşme
-- =====================================================================
select set_config('request.jwt.claim.sub','22222222-2222-2222-2222-222222222222',false);  -- satış (sözleşme oluşturamaz)
select tst.fails('Satış (sözleşme yetkisi yok) teklifi kabul edemez',
  $$select public.teklif_kabul_et('aaaaaaaa-4444-0000-0000-000000000001', current_date, current_date+364)$$, 'Sözleşme ekleme yetkiniz yok');

select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false);  -- işletme sahibi
select tst.fails('Taslak teklif kabul edilemez',
  $$select public.teklif_kabul_et((select id from kopya), current_date, current_date+364)$$, 'gönderilmiş');
-- (ikinci teklif önce gönderilmeli)
select tst.works('İkinci teklif gönderilir', $$update offers set status='gonderildi' where id='aaaaaaaa-4444-0000-0000-000000000002'$$);
select tst.fails('Firmaya dönüşmemiş adayın teklifi kabul edilemez',
  $$select public.teklif_kabul_et('aaaaaaaa-4444-0000-0000-000000000002', current_date, current_date+364)$$, 'dönüştürün');
select tst.fails('Bitiş başlangıçtan önce olamaz',
  $$select public.teklif_kabul_et('aaaaaaaa-4444-0000-0000-000000000001', current_date, current_date-1)$$, 'Bitiş');

select tst.works('Teklif kabul edilir, sözleşme oluşur',
  $$create temp table sz as select (public.teklif_kabul_et('aaaaaaaa-4444-0000-0000-000000000001', current_date, current_date+364, '30 gün vade', 'Otomatik yenileme yok', 'Yıllık')).id as id$$);
select tst.ok('Teklif kabul_edildi oldu', (select status='kabul_edildi' from offers where id='aaaaaaaa-4444-0000-0000-000000000001'));
select tst.ok('Sözleşme aktif ve tekliflerle bağlantılı',
  (select c.status='aktif' and c.offer_id='aaaaaaaa-4444-0000-0000-000000000001' and c.company_id='aaaaaaaa-1111-0000-0000-000000000001'
          and c.payment_terms='30 gün vade' from contracts c join sz on sz.id=c.id));
select tst.ok('İlk fiyat dönemi: %10 indirim fiyata işlendi (500 -> 450)',
  (select p.unit_price=450 and p.pricing='kisi_basi' and p.valid_from=current_date and p.valid_to is null
     from contract_prices p join sz on sz.id=p.contract_id));
select tst.ok('Kabul edilmiş teklif sonradan değiştirilemez (yeniden kabul edilemez)',
  (select count(*) from offers where id='aaaaaaaa-4444-0000-0000-000000000001' and status='kabul_edildi')=1);
select tst.fails('Aynı teklif ikinci kez kabul edilemez',
  $$select public.teklif_kabul_et('aaaaaaaa-4444-0000-0000-000000000001', current_date, current_date+364)$$, 'gönderilmiş');

-- adayı firmaya dönüştür: teklifler firmaya bağlanır, kabul fırsatı kazanıldı yapar
select tst.works('Aday firmaya dönüştürülür',
  $$create temp table don as select (public.potansiyel_firmaya_donustur('aaaaaaaa-2222-0000-0000-000000000001')).id as id$$);
select tst.ok('Adayın teklifi firmaya bağlandı',
  (select o.company_id = d.id from offers o, don d where o.id='aaaaaaaa-4444-0000-0000-000000000002'));
select tst.works('Aday teklifi kabul edilir (fırsat kazanıldı olur)',
  $$create temp table sz2 as select (public.teklif_kabul_et('aaaaaaaa-4444-0000-0000-000000000002', current_date, current_date+179)).id as id$$);
select tst.ok('Sabit fiyat ve KDV dahil modu sözleşmeye aktarıldı',
  (select p.pricing='sabit_aylik' and p.fixed_monthly_price=8000 and p.vat_mode='kdv_dahil' from contract_prices p join sz2 on sz2.id=p.contract_id));
select tst.ok('Fırsat kazanıldı ve firmaya bağlandı',
  (select o.stage='kazanildi' and o.company_id=(select id from don) from sales_opportunities o where o.id='aaaaaaaa-3333-0000-0000-000000000001'));

-- =====================================================================
-- C) Sözleşme kuralları
-- =====================================================================
select tst.fails('Aynı firmada çakışan ikinci aktif sözleşme açılamaz',
  $$select public.sozlesme_olustur('aaaaaaaa-1111-0000-0000-000000000001', current_date+30, current_date+400, 'sabit_aylik', null, 5000)$$, 'contracts_aktif_cakisma');
select tst.works('Çakışmayan taslak sözleşme açılabilir',
  $$select public.sozlesme_olustur('aaaaaaaa-1111-0000-0000-000000000001', current_date+400, current_date+700, 'sabit_aylik', null, 5000, 'kdv_haric', 20, 'taslak')$$);
select tst.fails('Bitiş tarihi başlangıçtan önce olamaz',
  $$select public.sozlesme_olustur('aaaaaaaa-1111-0000-0000-000000000002', current_date, current_date-5, 'sabit_aylik', null, 5000)$$, 'Bitiş');
select tst.fails('Kişi başı sözleşmede birim fiyat zorunlu',
  $$select public.sozlesme_olustur('aaaaaaaa-1111-0000-0000-000000000002', current_date, current_date+30, 'kisi_basi', null, null)$$, 'birim fiyat');
select tst.fails('Yabancı firmaya sözleşme açılamaz',
  $$select public.sozlesme_olustur('bbbbbbbb-1111-0000-0000-000000000001', current_date, current_date+30, 'sabit_aylik', null, 100)$$, 'kuruma ait değil');
select tst.fails('Sözleşmenin firması değiştirilemez',
  $$update contracts set company_id='aaaaaaaa-1111-0000-0000-000000000002' where id=(select id from sz)$$, 'firması');
select tst.fails('Sözleşme aktiften taslağa dönemez',
  $$update contracts set status='taslak' where id=(select id from sz)$$, 'Geçersiz sözleşme durumu');

-- fiyat geçmişi
select tst.works('Fiyat artışı: yeni dönem açılır, eski dönem kapanır',
  $$select public.sozlesme_fiyat_ekle((select id from sz), 'kisi_basi', 520, null, 'kdv_haric', 20, current_date+100, 'Enflasyon güncellemesi')$$);
select tst.ok('Eski fiyat korunuyor: 450, bitiş = yeni başlangıçtan bir gün önce',
  (select valid_to = current_date+99 and unit_price=450 from contract_prices where contract_id=(select id from sz) and valid_from=current_date));
select tst.ok('Yeni fiyat 520 açık dönemde',
  (select valid_to is null and unit_price=520 from contract_prices where contract_id=(select id from sz) and valid_from=current_date+100));
select tst.fails('Geçmiş fiyat tutarı değiştirilemez',
  $$update contract_prices set unit_price=1 where contract_id=(select id from sz) and valid_from=current_date$$, 'değiştirilemez');
select tst.fails('Yeni fiyat dönemi mevcut başlangıçtan önce olamaz',
  $$select public.sozlesme_fiyat_ekle((select id from sz), 'kisi_basi', 600, null, 'kdv_haric', 20, current_date+50)$$, 'sonra olmalı');
select tst.fails('Sözleşme bitişinden sonraki tarihte fiyat dönemi açılamaz',
  $$select public.sozlesme_fiyat_ekle((select id from sz), 'kisi_basi', 600, null, 'kdv_haric', 20, current_date+500)$$, 'bitişinden sonra');
select tst.fails('Negatif fiyat reddedilir',
  $$select public.sozlesme_fiyat_ekle((select id from sz), 'kisi_basi', -5, null, 'kdv_haric', 20, current_date+200)$$, 'negatif');
select tst.ok('Fiyat geçmişinde 2 dönem var', (select count(*) from contract_prices where contract_id=(select id from sz)) = 2);

-- yenileme
select tst.fails('Sözleşme başlangıcından önceye yenileme yapılamaz',
  $$select public.sozlesme_yenile((select id from sz), current_date, current_date+700)$$, 'sonra olmalı');
select tst.works('Sözleşme yenilenir (bitişten önce)',
  $$create temp table yn as select (public.sozlesme_yenile((select id from sz), current_date+365, current_date+729)).id as id$$);
select tst.ok('Önceki sözleşme "yenilendi" oldu, yenisi aktif ve zincirli',
  (select (select status from contracts where id=(select id from sz))='yenilendi'
      and (select status='aktif' and previous_contract_id=(select id from sz) from contracts where id=(select id from yn))));
select tst.ok('Yeni sözleşme önceki sözleşmenin son fiyatıyla başladı (520)',
  (select unit_price=520 and valid_from=current_date+365 from contract_prices where contract_id=(select id from yn)));
select tst.ok('Önceki sözleşmenin açık fiyat dönemi kapandı',
  (select count(*) from contract_prices where contract_id=(select id from sz) and valid_to is null) = 0);
select tst.fails('Aynı sözleşme ikinci kez yenilenemez',
  $$select public.sozlesme_yenile((select id from sz), current_date+400, current_date+800)$$, 'Yalnızca aktif');
select tst.fails('Yenilenmiş sözleşmeye fiyat eklenemez',
  $$select public.sozlesme_fiyat_ekle((select id from sz), 'kisi_basi', 700, null, 'kdv_haric', 20, current_date+110)$$, 'Sona ermiş');
select tst.fails('Sona ermiş sözleşmenin tarihleri değiştirilemez',
  $$update contracts set end_date=current_date+999 where id=(select id from sz)$$, 'tarihleri');

-- yenileme uyarıları (90/60/30)
select tst.works('Yakında biten sözleşme (45 gün) ve uzak olan (200 gün)',
  $$select public.sozlesme_olustur('aaaaaaaa-1111-0000-0000-000000000002', current_date-320, current_date+45, 'sabit_aylik', null, 7000)$$);
select tst.ok('Uyarı görevi üretildi: 1 adet (60 gün eşiği)', public.sozlesme_yenileme_gorevleri() = 1);
select tst.ok('Görev başlığı firma adını ve eşiği içeriyor',
  (select count(*) from tasks where kind='sozlesme_yenileme' and title like 'Ay Gıda Ltd.%60 gün%' and status='acik') = 1);
select tst.ok('Aynı eşik için ikinci kez görev üretilmez', public.sozlesme_yenileme_gorevleri() = 0);
select tst.ok('Aktif olan diğer sözleşmenin (364 gün) görevi yok', (select count(*) from tasks where kind='sozlesme_yenileme') = 1);
select tst.works('Yenilenince açık yenileme görevi tamamlanır',
  $$select public.sozlesme_yenile((select id from contracts where company_id='aaaaaaaa-1111-0000-0000-000000000002' and status='aktif'), current_date+46, current_date+410)$$);
select tst.ok('Yenileme görevi tamamlandı', (select status='tamamlandi' and completed_at is not null from tasks where kind='sozlesme_yenileme'));

-- yetkiler
select set_config('request.jwt.claim.sub','22222222-2222-2222-2222-222222222222',false);  -- satış
select tst.ok('Satış sözleşmeleri görebilir', (select count(*) from contracts) >= 3);
select tst.fails('Satış sözleşme oluşturamaz',
  $$select public.sozlesme_olustur('aaaaaaaa-1111-0000-0000-000000000002', current_date+800, current_date+900, 'sabit_aylik', null, 100)$$, 'yetkiniz yok');
select tst.fails('Satış fiyat ekleyemez',
  $$select public.sozlesme_fiyat_ekle((select id from yn), 'kisi_basi', 600, null, 'kdv_haric', 20, current_date+400)$$, 'yetkiniz yok');
select tst.fails('Satış sözleşmeyi doğrudan güncelleyemez (RLS)',
  $q$do $d$ begin update contracts set payment_terms='x'; if not found then raise exception 'satır güncellenemedi (RLS)'; end if; end $d$$q$, 'RLS');
select set_config('request.jwt.claim.sub','33333333-3333-3333-3333-333333333333',false);  -- finans
select tst.ok('Finans sözleşmeleri görebilir ama teklifleri göremez', (select count(*) from contracts) >= 3 and (select count(*) from offers) = 0);
select set_config('request.jwt.claim.sub','44444444-4444-4444-4444-444444444444',false);  -- başka kurum
select tst.ok('Başka kurum sözleşme ve fiyatları göremez', (select count(*) from contracts) = 0 and (select count(*) from contract_prices) = 0);
select tst.fails('Başka kurum sözleşme yenileyemez',
  $$select public.sozlesme_yenile((select id from yn), current_date+400, current_date+800)$$, 'bulunamadı');

-- denetim
reset role;
select tst.ok('Denetim kaydı: teklif ve sözleşme değişiklikleri yazıldı',
  (select count(*) from audit_logs where table_name in ('offers','contracts')) > 0);
