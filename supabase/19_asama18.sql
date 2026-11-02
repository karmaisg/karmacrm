-- =====================================================================
-- OSGB 360 - Aşama 18: firmayı kalıcı silme (firma_sil) ve pasif firma kuralı
--   * firma_sil(firma, yazilan_ad): firmanın TÜM kayıtlarını kalıcı siler (geri alınamaz). Yalnızca işletme sahibi / sistem yöneticisi,
--     firma adı birebir yazılmadan çalışmaz. Silinen kaydın özeti denetim kaydına yazılır.
--   * Pasif firma (eski müşteri veya arşivli): aylık toplu faturada yer almaz (donem_faturalari_olustur).
--     Kapasite / yük hesabı arayüzde pasif firmaların görevlendirmelerini saymaz; kayıtlar silinmez.
-- Güvenle yeniden çalıştırılabilir. Önce 01..18 çalışmış olmalıdır.
-- =====================================================================

-- Seçilen ay için aktif sözleşmelerden toplu fatura (Aşama 18: pasif / eski müşteri firmalara fatura üretilmez) üretir. Aynı sözleşme + ay için ikinci kez fatura üretmez.
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
     where c.organization_id = app.org_id() and c.archived_at is null and co.archived_at is null and co.customer_status = 'musteri'
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

create or replace function public.firma_sil(p_firma uuid, p_ad text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := app.org_id(); v_rol text; c companies; n jsonb := '{}'::jsonb; k integer;
  v_fatura uuid[]; v_sozlesme uuid[]; v_teklif uuid[]; v_firsat uuid[]; v_kisi uuid[]; v_gorev uuid[];
begin
  select r.key into v_rol from users u join roles r on r.id = u.role_id where u.id = auth.uid() and u.organization_id = v_org;
  if v_rol is null or v_rol not in ('isletme_sahibi', 'sistem_yoneticisi') then
    raise exception 'Firmayı kalıcı silme yetkisi yalnızca işletme sahibi ve sistem yöneticisindedir.';
  end if;
  select * into c from companies where id = p_firma and organization_id = v_org;
  if not found then raise exception 'Firma bulunamadı.'; end if;
  if btrim(coalesce(p_ad, '')) <> btrim(c.name) then raise exception 'Firma adı doğru yazılmadı; silme yapılmadı.'; end if;

  select coalesce(array_agg(id), '{}') into v_fatura from invoices where company_id = p_firma;
  select coalesce(array_agg(id), '{}') into v_sozlesme from contracts where company_id = p_firma;
  select coalesce(array_agg(id), '{}') into v_teklif from offers where company_id = p_firma;
  select coalesce(array_agg(id), '{}') into v_firsat from sales_opportunities where company_id = p_firma;
  select coalesce(array_agg(id), '{}') into v_kisi from contacts where company_id = p_firma;
  select coalesce(array_agg(id), '{}') into v_gorev from tasks where company_id = p_firma;

  -- bildirimler (görev / fatura / sözleşme / teklif / fırsat bağlantısı)
  delete from notifications where ref_id = any (v_fatura || v_sozlesme || v_teklif || v_firsat || v_gorev) ; get diagnostics k = row_count; n := n || jsonb_build_object('bildirim', k);

  delete from payments where invoice_id = any (v_fatura); get diagnostics k = row_count; n := n || jsonb_build_object('tahsilat', k);
  delete from invoice_items where invoice_id = any (v_fatura);
  delete from invoices where company_id = p_firma; get diagnostics k = row_count; n := n || jsonb_build_object('fatura', k);
  delete from invoice_aliases where company_id = p_firma;

  delete from attachments where company_id = p_firma or contract_id = any (v_sozlesme) or offer_id = any (v_teklif);
  delete from contract_prices where contract_id = any (v_sozlesme);
  update contracts set previous_contract_id = null where previous_contract_id = any (v_sozlesme) and company_id <> p_firma;
  delete from contracts where company_id = p_firma; get diagnostics k = row_count; n := n || jsonb_build_object('sozlesme', k);

  delete from offer_shares where offer_id = any (v_teklif);
  delete from offer_items where offer_id = any (v_teklif);
  delete from offers where company_id = p_firma or id = any (v_teklif); get diagnostics k = row_count; n := n || jsonb_build_object('teklif', k);

  delete from activities where company_id = p_firma or contact_id = any (v_kisi) or opportunity_id = any (v_firsat); get diagnostics k = row_count; n := n || jsonb_build_object('gorusme', k);
  delete from opportunity_stage_history where opportunity_id = any (v_firsat);
  delete from sales_opportunities where company_id = p_firma; get diagnostics k = row_count; n := n || jsonb_build_object('firsat', k);
  delete from contacts where company_id = p_firma; get diagnostics k = row_count; n := n || jsonb_build_object('kisi', k);
  update leads set converted_company_id = null where converted_company_id = p_firma;
  delete from tasks where company_id = p_firma; get diagnostics k = row_count; n := n || jsonb_build_object('gorev', k);
  delete from calendar_completions where item_id in (select id from calendar_items where company_id = p_firma);
  delete from calendar_items where company_id = p_firma;
  delete from outbound_messages where company_id = p_firma;

  delete from time_entries where company_id = p_firma; get diagnostics k = row_count; n := n || jsonb_build_object('zaman_kaydi', k);
  delete from assignments where company_id = p_firma; get diagnostics k = row_count; n := n || jsonb_build_object('gorevlendirme', k);
  delete from overhead_allocations where company_id = p_firma;
  delete from expenses where company_id = p_firma; get diagnostics k = row_count; n := n || jsonb_build_object('gider', k);

  update katip_rows set site_id = null where site_id in (select id from company_sites where company_id = p_firma);
  delete from company_sites where company_id = p_firma; get diagnostics k = row_count; n := n || jsonb_build_object('isyeri', k);
  delete from company_profiles where company_id = p_firma;
  delete from companies where id = p_firma;

  insert into audit_logs(organization_id, table_name, record_id, action, old_data, new_data, user_id)
  values (v_org, 'companies', p_firma::text, 'DELETE', to_jsonb(c), jsonb_build_object('silinen_kayit_sayilari', n), auth.uid());
  return jsonb_build_object('ad', c.name, 'silinen', n);
end $$;

revoke all on function public.firma_sil(uuid, text) from public, anon;
grant execute on function public.firma_sil(uuid, text) to authenticated;
