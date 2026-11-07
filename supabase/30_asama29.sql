-- OSGB 360 - Aşama 29: firma dışı kişiler (mülk sahibi, bina yönetimi, avukat, mali müşavir ...)
--   * contacts.contact_type : kişinin türü. 'firma' = firma/potansiyel müşteri yetkilisi (eski davranış).
--   * Firma dışı türlerde firma/potansiyel müşteri bağı zorunlu değildir (isteğe bağlı ilişkilendirilebilir).
-- Yeniden çalıştırılabilir.
alter table contacts add column if not exists contact_type text not null default 'firma';

do $$
declare r record;
begin
  for r in select conname from pg_constraint where conrelid = 'contacts'::regclass and contype = 'c'
            and (pg_get_constraintdef(oid) ilike '%company_id IS NOT NULL%lead_id IS NOT NULL%' or conname = 'contacts_tur_check' or conname = 'contacts_baglanti_check') loop
    execute format('alter table contacts drop constraint %I', r.conname);
  end loop;
end $$;

alter table contacts add constraint contacts_tur_check
  check (contact_type in ('firma', 'mulk_sahibi', 'bina_yonetimi', 'avukat', 'mali_musavir', 'diger'));
alter table contacts add constraint contacts_baglanti_check
  check (contact_type <> 'firma' or company_id is not null or lead_id is not null);

notify pgrst, 'reload schema';
