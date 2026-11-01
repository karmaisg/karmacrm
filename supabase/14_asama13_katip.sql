-- OSGB 360 - Aşama 13: İSG-Katip sözleşme listesi aktarımı — işyeri (sicil) yapısı, yükleme geçmişi, görevli bilgileri.
-- Kavramlar:
--   * company_sites : bir İSG-Katip işyeri (SGK sicil no) ve HANGİ FİRMAYA FATURALANDIĞI. Bir firmanın birden çok işyeri olabilir;
--                     Katip'teki unvan ile fatura kesilen firma farklı olabilir (eşleşme burada kalıcı tutulur).
--   * katip_imports : her yükleme (dönem, dosya adı, özet/uyarılar). Bir sonraki yükleme bununla karşılaştırılır.
--   * katip_rows    : o yüklemedeki her sözleşme satırı (işyeri çalışan sayısı/tehlike sınıfı + görevli kişi + süre) — geçmiş bozulmaz.
--   * katip_people  : görevli kişilerin TC kimlik numarası (kişisel veri: yalnızca "payroll" yetkisi olan görür).
-- Güvenle yeniden çalıştırılabilir.

create table if not exists company_sites (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null default app.org_id() references organizations(id),
  company_id       uuid not null references companies(id),
  sgk_no           text not null check (sgk_no ~ '^[0-9A-Za-z]{5,40}$'),
  site_name        text not null,
  city             text,
  employee_count   integer check (employee_count is null or employee_count >= 0),
  hazard_class     hazard_class,
  is_active        boolean not null default true,
  valid_from       date,
  last_import_id   uuid,
  notes            text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  archived_at      timestamptz,
  archived_by      uuid,
  unique (organization_id, sgk_no)
);
create index if not exists company_sites_company_idx on company_sites (company_id);

create table if not exists katip_imports (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null default app.org_id() references organizations(id),
  period           date not null,
  file_name        text,
  row_count        integer not null default 0,
  site_count       integer not null default 0,
  new_company_count integer not null default 0,
  summary          jsonb not null default '{}'::jsonb,
  created_by       uuid default auth.uid(),
  created_at       timestamptz not null default now()
);
create index if not exists katip_imports_org_idx on katip_imports (organization_id, created_at desc);

create table if not exists katip_rows (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null default app.org_id() references organizations(id),
  import_id        uuid not null references katip_imports(id) on delete cascade,
  site_id          uuid references company_sites(id),
  sgk_no           text not null,
  site_name        text not null,
  city             text,
  employee_count   integer not null,
  hazard_class     hazard_class not null,
  contract_id      text,
  staff_type       text not null check (staff_type in ('is_guvenligi_uzmani','isyeri_hekimi','diger_saglik')),
  cert_type        text,
  cert_no          text,
  person_name      text not null,
  minutes_per_month integer not null check (minutes_per_month >= 0),
  start_date       date,
  approver_name    text,
  compliant        boolean
);
create index if not exists katip_rows_import_idx on katip_rows (import_id);

create table if not exists katip_people (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null default app.org_id() references organizations(id),
  person_key       text not null,
  person_name      text not null,
  cert_no          text,
  national_id      text check (national_id is null or national_id ~ '^[0-9]{11}$'),
  staff_type       text,
  updated_at       timestamptz not null default now(),
  unique (organization_id, person_key)
);

-- Karma tehlike sınıfı: firma profili toplam çalışan sayısını ve EN YÜKSEK tehlike sınıfını tutar; hizmet süresi ise işyerlerinin
-- kendi sınıflarına göre hesaplanır. Dökümü profilde saklanır, böylece geçmiş aylar da doğru ve ayrı hesaplanır.
-- Örnek: [{"tehlike":"az_tehlikeli","calisan":40},{"tehlike":"cok_tehlikeli","calisan":8}]. Tek sınıf varsa boştur.
alter table company_profiles add column if not exists site_breakdown jsonb;

-- ------------------------------------------------------------------ yetkiler (RLS)
alter table company_sites enable row level security;
alter table katip_imports enable row level security;
alter table katip_rows    enable row level security;
alter table katip_people  enable row level security;

drop policy if exists company_sites_sel on company_sites;
create policy company_sites_sel on company_sites for select to authenticated
  using (organization_id = app.org_id() and app.can('companies', 'view'));
