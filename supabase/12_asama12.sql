-- OSGB 360 - Aşama 12: müşteriye teklif bağlantısı (giriş gerektirmeyen, gizli, süreli) ve müşteri yanıtı.
-- Güvenlik tasarımı:
--   * Bağlantı anahtarı (64 onaltılık karakter, ~244 bit rastgelelik) YALNIZCA oluşturulurken bir kez gösterilir; veri tabanında yalnızca SHA-256 özeti tutulur.
--   * Girişsiz (anon) kullanıcı tabloya DOKUNAMAZ; yalnızca iki fonksiyonu çağırabilir ve fonksiyonlar sadece izin verilen alanları döndürür
--     (maliyet tahmini, kâr, iç açıklama, hazırlayan kişi gibi iç bilgiler asla döndürülmez).
--   * Geçersiz / süresi dolmuş / iptal edilmiş bağlantılar birbirinden ayırt edilemez (tek yanıt: "geçersiz").
-- Güvenle yeniden çalıştırılabilir.

create table if not exists offer_shares (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null default app.org_id() references organizations(id),
  offer_id         uuid not null references offers(id),
  token_hash       text not null unique,
  customer_note    text check (customer_note is null or char_length(customer_note) <= 1000),
  expires_at       timestamptz not null,
  revoked_at       timestamptz,
  created_by       uuid default auth.uid(),
  created_at       timestamptz not null default now(),
  first_viewed_at  timestamptz,
  last_viewed_at   timestamptz,
  view_count       integer not null default 0,
  response         text check (response in ('kabul','red')),
  responded_at     timestamptz,
  responder_name   text check (responder_name is null or char_length(responder_name) between 2 and 80),
  responder_note   text check (responder_note is null or char_length(responder_note) <= 500),
  check ((response is null) = (responded_at is null))
);
create index if not exists offer_shares_offer_idx on offer_shares (offer_id, created_at desc);
-- Bir teklif için iptal edilmemiş en çok bir bağlantı
create unique index if not exists offer_shares_aktif_uq on offer_shares (offer_id) where revoked_at is null;

drop trigger if exists trg_offer_shares_org on offer_shares;
create trigger trg_offer_shares_org before insert or update on offer_shares
  for each row execute function app.check_same_org('offers:offer_id');

alter table offer_shares enable row level security;
drop policy if exists offer_shares_sel on offer_shares;
create policy offer_shares_sel on offer_shares for select to authenticated
  using (organization_id = app.org_id() and app.can('offers', 'view'));

-- Tabloya doğrudan erişim: girişsiz hiç; girişli yalnızca okuma ve token_hash sütunu hariç
revoke all on offer_shares from anon, authenticated;
grant select (id, organization_id, offer_id, customer_note, expires_at, revoked_at, created_by, created_at,
              first_viewed_at, last_viewed_at, view_count, response, responded_at, responder_name, responder_note)
  on offer_shares to authenticated;

-- Denetim: bağlantı özeti (token_hash) denetim kaydına yazılmaz
create or replace function app.audit_offer_shares() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into audit_logs(organization_id, table_name, record_id, action, old_data, new_data, user_id)
  values (new.organization_id, 'offer_shares', new.id::text, tg_op,
          case when tg_op = 'UPDATE' then to_jsonb(old) - 'token_hash' end, to_jsonb(new) - 'token_hash', auth.uid());
  return new;
end $$;
drop trigger if exists trg_offer_shares_audit on offer_shares;
create trigger trg_offer_shares_audit after insert or update on offer_shares
  for each row execute function app.audit_offer_shares();

-- Denetim ekranı eşlemesine yeni tablo (Aşama 11 fonksiyonunun tamamı; yalnızca offer_shares eklendi)
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
    'attachments','companies','notifications','tasks','outbound_messages','crm') ->> p_table), 'users');
$$;

