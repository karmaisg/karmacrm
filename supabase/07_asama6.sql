-- =====================================================================
-- OSGB 360 - Aşama 6 eki (fatura, tahsilat, gider)
--
-- 01_sema.sql ... 06_asama5.sql çalıştırıldıktan SONRA, BİR KEZ çalıştırılır.
-- Mevcut verilere dokunmaz; yalnızca fonksiyon, tetikleyici ve indeks ekler / günceller.
-- Tekrar çalıştırmak zarar vermez.
--
-- Eklenenler
--   1) Kurumlar arası bağlantı koruması: fatura, kalem, tahsilat, gider, kategori, dağıtım
--   2) Fatura: otomatik numara (F-2026-0001), vade/firma/sözleşme doğrulaması, tahsilatı olan fatura arşivlenemez,
--      bir sözleşme için bir hizmet dönemine tek fatura
--   3) Tahsilat: gelecek tarihli olamaz, arşivdeki faturaya girilemez; fazla tahsilat engellenmez (uyarı gösterilir);
--      fatura tamamen ödenince açık "tahsilat takibi" görevi kapanır
--   4) Gider: ortak gider firmaya/personele bağlanmaz, doğrudan gider tam olarak birine bağlanır,
--      maaş kategorisi 'payroll' yetkisi ister, dağıtımı yapılmış ortak havuz altına düşürülemez
--   5) fatura_kaydet, donem_faturalari_olustur, tahsilat_gecikme_gorevleri, gider_kaydet (KDV ayrımı veri tabanında yapılır)
-- =====================================================================

create or replace function app.today_tr() returns date
language sql stable as $$ select (now() at time zone 'Europe/Istanbul')::date $$;

-- KDV ayrımı (hesaplama.js kdvAyir ile aynı yuvarlama)
create or replace function app.kdv_ayir(p_tutar numeric, p_mod vat_mode, p_oran numeric, out haric numeric, out kdv numeric)
language plpgsql immutable as $$
declare t numeric;
begin
  if p_tutar is null or p_tutar <= 0 then raise exception 'Tutar sıfırdan büyük olmalıdır.'; end if;
  if p_oran is null or p_oran < 0 or p_oran > 100 then raise exception 'KDV oranı 0 ile 100 arasında olmalıdır.'; end if;
  t := round(p_tutar, 2);
  if p_mod = 'kdv_dahil' then
    haric := round(t * 100 / (100 + p_oran), 2);
    kdv := t - haric;
  else
    haric := t;
    kdv := round(t * p_oran / 100, 2);
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 1. Kurumlar arası bağlantı koruması
-- ---------------------------------------------------------------------
drop trigger if exists trg_invoices_org on invoices;
create trigger trg_invoices_org before insert or update on invoices
  for each row execute function app.check_same_org('companies:company_id', 'contracts:contract_id');
drop trigger if exists trg_invoice_items_org on invoice_items;
create trigger trg_invoice_items_org before insert or update on invoice_items
  for each row execute function app.check_same_org('invoices:invoice_id');
drop trigger if exists trg_payments_org on payments;
create trigger trg_payments_org before insert or update on payments
  for each row execute function app.check_same_org('invoices:invoice_id');
drop trigger if exists trg_expenses_org on expenses;
create trigger trg_expenses_org before insert or update on expenses
  for each row execute function app.check_same_org('expense_categories:category_id', 'companies:company_id', 'employees:employee_id');
drop trigger if exists trg_allocation_rules_org on allocation_rules;
create trigger trg_allocation_rules_org before insert or update on allocation_rules
  for each row execute function app.check_same_org('expense_categories:category_id');
drop trigger if exists trg_overhead_allocations_org on overhead_allocations;
create trigger trg_overhead_allocations_org before insert or update on overhead_allocations
  for each row execute function app.check_same_org('expense_categories:category_id', 'companies:company_id', 'employees:employee_id');

-- ---------------------------------------------------------------------
-- 2. Fatura
-- ---------------------------------------------------------------------
create unique index if not exists invoices_donem_uq on invoices(organization_id, contract_id, service_period)
  where contract_id is not null and service_period is not null and archived_at is null;

