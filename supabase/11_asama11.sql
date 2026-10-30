-- OSGB 360 - Aşama 11: denetim kaydı ekranı ve yedekleme desteği. Güvenle yeniden çalıştırılabilir.
-- Tablo yapısı değişmez; yalnızca (1) denetim kaydının okuma izni modüle göre daraltılır, (2) indeksler eklenir,
-- (3) "yedek alındı" kaydı için tek bir fonksiyon eklenir.

-- 1) Denetim kaydı satırının hangi yetki modülüne ait olduğu (maaş kayıtları gibi hassas veriler için)
create or replace function app.audit_modul(p_table text) returns text
language sql immutable as $$
  select coalesce((jsonb_build_object(
    'settings','settings','service_time_rules','settings','expense_categories','settings','allocation_rules','settings',
    'companies','companies','company_profiles','companies','contacts','contacts','leads','crm',
    'sales_opportunities','opportunities','opportunity_stage_history','opportunities','activities','contacts',
    'tasks','tasks','employees','staff','employee_costs','payroll','assignments','assignments','time_entries','time',
    'offers','offers','offer_items','offers','contracts','contracts','contract_prices','contracts',
    'invoices','invoices','invoice_items','invoices','payments','invoices',
    'expenses','expenses','overhead_allocations','company_profit',
    'attachments','companies','notifications','tasks','outbound_messages','crm') ->> p_table), 'users');
$$;

-- 2) Denetim kaydını okumak için "Kullanıcılar" görüntüleme izni VE ilgili modülün görüntüleme izni gerekir.
--    (Önceden yalnızca ilki yeterliydi; yetkisi devredilen biri maaş değişikliklerini de görebilirdi.)
drop policy if exists audit_sel on audit_logs;
create policy audit_sel on audit_logs for select to authenticated
  using (organization_id = app.org_id() and app.can('users','view')
         and (app.audit_modul(table_name) = 'users' or app.can(app.audit_modul(table_name), 'view')));

create index if not exists audit_logs_org_zaman_idx on audit_logs (organization_id, created_at desc);
create index if not exists audit_logs_kayit_idx on audit_logs (table_name, record_id);

-- 3) Tam yedek yalnızca TÜM modülleri görebilen kullanıcı için anlamlıdır (aksi halde eksik veri içerir).
create or replace function app.tam_yetkili() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((
    select count(*) = 21 and bool_and(rp.can_view)
    from public.users u
    join public.role_permissions rp on rp.role_id = u.role_id
    where u.id = auth.uid() and u.is_active
      and rp.module in ('dashboard','crm','companies','contacts','opportunities','offers','contracts','staff','assignments','time',
        'invoices','expenses','payroll','staff_profit','company_profit','capacity','reports','tasks','import_export','users','settings')
  ), false)
$$;

-- 4) Yedek alındığını denetim kaydına yazar (içerik değil, yalnızca sayılar). Tarayıcıdan yazma yolu yalnızca budur.
create or replace function public.yedek_kaydi(p_tablo_sayisi integer, p_satir_sayisi integer, p_dosya text default null)
returns bigint language plpgsql security definer set search_path = public as $$
declare v_id bigint;
begin
  if auth.uid() is null or not app.tam_yetkili() then
    raise exception 'Yedek almak için tüm modülleri görüntüleme yetkisi gerekir.';
  end if;
  if p_tablo_sayisi is null or p_tablo_sayisi < 1 or p_tablo_sayisi > 100 or p_satir_sayisi is null or p_satir_sayisi < 0 then
    raise exception 'Geçersiz yedek bilgisi.';
  end if;
  insert into audit_logs(organization_id, table_name, record_id, action, new_data, user_id)
  values (app.org_id(), 'yedek', null, 'BACKUP',
          jsonb_build_object('tablo_sayisi', p_tablo_sayisi, 'satir_sayisi', p_satir_sayisi, 'dosya', left(p_dosya, 120)), auth.uid())
  returning id into v_id;
  return v_id;
end $$;
revoke all on function public.yedek_kaydi(integer, integer, text) from public, anon;
grant execute on function public.yedek_kaydi(integer, integer, text) to authenticated;
revoke all on function app.tam_yetkili() from public, anon;
grant execute on function app.tam_yetkili() to authenticated;