drop policy if exists company_sites_ins on company_sites;
create policy company_sites_ins on company_sites for insert to authenticated
  with check (organization_id = app.org_id() and app.can('companies', 'create'));
drop policy if exists company_sites_upd on company_sites;
create policy company_sites_upd on company_sites for update to authenticated
  using (organization_id = app.org_id() and app.can('companies', 'edit'))
  with check (organization_id = app.org_id() and app.can('companies', 'edit'));

drop policy if exists katip_imports_sel on katip_imports;
create policy katip_imports_sel on katip_imports for select to authenticated
  using (organization_id = app.org_id() and app.can('staff', 'view'));
drop policy if exists katip_rows_sel on katip_rows;
create policy katip_rows_sel on katip_rows for select to authenticated
  using (organization_id = app.org_id() and app.can('staff', 'view'));
drop policy if exists katip_people_sel on katip_people;
create policy katip_people_sel on katip_people for select to authenticated
  using (organization_id = app.org_id() and app.can('payroll', 'view'));

revoke all on company_sites, katip_imports, katip_rows, katip_people from anon, authenticated;
grant select, insert, update on company_sites to authenticated;
grant select on katip_imports, katip_rows, katip_people to authenticated;

drop trigger if exists trg_company_sites_touch on company_sites;
create trigger trg_company_sites_touch before update on company_sites for each row execute function app.touch_updated_at();
drop trigger if exists trg_company_sites_audit on company_sites;
create trigger trg_company_sites_audit after insert or update on company_sites for each row execute function app.audit();

-- Bir işyerinin firması yalnızca aynı kurumdan olabilir
create or replace function app.company_sites_kontrol() returns trigger language plpgsql as $$
begin
  if not exists (select 1 from companies c where c.id = new.company_id and c.organization_id = new.organization_id) then
    raise exception 'Firma bulunamadı veya başka bir kuruma ait.';
  end if;
  return new;
end $$;
drop trigger if exists trg_company_sites_org on company_sites;
create trigger trg_company_sites_org before insert or update of company_id on company_sites for each row execute function app.company_sites_kontrol();

