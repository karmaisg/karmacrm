-- OSGB 360 - Aşama 16: elle işyeri girişi + Takvim modülü + günlük e-postada "Bugün Yapılacaklar" / "Yaklaşan Program".
-- Güvenle yeniden çalıştırılabilir. (Önce 10, 14, 15, 16 numaralı dosyalar çalıştırılmış olmalı.)

-- ===================================================================== 1) Elle girilen işyerleri
alter table company_sites add column if not exists is_manual boolean not null default false;
comment on column company_sites.is_manual is 'true: İSG-Katip dosyasından değil, elle girilmiş işyeri. Katip yüklemesi bunu pasife almaz ve firma kartı toplamına katmaz.';

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
  update company_sites set is_active = false where organization_id = v_org and is_active and not is_manual and not (sgk_no = any (v_sicil));
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
                               where s2.company_id = s.company_id and s2.organization_id = v_org and s2.is_active and not s2.is_manual and s2.archived_at is null and s2.hazard_class is not null
                               group by s2.hazard_class) t)
           end as dokum
      from company_sites s
     where s.organization_id = v_org and s.is_active and not s.is_manual and s.archived_at is null and s.hazard_class is not null
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
-- (gerçek ortamda yetki satırları 14. dosyadakiyle aynıdır)

-- ===================================================================== 2) Takvim
create table if not exists calendar_items (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null default app.org_id() references organizations(id),
  title           text not null check (char_length(btrim(title)) between 1 and 200),
  note            text check (note is null or char_length(note) <= 2000),
  kind            text not null default 'hatirlatma' check (kind in ('hatirlatma', 'odeme')),
  start_date      date not null,                    -- tek seferlik ise tarihin kendisi; aylık ise ilk tarih
  recurrence      text not null default 'yok' check (recurrence in ('yok', 'aylik')),
  end_date        date,                             -- aylık tekrar için isteğe bağlı bitiş
  amount          numeric(14,2) check (amount is null or amount >= 0),
  company_id      uuid references companies(id),
  created_by      uuid default auth.uid(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  archived_at     timestamptz,
  check (end_date is null or end_date >= start_date)
);
create index if not exists calendar_items_org_idx on calendar_items (organization_id, start_date) where archived_at is null;

-- Yapıldı işareti: tek seferlik kayıt için kendi tarihi, aylık kayıt için ilgili ayın tarihi
create table if not exists calendar_completions (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null default app.org_id() references organizations(id),
  item_id         uuid not null references calendar_items(id) on delete cascade,
  occurrence_date date not null,
  completed_by    uuid default auth.uid(),
  created_at      timestamptz not null default now(),
  unique (item_id, occurrence_date)
);

alter table calendar_items enable row level security;
alter table calendar_completions enable row level security;
drop policy if exists calendar_items_sel on calendar_items;
create policy calendar_items_sel on calendar_items for select to authenticated using (organization_id = app.org_id() and app.can('tasks', 'view'));
drop policy if exists calendar_items_ins on calendar_items;
create policy calendar_items_ins on calendar_items for insert to authenticated with check (organization_id = app.org_id() and app.can('tasks', 'create'));
drop policy if exists calendar_items_upd on calendar_items;
create policy calendar_items_upd on calendar_items for update to authenticated
  using (organization_id = app.org_id() and app.can('tasks', 'edit')) with check (organization_id = app.org_id() and app.can('tasks', 'edit'));
drop policy if exists calendar_comp_sel on calendar_completions;
create policy calendar_comp_sel on calendar_completions for select to authenticated using (organization_id = app.org_id() and app.can('tasks', 'view'));
drop policy if exists calendar_comp_ins on calendar_completions;
create policy calendar_comp_ins on calendar_completions for insert to authenticated with check (organization_id = app.org_id() and app.can('tasks', 'edit'));
drop policy if exists calendar_comp_del on calendar_completions;
create policy calendar_comp_del on calendar_completions for delete to authenticated using (organization_id = app.org_id() and app.can('tasks', 'edit'));
revoke all on calendar_items, calendar_completions from anon, authenticated;
grant select, insert, update on calendar_items to authenticated;
grant select, insert, delete on calendar_completions to authenticated;

create or replace function app.calendar_kontrol() returns trigger language plpgsql as $$
begin
  if tg_table_name = 'calendar_items' then
    if new.company_id is not null and not exists (select 1 from companies c where c.id = new.company_id and c.organization_id = new.organization_id) then
      raise exception 'Firma bulunamadı veya başka bir kuruma ait.';
    end if;
    if tg_op = 'UPDATE' then new.updated_at := now(); end if;
  else
    if not exists (select 1 from calendar_items i where i.id = new.item_id and i.organization_id = new.organization_id) then
      raise exception 'Takvim kaydı bulunamadı.';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_calendar_items_chk on calendar_items;
create trigger trg_calendar_items_chk before insert or update on calendar_items for each row execute function app.calendar_kontrol();
drop trigger if exists trg_calendar_comp_chk on calendar_completions;
create trigger trg_calendar_comp_chk before insert on calendar_completions for each row execute function app.calendar_kontrol();

create or replace function app.audit_modul(p_table text) returns text
language sql immutable as $$
  select coalesce((jsonb_build_object(
    'settings','settings','service_time_rules','settings','expense_categories','settings','allocation_rules','settings',
    'companies','companies','company_profiles','companies','contacts','contacts','leads','crm',
    'sales_opportunities','opportunities','opportunity_stage_history','opportunities','activities','contacts',
    'tasks','tasks','employees','staff','employee_costs','payroll','assignments','assignments','time_entries','time',
    'offers','offers','offer_items','offers','offer_shares','offers','contracts','contracts','contract_prices','contracts',
    'invoices','invoices','invoice_items','invoices','payments','invoices',
    'expenses','expenses','overhead_allocations','company_profit',
    'attachments','companies','notifications','tasks','outbound_messages','crm','calendar_items','tasks') ->> p_table), 'users');
$$;
drop trigger if exists trg_calendar_items_audit on calendar_items;
create trigger trg_calendar_items_audit after insert or update on calendar_items for each row execute function app.audit();

-- Bir aralıktaki takvim olayları: kendi kayıtlarınız (tek seferlik + aylık tekrar) ve açık görevlerin son tarihi / hatırlatma tarihi.
-- Aylık tekrar: ilk tarihin günü her ay; ayda o gün yoksa (ör. 31) ayın son günü.
create or replace function app.takvim_olaylari(p_org uuid, p_bas date, p_bit date)
returns table (tarih date, kaynak text, ref uuid, baslik text, firma text, tutar numeric, tamam boolean, tekrar boolean, tur text, oncelik text)
language sql stable security definer set search_path = public as $$
  with aylar as (
    select (date_trunc('month', p_bas) + (n || ' month')::interval)::date as ay
      from generate_series(0, ((extract(year from p_bit) - extract(year from p_bas)) * 12 + extract(month from p_bit) - extract(month from p_bas))::int) n
  ), ogeler as (
    select i.*, case when i.recurrence = 'yok' then i.start_date
                     else least((a.ay + (extract(day from i.start_date)::int - 1)), (a.ay + interval '1 month - 1 day')::date) end as gun
      from calendar_items i
      left join aylar a on i.recurrence = 'aylik'
     where i.organization_id = p_org and i.archived_at is null
       and (i.recurrence = 'yok' or a.ay is not null)
  )
  select o.gun, 'takvim'::text, o.id, o.title, c.name, o.amount,
         exists (select 1 from calendar_completions k where k.item_id = o.id and k.occurrence_date = o.gun),
         o.recurrence = 'aylik', o.kind, null::text
    from ogeler o left join companies c on c.id = o.company_id
   where o.gun between p_bas and p_bit and o.gun >= o.start_date and (o.end_date is null or o.gun <= o.end_date)
  union all
  select (t.due_at at time zone 'Europe/Istanbul')::date, 'gorev_son', t.id, t.title, c.name, null::numeric, false, false, 'gorev', t.priority::text
    from tasks t left join companies c on c.id = t.company_id
   where t.organization_id = p_org and t.archived_at is null and t.status in ('acik', 'devam_ediyor') and t.due_at is not null
     and (t.due_at at time zone 'Europe/Istanbul')::date between p_bas and p_bit
  union all
  select (t.remind_at at time zone 'Europe/Istanbul')::date, 'gorev_hatirlatma', t.id, t.title, c.name, null::numeric, false, false, 'gorev', t.priority::text
    from tasks t left join companies c on c.id = t.company_id
   where t.organization_id = p_org and t.archived_at is null and t.status in ('acik', 'devam_ediyor') and t.remind_at is not null
     and (t.remind_at at time zone 'Europe/Istanbul')::date between p_bas and p_bit
$$;
revoke all on function app.takvim_olaylari(uuid, date, date) from public, anon, authenticated;

create or replace function public.takvim_olaylari(p_bas date, p_bit date)
returns table (tarih date, kaynak text, ref uuid, baslik text, firma text, tutar numeric, tamam boolean, tekrar boolean, tur text, oncelik text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not app.can('tasks', 'view') then raise exception 'Takvimi görme yetkiniz yok.'; end if;
  if p_bas is null or p_bit is null or p_bit < p_bas or p_bit - p_bas > 400 then raise exception 'Tarih aralığı geçersiz (en çok 400 gün).'; end if;
  return query select * from app.takvim_olaylari(app.org_id(), p_bas, p_bit) order by 1, 4;
end $$;
revoke all on function public.takvim_olaylari(date, date) from public, anon;
grant execute on function public.takvim_olaylari(date, date) to authenticated;

-- ===================================================================== 3) Günlük özet: Bugün Yapılacaklar / Yaklaşan Program
-- Eski "görev" bölümü artık yalnızca GECİKMİŞ görevleri içerir (bugünküler "Bugün Yapılacaklar" içinde gelir).
create or replace function public.gunluk_ozet(p_org uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  bugun date := app.today_tr();
  acik jsonb; gecikmis jsonb; yaklasan jsonb; sozlesme jsonb; gorev jsonb; bugun_liste jsonb; program jsonb;
begin
  select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) into acik from (
    select i.invoice_no as no, c.name as firma, i.due_date as vade, i.flag::text as isaret,
           i.amount_incl_vat - coalesce((select sum(p.amount) from payments p where p.invoice_id = i.id and p.archived_at is null), 0) as kalan
      from invoices i join companies c on c.id = i.company_id
     where i.organization_id = p_org and i.archived_at is null) x
   where x.kalan > 0;

  select jsonb_build_object(
           'adet', count(*), 'toplam', coalesce(round(sum(kalan), 2), 0),
           'liste', coalesce(jsonb_agg(jsonb_build_object('no', no, 'firma', firma, 'vade', vade, 'kalan', round(kalan, 2), 'gun', bugun - vade, 'isaret', isaret) order by vade, no) filter (where sira <= 10), '[]'::jsonb))
    into gecikmis
    from (select f.*, row_number() over (order by f.vade, f.no) as sira
            from jsonb_to_recordset(acik) as f(no text, firma text, vade date, kalan numeric, isaret text) where f.vade < bugun) g;

  select jsonb_build_object(
           'adet', count(*), 'toplam', coalesce(round(sum(kalan), 2), 0),
           'liste', coalesce(jsonb_agg(jsonb_build_object('no', no, 'firma', firma, 'vade', vade, 'kalan', round(kalan, 2), 'gun', vade - bugun, 'isaret', isaret) order by vade, no) filter (where sira <= 10), '[]'::jsonb))
    into yaklasan
    from (select f.*, row_number() over (order by f.vade, f.no) as sira
            from jsonb_to_recordset(acik) as f(no text, firma text, vade date, kalan numeric, isaret text) where f.vade >= bugun and f.vade <= bugun + 7) g;

  select jsonb_build_object(
           'adet', count(*),
           'liste', coalesce(jsonb_agg(jsonb_build_object('firma', firma, 'bitis', end_date, 'kalan_gun', end_date - bugun) order by end_date, firma) filter (where sira <= 10), '[]'::jsonb))
    into sozlesme
    from (select c.name as firma, k.end_date, row_number() over (order by k.end_date, c.name) as sira
            from contracts k join companies c on c.id = k.company_id
           where k.organization_id = p_org and k.archived_at is null and k.status = 'aktif' and k.end_date <= bugun + 90) s;

  -- yalnızca gecikmiş görevler
  select jsonb_build_object(
           'adet', count(*),
           'liste', coalesce(jsonb_agg(jsonb_build_object('baslik', baslik, 'firma', firma, 'son', son, 'oncelik', oncelik, 'gecikmis', true) order by son, baslik) filter (where sira <= 10), '[]'::jsonb))
    into gorev
    from (select t.title as baslik, c.name as firma, (t.due_at at time zone 'Europe/Istanbul')::date as son, t.priority::text as oncelik,
                 row_number() over (order by t.due_at, t.title) as sira
            from tasks t left join companies c on c.id = t.company_id
           where t.organization_id = p_org and t.archived_at is null and t.status in ('acik', 'devam_ediyor')
             and t.due_at is not null and (t.due_at at time zone 'Europe/Istanbul')::date < bugun) g;

  -- Bugün Yapılacaklar: bugüne ait yapılmamış takvim kayıtları ve görev son/hatırlatma tarihleri
  select jsonb_build_object(
           'adet', count(*),
           'liste', coalesce(jsonb_agg(jsonb_build_object('baslik', baslik, 'firma', firma, 'tutar', tutar, 'tur', tur, 'kaynak', kaynak) order by tur, baslik) filter (where sira <= 15), '[]'::jsonb))
    into bugun_liste
    from (select o.*, row_number() over (order by o.tur, o.baslik) as sira from app.takvim_olaylari(p_org, bugun, bugun) o where not o.tamam) g;

  -- Yaklaşan Program: yarından başlayarak 3 gün
  select jsonb_build_object(
           'adet', count(*),
           'liste', coalesce(jsonb_agg(jsonb_build_object('tarih', tarih, 'kalan_gun', tarih - bugun, 'baslik', baslik, 'firma', firma, 'tutar', tutar, 'tur', tur, 'kaynak', kaynak) order by tarih, tur, baslik) filter (where sira <= 20), '[]'::jsonb))
    into program
    from (select o.*, row_number() over (order by o.tarih, o.tur, o.baslik) as sira from app.takvim_olaylari(p_org, bugun + 1, bugun + 3) o where not o.tamam) g;

  return jsonb_build_object('tarih', bugun, 'gecikmis_fatura', gecikmis, 'yaklasan_vade', yaklasan, 'sozlesme', sozlesme, 'gorev', gorev,
                            'bugun', bugun_liste, 'program', program);
end $$;
revoke all on function public.gunluk_ozet(uuid) from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.gunluk_ozet(uuid) to service_role;
  end if;
end $$;

notify pgrst, 'reload schema';
