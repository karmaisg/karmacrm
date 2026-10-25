-- =====================================================================
-- OSGB 360 - İlk kurulum (şemadan SONRA, yalnızca BİR KEZ çalıştırılır)
--
-- Önce:
--   1) Supabase > Authentication > Users > "Add user" ile kendi e-posta ve şifrenizle bir kullanıcı oluşturun.
--   2) Oluşan kullanıcının UUID değerini kopyalayın (Users listesinde "User UID").
-- Sonra aşağıdaki 3 değeri düzenleyip SQL Editor'da çalıştırın.
-- =====================================================================

do $$
declare
  v_kullanici_id  uuid := '00000000-0000-0000-0000-000000000000';  -- << BURAYA kendi User UID'nizi yazın
  v_sirket_adi    text := 'ŞİRKET ADINIZ';                          -- << OSGB işletmenizin adı
  v_ad_soyad      text := 'Ad Soyad';                               -- << sizin adınız
  v_eposta        text := 'ornek@eposta.com';                       -- << giriş e-postanız
  v_org           uuid;
begin
  -- Yer tutucu (yalnızca sıfırlardan oluşan kod) değiştirilmemişse dur
  if v_kullanici_id::text ~ '^[0-]+$' then
    raise exception 'Önce v_kullanici_id değerini kendi User UID''niz ile değiştirin.';
  end if;
  if not exists (select 1 from auth.users where id = v_kullanici_id) then
    raise exception 'Bu User UID, Authentication > Users listesinde bulunamadı. UID''yi kontrol edin.';
  end if;
  if exists (select 1 from organizations) then
    raise exception 'Kurulum zaten yapılmış (organizations tablosu dolu).';
  end if;

  insert into organizations(name) values (v_sirket_adi) returning id into v_org;

  -- Roller, yetki matrisi, hizmet süresi parametreleri, ayarlar, gider kategorileri
  perform app.seed_organization(v_org);

  insert into users(id, organization_id, role_id, full_name, email)
  select v_kullanici_id, v_org, r.id, v_ad_soyad, v_eposta
  from roles r where r.organization_id = v_org and r.key = 'isletme_sahibi';

  raise notice 'Kurulum tamam. Kurum: %, ilk kullanıcı: % (işletme sahibi)', v_org, v_eposta;
end $$;
