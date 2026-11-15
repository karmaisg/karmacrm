-- Aşama 43: Karma OSGB yazılımından ziyaret kayıtlarının otomatik aktarımı.
-- Firma eşleştirme: firma kısaltması (companies.short_code). Personel eşleştirme: e-posta (employees.email).
-- Aktarılan ziyaretler "Zaman ve ziyaret takibi"ne (time_entries, activity_type='ziyaret') yazılır. Tekrar çalıştırılabilir.

-- 1) Firma kısaltması (benzersiz; Türkçe karakter/büyük-küçük harf farkı yok sayılır)
create or replace function app.kisaltma_norm(t text) returns text language sql immutable as $$
  select nullif(lower(translate(btrim(coalesce(t, '')), 'ÇĞİıÖŞÜçğöşü', 'CGIiOSUcgosu')), '')
$$;
alter table companies add column if not exists short_code text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'companies_short_code_ck') then
    alter table companies add constraint companies_short_code_ck check (short_code is null or (char_length(btrim(short_code)) between 1 and 30 and short_code !~ '[[:cntrl:]]'));
  end if;
end $$;
create unique index if not exists companies_short_code_uq on companies (organization_id, app.kisaltma_norm(short_code))
  where short_code is not null and archived_at is null;

-- 2) Arşivleme korumasına yalnızca hizmet hesabının (oturumsuz) kullanabileceği sistem istisnası
create or replace function app.guard_archive() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.archived_at is null and new.archived_at is not null then
    if auth.uid() is null and current_setting('app.sistem_islemi', true) = 'karma' then
      return new;   -- yalnızca hizmet hesabı ve yalnızca karma_ziyaret_isle / yeniden dene fonksiyonları içinde
    end if;
    if not app.can(tg_argv[0], 'archive') then
      raise exception 'Bu kaydı arşivleme yetkiniz yok (%).', tg_argv[0];
    end if;
    new.archived_by := auth.uid();
  elsif old.archived_at is not null and new.archived_at is null then
    if not app.can(tg_argv[0], 'archive') then
      raise exception 'Bu kaydı arşivden çıkarma yetkiniz yok (%).', tg_argv[0];
    end if;
    new.archived_by := null;
  else
    -- arşiv durumu değişmiyor: arşiv alanları değiştirilemez
    new.archived_at := old.archived_at;
    new.archived_by := old.archived_by;
  end if;
  return new;
end $$;

-- 3) Aktarım tabloları
create table if not exists karma_senkron (
  organization_id uuid primary key references organizations(id),
  imlec           text,                 -- karma yazılımdan son alınan "sonraki" değeri
  son_calisma     timestamptz,
  son_durum       text,                 -- 'tamam' | 'hata'
  son_mesaj       text,
  son_sonuc       jsonb,
  updated_at      timestamptz not null default now()
);
create table if not exists karma_ziyaretler (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  dis_id          text not null check (char_length(dis_id) between 1 and 200),
  durum           text not null check (durum in ('islendi', 'eslesmedi', 'hata', 'silindi')),
  neden           text,
  time_entry_id   uuid references time_entries(id),
  company_id      uuid references companies(id),
  employee_id     uuid references employees(id),
  firma_kisaltma  text,
  personel_eposta text,
  tarih           date,
  sure_dakika     integer,
  ham             jsonb not null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (organization_id, dis_id)
);
create index if not exists karma_ziyaretler_durum_ix on karma_ziyaretler (organization_id, durum);
alter table karma_senkron enable row level security;
alter table karma_ziyaretler enable row level security;
drop policy if exists karma_senkron_sel on karma_senkron;
create policy karma_senkron_sel on karma_senkron for select to authenticated using (organization_id = app.org_id() and (app.can('settings', 'view') or app.can('time', 'view')) and not app.is_field_staff());
drop policy if exists karma_ziyaretler_sel on karma_ziyaretler;
create policy karma_ziyaretler_sel on karma_ziyaretler for select to authenticated using (organization_id = app.org_id() and (app.can('settings', 'view') or app.can('time', 'view')) and not app.is_field_staff());
revoke all on karma_senkron, karma_ziyaretler from anon, authenticated;
grant select on karma_senkron, karma_ziyaretler to authenticated;

