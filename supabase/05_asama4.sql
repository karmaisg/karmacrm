-- =====================================================================
-- OSGB 360 - Aşama 4 eki (teklifler ve sözleşmeler)
--
-- 01_sema.sql, 02_ilk_kurulum.sql, 03_asama2.sql ve 04_asama3.sql çalıştırıldıktan SONRA, BİR KEZ çalıştırılır.
-- Mevcut verilere dokunmaz; yalnızca fonksiyon, tetikleyici ve bir kısıt ekler / günceller. Tekrar çalıştırmak zarar vermez.
--
-- Eklenenler
--   1) Kurumlar arası bağlantı koruması: teklif, teklif kalemi, sözleşme, sözleşme fiyatı
--   2) Teklif: otomatik numara (TKL-2026-0001), doğrulama, durum geçiş kuralları,
--      gönderilen teklifin fiyat bilgilerinin kilitlenmesi, potansiyel müşteri firmaya dönünce tekliflerin firmaya bağlanması
--   3) Sözleşme: durum geçiş kuralları, aynı firmada çakışan aktif sözleşme engeli, sona eren sözleşmenin fiyat döneminin kapanması
--   4) Sözleşme fiyat geçmişi: eski fiyatlar değiştirilemez (yalnızca bitiş tarihi ve not)
--   5) teklif_kopyala, teklif_kabul_et, sozlesme_olustur, sozlesme_yenile, sozlesme_fiyat_ekle,
--      sozlesme_yenileme_gorevleri (90/60/30 gün uyarıları, aynı uyarıyı ikinci kez üretmez)
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Kurumlar arası bağlantı koruması
-- ---------------------------------------------------------------------
drop trigger if exists trg_offers_org on offers;
create trigger trg_offers_org before insert or update on offers
  for each row execute function app.check_same_org('companies:company_id', 'leads:lead_id', 'sales_opportunities:opportunity_id');

drop trigger if exists trg_offer_items_org on offer_items;
create trigger trg_offer_items_org before insert or update on offer_items
  for each row execute function app.check_same_org('offers:offer_id');

drop trigger if exists trg_contracts_org on contracts;
create trigger trg_contracts_org before insert or update on contracts
  for each row execute function app.check_same_org('companies:company_id', 'offers:offer_id', 'contracts:previous_contract_id', 'users:owner_user');

drop trigger if exists trg_contract_prices_org on contract_prices;
create trigger trg_contract_prices_org before insert or update on contract_prices
  for each row execute function app.check_same_org('contracts:contract_id');

-- ---------------------------------------------------------------------
-- 2. Teklif
-- ---------------------------------------------------------------------
create unique index if not exists offers_no_uq on offers(organization_id, offer_no) where offer_no is not null;

create or replace function app.offer_before_write() returns trigger
language plpgsql as $$
declare
  n integer;
  yil text;
  izinli boolean;
