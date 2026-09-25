-- Real channels: the AI dispatcher texting, calling and emailing on the carrier's behalf.
--
-- The server (service role) writes everything that comes in from Twilio and the email provider. It bypasses RLS,
-- so every server query filters by carrier itself. People in the app read what their role allows, as before.

-- Find a driver from the number a text or call came from: the last 10 digits, however the number was typed.
alter table public.drivers
  add column phone_last10 text generated always as (right(regexp_replace(coalesce(phone, ''), '\D', '', 'g'), 10)) stored;
create index on public.drivers (phone_last10);

-- The owner's phone gets the end-of-day text; the inbound key routes broker email to the right carrier.
alter table public.carriers add column owner_phone text;
alter table public.carriers add column inbound_key text not null default substr(md5(random()::text || clock_timestamp()::text), 1, 12);
create unique index on public.carriers (inbound_key);

-- Sign-up now also records the owner's phone from their sign-in.
create or replace function public.create_carrier(p_id text, p_name text, p_mc text, p_dot text, p_owner_operator boolean, p_driver_id text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  insert into public.carriers (id, name, mc, dot, owner_operator, owner_phone)
    values (p_id, p_name, p_mc, p_dot, p_owner_operator, (select phone from auth.users where id = auth.uid()));
  insert into public.members (user_id, carrier_id, role, driver_id) values (auth.uid(), p_id, 'owner', p_driver_id);
end $$;

-- The carrier's own brokers (added with a load) are saved as records too, readable by everyone in the carrier.
alter table public.records drop constraint records_kind_check;
alter table public.records add constraint records_kind_check
  check (kind in ('incident', 'maintenance', 'dvir', 'time_off', 'expense', 'carrier_message', 'broker'));
create policy "members read brokers" on public.records for select using (kind = 'broker' and public.member_role(carrier_id) is not null);

-- Every text, call and email in or out, as the provider saw it. Also stops a webhook the provider retries from
-- being handled twice.
create table public.channel_messages (
  id bigint generated always as identity primary key,
  carrier_id text not null references public.carriers (id) on delete cascade,
  channel text not null check (channel in ('sms', 'voice', 'email')),
  direction text not null check (direction in ('in', 'out')),
  provider_id text,
  driver_id text,
  counterparty text,
  body text,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (channel, provider_id)
);
create index on public.channel_messages (carrier_id, created_at desc);
create index on public.channel_messages (carrier_id, counterparty, created_at desc);

alter table public.channel_messages enable row level security;
create policy "office reads channel log" on public.channel_messages for select using (public.is_office(carrier_id));
create policy "driver reads own channel log" on public.channel_messages for select using (driver_id = public.my_driver_id(carrier_id));

grant select on public.channel_messages to authenticated;
revoke all on public.channel_messages from anon;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant usage on schema public to service_role;
    grant all on all tables in schema public to service_role;
    grant usage, select on all sequences in schema public to service_role;
  end if;
end $$;
