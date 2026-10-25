-- =====================================================================
-- OSGB 360 - Aşama 2 eki (kimlik, kullanıcılar, firma kartları, kişiler)
--
-- 01_sema.sql ve 02_ilk_kurulum.sql çalıştırıldıktan SONRA, BİR KEZ çalıştırılır.
-- Mevcut verilere dokunmaz; yalnızca fonksiyon ve tetikleyici ekler / günceller.
--
-- Eklenenler
--   1) Arşivden çıkarma ve arşiv alanlarına müdahale koruması
--   2) Kullanıcı tablosu koruması (kendini kilitleme, kurumlar arası taşıma, ayrıcalıklı rol)
--   3) Yetki matrisi koruması (sistem yöneticisi / işletme sahibi yetkileri sabit) + denetim kaydı
--   4) Kurumlar arası bağlantı koruması (başka kurumun kaydına referans verilemez)
--   5) Arayüzün çağırdığı işlemler: firma_olustur, firma_profili_ekle, kullanici_ekle,
--      kurum_kullanicilari
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Arşiv koruması (güncellenmiş)
--    * Arşivleme: 'arşivle' yetkisi gerekir, arşivleyen kullanıcı kaydedilir
--    * Arşivden çıkarma: yine 'arşivle' yetkisi gerekir
--    * archived_at / archived_by alanları başka güncellemelerle oynatılamaz
-- ---------------------------------------------------------------------
create or replace function app.guard_archive() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.archived_at is null and new.archived_at is not null then
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

-- ---------------------------------------------------------------------
-- 2. Kullanıcı tablosu koruması + denetim
-- ---------------------------------------------------------------------
create or replace function app.is_privileged_role(p_role uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.roles where id = p_role and key in ('sistem_yoneticisi','isletme_sahibi'))
$$;

create or replace function app.caller_is_privileged() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.users u join public.roles r on r.id = u.role_id
                 where u.id = auth.uid() and u.is_active and r.key in ('sistem_yoneticisi','isletme_sahibi'))
$$;

create or replace function app.guard_user_update() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.id is distinct from old.id or new.organization_id is distinct from old.organization_id then
    raise exception 'Kullanıcının kimliği ve kurumu değiştirilemez.';
  end if;
  if not exists (select 1 from roles r where r.id = new.role_id and r.organization_id = new.organization_id) then
    raise exception 'Seçilen rol bu kuruma ait değil.';
  end if;
  -- Oturum açmış kullanıcı kendi rolünü / durumunu değiştirip kendini kilitleyemez veya yükseltemez
  if auth.uid() is not null and new.id = auth.uid()
     and (new.is_active is distinct from old.is_active or new.role_id is distinct from old.role_id) then
    raise exception 'Kendi hesabınızın rolünü veya durumunu değiştiremezsiniz.';
  end if;
  -- Ayrıcalıklı rolleri yalnızca sistem yöneticisi / işletme sahibi verebilir veya alabilir
  if auth.uid() is not null and new.role_id is distinct from old.role_id
     and (app.is_privileged_role(new.role_id) or app.is_privileged_role(old.role_id))
     and not app.caller_is_privileged() then
    raise exception 'Sistem yöneticisi ve işletme sahibi rollerini yalnızca bu rollerdeki kullanıcılar değiştirebilir.';
  end if;
  return new;
end $$;

drop trigger if exists trg_users_guard on users;
create trigger trg_users_guard before update on users
  for each row execute function app.guard_user_update();

drop trigger if exists trg_users_audit on users;
create trigger trg_users_audit after insert or update on users
  for each row execute function app.audit();

