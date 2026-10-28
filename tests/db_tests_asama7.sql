-- OSGB 360 - Aşama 7 veri tabanı testleri (yerel PostgreSQL 16 + Supabase taklidi)
-- Sıra: supabase_stub.sql -> 01_sema.sql -> 03_asama2.sql -> 04_asama3.sql -> 05_asama4.sql -> 06_asama5.sql -> 07_asama6.sql -> 08_asama7.sql -> bu dosya (boş bir veri tabanında)
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
insert into companies(id,organization_id,name) values
 ('aaaaaaaa-1111-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001','Alfa'),
 ('aaaaaaaa-1111-0000-0000-000000000002','aaaaaaaa-0000-0000-0000-000000000001','Beta'),
 ('bbbbbbbb-1111-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000002','Yabancı Firma');
-- ortak giderler (Kira 10.000 + 2.000, Yakıt 600) ekim 2026; maaş kategorisi ve vergi kategorisi
insert into expenses(organization_id,category_id,expense_date,amount_excl_vat,vat_amount,cost_type)
select 'aaaaaaaa-0000-0000-0000-000000000001', c.id, d.t, d.a, 0, 'ortak'
from (values ('Kira','2026-10-03'::date,10000::numeric),('Kira','2026-10-20',2000),('Araç yakıtı','2026-10-05',600),('Kira','2026-11-02',777)) d(ad,t,a)
join expense_categories c on c.name = d.ad and c.organization_id='aaaaaaaa-0000-0000-0000-000000000001';

-- =====================================================================
-- A) Dağıtım ölçütü (tarihçeli)
-- =====================================================================
set role authenticated;
select set_config('request.jwt.claim.sub','33333333-3333-3333-3333-333333333333',false);
select tst.works('Finans: kira için gelir oranı ölçütü',
  $$select public.dagitim_olcutu_ayarla((select id from expense_categories where name='Kira' and organization_id='aaaaaaaa-0000-0000-0000-000000000001'),'gelir_orani','2026-01-01')$$);
select tst.ok('Kural açık dönemli', (select count(*)=1 and min(basis::text)='gelir_orani' and min(valid_to) is null from allocation_rules));
select tst.works('Aynı ölçüt tekrar: değişiklik yok',
  $$select public.dagitim_olcutu_ayarla((select id from expense_categories where name='Kira' and organization_id='aaaaaaaa-0000-0000-0000-000000000001'),'gelir_orani','2026-05-01')$$);
select tst.ok('Hâlâ tek kural', (select count(*)=1 from allocation_rules));
select tst.works('Ölçüt değişimi: fiili süre, 1 Eylül''den',
  $$select public.dagitim_olcutu_ayarla((select id from expense_categories where name='Kira' and organization_id='aaaaaaaa-0000-0000-0000-000000000001'),'fiili_sure','2026-09-01')$$);
select tst.ok('Eski dönem 31 Ağustos''ta kapandı, yenisi açık', (select count(*)=2 and bool_or(basis='gelir_orani' and valid_to='2026-08-31') and bool_or(basis='fiili_sure' and valid_to is null) from allocation_rules));
select tst.fails('Eski tarihe ölçüt eklenemez',
  $$select public.dagitim_olcutu_ayarla((select id from expense_categories where name='Kira' and organization_id='aaaaaaaa-0000-0000-0000-000000000001'),'musteri_sayisi','2026-09-01')$$, 'sonra olmalıdır');
select tst.fails('Ayın 1''i olmayan tarih reddedilir',
  $$select public.dagitim_olcutu_ayarla((select id from expense_categories where name='Kira' and organization_id='aaaaaaaa-0000-0000-0000-000000000001'),'musteri_sayisi','2026-10-15')$$, 'ayın 1');
select tst.fails('Maaş kategorisi için ölçüt tanımlanamaz',
  $$select public.dagitim_olcutu_ayarla((select id from expense_categories where name='Uzman maaşları' and organization_id='aaaaaaaa-0000-0000-0000-000000000001'),'gelir_orani','2026-01-01')$$, 'dağıtım ölçütü tanımlanamaz');
