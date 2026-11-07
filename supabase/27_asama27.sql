-- OSGB 360 - Aşama 27: işyerlerinin tehlike sınıfı ve çalışan sayısı maliyet hesabına yansır
--   * isyeri_profil_esitle(firma)   : firmanın aktif işyerlerinden (Katip + elle girilen) firma profilini (toplam çalışan,
--                                     en yüksek tehlike sınıfı, tehlike sınıfı dökümü) günceller. Hizmet süresi, kapasite ve
--                                     kârlılık hesapları her tehlike sınıfını kendi dakikasıyla hesaplar.
--   * isyeri_firmaya_tasi(site, firma): mevcut (başka firmada duran veya silinmiş) bir işyerini bu firmaya bağlar.
--   * katip_uygula                   : Katip yüklemesi artık elle girilen işyerlerini de firma kartı hesabına katar.
-- Yeniden çalıştırılabilir. Önce 14, 16, 17 numaralı dosyalar çalışmış olmalıdır.

create or replace function public.isyeri_profil_esitle(p_firma uuid, p_baslangic date default null)
returns jsonb
language plpgsql as $$
declare
  v_bas date := coalesce(p_baslangic, date_trunc('month', app.today_tr())::date);
  f record; v_acik company_profiles; v_yeni company_profiles; v_dokum jsonb;
begin
  if not app.can('companies', 'edit') then raise exception 'Firma düzenleme yetkiniz yok.'; end if;
  if not exists (select 1 from companies where id = p_firma) then raise exception 'Firma bulunamadı veya erişim yetkiniz yok.'; end if;
  select coalesce(sum(s.employee_count), 0)::int as toplam, max(s.hazard_class) as tehlike, count(distinct s.hazard_class) as sinif
    into f
    from company_sites s
   where s.company_id = p_firma and s.is_active and s.archived_at is null and s.hazard_class is not null;
  if f.tehlike is null then return jsonb_build_object('guncellendi', false, 'neden', 'tehlike sınıfı olan işyeri yok'); end if;
  if f.sinif > 1 then
    select jsonb_agg(jsonb_build_object('tehlike', t.h, 'calisan', t.n) order by t.h) into v_dokum
      from (select s2.hazard_class::text as h, coalesce(sum(s2.employee_count), 0)::int as n from company_sites s2
             where s2.company_id = p_firma and s2.is_active and s2.archived_at is null and s2.hazard_class is not null group by s2.hazard_class) t;
  end if;
  select * into v_acik from company_profiles where company_id = p_firma and valid_to is null order by valid_from desc limit 1;
  if found and v_acik.employee_count = f.toplam and v_acik.hazard_class = f.tehlike and v_acik.site_breakdown is not distinct from v_dokum then
    return jsonb_build_object('guncellendi', false, 'neden', 'değişiklik yok');
  end if;
  if found and v_acik.valid_from >= v_bas then
    update company_profiles set employee_count = f.toplam, hazard_class = f.tehlike, site_breakdown = v_dokum where id = v_acik.id;
  else
    v_yeni := public.firma_profili_ekle(p_firma, f.toplam, f.tehlike, v_bas, 'İşyeri bilgilerinden güncellendi');
    update company_profiles set site_breakdown = v_dokum where id = v_yeni.id;
  end if;
  return jsonb_build_object('guncellendi', true, 'calisan', f.toplam, 'tehlike', f.tehlike, 'dokum', v_dokum);
end $$;

create or replace function public.isyeri_firmaya_tasi(p_site uuid, p_firma uuid)
returns jsonb
language plpgsql as $$
declare v_eski uuid;
begin
  if not app.can('companies', 'edit') then raise exception 'Firma düzenleme yetkiniz yok.'; end if;
  select company_id into v_eski from company_sites where id = p_site;
  if not found then raise exception 'İşyeri bulunamadı veya erişim yetkiniz yok.'; end if;
  if not exists (select 1 from companies where id = p_firma) then raise exception 'Firma bulunamadı veya erişim yetkiniz yok.'; end if;
  update company_sites set company_id = p_firma, archived_at = null, archived_by = null, updated_at = now() where id = p_site;
  perform public.isyeri_profil_esitle(p_firma);
  if v_eski is distinct from p_firma then perform public.isyeri_profil_esitle(v_eski); end if;
  return jsonb_build_object('eski_firma', v_eski, 'yeni_firma', p_firma);
end $$;

revoke all on function public.isyeri_profil_esitle(uuid, date) from public, anon;
grant execute on function public.isyeri_profil_esitle(uuid, date) to authenticated;
revoke all on function public.isyeri_firmaya_tasi(uuid, uuid) from public, anon;
grant execute on function public.isyeri_firmaya_tasi(uuid, uuid) to authenticated;

