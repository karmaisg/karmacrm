-- =====================================================================
-- OSGB 360 - Aşama 19: aylık gider Excel'i aktarımı (her yükleme öncekinin yerine geçer)
--   * expense_categories.is_management_pay : "Yönetime ödenen" kategorisi = yönetim olarak işaretli uzman/hekim maliyeti.
--     Kârlılıkta ortak havuza ("Yönetim personeli") yazılır; o ay için personel kartı maliyetinin yerine geçer (çift sayım olmaz).
--   * expenses.import_id            : Excel'den gelen gider kaydı hangi yüklemeden geldi (elle girilenlerde boş)
--   * expense_imports               : yükleme geçmişi (dosya, aylar, özet)
--   * expense_row_map               : Excel satır adı -> kategori / yönetime ödenen / aktarma eşleşmesi (hatırlanır)
--   * gider_aktar(paket)            : tek işlemde; dosyadaki aylar için önceki Excel kayıtlarını ARŞİVE alır, yenilerini ekler
-- Personel maliyetleri (maaş/SGK) bu aktarıma girmez; personel kartındaki maliyet dönemlerinden gelir.
-- Güvenle yeniden çalıştırılabilir. Önce 01..19 çalışmış olmalıdır.
-- =====================================================================

alter table expense_categories add column if not exists is_management_pay boolean not null default false;
create unique index if not exists expense_categories_mgmt_uq on expense_categories (organization_id) where is_management_pay;

create table if not exists expense_imports (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null default app.org_id() references organizations(id),
  file_name        text,
  months           jsonb not null default '[]'::jsonb,
  row_count        integer not null default 0,
  archived_count   integer not null default 0,
  total_excl_vat   numeric(14,2) not null default 0,
  summary          jsonb not null default '{}'::jsonb,
  created_by       uuid default auth.uid(),
  created_at       timestamptz not null default now()
);
alter table expenses add column if not exists import_id uuid references expense_imports(id);
create index if not exists expenses_import_idx on expenses (import_id) where import_id is not null;

create table if not exists expense_row_map (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null default app.org_id() references organizations(id),
  row_key          text not null check (char_length(row_key) between 1 and 200),
  row_label        text not null,
  action           text not null check (action in ('kategori', 'yonetim', 'atla')),
  category_id      uuid references expense_categories(id),
  unique (organization_id, row_key),
  check ((action = 'kategori') = (category_id is not null))
);

alter table expense_imports enable row level security;
alter table expense_row_map enable row level security;
drop policy if exists expense_imports_sel on expense_imports;
create policy expense_imports_sel on expense_imports for select to authenticated
  using (organization_id = app.org_id() and app.can('expenses', 'view'));
drop policy if exists expense_imports_ins on expense_imports;
create policy expense_imports_ins on expense_imports for insert to authenticated
  with check (organization_id = app.org_id() and app.can('expenses', 'create'));
drop policy if exists expense_imports_upd on expense_imports;
create policy expense_imports_upd on expense_imports for update to authenticated
  using (organization_id = app.org_id() and app.can('expenses', 'create'))
  with check (organization_id = app.org_id() and app.can('expenses', 'create'));
drop policy if exists expense_row_map_sel on expense_row_map;
create policy expense_row_map_sel on expense_row_map for select to authenticated
  using (organization_id = app.org_id() and app.can('expenses', 'view'));
drop policy if exists expense_row_map_ins on expense_row_map;
create policy expense_row_map_ins on expense_row_map for insert to authenticated
  with check (organization_id = app.org_id() and app.can('expenses', 'create'));
drop policy if exists expense_row_map_upd on expense_row_map;
create policy expense_row_map_upd on expense_row_map for update to authenticated
  using (organization_id = app.org_id() and app.can('expenses', 'create'))
  with check (organization_id = app.org_id() and app.can('expenses', 'create'));
revoke all on expense_imports, expense_row_map from anon, authenticated;
grant select, insert, update on expense_imports to authenticated;
grant select, insert, update on expense_row_map to authenticated;