begin
  -- Doğrulama
  if new.pricing = 'kisi_basi' and (new.unit_price is null or new.unit_price < 0) then
    raise exception 'Kişi başı fiyatlamada birim fiyat zorunludur ve negatif olamaz.';
  end if;
  if new.pricing = 'sabit_aylik' and (new.fixed_monthly_price is null or new.fixed_monthly_price < 0) then
    raise exception 'Sabit aylık fiyatlamada aylık tutar zorunludur ve negatif olamaz.';
  end if;
  if new.pricing = 'ozel' and new.unit_price is null and new.fixed_monthly_price is null then
    raise exception 'Özel fiyatlamada birim fiyat veya aylık tutar girilmelidir.';
  end if;
  if new.vat_rate < 0 or new.vat_rate > 100 then
    raise exception 'KDV oranı 0 ile 100 arasında olmalıdır.';
  end if;
  if coalesce(new.est_expert_cost, 0) < 0 or coalesce(new.est_physician_cost, 0) < 0 or coalesce(new.est_travel_other_cost, 0) < 0 then
    raise exception 'Tahmini maliyetler negatif olamaz.';
  end if;
  if new.valid_until is not null and new.valid_until < new.offer_date then
    raise exception 'Geçerlilik tarihi teklif tarihinden önce olamaz.';
  end if;

  if tg_op = 'INSERT' then
    if new.status <> 'taslak' then
      raise exception 'Yeni teklif taslak olarak başlar.';
    end if;
    if new.offer_no is null then
      yil := to_char(new.offer_date, 'YYYY');
      perform pg_advisory_xact_lock(hashtext('offer_no:' || new.organization_id::text));
      select coalesce(max(substring(offer_no from '(\d+)$')::integer), 0) + 1 into n
        from offers where organization_id = new.organization_id and offer_no like 'TKL-' || yil || '-%';
      new.offer_no := 'TKL-' || yil || '-' || lpad(n::text, 4, '0');
    end if;
    return new;
  end if;

  -- Güncelleme
  if new.offer_no is distinct from old.offer_no then
    raise exception 'Teklif numarası değiştirilemez.';
  end if;

  if new.status is distinct from old.status then
    izinli := case old.status
      when 'taslak'        then new.status in ('onay_bekliyor', 'gonderildi')
      when 'onay_bekliyor' then new.status in ('taslak', 'gonderildi')
      when 'gonderildi'    then new.status in ('gorusuluyor', 'kabul_edildi', 'reddedildi', 'suresi_doldu')
      when 'gorusuluyor'   then new.status in ('gonderildi', 'kabul_edildi', 'reddedildi', 'suresi_doldu')
      when 'suresi_doldu'  then new.status in ('gonderildi', 'reddedildi')
      else false end;
    if not izinli then
      raise exception 'Geçersiz teklif durumu geçişi: % → %', old.status, new.status;
    end if;
  end if;

  -- Gönderilmiş teklifin ticari bilgileri değişmez; yeni sürüm için teklif kopyalanır
  if old.status not in ('taslak', 'onay_bekliyor') and (
       new.employee_count is distinct from old.employee_count or new.hazard_class is distinct from old.hazard_class
    or new.pricing is distinct from old.pricing or new.unit_price is distinct from old.unit_price
    or new.fixed_monthly_price is distinct from old.fixed_monthly_price or new.vat_mode is distinct from old.vat_mode
    or new.vat_rate is distinct from old.vat_rate or new.discount_pct is distinct from old.discount_pct
    or new.est_expert_cost is distinct from old.est_expert_cost or new.est_physician_cost is distinct from old.est_physician_cost
    or new.est_travel_other_cost is distinct from old.est_travel_other_cost or new.offer_date is distinct from old.offer_date) then
    raise exception 'Gönderilmiş teklifin fiyat bilgileri değiştirilemez. Teklifi kopyalayıp yeni sürüm hazırlayın.';
  end if;
  return new;
end $$;

drop trigger if exists trg_offers_write on offers;
create trigger trg_offers_write before insert or update on offers
  for each row execute function app.offer_before_write();

-- Teklif kalemleri yalnızca taslak teklifte değişir
create or replace function app.offer_item_guard() returns trigger
language plpgsql as $$
declare d offer_status;
begin
  select status into d from offers where id = new.offer_id;
  if d is not null and d not in ('taslak', 'onay_bekliyor') then
    raise exception 'Gönderilmiş teklifin kalemleri değiştirilemez.';
  end if;
  if new.quantity <= 0 then raise exception 'Miktar sıfırdan büyük olmalıdır.'; end if;
  if new.unit_price < 0 then raise exception 'Birim fiyat negatif olamaz.'; end if;
  return new;
end $$;

drop trigger if exists trg_offer_items_guard on offer_items;
create trigger trg_offer_items_guard before insert or update on offer_items
  for each row execute function app.offer_item_guard();

-- Potansiyel müşteri firmaya dönünce teklifleri firmaya bağlanır
create or replace function app.lead_converted_offers() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.converted_company_id is not null and old.converted_company_id is null then
    update offers set company_id = new.converted_company_id
     where lead_id = new.id and company_id is null and organization_id = new.organization_id;
  end if;
  return new;
end $$;

drop trigger if exists trg_leads_converted_offers on leads;
create trigger trg_leads_converted_offers after update of converted_company_id on leads
  for each row execute function app.lead_converted_offers();

-- ---------------------------------------------------------------------
-- 3. Sözleşme
-- ---------------------------------------------------------------------
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'contracts_aktif_cakisma') then
    alter table contracts add constraint contracts_aktif_cakisma
      exclude using gist (company_id with =, daterange(start_date, end_date, '[]') with &&)
      where (status = 'aktif' and archived_at is null);
  end if;
end $$;