-- ------------------------------------------------------------------ aktarım
-- Paket (jsonb): { donem, dosya, yeni_firmalar:[{ref,ad,il}], isyerleri:[{sicil,unvan,il,calisan,tehlike,firma_id|firma_ref}],
--                  satirlar:[{sicil,sozlesme_id,tur,sertifika_tipi,sertifika_no,ad,tc,dakika,baslangic,onaylayan,uygun}],
--                  kisiler:[{firma_id|firma_ref,ad}], pasif:[firma_id], ozet:{...} }
-- Hepsi tek işlemde uygulanır; herhangi bir hata her şeyi geri alır.
create or replace function public.katip_uygula(p_paket jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := app.org_id();
  v_donem date;
  v_imp uuid;
  v_ref jsonb := '{}'::jsonb;
  v_site jsonb := '{}'::jsonb;
  r jsonb; v_id uuid; v_firma uuid;
  v_yeni_firma int := 0; v_site_ekle int := 0; v_site_guncel int := 0; v_satir int := 0; v_kisi int := 0; v_profil int := 0; v_pasif int := 0; v_kapanan int := 0;
  v_sicil text[];
  f record; v_acik company_profiles; v_yeni_profil company_profiles; v_bas date;
begin
  if v_org is null then raise exception 'Oturum bulunamadı.'; end if;
  if not (app.can('import_export', 'create') and app.can('companies', 'create') and app.can('companies', 'edit')) then
    raise exception 'Bu aktarım için içe aktarma ve firma ekleme/düzenleme yetkisi gerekir.';
  end if;
  if p_paket is null or jsonb_typeof(p_paket -> 'isyerleri') <> 'array' or jsonb_array_length(p_paket -> 'isyerleri') = 0 then
    raise exception 'Aktarılacak işyeri bulunamadı.';
  end if;
  if jsonb_array_length(p_paket -> 'isyerleri') > 3000 or jsonb_array_length(coalesce(p_paket -> 'satirlar', '[]')) > 6000 then
    raise exception 'Aktarım çok büyük; dosyayı bölün.';
  end if;
  v_donem := date_trunc('month', (p_paket ->> 'donem')::date)::date;

  -- 1) yeni firmalar
  for r in select * from jsonb_array_elements(coalesce(p_paket -> 'yeni_firmalar', '[]')) loop
    if coalesce(btrim(r ->> 'ad'), '') = '' then raise exception 'Yeni firma adı boş olamaz.'; end if;
    insert into companies(name, city, customer_status, notes)
    values (btrim(r ->> 'ad'), nullif(btrim(r ->> 'il'), ''), 'musteri', 'İSG-Katip aktarımı ile oluşturuldu')
    returning id into v_id;
    v_ref := v_ref || jsonb_build_object(r ->> 'ref', v_id);
    v_yeni_firma := v_yeni_firma + 1;
  end loop;

  insert into katip_imports(period, file_name, summary)
  values (v_donem, left(p_paket ->> 'dosya', 200), coalesce(p_paket -> 'ozet', '{}'::jsonb)) returning id into v_imp;

  -- 2) işyerleri (sicil -> firma)
  v_sicil := array[]::text[];
  for r in select * from jsonb_array_elements(p_paket -> 'isyerleri') loop
    v_firma := coalesce(nullif(r ->> 'firma_id', '')::uuid, (v_ref ->> (r ->> 'firma_ref'))::uuid);
    if v_firma is null then raise exception 'İşyeri % için firma belirtilmemiş.', r ->> 'sicil'; end if;
    if not exists (select 1 from companies where id = v_firma and organization_id = v_org) then
      raise exception 'İşyeri % için firma bulunamadı.', r ->> 'sicil';
    end if;
    v_sicil := v_sicil || (r ->> 'sicil');
    if exists (select 1 from company_sites where organization_id = v_org and sgk_no = r ->> 'sicil') then v_site_guncel := v_site_guncel + 1; else v_site_ekle := v_site_ekle + 1; end if;
    insert into company_sites(company_id, sgk_no, site_name, city, employee_count, hazard_class, is_active, valid_from, last_import_id)
    values (v_firma, r ->> 'sicil', left(btrim(r ->> 'unvan'), 300), nullif(btrim(r ->> 'il'), ''), (r ->> 'calisan')::int, (r ->> 'tehlike')::hazard_class, true, v_donem, v_imp)
    on conflict (organization_id, sgk_no) do update
      set company_id = excluded.company_id, site_name = excluded.site_name, city = excluded.city, employee_count = excluded.employee_count,
          hazard_class = excluded.hazard_class, is_active = true, valid_from = excluded.valid_from, last_import_id = excluded.last_import_id, archived_at = null, archived_by = null
    returning id into v_id;
    v_site := v_site || jsonb_build_object(r ->> 'sicil', v_id);
  end loop;
  -- dosyada artık olmayan işyerleri: sözleşme bitmiş sayılır (silinmez, pasife alınır)
  update company_sites set is_active = false where organization_id = v_org and is_active and not (sgk_no = any (v_sicil));
  get diagnostics v_kapanan = row_count;

  -- 3) sözleşme satırları (o günkü görüntü) ve görevli kişiler
  for r in select * from jsonb_array_elements(coalesce(p_paket -> 'satirlar', '[]')) loop
    v_id := (v_site ->> (r ->> 'sicil'))::uuid;
    if v_id is null then continue; end if;   -- yoksayılan işyeri
    insert into katip_rows(import_id, site_id, sgk_no, site_name, city, employee_count, hazard_class, contract_id, staff_type, cert_type, cert_no, person_name, minutes_per_month, start_date, approver_name, compliant)
    select v_imp, s.id, s.sgk_no, s.site_name, s.city, s.employee_count, s.hazard_class, nullif(r ->> 'sozlesme_id', ''), r ->> 'tur', left(r ->> 'sertifika_tipi', 120), nullif(r ->> 'sertifika_no', ''),
           left(btrim(r ->> 'ad'), 120), (r ->> 'dakika')::int, nullif(r ->> 'baslangic', '')::date, nullif(btrim(r ->> 'onaylayan'), ''), nullif(r ->> 'uygun', '')::boolean
      from company_sites s where s.id = v_id;
    v_satir := v_satir + 1;
    insert into katip_people(person_key, person_name, cert_no, national_id, staff_type)
    values (coalesce(nullif(r ->> 'sertifika_no', ''), lower(btrim(r ->> 'ad'))), left(btrim(r ->> 'ad'), 120), nullif(r ->> 'sertifika_no', ''), nullif(r ->> 'tc', ''), r ->> 'tur')
    on conflict (organization_id, person_key) do update
      set person_name = excluded.person_name, national_id = coalesce(excluded.national_id, katip_people.national_id), staff_type = excluded.staff_type, updated_at = now();
  end loop;

  -- 4) firma kişileri (onaylayan): aynı ad firmada yoksa eklenir
  for r in select * from jsonb_array_elements(coalesce(p_paket -> 'kisiler', '[]')) loop
    v_firma := coalesce(nullif(r ->> 'firma_id', '')::uuid, (v_ref ->> (r ->> 'firma_ref'))::uuid);
    if v_firma is null or not exists (select 1 from companies where id = v_firma and organization_id = v_org) then continue; end if;
    if not exists (select 1 from contacts where company_id = v_firma and archived_at is null and lower(btrim(full_name)) = lower(btrim(r ->> 'ad'))) then
      insert into contacts(company_id, full_name, title, notes) values (v_firma, left(btrim(r ->> 'ad'), 120), 'İSG-Katip onaylayan', 'İSG-Katip sözleşme onaylayan kişi (aktarım)');
      v_kisi := v_kisi + 1;
    end if;
  end loop;

  -- 5) pasife alınacak firmalar (Excel'de karşılığı olmayan)
  for v_firma in select (x)::uuid from jsonb_array_elements_text(coalesce(p_paket -> 'pasif', '[]')) x loop
    update companies set customer_status = 'eski_musteri' where id = v_firma and organization_id = v_org and customer_status = 'musteri';
    if found then v_pasif := v_pasif + 1; end if;
  end loop;

  -- 6) firma kartı: aktif işyerlerinin toplam çalışan sayısı ve en yüksek tehlike sınıfı (tarih geçmişi korunur)
  for f in
    select s.company_id, sum(s.employee_count)::int as toplam, max(s.hazard_class) as tehlike,
           case when count(distinct s.hazard_class) > 1
                then (select jsonb_agg(jsonb_build_object('tehlike', t.h, 'calisan', t.n) order by t.h)
                        from (select s2.hazard_class::text as h, sum(s2.employee_count)::int as n from company_sites s2
                               where s2.company_id = s.company_id and s2.organization_id = v_org and s2.is_active and s2.archived_at is null and s2.hazard_class is not null
                               group by s2.hazard_class) t)
           end as dokum
      from company_sites s
     where s.organization_id = v_org and s.is_active and s.archived_at is null and s.hazard_class is not null
       and s.company_id in (select company_id from company_sites where last_import_id = v_imp)
     group by s.company_id
  loop
    select * into v_acik from company_profiles where company_id = f.company_id and valid_to is null order by valid_from desc limit 1;
    if found and v_acik.employee_count = f.toplam and v_acik.hazard_class = f.tehlike and v_acik.site_breakdown is not distinct from f.dokum then continue; end if;
    v_bas := v_donem;
    if found and v_bas <= v_acik.valid_from then v_bas := v_acik.valid_from + 1; end if;
    v_yeni_profil := public.firma_profili_ekle(f.company_id, f.toplam, f.tehlike, v_bas, 'İSG-Katip aktarımı ' || to_char(v_donem, 'MM.YYYY'));
    if f.dokum is not null then update company_profiles set site_breakdown = f.dokum where id = v_yeni_profil.id; end if;
    v_profil := v_profil + 1;
  end loop;

  update katip_imports set row_count = v_satir, site_count = jsonb_array_length(p_paket -> 'isyerleri'), new_company_count = v_yeni_firma where id = v_imp;
  return jsonb_build_object('yukleme_id', v_imp, 'yeni_firma', v_yeni_firma, 'yeni_isyeri', v_site_ekle, 'guncellenen_isyeri', v_site_guncel,
    'kapanan_isyeri', v_kapanan, 'satir', v_satir, 'yeni_kisi', v_kisi, 'pasife_alinan', v_pasif, 'firma_karti_guncellenen', v_profil);
end $$;

revoke all on function public.katip_uygula(jsonb) from public, anon;
grant execute on function public.katip_uygula(jsonb) to authenticated;

notify pgrst, 'reload schema';
