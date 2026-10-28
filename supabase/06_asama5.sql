-- =====================================================================
-- OSGB 360 - Aşama 5 eki (uzman/hekim, görevlendirme, zaman takibi)
--
-- 01_sema.sql ... 05_asama4.sql çalıştırıldıktan SONRA, BİR KEZ çalıştırılır.
-- Mevcut verilere dokunmaz; yalnızca fonksiyon, tetikleyici, politika ve bir indeks ekler / günceller.
-- Tekrar çalıştırmak zarar vermez.
--
-- Eklenenler
--   1) Kurumlar arası bağlantı koruması: personel maliyeti, görevlendirme, zaman kaydı
--   2) Personel: doğrulama, hizmet türü değişmezliği, açık görevlendirmesi olan personel arşivlenemez
--   3) Görevlendirme: hizmet türü personelle uyumlu, başlamış görevlendirmenin payı/firması değişmez
--      (pay değişimi için gorevlendirme_degistir: eskiyi kapatır, yenisini açar -> geçmiş bozulmaz)
--   4) Zaman kaydı: tarih İstanbul saatine göre otomatik, gelecek tarih ve 24 saati aşan kayıt yok,
--      uzman/hekim rolü yalnızca kendi kayıtlarını görür ve girer
--   5) personel_listesi, personel_maliyeti_ekle, personel_kullanici_bagla, gorevlendirme_degistir
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Yardımcılar ve kurumlar arası bağlantı koruması
-- ---------------------------------------------------------------------
create or replace function app.my_employee_id() returns uuid
language sql stable security definer set search_path = public as $$
  select employee_id from public.users where id = auth.uid() and is_active
$$;

create or replace function app.is_field_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select r.key = 'uzman_hekim' from public.users u join public.roles r on r.id = u.role_id
                   where u.id = auth.uid() and u.is_active), false)
$$;

create unique index if not exists users_employee_uq on users(employee_id) where employee_id is not null;

drop trigger if exists trg_employee_costs_org on employee_costs;
create trigger trg_employee_costs_org before insert or update on employee_costs
  for each row execute function app.check_same_org('employees:employee_id');

drop trigger if exists trg_assignments_org on assignments;
create trigger trg_assignments_org before insert or update on assignments
  for each row execute function app.check_same_org('companies:company_id', 'employees:employee_id');

drop trigger if exists trg_time_entries_org on time_entries;
create trigger trg_time_entries_org before insert or update on time_entries
  for each row execute function app.check_same_org('employees:employee_id', 'companies:company_id');

-- ---------------------------------------------------------------------
-- 2. Personel
-- ---------------------------------------------------------------------
create or replace function app.employee_before_write() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.full_name := btrim(new.full_name);
  if new.full_name = '' then raise exception 'Ad soyad zorunludur.'; end if;
  if new.end_date is not null and new.start_date is not null and new.end_date < new.start_date then
    raise exception 'Ayrılış tarihi işe başlama tarihinden önce olamaz.';
  end if;
  if tg_op = 'UPDATE' then
    if new.staff_type is distinct from old.staff_type and
       (exists (select 1 from assignments where employee_id = new.id) or exists (select 1 from time_entries where employee_id = new.id)) then
      raise exception 'Görevlendirmesi veya zaman kaydı olan personelin hizmet türü değiştirilemez.';
    end if;
    if old.archived_at is null and new.archived_at is not null and exists (
         select 1 from assignments a where a.employee_id = new.id and a.archived_at is null
           and (a.valid_to is null or a.valid_to >= current_date)) then
      raise exception 'Açık görevlendirmesi olan personel arşivlenemez. Önce görevlendirmelerini bitirin.';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_employees_write on employees;
create trigger trg_employees_write before insert or update on employees
  for each row execute function app.employee_before_write();

-- ---------------------------------------------------------------------
-- 3. Görevlendirme
-- ---------------------------------------------------------------------
-- Pay denetimi (düzeltildi): yeni kaydın dönemindeki HER ANDA aynı hizmet türündeki payların toplamı %100'ü aşmamalı.
-- (Eski denetim, dönemle kesişen tüm payları toplayıp ardışık dönemleri çakışıyormuş gibi sayıyordu.)
create or replace function app.check_assignment_shares() returns trigger
language plpgsql security definer set search_path = public as $$
declare d date; total numeric;
begin
  for d in
    select new.valid_from
    union
    select a.valid_from from assignments a
    where a.company_id = new.company_id and a.staff_type = new.staff_type and a.archived_at is null and a.id <> new.id
      and a.valid_from > new.valid_from and a.valid_from <= coalesce(new.valid_to, 'infinity'::date)
  loop
    select coalesce(sum(a.share_pct), 0) into total
    from assignments a
    where a.company_id = new.company_id and a.staff_type = new.staff_type and a.archived_at is null and a.id <> new.id
      and a.valid_from <= d and coalesce(a.valid_to, 'infinity'::date) >= d;
    if total + new.share_pct > 100 then
      raise exception 'Bu firmada aynı dönemde % hizmet payı toplamı %%100''ü aşıyor (mevcut: %).', new.staff_type, total;
    end if;
  end loop;
  return new;