create or replace function app.invoice_before_write() returns trigger
language plpgsql as $$
declare n integer; yil text;
begin
  new.invoice_no := nullif(btrim(coalesce(new.invoice_no, '')), '');
  new.notes := nullif(btrim(coalesce(new.notes, '')), '');

  if tg_op = 'UPDATE' and old.archived_at is not null and new.archived_at is not null then
    raise exception 'Arşivdeki fatura değiştirilemez. Önce arşivden çıkarın.';
  end if;

  if new.invoice_no is null then
    if tg_op = 'UPDATE' then raise exception 'Fatura numarası boş olamaz.'; end if;
    yil := to_char(new.invoice_date, 'YYYY');
    perform pg_advisory_xact_lock(hashtext('invoice_no:' || new.organization_id::text));
    select coalesce(max(substring(invoice_no from ('^F-' || yil || '-([0-9]+)$'))::integer), 0) + 1 into n
      from invoices where organization_id = new.organization_id;
    new.invoice_no := 'F-' || yil || '-' || lpad(n::text, 4, '0');
  end if;

  if new.due_date < new.invoice_date then
    raise exception 'Vade tarihi fatura tarihinden önce olamaz.';
  end if;
  if new.contract_id is not null
     and not exists (select 1 from contracts c where c.id = new.contract_id and c.company_id = new.company_id) then
    raise exception 'Seçilen sözleşme bu firmaya ait değil.';
  end if;

  if tg_op = 'UPDATE' then
    if new.company_id <> old.company_id then raise exception 'Faturanın firması değiştirilemez.'; end if;
    if old.archived_at is null and new.archived_at is not null
       and exists (select 1 from payments p where p.invoice_id = old.id and p.archived_at is null) then
      raise exception 'Tahsilatı olan fatura arşivlenemez. Önce tahsilat kayıtlarını iptal edin.';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_invoices_rules on invoices;
create trigger trg_invoices_rules before insert or update on invoices
  for each row execute function app.invoice_before_write();

-- ---------------------------------------------------------------------
-- 3. Tahsilat
-- ---------------------------------------------------------------------
create or replace function app.payment_before_write() returns trigger
language plpgsql as $$
declare inv invoices;
begin
  new.method := nullif(btrim(coalesce(new.method, '')), '');
  new.notes := nullif(btrim(coalesce(new.notes, '')), '');
  select * into inv from invoices where id = new.invoice_id;
  if tg_op = 'UPDATE' then
    if new.invoice_id <> old.invoice_id then raise exception 'Tahsilatın faturası değiştirilemez.'; end if;
    if old.archived_at is not null and new.archived_at is not null then
      raise exception 'İptal edilmiş tahsilat değiştirilemez.';
    end if;
  end if;
  if (tg_op = 'INSERT' or new.archived_at is null) and inv.archived_at is not null then
    raise exception 'Arşivdeki faturaya tahsilat girilemez.';
  end if;
  if new.archived_at is null and new.paid_at > app.today_tr() then
    raise exception 'Tahsilat tarihi gelecekte olamaz.';
  end if;
  return new;
end $$;
drop trigger if exists trg_payments_rules on payments;
create trigger trg_payments_rules before insert or update on payments
  for each row execute function app.payment_before_write();

-- Fatura tamamen ödenince açık takip görevini kapatır (görev yetkisinden bağımsız çalışır)
create or replace function app.payment_after_write() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_total numeric; v_paid numeric;
begin
  select amount_incl_vat into v_total from invoices where id = new.invoice_id;
  select coalesce(sum(amount), 0) into v_paid from payments where invoice_id = new.invoice_id and archived_at is null;
  if v_total is not null and v_paid >= v_total then
    update tasks set status = 'tamamlandi', completed_at = now()
     where organization_id = new.organization_id and source_ref = 'fatura:' || new.invoice_id::text
       and status in ('acik', 'devam_ediyor') and archived_at is null;
  end if;
  return new;
end $$;
drop trigger if exists trg_payments_tasks on payments;
create trigger trg_payments_tasks after insert or update on payments
  for each row execute function app.payment_after_write();