select tst.fails('Kurumlar vergisi kategorisi için ölçüt tanımlanamaz',
  $$select public.dagitim_olcutu_ayarla((select id from expense_categories where name='Kurumlar vergisi' and organization_id='aaaaaaaa-0000-0000-0000-000000000001'),'gelir_orani','2026-01-01')$$, 'dağıtım ölçütü tanımlanamaz');
select tst.fails('Başka kurumun kategorisi reddedilir',
  format($$select public.dagitim_olcutu_ayarla(%L,'gelir_orani','2026-01-01')$$, (select id from expense_categories where organization_id='bbbbbbbb-0000-0000-0000-000000000002' and name='Kira')), 'tanımlanamaz');
select set_config('request.jwt.claim.sub','22222222-2222-2222-2222-222222222222',false);
select tst.fails('Satış: ölçüt değiştiremez',
  $$select public.dagitim_olcutu_ayarla((select id from expense_categories where name='Kira' and organization_id='aaaaaaaa-0000-0000-0000-000000000001'),'musteri_sayisi','2027-01-01')$$, 'yetkiniz');
select tst.fails('Satış: kural tablosuna doğrudan ekleyemez',
  $$insert into allocation_rules(category_id,basis,valid_from) values ((select id from expense_categories where name='Araç yakıtı' and organization_id='aaaaaaaa-0000-0000-0000-000000000001'),'gelir_orani','2026-01-01')$$);
reset role;

-- =====================================================================
-- B) Dağıtımı kaydet
-- =====================================================================
set role authenticated;
select set_config('request.jwt.claim.sub','33333333-3333-3333-3333-333333333333',false);
create temp table kira(id uuid); insert into kira select id from expense_categories where name='Kira' and organization_id='aaaaaaaa-0000-0000-0000-000000000001'; grant all on kira to authenticated;
select tst.works('Kira dağıtımı kaydedilir (7.000 + 5.000 = 12.000 havuz)',
  $$select public.ortak_gider_dagitimini_kaydet('2026-10-17',(select id from kira),'gelir_orani','[{"company_id":"aaaaaaaa-1111-0000-0000-000000000001","amount":7000},{"company_id":"aaaaaaaa-1111-0000-0000-000000000002","amount":5000}]'::jsonb)$$);
select tst.ok('Dönem ayın 1''ine yuvarlandı, 2 satır', (select count(*)=2 and min(period)='2026-10-01' and sum(amount)=12000 from overhead_allocations));
select tst.works('Yeniden kaydet (idempotent): 6.000 + 6.000',
  $$select public.ortak_gider_dagitimini_kaydet('2026-10-01',(select id from kira),'musteri_sayisi','[{"company_id":"aaaaaaaa-1111-0000-0000-000000000001","amount":6000},{"company_id":"aaaaaaaa-1111-0000-0000-000000000002","amount":6000}]'::jsonb)$$);
select tst.ok('Satır sayısı artmadı, ölçüt güncellendi', (select count(*)=2 and bool_and(basis='musteri_sayisi') and sum(amount)=12000 from overhead_allocations where archived_at is null));
select tst.works('Yeniden dağıtım: sırayla artış/azalış havuzu geçici aşmaz (9.000 + 3.000)',
  $$select public.ortak_gider_dagitimini_kaydet('2026-10-01',(select id from kira),'gelir_orani','[{"company_id":"aaaaaaaa-1111-0000-0000-000000000001","amount":9000},{"company_id":"aaaaaaaa-1111-0000-0000-000000000002","amount":3000}]'::jsonb)$$);
select tst.fails('Havuzu aşan dağıtım reddedilir (12.000 + 1)',
  $$select public.ortak_gider_dagitimini_kaydet('2026-10-01',(select id from kira),'gelir_orani','[{"company_id":"aaaaaaaa-1111-0000-0000-000000000001","amount":9000.01},{"company_id":"aaaaaaaa-1111-0000-0000-000000000002","amount":3000}]'::jsonb)$$, 'havuzunu');
select tst.ok('Reddedilen işlem eskiyi bozmadı (işlem geri alındı)', (select sum(amount)=12000 and max(amount)=9000 from overhead_allocations where archived_at is null));
select tst.works('Azaltılmış dağıtım serbest (havuzun altında)',
  $$select public.ortak_gider_dagitimini_kaydet('2026-10-01',(select id from kira),'gelir_orani','[{"company_id":"aaaaaaaa-1111-0000-0000-000000000001","amount":5000}]'::jsonb)$$);
