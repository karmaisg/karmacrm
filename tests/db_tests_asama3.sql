-- OSGB 360 - Aşama 3 veri tabanı testleri (yerel PostgreSQL 16 + Supabase taklidi)
-- Sıra: supabase_stub.sql -> 01_sema.sql -> 03_asama2.sql -> 04_asama3.sql -> bu dosya (boş bir veri tabanında)
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
-- A) potansiyel_olustur
-- =====================================================================
set role authenticated;
select set_config('request.jwt.claim.sub','22222222-2222-2222-2222-222222222222',false);  -- satış

select tst.works('Satış: potansiyel müşteri + ilk fırsat tek işlemde',
  $$select public.potansiyel_olustur('{"name":"  Yıldız İnşaat ","tax_no":"3333333333","employee_count":40,"hazard_class":"tehlikeli","source":"tavsiye","est_monthly_revenue":12000,"contact_name":"Ali Yıldız","contact_title":"Müdür","score":55,"score_details":[{"ad":"Kaynak","puan":20}]}'::jsonb)$$);
select tst.ok('Ad kırpıldı, kurum otomatik atandı, öncelik varsayılan orta',
  (select count(*) from leads where name='Yıldız İnşaat' and organization_id='aaaaaaaa-0000-0000-0000-000000000001' and priority='orta') = 1);
select tst.ok('Puan ve gerekçesi saklandı',
  (select score = 55 and score_details -> 0 ->> 'ad' = 'Kaynak' from leads where name='Yıldız İnşaat'));
select tst.ok('İlk fırsat yeni_aday aşamasında açıldı, beklenen gelir aktarıldı',
  (select count(*) from sales_opportunities o join leads l on l.id=o.lead_id
    where l.name='Yıldız İnşaat' and o.stage='yeni_aday' and o.expected_monthly = 12000 and o.title='Yıldız İnşaat') = 1);
select tst.ok('Aşama geçmişine ilk kayıt düştü',
  (select count(*) from opportunity_stage_history h join sales_opportunities o on o.id=h.opportunity_id join leads l on l.id=o.lead_id
    where l.name='Yıldız İnşaat' and h.from_stage is null and h.to_stage='yeni_aday' and h.changed_by='22222222-2222-2222-2222-222222222222') = 1);
select tst.fails('Aynı vergi numarasıyla ikinci potansiyel müşteri reddedilir',
  $$select public.potansiyel_olustur('{"name":"Kopya","tax_no":"3333333333"}'::jsonb)$$, 'leads_tax_no_uq');
select tst.fails('Ad olmadan oluşturulamaz', $$select public.potansiyel_olustur('{"name":"  "}'::jsonb)$$, 'zorunludur');
select tst.fails('Çalışan sayısı varken tehlike sınıfı zorunlu',
  $$select public.potansiyel_olustur('{"name":"Eksik","employee_count":5}'::jsonb)$$, 'tehlike');
select tst.fails('Yabancı kurumun kullanıcısı satış sorumlusu yapılamaz',
  $$select public.potansiyel_olustur('{"name":"Çapraz","sales_owner":"44444444-4444-4444-4444-444444444444"}'::jsonb)$$, 'kuruma ait değil');

select set_config('request.jwt.claim.sub','55555555-5555-5555-5555-555555555555',false);  -- uzman/hekim
select tst.fails('Uzman/hekim potansiyel müşteri ekleyemez',
  $$select public.potansiyel_olustur('{"name":"Yetkisiz"}'::jsonb)$$, 'yetkiniz yok');
select tst.ok('Uzman/hekim potansiyel müşterileri göremez', (select count(*) from leads) = 0);

select set_config('request.jwt.claim.sub','33333333-3333-3333-3333-333333333333',false);  -- finans
select tst.fails('Finans potansiyel müşteri ekleyemez',
  $$select public.potansiyel_olustur('{"name":"Yetkisiz"}'::jsonb)$$, 'yetkiniz yok');

select set_config('request.jwt.claim.sub','44444444-4444-4444-4444-444444444444',false);  -- başka kurum
select tst.ok('Başka kurum potansiyel müşteriyi göremez', (select count(*) from leads) = 0);
select tst.ok('Başka kurum fırsatları göremez', (select count(*) from sales_opportunities) = 0);

-- =====================================================================
-- B) Fırsat aşamaları
-- =====================================================================
select set_config('request.jwt.claim.sub','22222222-2222-2222-2222-222222222222',false);
select tst.works('Fırsat aşaması ilerletilir',
  $$update sales_opportunities set stage='ilk_gorusme_yapildi' where title='Yıldız İnşaat'$$);