-- ---------------------------------------------------------------------
-- 4. Gider kategorisi ve gider
-- ---------------------------------------------------------------------
create or replace function app.expense_category_before_write() returns trigger
language plpgsql as $$
begin
  new.name := btrim(coalesce(new.name, ''));
  if new.name = '' then raise exception 'Kategori adı boş olamaz.'; end if;
  if new.is_payroll and new.nature not in ('personel', 'sgk') then
    raise exception 'Maaş kategorisinin niteliği personel veya SGK olmalıdır.';
  end if;
  if tg_op = 'INSERT' and new.is_payroll and auth.uid() is not null and not app.can('payroll', 'create') then
    raise exception 'Maaş kategorisi eklemek için maaş (payroll) yetkisi gerekir.';
  end if;
  if tg_op = 'UPDATE' and (new.is_payroll <> old.is_payroll or new.is_income_tax <> old.is_income_tax)
     and exists (select 1 from expenses e where e.category_id = old.id) then
    raise exception 'Gideri olan kategorinin maaş/vergi niteliği değiştirilemez.';
  end if;
  return new;
end $$;
drop trigger if exists trg_expense_categories_rules on expense_categories;
create trigger trg_expense_categories_rules before insert or update on expense_categories
  for each row execute function app.expense_category_before_write();

-- Ortak havuz, dağıtılmış tutarın altına düşemez (p_ekle: değişiklikten sonra o havuza eklenecek tutar)
create or replace function app.expense_pool_check(p_org uuid, p_cat uuid, p_period date, p_exclude uuid, p_ekle numeric)
returns void
language plpgsql security definer set search_path = public as $$
declare pool numeric; allocated numeric;
begin
  select coalesce(sum(amount_excl_vat), 0) + coalesce(p_ekle, 0) into pool
    from expenses
   where organization_id = p_org and category_id = p_cat and cost_type = 'ortak' and archived_at is null
     and id <> p_exclude and date_trunc('month', expense_date)::date = p_period;
  select coalesce(sum(amount), 0) into allocated
    from overhead_allocations
   where organization_id = p_org and category_id = p_cat and period = p_period and archived_at is null;
  if allocated > pool + 0.005 then
    raise exception 'Bu değişiklik, ilgili dönemde yapılmış ortak gider dağıtımının (%) altına düşüyor. Önce dağıtımı iptal edin.', allocated;
  end if;
end $$;

create or replace function app.expense_before_write() returns trigger
language plpgsql as $$
declare v_pay boolean; v_old_pay boolean := false; v_ekle numeric;
begin
  new.description := nullif(btrim(coalesce(new.description, '')), '');
  if tg_op = 'UPDATE' and old.archived_at is not null and new.archived_at is not null then
    raise exception 'Arşivdeki gider değiştirilemez. Önce arşivden çıkarın.';
  end if;
  if new.cost_type = 'ortak' and (new.company_id is not null or new.employee_id is not null) then
    raise exception 'Ortak giderde firma veya personel seçilemez. Bir firmaya ya da personele ait gider "doğrudan" olmalıdır.';
  end if;
  if new.cost_type = 'dogrudan' and new.company_id is not null and new.employee_id is not null then
    raise exception 'Doğrudan giderde firma ya da personelden yalnızca biri seçilmelidir.';
  end if;
  if new.cost_type = 'dogrudan' and new.company_id is null and new.employee_id is null then
    raise exception 'Doğrudan gider için firma veya personel seçilmelidir.';
  end if;

  v_pay := app.is_payroll_category(new.category_id);
  if tg_op = 'UPDATE' then v_old_pay := app.is_payroll_category(old.category_id); end if;
  if tg_op = 'INSERT' and v_pay and auth.uid() is not null and not app.can('payroll', 'create') then
    raise exception 'Maaş ve personel maliyeti giderleri için maaş (payroll) yetkisi gerekir.';
  end if;
  if tg_op = 'UPDATE' and (v_pay or v_old_pay) and auth.uid() is not null and not app.can('payroll', 'edit') then
    raise exception 'Maaş ve personel maliyeti giderlerini değiştirmek için maaş (payroll) yetkisi gerekir.';
  end if;

  if tg_op = 'UPDATE' and old.cost_type = 'ortak' and old.archived_at is null then
    v_ekle := case when new.cost_type = 'ortak' and new.archived_at is null and new.category_id = old.category_id
                        and date_trunc('month', new.expense_date) = date_trunc('month', old.expense_date)
                   then new.amount_excl_vat else 0 end;
    perform app.expense_pool_check(old.organization_id, old.category_id, date_trunc('month', old.expense_date)::date, old.id, v_ekle);
  end if;
  return new;
