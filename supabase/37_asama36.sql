-- ============================================================================
-- Aşama 36 — Patlamadan Korunma Dokümanı teklifi (spot iş teklifi) ve günlük özette "Geçmiş Hatırlatmalar"
-- * offers.offer_type: 'osgb' (varsayılan) | 'patlamadan_korunma'. Patlamadan korunma teklifinde çalışan sayısı, tehlike sınıfı,
--   kişi başı fiyat ve maliyet tahmini yoktur; yalnızca tek seferlik hizmet bedeli (service_fee), KDV, açıklama ve kapsam (scope) vardır.
-- * Patlamadan korunma teklifi sözleşmeye çevrilmez (aylık sözleşme değildir); teklif "kabul edildi" olarak işaretlenir.
-- * gunluk_ozet: son 90 günde "yapıldı" işaretlenmemiş takvim kayıtları ('gecmis_hatirlatma') ve gecikme günü.
-- Tekrar çalıştırılabilir. Önce 36_asama35.sql çalışmış olmalıdır.
-- ============================================================================

alter table offers add column if not exists offer_type  text not null default 'osgb';
alter table offers add column if not exists service_fee numeric(14,2);
alter table offers add column if not exists scope       text;
alter table offers drop constraint if exists offers_offer_type_check;
alter table offers add constraint offers_offer_type_check check (offer_type in ('osgb', 'patlamadan_korunma'));
alter table offers drop constraint if exists offers_service_fee_check;
alter table offers add constraint offers_service_fee_check check (service_fee is null or service_fee >= 0);
alter table offers drop constraint if exists offers_scope_check;
alter table offers add constraint offers_scope_check check (scope is null or char_length(scope) <= 4000);
alter table offers alter column employee_count drop not null;
alter table offers alter column hazard_class drop not null;
alter table offers drop constraint if exists offers_tur_alanlari_check;
alter table offers add constraint offers_tur_alanlari_check check (
  (offer_type = 'osgb' and employee_count is not null and hazard_class is not null)
  or (offer_type = 'patlamadan_korunma' and service_fee is not null and pricing = 'ozel'));

-- Mevcut yazma tetikleyicisi: "özel fiyatlama" kontrolü yalnızca OSGB teklifine uygulanır; yeni alanlar gönderilmiş teklifte değiştirilemez
do $$
declare d text;
begin
  select pg_get_functiondef('app.offer_before_write()'::regprocedure) into d;
  if d not like '%new.offer_type%' then
    d := replace(d, 'if new.pricing = ''ozel'' and new.unit_price is null', 'if new.offer_type = ''osgb'' and new.pricing = ''ozel'' and new.unit_price is null');
    d := replace(d, 'or new.offer_date is distinct from old.offer_date)', 'or new.offer_date is distinct from old.offer_date or new.offer_type is distinct from old.offer_type or new.service_fee is distinct from old.service_fee or new.scope is distinct from old.scope)');
    if d not like '%new.offer_type = ''osgb''%' or d not like '%new.service_fee is distinct%' then raise exception 'offer_before_write güncellenemedi (beklenen metin bulunamadı).'; end if;
    execute d;
  end if;
end $$;

-- Patlamadan korunma teklifinin ek doğrulaması
create or replace function app.offer_tur_kontrol() returns trigger language plpgsql as $$
begin
  if new.offer_type = 'patlamadan_korunma' then
    if new.service_fee is null or new.service_fee < 0 then raise exception 'Hizmet bedeli zorunludur ve negatif olamaz.'; end if;
    if coalesce(new.discount_pct, 0) <> 0 then raise exception 'Patlamadan korunma teklifinde indirim oranı kullanılmaz.'; end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_offers_tur on offers;
create trigger trg_offers_tur before insert or update on offers for each row execute function app.offer_tur_kontrol();

-- Patlamadan korunma teklifi sözleşmeye çevrilemez
create or replace function app.sozlesme_teklif_turu_kontrol() returns trigger language plpgsql as $$
begin
  if new.offer_id is not null and exists (select 1 from offers o where o.id = new.offer_id and o.offer_type <> 'osgb') then
    raise exception 'Patlamadan korunma teklifi için sözleşme oluşturulmaz; teklifi "kabul edildi" olarak işaretleyin.';
  end if;
  return new;