select tst.ok('Geçmişe kullanıcı ve aşamalarla yazıldı',
  (select count(*) from opportunity_stage_history h join sales_opportunities o on o.id=h.opportunity_id
    where o.title='Yıldız İnşaat' and h.from_stage='yeni_aday' and h.to_stage='ilk_gorusme_yapildi') = 1);
select tst.fails('Kayıp nedeni olmadan kaybedildi aşamasına geçilemez',
  $$update sales_opportunities set stage='kaybedildi' where title='Yıldız İnşaat'$$, 'check');
select tst.works('Kayıp nedeniyle kaybedildi olabilir',
  $$update sales_opportunities set stage='kaybedildi', lost_reason='fiyat', lost_note='Rakip daha ucuz' where title='Yıldız İnşaat'$$);
select tst.ok('Kapanış tarihi otomatik yazıldı',
  (select closed_at is not null from sales_opportunities where title='Yıldız İnşaat'));
select tst.works('Kayıp fırsat yeniden açılır (ertelendi)',
  $$update sales_opportunities set stage='ertelendi' where title='Yıldız İnşaat'$$);
select tst.ok('Yeniden açılınca kapanış tarihi ve kayıp nedeni temizlendi',
  (select closed_at is null and lost_reason is null and lost_note is null from sales_opportunities where title='Yıldız İnşaat'));
select tst.ok('Geçmişte 4 hareket var (açılış, ilerleme, kayıp, erteleme)',
  (select count(*) from opportunity_stage_history h join sales_opportunities o on o.id=h.opportunity_id where o.title='Yıldız İnşaat') = 4);
select tst.fails('Negatif beklenen gelir reddedilir',
  $$update sales_opportunities set expected_monthly=-5 where title='Yıldız İnşaat'$$, 'negatif');
select tst.fails('Geçmiş satırı elle değiştirilemez / silinemez (silme yetkisi yok)',
  $$delete from opportunity_stage_history$$, 'permission denied');
select tst.fails('Fırsat fiziksel olarak silinemez',
  $$delete from sales_opportunities$$, 'permission denied');
select tst.fails('Fırsat başka kurumun firmasına bağlanamaz',
  $$update sales_opportunities set company_id='bbbbbbbb-1111-0000-0000-000000000001' where title='Yıldız İnşaat'$$, 'kuruma ait değil');
select tst.works('Satış (arşiv yetkisi var) fırsatı arşivler', $$update sales_opportunities set archived_at=now() where title='Yıldız İnşaat'$$);
select tst.ok('Arşivleyen kullanıcı kaydedildi',
  (select archived_by='22222222-2222-2222-2222-222222222222' from sales_opportunities where title='Yıldız İnşaat'));
select tst.works('Arşivden çıkarılır', $$update sales_opportunities set archived_at=null where title='Yıldız İnşaat'$$);

-- =====================================================================
-- C) Görüşmeler
-- =====================================================================
select tst.works('Satış: potansiyel müşteriye görüşme ekler',
  $$insert into activities(lead_id, kind, occurred_at, summary) select id,'gorusme','2026-10-20 10:00+03','İlk telefon görüşmesi' from leads where name='Yıldız İnşaat'$$);
select tst.ok('Son temas tarihi güncellendi', (select last_contact_date = '2026-10-20' from leads where name='Yıldız İnşaat'));
select tst.works('Daha eski görüşme son temas tarihini geriye almaz',
  $$insert into activities(lead_id, kind, occurred_at, summary) select id,'arama','2026-10-10 10:00+03','Eski kayıt' from leads where name='Yıldız İnşaat'$$);
select tst.ok('Son temas tarihi hâlâ 20 Ekim', (select last_contact_date = '2026-10-20' from leads where name='Yıldız İnşaat'));
select tst.works('Not türü son temas tarihini etkilemez',
  $$insert into activities(lead_id, kind, summary) select id,'not','Sadece not' from leads where name='Yıldız İnşaat'$$);
select tst.ok('Son temas tarihi yine 20 Ekim', (select last_contact_date = '2026-10-20' from leads where name='Yıldız İnşaat'));
select tst.fails('Görüşme hiçbir kayda bağlı olamaz',
  $$insert into activities(kind, summary) values ('not','Sahipsiz')$$, 'check');
select tst.fails('Görüşme başka kurumun firmasına bağlanamaz',
  $$insert into activities(company_id, kind, summary) values ('bbbbbbbb-1111-0000-0000-000000000001','not','x')$$, 'kuruma ait değil');
-- =====================================================================
-- D) Görevler
-- =====================================================================
select set_config('request.jwt.claim.sub','22222222-2222-2222-2222-222222222222',false);
select tst.works('Satış görev ekler',
  $$insert into tasks(kind,title,lead_id,assignee,priority,due_at) select 'potansiyel_arama','Yıldız İnşaat''ı ara', id,'22222222-2222-2222-2222-222222222222','yuksek','2026-10-26 10:00+03' from leads where name='Yıldız İnşaat'$$);
