-- OSGB 360 - Aşama 27 düzeltmesi: işyerlerinin tamamı başka firmaya bağlanınca eski firmanın profili sıfırlanır.
-- Sorun: 3 firma birleştirilip işyerleri tek firmaya taşınınca, boşalan firmalar eski çalışan sayısıyla teorik yük ve
-- görevlendirme maliyeti taşımaya devam ediyor, gelirleri olmadığı için "en düşük kârlı" listesine düşüyordu; taşıyan firma ise
-- toplam çalışan sayısını içerdiğinden aynı yük iki kez sayılıyordu.
-- Çözüm: işyerlerinin hepsi taşınan firmanın çalışan sayısı bu aydan itibaren 0 yapılır (tehlike sınıfı korunur). Yeniden çalıştırılabilir.

create or replace function public.isyeri_firmaya_tasi(p_site uuid, p_firma uuid)
returns jsonb
language plpgsql as $$
declare v_eski uuid; v_acik company_profiles; v_yeni company_profiles; v_bas date := date_trunc('month', app.today_tr())::date; v_sifirlandi boolean := false;
begin
  if not app.can('companies', 'edit') then raise exception 'Firma düzenleme yetkiniz yok.'; end if;
  select company_id into v_eski from company_sites where id = p_site;
  if not found then raise exception 'İşyeri bulunamadı veya erişim yetkiniz yok.'; end if;
  if not exists (select 1 from companies where id = p_firma) then raise exception 'Firma bulunamadı veya erişim yetkiniz yok.'; end if;
  update company_sites set company_id = p_firma, archived_at = null, archived_by = null, updated_at = now() where id = p_site;
  perform public.isyeri_profil_esitle(p_firma);
  if v_eski is distinct from p_firma then
    perform public.isyeri_profil_esitle(v_eski);
    if not exists (select 1 from company_sites where company_id = v_eski and archived_at is null and is_active and hazard_class is not null) then
      select * into v_acik from company_profiles where company_id = v_eski and valid_to is null order by valid_from desc limit 1;
      if found and v_acik.employee_count > 0 then
        if v_acik.valid_from >= v_bas then
          update company_profiles set employee_count = 0, site_breakdown = null where id = v_acik.id;
        else
          v_yeni := public.firma_profili_ekle(v_eski, 0, v_acik.hazard_class, v_bas, 'İşyerlerinin tamamı başka firmaya bağlandı');
        end if;
        v_sifirlandi := true;
      end if;
    end if;
  end if;
  return jsonb_build_object('eski_firma', v_eski, 'yeni_firma', p_firma, 'eski_firma_sifirlandi', v_sifirlandi);
end $$;

revoke all on function public.isyeri_firmaya_tasi(uuid, uuid) from public, anon;
grant execute on function public.isyeri_firmaya_tasi(uuid, uuid) to authenticated;
notify pgrst, 'reload schema';
