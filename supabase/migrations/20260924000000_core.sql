-- Backroute core schema: carriers, the people in them, and the dispatch data the AI works on.
--
-- Every row belongs to one carrier. Row-level security decides who sees what:
--   * owner / dispatcher ("the office") — everything for their carrier
--   * driver — their own profile, their truck, the loads on it, their calls and messages
--   * an owner-operator is an owner whose membership also names their driver row
-- Nobody ever sees another carrier's data. The service role (server-side AI engine) bypasses RLS.
--
-- Most tables keep a few indexed columns for access rules and queries, and the full app object in `data`,
-- so the app's shape can keep evolving without a migration for every field.

-- ─── Tables ──────────────────────────────────────────────────────────────────

create table public.carriers (
  id text primary key,
  name text not null,
  mc text,
  dot text,
  owner_operator boolean not null default false,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- Who belongs to which carrier, in which role. Only an owner adds or removes people.
create table public.members (
  user_id uuid not null references auth.users (id) on delete cascade,
  carrier_id text not null references public.carriers (id) on delete cascade,
  role text not null check (role in ('owner', 'dispatcher', 'driver')),
  -- The driver row this person is, for drivers and owner-operators.
  driver_id text,
  created_at timestamptz not null default now(),
  primary key (user_id, carrier_id)
);

-- People added by phone number before they've ever signed in. Claimed on first sign-in (claim_invites).
create table public.invites (
  carrier_id text not null references public.carriers (id) on delete cascade,
  phone text not null,
  role text not null check (role in ('owner', 'dispatcher', 'driver')),
  driver_id text,
  created_at timestamptz not null default now(),
  primary key (carrier_id, phone)
);

create table public.drivers (
  id text not null,
  carrier_id text not null references public.carriers (id) on delete cascade,
  name text not null,
  phone text,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (carrier_id, id)
);

create table public.trucks (
  id text not null,
  carrier_id text not null references public.carriers (id) on delete cascade,
  unit_number text,
  driver_id text,
  second_driver_id text,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (carrier_id, id)
);

create table public.loads (
  id text not null,
  carrier_id text not null references public.carriers (id) on delete cascade,
  truck_id text,
  stage text not null,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (carrier_id, id)
);

create table public.escalations (
  id text not null,
  carrier_id text not null references public.carriers (id) on delete cascade,
  load_id text,
  status text not null,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (carrier_id, id)
);

create table public.dispatch_calls (
  id text not null,
  carrier_id text not null references public.carriers (id) on delete cascade,
  driver_id text not null,
  status text not null,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (carrier_id, id)
);

create table public.driver_messages (
  id text not null,
  carrier_id text not null references public.carriers (id) on delete cascade,
  driver_id text not null,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  primary key (carrier_id, id)
);

create table public.activity (
  id text not null,
  carrier_id text not null references public.carriers (id) on delete cascade,
  load_id text,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  primary key (carrier_id, id)
);

-- Everything else the app keeps per carrier: incidents, shop appointments, inspections, time off, expenses and the
-- owner's chat with the AI. A driver_id marks rows that belong to one driver; rows without one are the office's.
create table public.records (
  id text not null,
  carrier_id text not null references public.carriers (id) on delete cascade,
  kind text not null check (kind in ('incident', 'maintenance', 'dvir', 'time_off', 'expense', 'carrier_message')),
  driver_id text,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (carrier_id, kind, id)
);

-- Brokers are shared reference data (authority, payment history). Read by everyone signed in, written only by
-- the server.
create table public.brokers (
  id text primary key,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create index on public.members (carrier_id);
create index on public.drivers (carrier_id);
create index on public.trucks (carrier_id);
create index on public.trucks (driver_id);
create index on public.loads (carrier_id, stage);
create index on public.loads (truck_id);
create index on public.escalations (carrier_id, status);
create index on public.dispatch_calls (carrier_id, driver_id, status);
create index on public.driver_messages (driver_id, created_at);
create index on public.activity (carrier_id, created_at desc);
create index on public.records (carrier_id, driver_id);

-- ─── Who am I, in this carrier ───────────────────────────────────────────────
-- security definer so the checks can read members without tripping members' own policies (no recursion).

create function public.member_role(c text) returns text
language sql stable security definer set search_path = public as $$
  select role from public.members where user_id = auth.uid() and carrier_id = c
$$;

create function public.is_office(c text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.member_role(c) in ('owner', 'dispatcher'), false)
$$;

create function public.my_driver_id(c text) returns text
language sql stable security definer set search_path = public as $$
  select driver_id from public.members where user_id = auth.uid() and carrier_id = c
$$;

-- The truck(s) this driver runs, as primary or team driver.
create function public.my_truck_ids(c text) returns setof text
language sql stable security definer set search_path = public as $$
  select t.id from public.trucks t
  where t.carrier_id = c and public.my_driver_id(c) is not null
    and (t.driver_id = public.my_driver_id(c) or t.second_driver_id = public.my_driver_id(c))
$$;

-- ─── Onboarding ──────────────────────────────────────────────────────────────

-- Sign-up: creates the carrier and makes the caller its owner, in one step.
create function public.create_carrier(p_id text, p_name text, p_mc text, p_dot text, p_owner_operator boolean, p_driver_id text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  insert into public.carriers (id, name, mc, dot, owner_operator) values (p_id, p_name, p_mc, p_dot, p_owner_operator);
  insert into public.members (user_id, carrier_id, role, driver_id) values (auth.uid(), p_id, 'owner', p_driver_id);
end $$;

-- First sign-in: every invite for this phone number becomes a membership.
create function public.claim_invites() returns integer
language plpgsql security definer set search_path = public as $$
declare
  my_phone text;
  claimed integer;
begin
  select phone into my_phone from auth.users where id = auth.uid();
  if my_phone is null then return 0; end if;
  -- auth.users stores phones without '+'; invites may be typed either way.
  insert into public.members (user_id, carrier_id, role, driver_id)
    select auth.uid(), i.carrier_id, i.role, i.driver_id from public.invites i
    where regexp_replace(i.phone, '\D', '', 'g') = regexp_replace(my_phone, '\D', '', 'g')
  on conflict (user_id, carrier_id) do nothing;
  get diagnostics claimed = row_count;
  delete from public.invites where regexp_replace(phone, '\D', '', 'g') = regexp_replace(my_phone, '\D', '', 'g');
  return claimed;
end $$;

-- ─── Row-level security ──────────────────────────────────────────────────────

alter table public.carriers enable row level security;
alter table public.members enable row level security;
alter table public.invites enable row level security;
alter table public.drivers enable row level security;
alter table public.trucks enable row level security;
alter table public.loads enable row level security;
alter table public.escalations enable row level security;
alter table public.dispatch_calls enable row level security;
alter table public.driver_messages enable row level security;
alter table public.activity enable row level security;
alter table public.records enable row level security;
alter table public.brokers enable row level security;

-- Carriers: members read; the office changes settings.
create policy "members read their carrier" on public.carriers for select using (public.member_role(id) is not null);
create policy "office updates their carrier" on public.carriers for update using (public.is_office(id)) with check (public.is_office(id));

-- Members: you see your own memberships; the office sees its team; only owners add, change or remove people.
create policy "see own memberships" on public.members for select using (user_id = auth.uid() or public.is_office(carrier_id));
create policy "owners manage members" on public.members for all
  using (public.member_role(carrier_id) = 'owner') with check (public.member_role(carrier_id) = 'owner');

-- Invites: owners only.
create policy "owners manage invites" on public.invites for all
  using (public.member_role(carrier_id) = 'owner') with check (public.member_role(carrier_id) = 'owner');

-- Drivers: the office manages everyone; a driver reads and updates only their own row (language, call settings).
create policy "office manages drivers" on public.drivers for all using (public.is_office(carrier_id)) with check (public.is_office(carrier_id));
create policy "driver reads self" on public.drivers for select using (id = public.my_driver_id(carrier_id));
create policy "driver updates self" on public.drivers for update using (id = public.my_driver_id(carrier_id)) with check (id = public.my_driver_id(carrier_id));

-- Trucks: the office manages; a driver reads their own truck.
create policy "office manages trucks" on public.trucks for all using (public.is_office(carrier_id)) with check (public.is_office(carrier_id));
create policy "driver reads own truck" on public.trucks for select using (id in (select public.my_truck_ids(carrier_id)));

-- Loads: the office manages; a driver reads and updates loads on their truck (arrived, loaded, documents).
create policy "office manages loads" on public.loads for all using (public.is_office(carrier_id)) with check (public.is_office(carrier_id));
create policy "driver reads own loads" on public.loads for select using (truck_id in (select public.my_truck_ids(carrier_id)));
create policy "driver updates own loads" on public.loads for update
  using (truck_id in (select public.my_truck_ids(carrier_id))) with check (truck_id in (select public.my_truck_ids(carrier_id)));

-- Escalations are the office's decisions (an owner-operator is an owner, so they see theirs).
create policy "office manages escalations" on public.escalations for all using (public.is_office(carrier_id)) with check (public.is_office(carrier_id));

-- Dispatch calls: the office sees all of them; a driver sees and answers their own, and can call in.
create policy "office manages calls" on public.dispatch_calls for all using (public.is_office(carrier_id)) with check (public.is_office(carrier_id));
create policy "driver reads own calls" on public.dispatch_calls for select using (driver_id = public.my_driver_id(carrier_id));
create policy "driver calls in" on public.dispatch_calls for insert with check (driver_id = public.my_driver_id(carrier_id));
create policy "driver answers own calls" on public.dispatch_calls for update
  using (driver_id = public.my_driver_id(carrier_id)) with check (driver_id = public.my_driver_id(carrier_id));

-- Driver messages: the office manages every thread; a driver reads and writes their own.
create policy "office manages messages" on public.driver_messages for all using (public.is_office(carrier_id)) with check (public.is_office(carrier_id));
create policy "driver reads own messages" on public.driver_messages for select using (driver_id = public.my_driver_id(carrier_id));
create policy "driver writes own messages" on public.driver_messages for insert with check (driver_id = public.my_driver_id(carrier_id));

-- Records: the office manages all of them; a driver reads, adds and updates their own (an incident, an inspection,
-- a time-off request, an expense). Office-only rows (shop bookings, the owner's AI chat) have no driver_id.
create policy "office manages records" on public.records for all using (public.is_office(carrier_id)) with check (public.is_office(carrier_id));
create policy "driver reads own records" on public.records for select using (driver_id = public.my_driver_id(carrier_id));
create policy "driver adds own records" on public.records for insert
  with check (driver_id = public.my_driver_id(carrier_id) and kind in ('incident', 'dvir', 'time_off', 'expense'));
create policy "driver updates own records" on public.records for update
  using (driver_id = public.my_driver_id(carrier_id)) with check (driver_id = public.my_driver_id(carrier_id) and kind in ('incident', 'dvir', 'time_off', 'expense'));

-- Activity log: the office's.
create policy "office manages activity" on public.activity for all using (public.is_office(carrier_id)) with check (public.is_office(carrier_id));

-- Brokers: read-only for anyone signed in.
create policy "signed-in read brokers" on public.brokers for select using (auth.uid() is not null);

-- ─── Privileges ──────────────────────────────────────────────────────────────
-- Supabase grants these by default; stated here so the schema also works on a plain Postgres. RLS does the rest.

grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
revoke all on all tables in schema public from anon;
grant execute on function public.create_carrier(text, text, text, text, boolean, text) to authenticated;
grant execute on function public.claim_invites() to authenticated;

-- Live updates to both apps (Supabase Realtime), when the publication exists.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.loads, public.trucks, public.drivers, public.escalations, public.dispatch_calls, public.driver_messages, public.records;
  end if;
end $$;
