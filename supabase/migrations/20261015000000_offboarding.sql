-- A carrier leaving Backroute: the owner deletes the account (api/account), or support does on a written request
-- (scripts/pilot-carrier.mjs delete). Everything of theirs goes with the carrier row (every table cascades), except:
-- - closed_accounts: that the account existed and when it was closed, for billing questions afterwards.
-- - consent_archive: every driver's yes and no to texts and calls, copied out before the carrier's records go, as the
--   proof of consent the texts were sent under. [Per counsel: how long to keep these; four years is the usual advice.]
-- Both are server-only.
create table if not exists public.closed_accounts (
  carrier_id text primary key,
  name text not null,
  mc text,
  closed_at timestamptz not null default now(),
  closed_by text not null
);
alter table public.closed_accounts enable row level security;
revoke all on public.closed_accounts from anon, authenticated;

create table if not exists public.consent_archive (
  id bigint primary key,
  carrier_id text not null,
  carrier_name text,
  driver_id text not null,
  phone text,
  granted boolean not null,
  via text not null,
  wording text not null,
  version text not null,
  by_user uuid,
  ip text,
  user_agent text,
  at timestamptz not null,
  archived_at timestamptz not null default now()
);
create index if not exists consent_archive_phone on public.consent_archive (phone);
alter table public.consent_archive enable row level security;
revoke all on public.consent_archive from anon, authenticated;

-- Runs before the carrier row goes (and so before its consent records cascade away), however it's deleted.
create or replace function public.archive_consents() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.consent_archive (id, carrier_id, carrier_name, driver_id, phone, granted, via, wording, version, by_user, ip, user_agent, at)
    select c.id, c.carrier_id, old.name, c.driver_id, c.phone, c.granted, c.via, c.wording, c.version, c.by_user, c.ip, c.user_agent, c.at
    from public.driver_consents c where c.carrier_id = old.id
  on conflict (id) do nothing;
  return old;
end $$;
drop trigger if exists archive_consents on public.carriers;
create trigger archive_consents before delete on public.carriers for each row execute function public.archive_consents();

-- The AI's usage counts have no link to the carrier; they go too.
create or replace function public.forget_usage() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  delete from public.usage where carrier_id = old.id;
  return old;
end $$;
drop trigger if exists forget_usage on public.carriers;
create trigger forget_usage after delete on public.carriers for each row execute function public.forget_usage();

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant all on public.closed_accounts, public.consent_archive to service_role;
  end if;
end $$;