create or replace function app.contract_before_write() returns trigger
language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    if new.status not in ('taslak', 'aktif') then
      raise exception 'Yeni sözleşme taslak veya aktif olarak başlar.';
    end if;
    return new;
  end if;

  if new.company_id is distinct from old.company_id then
    raise exception 'Sözleşmenin firması değiştirilemez.';
  end if;
  if old.status in ('yenilendi', 'sona_erdi', 'feshedildi') then
    if new.status is distinct from old.status then
      raise exception 'Sona ermiş sözleşmenin durumu değiştirilemez.';
    end if;
    if new.start_date is distinct from old.start_date or new.end_date is distinct from old.end_date then
      raise exception 'Sona ermiş sözleşmenin tarihleri değiştirilemez.';
    end if;
  end if;
  if new.status is distinct from old.status and not (
       (old.status = 'taslak' and new.status in ('aktif', 'feshedildi'))
    or (old.status = 'aktif' and new.status in ('yenilendi', 'sona_erdi', 'feshedildi'))) then
    raise exception 'Geçersiz sözleşme durumu geçişi: % → %', old.status, new.status;
  end if;
  return new;
end $$;

drop trigger if exists trg_contracts_write on contracts;
create trigger trg_contracts_write before insert or update on contracts
  for each row execute function app.contract_before_write();

-- Sözleşme sona erince açık fiyat dönemi sözleşme bitişinde kapanır
create or replace function app.contract_close_prices() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status in ('yenilendi', 'sona_erdi', 'feshedildi') and old.status is distinct from new.status then
    update contract_prices set valid_to = greatest(valid_from, new.end_date)
     where contract_id = new.id and valid_to is null;
  end if;
  return new;
end $$;

drop trigger if exists trg_contracts_close_prices on contracts;
create trigger trg_contracts_close_prices after update of status on contracts
  for each row execute function app.contract_close_prices();

-- ---------------------------------------------------------------------
-- 4. Sözleşme fiyat geçmişi
-- ---------------------------------------------------------------------
create or replace function app.contract_price_guard() returns trigger
language plpgsql as $$
declare c contracts;
begin
  if tg_op = 'UPDATE' then
    if new.contract_id is distinct from old.contract_id or new.pricing is distinct from old.pricing
       or new.unit_price is distinct from old.unit_price or new.fixed_monthly_price is distinct from old.fixed_monthly_price
       or new.vat_mode is distinct from old.vat_mode or new.vat_rate is distinct from old.vat_rate
       or new.valid_from is distinct from old.valid_from then
      raise exception 'Geçmiş fiyat kayıtları değiştirilemez; yeni fiyat dönemi ekleyin.';
    end if;
    return new;
  end if;
  select * into c from contracts where id = new.contract_id;
  if not found then raise exception 'Sözleşme bulunamadı.'; end if;
  if c.status in ('yenilendi', 'sona_erdi', 'feshedildi') then
    raise exception 'Sona ermiş sözleşmeye fiyat eklenemez.';
  end if;
  if new.valid_from < c.start_date then
    raise exception 'Fiyat dönemi sözleşme başlangıcından önce başlayamaz.';
  end if;
  if new.pricing = 'kisi_basi' and (new.unit_price is null or new.unit_price < 0) then
    raise exception 'Kişi başı fiyatlamada birim fiyat zorunludur ve negatif olamaz.';
  end if;
  if new.pricing = 'sabit_aylik' and (new.fixed_monthly_price is null or new.fixed_monthly_price < 0) then
    raise exception 'Sabit aylık fiyatlamada aylık tutar zorunludur ve negatif olamaz.';
  end if;
  if new.vat_rate < 0 or new.vat_rate > 100 then
    raise exception 'KDV oranı 0 ile 100 arasında olmalıdır.';
  end if;
  return new;
end $$;

drop trigger if exists trg_contract_prices_guard on contract_prices;
create trigger trg_contract_prices_guard before insert or update on contract_prices
  for each row execute function app.contract_price_guard();

-- ---------------------------------------------------------------------
-- 5. İşlemler
-- ---------------------------------------------------------------------