end $$;

create or replace function app.assignment_before_write() returns trigger
language plpgsql security definer set search_path = public as $$
declare e employees%rowtype; c companies%rowtype;
begin
  select * into e from employees where id = new.employee_id;
  if not found then raise exception 'Personel bulunamadı.'; end if;
  if e.staff_type is distinct from new.staff_type then
    raise exception 'Görevlendirme türü personelin türüyle (%) aynı olmalıdır.', e.staff_type;
  end if;
  if new.official_start is not null and new.official_end is not null and new.official_end < new.official_start then
    raise exception 'Resmî görevlendirme bitişi başlangıçtan önce olamaz.';
  end if;
  if tg_op = 'INSERT' then
    if not e.is_active or e.archived_at is not null then raise exception 'Pasif veya arşivdeki personel görevlendirilemez.'; end if;
    select * into c from companies where id = new.company_id;
    if c.archived_at is not null then raise exception 'Arşivdeki firmaya görevlendirme yapılamaz.'; end if;
  else
    if new.company_id is distinct from old.company_id or new.employee_id is distinct from old.employee_id
       or new.staff_type is distinct from old.staff_type then
      raise exception 'Görevlendirmenin firması, personeli ve türü değiştirilemez; yenisini oluşturun.';
    end if;
    -- başlamış görevlendirmenin payı ve başlangıcı geçmiş hesapları bozmasın
    if old.valid_from <= current_date and (new.share_pct is distinct from old.share_pct or new.valid_from is distinct from old.valid_from) then
      raise exception 'Başlamış görevlendirmenin payı ve başlangıcı değiştirilemez. "Payı değiştir" ile yeni dönem açın.';
    end if;
    if new.valid_to is not null and new.valid_to < new.valid_from then
      raise exception 'Bitiş tarihi başlangıçtan önce olamaz.';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_assignments_write on assignments;
create trigger trg_assignments_write before insert or update on assignments
  for each row execute function app.assignment_before_write();

-- Payı değiştir: mevcut dönemi p_baslangic - 1 gününde kapatır, yeni payla yeni dönem açar
create or replace function public.gorevlendirme_degistir(p_id uuid, p_pay numeric, p_baslangic date, p_not text default null)
returns assignments language plpgsql security invoker set search_path = public as $$
declare a assignments%rowtype; y assignments%rowtype;
begin
  if not (app.can('assignments','edit') and app.can('assignments','create')) then
    raise exception 'Görevlendirmeyi değiştirme yetkiniz yok.';
  end if;
  select * into a from assignments where id = p_id and archived_at is null;
  if not found then raise exception 'Görevlendirme bulunamadı.'; end if;
  if a.valid_to is not null and a.valid_to < current_date then raise exception 'Bitmiş görevlendirme değiştirilemez.'; end if;
  if p_baslangic <= a.valid_from then raise exception 'Yeni dönem, mevcut dönemin başlangıcından sonra olmalıdır.'; end if;
  if p_pay is null or p_pay <= 0 or p_pay > 100 then raise exception 'Pay 0 ile 100 arasında olmalıdır.'; end if;
  if a.valid_to is not null and p_baslangic > a.valid_to then raise exception 'Yeni dönem mevcut dönemin bitişinden sonra başlayamaz.'; end if;
  update assignments set valid_to = p_baslangic - 1 where id = a.id;
  insert into assignments(company_id, employee_id, staff_type, share_pct, valid_from, valid_to, official_ref, official_start, official_end, notes)
  values (a.company_id, a.employee_id, a.staff_type, p_pay, p_baslangic, a.valid_to, a.official_ref, a.official_start, a.official_end, coalesce(p_not, a.notes))
  returning * into y;
  return y;
end $$;

-- ---------------------------------------------------------------------
-- 4. Zaman kaydı
-- ---------------------------------------------------------------------
create or replace function app.time_entry_before_write() returns trigger
language plpgsql security definer set search_path = public as $$
declare e employees%rowtype; mine uuid;
begin
  select * into e from employees where id = new.employee_id;
  if not found then raise exception 'Personel bulunamadı.'; end if;
  if tg_op = 'INSERT' and (not e.is_active or e.archived_at is not null) then
    raise exception 'Pasif veya arşivdeki personel için zaman kaydı girilemez.';
  end if;
  new.work_date := (new.start_at at time zone 'Europe/Istanbul')::date;
  if new.work_date > (now() at time zone 'Europe/Istanbul')::date then
    raise exception 'Gelecek tarihli zaman kaydı girilemez.';
  end if;
  if new.end_at - new.start_at > interval '24 hours' then
    raise exception 'Tek kayıt 24 saatten uzun olamaz.';
  end if;
  new.activity_type := btrim(new.activity_type);
  if new.activity_type = '' then raise exception 'Faaliyet türü zorunludur.'; end if;
  if tg_op = 'UPDATE' and new.employee_id is distinct from old.employee_id then
    raise exception 'Zaman kaydının personeli değiştirilemez; kaydı arşivleyip yenisini girin.';
  end if;
  if app.is_field_staff() then
    mine := app.my_employee_id();
    if mine is null or new.employee_id <> mine then
      raise exception 'Yalnızca kendi adınıza zaman kaydı girebilirsiniz.';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_time_entries_write on time_entries;
