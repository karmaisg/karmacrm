-- OSGB 360 - Aşama 30: İSG-Katip aktarımlarından aylık hizmet verilen personel (çalışan) sayısı
-- Her aktarımın dönemi (ay) için, işyeri (SGK sicil) başına tek çalışan sayısı; firma ve tehlike sınıfına göre toplanır.
-- Aynı dönem birden fazla yüklendiyse en son yükleme esas alınır. RLS geçerlidir (security invoker): yetkisi olmayan boş sonuç görür.
-- Yeniden çalıştırılabilir.
create or replace function public.katip_aylik_calisan() returns jsonb
language sql stable security invoker set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('period', t.period, 'company_id', t.company_id, 'hazard_class', t.hazard_class, 'employee_count', t.n)
                            order by t.period, t.company_id), '[]'::jsonb)
  from (
    select p.period, p.company_id, p.hazard_class, sum(p.employee_count)::int as n
    from (
      select distinct on (i.period, r.sgk_no) i.period, s.company_id, r.hazard_class, r.employee_count
      from katip_rows r
      join katip_imports i on i.id = r.import_id
      left join company_sites s on s.id = r.site_id
      order by i.period, r.sgk_no, i.created_at desc
    ) p
    where p.company_id is not null
    group by p.period, p.company_id, p.hazard_class
  ) t;
$$;
revoke all on function public.katip_aylik_calisan() from public, anon;
grant execute on function public.katip_aylik_calisan() to authenticated;
notify pgrst, 'reload schema';