end $$;
drop trigger if exists trg_contracts_teklif_turu on contracts;
create trigger trg_contracts_teklif_turu before insert on contracts for each row execute function app.sozlesme_teklif_turu_kontrol();

-- Teklif kopyalama: yeni alanlar da kopyalanır
create or replace function public.teklif_kopyala(p_offer uuid)
returns offers
language plpgsql as $$
declare o offers; n offers;
begin
  if not app.can('offers', 'create') then raise exception 'Teklif ekleme yetkiniz yok.'; end if;
  select * into o from offers where id = p_offer;
  if not found then raise exception 'Teklif bulunamadı.'; end if;
  insert into offers(company_id, lead_id, opportunity_id, employee_count, hazard_class, pricing, unit_price, fixed_monthly_price,
                     vat_mode, vat_rate, discount_pct, est_expert_cost, est_physician_cost, est_travel_other_cost, description,
                     offer_type, service_fee, scope)
  values (o.company_id, o.lead_id, o.opportunity_id, o.employee_count, o.hazard_class, o.pricing, o.unit_price, o.fixed_monthly_price,
          o.vat_mode, o.vat_rate, o.discount_pct, o.est_expert_cost, o.est_physician_cost, o.est_travel_other_cost, o.description,
          o.offer_type, o.service_fee, o.scope)
  returning * into n;
  insert into offer_items(offer_id, description, quantity, unit_price, vat_mode, vat_rate)
  select n.id, description, quantity, unit_price, vat_mode, vat_rate from offer_items where offer_id = o.id and archived_at is null;
  return n;
end $$;