end $$;
drop trigger if exists trg_expenses_rules on expenses;
create trigger trg_expenses_rules before insert or update on expenses
  for each row execute function app.expense_before_write();

-- ---------------------------------------------------------------------
-- 5. Arayüzün çağırdığı işlemler (RPC) - hepsi çağıranın yetkisiyle çalışır
-- ---------------------------------------------------------------------

-- Fatura ekle / düzenle (tek kalemli; KDV ayrımı burada yapılır)
create or replace function public.fatura_kaydet(
  p_id uuid, p_firma uuid, p_sozlesme uuid, p_no text, p_tarih date, p_vade date, p_donem date,
  p_tutar numeric, p_kdv_modu vat_mode, p_kdv_orani numeric, p_aciklama text, p_not text)
returns invoices
language plpgsql as $$
declare k record; inv invoices; v_donem date; v_acik text;
begin
  if p_id is null and not app.can('invoices', 'create') then raise exception 'Fatura ekleme yetkiniz yok.'; end if;
  if p_id is not null and not app.can('invoices', 'edit') then raise exception 'Fatura düzenleme yetkiniz yok.'; end if;
  if p_tarih is null or p_vade is null then raise exception 'Fatura ve vade tarihi zorunludur.'; end if;
  select * into k from app.kdv_ayir(p_tutar, p_kdv_modu, p_kdv_orani);
  v_donem := case when p_donem is null then null else date_trunc('month', p_donem)::date end;
  v_acik := coalesce(nullif(btrim(coalesce(p_aciklama, '')), ''), 'Hizmet bedeli');

  if p_id is null then
    if p_firma is null then raise exception 'Firma seçilmelidir.'; end if;
    insert into invoices(company_id, contract_id, invoice_no, invoice_date, due_date, service_period, amount_excl_vat, vat_amount, notes)
    values (p_firma, p_sozlesme, coalesce(p_no, ''), p_tarih, p_vade, v_donem, k.haric, k.kdv, p_not)
    returning * into inv;
    insert into invoice_items(invoice_id, description, quantity, unit_price_excl, vat_rate)
    values (inv.id, v_acik, 1, k.haric, p_kdv_orani);
  else
    update invoices set contract_id = p_sozlesme, invoice_no = coalesce(nullif(btrim(coalesce(p_no, '')), ''), invoice_no),
           invoice_date = p_tarih, due_date = p_vade, service_period = v_donem,
           amount_excl_vat = k.haric, vat_amount = k.kdv, notes = p_not
     where id = p_id returning * into inv;
    if not found then raise exception 'Fatura bulunamadı.'; end if;
    update invoice_items set description = v_acik, unit_price_excl = k.haric, vat_rate = p_kdv_orani
     where invoice_id = p_id and archived_at is null
       and (select count(*) from invoice_items x where x.invoice_id = p_id and x.archived_at is null) = 1;
  end if;
  return inv;
end $$;

-- Seçilen ay için aktif sözleşmelerden toplu fatura üretir. Aynı sözleşme + ay için ikinci kez fatura üretmez.
-- Kişi başı: birim fiyat x o gün geçerli çalışan sayısı; sabit aylık: aylık tutar; özel fiyat: atlanır (elle girilir).
-- Kısmi ay (ay ortasında başlayan/biten sözleşme) için gün oranlaması YAPILMAZ.
create or replace function public.donem_faturalari_olustur(p_donem date, p_fatura_tarihi date default null, p_vade_gun integer default 30)
returns jsonb
language plpgsql as $$
declare
  r record; p record; v_donem date; v_bit date; v_tarih date; v_gun date; v_n integer; v_tutar numeric; v_acik text;
  v_ayad text[] := array['Ocak','Şubat','Mart','Nisan','Mayıs','Haziran','Temmuz','Ağustos','Eylül','Ekim','Kasım','Aralık'];
  v_adet integer := 0; v_atlanan jsonb := '[]'::jsonb; v_neden text; inv invoices;
