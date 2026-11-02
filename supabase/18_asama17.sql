-- =====================================================================
-- OSGB 360 - Aşama 17: Aylık gelir (fatura) Excel aktarımı, spot / elden gelir
--   * invoices.income_kind : fatura | spot | elden   (elden = KDV yok, nakit)
--   * invoices.site_id     : fatura belirli bir işyerine kesildiyse (ör. UKEM)
--   * invoice_aliases      : faturadaki ad -> firma eşleşmesi (bir kez onaylanınca hatırlanır)
--   * gelir_aktar(paket)   : onaylanan Excel satırlarını tek işlemde faturaya çevirir (hepsi ya da hiçbiri)
--   * gelir_kalemi_ekle    : elle spot iş / elden ödeme girişi
-- Güvenle yeniden çalıştırılabilir. Önce 01..17 çalışmış olmalıdır.
-- =====================================================================

alter table invoices add column if not exists income_kind text not null default 'fatura';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'invoices_income_kind_chk') then
    alter table invoices add constraint invoices_income_kind_chk check (income_kind in ('fatura','spot','elden'));
  end if;
end $$;
alter table invoices add column if not exists site_id uuid references company_sites(id);
create index if not exists invoices_site_idx on invoices (site_id) where site_id is not null;

create table if not exists invoice_aliases (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null default app.org_id() references organizations(id),
  alias_key        text not null check (char_length(alias_key) between 1 and 200),
  alias_text       text not null,
  company_id       uuid not null references companies(id),
  site_id          uuid references company_sites(id),
  created_at       timestamptz not null default now(),
  unique (organization_id, alias_key)
);
alter table invoice_aliases enable row level security;
drop policy if exists invoice_aliases_sel on invoice_aliases;
create policy invoice_aliases_sel on invoice_aliases for select to authenticated
  using (organization_id = app.org_id() and app.can('invoices', 'view'));
drop policy if exists invoice_aliases_ins on invoice_aliases;
create policy invoice_aliases_ins on invoice_aliases for insert to authenticated
  with check (organization_id = app.org_id() and app.can('invoices', 'create'));
drop policy if exists invoice_aliases_upd on invoice_aliases;
create policy invoice_aliases_upd on invoice_aliases for update to authenticated
  using (organization_id = app.org_id() and app.can('invoices', 'create'))
  with check (organization_id = app.org_id() and app.can('invoices', 'create'));
revoke all on invoice_aliases from anon, authenticated;
grant select, insert, update on invoice_aliases to authenticated;

-- Excel aktarımı. Paket:
-- { dosya, vade_gun, yeni_firmalar:[{anahtar, ad}],
--   faturalar:[{no, tarih, donem, aciklama, firma_id | yeni_firma, site_id, alias_key, alias_text,
--               kalemler:[{aciklama, haric, oran, kdv}]}] }
-- Aynı fatura numarası zaten varsa o satır atlanır (hata vermez). Her şey tek işlemde: bir hata olursa hiçbir şey yazılmaz.
create or replace function public.gelir_aktar(p_paket jsonb) returns jsonb
language plpgsql as $$
declare
  f jsonb; k jsonb; y jsonb; v_map jsonb := '{}'::jsonb; v_id uuid; v_firma uuid; inv invoices;
  v_vade integer; v_haric numeric; v_kdv numeric; v_eklenen integer := 0; v_yeni integer := 0;
  v_atlanan jsonb := '[]'::jsonb; v_idler jsonb := '[]'::jsonb; v_tarih date; v_no text;