select tst.ok('Görev açık, tamamlanma tarihi boş', (select status='acik' and completed_at is null from tasks where title like 'Yıldız%'));
select tst.works('Görev tamamlanır', $$update tasks set status='tamamlandi' where title like 'Yıldız%'$$);
select tst.ok('Tamamlanma tarihi yazıldı', (select completed_at is not null from tasks where title like 'Yıldız%'));
select tst.works('Görev yeniden açılır', $$update tasks set status='acik' where title like 'Yıldız%'$$);
select tst.ok('Yeniden açılınca tamamlanma tarihi silindi', (select completed_at is null from tasks where title like 'Yıldız%'));
select tst.fails('Başlıksız görev reddedilir', $$insert into tasks(title) values ('   ')$$, 'zorunludur');
select tst.fails('Görev başka kurumun kullanıcısına atanamaz',
  $$insert into tasks(title, assignee) values ('x','44444444-4444-4444-4444-444444444444')$$, 'kuruma ait değil');
select tst.works('Kaynak referanslı görev eklenir', $$insert into tasks(title, source_ref) values ('Otomatik','invoice:1')$$);
select tst.fails('Aynı kaynak referansıyla ikinci görev açılamaz',
  $$insert into tasks(title, source_ref) values ('Otomatik 2','invoice:1')$$, 'tasks_source_ref_uq');

select set_config('request.jwt.claim.sub','55555555-5555-5555-5555-555555555555',false);
select tst.ok('Uzman/hekim görevleri görebilir (tasks yetkisi)', (select count(*) from tasks) >= 2);

-- =====================================================================
-- E) Firmaya dönüştürme
-- =====================================================================
select set_config('request.jwt.claim.sub','22222222-2222-2222-2222-222222222222',false);
select tst.works('Hazırlık: ikinci potansiyel müşteri',
  $$select public.potansiyel_olustur('{"name":"Güneş Tekstil","tax_no":"4444444444","employee_count":120,"hazard_class":"cok_tehlikeli","contact_name":"Zeynep Güneş","contact_title":"İK","city":"Bursa","sales_owner":"22222222-2222-2222-2222-222222222222","notes":"Sıcak aday"}'::jsonb)$$);
select tst.works('Hazırlık: görüşme ve görev',
  $$with l as (select id from leads where name='Güneş Tekstil'),
         a as (insert into activities(lead_id,kind,summary) select id,'gorusme','Sunum yapıldı' from l returning 1)
     insert into tasks(title,lead_id) select 'Teklif hazırla', id from l$$);
select tst.ok('Dönüşümden önce firma yok', (select count(*) from companies where name='Güneş Tekstil') = 0);

select tst.works('Satış: potansiyel müşteriyi firmaya dönüştürür',
  $$select public.potansiyel_firmaya_donustur((select id from leads where name='Güneş Tekstil'))$$);
select tst.ok('Firma oluştu, müşteri durumunda, bilgiler aktarıldı',
  (select count(*) from companies where name='Güneş Tekstil' and tax_no='4444444444' and city='Bursa' and customer_status='musteri' and notes='Sıcak aday'
     and responsible_user='22222222-2222-2222-2222-222222222222') = 1);
select tst.ok('Çalışan sayısı ve tehlike sınıfı ilk dönem olarak aktarıldı (bugünden, açık dönem)',
  (select count(*) from company_profiles p join companies c on c.id=p.company_id
    where c.name='Güneş Tekstil' and p.employee_count=120 and p.hazard_class='cok_tehlikeli' and p.valid_from=current_date and p.valid_to is null) = 1);
select tst.ok('Potansiyel kayıt firmaya bağlandı',
  (select converted_company_id = (select id from companies where name='Güneş Tekstil') from leads where name='Güneş Tekstil'));
select tst.ok('Yetkili kişi kartı firmaya bağlı olarak oluştu',
  (select count(*) from contacts c join companies f on f.id=c.company_id where f.name='Güneş Tekstil' and c.full_name='Zeynep Güneş' and c.title='İK') = 1);
select tst.ok('Açık fırsat kazanıldı yapıldı ve firmaya bağlandı',
  (select count(*) from sales_opportunities o join companies c on c.id=o.company_id where c.name='Güneş Tekstil' and o.stage='kazanildi' and o.closed_at is not null) = 1);
select tst.ok('Aşama geçmişine dönüşüm hareketi yazıldı',
  (select count(*) from opportunity_stage_history h join sales_opportunities o on o.id=h.opportunity_id
    where o.title='Güneş Tekstil' and h.to_stage='kazanildi' and h.changed_by='22222222-2222-2222-2222-222222222222') = 1);