-- 4) Tek kaydı işleyen iç fonksiyon: sonuç durumunu döndürür
create or replace function app.karma_kayit_isle(p_org uuid, p_k jsonb) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_id text := nullif(btrim(p_k->>'id'), '');
  v_kis text := nullif(btrim(p_k->>'firma_kisaltma'), '');
  v_eposta text := lower(nullif(btrim(p_k->>'personel_eposta'), ''));
  v_silindi boolean := coalesce((p_k->>'silindi')::boolean, false);
  v_tarih date; v_sure int; v_firma uuid; v_per uuid; v_var karma_ziyaretler; v_durum text; v_neden text;
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
  select id into v_per from employees where organization_id = p_org and archived_at is null and is_active and lower(btrim(email)) = v_eposta;
  if v_tarih is null then v_durum := 'hata'; v_neden := 'Ziyaret tarihi okunamadı.';
  elsif v_tarih > (now() at time zone 'Europe/Istanbul')::date then v_durum := 'hata'; v_neden := 'Gelecek tarihli ziyaret aktarılamaz.';
  elsif v_kis is null or v_firma is null then v_durum := 'eslesmedi'; v_neden := case when v_kis is null then 'Firma kısaltması boş.' else 'Firma kısaltması eşleşmedi: ' || v_kis || ' (OSGB 360 firma formunda "Firma kısaltması"nı girin).' end;
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
      values (p_org, v_per, v_firma, 'ziyaret', v_bas, v_son, v_sure, left('Karma OSGB aktarımı' || coalesce(' · ' || nullif(btrim(p_k->>'not'), ''), ''), 500))
      returning id into v_te;
      v_durum := 'islendi'; v_neden := null;
    exception when others then
      v_durum := 'hata'; v_neden := left(sqlerrm, 300); v_te := null;
    end;
  end if;

  insert into karma_ziyaretler(organization_id, dis_id, durum, neden, time_entry_id, company_id, employee_id, firma_kisaltma, personel_eposta, tarih, sure_dakika, ham)
  values (p_org, v_id, v_durum, v_neden, v_te, v_firma, v_per, v_kis, v_eposta, v_tarih, v_sure, p_k)
  on conflict (organization_id, dis_id) do update set durum = excluded.durum, neden = excluded.neden, time_entry_id = excluded.time_entry_id,
    company_id = excluded.company_id, employee_id = excluded.employee_id, firma_kisaltma = excluded.firma_kisaltma, personel_eposta = excluded.personel_eposta,
    tarih = excluded.tarih, sure_dakika = excluded.sure_dakika, ham = excluded.ham, updated_at = now();
  return v_durum;
end $$;
revoke all on function app.karma_kayit_isle(uuid, jsonb) from public, anon, authenticated;

-- 5) Edge Function'ın çağırdığı toplu işleme (yalnızca hizmet hesabı)
create or replace function public.karma_ziyaret_isle(p_org uuid, p_kayitlar jsonb, p_imlec text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare k jsonb; d text; sonuc jsonb := '{}'::jsonb; n int;
begin
  if auth.uid() is not null then raise exception 'Bu işlem yalnızca sistem tarafından çalıştırılır.'; end if;
  perform set_config('app.sistem_islemi', 'karma', true);
  if jsonb_typeof(coalesce(p_kayitlar, '[]'::jsonb)) <> 'array' then raise exception 'Kayıt listesi geçersiz.'; end if;
  for k in select * from jsonb_array_elements(coalesce(p_kayitlar, '[]'::jsonb)) loop
    d := app.karma_kayit_isle(p_org, k);
    sonuc := jsonb_set(sonuc, array[d], to_jsonb(coalesce((sonuc->>d)::int, 0) + 1));
  end loop;
  insert into karma_senkron(organization_id, imlec, son_calisma, son_durum, son_mesaj, son_sonuc)
  values (p_org, p_imlec, now(), 'tamam', null, sonuc)
  on conflict (organization_id) do update set imlec = coalesce(excluded.imlec, karma_senkron.imlec), son_calisma = now(), son_durum = 'tamam', son_mesaj = null, son_sonuc = excluded.son_sonuc, updated_at = now();
  return sonuc;
end $$;

create or replace function public.karma_senkron_hata(p_org uuid, p_mesaj text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null then raise exception 'Bu işlem yalnızca sistem tarafından çalıştırılır.'; end if;
  insert into karma_senkron(organization_id, son_calisma, son_durum, son_mesaj) values (p_org, now(), 'hata', left(p_mesaj, 300))
  on conflict (organization_id) do update set son_calisma = now(), son_durum = 'hata', son_mesaj = excluded.son_mesaj, updated_at = now();
end $$;

-- Kısaltma/e-posta düzeltildikten sonra eşleşmeyen ve hatalı kayıtları yeniden dener (kullanıcı veya sistem)
create or replace function public.karma_eslesmeyenleri_yeniden_dene(p_org uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare o uuid := coalesce(p_org, app.org_id()); r record; d text; sonuc jsonb := '{}'::jsonb;
begin
  if auth.uid() is not null then
    if o is distinct from app.org_id() or not (app.can('settings', 'edit') or app.can('time', 'create')) or app.is_field_staff() then
      raise exception 'Bu işlem için yetkiniz yok.';
    end if;
  end if;
  perform set_config('app.sistem_islemi', 'karma', true);
  for r in select ham from karma_ziyaretler where organization_id = o and durum in ('eslesmedi', 'hata') order by tarih nulls last, created_at loop
    d := app.karma_kayit_isle(o, r.ham);
    sonuc := jsonb_set(sonuc, array[d], to_jsonb(coalesce((sonuc->>d)::int, 0) + 1));
  end loop;
  return sonuc;
end $$;

revoke all on function public.karma_ziyaret_isle(uuid, jsonb, text), public.karma_senkron_hata(uuid, text) from public, anon, authenticated;
revoke all on function public.karma_eslesmeyenleri_yeniden_dene(uuid) from public, anon;
grant execute on function public.karma_eslesmeyenleri_yeniden_dene(uuid) to authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.karma_eslesmeyenleri_yeniden_dene(uuid) to service_role;
    grant execute on function public.karma_ziyaret_isle(uuid, jsonb, text), public.karma_senkron_hata(uuid, text) to service_role;
    grant select, insert, update on karma_senkron, karma_ziyaretler to service_role;
  end if;
end $$;