begin
  if not (app.can('invoices', 'create') and app.can('import_export', 'create')) then
    raise exception 'Gelir aktarımı için fatura ekleme ve içe aktarma yetkisi gerekir.';
  end if;
  v_vade := coalesce((p_paket ->> 'vade_gun')::integer, 30);
  if v_vade < 0 or v_vade > 365 then raise exception 'Vade günü 0 ile 365 arasında olmalıdır.'; end if;
  if jsonb_typeof(p_paket -> 'faturalar') <> 'array' or jsonb_array_length(p_paket -> 'faturalar') = 0 then
    raise exception 'Aktarılacak fatura satırı yok.';
  end if;
  if jsonb_array_length(p_paket -> 'faturalar') > 2000 then raise exception 'Tek seferde en fazla 2000 satır aktarılabilir.'; end if;

  -- yeni firmalar
  for y in select * from jsonb_array_elements(coalesce(p_paket -> 'yeni_firmalar', '[]'::jsonb)) loop
    if not app.can('companies', 'create') then raise exception 'Yeni firma oluşturmak için firma ekleme yetkisi gerekir.'; end if;
    if nullif(btrim(y ->> 'ad'), '') is null then raise exception 'Yeni firma adı boş olamaz.'; end if;
    insert into companies(name, customer_status) values (btrim(y ->> 'ad'), 'musteri') returning id into v_id;
    v_map := v_map || jsonb_build_object(y ->> 'anahtar', v_id::text);
    v_yeni := v_yeni + 1;
  end loop;

  for f in select * from jsonb_array_elements(p_paket -> 'faturalar') loop
    v_no := nullif(btrim(coalesce(f ->> 'no', '')), '');
    v_tarih := (f ->> 'tarih')::date;
    if v_tarih is null then raise exception 'Fatura tarihi boş olamaz (%).', coalesce(v_no, '?'); end if;
    if nullif(f ->> 'firma_id', '') is not null then v_firma := (f ->> 'firma_id')::uuid;
    elsif nullif(f ->> 'yeni_firma', '') is not null then v_firma := (v_map ->> (f ->> 'yeni_firma'))::uuid;
    else v_firma := null; end if;
    if v_firma is null then raise exception 'Firma belirlenmemiş satır var (%).', coalesce(v_no, '?'); end if;
    if not exists (select 1 from companies where id = v_firma) then raise exception 'Firma bulunamadı (%).', coalesce(v_no, '?'); end if;
    if nullif(f ->> 'site_id', '') is not null
       and not exists (select 1 from company_sites s where s.id = (f ->> 'site_id')::uuid and s.company_id = v_firma) then
      raise exception 'İşyeri bu firmaya ait değil (%).', coalesce(v_no, '?');
    end if;

    if v_no is not null and exists (select 1 from invoices i where i.invoice_no = v_no and i.organization_id = app.org_id()) then
      v_atlanan := v_atlanan || jsonb_build_object('no', v_no, 'neden', 'Bu fatura numarası zaten kayıtlı');
      continue;
    end if;
    if jsonb_typeof(f -> 'kalemler') <> 'array' or jsonb_array_length(f -> 'kalemler') = 0 then
      raise exception 'Faturada kalem yok (%).', coalesce(v_no, '?');
    end if;
    v_haric := 0; v_kdv := 0;
    for k in select * from jsonb_array_elements(f -> 'kalemler') loop
      if (k ->> 'haric')::numeric < 0 or (k ->> 'kdv')::numeric < 0 or (k ->> 'oran')::numeric < 0 or (k ->> 'oran')::numeric > 100 then
        raise exception 'Geçersiz tutar veya KDV oranı (%).', coalesce(v_no, '?');
      end if;
      v_haric := v_haric + (k ->> 'haric')::numeric;
      v_kdv := v_kdv + (k ->> 'kdv')::numeric;
    end loop;
    if v_haric <= 0 then raise exception 'Fatura tutarı sıfırdan büyük olmalıdır (%).', coalesce(v_no, '?'); end if;

    insert into invoices(company_id, invoice_no, invoice_date, due_date, service_period, amount_excl_vat, vat_amount, notes, site_id, income_kind)
    values (v_firma, coalesce(v_no, ''), v_tarih, v_tarih + v_vade,
            case when nullif(f ->> 'donem', '') is null then null else date_trunc('month', (f ->> 'donem')::date)::date end,
            round(v_haric, 2), round(v_kdv, 2), nullif(btrim(coalesce(f ->> 'not', '')), ''),
            nullif(f ->> 'site_id', '')::uuid, 'fatura')
    returning * into inv;
    for k in select * from jsonb_array_elements(f -> 'kalemler') loop
      insert into invoice_items(invoice_id, description, quantity, unit_price_excl, vat_rate)
      values (inv.id, coalesce(nullif(btrim(k ->> 'aciklama'), ''), 'Hizmet bedeli'), 1, round((k ->> 'haric')::numeric, 2), (k ->> 'oran')::numeric);
    end loop;
    if nullif(f ->> 'alias_key', '') is not null then
      insert into invoice_aliases(alias_key, alias_text, company_id, site_id)
      values (f ->> 'alias_key', coalesce(f ->> 'alias_text', f ->> 'alias_key'), v_firma, nullif(f ->> 'site_id', '')::uuid)
      on conflict (organization_id, alias_key) do update set company_id = excluded.company_id, site_id = excluded.site_id, alias_text = excluded.alias_text;
    end if;
    v_eklenen := v_eklenen + 1;
    v_idler := v_idler || to_jsonb(inv.id);
  end loop;

  return jsonb_build_object('eklenen', v_eklenen, 'yeni_firma', v_yeni, 'atlanan', v_atlanan, 'fatura_idleri', v_idler);
end $$;

-- Elle gelir kalemi: spot iş (KDV oranı girilir) veya elden ödeme (KDV yok, tahsil edilmiş sayılabilir).
create or replace function public.gelir_kalemi_ekle(
  p_firma uuid, p_tur text, p_tarih date, p_aciklama text, p_tutar numeric,
  p_kdv_modu vat_mode default 'kdv_haric', p_kdv_orani numeric default 20, p_tahsil boolean default false, p_no text default null)
returns invoices
language plpgsql as $$
declare inv invoices; v_oran numeric; v_mod vat_mode;
begin
  if p_tur not in ('spot', 'elden') then raise exception 'Gelir türü spot veya elden olmalıdır.'; end if;
  if nullif(btrim(coalesce(p_aciklama, '')), '') is null then raise exception 'Gelir kaleminin ne olduğunu yazın.'; end if;
  if p_tur = 'elden' then v_oran := 0; v_mod := 'kdv_haric'; else v_oran := p_kdv_orani; v_mod := p_kdv_modu; end if;
  inv := public.fatura_kaydet(null, p_firma, null, p_no, p_tarih, p_tarih, date_trunc('month', p_tarih)::date,
                              p_tutar, v_mod, v_oran, btrim(p_aciklama), null);
  update invoices set income_kind = p_tur where id = inv.id returning * into inv;
  if coalesce(p_tahsil, false) then
    insert into payments(invoice_id, paid_at, amount, method, notes)
    values (inv.id, p_tarih, inv.amount_incl_vat, case when p_tur = 'elden' then 'Elden' else null end, 'Gelir girişi sırasında tahsil edildi');
  end if;
  return inv;
end $$;

revoke all on function public.gelir_aktar(jsonb) from public, anon;
grant execute on function public.gelir_aktar(jsonb) to authenticated;
revoke all on function public.gelir_kalemi_ekle(uuid, text, date, text, numeric, vat_mode, numeric, boolean, text) from public, anon;
grant execute on function public.gelir_kalemi_ekle(uuid, text, date, text, numeric, vat_mode, numeric, boolean, text) to authenticated;
