-- Aşama 44: Firmaların birden fazla işyeri için Karma OSGB kısaltması ve isteğe bağlı kendi adresi/konumu.
-- Mevcut "İşyerleri" (company_sites) kayıtları kullanılır: işyeri adı = işyeri unvanı. İşyerinin adresi boşsa firmanın
-- işyeri adresi geçerlidir (aynı adreste birden fazla işyeri). Tekrar çalıştırılabilir.

alter table company_sites add column if not exists short_code text;
alter table company_sites add column if not exists district text;
alter table company_sites add column if not exists address text;
alter table company_sites add column if not exists latitude numeric(9,6);
alter table company_sites add column if not exists longitude numeric(9,6);
alter table company_sites add column if not exists geo_query text;
alter table company_sites add column if not exists geo_source text;
alter table company_sites add column if not exists geo_at timestamptz;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'company_sites_extra_ck') then
    alter table company_sites add constraint company_sites_extra_ck check (
      (short_code is null or (char_length(btrim(short_code)) between 1 and 30 and short_code !~ '[[:cntrl:]]'))
      and char_length(coalesce(district, '')) <= 80 and char_length(coalesce(address, '')) <= 500
      and ((latitude is null and longitude is null and geo_source is null)
           or (latitude between -90 and 90 and longitude between -180 and 180 and geo_source in ('google', 'manuel'))));
  end if;
end $$;
create unique index if not exists company_sites_short_uq on company_sites (organization_id, app.kisaltma_norm(short_code))
  where short_code is not null and archived_at is null;

-- Kısaltma firmalar ve işyerleri arasında benzersiz olmalı
create or replace function app.site_short_code_check() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.short_code is not null and new.archived_at is null and (tg_op = 'INSERT' or new.short_code is distinct from old.short_code or old.archived_at is not null)
     and exists (select 1 from companies where organization_id = new.organization_id and archived_at is null
                  and app.kisaltma_norm(short_code) = app.kisaltma_norm(new.short_code)) then
    raise exception 'Bu kısaltma bir firmada zaten kullanılıyor (companies_short_code_uq).';
  end if;
  return new;
end $$;
drop trigger if exists trg_company_sites_short on company_sites;
create trigger trg_company_sites_short before insert or update on company_sites for each row execute function app.site_short_code_check();

create or replace function app.company_short_code_check() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.short_code is not null and new.archived_at is null and (tg_op = 'INSERT' or new.short_code is distinct from old.short_code or old.archived_at is not null)
     and exists (select 1 from company_sites where organization_id = new.organization_id and archived_at is null
                  and app.kisaltma_norm(short_code) = app.kisaltma_norm(new.short_code)) then
    raise exception 'Bu kısaltma bir işyerinde zaten kullanılıyor (companies_short_code_uq).';
  end if;
  return new;
end $$;
drop trigger if exists trg_companies_short_code on companies;
create trigger trg_companies_short_code before insert or update on companies for each row execute function app.company_short_code_check();

-- İşyeri konumu (harita)
create or replace function public.isyeri_konum_kaydet(p_site uuid, p_lat numeric, p_lng numeric, p_sorgu text, p_kaynak text)
returns company_sites language plpgsql security definer set search_path = public as $$
declare w company_sites;
begin
  if auth.uid() is null or not ((app.can('time', 'create') and not app.is_field_staff()) or app.can('companies', 'edit')) then
    raise exception 'İşyeri konumunu kaydetme yetkiniz yok.';
  end if;
  if p_lat is null or p_lng is null then
    update company_sites set latitude = null, longitude = null, geo_query = null, geo_source = null, geo_at = null
     where id = p_site and organization_id = app.org_id() and archived_at is null returning * into w;
  else
    if p_lat not between -90 and 90 or p_lng not between -180 and 180 then raise exception 'Konum geçerli değil.'; end if;
    if p_kaynak not in ('google', 'manuel') then raise exception 'Konum kaynağı geçerli değil.'; end if;
    update company_sites set latitude = round(p_lat, 6), longitude = round(p_lng, 6), geo_query = left(p_sorgu, 500), geo_source = p_kaynak, geo_at = now()
     where id = p_site and organization_id = app.org_id() and archived_at is null returning * into w;
  end if;
  if w.id is null then raise exception 'İşyeri bulunamadı.'; end if;
  return w;