select tst.ok('Listede olmayan firma 0''a çekildi, silinmedi', (select count(*)=2 and sum(amount)=5000 from overhead_allocations where archived_at is null));
select tst.fails('Ortak gider kategorisi olmayan (maaş) dağıtılamaz',
  $$select public.ortak_gider_dagitimini_kaydet('2026-10-01',(select id from expense_categories where name='Uzman maaşları' and organization_id='aaaaaaaa-0000-0000-0000-000000000001'),'gelir_orani','[]'::jsonb)$$, 'dağıtılamaz');
select tst.fails('Negatif tutar reddedilir',
  $$select public.ortak_gider_dagitimini_kaydet('2026-10-01',(select id from kira),'gelir_orani','[{"company_id":"aaaaaaaa-1111-0000-0000-000000000001","amount":-5}]'::jsonb)$$, 'negatif');
select tst.fails('Başka kurumun firması reddedilir',
  $$select public.ortak_gider_dagitimini_kaydet('2026-10-01',(select id from kira),'gelir_orani','[{"company_id":"bbbbbbbb-1111-0000-0000-000000000001","amount":10}]'::jsonb)$$, 'kuruma ait değil');
select tst.fails('Liste olmayan veri reddedilir',
  $$select public.ortak_gider_dagitimini_kaydet('2026-10-01',(select id from kira),'gelir_orani','{"a":1}'::jsonb)$$, 'liste');
select tst.works('Yakıt havuzu (600) ayrı kategori olarak dağıtılır',
  $$select public.ortak_gider_dagitimini_kaydet('2026-10-01',(select id from expense_categories where name='Araç yakıtı' and organization_id='aaaaaaaa-0000-0000-0000-000000000001'),'gelir_orani','[{"company_id":"aaaaaaaa-1111-0000-0000-000000000001","amount":600}]'::jsonb)$$);
select tst.fails('Yakıt havuzu (600) aşılamaz: 600.01',
  $$select public.ortak_gider_dagitimini_kaydet('2026-10-01',(select id from expense_categories where name='Araç yakıtı' and organization_id='aaaaaaaa-0000-0000-0000-000000000001'),'gelir_orani','[{"company_id":"aaaaaaaa-1111-0000-0000-000000000001","amount":600.01}]'::jsonb)$$, 'havuzunu');
select tst.fails('Kasım havuzu (777) boşken dağıtım aşılamaz',
  $$select public.ortak_gider_dagitimini_kaydet('2026-12-01',(select id from kira),'gelir_orani','[{"company_id":"aaaaaaaa-1111-0000-0000-000000000001","amount":1}]'::jsonb)$$, 'havuzunu');
select tst.works('Kasım dağıtımı havuz kadar (777)',
  $$select public.ortak_gider_dagitimini_kaydet('2026-11-01',(select id from kira),'gelir_orani','[{"company_id":"aaaaaaaa-1111-0000-0000-000000000001","amount":777}]'::jsonb)$$);

-- Havuz koruması (Aşama 6 tetikleyicisi) dağıtımla birlikte çalışır
select tst.fails('Dağıtılmış kira havuzu (5.000) altına düşürülemez: kira 2.000 kaydı arşivlenemez',
  $$update expenses set archived_at=now() where amount_excl_vat=10000 and organization_id='aaaaaaaa-0000-0000-0000-000000000001'$$, 'dağıtımının');
select set_config('request.jwt.claim.sub','22222222-2222-2222-2222-222222222222',false);
select tst.fails('Satış: dağıtım kaydedemez',
  $$select public.ortak_gider_dagitimini_kaydet('2026-10-01',(select id from kira),'gelir_orani','[]'::jsonb)$$, 'yetkiniz');
select tst.ok('Satış: dağıtımları göremez', (select count(*)=0 from overhead_allocations));
select set_config('request.jwt.claim.sub','44444444-4444-4444-4444-444444444444',false);
select tst.ok('Başka kurum: dağıtımları göremez', (select count(*)=0 from overhead_allocations));
select tst.ok('Başka kurum: bizim kurallarımızı görmez', (select count(*)=0 from allocation_rules where category_id in (select id from kira)));
reset role;


