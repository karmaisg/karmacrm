-- OSGB 360 - Aşama 12.1: müşteri teklif yanıtı gelince YALNIZCA işletme sahibine e-posta.
-- Çalışma şekli: müşteri yanıtını kaydedince veri tabanı, Edge Function'ı (gunluk-ozet) pg_net ile çağırır; e-postayı fonksiyon
-- OZET_ALICI adresine gönderir. Müşteriye hiçbir şey gönderilmez.
-- Gerekli iki gizli kayıt (Vault): 'ozet_cron_sirri' (Aşama 10'da oluşturuldu) ve 'ozet_fonksiyon_adresi' (bu aşamada, docs'a bakın).
-- Bunlar yoksa ya da pg_net kapalıysa yanıt yine kaydedilir ve görev düşer; yalnızca e-posta gitmez. Güvenle yeniden çalıştırılabilir.

alter table email_digest_log add column if not exists kaynak text;
alter table email_digest_log drop constraint if exists email_digest_log_tur_check;
alter table email_digest_log add constraint email_digest_log_tur_check check (tur in ('gunluk', 'test', 'yanit'));
-- Bir müşteri yanıtı için en çok bir başarılı bildirim e-postası
create unique index if not exists email_digest_log_yanit_uq on email_digest_log(organization_id, kaynak)
  where tur = 'yanit' and durum = 'gonderildi';

create or replace function app.sahibe_yanit_bildir(p_share uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_url text; v_sir text;
begin
  begin
    select decrypted_secret into v_url from vault.decrypted_secrets where name = 'ozet_fonksiyon_adresi';
    select decrypted_secret into v_sir from vault.decrypted_secrets where name = 'ozet_cron_sirri';
    if v_url is null or v_sir is null then return; end if;
    perform net.http_post(url := v_url,
                          headers := jsonb_build_object('Content-Type', 'application/json', 'x-ozet-sirri', v_sir),
                          body := jsonb_build_object('olay', 'teklif_yaniti', 'paylasim', p_share::text));
  exception when others then
    null;   -- bildirim kurulu değilse ya da başarısızsa müşterinin yanıtı yine de kaydedilir
  end;
end $$;
revoke all on function app.sahibe_yanit_bildir(uuid) from public, anon, authenticated;

create or replace function public.teklif_paylasim_yanitla(p_token text, p_karar text, p_ad text, p_not text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s offer_shares; o offers; v_ad text; v_not text; v_atanan uuid; v_baslik text; v_acik text;
begin
  s := app.paylasim_bul(p_token, true);
  if s.id is null then raise exception 'Bu bağlantı geçersiz ya da süresi dolmuş.'; end if;
  select * into o from offers where id = s.offer_id for update;
  if s.response is not null then raise exception 'Bu teklife zaten yanıt verilmiş. Değişiklik için lütfen bizimle iletişime geçin.'; end if;
  if o.status not in ('gonderildi', 'gorusuluyor') then raise exception 'Bu teklif artık yanıt kabul etmiyor. Lütfen bizimle iletişime geçin.'; end if;
  if o.valid_until is not null and o.valid_until < app.today_tr() then raise exception 'Teklifin geçerlilik süresi dolmuş. Lütfen bizimle iletişime geçin.'; end if;
  if p_karar is null or p_karar not in ('kabul', 'red') then raise exception 'Geçersiz yanıt.'; end if;
  v_ad := btrim(regexp_replace(coalesce(p_ad, ''), '[[:cntrl:]]+', ' ', 'g'));
  if char_length(v_ad) < 2 or char_length(v_ad) > 80 then raise exception 'Lütfen adınızı ve soyadınızı yazın (2-80 karakter).'; end if;
  v_not := nullif(btrim(regexp_replace(coalesce(p_not, ''), '[\x00-\x08\x0b\x0c\x0e-\x1f]', '', 'g')), '');
  if v_not is not null and char_length(v_not) > 500 then raise exception 'Notunuz en çok 500 karakter olabilir.'; end if;

  update offer_shares set response = p_karar, responded_at = now(), responder_name = v_ad, responder_note = v_not where id = s.id;

  select id into v_atanan from users where id = o.created_by and organization_id = o.organization_id and is_active;
  v_baslik := case when p_karar = 'kabul' then 'Müşteri teklifi KABUL ETTİ: ' else 'Müşteri teklifi reddetti: ' end || o.offer_no;
  v_acik := 'Yanıtlayan: ' || v_ad || case when v_not is not null then E'\nNot: ' || v_not else '' end ||
            case when p_karar = 'kabul' then E'\nSözleşmeyi oluşturmak için teklif sayfasından "Kabul edildi, sözleşme oluştur"u kullanın.'
                 else E'\nGerekirse müşteriyle görüşüp teklif durumunu güncelleyin.' end;
  insert into tasks(organization_id, kind, title, company_id, lead_id, assignee, priority, due_at, status, description, source_ref)
  values (o.organization_id, 'teklif_takibi', v_baslik, o.company_id, o.lead_id, v_atanan, 'yuksek', now(), 'acik', v_acik, 'offer_share:' || s.id::text)
  on conflict do nothing;
  -- Sahibe e-posta (yalnızca sahibe; başarısız olsa da müşterinin yanıtı kaydedilmiş kalır)
  perform app.sahibe_yanit_bildir(s.id);
  return jsonb_build_object('ok', true, 'karar', p_karar);
end $$;

revoke all on function public.teklif_paylasim_yanitla(text, text, text, text) from public;
grant execute on function public.teklif_paylasim_yanitla(text, text, text, text) to anon, authenticated;

notify pgrst, 'reload schema';
