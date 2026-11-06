-- OSGB 360 - Aşama 26: firma bazında tahsilat (eski faturadan başlayarak otomatik dağıtım)
--   * payments.group_id : aynı firma tahsilatından doğan kayıtları bağlar (cari ekstrede tek ödeme satırı)
--   * firma_tahsilati_gir : tutarı, açık faturalara fatura tarihi eskiden yeniye doğru dağıtır; kalan açık bakiyeyi aşan tutarı reddeder
-- Yeniden çalıştırılabilir. Fatura düzenleme/tahsilat yetkisi (invoices.create) gerekir.

alter table payments add column if not exists group_id uuid;
create index if not exists payments_group_idx on payments(group_id) where group_id is not null;

create or replace function public.firma_tahsilati_gir(
  p_firma uuid, p_tarih date, p_tutar numeric, p_yontem text default null, p_not text default null)
returns jsonb
language plpgsql as $$
declare
  v_kalan numeric; v_grup uuid := gen_random_uuid(); r record; v_pay numeric; v_acik numeric; v_liste jsonb := '[]'::jsonb;
begin
  if not app.can('invoices', 'create') then raise exception 'Tahsilat girme yetkiniz yok.'; end if;
  if p_firma is null then raise exception 'Firma seçin.'; end if;
  if p_tarih is null then raise exception 'Tahsilat tarihi zorunludur.'; end if;
  if p_tarih > app.today_tr() then raise exception 'Tahsilat tarihi gelecekte olamaz.'; end if;
  if not (coalesce(p_tutar, 0) > 0) then raise exception 'Tutar sıfırdan büyük olmalıdır.'; end if;
  v_kalan := round(p_tutar, 2);
  select coalesce(sum(i.amount_incl_vat - coalesce((select sum(p.amount) from payments p where p.invoice_id = i.id and p.archived_at is null), 0)), 0)
    into v_acik
    from invoices i where i.company_id = p_firma and i.archived_at is null
     and i.amount_incl_vat - coalesce((select sum(p.amount) from payments p where p.invoice_id = i.id and p.archived_at is null), 0) > 0;
  if v_kalan > v_acik then
    raise exception 'Tutar firmanın açık bakiyesini aşıyor (açık bakiye: %).', to_char(v_acik, 'FM999G999G990D00');
  end if;
  for r in
    select i.id, i.invoice_no, i.amount_incl_vat,
           i.amount_incl_vat - coalesce((select sum(p.amount) from payments p where p.invoice_id = i.id and p.archived_at is null), 0) as acik
      from invoices i
     where i.company_id = p_firma and i.archived_at is null
     order by i.invoice_date, i.invoice_no, i.id
  loop
    exit when v_kalan <= 0;
    continue when r.acik <= 0;
    v_pay := least(r.acik, v_kalan);
    insert into payments(invoice_id, paid_at, amount, method, notes, group_id)
    values (r.id, p_tarih, v_pay, nullif(btrim(coalesce(p_yontem, '')), ''), nullif(btrim(coalesce(p_not, '')), ''), v_grup);
    v_liste := v_liste || jsonb_build_object('fatura_no', r.invoice_no, 'tutar', v_pay, 'kismi', v_pay < r.acik);
    v_kalan := v_kalan - v_pay;
  end loop;
  return jsonb_build_object('group_id', v_grup, 'dagitim', v_liste);
end $$;

revoke all on function public.firma_tahsilati_gir(uuid, date, numeric, text, text) from public, anon;
grant execute on function public.firma_tahsilati_gir(uuid, date, numeric, text, text) to authenticated;