-- =====================================================================
-- C) Kârlılık girdileri (görevlendirme / zaman erişimi olmayan Finans için güvenli özet)
-- =====================================================================
insert into employees(id,organization_id,full_name,staff_type) values
 ('aaaaaaaa-5555-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001','Ayşe Uzman','is_guvenligi_uzmani'),
 ('bbbbbbbb-5555-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000002','Yabancı Uzman','is_guvenligi_uzmani');
insert into assignments(organization_id,company_id,employee_id,staff_type,share_pct,valid_from) values
 ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-1111-0000-0000-000000000001','aaaaaaaa-5555-0000-0000-000000000001','is_guvenligi_uzmani',100,'2026-01-01'),
 ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-1111-0000-0000-000000000002','aaaaaaaa-5555-0000-0000-000000000001','is_guvenligi_uzmani',100,'2026-11-01'),
 ('bbbbbbbb-0000-0000-0000-000000000002','bbbbbbbb-1111-0000-0000-000000000001','bbbbbbbb-5555-0000-0000-000000000001','is_guvenligi_uzmani',100,'2026-01-01');
insert into time_entries(organization_id,employee_id,company_id,activity_type,start_at,end_at,onsite_minutes,reporting_minutes,notes)
values ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-5555-0000-0000-000000000001','aaaaaaaa-1111-0000-0000-000000000001','ziyaret','2026-10-05 06:00+00','2026-10-05 09:00+00',150,20,'GİZLİ NOT'),
       ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-5555-0000-0000-000000000001','aaaaaaaa-1111-0000-0000-000000000001','ziyaret','2026-09-05 06:00+00','2026-09-05 09:00+00',150,20,null);
set role authenticated;
select set_config('request.jwt.claim.sub','33333333-3333-3333-3333-333333333333',false);
select tst.ok('Finans doğrudan tablodan görevlendirme göremez (beklenen)', (select count(*)=0 from assignments) and (select count(*)=0 from time_entries));
create temp table gi(j jsonb); grant all on gi to authenticated;
select tst.works('Finans: girdileri alır', $$insert into gi select public.karlilik_girdileri('2026-10-20')$$);
select tst.ok('Ekim: 1 görevlendirme (Kasım''da başlayan dahil değil), 1 zaman kaydı (Eylül dışı), 1 personel',
  (select jsonb_array_length(j->'atamalar')=1 and jsonb_array_length(j->'zaman')=1 and jsonb_array_length(j->'personeller')=1 from gi));
select tst.ok('Zaman kaydında not veya saat alanı yok (en az alan)', (select not (j->'zaman'->0 ? 'notes') and not (j->'zaman'->0 ? 'start_at') from gi));
select tst.ok('Başka kurumun personeli/atamaları gelmez', (select j::text not like '%Yabancı%' from gi));
select tst.ok('Hesaplanan dakika alanları doğru', (select (j->'zaman'->0->>'onsite_minutes')::int=150 and (j->'zaman'->0->>'reporting_minutes')::int=20 from gi));
select set_config('request.jwt.claim.sub','22222222-2222-2222-2222-222222222222',false);
select tst.fails('Satış: girdileri alamaz', $$select public.karlilik_girdileri('2026-10-01')$$, 'yetkiniz');
select set_config('request.jwt.claim.sub','44444444-4444-4444-4444-444444444444',false);
select tst.ok('Başka kurum yalnız kendi verisini alır', (select jsonb_array_length(public.karlilik_girdileri('2026-10-01')->'atamalar')=1 and public.karlilik_girdileri('2026-10-01')::text like '%Yabancı Uzman%' and public.karlilik_girdileri('2026-10-01')::text not like '%Ayşe%'));
reset role;

select tst.ok('Dağıtım değişiklikleri denetim kaydına düştü', (select count(*)>0 from audit_logs where table_name='overhead_allocations'));
select tst.ok('Silme yetkisi yok (fiziksel silme)', not has_table_privilege('authenticated','overhead_allocations','DELETE'));