-- Paket:
-- { dosya, aylar:["2026-01-01",...], kdv_modu:"kdv_haric"|"kdv_dahil", kdv_orani,
--   satirlar:[{ anahtar, etiket, islem:"kategori"|"yonetim"|"atla", kategori_id | yeni_kategori:{ad,tur}, tutarlar:{"2026-01-01":123.45,...} }] }
-- Dosyadaki her ay için önceki Excel kayıtları arşive alınır (elle girilen giderlere dokunulmaz); yeni kayıtlar önce eklenir,
-- sonra eskiler arşivlenir (ortak gider dağıtım denetimi böylece yanlış tetiklenmez). Hata olursa hiçbir şey değişmez.
create or replace function public.gider_aktar(p_paket jsonb) returns jsonb
language plpgsql as $$
declare
  s jsonb; a text; v_imp uuid; v_aylar date[]; v_ay date; v_tutar numeric; k record;
  v_kat uuid; v_yon uuid; v_eklenen integer := 0; v_arsiv integer := 0; v_toplam numeric := 0; v_yeni_kat integer := 0;
  v_mod vat_mode; v_oran numeric; v_eski uuid[]; v_atlanan integer := 0; v_ad text; v_gun date; v_h numeric; v_k numeric;
begin
  if not (app.can('expenses', 'create') and app.can('import_export', 'create')) then
    raise exception 'Gider aktarımı için gider ekleme ve içe aktarma yetkisi gerekir.';
  end if;
  if not app.can('expenses', 'archive') then raise exception 'Önceki aktarımın yerine geçmek için gider arşivleme yetkisi gerekir.'; end if;
  if jsonb_typeof(p_paket -> 'aylar') <> 'array' or jsonb_array_length(p_paket -> 'aylar') = 0 then raise exception 'Dosyada ay sütunu yok.'; end if;
  if jsonb_array_length(p_paket -> 'aylar') > 60 then raise exception 'En çok 60 ay aktarılabilir.'; end if;
  if jsonb_typeof(p_paket -> 'satirlar') <> 'array' then raise exception 'Gider satırı yok.'; end if;
  v_mod := coalesce(p_paket ->> 'kdv_modu', 'kdv_haric')::vat_mode;
  v_oran := coalesce((p_paket ->> 'kdv_orani')::numeric, 20);
  if v_oran < 0 or v_oran > 100 then raise exception 'KDV oranı 0 ile 100 arasında olmalıdır.'; end if;
  select array_agg(date_trunc('month', x::date)::date) into v_aylar from jsonb_array_elements_text(p_paket -> 'aylar') x;

  -- önceki Excel kayıtları (dosyadaki aylar için)
  select coalesce(array_agg(id), '{}') into v_eski from expenses
   where import_id is not null and archived_at is null and date_trunc('month', expense_date)::date = any (v_aylar);

  insert into expense_imports(file_name, months, summary) values (nullif(btrim(p_paket ->> 'dosya'), ''), p_paket -> 'aylar', '{}'::jsonb) returning id into v_imp;

  for s in select * from jsonb_array_elements(p_paket -> 'satirlar') loop
    a := s ->> 'islem'; v_ad := btrim(coalesce(s ->> 'etiket', ''));
    if a = 'atla' then
      insert into expense_row_map(row_key, row_label, action) values (s ->> 'anahtar', v_ad, 'atla')
        on conflict (organization_id, row_key) do update set action = 'atla', category_id = null, row_label = excluded.row_label;
      continue;
    end if;
    if a = 'yonetim' then
      select id into v_yon from expense_categories where is_management_pay;
      if v_yon is null then
        if not app.can('settings', 'create') then raise exception '"Yönetime ödenen" kategorisini oluşturmak için ayar yetkisi gerekir.'; end if;
        insert into expense_categories(name, nature, default_cost_type, is_payroll, is_income_tax, is_management_pay, sort_order)
        values ('Yönetime ödenen (yönetim personeli maliyeti)', 'isletme', 'ortak', false, false, true, 90) returning id into v_yon;
        v_yeni_kat := v_yeni_kat + 1;
      end if;
      v_kat := v_yon;
      insert into expense_row_map(row_key, row_label, action) values (s ->> 'anahtar', v_ad, 'yonetim')
        on conflict (organization_id, row_key) do update set action = 'yonetim', category_id = null, row_label = excluded.row_label;
    elsif a = 'kategori' then
      if nullif(s ->> 'kategori_id', '') is not null then
        v_kat := (s ->> 'kategori_id')::uuid;
        if not exists (select 1 from expense_categories where id = v_kat) then raise exception 'Kategori bulunamadı (%).', v_ad; end if;
        if exists (select 1 from expense_categories where id = v_kat and (is_payroll or is_management_pay)) then
          raise exception 'Maaş veya yönetim kategorisi bu satıra atanamaz (%).', v_ad;
        end if;
      elsif s -> 'yeni_kategori' is not null and nullif(btrim(s -> 'yeni_kategori' ->> 'ad'), '') is not null then
        if not app.can('settings', 'create') then raise exception 'Yeni gider kategorisi oluşturmak için ayar yetkisi gerekir (%).', v_ad; end if;
        select id into v_kat from expense_categories where lower(name) = lower(btrim(s -> 'yeni_kategori' ->> 'ad'));
        if v_kat is null then
          insert into expense_categories(name, nature, default_cost_type, is_payroll, is_income_tax, sort_order)
          values (btrim(s -> 'yeni_kategori' ->> 'ad'), case when s -> 'yeni_kategori' ->> 'tur' = 'vergi' then 'vergi' else 'isletme' end, 'ortak', false, s -> 'yeni_kategori' ->> 'tur' = 'vergi', 80)
          returning id into v_kat;
          v_yeni_kat := v_yeni_kat + 1;
        end if;
      else
        raise exception 'Satır için kategori seçilmemiş (%).', v_ad;
      end if;
      insert into expense_row_map(row_key, row_label, action, category_id) values (s ->> 'anahtar', v_ad, 'kategori', v_kat)
        on conflict (organization_id, row_key) do update set action = 'kategori', category_id = excluded.category_id, row_label = excluded.row_label;
    else
      raise exception 'Bilinmeyen işlem (%).', v_ad;
    end if;

    for k in select key, value from jsonb_each_text(coalesce(s -> 'tutarlar', '{}'::jsonb)) loop
      v_gun := date_trunc('month', k.key::date)::date;
      if not (v_gun = any (v_aylar)) then raise exception 'Satırdaki ay dosyadaki ay listesinde yok (%).', v_ad; end if;
      v_tutar := k.value::numeric;
      if v_tutar is null or v_tutar = 0 then continue; end if;
      if v_tutar < 0 then v_atlanan := v_atlanan + 1; continue; end if;
      if v_mod = 'kdv_dahil' then select haric, kdv into v_h, v_k from app.kdv_ayir(v_tutar, 'kdv_dahil', v_oran);
      else v_h := round(v_tutar, 2); v_k := 0; end if;
      insert into expenses(category_id, expense_date, amount_excl_vat, vat_amount, cost_type, paid, description, import_id)
      values (v_kat, v_gun, v_h, v_k, 'ortak', v_gun < date_trunc('month', app.today_tr())::date, 'Excel aktarımı: ' || v_ad, v_imp);
      v_eklenen := v_eklenen + 1; v_toplam := v_toplam + round(v_tutar, 2);
    end loop;
  end loop;

  -- eski Excel kayıtlarını arşive al (yeniler eklendikten sonra)
  update expenses set archived_at = now() where id = any (v_eski) and archived_at is null;
  get diagnostics v_arsiv = row_count;

  update expense_imports set row_count = v_eklenen, archived_count = v_arsiv, total_excl_vat = v_toplam,
         summary = jsonb_build_object('yeni_kategori', v_yeni_kat, 'negatif_atlanan', v_atlanan)
   where id = v_imp;
  return jsonb_build_object('import_id', v_imp, 'eklenen', v_eklenen, 'arsivlenen', v_arsiv, 'yeni_kategori', v_yeni_kat, 'negatif_atlanan', v_atlanan);
end $$;

revoke all on function public.gider_aktar(jsonb) from public, anon;
grant execute on function public.gider_aktar(jsonb) to authenticated;
