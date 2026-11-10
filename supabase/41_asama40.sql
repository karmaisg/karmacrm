-- Aşama 40: Teklif PDF'i — kullanıcı teklifin .pdf dosyasını yükler; müşteri bağlantısından "Teklif Detayı Gör" ile indirir,
-- yönetici tarafında Yazdır / PDF düğmesiyle yazdırılır. Dosya veritabanında saklanır (müşteri girişsiz erişebilsin diye
-- yalnızca token doğrulayan güvenli fonksiyon üzerinden). Tekrar çalıştırılabilir.

create table if not exists offer_pdfs (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null default app.org_id() references organizations(id),
  offer_id        uuid not null references offers(id),
  file_name       text not null check (char_length(file_name) between 5 and 200),
  size_bytes      integer not null check (size_bytes between 1 and 3145728),
  content         bytea not null,
  uploaded_by     uuid default auth.uid(),
  created_at      timestamptz not null default now(),
  archived_at     timestamptz,
  archived_by     uuid
);
create unique index if not exists offer_pdfs_aktif_uq on offer_pdfs (offer_id) where archived_at is null;
create index if not exists offer_pdfs_org_idx on offer_pdfs (organization_id);

alter table offer_pdfs enable row level security;
revoke all on offer_pdfs from anon, authenticated;
-- içerik (content) sütunu doğrudan okunamaz; yalnızca fonksiyonlarla alınır
grant select (id, organization_id, offer_id, file_name, size_bytes, uploaded_by, created_at, archived_at) on offer_pdfs to authenticated;
drop policy if exists offer_pdfs_sel on offer_pdfs;
create policy offer_pdfs_sel on offer_pdfs for select to authenticated
  using (organization_id = app.org_id() and app.can('offers', 'view'));

-- Yükle (varsa önceki dosya arşive alınır)
create or replace function public.teklif_pdf_yukle(p_offer uuid, p_ad text, p_veri text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare o offers; v_ad text; v_bayt bytea; v_id uuid;
begin
  if auth.uid() is null or not app.can('offers', 'edit') then raise exception 'Teklifi düzenleme yetkiniz yok.'; end if;
  select * into o from offers where id = p_offer and organization_id = app.org_id() and archived_at is null;
  if not found then raise exception 'Teklif bulunamadı.'; end if;
  v_ad := btrim(regexp_replace(coalesce(p_ad, ''), '[\\/]', '_', 'g'));
  if v_ad !~* '\.pdf$' or char_length(v_ad) > 200 then raise exception 'Dosya adı .pdf ile bitmelidir (en çok 200 karakter).'; end if;
  begin
    v_bayt := decode(coalesce(p_veri, ''), 'base64');
  exception when others then raise exception 'Dosya okunamadı. Lütfen geçerli bir PDF seçin.';
  end;
  if v_bayt is null or length(v_bayt) < 8 then raise exception 'Dosya boş görünüyor.'; end if;
  if length(v_bayt) > 3145728 then raise exception 'PDF en çok 3 MB olabilir.'; end if;
  if substring(v_bayt from 1 for 5) <> '\x255044462d'::bytea then raise exception 'Bu dosya geçerli bir PDF değil.'; end if;
  update offer_pdfs set archived_at = now(), archived_by = auth.uid() where offer_id = o.id and archived_at is null;
  insert into offer_pdfs(organization_id, offer_id, file_name, size_bytes, content)
  values (o.organization_id, o.id, v_ad, length(v_bayt), v_bayt) returning id into v_id;
  insert into audit_logs(organization_id, table_name, record_id, action, old_data, new_data, user_id)
  values (o.organization_id, 'offer_pdfs', v_id::text, 'INSERT', null,
          jsonb_build_object('id', v_id, 'organization_id', o.organization_id, 'offer_id', o.id, 'file_name', v_ad, 'size_bytes', length(v_bayt)), auth.uid());
  return jsonb_build_object('id', v_id, 'ad', v_ad, 'boyut', length(v_bayt));
end $$;

-- Kaldır (arşivler; müşteri bağlantısında düğme kaybolur)
create or replace function public.teklif_pdf_kaldir(p_offer uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare n integer; v_org uuid;
begin
  if auth.uid() is null or not app.can('offers', 'edit') then raise exception 'Teklifi düzenleme yetkiniz yok.'; end if;
  select organization_id into v_org from offers where id = p_offer and organization_id = app.org_id();
  if v_org is null then raise exception 'Teklif bulunamadı.'; end if;
  update offer_pdfs set archived_at = now(), archived_by = auth.uid() where offer_id = p_offer and archived_at is null;
  get diagnostics n = row_count;
  if n > 0 then
    insert into audit_logs(organization_id, table_name, record_id, action, old_data, new_data, user_id)
    values (v_org, 'offer_pdfs', p_offer::text, 'UPDATE', jsonb_build_object('offer_id', p_offer, 'archived_at', null),
            jsonb_build_object('offer_id', p_offer, 'archived_at', now()), auth.uid());
  end if;
  return n;
end $$;

-- Yönetici tarafı: dosyayı getir (yazdırma / indirme)
create or replace function public.teklif_pdf_getir(p_offer uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare f offer_pdfs;
begin
  if auth.uid() is null or not app.can('offers', 'view') then raise exception 'Teklifleri görüntüleme yetkiniz yok.'; end if;
  select f2.* into f from offer_pdfs f2 join offers o on o.id = f2.offer_id
   where f2.offer_id = p_offer and f2.archived_at is null and o.organization_id = app.org_id();
  if not found then return null; end if;
  return jsonb_build_object('ad', f.file_name, 'boyut', f.size_bytes, 'veri', replace(encode(f.content, 'base64'), E'\n', ''));
end $$;

-- Müşteri tarafı (giriş yok): bağlantı geçerliyse bilgi (p_veri=false) veya dosya (p_veri=true)
create or replace function public.teklif_paylasim_pdf(p_token text, p_veri boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s offer_shares; f offer_pdfs;
begin
  s := app.paylasim_bul(p_token);
  if s.id is null then return jsonb_build_object('durum', 'gecersiz'); end if;
  select * into f from offer_pdfs where offer_id = s.offer_id and archived_at is null;
  if not found then return jsonb_build_object('durum', 'yok'); end if;
  return jsonb_build_object('durum', 'var', 'ad', f.file_name, 'boyut', f.size_bytes)
         || case when coalesce(p_veri, false) then jsonb_build_object('veri', replace(encode(f.content, 'base64'), E'\n', '')) else '{}'::jsonb end;
end $$;

revoke all on function public.teklif_pdf_yukle(uuid, text, text) from public, anon;
revoke all on function public.teklif_pdf_kaldir(uuid) from public, anon;
revoke all on function public.teklif_pdf_getir(uuid) from public, anon;
revoke all on function public.teklif_paylasim_pdf(text, boolean) from public;
grant execute on function public.teklif_pdf_yukle(uuid, text, text) to authenticated;
grant execute on function public.teklif_pdf_kaldir(uuid) to authenticated;
grant execute on function public.teklif_pdf_getir(uuid) to authenticated;
grant execute on function public.teklif_paylasim_pdf(text, boolean) to anon, authenticated;

-- Denetim ekranı: offer_pdfs kayıtları "teklifler" modülünde görünür
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
    'signed_contracts','contracts','budget_lines','budget','budget_expense_lines','budget','budget_personnel_lines','budget','salary_calcs','payroll','offer_pdfs','offers') ->> p_table), 'users');
$$;