-- Teklifi yeni taslak sürüm olarak kopyalar (kalemlerle birlikte)
create or replace function public.teklif_kopyala(p_offer uuid)
returns offers
language plpgsql as $$
declare o offers; n offers;
begin
  if not app.can('offers', 'create') then raise exception 'Teklif ekleme yetkiniz yok.'; end if;
  select * into o from offers where id = p_offer;
  if not found then raise exception 'Teklif bulunamadı.'; end if;
  insert into offers(company_id, lead_id, opportunity_id, employee_count, hazard_class, pricing, unit_price, fixed_monthly_price,
                     vat_mode, vat_rate, discount_pct, est_expert_cost, est_physician_cost, est_travel_other_cost, description)
  values (o.company_id, o.lead_id, o.opportunity_id, o.employee_count, o.hazard_class, o.pricing, o.unit_price, o.fixed_monthly_price,
          o.vat_mode, o.vat_rate, o.discount_pct, o.est_expert_cost, o.est_physician_cost, o.est_travel_other_cost, o.description)
  returning * into n;
  insert into offer_items(offer_id, description, quantity, unit_price, vat_mode, vat_rate)
  select n.id, description, quantity, unit_price, vat_mode, vat_rate from offer_items where offer_id = o.id and archived_at is null;
  return n;
end $$;

-- Net (indirimli) fiyatı hesaplar: kuruş yuvarlaması 2 haneye
create or replace function app.net_fiyat(p_tutar numeric, p_indirim numeric) returns numeric
language sql immutable as $$ select case when p_tutar is null then null else round(p_tutar * (1 - coalesce(p_indirim, 0) / 100), 2) end $$;

-- Sözleşme + ilk fiyat dönemi tek işlemde
create or replace function public.sozlesme_olustur(
  p_firma uuid, p_baslangic date, p_bitis date, p_fiyatlama pricing_type, p_birim numeric, p_sabit numeric,
  p_kdv_modu vat_mode default 'kdv_haric', p_kdv_orani numeric default 20, p_durum contract_status default 'aktif',
  p_uzman boolean default true, p_hekim boolean default true,
  p_odeme text default null, p_yenileme text default null, p_fiyat_guncelleme text default null,
  p_teklif uuid default null, p_not text default null)
returns contracts
language plpgsql as $$
declare c contracts;
begin
  if not app.can('contracts', 'create') then raise exception 'Sözleşme ekleme yetkiniz yok.'; end if;
  if p_baslangic is null or p_bitis is null then raise exception 'Başlangıç ve bitiş tarihi zorunludur.'; end if;
  if p_bitis < p_baslangic then raise exception 'Bitiş tarihi başlangıçtan önce olamaz.'; end if;
  insert into contracts(company_id, offer_id, start_date, end_date, status, expert_service, physician_service,
                        payment_terms, renewal_terms, price_update_terms, owner_user)
  values (p_firma, p_teklif, p_baslangic, p_bitis, p_durum, p_uzman, p_hekim,
          nullif(btrim(p_odeme), ''), nullif(btrim(p_yenileme), ''), nullif(btrim(p_fiyat_guncelleme), ''), auth.uid())
  returning * into c;
  insert into contract_prices(contract_id, pricing, unit_price, fixed_monthly_price, vat_mode, vat_rate, valid_from, note)
  values (c.id, p_fiyatlama, p_birim, p_sabit, p_kdv_modu, p_kdv_orani, p_baslangic, nullif(btrim(p_not), ''));
  return c;
end $$;

-- Kabul edilen teklifi sözleşmeye çevirir (indirim fiyata işlenir; fırsat kazanıldı olur)
create or replace function public.teklif_kabul_et(
  p_offer uuid, p_baslangic date, p_bitis date,
  p_odeme text default null, p_yenileme text default null, p_fiyat_guncelleme text default null)
returns contracts
language plpgsql as $$
declare o offers; v_firma uuid; c contracts; v_birim numeric; v_sabit numeric; opp sales_opportunities;
begin
  if not app.can('offers', 'edit') then raise exception 'Teklifi düzenleme yetkiniz yok.'; end if;
  if not app.can('contracts', 'create') then raise exception 'Sözleşme ekleme yetkiniz yok.'; end if;
  select * into o from offers where id = p_offer and archived_at is null for update;
  if not found then raise exception 'Teklif bulunamadı.'; end if;
  if o.status not in ('gonderildi', 'gorusuluyor') then
    raise exception 'Yalnızca gönderilmiş veya görüşülen teklif kabul edilebilir (şu an: %).', o.status;
  end if;
  v_firma := o.company_id;
  if v_firma is null then
    select converted_company_id into v_firma from leads where id = o.lead_id;
  end if;
  if v_firma is null then
    raise exception 'Önce potansiyel müşteriyi firmaya dönüştürün.';
  end if;

  v_birim := app.net_fiyat(o.unit_price, o.discount_pct);
  v_sabit := app.net_fiyat(o.fixed_monthly_price, o.discount_pct);
  c := public.sozlesme_olustur(v_firma, p_baslangic, p_bitis, o.pricing, v_birim, v_sabit, o.vat_mode, o.vat_rate, 'aktif',
                               true, true, p_odeme, p_yenileme, p_fiyat_guncelleme, o.id,
                               'Teklif ' || o.offer_no || ' ile kabul edildi' ||
                               case when o.discount_pct > 0 then ' (%' || o.discount_pct::text || ' indirim fiyata işlendi)' else '' end);

  update offers set status = 'kabul_edildi', company_id = coalesce(company_id, v_firma) where id = o.id;

  if o.opportunity_id is not null and app.can('opportunities', 'edit') then
    update sales_opportunities set stage = 'kazanildi', company_id = coalesce(company_id, v_firma)
     where id = o.opportunity_id and stage not in ('kazanildi', 'kaybedildi');
  end if;
  return c;
