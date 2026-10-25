-- SADECE YEREL TEST İÇİN: Supabase'in hazır sağladığı auth şemasını ve rolleri taklit eder.
-- Supabase'e YÜKLENMEZ.
do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
end $$;
create schema auth;
create table auth.users (id uuid primary key default gen_random_uuid(), email text);
-- Supabase'in gerçek auth.uid() tanımıyla aynı mantık (PostgREST 'request.jwt.claims' JSON'unu da okur)
create function auth.uid() returns uuid language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid $$;
grant usage on schema auth to anon, authenticated;
grant usage on schema public to anon, authenticated;
-- Supabase varsayılanı: public şemasındaki yeni tablolara anon/authenticated tam yetki verilir (RLS sınırlar)
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant all on sequences to anon, authenticated;