end $$;
revoke all on function public.isyeri_konum_kaydet(uuid, numeric, numeric, text, text) from public, anon;
grant execute on function public.isyeri_konum_kaydet(uuid, numeric, numeric, text, text) to authenticated;

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
    'attachments','companies','notifications','tasks','outbound_messages','crm','calendar_items','tasks',
    'employee_leaves','admin_affairs','vehicles','admin_affairs','vehicle_records','admin_affairs','admin_documents','admin_affairs',
    'signed_contracts','contracts','budget_lines','budget','budget_expense_lines','budget','budget_personnel_lines','budget','salary_calcs','payroll','offer_pdfs','offers','visit_plans','time','company_sites','companies','integration_settings','settings') ->> p_table), 'users');
$$;

-- Karma OSGB aktarımı: işyeri kısaltması da eşleşir; işyeri unvanı zaman kaydı notuna yazılır
alter table karma_ziyaretler add column if not exists site_id uuid references company_sites(id);
create or replace function app.karma_kayit_isle(p_org uuid, p_k jsonb) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_id text := nullif(btrim(p_k->>'id'), '');
  v_kis text := nullif(btrim(p_k->>'firma_kisaltma'), '');
  v_eposta text := lower(nullif(btrim(p_k->>'personel_eposta'), ''));
  v_silindi boolean := coalesce((p_k->>'silindi')::boolean, false);
  v_tarih date; v_sure int; v_firma uuid; v_isyeri uuid; v_unvan text; v_per uuid; v_var karma_ziyaretler; v_durum text; v_neden text;
  v_bas timestamptz; v_son timestamptz; v_te uuid; v_gunbasi timestamptz; v_gunsonu timestamptz;
