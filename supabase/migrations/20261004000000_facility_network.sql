-- How long docks keep trucks, from every carrier on Backroute: one row per stop a truck finished (arrived and left, from
-- the driver's app). Shared knowledge no single dispatcher has: a dock one carrier learned is slow warns every carrier's
-- drivers. Server only: no carrier can read another's rows, and the rows carry no load, broker or rate.
create table public.facility_visits (
  carrier_id text not null references public.carriers (id) on delete cascade,
  load_id text not null,
  stop text not null check (stop in ('pickup', 'delivery')),
  name_key text not null,
  city text not null,
  state text not null,
  minutes integer not null check (minutes > 0 and minutes < 2880),
  at timestamptz not null default now(),
  primary key (carrier_id, load_id, stop)
);
create index on public.facility_visits (name_key, city, state);
alter table public.facility_visits enable row level security;
revoke all on public.facility_visits from anon, authenticated;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant all on public.facility_visits to service_role;
  end if;
end $$;