select tst.ok('Görüşme ve görev firma kartına taşındı',
  (select count(*) from activities a join companies c on c.id=a.company_id where c.name='Güneş Tekstil') = 1
  and (select count(*) from tasks t join companies c on c.id=t.company_id where c.name='Güneş Tekstil') = 1);
select tst.fails('Aynı potansiyel müşteri ikinci kez dönüştürülemez',
  $$select public.potansiyel_firmaya_donustur((select id from leads where name='Güneş Tekstil'))$$, 'zaten');

-- tax_no çakışması: firma tarafında aynı numara var -> tamamı geri alınır
select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false);
select tst.works('Hazırlık: firma 5555555555 numarasını kullanıyor', $$select public.firma_olustur('{"name":"Mevcut Firma","tax_no":"5555555555"}'::jsonb)$$);
select set_config('request.jwt.claim.sub','22222222-2222-2222-2222-222222222222',false);
select tst.works('Hazırlık: aynı numaralı potansiyel müşteri',
  $$select public.potansiyel_olustur('{"name":"Çakışan Aday","tax_no":"5555555555","contact_name":"Kim"}'::jsonb)$$);
select tst.fails('Firma tarafında aynı vergi numarası varsa dönüşüm reddedilir',
  $$select public.potansiyel_firmaya_donustur((select id from leads where name='Çakışan Aday'))$$, 'companies_tax_no_uq');
select tst.ok('Reddedilen dönüşümde hiçbir şey yarım kalmadı (firma/kişi/bağlantı yok)',
  (select count(*) from companies where name='Çakışan Aday') = 0
  and (select converted_company_id is null from leads where name='Çakışan Aday')
  and (select count(*) from contacts where full_name='Kim') = 0
  and (select stage = 'yeni_aday' from sales_opportunities where title='Çakışan Aday'));

select set_config('request.jwt.claim.sub','33333333-3333-3333-3333-333333333333',false);
select tst.fails('Finans dönüştürme yapamaz',
  $$select public.potansiyel_firmaya_donustur((select id from leads where name='Çakışan Aday'))$$, 'yetkiniz yok');
select set_config('request.jwt.claim.sub','44444444-4444-4444-4444-444444444444',false);
select tst.fails('Başka kurumun kullanıcısı başka kurumun potansiyel müşterisini dönüştüremez',
  $$select public.potansiyel_firmaya_donustur((select id from leads where name='Çakışan Aday' union all select gen_random_uuid() limit 1))$$, 'bulunamadı');
select set_config('request.jwt.claim.sub','',false);
select tst.fails('Oturumsuz çağrı reddedilir',
  $$select public.potansiyel_firmaya_donustur(gen_random_uuid())$$, 'Oturum');

-- =====================================================================
-- F) Arşiv ve denetim
-- =====================================================================
select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false);
select tst.works('Sahip potansiyel müşteriyi arşivler', $$update leads set archived_at=now() where name='Çakışan Aday'$$);
select tst.ok('Arşivleyen kullanıcı kaydedildi',
  (select archived_by='11111111-1111-1111-1111-111111111111' from leads where name='Çakışan Aday'));
select tst.fails('Arşivdeki potansiyel müşteri dönüştürülemez',
  $$select public.potansiyel_firmaya_donustur((select id from leads where name='Çakışan Aday'))$$, 'Arşivdeki');
select tst.works('Arşivden çıkarılır', $$update leads set archived_at=null where name='Çakışan Aday'$$);
select tst.works('Aynı numaralı yeni aday arşivdeyken açılabilir (arşivde olan aday numarayı bloklamaz)',
  $q$do $x$ begin
      update leads set archived_at=now() where name='Çakışan Aday';
      perform public.potansiyel_olustur('{"name":"Yeni Çakışan","tax_no":"5555555555"}'::jsonb);
    end $x$$q$);
select set_config('request.jwt.claim.sub','33333333-3333-3333-3333-333333333333',false);
select tst.fails('Finans görüşme ekleyemez (contacts yetkisi yok)',
  $$insert into activities(company_id, kind, summary) select id,'not','x' from companies limit 1$$, 'row-level security');
reset role;
select tst.ok('Denetim kaydı: potansiyel müşteri, fırsat, görev değişiklikleri yazıldı',
  (select count(distinct table_name) from audit_logs where table_name in ('leads','sales_opportunities','tasks','activities')) = 4);
select tst.ok('Dönüşüm sırasında firma denetim kaydında kullanıcıyla görünür',
  (select count(*) from audit_logs where table_name='companies' and action='INSERT' and user_id='22222222-2222-2222-2222-222222222222') >= 1);
