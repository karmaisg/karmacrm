-- OSGB 360 - Aşama 22 (firma dışı spot işler) veri tabanı testleri (yerel PostgreSQL 16 + Supabase taklidi)
-- Sıra: supabase_stub.sql -> 01_sema.sql -> 03..13 -> 24_asama22.sql -> bu dosya (boş bir veri tabanında)
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
  ('22222222-2222-2222-2222-222222222222','satis','aaaaaaaa-0000-0000-0000-000000000001','Satışçı','satis@karma.test')) as u(id,rol,org,ad,eposta)
join roles r on r.key = u.rol and r.organization_id = u.org;
create temp table g as select app.today_tr() as bugun; grant select on g to authenticated, anon;
insert into companies(id,organization_id,name,customer_status) values ('aaaaaaaa-1111-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001','Firma A','musteri');

set role authenticated; select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false);
select tst.works('Firmasız spot iş (adıyla): sağlık raporu, %20 KDV', $$select public.gelir_kalemi_ekle(null,'spot',(select bugun from g),'Sağlık raporu',1000,'kdv_haric',20,false,null,'Ahmet Yılmaz')$$);
select tst.works('Firmasız spot iş: KDV 0', $$select public.gelir_kalemi_ekle(null,'spot',(select bugun from g),'Risk analizi',500,'kdv_haric',0,true,null)$$);
select tst.works('Firmasız elden ödeme', $$select public.gelir_kalemi_ekle(null,'elden',(select bugun from g),'Eğitim',300,'kdv_haric',20,true,null)$$);
select tst.ok('3 firmasız gelir kaydı', (select count(*) = 3 from invoices where company_id is null));
select tst.ok('Müşteri adı saklandı, kalem açıklaması işin adı', (select customer_name = 'Ahmet Yılmaz' and (select description from invoice_items where invoice_id = i.id) = 'Sağlık raporu' from invoices i where i.company_id is null and i.amount_excl_vat = 1000));
select tst.ok('KDV hesabı: 1000 + 200', (select vat_amount = 200 and amount_incl_vat = 1200 from invoices where company_id is null and amount_excl_vat = 1000));
select tst.ok('KDV 0 spot: KDV 0', (select vat_amount = 0 from invoices where company_id is null and amount_excl_vat = 500));
select tst.ok('Elden: KDV 0 ve tahsil edildi', (select vat_amount = 0 and (select count(*) from payments where invoice_id = i.id) = 1 from invoices i where i.company_id is null and i.income_kind = 'elden'));
select tst.ok('Fatura numarası otomatik', (select bool_and(invoice_no ~ '^F-[0-9]{4}-[0-9]{4}$') from invoices where company_id is null));
select tst.fails('Adsız firmasız gelir reddedilir', $$select public.gelir_kalemi_ekle(null,'spot',(select bugun from g),' ',100)$$, 'ne olduğunu');
select tst.fails('Firmasız ve sıfır tutar reddedilir', $$select public.gelir_kalemi_ekle(null,'spot',(select bugun from g),'X',0)$$, 'Tutar');
select tst.fails('Firmasız normal fatura eklenemez (kısıt)', $$insert into invoices(company_id,invoice_no,invoice_date,due_date,amount_excl_vat,vat_amount) values (null,'X-1',current_date,current_date,1,0)$$);
select tst.works('Firmalı spot iş hâlâ çalışır', $$select public.gelir_kalemi_ekle('aaaaaaaa-1111-0000-0000-000000000001','spot',(select bugun from g),'Ek eğitim',1000,'kdv_haric',20,false,null)$$);
select tst.ok('Firmalı kayıtta company_id dolu', (select count(*) = 1 from invoices where company_id = 'aaaaaaaa-1111-0000-0000-000000000001'));
select tst.works('Firmasız geliri tahsilat ekleme', $$insert into payments(invoice_id,paid_at,amount) select id, (select bugun from g), 1 from invoices where company_id is null and amount_excl_vat = 1000$$);
reset role; select set_config('request.jwt.claim.sub','22222222-2222-2222-2222-222222222222',false); set role authenticated;
select tst.fails('Yetkisiz rol firmasız gelir ekleyemez', $$select public.gelir_kalemi_ekle(null,'spot',(select bugun from g),'Y',100)$$);