begin
  if not app.can('invoices', 'create') then raise exception 'Fatura ekleme yetkiniz yok.'; end if;
  if not app.can('contracts', 'view') or not app.can('companies', 'view') then
    raise exception 'Toplu fatura için sözleşme ve firma görüntüleme yetkiniz gerekir.';
  end if;
  if p_donem is null then raise exception 'Hizmet dönemi seçilmelidir.'; end if;
  if p_vade_gun is null or p_vade_gun < 0 or p_vade_gun > 365 then raise exception 'Vade günü 0 ile 365 arasında olmalıdır.'; end if;
  v_donem := date_trunc('month', p_donem)::date;
  v_bit := (v_donem + interval '1 month - 1 day')::date;
  v_tarih := coalesce(p_fatura_tarihi, app.today_tr());

  for r in
    select c.id as contract_id, c.company_id, co.name as firma, c.start_date
      from contracts c join companies co on co.id = c.company_id
     where c.organization_id = app.org_id() and c.archived_at is null and co.archived_at is null
       and c.status in ('aktif', 'yenilendi', 'sona_erdi')
       and c.start_date <= v_bit and c.end_date >= v_donem
     order by co.name, c.start_date
  loop
    v_neden := null; v_tutar := null;
    v_gun := greatest(v_donem, r.start_date);
    if exists (select 1 from invoices i where i.contract_id = r.contract_id and i.service_period = v_donem and i.archived_at is null) then
      v_neden := 'Bu dönem için fatura zaten var';
    else
      select * into p from contract_prices cp
       where cp.contract_id = r.contract_id and cp.valid_from <= v_gun and (cp.valid_to is null or cp.valid_to >= v_gun);
      if not found then
        v_neden := 'Bu dönem için geçerli fiyat yok';
      elsif p.pricing = 'ozel' then
        v_neden := 'Özel fiyatlı sözleşme: faturayı elle girin';
      elsif p.pricing = 'sabit_aylik' then
        v_tutar := p.fixed_monthly_price;
        v_acik := 'İSG hizmet bedeli - ' || v_ayad[extract(month from v_donem)::int] || ' ' || extract(year from v_donem)::int::text;
      else
        select cp2.employee_count into v_n from company_profiles cp2
         where cp2.company_id = r.company_id and cp2.valid_from <= v_gun and (cp2.valid_to is null or cp2.valid_to >= v_gun);
        if not found then
          v_neden := 'Firma profilinde o tarih için çalışan sayısı yok';
        else
          v_tutar := p.unit_price * v_n;
          v_acik := 'İSG hizmet bedeli - ' || v_ayad[extract(month from v_donem)::int] || ' ' || extract(year from v_donem)::int::text
                    || ' (' || v_n::text || ' çalışan x ' || to_char(p.unit_price, 'FM999G999G990D00') || ')';
        end if;
      end if;
      if v_neden is null and (v_tutar is null or v_tutar <= 0) then v_neden := 'Hesaplanan tutar sıfır'; end if;
    end if;

    if v_neden is null then
      inv := public.fatura_kaydet(null, r.company_id, r.contract_id, null, v_tarih, v_tarih + p_vade_gun, v_donem,
                                  v_tutar, p.vat_mode, p.vat_rate, v_acik, null);
      v_adet := v_adet + 1;
    else
      v_atlanan := v_atlanan || jsonb_build_array(jsonb_build_object('firma', r.firma, 'neden', v_neden));
    end if;
  end loop;
  return jsonb_build_object('olusturulan', v_adet, 'atlanan', v_atlanan);
end $$;

