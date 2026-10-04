-- Lookups kept between server instances (lib/agent/lookup-cache): weather warnings for a spot, a dock's posted hours.
-- Paid or rate-limited services are asked once and the answer shared; server-only, nothing here is per carrier.
create table if not exists public.lookup_cache (
  key text primary key,
  value jsonb not null,
  expires_at timestamptz not null
);
create index if not exists lookup_cache_expires on public.lookup_cache (expires_at);
alter table public.lookup_cache enable row level security;
revoke all on public.lookup_cache from anon, authenticated;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant all on public.lookup_cache to service_role;
  end if;
end $$;
