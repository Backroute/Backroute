-- Supabase stand-in for PostgREST: roles, auth.users, auth.uid() as Supabase defines it.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create role authenticator login password 'authpw' noinherit;
grant anon, authenticated, service_role to authenticator;
create schema auth;
create table auth.users (id uuid primary key, phone text);
create function auth.uid() returns uuid language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''), (nullif(current_setting('request.jwt.claims', true), '')::json ->> 'sub'))::uuid
$$;
grant usage on schema auth to authenticated, anon;
grant execute on function auth.uid() to authenticated, anon;
grant select on auth.users to authenticated;
grant usage on schema public to anon;
