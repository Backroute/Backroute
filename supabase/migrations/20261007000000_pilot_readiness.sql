-- What a paid pilot needs around the AI: knowing when a piece of the system is down, charging for it, and reaching
-- the owner's phone the moment something needs them. All three tables are server-only: the app reads them through
-- its own API, which checks who's asking.

-- The last time each part of the system checked in (the dispatcher's rounds, the website worker...), and alerts
-- already sent, so support isn't texted about the same outage every five minutes.
create table public.service_heartbeats (
  name text primary key,
  at timestamptz not null default now(),
  data jsonb not null default '{}'::jsonb
);
alter table public.service_heartbeats enable row level security;
revoke all on public.service_heartbeats from anon, authenticated;

-- Each carrier's subscription to Backroute (Stripe). Written only by the server, from Stripe's own signed messages,
-- so no one can mark their own account paid.
create table public.carrier_billing (
  carrier_id text primary key references public.carriers (id) on delete cascade,
  customer_id text unique,
  subscription_id text unique,
  status text not null default 'none' check (status in ('none', 'trialing', 'active', 'past_due', 'unpaid', 'canceled', 'incomplete')),
  trucks integer not null default 0,
  current_period_end timestamptz,
  trial_end timestamptz,
  past_due_since timestamptz,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.carrier_billing enable row level security;
revoke all on public.carrier_billing from anon, authenticated;

-- Phones and browsers that asked for push notifications: one row per device, for the person and carrier.
create table public.push_subscriptions (
  endpoint text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  carrier_id text not null references public.carriers (id) on delete cascade,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now(),
  last_ok_at timestamptz
);
create index on public.push_subscriptions (carrier_id);
alter table public.push_subscriptions enable row level security;
revoke all on public.push_subscriptions from anon, authenticated;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant all on public.service_heartbeats, public.carrier_billing, public.push_subscriptions to service_role;
  end if;
end $$;
