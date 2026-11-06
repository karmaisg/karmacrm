-- OSGB 360 - Aşama 26 (firma bazında tahsilat) veri tabanı testleri (yerel PostgreSQL 16 + Supabase taklidi)
-- Sıra: supabase_stub.sql -> 01_sema.sql -> 03..13 -> 26_asama26.sql -> bu dosya (boş bir veri tabanında)
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
select public.gelir_kalemi_ekle('aaaaaaaa-1111-0000-0000-000000000001','spot',(select bugun from g) - 40,'Eski hizmet',5000,'kdv_haric',0,false,'T-1');
select public.gelir_kalemi_ekle('aaaaaaaa-1111-0000-0000-000000000001','spot',(select bugun from g) - 10,'Yeni hizmet',5000,'kdv_haric',0,false,'T-2');
select tst.ok('Firma A iki açık fatura', (select count(*) = 2 from invoices where company_id = 'aaaaaaaa-1111-0000-0000-000000000001'));
select tst.works('7500 TL firma tahsilatı', $$select public.firma_tahsilati_gir('aaaaaaaa-1111-0000-0000-000000000001', (select bugun from g) - 2, 7500, 'Havale / EFT', 'dekont 1')$$);
select tst.ok('Eski fatura tamamen kapandı (5000)', (select sum(amount) = 5000 from payments p join invoices i on i.id = p.invoice_id where i.invoice_no = 'T-1' and p.archived_at is null));
select tst.ok('Yeni faturaya 2500 kısmi', (select sum(amount) = 2500 from payments p join invoices i on i.id = p.invoice_id where i.invoice_no = 'T-2' and p.archived_at is null));
select tst.ok('İki kayıt aynı grupta, aynı tarih ve not', (select count(distinct group_id) = 1 and count(*) = 2 and count(distinct paid_at) = 1 and bool_and(notes = 'dekont 1') from payments));
select tst.ok('Kalan bakiye 2500', (select sum(balance) = 2500 from invoice_balances where company_id = 'aaaaaaaa-1111-0000-0000-000000000001'));
select tst.fails('Açık bakiyeyi aşan tutar reddedilir', $$select public.firma_tahsilati_gir('aaaaaaaa-1111-0000-0000-000000000001', (select bugun from g), 2500.01)$$, 'açık bakiyesini aşıyor');
select tst.ok('Reddedilen tahsilat kayıt bırakmadı', (select count(*) = 2 from payments));
select tst.fails('Gelecek tarih reddedilir', $$select public.firma_tahsilati_gir('aaaaaaaa-1111-0000-0000-000000000001', (select bugun from g) + 1, 100)$$, 'gelecekte');
select tst.fails('Sıfır tutar reddedilir', $$select public.firma_tahsilati_gir('aaaaaaaa-1111-0000-0000-000000000001', (select bugun from g), 0)$$, 'sıfırdan büyük');
select tst.works('Kalan 2500 de tahsil edilir', $$select public.firma_tahsilati_gir('aaaaaaaa-1111-0000-0000-000000000001', (select bugun from g), 2500)$$);
select tst.ok('Tüm faturalar kapandı', (select coalesce(sum(balance),0) = 0 from invoice_balances where company_id = 'aaaaaaaa-1111-0000-0000-000000000001'));
select tst.fails('Açık fatura yokken tahsilat reddedilir', $$select public.firma_tahsilati_gir('aaaaaaaa-1111-0000-0000-000000000001', (select bugun from g), 1)$$, 'açık bakiyesini aşıyor');
select set_config('request.jwt.claim.sub','22222222-2222-2222-2222-222222222222',false);
select tst.fails('Satış rolü tahsilat giremez', $$select public.firma_tahsilati_gir('aaaaaaaa-1111-0000-0000-000000000001', (select bugun from g), 1)$$);
