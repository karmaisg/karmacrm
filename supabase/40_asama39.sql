-- Aşama 39: İSG teklifi Word çıktısı — teklifte isteğe bağlı sözleşme bitiş tarihi. Tekrar çalıştırılabilir.
alter table offers add column if not exists contract_end_date date;
comment on column offers.contract_end_date is 'Sözleşme bitiş tarihi (isteğe bağlı); Word teklifinde "Sözleşme ... tarihine kadar yapılacak" cümlesi için';

-- Teklif kopyalanınca sözleşme bitiş tarihi de taşınır
create or replace function public.teklif_kopyala(p_offer uuid)
returns offers
language plpgsql as $$
declare o offers; n offers;
begin
  if not app.can('offers', 'create') then raise exception 'Teklif ekleme yetkiniz yok.'; end if;
  select * into o from offers where id = p_offer;
  if not found then raise exception 'Teklif bulunamadı.'; end if;
  insert into offers(company_id, lead_id, opportunity_id, employee_count, hazard_class, pricing, unit_price, fixed_monthly_price,
                     vat_mode, vat_rate, discount_pct, est_expert_cost, est_physician_cost, est_travel_other_cost, description,
                     offer_type, service_fee, scope, contract_end_date)
  values (o.company_id, o.lead_id, o.opportunity_id, o.employee_count, o.hazard_class, o.pricing, o.unit_price, o.fixed_monthly_price,
          o.vat_mode, o.vat_rate, o.discount_pct, o.est_expert_cost, o.est_physician_cost, o.est_travel_other_cost, o.description,
          o.offer_type, o.service_fee, o.scope, o.contract_end_date)
  returning * into n;
  insert into offer_items(offer_id, description, quantity, unit_price, vat_mode, vat_rate)
  select n.id, description, quantity, unit_price, vat_mode, vat_rate from offer_items where offer_id = o.id and archived_at is null;
  return n;
end $$;