end $$;

-- Yenileme: önceki sözleşme "yenilendi" olur, yenisi önceki fiyatla başlar
create or replace function public.sozlesme_yenile(p_contract uuid, p_baslangic date, p_bitis date, p_fiyat_notu text default null)
returns contracts
language plpgsql as $$
declare old contracts; pr contract_prices; c contracts;
begin
  if not app.can('contracts', 'create') or not app.can('contracts', 'edit') then
    raise exception 'Sözleşme yenileme yetkiniz yok.';
  end if;
  select * into old from contracts where id = p_contract and archived_at is null for update;
  if not found then raise exception 'Sözleşme bulunamadı.'; end if;
  if old.status <> 'aktif' then raise exception 'Yalnızca aktif sözleşme yenilenebilir (şu an: %).', old.status; end if;
  if exists (select 1 from contracts where previous_contract_id = old.id and archived_at is null) then
    raise exception 'Bu sözleşme zaten yenilenmiş.';
  end if;
  if p_baslangic is null or p_bitis is null then raise exception 'Başlangıç ve bitiş tarihi zorunludur.'; end if;
  if p_baslangic <= old.start_date then raise exception 'Yenileme başlangıcı, önceki sözleşmenin başlangıcından sonra olmalıdır.'; end if;
  if p_bitis < p_baslangic then raise exception 'Bitiş tarihi başlangıçtan önce olamaz.'; end if;

  select * into pr from contract_prices where contract_id = old.id and valid_to is null order by valid_from desc limit 1;
  if not found then raise exception 'Sözleşmede geçerli fiyat kaydı yok.'; end if;

  update contracts set end_date = least(end_date, p_baslangic - 1), status = 'yenilendi' where id = old.id;

  insert into contracts(company_id, previous_contract_id, start_date, end_date, status, expert_service, physician_service,
                        payment_terms, renewal_terms, price_update_terms, owner_user)
  values (old.company_id, old.id, p_baslangic, p_bitis, 'aktif', old.expert_service, old.physician_service,
          old.payment_terms, old.renewal_terms, old.price_update_terms, coalesce(old.owner_user, auth.uid()))
  returning * into c;
  insert into contract_prices(contract_id, pricing, unit_price, fixed_monthly_price, vat_mode, vat_rate, valid_from, note)
  values (c.id, pr.pricing, pr.unit_price, pr.fixed_monthly_price, pr.vat_mode, pr.vat_rate, p_baslangic,
          coalesce(nullif(btrim(p_fiyat_notu), ''), 'Yenileme: önceki sözleşmenin fiyatı aktarıldı'));

  if app.can('tasks', 'edit') then
    update tasks set status = 'tamamlandi'
     where source_ref like 'sozlesme:' || old.id::text || ':%' and status in ('acik', 'devam_ediyor');
  end if;
  return c;
end $$;

-- Fiyat değişikliği: açık dönem yeni başlangıçtan bir gün önce kapanır, eski fiyat korunur
create or replace function public.sozlesme_fiyat_ekle(
  p_contract uuid, p_fiyatlama pricing_type, p_birim numeric, p_sabit numeric,
  p_kdv_modu vat_mode, p_kdv_orani numeric, p_baslangic date, p_not text default null)
