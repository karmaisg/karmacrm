-- OSGB 360 - Aşama 25 (cari: vergi dairesi) veri tabanı testleri (yerel PostgreSQL 16 + Supabase taklidi)
-- Sıra: supabase_stub.sql -> 01_sema.sql -> 03..13 -> 25_asama25.sql -> bu dosya (boş bir veri tabanında)
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
insert into organizations(id,name) values ('aaaaaaaa-0000-0000-0000-000000000001','Karma OSGB');
select app.seed_organization('aaaaaaaa-0000-0000-0000-000000000001');
select tst.works('Firma vergi dairesiyle eklenir', $$insert into companies(organization_id,name,tax_office) values ('aaaaaaaa-0000-0000-0000-000000000001','Firma A','ÇEŞME VD')$$);
select tst.ok('Vergi dairesi saklandı', (select tax_office = 'ÇEŞME VD' from companies where name = 'Firma A'));
select tst.fails('101 karakterlik vergi dairesi reddedilir', $$insert into companies(organization_id,name,tax_office) values ('aaaaaaaa-0000-0000-0000-000000000001','Firma B', repeat('x',101))$$, 'companies_tax_office_len');
select tst.works('Vergi dairesi boş olabilir', $$insert into companies(organization_id,name) values ('aaaaaaaa-0000-0000-0000-000000000001','Firma C')$$);