begin
  if v_id is null then return 'atlandi'; end if;
  select * into v_var from karma_ziyaretler where organization_id = p_org and dis_id = v_id;
  begin
    v_tarih := (p_k->>'tarih')::date;
  exception when others then v_tarih := null; end;
  begin
    v_sure := nullif(p_k->>'sure_dakika', '')::numeric::int;
  exception when others then v_sure := null; end;

  if v_silindi then
    if v_var.time_entry_id is not null then
      update time_entries set archived_at = now() where id = v_var.time_entry_id and archived_at is null;
    end if;
    insert into karma_ziyaretler(organization_id, dis_id, durum, neden, firma_kisaltma, personel_eposta, tarih, sure_dakika, ham)
    values (p_org, v_id, 'silindi', 'Karma OSGB yazılımında silindi.', v_kis, v_eposta, v_tarih, v_sure, p_k)
    on conflict (organization_id, dis_id) do update set durum = 'silindi', neden = excluded.neden, ham = excluded.ham, updated_at = now();
    return 'silindi';
  end if;

  select id into v_firma from companies where organization_id = p_org and archived_at is null and app.kisaltma_norm(short_code) = app.kisaltma_norm(v_kis);
  v_isyeri := null; v_unvan := null;
  if v_firma is null and v_kis is not null then
    select s.company_id, s.id, s.site_name into v_firma, v_isyeri, v_unvan from company_sites s join companies c on c.id = s.company_id and c.archived_at is null
     where s.organization_id = p_org and s.archived_at is null and app.kisaltma_norm(s.short_code) = app.kisaltma_norm(v_kis);
  end if;
  select id into v_per from employees where organization_id = p_org and archived_at is null and is_active and lower(btrim(email)) = v_eposta;
  if v_tarih is null then v_durum := 'hata'; v_neden := 'Ziyaret tarihi okunamadı.';
  elsif v_tarih > (now() at time zone 'Europe/Istanbul')::date then v_durum := 'hata'; v_neden := 'Gelecek tarihli ziyaret aktarılamaz.';
  elsif v_kis is null or v_firma is null then v_durum := 'eslesmedi'; v_neden := case when v_kis is null then 'Firma kısaltması boş.' else 'Firma kısaltması eşleşmedi: ' || v_kis || ' (firma formunda "Firma kısaltması" veya firma sayfası → İşyerleri bölümünde işyerinin "Karma kısaltması"nı girin).' end;
  elsif v_eposta is null or v_per is null then v_durum := 'eslesmedi'; v_neden := case when v_eposta is null then 'Personel e-postası boş.' else 'Personel e-postası eşleşmedi: ' || v_eposta || ' (Personel kaydındaki e-posta aynı olmalı ve personel aktif olmalı).' end;
  end if;

  if v_durum is null then
    v_sure := least(greatest(coalesce(v_sure, 60), 5), 720);
    -- Aynı kayıt değişmediyse dokunma
    if v_var.durum = 'islendi' and v_var.time_entry_id is not null and v_var.company_id = v_firma and v_var.employee_id = v_per
       and v_var.tarih = v_tarih and v_var.sure_dakika = v_sure then
      update karma_ziyaretler set ham = p_k, updated_at = now() where id = v_var.id; return 'degismedi';
    end if;
    begin
      if v_var.time_entry_id is not null then
        update time_entries set archived_at = now() where id = v_var.time_entry_id and archived_at is null;
      end if;
      v_gunbasi := (v_tarih::timestamp) at time zone 'Europe/Istanbul';
      v_gunsonu := ((v_tarih + 1)::timestamp) at time zone 'Europe/Istanbul';
      select coalesce(max(end_at), v_gunbasi + interval '9 hours') into v_bas from time_entries
       where employee_id = v_per and archived_at is null and start_at >= v_gunbasi and start_at < v_gunsonu;
      v_bas := greatest(v_bas, v_gunbasi + interval '9 hours');
      v_son := v_bas + make_interval(mins => v_sure);
      if v_son > v_gunsonu then raise exception 'O gün personelin zaman kayıtları dolu; ziyaret sığmadı.'; end if;
      insert into time_entries(organization_id, employee_id, company_id, activity_type, start_at, end_at, onsite_minutes, notes)
      values (p_org, v_per, v_firma, 'ziyaret', v_bas, v_son, v_sure, left('Karma OSGB aktarımı' || coalesce(' · ' || v_unvan, '') || coalesce(' · ' || nullif(btrim(p_k->>'not'), ''), ''), 500))
      returning id into v_te;
      v_durum := 'islendi'; v_neden := null;
    exception when others then
      v_durum := 'hata'; v_neden := left(sqlerrm, 300); v_te := null;
    end;
  end if;

  insert into karma_ziyaretler(organization_id, dis_id, durum, neden, time_entry_id, company_id, site_id, employee_id, firma_kisaltma, personel_eposta, tarih, sure_dakika, ham)
  values (p_org, v_id, v_durum, v_neden, v_te, v_firma, v_isyeri, v_per, v_kis, v_eposta, v_tarih, v_sure, p_k)
  on conflict (organization_id, dis_id) do update set durum = excluded.durum, neden = excluded.neden, time_entry_id = excluded.time_entry_id,
    company_id = excluded.company_id, site_id = excluded.site_id, employee_id = excluded.employee_id, firma_kisaltma = excluded.firma_kisaltma, personel_eposta = excluded.personel_eposta,
    tarih = excluded.tarih, sure_dakika = excluded.sure_dakika, ham = excluded.ham, updated_at = now();
  return v_durum;
end $$;
revoke all on function app.karma_kayit_isle(uuid, jsonb) from public, anon, authenticated;
