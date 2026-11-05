-- OSGB 360 - Aşama 22: firma dışı spot işler (yalnızca adıyla girilir)
--   * invoices.company_id artık boş olabilir (firma dışı spot iş / elden ödeme); işin adı faturanın kalem açıklamasındadır
--   * invoices.customer_name : isteğe bağlı müşteri/kişi adı
--   * gelir_kalemi_ekle : firma seçilmeden de çağrılabilir
-- Yeniden çalıştırılabilir.

alter table invoices alter column company_id drop not null;
alter table invoices add column if not exists customer_name text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'invoices_customer_name_len') then
    alter table invoices add constraint invoices_customer_name_len check (customer_name is null or char_length(customer_name) <= 200);
  end if;
  -- firması olmayan fatura yalnızca spot/elden gelir olabilir
  if not exists (select 1 from pg_constraint where conname = 'invoices_company_required_chk') then
    alter table invoices add constraint invoices_company_required_chk check (company_id is not null or income_kind in ('spot','elden'));
  end if;
end $$;

drop function if exists public.gelir_kalemi_ekle(uuid, text, date, text, numeric, vat_mode, numeric, boolean, text);

create or replace function public.gelir_kalemi_ekle(
  p_firma uuid, p_tur text, p_tarih date, p_aciklama text, p_tutar numeric,
  p_kdv_modu vat_mode default 'kdv_haric', p_kdv_orani numeric default 20, p_tahsil boolean default false, p_no text default null,
  p_musteri text default null)
returns invoices
language plpgsql as $$
declare inv invoices; v_oran numeric; v_mod vat_mode; k record; v_acik text;
begin
  if p_tur not in ('spot', 'elden') then raise exception 'Gelir türü spot veya elden olmalıdır.'; end if;
  v_acik := nullif(btrim(coalesce(p_aciklama, '')), '');
  if v_acik is null then raise exception 'Gelir kaleminin ne olduğunu yazın.'; end if;
  if p_tur = 'elden' then v_oran := 0; v_mod := 'kdv_haric'; else v_oran := p_kdv_orani; v_mod := p_kdv_modu; end if;
  if p_firma is not null then
    inv := public.fatura_kaydet(null, p_firma, null, p_no, p_tarih, p_tarih, date_trunc('month', p_tarih)::date,
                                p_tutar, v_mod, v_oran, v_acik, null);
  else
    if not app.can('invoices', 'create') then raise exception 'Fatura ekleme yetkiniz yok.'; end if;
    if p_tarih is null then raise exception 'Tarih zorunludur.'; end if;
    if not (coalesce(p_tutar, 0) > 0) then raise exception 'Tutar sıfırdan büyük olmalıdır.'; end if;
    select * into k from app.kdv_ayir(p_tutar, v_mod, v_oran);
    insert into invoices(company_id, invoice_no, invoice_date, due_date, service_period, amount_excl_vat, vat_amount, income_kind, notes)
    values (null, coalesce(p_no, ''), p_tarih, p_tarih, date_trunc('month', p_tarih)::date, k.haric, k.kdv, p_tur, v_acik)
    returning * into inv;
    insert into invoice_items(invoice_id, description, quantity, unit_price_excl, vat_rate) values (inv.id, v_acik, 1, k.haric, v_oran);
  end if;
  update invoices set income_kind = p_tur, customer_name = nullif(btrim(coalesce(p_musteri, '')), '') where id = inv.id returning * into inv;
  if coalesce(p_tahsil, false) then
    insert into payments(invoice_id, paid_at, amount, method, notes)
    values (inv.id, p_tarih, inv.amount_incl_vat, case when p_tur = 'elden' then 'Elden' else null end, 'Gelir girişi sırasında tahsil edildi');
  end if;
  return inv;
end $$;

revoke all on function public.gelir_kalemi_ekle(uuid, text, date, text, numeric, vat_mode, numeric, boolean, text, text) from public, anon;
grant execute on function public.gelir_kalemi_ekle(uuid, text, date, text, numeric, vat_mode, numeric, boolean, text, text) to authenticated;