returns contract_prices
language plpgsql as $$
declare c contracts; acik contract_prices; yeni contract_prices;
begin
  if not app.can('contracts', 'edit') then raise exception 'Sözleşmeyi düzenleme yetkiniz yok.'; end if;
  select * into c from contracts where id = p_contract and archived_at is null for update;
  if not found then raise exception 'Sözleşme bulunamadı.'; end if;
  if c.status not in ('taslak', 'aktif') then raise exception 'Sona ermiş sözleşmenin fiyatı değiştirilemez.'; end if;
  if p_baslangic is null then raise exception 'Geçerlilik başlangıcı zorunludur.'; end if;
  if p_baslangic > c.end_date then raise exception 'Fiyat dönemi sözleşme bitişinden sonra başlayamaz.'; end if;
  select * into acik from contract_prices where contract_id = c.id and valid_to is null order by valid_from desc limit 1;
  if found then
    if p_baslangic <= acik.valid_from then
      raise exception 'Yeni fiyat dönemi, mevcut fiyatın başlangıcından (%) sonra olmalıdır.', acik.valid_from;
    end if;
    update contract_prices set valid_to = p_baslangic - 1 where id = acik.id;
  end if;
  insert into contract_prices(contract_id, pricing, unit_price, fixed_monthly_price, vat_mode, vat_rate, valid_from, note)
  values (c.id, p_fiyatlama, p_birim, p_sabit, p_kdv_modu, p_kdv_orani, p_baslangic, nullif(btrim(p_not), ''))
  returning * into yeni;
  return yeni;
end $$;

-- 90/60/30 gün yenileme uyarıları (görev olarak). Aynı sözleşme ve aynı eşik için görev bir kez üretilir.
create or replace function public.sozlesme_yenileme_gorevleri()
returns integer
language plpgsql as $$
declare r record; v_esik integer; v_adet integer := 0; v_gun integer;
begin
  if not app.can('tasks', 'create') or not app.can('contracts', 'view') then return 0; end if;
  for r in
    select c.id, c.company_id, c.end_date, c.owner_user, co.name as firma
      from contracts c join companies co on co.id = c.company_id
     where c.status = 'aktif' and c.archived_at is null
       and c.end_date between current_date and current_date + 90
       and not exists (select 1 from contracts n where n.previous_contract_id = c.id and n.archived_at is null)
  loop
    v_gun := r.end_date - current_date;
    v_esik := case when v_gun <= 30 then 30 when v_gun <= 60 then 60 else 90 end;
    insert into tasks(kind, title, company_id, assignee, priority, due_at, status, description, source_ref)
    values ('sozlesme_yenileme', r.firma || ' sözleşmesi ' || v_esik::text || ' gün içinde bitiyor', r.company_id,
            coalesce(r.owner_user, auth.uid()), case when v_esik = 30 then 'yuksek' else 'orta' end::priority_level, now(), 'acik',
            'Sözleşme bitişi: ' || to_char(r.end_date, 'DD.MM.YYYY') || '. Yenileme görüşmesi planlayın.',
            'sozlesme:' || r.id::text || ':' || v_esik::text)
    on conflict do nothing;
    if found then v_adet := v_adet + 1; end if;
  end loop;
  return v_adet;
end $$;

-- ---------------------------------------------------------------------
-- Yetkiler: yalnızca oturum açmış kullanıcılar
-- ---------------------------------------------------------------------
revoke all on function public.teklif_kopyala(uuid) from public, anon;
revoke all on function public.sozlesme_olustur(uuid, date, date, pricing_type, numeric, numeric, vat_mode, numeric, contract_status, boolean, boolean, text, text, text, uuid, text) from public, anon;
revoke all on function public.teklif_kabul_et(uuid, date, date, text, text, text) from public, anon;
revoke all on function public.sozlesme_yenile(uuid, date, date, text) from public, anon;
revoke all on function public.sozlesme_fiyat_ekle(uuid, pricing_type, numeric, numeric, vat_mode, numeric, date, text) from public, anon;
revoke all on function public.sozlesme_yenileme_gorevleri() from public, anon;
grant execute on function public.teklif_kopyala(uuid) to authenticated;
grant execute on function public.sozlesme_olustur(uuid, date, date, pricing_type, numeric, numeric, vat_mode, numeric, contract_status, boolean, boolean, text, text, text, uuid, text) to authenticated;
grant execute on function public.teklif_kabul_et(uuid, date, date, text, text, text) to authenticated;
grant execute on function public.sozlesme_yenile(uuid, date, date, text) to authenticated;
grant execute on function public.sozlesme_fiyat_ekle(uuid, pricing_type, numeric, numeric, vat_mode, numeric, date, text) to authenticated;
grant execute on function public.sozlesme_yenileme_gorevleri() to authenticated;