-- ---------------------------------------------------------------------
-- Sahip tarafı: bağlantı oluştur / iptal et (giriş + "Teklifler" düzenleme izni gerekir)
-- ---------------------------------------------------------------------
create or replace function public.teklif_baglantisi_olustur(p_offer uuid, p_gun integer default 30, p_not text default null)
returns text language plpgsql security definer set search_path = public as $$
declare o offers; v_token text; v_not text;
begin
  if auth.uid() is null or not app.can('offers', 'edit') then raise exception 'Teklifi düzenleme yetkiniz yok.'; end if;
  select * into o from offers where id = p_offer and organization_id = app.org_id() and archived_at is null;
  if not found then raise exception 'Teklif bulunamadı.'; end if;
  if o.status not in ('gonderildi', 'gorusuluyor') then
    raise exception 'Müşteri bağlantısı yalnızca "Gönderildi" veya "Görüşülüyor" durumundaki teklif için oluşturulabilir. Önce teklifi müşteriye gönderildi olarak işaretleyin.';
  end if;
  if p_gun is null or p_gun < 1 or p_gun > 90 then raise exception 'Bağlantı süresi 1 ile 90 gün arasında olmalıdır.'; end if;
  v_not := nullif(btrim(coalesce(p_not, '')), '');
  if v_not is not null and char_length(v_not) > 1000 then raise exception 'Müşteri notu en çok 1000 karakter olabilir.'; end if;

  v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  update offer_shares set revoked_at = now() where offer_id = o.id and revoked_at is null;
  insert into offer_shares(organization_id, offer_id, token_hash, customer_note, expires_at)
  values (o.organization_id, o.id, encode(sha256(convert_to(v_token, 'UTF8')), 'hex'), v_not, now() + make_interval(days => p_gun));
  return v_token;
end $$;

