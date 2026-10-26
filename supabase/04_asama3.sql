-- =====================================================================
-- OSGB 360 - Aşama 3 eki (CRM, satış fırsatları, görüşmeler, görevler)
--
-- 01_sema.sql, 02_ilk_kurulum.sql ve 03_asama2.sql çalıştırıldıktan SONRA, BİR KEZ çalıştırılır.
-- Mevcut verilere dokunmaz; yalnızca fonksiyon ve tetikleyici ekler / günceller. Tekrar çalıştırmak zarar vermez.
--
-- Eklenenler
--   1) Kurumlar arası bağlantı koruması: potansiyel müşteri, fırsat, görüşme, görev kayıtları
--   2) Fırsat kapanış tarihi, kayıp nedeni temizliği ve görev tamamlanma tarihi tetikleyicileri
--   3) Görüşme eklenince potansiyel müşterinin "son temas tarihi" güncellenir
--   4) potansiyel_olustur           : potansiyel müşteri + ilk satış fırsatı TEK işlemde
--   5) potansiyel_firmaya_donustur  : potansiyel müşteriyi firmaya çevirir; kişi, fırsat, görüşme ve görevleri taşır
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Kurumlar arası bağlantı koruması
-- ---------------------------------------------------------------------
drop trigger if exists trg_leads_org on leads;
create trigger trg_leads_org before insert or update on leads
  for each row execute function app.check_same_org('users:sales_owner', 'companies:converted_company_id');

drop trigger if exists trg_opps_org on sales_opportunities;
create trigger trg_opps_org before insert or update on sales_opportunities
  for each row execute function app.check_same_org('leads:lead_id', 'companies:company_id', 'users:owner_user');

drop trigger if exists trg_activities_org on activities;
create trigger trg_activities_org before insert or update on activities
  for each row execute function app.check_same_org('companies:company_id', 'leads:lead_id',
                                                   'sales_opportunities:opportunity_id', 'contacts:contact_id');

drop trigger if exists trg_tasks_org on tasks;
create trigger trg_tasks_org before insert or update on tasks
  for each row execute function app.check_same_org('companies:company_id', 'leads:lead_id', 'users:assignee');

-- ---------------------------------------------------------------------
-- 2. Fırsat ve görev tetikleyicileri
-- ---------------------------------------------------------------------
create or replace function app.opp_before_write() returns trigger
language plpgsql as $$
begin
  if new.stage in ('kazanildi', 'kaybedildi') then
    if tg_op = 'INSERT' or old.stage is distinct from new.stage or new.closed_at is null then
      new.closed_at := now();
    end if;
  else
    new.closed_at := null;
  end if;
  if new.stage <> 'kaybedildi' then
    new.lost_reason := null;
    new.lost_note := null;
  end if;
  if coalesce(btrim(new.title), '') = '' then
    raise exception 'Fırsat başlığı zorunludur.';
  end if;
  if new.expected_monthly is not null and new.expected_monthly < 0 then
    raise exception 'Beklenen aylık gelir negatif olamaz.';
  end if;
  return new;
end $$;

drop trigger if exists trg_opps_write on sales_opportunities;
create trigger trg_opps_write before insert or update on sales_opportunities
  for each row execute function app.opp_before_write();

create or replace function app.task_before_write() returns trigger
language plpgsql as $$
begin
  if new.status = 'tamamlandi' then
    if tg_op = 'INSERT' or old.status is distinct from new.status or new.completed_at is null then
      new.completed_at := now();
    end if;
  else
    new.completed_at := null;
  end if;
  if coalesce(btrim(new.title), '') = '' then
    raise exception 'Görev başlığı zorunludur.';
  end if;
  return new;
end $$;

drop trigger if exists trg_tasks_write on tasks;
create trigger trg_tasks_write before insert or update on tasks
  for each row execute function app.task_before_write();

-- ---------------------------------------------------------------------
-- 3. Görüşme eklenince son temas tarihi
-- ---------------------------------------------------------------------
create or replace function app.activity_after_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.lead_id is not null and new.kind in ('gorusme', 'arama', 'eposta', 'ziyaret') then
    update leads set last_contact_date = new.occurred_at::date
     where id = new.lead_id
       and (last_contact_date is null or last_contact_date < new.occurred_at::date);
  end if;
  return new;
end $$;

drop trigger if exists trg_activities_lastcontact on activities;
create trigger trg_activities_lastcontact after insert on activities
  for each row execute function app.activity_after_insert();

