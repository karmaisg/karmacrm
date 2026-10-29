-- =====================================================================
-- OSGB 360 - Aşama 10 eki (günlük özet e-postası: yalnızca işletme sahibine)
--
-- 01_sema.sql ... 09_asama9.sql çalıştırıldıktan SONRA, BİR KEZ çalıştırılır.
-- Mevcut verilere dokunmaz. Tekrar çalıştırmak zarar vermez.
--
--   1) email_digest_log : gönderim kayıtları (başarılı / atlandı / hata). Yalnızca sunucu işlevi yazar;
--      "ayarlar" görüntüleme izni olanlar okur. Aynı gün için tek başarılı günlük gönderim.
--   2) gunluk_ozet(org) : özet verisi (vadesi geçmiş faturalar, 7 gün içinde vadesi gelenler,
--      90 gün içinde biten sözleşmeler, bugün/gecikmiş görevler). YALNIZCA sunucu (service_role) çağırabilir.
-- Müşterilere hiçbir şey gönderilmez; mesajın tek alıcısı sunucu işlevinin gizli ayarındaki adrestir.
-- =====================================================================

create table if not exists email_digest_log (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references organizations(id),
  gun              date not null,                      -- İstanbul günü
  tur              text not null check (tur in ('gunluk', 'test')),
  durum            text not null check (durum in ('gonderildi', 'atlandi', 'hata')),
  ayrinti          text,
  created_at       timestamptz not null default now()
);
create unique index if not exists email_digest_log_gun_uq on email_digest_log(organization_id, gun)
  where tur = 'gunluk' and durum = 'gonderildi';
create index if not exists email_digest_log_org_idx on email_digest_log(organization_id, created_at desc);

alter table email_digest_log enable row level security;
drop policy if exists email_digest_log_sel on email_digest_log;
create policy email_digest_log_sel on email_digest_log for select to authenticated
  using (organization_id = app.org_id() and app.can('settings', 'view'));
revoke insert, update, delete on email_digest_log from anon, authenticated;

-- Özet verisi. Tutarlar KDV dahil kalan tutardır. Listeler en fazla 10 satırdır; "adet" ve "toplam" tümünü kapsar.
create or replace function public.gunluk_ozet(p_org uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  bugun date := app.today_tr();
  acik jsonb; gecikmis jsonb; yaklasan jsonb; sozlesme jsonb; gorev jsonb;
begin
  -- açık (kalanı olan) faturalar, bir kez hesaplanır
  select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) into acik from (
    select i.invoice_no as no, c.name as firma, i.due_date as vade, i.flag::text as isaret,
           i.amount_incl_vat - coalesce((select sum(p.amount) from payments p where p.invoice_id = i.id and p.archived_at is null), 0) as kalan
      from invoices i join companies c on c.id = i.company_id
     where i.organization_id = p_org and i.archived_at is null) x
   where x.kalan > 0;

  select jsonb_build_object(
           'adet', count(*), 'toplam', coalesce(round(sum(kalan), 2), 0),
           'liste', coalesce(jsonb_agg(jsonb_build_object('no', no, 'firma', firma, 'vade', vade, 'kalan', round(kalan, 2), 'gun', bugun - vade, 'isaret', isaret) order by vade, no) filter (where sira <= 10), '[]'::jsonb))
    into gecikmis
    from (select f.*, row_number() over (order by f.vade, f.no) as sira
            from jsonb_to_recordset(acik) as f(no text, firma text, vade date, kalan numeric, isaret text) where f.vade < bugun) g;

  select jsonb_build_object(
           'adet', count(*), 'toplam', coalesce(round(sum(kalan), 2), 0),
           'liste', coalesce(jsonb_agg(jsonb_build_object('no', no, 'firma', firma, 'vade', vade, 'kalan', round(kalan, 2), 'gun', vade - bugun, 'isaret', isaret) order by vade, no) filter (where sira <= 10), '[]'::jsonb))
    into yaklasan
    from (select f.*, row_number() over (order by f.vade, f.no) as sira
            from jsonb_to_recordset(acik) as f(no text, firma text, vade date, kalan numeric, isaret text) where f.vade >= bugun and f.vade <= bugun + 7) g;

  select jsonb_build_object(
           'adet', count(*),
           'liste', coalesce(jsonb_agg(jsonb_build_object('firma', firma, 'bitis', end_date, 'kalan_gun', end_date - bugun) order by end_date, firma) filter (where sira <= 10), '[]'::jsonb))
    into sozlesme
    from (select c.name as firma, k.end_date, row_number() over (order by k.end_date, c.name) as sira
            from contracts k join companies c on c.id = k.company_id
           where k.organization_id = p_org and k.archived_at is null and k.status = 'aktif' and k.end_date <= bugun + 90) s;

  select jsonb_build_object(
           'adet', count(*),
           'liste', coalesce(jsonb_agg(jsonb_build_object('baslik', baslik, 'firma', firma, 'son', son, 'oncelik', oncelik, 'gecikmis', son < bugun) order by son, baslik) filter (where sira <= 10), '[]'::jsonb))
    into gorev
    from (select t.title as baslik, c.name as firma, (t.due_at at time zone 'Europe/Istanbul')::date as son, t.priority::text as oncelik,
                 row_number() over (order by t.due_at, t.title) as sira
            from tasks t left join companies c on c.id = t.company_id
           where t.organization_id = p_org and t.archived_at is null and t.status in ('acik', 'devam_ediyor')
             and t.due_at is not null and (t.due_at at time zone 'Europe/Istanbul')::date <= bugun) g;

  return jsonb_build_object('tarih', bugun, 'gecikmis_fatura', gecikmis, 'yaklasan_vade', yaklasan, 'sozlesme', sozlesme, 'gorev', gorev);
end $$;

revoke all on function public.gunluk_ozet(uuid) from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.gunluk_ozet(uuid) to service_role;
    grant select, insert on email_digest_log to service_role;
  end if;
end $$;
