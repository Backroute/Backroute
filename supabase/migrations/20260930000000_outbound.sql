-- Every text, email and call the AI sends goes through lib/channels/out. Two kinds of message wait here instead of
-- going straight out:
--
-- - held: the carrier is in sandbox mode (a shadow week, or the simulated brokers and drivers). Nothing leaves; the
--   owner sees what the AI would have sent.
-- - retry: the text or email provider was down. The dispatcher's rounds try again with backoff, and give up once
--   the message is too old to still make sense (texts after 30 minutes, emails after a day).

create table public.outbound (
  id uuid primary key default gen_random_uuid(),
  carrier_id text not null references public.carriers (id) on delete cascade,
  channel text not null check (channel in ('sms', 'voice', 'email')),
  recipient text not null,
  subject text,
  body text,
  data jsonb not null default '{}'::jsonb,
  status text not null check (status in ('held', 'retry', 'sent', 'gave_up')),
  attempts int not null default 0,
  next_at timestamptz,
  last_error text,
  created_at timestamptz not null default now()
);
create index on public.outbound (carrier_id, created_at desc);
create index on public.outbound (next_at) where status = 'retry';

alter table public.outbound enable row level security;
create policy "office reads outbound" on public.outbound for select using (public.is_office(carrier_id));
grant select on public.outbound to authenticated;
revoke all on public.outbound from anon;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant all on public.outbound to service_role;
  end if;
end $$;
