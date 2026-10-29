-- =====================================================================
-- OSGB 360 - Aşama 9 eki (sistem ayarları)
--
-- 01_sema.sql ... 08_asama7.sql çalıştırıldıktan SONRA, BİR KEZ çalıştırılır.
-- Mevcut verilere dokunmaz. Tekrar çalıştırmak zarar vermez.
--
--   1) ayar_kaydet : sayısal sistem ayarlarını (kapasite, vergi oranı, marj eşiği, KDV) doğrulayarak
--      tarihçeli kaydeder. Değer ayın 1'inden itibaren geçerli olur; geçmiş aylar değişmez.
--   2) hizmet_suresi_kurali_ekle : "çalışan başına teorik dakika" kuralını tarihçeli değiştirir
--      (eski kural bir gün önce kapanır, yenisi açılır; çakışma olmaz).
-- Yetki: ikisi de "settings" modülünde oluşturma + düzenleme yetkisi ister (varsayılan: işletme sahibi).
-- =====================================================================

create or replace function public.ayar_kaydet(p_anahtar text, p_deger jsonb, p_gecerlilik date)
returns settings
language plpgsql as $$
declare
  v numeric; alt numeric; ust numeric; ad text; sonuc settings;
begin
  if not app.can('settings', 'create') or not app.can('settings', 'edit') then
    raise exception 'Sistem ayarlarını değiştirme yetkiniz yok.';
  end if;
  if p_deger is null or jsonb_typeof(p_deger) <> 'number' then
    raise exception 'Ayar değeri bir sayı olmalıdır.';
  end if;
  v := (p_deger #>> '{}')::numeric;
  case p_anahtar
    when 'kapasite_dakika'        then alt := 60; ust := 44640; ad := 'Aylık kapasite (dakika)';
    when 'kurumlar_vergisi_orani' then alt := 0;  ust := 100;   ad := 'Kurumlar vergisi oranı';
    when 'marj_esigi_yuzde'       then alt := 0;  ust := 100;   ad := 'Kâr marjı eşiği';
    when 'varsayilan_kdv_orani'   then alt := 0;  ust := 100;   ad := 'Varsayılan KDV oranı';
    else raise exception 'Bu ayar buradan değiştirilemez: %', coalesce(p_anahtar, '(boş)');
  end case;
  if v < alt or v > ust then
    raise exception '% % ile % arasında olmalıdır.', ad, alt, ust;
  end if;
  if p_anahtar = 'kapasite_dakika' and v <> trunc(v) then
    raise exception 'Aylık kapasite tam sayı (dakika) olmalıdır.';
  end if;
  if p_gecerlilik is null or extract(day from p_gecerlilik) <> 1 then
    raise exception 'Ayar ayın 1''inden itibaren geçerli olmalıdır.';
  end if;
  if p_gecerlilik < date_trunc('month', app.today_tr())::date then
    raise exception 'Geçmiş aylar için ayar değiştirilemez (raporlar bozulmasın diye). En erken bu ayın 1''inden itibaren geçerli olabilir.';
  end if;
  insert into settings(organization_id, key, value, valid_from)
    values (app.org_id(), p_anahtar, to_jsonb(v), p_gecerlilik)
  on conflict (organization_id, key, valid_from) do update set value = excluded.value
  returning * into sonuc;
  return sonuc;
end $$;

create or replace function public.hizmet_suresi_kurali_ekle(
  p_personel_turu staff_type, p_tehlike hazard_class, p_dakika numeric, p_gecerlilik date, p_not text default null
) returns service_time_rules
language plpgsql as $$
declare acik service_time_rules; yeni service_time_rules;
begin
  if not app.can('settings', 'create') or not app.can('settings', 'edit') then
    raise exception 'Hizmet süresi kurallarını değiştirme yetkiniz yok.';
  end if;
  if p_dakika is null or p_dakika < 0 or p_dakika > 600 then
    raise exception 'Çalışan başına dakika 0 ile 600 arasında olmalıdır.';
  end if;
  if p_gecerlilik is null or extract(day from p_gecerlilik) <> 1 then
    raise exception 'Kural ayın 1''inden itibaren geçerli olmalıdır.';
  end if;
  if p_gecerlilik < date_trunc('month', app.today_tr())::date then
    raise exception 'Geçmiş aylar için kural değiştirilemez (raporlar bozulmasın diye). En erken bu ayın 1''inden itibaren geçerli olabilir.';
  end if;
  if exists (select 1 from service_time_rules where staff_type = p_personel_turu and hazard_class = p_tehlike and valid_from > p_gecerlilik) then
    raise exception 'Bu tarihten sonra başlayan bir kural zaten var.';
  end if;
  select * into acik from service_time_rules
   where staff_type = p_personel_turu and hazard_class = p_tehlike and valid_to is null order by valid_from desc limit 1;
  if found then
    if acik.minutes_per_employee = p_dakika then return acik; end if;
    if p_gecerlilik <= acik.valid_from then
      raise exception 'Yeni kural, mevcut kuralın başlangıcından (%) sonra olmalıdır.', to_char(acik.valid_from, 'DD.MM.YYYY');
    end if;
    update service_time_rules set valid_to = p_gecerlilik - 1 where id = acik.id;
  end if;
  insert into service_time_rules(staff_type, hazard_class, minutes_per_employee, valid_from, note)
    values (p_personel_turu, p_tehlike, p_dakika, p_gecerlilik, nullif(btrim(coalesce(p_not, '')), ''))
  returning * into yeni;
  return yeni;
end $$;

grant execute on function public.ayar_kaydet(text, jsonb, date) to authenticated;
grant execute on function public.hizmet_suresi_kurali_ekle(staff_type, hazard_class, numeric, date, text) to authenticated;
