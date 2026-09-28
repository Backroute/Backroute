-- Other companies' websites, done by the AI: signing a rate con in DocuSign or the broker's portal, filling a broker's
-- carrier setup (MyCarrierPackets, RMIS, Highway and the like), booking a dock appointment on a scheduling site. A
-- browser worker outside the app (portal-worker/) does the clicking; the app decides every step.

-- The carrier's logins to those websites, and answers the owner gave the AI for them. The password (and a 2-step
-- key, or an answer) is encrypted by the app before it gets here (AES-256-GCM, with a key only the server has:
-- PORTAL_VAULT_KEY), and tied to its row so it can't be moved to another. Nobody reads this table but the server:
-- not the owner, not support, not another carrier. The app shows the owner the site and user name, never the secret.
create table public.portal_logins (
  id text primary key,
  carrier_id text not null references public.carriers (id) on delete cascade,
  kind text not null check (kind in ('login', 'fact')),
  -- A login: the website's host (mycarrierpackets.com). An answer: a short key for the question (bank_routing).
  site text not null,
  label text not null,
  username text,
  secret text not null,
  totp text,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_used_at timestamptz,
  unique (carrier_id, kind, site)
);
alter table public.portal_logins enable row level security;
revoke all on public.portal_logins from anon, authenticated;

-- Each job on a website: what to do, where, how far it got, and what the owner said.
create table public.portal_tasks (
  id text primary key,
  carrier_id text not null references public.carriers (id) on delete cascade,
  kind text not null check (kind in ('sign_rate_con', 'carrier_setup', 'dock_appointment')),
  status text not null default 'queued' check (status in ('queued', 'running', 'needs_approval', 'needs_answer', 'needs_code', 'done', 'failed', 'cancelled')),
  url text not null,
  load_id text,
  data jsonb not null default '{}'::jsonb,
  attempts integer not null default 0,
  worker text,
  locked_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.portal_tasks (status, created_at);
create index on public.portal_tasks (carrier_id, created_at desc);
alter table public.portal_tasks enable row level security;
revoke all on public.portal_tasks from anon, authenticated;

-- The worker takes the oldest job waiting (or one whose worker went quiet), and holds it for a while. Two workers
-- never get the same job.
create or replace function public.claim_portal_task(p_worker text, p_lease_seconds integer)
returns setof public.portal_tasks
language plpgsql security definer set search_path = public as $$
begin
  return query
  update public.portal_tasks t
     set status = 'running', worker = p_worker, attempts = t.attempts + 1,
         locked_until = now() + make_interval(secs => p_lease_seconds), updated_at = now()
   where t.id = (
     select q.id from public.portal_tasks q
      where q.status = 'queued' or (q.status = 'running' and q.locked_until < now())
      order by q.created_at
      for update skip locked
      limit 1)
  returning t.*;
end $$;
revoke all on function public.claim_portal_task(text, integer) from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant all on public.portal_logins, public.portal_tasks to service_role;
    grant execute on function public.claim_portal_task(text, integer) to service_role;
  end if;
end $$;

-- What the AI saw on the website at the moments that matter (before it signed or submitted, and when it finished or
-- got stuck), kept with the carrier's files.
alter table public.carrier_files drop constraint if exists carrier_files_kind_check;
alter table public.carrier_files add constraint carrier_files_kind_check
  check (kind in ('w9', 'coi', 'authority', 'noa', 'bol', 'pod', 'lumper_receipt', 'rate_con', 'rate_con_signed', 'invoice', 'factoring_schedule', 'claim_file', 'damage_photo', 'portal_screenshot', 'voided_check', 'other'));