create trigger trg_time_entries_write before insert or update on time_entries
  for each row execute function app.time_entry_before_write();

-- Uzman/hekim rolü yalnızca kendi zaman kayıtlarını ve görevlendirmelerini görür
drop policy if exists time_entries_sel on time_entries;
create policy time_entries_sel on time_entries for select to authenticated
  using (organization_id = app.org_id() and app.can('time','view')
         and (not app.is_field_staff() or employee_id = app.my_employee_id()));
drop policy if exists time_entries_ins on time_entries;
create policy time_entries_ins on time_entries for insert to authenticated
  with check (organization_id = app.org_id() and app.can('time','create')
              and (not app.is_field_staff() or employee_id = app.my_employee_id()));
drop policy if exists time_entries_upd on time_entries;
create policy time_entries_upd on time_entries for update to authenticated
  using (organization_id = app.org_id() and app.can('time','edit')
         and (not app.is_field_staff() or employee_id = app.my_employee_id()))
  with check (organization_id = app.org_id());

drop policy if exists assignments_sel on assignments;
create policy assignments_sel on assignments for select to authenticated
  using (organization_id = app.org_id() and app.can('assignments','view')
         and (not app.is_field_staff() or employee_id = app.my_employee_id()));

-- ---------------------------------------------------------------------
-- 5. Personel listesi (hassas olmayan alanlar), maliyet dönemi, kullanıcı bağlama
-- ---------------------------------------------------------------------
create or replace function public.personel_listesi()
returns table (id uuid, full_name text, staff_type staff_type, is_active boolean, monthly_capacity_min integer, archived_at timestamptz)
language sql stable security definer set search_path = public as $$
  select e.id, e.full_name, e.staff_type, e.is_active, e.monthly_capacity_min, e.archived_at
  from public.employees e
  where e.organization_id = app.org_id()
    and (app.can('staff','view') or app.can('assignments','view') or app.can('time','view') or app.can('capacity','view'))
    and (not app.is_field_staff() or e.id = app.my_employee_id())
  order by e.full_name
$$;

create or replace function public.personel_maliyeti_ekle(p_employee uuid, p_brut numeric, p_sgk numeric, p_diger numeric, p_baslangic date)
returns employee_costs language plpgsql security invoker set search_path = public as $$
declare acik employee_costs%rowtype; y employee_costs%rowtype;
begin
  if not (app.can('payroll','create') and app.can('payroll','edit')) then raise exception 'Personel maliyeti girme yetkiniz yok.'; end if;
  if coalesce(p_brut,0) < 0 or coalesce(p_sgk,0) < 0 or coalesce(p_diger,0) < 0 then raise exception 'Tutarlar negatif olamaz.'; end if;
  select * into acik from employee_costs where employee_id = p_employee and valid_to is null;
  if found then
    if p_baslangic <= acik.valid_from then raise exception 'Yeni dönem, mevcut dönemin başlangıcından sonra olmalıdır.'; end if;
    update employee_costs set valid_to = p_baslangic - 1 where id = acik.id;
  end if;
  insert into employee_costs(employee_id, gross_salary, employer_sgk, other_benefits, valid_from)
  values (p_employee, coalesce(p_brut,0), coalesce(p_sgk,0), coalesce(p_diger,0), p_baslangic) returning * into y;
  return y;
end $$;

-- Personel kaydını bir kullanıcıya bağlar (uzman/hekim kendi zamanını girebilsin). p_user boşsa bağı kaldırır.
create or replace function public.personel_kullanici_bagla(p_employee uuid, p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not (app.can('staff','edit') and app.can('users','edit')) then raise exception 'Personeli kullanıcıya bağlama yetkiniz yok.'; end if;
  if not exists (select 1 from employees where id = p_employee and organization_id = app.org_id()) then raise exception 'Personel bulunamadı.'; end if;
  update users set employee_id = null where employee_id = p_employee and organization_id = app.org_id();
  if p_user is not null then
    if not exists (select 1 from users where id = p_user and organization_id = app.org_id()) then raise exception 'Kullanıcı bulunamadı.'; end if;
    update users set employee_id = p_employee where id = p_user;
  end if;
end $$;

grant execute on function public.gorevlendirme_degistir(uuid, numeric, date, text) to authenticated;
grant execute on function public.personel_listesi() to authenticated;
grant execute on function public.personel_maliyeti_ekle(uuid, numeric, numeric, numeric, date) to authenticated;
grant execute on function public.personel_kullanici_bagla(uuid, uuid) to authenticated;
