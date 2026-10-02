-- Making the AI easy to trust and quick to steer:
--
-- - held_sends: an email the AI wrote on its own to book, counter or accept a load waits a moment (90 seconds by
--   default) before it goes, so the owner can stop it. The office sees what's waiting; only the server sends or
--   stops it (the app asks through /api/agent/undo, which checks who's asking).

create table public.held_sends (
  id text primary key,
  carrier_id text not null references public.carriers (id) on delete cascade,
  load_id text,
  purpose text not null,
  summary text not null,
  draft jsonb not null,
  send_at timestamptz not null,
  status text not null default 'held' check (status in ('held', 'sending', 'sent', 'stopped', 'failed')),
  stopped_by uuid,
  created_at timestamptz not null default now()
);
create index held_sends_due on public.held_sends (status, send_at);
create index held_sends_carrier on public.held_sends (carrier_id, created_at desc);
alter table public.held_sends enable row level security;
create policy "office sees what's about to go out" on public.held_sends for select using (public.is_office(carrier_id));
grant select on public.held_sends to authenticated;
revoke all on public.held_sends from anon;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant all on public.held_sends to service_role;
  end if;
end $$;