-- Müşteri teklif sayfası: teklif türü, hizmet bedeli, açıklama ve kapsam eklenir
create or replace function public.teklif_paylasim_goruntule(p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s offer_shares; o offers; v_alici text; v_kurum text; v_kalemler jsonb; v_bugun date := app.today_tr();
begin
  s := app.paylasim_bul(p_token);
  if s.id is null then return jsonb_build_object('durum', 'gecersiz'); end if;
  select * into o from offers where id = s.offer_id;
  select name into v_kurum from organizations where id = o.organization_id;
  select coalesce((select name from companies where id = o.company_id), (select name from leads where id = o.lead_id)) into v_alici;
  select coalesce(jsonb_agg(jsonb_build_object('aciklama', i.description, 'miktar', i.quantity, 'birim_fiyat', i.unit_price,
                                               'kdv_modu', i.vat_mode, 'kdv_orani', i.vat_rate) order by i.created_at), '[]'::jsonb)
    into v_kalemler from offer_items i where i.offer_id = o.id and i.archived_at is null;

  update offer_shares set view_count = view_count + 1, last_viewed_at = now(), first_viewed_at = coalesce(first_viewed_at, now()) where id = s.id;

  return jsonb_build_object(
    'durum', 'gecerli',
    'kurum', v_kurum, 'alici', v_alici, 'teklif_no', o.offer_no, 'teklif_tarihi', o.offer_date, 'gecerlilik', o.valid_until,
    'calisan_sayisi', o.employee_count, 'tehlike', o.hazard_class, 'fiyatlama', o.pricing,
    'birim_fiyat', o.unit_price, 'sabit_fiyat', o.fixed_monthly_price, 'kdv_modu', o.vat_mode, 'kdv_orani', o.vat_rate, 'indirim', o.discount_pct,
    'teklif_turu', o.offer_type, 'hizmet_bedeli', o.service_fee,
    'aciklama', case when o.offer_type = 'patlamadan_korunma' then o.description end, 'kapsam', case when o.offer_type = 'patlamadan_korunma' then o.scope end,   -- OSGB tekliflerinde iç açıklama müşteriye gitmez
    'kalemler', v_kalemler, 'musteri_notu', s.customer_note,
    'teklif_durumu', case when o.status in ('kabul_edildi', 'reddedildi', 'suresi_doldu') then o.status::text else 'acik' end,
    'sure_bitti', (o.valid_until is not null and o.valid_until < v_bugun),
    'yanit', case when s.response is null then null else jsonb_build_object('karar', s.response, 'tarih', s.responded_at, 'ad', s.responder_name) end,
    'yanit_verilebilir', (s.response is null and o.status in ('gonderildi', 'gorusuluyor') and (o.valid_until is null or o.valid_until >= v_bugun))
  );
end $$;
revoke all on function public.teklif_paylasim_goruntule(text) from public;
grant execute on function public.teklif_paylasim_goruntule(text) to anon, authenticated;

-- Günlük özet: Geçmiş Hatırlatmalar
create or replace function public.gunluk_ozet(p_org uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  bugun date := app.today_tr();
  acik jsonb; gecikmis jsonb; yaklasan jsonb; sozlesme jsonb; gorev jsonb; bugun_liste jsonb; program jsonb; gecmis jsonb;
begin
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

  -- yalnızca gecikmiş görevler
  select jsonb_build_object(
           'adet', count(*),
           'liste', coalesce(jsonb_agg(jsonb_build_object('baslik', baslik, 'firma', firma, 'son', son, 'oncelik', oncelik, 'gecikmis', true) order by son, baslik) filter (where sira <= 10), '[]'::jsonb))
    into gorev
    from (select t.title as baslik, c.name as firma, (t.due_at at time zone 'Europe/Istanbul')::date as son, t.priority::text as oncelik,
                 row_number() over (order by t.due_at, t.title) as sira
            from tasks t left join companies c on c.id = t.company_id
           where t.organization_id = p_org and t.archived_at is null and t.status in ('acik', 'devam_ediyor')
             and t.due_at is not null and (t.due_at at time zone 'Europe/Istanbul')::date < bugun) g;

  -- Bugün Yapılacaklar: bugüne ait yapılmamış takvim kayıtları ve görev son/hatırlatma tarihleri
  select jsonb_build_object(
           'adet', count(*),
           'liste', coalesce(jsonb_agg(jsonb_build_object('baslik', baslik, 'firma', firma, 'tutar', tutar, 'tur', tur, 'kaynak', kaynak) order by tur, baslik) filter (where sira <= 15), '[]'::jsonb))
    into bugun_liste
    from (select o.*, row_number() over (order by o.tur, o.baslik) as sira from app.takvim_olaylari(p_org, bugun, bugun) o where not o.tamam) g;

  -- Yaklaşan Program: yarından başlayarak 3 gün
  select jsonb_build_object(
           'adet', count(*),
           'liste', coalesce(jsonb_agg(jsonb_build_object('tarih', tarih, 'kalan_gun', tarih - bugun, 'baslik', baslik, 'firma', firma, 'tutar', tutar, 'tur', tur, 'kaynak', kaynak) order by tarih, tur, baslik) filter (where sira <= 20), '[]'::jsonb))
    into program
    from (select o.*, row_number() over (order by o.tarih, o.tur, o.baslik) as sira from app.takvim_olaylari(p_org, bugun + 1, bugun + 3) o where not o.tamam) g;

  -- Geçmiş Hatırlatmalar: son 90 günde tarihi geçmiş, "yapıldı" işaretlenmemiş takvim kayıtları (hatırlatma ve ödemeler); kaç gün geciktiği ile
  select jsonb_build_object(
           'adet', count(*),
           'liste', coalesce(jsonb_agg(jsonb_build_object('tarih', tarih, 'gecikme_gun', bugun - tarih, 'baslik', baslik, 'firma', firma, 'tutar', tutar, 'tur', tur) order by tarih, tur, baslik) filter (where sira <= 15), '[]'::jsonb))
    into gecmis
    from (select o.*, row_number() over (order by o.tarih, o.tur, o.baslik) as sira
            from app.takvim_olaylari(p_org, bugun - 90, bugun - 1) o where o.kaynak = 'takvim' and not o.tamam) g;

  return jsonb_build_object('tarih', bugun, 'gecikmis_fatura', gecikmis, 'yaklasan_vade', yaklasan, 'sozlesme', sozlesme, 'gorev', gorev,
                            'bugun', bugun_liste, 'program', program, 'gecmis_hatirlatma', gecmis);
end $$;
revoke all on function public.gunluk_ozet(uuid) from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.gunluk_ozet(uuid) to service_role;
  end if;
end $$;