-- ---------------------------------------------------------------------
-- 4. Potansiyel müşteri + ilk satış fırsatı (tek işlem)
--    Fırsat yalnızca kullanıcının 'Satış fırsatları' ekleme yetkisi varsa oluşturulur.
-- ---------------------------------------------------------------------
create or replace function public.potansiyel_olustur(p_veri jsonb)
returns leads
language plpgsql as $$
declare v leads;
begin
  if not app.can('crm', 'create') then
    raise exception 'Potansiyel müşteri ekleme yetkiniz yok.';
  end if;
  if coalesce(btrim(p_veri ->> 'name'), '') = '' then
    raise exception 'Firma adı zorunludur.';
  end if;
  if (p_veri ->> 'employee_count') is not null and (p_veri ->> 'hazard_class') is null then
    raise exception 'Çalışan sayısı girildiyse tehlike sınıfı da seçilmelidir.';
  end if;

  insert into leads(name, tax_no, sector, hazard_class, employee_count, city, district, address, phone, email, website,
                    contact_name, contact_title, source, current_provider, est_monthly_revenue, est_service_minutes,
                    sales_owner, next_follow_up_date, priority, score, score_details, notes)
  values (btrim(p_veri ->> 'name'),
          nullif(btrim(p_veri ->> 'tax_no'), ''),
          nullif(btrim(p_veri ->> 'sector'), ''),
          nullif(p_veri ->> 'hazard_class', '')::hazard_class,
          nullif(p_veri ->> 'employee_count', '')::integer,
          nullif(btrim(p_veri ->> 'city'), ''),
          nullif(btrim(p_veri ->> 'district'), ''),
          nullif(btrim(p_veri ->> 'address'), ''),
          nullif(btrim(p_veri ->> 'phone'), ''),
          nullif(btrim(p_veri ->> 'email'), ''),
          nullif(btrim(p_veri ->> 'website'), ''),
          nullif(btrim(p_veri ->> 'contact_name'), ''),
          nullif(btrim(p_veri ->> 'contact_title'), ''),
          nullif(p_veri ->> 'source', '')::lead_source,
          nullif(btrim(p_veri ->> 'current_provider'), ''),
          nullif(p_veri ->> 'est_monthly_revenue', '')::numeric,
          nullif(p_veri ->> 'est_service_minutes', '')::integer,
          nullif(p_veri ->> 'sales_owner', '')::uuid,
          nullif(p_veri ->> 'next_follow_up_date', '')::date,
          coalesce(nullif(p_veri ->> 'priority', ''), 'orta')::priority_level,
          nullif(p_veri ->> 'score', '')::numeric,
          case when p_veri ? 'score_details' then p_veri -> 'score_details' end,
          nullif(btrim(p_veri ->> 'notes'), ''))
  returning * into v;

  if app.can('opportunities', 'create') then
    insert into sales_opportunities(lead_id, title, stage, expected_monthly, owner_user)
    values (v.id, v.name, 'yeni_aday', v.est_monthly_revenue, v.sales_owner);
  end if;
  return v;
end $$;

-- ---------------------------------------------------------------------
-- 5. Potansiyel müşteriyi firmaya dönüştür
--    Tek işlemde: firma (+ varsa ilk çalışan/tehlike dönemi), yetkili kişi, açık fırsatların "kazanıldı"ya alınması,
--    kişi/fırsat/görüşme/görev kayıtlarının firmaya bağlanması. Bir şey başarısız olursa hiçbiri uygulanmaz.
--    SECURITY DEFINER: bağlı kayıtların tümü dönüşümün parçası olduğundan modül yetkileri yerine
--    'potansiyel müşteri düzenleme' + 'firma ekleme' yetkisi aranır; kurum kontrolü fonksiyonda yapılır.
-- ---------------------------------------------------------------------
create or replace function public.potansiyel_firmaya_donustur(p_lead uuid)
returns companies
language plpgsql security definer set search_path = public as $$
declare l leads; c companies;
begin
  if auth.uid() is null or app.org_id() is null then
    raise exception 'Oturum bulunamadı.';
  end if;
  if not app.can('crm', 'edit') then
    raise exception 'Potansiyel müşteriyi dönüştürme yetkiniz yok.';
  end if;
  if not app.can('companies', 'create') then
    raise exception 'Firma ekleme yetkiniz yok.';
  end if;

  select * into l from leads where id = p_lead and organization_id = app.org_id() for update;
  if not found then raise exception 'Potansiyel müşteri bulunamadı.'; end if;
  if l.archived_at is not null then raise exception 'Arşivdeki potansiyel müşteri dönüştürülemez.'; end if;
  if l.converted_company_id is not null then raise exception 'Bu potansiyel müşteri zaten firmaya dönüştürülmüş.'; end if;

  insert into companies(organization_id, name, tax_no, sector, city, district, address, phone, email, website,
                        current_provider, customer_status, responsible_user, notes)
  values (l.organization_id, l.name, l.tax_no, l.sector, l.city, l.district, l.address, l.phone, l.email, l.website,
          l.current_provider, 'musteri', l.sales_owner, l.notes)
  returning * into c;

  if l.employee_count is not null and l.hazard_class is not null then
    insert into company_profiles(organization_id, company_id, employee_count, hazard_class, valid_from, note)
    values (l.organization_id, c.id, l.employee_count, l.hazard_class, current_date, 'Potansiyel müşteriden aktarıldı');
  end if;

  -- Yetkili kişi: potansiyel kaydında adı varsa ve bağlı kişi yoksa kişi kartı oluşturulur
  if l.contact_name is not null and not exists (select 1 from contacts where lead_id = l.id and archived_at is null) then
    insert into contacts(organization_id, company_id, lead_id, full_name, title, is_decision_maker)
    values (l.organization_id, c.id, l.id, l.contact_name, l.contact_title, false);
  end if;
  update contacts set company_id = c.id where lead_id = l.id and company_id is null;

  update sales_opportunities set company_id = c.id where lead_id = l.id and company_id is null;
  update sales_opportunities set stage = 'kazanildi'
   where lead_id = l.id and archived_at is null and stage not in ('kazanildi', 'kaybedildi', 'ertelendi');

  update activities set company_id = c.id where lead_id = l.id and company_id is null;
  update tasks set company_id = c.id where lead_id = l.id and company_id is null;

  update leads set converted_company_id = c.id where id = l.id;
  return c;
end $$;

-- ---------------------------------------------------------------------
-- Yetkiler: yalnızca oturum açmış kullanıcılar
-- ---------------------------------------------------------------------
revoke all on function public.potansiyel_olustur(jsonb) from public, anon;
revoke all on function public.potansiyel_firmaya_donustur(uuid) from public, anon;
grant execute on function public.potansiyel_olustur(jsonb) to authenticated;
grant execute on function public.potansiyel_firmaya_donustur(uuid) to authenticated;
