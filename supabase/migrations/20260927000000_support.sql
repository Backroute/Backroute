-- Backroute's own support team: the people who step in when something is outside what the AI can handle, for every
-- carrier. Added by hand (see DEPLOY.md), never by the app. Only the server reads this table.
create table public.support_staff (
  user_id uuid primary key references auth.users (id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);
alter table public.support_staff enable row level security;
revoke all on public.support_staff from anon, authenticated;

-- A carrier's keys for outside services the AI reads from: their ELD (Samsara, Motive) and load feeds. Secrets, so
-- no one reads them back through the app, not even the owner; the server uses them and the owner can replace them.
create table public.carrier_integrations (
  carrier_id text not null references public.carriers (id) on delete cascade,
  kind text not null check (kind in ('samsara', 'motive', 'load_feed')),
  config jsonb not null default '{}',
  status text,
  checked_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (carrier_id, kind)
);
alter table public.carrier_integrations enable row level security;
revoke all on public.carrier_integrations from anon, authenticated;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant all on public.support_staff, public.carrier_integrations to service_role;
  end if;
end $$;