create or replace function public.katip_uygula(p_paket jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := app.org_id();
  v_donem date;
  v_imp uuid;
  v_ref jsonb := '{}'::jsonb;
  v_site jsonb := '{}'::jsonb;
  r jsonb; v_id uuid; v_firma uuid;
  v_yeni_firma int := 0; v_site_ekle int := 0; v_site_guncel int := 0; v_satir int := 0; v_kisi int := 0; v_profil int := 0; v_pasif int := 0; v_kapanan int := 0;
  v_sicil text[];
  f record; v_acik company_profiles; v_yeni_profil company_profiles; v_bas date;
begin
  if v_org is null then raise exception 'Oturum bulunamadı.'; end if;
  if not (app.can('import_export', 'create') and app.can('companies', 'create') and app.can('companies', 'edit')) then
    raise exception 'Bu aktarım için içe aktarma ve firma ekleme/düzenleme yetkisi gerekir.';
  end if;
  if p_paket is null or jsonb_typeof(p_paket -> 'isyerleri') <> 'array' or jsonb_array_length(p_paket -> 'isyerleri') = 0 then
    raise exception 'Aktarılacak işyeri bulunamadı.';
  end if;
  if jsonb_array_length(p_paket -> 'isyerleri') > 3000 or jsonb_array_length(coalesce(p_paket -> 'satirlar', '[]')) > 6000 then
    raise exception 'Aktarım çok büyük; dosyayı bölün.';
  end if;
  v_donem := date_trunc('month', (p_paket ->> 'donem')::date)::date;

  -- 1) yeni firmalar
  for r in select * from jsonb_array_elements(coalesce(p_paket -> 'yeni_firmalar', '[]')) loop
    if coalesce(btrim(r ->> 'ad'), '') = '' then raise exception 'Yeni firma adı boş olamaz.'; end if;
    insert into companies(name, city, customer_status, notes)
    values (btrim(r ->> 'ad'), nullif(btrim(r ->> 'il'), ''), 'musteri', 'İSG-Katip aktarımı ile oluşturuldu')
    returning id into v_id;
    v_ref := v_ref || jsonb_build_object(r ->> 'ref', v_id);
    v_yeni_firma := v_yeni_firma + 1;
  end loop;

  insert into katip_imports(period, file_name, summary)
  values (v_donem, left(p_paket ->> 'dosya', 200), coalesce(p_paket -> 'ozet', '{}'::jsonb)) returning id into v_imp;

  -- 2) işyerleri (sicil -> firma)
  v_sicil := array[]::text[];
  for r in select * from jsonb_array_elements(p_paket -> 'isyerleri') loop
    v_firma := coalesce(nullif(r ->> 'firma_id', '')::uuid, (v_ref ->> (r ->> 'firma_ref'))::uuid);
    if v_firma is null then raise exception 'İşyeri % için firma belirtilmemiş.', r ->> 'sicil'; end if;
    if not exists (select 1 from companies where id = v_firma and organization_id = v_org) then
      raise exception 'İşyeri % için firma bulunamadı.', r ->> 'sicil';
    end if;
    v_sicil := v_sicil || (r ->> 'sicil');
    if exists (select 1 from company_sites where organization_id = v_org and sgk_no = r ->> 'sicil') then v_site_guncel := v_site_guncel + 1; else v_site_ekle := v_site_ekle + 1; end if;
    insert into company_sites(company_id, sgk_no, site_name, city, employee_count, hazard_class, is_active, valid_from, last_import_id)
    values (v_firma, r ->> 'sicil', left(btrim(r ->> 'unvan'), 300), nullif(btrim(r ->> 'il'), ''), (r ->> 'calisan')::int, (r ->> 'tehlike')::hazard_class, true, v_donem, v_imp)
    on conflict (organization_id, sgk_no) do update
      set company_id = excluded.company_id, site_name = excluded.site_name, city = excluded.city, employee_count = excluded.employee_count,
          hazard_class = excluded.hazard_class, is_active = true, valid_from = excluded.valid_from, last_import_id = excluded.last_import_id, archived_at = null, archived_by = null
    returning id into v_id;
    v_site := v_site || jsonb_build_object(r ->> 'sicil', v_id);
  end loop;
  -- dosyada artık olmayan işyerleri: sözleşme bitmiş sayılır (silinmez, pasife alınır)
  update company_sites set is_active = false where organization_id = v_org and is_active and not is_manual and not (sgk_no = any (v_sicil));
  get diagnostics v_kapanan = row_count;

  -- 3) sözleşme satırları (o günkü görüntü) ve görevli kişiler
  for r in select * from jsonb_array_elements(coalesce(p_paket -> 'satirlar', '[]')) loop
    v_id := (v_site ->> (r ->> 'sicil'))::uuid;
    if v_id is null then continue; end if;   -- yoksayılan işyeri
    insert into katip_rows(import_id, site_id, sgk_no, site_name, city, employee_count, hazard_class, contract_id, staff_type, cert_type, cert_no, person_name, minutes_per_month, start_date, approver_name, compliant)
    select v_imp, s.id, s.sgk_no, s.site_name, s.city, s.employee_count, s.hazard_class, nullif(r ->> 'sozlesme_id', ''), r ->> 'tur', left(r ->> 'sertifika_tipi', 120), nullif(r ->> 'sertifika_no', ''),
           left(btrim(r ->> 'ad'), 120), (r ->> 'dakika')::int, nullif(r ->> 'baslangic', '')::date, nullif(btrim(r ->> 'onaylayan'), ''), nullif(r ->> 'uygun', '')::boolean
      from company_sites s where s.id = v_id;
    v_satir := v_satir + 1;
    insert into katip_people(person_key, person_name, cert_no, national_id, staff_type)
    values (coalesce(nullif(r ->> 'sertifika_no', ''), lower(btrim(r ->> 'ad'))), left(btrim(r ->> 'ad'), 120), nullif(r ->> 'sertifika_no', ''), nullif(r ->> 'tc', ''), r ->> 'tur')
    on conflict (organization_id, person_key) do update
      set person_name = excluded.person_name, national_id = coalesce(excluded.national_id, katip_people.national_id), staff_type = excluded.staff_type, updated_at = now();
  end loop;

  -- 4) firma kişileri (onaylayan): aynı ad firmada yoksa eklenir
  for r in select * from jsonb_array_elements(coalesce(p_paket -> 'kisiler', '[]')) loop
    v_firma := coalesce(nullif(r ->> 'firma_id', '')::uuid, (v_ref ->> (r ->> 'firma_ref'))::uuid);
    if v_firma is null or not exists (select 1 from companies where id = v_firma and organization_id = v_org) then continue; end if;
    if not exists (select 1 from contacts where company_id = v_firma and archived_at is null and lower(btrim(full_name)) = lower(btrim(r ->> 'ad'))) then
      insert into contacts(company_id, full_name, title, notes) values (v_firma, left(btrim(r ->> 'ad'), 120), 'İSG-Katip onaylayan', 'İSG-Katip sözleşme onaylayan kişi (aktarım)');
      v_kisi := v_kisi + 1;
    end if;
  end loop;

  -- 5) pasife alınacak firmalar (Excel'de karşılığı olmayan)
  for v_firma in select (x)::uuid from jsonb_array_elements_text(coalesce(p_paket -> 'pasif', '[]')) x loop
    update companies set customer_status = 'eski_musteri' where id = v_firma and organization_id = v_org and customer_status = 'musteri';
    if found then v_pasif := v_pasif + 1; end if;
  end loop;

  -- 6) firma kartı: aktif işyerlerinin toplam çalışan sayısı ve en yüksek tehlike sınıfı (tarih geçmişi korunur)
  for f in
    select s.company_id, sum(s.employee_count)::int as toplam, max(s.hazard_class) as tehlike,
           case when count(distinct s.hazard_class) > 1
                then (select jsonb_agg(jsonb_build_object('tehlike', t.h, 'calisan', t.n) order by t.h)
                        from (select s2.hazard_class::text as h, sum(s2.employee_count)::int as n from company_sites s2
                               where s2.company_id = s.company_id and s2.organization_id = v_org and s2.is_active and s2.archived_at is null and s2.hazard_class is not null
                               group by s2.hazard_class) t)
           end as dokum
      from company_sites s
     where s.organization_id = v_org and s.is_active and s.archived_at is null and s.hazard_class is not null
       and s.company_id in (select company_id from company_sites where last_import_id = v_imp)
     group by s.company_id
  loop
    select * into v_acik from company_profiles where company_id = f.company_id and valid_to is null order by valid_from desc limit 1;
    if found and v_acik.employee_count = f.toplam and v_acik.hazard_class = f.tehlike and v_acik.site_breakdown is not distinct from f.dokum then continue; end if;
    v_bas := v_donem;
    if found and v_bas <= v_acik.valid_from then v_bas := v_acik.valid_from + 1; end if;
    v_yeni_profil := public.firma_profili_ekle(f.company_id, f.toplam, f.tehlike, v_bas, 'İSG-Katip aktarımı ' || to_char(v_donem, 'MM.YYYY'));
    if f.dokum is not null then update company_profiles set site_breakdown = f.dokum where id = v_yeni_profil.id; end if;
    v_profil := v_profil + 1;
  end loop;

  update katip_imports set row_count = v_satir, site_count = jsonb_array_length(p_paket -> 'isyerleri'), new_company_count = v_yeni_firma where id = v_imp;
  return jsonb_build_object('yukleme_id', v_imp, 'yeni_firma', v_yeni_firma, 'yeni_isyeri', v_site_ekle, 'guncellenen_isyeri', v_site_guncel,
    'kapanan_isyeri', v_kapanan, 'satir', v_satir, 'yeni_kisi', v_kisi, 'pasife_alinan', v_pasif, 'firma_karti_guncellenen', v_profil);
end $$;
revoke all on function public.katip_uygula(jsonb) from public, anon;
grant execute on function public.katip_uygula(jsonb) to authenticated;

notify pgrst, 'reload schema';