-- ---------------------------------------------------------------------
-- 3. Yetki matrisi: sistem rollerinin yetkileri sabit, değişiklikler denetlenir
-- ---------------------------------------------------------------------
create or replace function app.guard_role_permissions() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  -- auth.uid() boş ise (kurulum betiği / yönetici SQL'i) kural uygulanmaz
  if auth.uid() is not null and app.is_privileged_role(new.role_id) then
    raise exception 'Sistem yöneticisi ve işletme sahibi yetkileri değiştirilemez.';
  end if;
  return new;
end $$;

drop trigger if exists trg_rp_guard on role_permissions;
create trigger trg_rp_guard before insert or update on role_permissions
  for each row execute function app.guard_role_permissions();

create or replace function app.audit_role_permissions() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_org uuid;
begin
  select organization_id into v_org from roles where id = new.role_id;
  insert into audit_logs(organization_id, table_name, record_id, action, old_data, new_data, user_id)
  values (v_org, 'role_permissions', new.role_id::text || ':' || new.module, tg_op,
          case when tg_op = 'UPDATE' then to_jsonb(old) end, to_jsonb(new), auth.uid());
  return new;
end $$;

drop trigger if exists trg_rp_audit on role_permissions;
create trigger trg_rp_audit after insert or update on role_permissions
  for each row execute function app.audit_role_permissions();

-- ---------------------------------------------------------------------
-- 4. Kurumlar arası bağlantı koruması
--    Bir kayıt, başka kurumun kaydına referans veremez (SaaS'a geçişte veri karışmasın).
--    Kullanım: tg_argv = 'tablo:sütun' çiftleri. Diğer tablolara Aşama 10'da eklenecek.
-- ---------------------------------------------------------------------
create or replace function app.check_same_org() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  spec text; tbl text; col text; v uuid; ok boolean;
  rec jsonb := to_jsonb(new);
begin
  foreach spec in array tg_argv loop
    tbl := split_part(spec, ':', 1);
    col := split_part(spec, ':', 2);
    v := nullif(rec ->> col, '')::uuid;
    if v is not null then
      execute format('select exists (select 1 from public.%I where id = $1 and organization_id = $2)', tbl)
        into ok using v, new.organization_id;
      if not ok then
        raise exception 'Bağlantılı kayıt bu kuruma ait değil (%.%).', tg_table_name, col;
      end if;
    end if;
  end loop;
  return new;
end $$;

drop trigger if exists trg_companies_org on companies;
create trigger trg_companies_org before insert or update on companies
  for each row execute function app.check_same_org('users:responsible_user');

drop trigger if exists trg_company_profiles_org on company_profiles;
create trigger trg_company_profiles_org before insert or update on company_profiles
  for each row execute function app.check_same_org('companies:company_id');

drop trigger if exists trg_contacts_org on contacts;
create trigger trg_contacts_org before insert or update on contacts
  for each row execute function app.check_same_org('companies:company_id', 'leads:lead_id');

-- ---------------------------------------------------------------------
-- 5. Arayüzün çağırdığı işlemler (RPC)
-- ---------------------------------------------------------------------

-- 5a. Kurum kullanıcıları (sorumlu seçimi için): yalnızca ad ve durum
create or replace function public.kurum_kullanicilari()
returns table (id uuid, full_name text, is_active boolean)
language sql stable security definer set search_path = public as $$
  select u.id, u.full_name, u.is_active from public.users u
  where u.organization_id = app.org_id() order by u.full_name
$$;

-- 5b. Firma + ilk çalışan/tehlike kaydı TEK işlemde (ya ikisi de oluşur ya hiçbiri)
create or replace function public.firma_olustur(
  p_firma jsonb,
  p_calisan_sayisi integer default null,
  p_tehlike hazard_class default null,
  p_baslangic date default null
) returns companies
language plpgsql as $$
declare v companies;
begin
  if not app.can('companies', 'create') then
    raise exception 'Firma ekleme yetkiniz yok.';
  end if;
  if coalesce(btrim(p_firma ->> 'name'), '') = '' then
    raise exception 'Firma adı zorunludur.';
  end if;
  if p_calisan_sayisi is not null and (p_tehlike is null or p_baslangic is null) then
    raise exception 'Çalışan sayısı girildiyse tehlike sınıfı ve geçerlilik tarihi de girilmelidir.';
  end if;

  insert into companies(name, tax_no, sector, city, district, address, phone, email, website,
                        current_provider, customer_status, responsible_user, notes)
  values (btrim(p_firma ->> 'name'),
          nullif(btrim(p_firma ->> 'tax_no'), ''),
          nullif(btrim(p_firma ->> 'sector'), ''),
          nullif(btrim(p_firma ->> 'city'), ''),
          nullif(btrim(p_firma ->> 'district'), ''),
          nullif(btrim(p_firma ->> 'address'), ''),
          nullif(btrim(p_firma ->> 'phone'), ''),
          nullif(btrim(p_firma ->> 'email'), ''),
          nullif(btrim(p_firma ->> 'website'), ''),
          nullif(btrim(p_firma ->> 'current_provider'), ''),
          coalesce(nullif(p_firma ->> 'customer_status', ''), 'musteri'),
          nullif(p_firma ->> 'responsible_user', '')::uuid,
          nullif(btrim(p_firma ->> 'notes'), ''))
  returning * into v;

  if p_calisan_sayisi is not null then
    insert into company_profiles(company_id, employee_count, hazard_class, valid_from)
    values (v.id, p_calisan_sayisi, p_tehlike, p_baslangic);
  end if;
  return v;
end $$;

-- 5c. Yeni çalışan sayısı / tehlike sınıfı dönemi: açık dönem bir gün önce kapatılır, eski satır silinmez
create or replace function public.firma_profili_ekle(
  p_firma uuid,
  p_calisan_sayisi integer,
  p_tehlike hazard_class,
  p_baslangic date,
  p_not text default null
) returns company_profiles
language plpgsql as $$
declare v_acik company_profiles; v_yeni company_profiles;
begin
  if not exists (select 1 from companies where id = p_firma) then
    raise exception 'Firma bulunamadı veya erişim yetkiniz yok.';
  end if;
  if p_calisan_sayisi is null or p_calisan_sayisi < 0 then
    raise exception 'Çalışan sayısı 0 veya daha büyük bir tam sayı olmalıdır.';
  end if;
  if p_tehlike is null then
    raise exception 'Tehlike sınıfı zorunludur.';
  end if;
  if p_baslangic is null then
    raise exception 'Geçerlilik başlangıç tarihi zorunludur.';
  end if;

  select * into v_acik from company_profiles
   where company_id = p_firma and valid_to is null
   order by valid_from desc limit 1;

  if found then
    if p_baslangic <= v_acik.valid_from then
      raise exception 'Yeni dönemin başlangıcı (%), mevcut dönemin başlangıcından (%) sonra olmalıdır.',
        to_char(p_baslangic, 'DD.MM.YYYY'), to_char(v_acik.valid_from, 'DD.MM.YYYY');
    end if;
    update company_profiles set valid_to = p_baslangic - 1 where id = v_acik.id;
  end if;

  begin
    insert into company_profiles(company_id, employee_count, hazard_class, valid_from, note)
    values (p_firma, p_calisan_sayisi, p_tehlike, p_baslangic, nullif(btrim(p_not), ''))
    returning * into v_yeni;
  exception when exclusion_violation then
    raise exception 'Bu tarih, firmanın mevcut bir dönemiyle çakışıyor.';
  end;
  return v_yeni;
end $$;

-- 5d. Supabase'de önceden oluşturulmuş bir giriş hesabını kuruma ve role bağlar
create or replace function public.kullanici_ekle(p_email text, p_ad_soyad text, p_rol text)
returns users
language plpgsql security definer set search_path = public as $$
declare v_auth uuid; v_role uuid; v users;
begin
  if not app.can('users', 'create') then
    raise exception 'Kullanıcı ekleme yetkiniz yok.';
  end if;
  if coalesce(btrim(p_ad_soyad), '') = '' then
    raise exception 'Ad soyad zorunludur.';
  end if;
  if coalesce(btrim(p_email), '') = '' then
    raise exception 'E-posta zorunludur.';
  end if;

  select id into v_auth from auth.users where lower(email) = lower(btrim(p_email));
  if v_auth is null then
    raise exception 'Bu e-posta ile oluşturulmuş bir giriş hesabı bulunamadı. Önce Supabase > Authentication > Users bölümünden hesabı oluşturun.';
  end if;
  if exists (select 1 from public.users where id = v_auth) then
    raise exception 'Bu kullanıcı zaten tanımlı.';
  end if;

  select id into v_role from roles where organization_id = app.org_id() and key = p_rol;
  if v_role is null then
    raise exception 'Geçersiz rol.';
  end if;
  if app.is_privileged_role(v_role) and not app.caller_is_privileged() then
    raise exception 'Sistem yöneticisi ve işletme sahibi rollerini yalnızca bu rollerdeki kullanıcılar verebilir.';
  end if;

  insert into users(id, organization_id, role_id, full_name, email)
  values (v_auth, app.org_id(), v_role, btrim(p_ad_soyad), lower(btrim(p_email)))
  returning * into v;
  return v;
end $$;

-- Erişim: yalnızca giriş yapmış kullanıcılar (anon çağıramaz)
revoke execute on function public.kurum_kullanicilari()                                       from public, anon;
revoke execute on function public.firma_olustur(jsonb, integer, hazard_class, date)           from public, anon;
revoke execute on function public.firma_profili_ekle(uuid, integer, hazard_class, date, text) from public, anon;
revoke execute on function public.kullanici_ekle(text, text, text)                            from public, anon;
grant  execute on function public.kurum_kullanicilari()                                       to authenticated;
grant  execute on function public.firma_olustur(jsonb, integer, hazard_class, date)           to authenticated;
grant  execute on function public.firma_profili_ekle(uuid, integer, hazard_class, date, text) to authenticated;
grant  execute on function public.kullanici_ekle(text, text, text)                            to authenticated;