create or replace function public.teklif_baglantisi_iptal(p_offer uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if auth.uid() is null or not app.can('offers', 'edit') then raise exception 'Teklifi düzenleme yetkiniz yok.'; end if;
  if not exists (select 1 from offers where id = p_offer and organization_id = app.org_id()) then raise exception 'Teklif bulunamadı.'; end if;
  update offer_shares set revoked_at = now() where offer_id = p_offer and organization_id = app.org_id() and revoked_at is null;
  get diagnostics n = row_count;
  return n;
end $$;

-- ---------------------------------------------------------------------
-- Müşteri tarafı (girişsiz): görüntüle ve yanıtla
-- ---------------------------------------------------------------------
create or replace function app.paylasim_bul(p_token text, p_kilitle boolean default false)
returns offer_shares language plpgsql security definer set search_path = public as $$
declare s offer_shares;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then return null; end if;
  if p_kilitle then
    select sh.* into s from offer_shares sh join offers o on o.id = sh.offer_id
     where sh.token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex') and sh.revoked_at is null and sh.expires_at > now()
       and o.archived_at is null and o.status not in ('taslak', 'onay_bekliyor') for update of sh;
  else
    select sh.* into s from offer_shares sh join offers o on o.id = sh.offer_id
     where sh.token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex') and sh.revoked_at is null and sh.expires_at > now()
       and o.archived_at is null and o.status not in ('taslak', 'onay_bekliyor');
  end if;
  if not found then return null; end if;
  return s;
end $$;

create or replace function public.teklif_paylasim_goruntule(p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s offer_shares; o offers; v_alici text; v_kurum text; v_kalemler jsonb; v_bugun date := app.today_tr();
begin
  s := app.paylasim_bul(p_token);
  if s.id is null then return jsonb_build_object('durum', 'gecersiz'); end if;
  select * into o from offers where id = s.offer_id;
  select name into v_kurum from organizations where id = o.organization_id;
  select coalesce((select name from companies where id = o.company_id), (select name from leads where id = o.lead_id)) into v_alici;
  select coalesce(jsonb_agg(jsonb_build_object('aciklama', i.description, 'miktar', i.quantity, 'birim_fiyat', i.unit_price,
                                               'kdv_modu', i.vat_mode, 'kdv_orani', i.vat_rate) order by i.created_at), '[]'::jsonb)
    into v_kalemler from offer_items i where i.offer_id = o.id and i.archived_at is null;

  update offer_shares set view_count = view_count + 1, last_viewed_at = now(), first_viewed_at = coalesce(first_viewed_at, now()) where id = s.id;

  return jsonb_build_object(
    'durum', 'gecerli',
    'kurum', v_kurum, 'alici', v_alici, 'teklif_no', o.offer_no, 'teklif_tarihi', o.offer_date, 'gecerlilik', o.valid_until,
    'calisan_sayisi', o.employee_count, 'tehlike', o.hazard_class, 'fiyatlama', o.pricing,
    'birim_fiyat', o.unit_price, 'sabit_fiyat', o.fixed_monthly_price, 'kdv_modu', o.vat_mode, 'kdv_orani', o.vat_rate, 'indirim', o.discount_pct,
    'kalemler', v_kalemler, 'musteri_notu', s.customer_note,
    'teklif_durumu', case when o.status in ('kabul_edildi', 'reddedildi', 'suresi_doldu') then o.status::text else 'acik' end,
    'sure_bitti', (o.valid_until is not null and o.valid_until < v_bugun),
    'yanit', case when s.response is null then null else jsonb_build_object('karar', s.response, 'tarih', s.responded_at, 'ad', s.responder_name) end,
    'yanit_verilebilir', (s.response is null and o.status in ('gonderildi', 'gorusuluyor') and (o.valid_until is null or o.valid_until >= v_bugun))
  );
end $$;

create or replace function public.teklif_paylasim_yanitla(p_token text, p_karar text, p_ad text, p_not text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s offer_shares; o offers; v_ad text; v_not text; v_atanan uuid; v_baslik text; v_acik text;
begin
  s := app.paylasim_bul(p_token, true);
  if s.id is null then raise exception 'Bu bağlantı geçersiz ya da süresi dolmuş.'; end if;
  select * into o from offers where id = s.offer_id for update;
  if s.response is not null then raise exception 'Bu teklife zaten yanıt verilmiş. Değişiklik için lütfen bizimle iletişime geçin.'; end if;
  if o.status not in ('gonderildi', 'gorusuluyor') then raise exception 'Bu teklif artık yanıt kabul etmiyor. Lütfen bizimle iletişime geçin.'; end if;
  if o.valid_until is not null and o.valid_until < app.today_tr() then raise exception 'Teklifin geçerlilik süresi dolmuş. Lütfen bizimle iletişime geçin.'; end if;
  if p_karar is null or p_karar not in ('kabul', 'red') then raise exception 'Geçersiz yanıt.'; end if;
  v_ad := btrim(regexp_replace(coalesce(p_ad, ''), '[[:cntrl:]]+', ' ', 'g'));
  if char_length(v_ad) < 2 or char_length(v_ad) > 80 then raise exception 'Lütfen adınızı ve soyadınızı yazın (2-80 karakter).'; end if;
  v_not := nullif(btrim(regexp_replace(coalesce(p_not, ''), '[\x00-\x08\x0b\x0c\x0e-\x1f]', '', 'g')), '');
  if v_not is not null and char_length(v_not) > 500 then raise exception 'Notunuz en çok 500 karakter olabilir.'; end if;

  update offer_shares set response = p_karar, responded_at = now(), responder_name = v_ad, responder_note = v_not where id = s.id;

  select id into v_atanan from users where id = o.created_by and organization_id = o.organization_id and is_active;
  v_baslik := case when p_karar = 'kabul' then 'Müşteri teklifi KABUL ETTİ: ' else 'Müşteri teklifi reddetti: ' end || o.offer_no;
  v_acik := 'Yanıtlayan: ' || v_ad || case when v_not is not null then E'\nNot: ' || v_not else '' end ||
            case when p_karar = 'kabul' then E'\nSözleşmeyi oluşturmak için teklif sayfasından "Kabul edildi, sözleşme oluştur"u kullanın.'
                 else E'\nGerekirse müşteriyle görüşüp teklif durumunu güncelleyin.' end;
  insert into tasks(organization_id, kind, title, company_id, lead_id, assignee, priority, due_at, status, description, source_ref)
  values (o.organization_id, 'teklif_takibi', v_baslik, o.company_id, o.lead_id, v_atanan, 'yuksek', now(), 'acik', v_acik, 'offer_share:' || s.id::text)
  on conflict do nothing;
  return jsonb_build_object('ok', true, 'karar', p_karar);
end $$;

-- Yetkiler: iç yardımcı yalnızca fonksiyonların içinden; sahip fonksiyonları girişliye; müşteri fonksiyonları herkese
revoke all on function app.paylasim_bul(text, boolean) from public, anon, authenticated;
revoke all on function public.teklif_baglantisi_olustur(uuid, integer, text) from public, anon;
revoke all on function public.teklif_baglantisi_iptal(uuid) from public, anon;
grant execute on function public.teklif_baglantisi_olustur(uuid, integer, text) to authenticated;
grant execute on function public.teklif_baglantisi_iptal(uuid) to authenticated;
revoke all on function public.teklif_paylasim_goruntule(text) from public;
revoke all on function public.teklif_paylasim_yanitla(text, text, text, text) from public;
grant execute on function public.teklif_paylasim_goruntule(text) to anon, authenticated;
grant execute on function public.teklif_paylasim_yanitla(text, text, text, text) to anon, authenticated;

-- Supabase API'sinin yeni fonksiyonları hemen görmesi için
notify pgrst, 'reload schema';