-- Vadesi geçmiş ve kalanı olan faturalar için takip görevi üretir (fatura başına bir kez; itirazlı faturalar hariç)
create or replace function public.tahsilat_gecikme_gorevleri()
returns integer
language plpgsql as $$
declare r record; v_adet integer := 0;
begin
  if not app.can('tasks', 'create') or not app.can('invoices', 'view') or not app.can('companies', 'view') then return 0; end if;
  for r in
    select b.invoice_id, b.company_id, b.invoice_no, b.balance, b.due_date, co.name as firma, co.responsible_user,
           (app.today_tr() - b.due_date) as gec
      from invoice_balances b
      join invoices i on i.id = b.invoice_id
      join companies co on co.id = b.company_id
     where b.balance > 0 and b.due_date < app.today_tr() and i.flag is distinct from 'itirazli'
       and co.archived_at is null
  loop
    insert into tasks(kind, title, company_id, assignee, priority, due_at, status, description, source_ref)
    values ('tahsilat_takibi', r.firma || ' - ' || r.invoice_no || ' faturasının vadesi geçti', r.company_id,
            coalesce(r.responsible_user, auth.uid()),
            case when r.gec > 60 then 'kritik' when r.gec > 30 then 'yuksek' else 'orta' end::priority_level, now(), 'acik',
            'Kalan tutar: ' || to_char(r.balance, 'FM999G999G990D00') || ' TL. Vade: ' || to_char(r.due_date, 'DD.MM.YYYY') || '. Müşteriyle iletişime geçin.',
            'fatura:' || r.invoice_id::text)
    on conflict do nothing;
    if found then v_adet := v_adet + 1; end if;
  end loop;
  return v_adet;
end $$;

-- Gider ekle / düzenle (KDV ayrımı burada yapılır)
create or replace function public.gider_kaydet(
  p_id uuid, p_kategori uuid, p_tarih date, p_tutar numeric, p_kdv_modu vat_mode, p_kdv_orani numeric,
  p_tur cost_type, p_firma uuid, p_personel uuid, p_odendi boolean, p_aciklama text)
returns expenses
language plpgsql as $$
declare k record; e expenses;
begin
  if p_id is null and not app.can('expenses', 'create') then raise exception 'Gider ekleme yetkiniz yok.'; end if;
  if p_id is not null and not app.can('expenses', 'edit') then raise exception 'Gider düzenleme yetkiniz yok.'; end if;
  if p_kategori is null then raise exception 'Gider kategorisi seçilmelidir.'; end if;
  if p_tarih is null then raise exception 'Gider tarihi zorunludur.'; end if;
  select * into k from app.kdv_ayir(p_tutar, p_kdv_modu, p_kdv_orani);
  if p_id is null then
    insert into expenses(category_id, expense_date, amount_excl_vat, vat_amount, cost_type, company_id, employee_id, paid, description)
    values (p_kategori, p_tarih, k.haric, k.kdv, p_tur, p_firma, p_personel, coalesce(p_odendi, false), p_aciklama)
    returning * into e;
  else
    update expenses set category_id = p_kategori, expense_date = p_tarih, amount_excl_vat = k.haric, vat_amount = k.kdv,
           cost_type = p_tur, company_id = p_firma, employee_id = p_personel, paid = coalesce(p_odendi, false), description = p_aciklama
     where id = p_id returning * into e;
    if not found then raise exception 'Gider bulunamadı.'; end if;
  end if;
  return e;
end $$;

-- ---------------------------------------------------------------------
-- Yetkiler: yalnızca oturum açmış kullanıcılar
-- ---------------------------------------------------------------------
revoke all on function public.fatura_kaydet(uuid, uuid, uuid, text, date, date, date, numeric, vat_mode, numeric, text, text) from public, anon;
revoke all on function public.donem_faturalari_olustur(date, date, integer) from public, anon;
revoke all on function public.tahsilat_gecikme_gorevleri() from public, anon;
revoke all on function public.gider_kaydet(uuid, uuid, date, numeric, vat_mode, numeric, cost_type, uuid, uuid, boolean, text) from public, anon;
grant execute on function public.fatura_kaydet(uuid, uuid, uuid, text, date, date, date, numeric, vat_mode, numeric, text, text) to authenticated;
grant execute on function public.donem_faturalari_olustur(date, date, integer) to authenticated;
grant execute on function public.tahsilat_gecikme_gorevleri() to authenticated;
grant execute on function public.gider_kaydet(uuid, uuid, date, numeric, vat_mode, numeric, cost_type, uuid, uuid, boolean, text) to authenticated;
