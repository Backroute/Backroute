-- Minimal stand-in for Supabase: its roles, auth.users, and auth.uid() read from the request's JWT subject.
create role anon nologin;
create role authenticated nologin;
create schema auth;
create table auth.users (id uuid primary key, phone text);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth to authenticated, anon;
grant execute on function auth.uid() to authenticated, anon;
grant select on auth.users to authenticated;
