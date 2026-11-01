-- OSGB 360 - Aşama 14: İSG-Katip görevlendirmelerini Uzmanlar/Hekimler ve Görevlendirmeler'e yansıtma.
-- Katip'ten gelen görevli kişiler sertifika numarasıyla personele bağlanır (yoksa yeni personel açılır), firma bazında hizmet payları
-- (Katip dakikası / firmanın teorik ihtiyacı) görevlendirme olarak eklenir, değiştirilir veya bitirilir.
-- Her şey önizleme + onay sonrası, TEK işlemde (hata her şeyi geri alır). Güvenle yeniden çalıştırılabilir.

alter table employees add column if not exists certificate_no text;
create unique index if not exists employees_certificate_uq on employees (organization_id, certificate_no) where certificate_no is not null and archived_at is null;
alter table katip_imports add column if not exists assigned_at timestamptz;
alter table katip_imports add column if not exists assign_summary jsonb;

-- Paket: { yukleme_id, tarih, kisiler:[{ref, ad, tur, sertifika_tipi, sertifika_no}], baglar:[{employee_id, sertifika_no}],
--          islemler:[{islem:'bitir'|'degistir'|'ekle', assignment_id, company_id, employee_id|employee_ref, tur, pay, resmi_ref, resmi_baslangic}] }
-- İşlem sırası paket sırasıdır: önce bitirme, sonra pay azaltma, sonra artırma/ekleme (toplam pay %100'ü aşmasın diye istemci sıralar).
create or replace function public.katip_gorevlendir(p_paket jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := app.org_id(); v_tarih date; v_imp uuid;
  v_ref jsonb := '{}'::jsonb;
  r jsonb; e employees%rowtype; a assignments%rowtype; v_emp uuid; v_bas date; v_firma uuid; v_pay numeric;
  n_kisi int := 0; n_bag int := 0; n_ekle int := 0; n_degis int := 0; n_bitir int := 0;
begin
  if v_org is null then raise exception 'Oturum bulunamadı.'; end if;
  if not (app.can('assignments', 'create') and app.can('assignments', 'edit') and app.can('staff', 'create')) then
    raise exception 'Bu işlem için görevlendirme ve personel ekleme/düzenleme yetkisi gerekir.';
  end if;
  v_tarih := (p_paket ->> 'tarih')::date;
  v_imp := nullif(p_paket ->> 'yukleme_id', '')::uuid;
  if v_tarih is null then raise exception 'Geçerlilik tarihi zorunludur.'; end if;
  if v_imp is not null and not exists (select 1 from katip_imports where id = v_imp and organization_id = v_org) then
    raise exception 'Yükleme bulunamadı.';
  end if;
  if jsonb_array_length(coalesce(p_paket -> 'islemler', '[]')) > 3000 then raise exception 'İşlem sayısı çok fazla; bölün.'; end if;

  -- 1) mevcut personele sertifika numarası bağla
  for r in select * from jsonb_array_elements(coalesce(p_paket -> 'baglar', '[]')) loop
    update employees set certificate_no = r ->> 'sertifika_no'
     where id = (r ->> 'employee_id')::uuid and organization_id = v_org and (certificate_no is null or certificate_no = r ->> 'sertifika_no');
    if found then n_bag := n_bag + 1; end if;
  end loop;

  -- 2) yeni personel
  for r in select * from jsonb_array_elements(coalesce(p_paket -> 'kisiler', '[]')) loop
    if (r ->> 'tur') not in ('is_guvenligi_uzmani', 'isyeri_hekimi') then raise exception 'Personel türü geçersiz: %', r ->> 'tur'; end if;
    insert into employees(full_name, staff_type, title, qualifications, certificate_no, is_active, notes)
    values (btrim(r ->> 'ad'), (r ->> 'tur')::staff_type, left(r ->> 'sertifika_tipi', 120), nullif(r ->> 'sertifika_no', ''), nullif(r ->> 'sertifika_no', ''), true, 'İSG-Katip aktarımı ile oluşturuldu')
    returning id into v_emp;
    v_ref := v_ref || jsonb_build_object(r ->> 'ref', v_emp);
    n_kisi := n_kisi + 1;
  end loop;

  -- 3) görevlendirme işlemleri
  for r in select * from jsonb_array_elements(coalesce(p_paket -> 'islemler', '[]')) loop
    if (r ->> 'islem') = 'bitir' then
      select * into a from assignments where id = (r ->> 'assignment_id')::uuid and organization_id = v_org and archived_at is null;
      if not found then raise exception 'Bitirilecek görevlendirme bulunamadı.'; end if;
      if a.valid_from > v_tarih - 1 then
        update assignments set archived_at = now() where id = a.id;           -- henüz başlamamış: arşivle
      else
        update assignments set valid_to = v_tarih - 1 where id = a.id and (valid_to is null or valid_to > v_tarih - 1);
      end if;
      n_bitir := n_bitir + 1;
    elsif (r ->> 'islem') = 'degistir' then
      v_pay := (r ->> 'pay')::numeric;
      if v_pay is null or v_pay <= 0 or v_pay > 100 then raise exception 'Pay 0 ile 100 arasında olmalıdır.'; end if;
      select * into a from assignments where id = (r ->> 'assignment_id')::uuid and organization_id = v_org and archived_at is null;
      if not found then raise exception 'Değiştirilecek görevlendirme bulunamadı.'; end if;
      v_bas := greatest(v_tarih, a.valid_from + 1);
      update assignments set valid_to = v_bas - 1 where id = a.id;
      insert into assignments(company_id, employee_id, staff_type, share_pct, valid_from, valid_to, official_ref, official_start, official_end, notes)
      values (a.company_id, a.employee_id, a.staff_type, v_pay, v_bas, a.valid_to, coalesce(nullif(r ->> 'resmi_ref', ''), a.official_ref),
              coalesce(nullif(r ->> 'resmi_baslangic', '')::date, a.official_start), a.official_end, 'İSG-Katip aktarımı: pay güncellendi');
      n_degis := n_degis + 1;
    elsif (r ->> 'islem') = 'ekle' then
      v_pay := (r ->> 'pay')::numeric;
      if v_pay is null or v_pay <= 0 or v_pay > 100 then raise exception 'Pay 0 ile 100 arasında olmalıdır.'; end if;
      v_emp := coalesce(nullif(r ->> 'employee_id', '')::uuid, (v_ref ->> (r ->> 'employee_ref'))::uuid);
      v_firma := (r ->> 'company_id')::uuid;
      if v_emp is null then raise exception 'Görevlendirme için personel belirtilmemiş.'; end if;
      if not exists (select 1 from companies where id = v_firma and organization_id = v_org) then raise exception 'Firma bulunamadı.'; end if;
      select * into e from employees where id = v_emp and organization_id = v_org;
      if not found then raise exception 'Personel bulunamadı.'; end if;
      insert into assignments(company_id, employee_id, staff_type, share_pct, valid_from, official_ref, official_start, notes)
      values (v_firma, v_emp, e.staff_type, v_pay, v_tarih, left(nullif(r ->> 'resmi_ref', ''), 200), nullif(r ->> 'resmi_baslangic', '')::date, 'İSG-Katip aktarımı');
      n_ekle := n_ekle + 1;
    else
      raise exception 'Bilinmeyen işlem: %', r ->> 'islem';
    end if;
  end loop;

  if v_imp is not null then
    update katip_imports set assigned_at = now(), assign_summary = jsonb_build_object('yeni_personel', n_kisi, 'eklenen', n_ekle, 'degisen', n_degis, 'biten', n_bitir) where id = v_imp;
  end if;
  return jsonb_build_object('yeni_personel', n_kisi, 'sertifika_baglanan', n_bag, 'eklenen', n_ekle, 'degisen', n_degis, 'biten', n_bitir);
end $$;

revoke all on function public.katip_gorevlendir(jsonb) from public, anon;
grant execute on function public.katip_gorevlendir(jsonb) to authenticated;
notify pgrst, 'reload schema';
