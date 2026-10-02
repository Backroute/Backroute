-- The owner's back office, the parts a dispatcher or bookkeeper used to keep:
--
-- - New records: fuel card and toll transactions (imported, matched to loads), driver pay runs and advances.
-- - A bookkeeper role: sees the money and the fleet, keeps the books (fuel, tolls, pay runs, advances, expenses,
--   invoices paid), can't dispatch, book or change loads.
-- - An audit log: who changed what (people, settings, loads moving, pay runs paid), readable by the owner.
-- - Devices: the phones and computers each person is signed in on, so they can sign the others out.
-- - Two-step sign-in: once someone turns it on, their data is out of reach until they've entered the code too
--   (Supabase sets "aal2" on the session), whatever the app does.

-- ─── Records ─────────────────────────────────────────────────────────────────

alter table public.records drop constraint records_kind_check;
alter table public.records add constraint records_kind_check
  check (kind in ('incident', 'maintenance', 'dvir', 'time_off', 'expense', 'carrier_message', 'broker', 'fuel', 'toll', 'pay_run', 'advance'));

-- Fuel card and toll statements the AI reads by itself each day (lib/agent/costs).
alter table public.carrier_integrations drop constraint if exists carrier_integrations_kind_check;
alter table public.carrier_integrations add constraint carrier_integrations_kind_check
  check (kind in ('samsara', 'motive', 'load_feed', 'fuel_feed', 'toll_feed', 'truckstop', 'dat') or kind ~ '^board:[a-z0-9_-]{1,40}$');

-- ─── Bookkeeper ──────────────────────────────────────────────────────────────

alter table public.members drop constraint members_role_check;
alter table public.members add constraint members_role_check check (role in ('owner', 'dispatcher', 'driver', 'bookkeeper'));
alter table public.invites drop constraint invites_role_check;
alter table public.invites add constraint invites_role_check check (role in ('owner', 'dispatcher', 'driver', 'bookkeeper'));

create function public.is_books(c text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.member_role(c) in ('owner', 'dispatcher', 'bookkeeper'), false)
$$;
create function public.is_bookkeeper(c text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.member_role(c) = 'bookkeeper', false)
$$;

create policy "bookkeeper reads drivers" on public.drivers for select using (public.is_bookkeeper(carrier_id));
create policy "bookkeeper reads trucks" on public.trucks for select using (public.is_bookkeeper(carrier_id));
create policy "bookkeeper reads loads" on public.loads for select using (public.is_bookkeeper(carrier_id));
create policy "bookkeeper reads records" on public.records for select using (public.is_bookkeeper(carrier_id));
create policy "bookkeeper keeps the books" on public.records for all
  using (public.is_bookkeeper(carrier_id) and kind in ('expense', 'fuel', 'toll', 'pay_run', 'advance'))
  with check (public.is_bookkeeper(carrier_id) and kind in ('expense', 'fuel', 'toll', 'pay_run', 'advance'));
create policy "bookkeeper reads files" on public.carrier_files for select using (public.is_bookkeeper(carrier_id));
create policy "bookkeeper sees the team" on public.members for select using (public.is_bookkeeper(carrier_id));

-- The one change to a load a bookkeeper makes: the broker or shipper paid. Everything else on the load is the office's.
create function public.mark_invoice_paid(p_carrier text, p_load text, p_amount numeric, p_paid_at timestamptz default now())
returns boolean language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not public.is_books(p_carrier) then raise exception 'not allowed' using errcode = '42501'; end if;
  perform set_config('backroute.invoice_paid', 'on', true);
  update public.loads
     set data = jsonb_set(data, '{invoice}', coalesce(data -> 'invoice', '{}'::jsonb) || jsonb_build_object('paidAt', p_paid_at, 'paidAmount', p_amount)),
         updated_at = now()
   where carrier_id = p_carrier and id = p_load and data ? 'invoice';
  get diagnostics n = row_count;
  perform set_config('backroute.invoice_paid', '', true);
  return n = 1;
end $$;

-- The driver-edit guard lets that one change through (otherwise it would put the old invoice back).
create or replace function public.guard_driver_load_edits() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  k text;
begin
  -- The server, the office, and the one change mark_invoice_paid makes for a bookkeeper (it checks who's asking).
  if auth.uid() is null or public.is_office(old.carrier_id) or current_setting('backroute.invoice_paid', true) = 'on' then
    return new;
  end if;
  if new.carrier_id is distinct from old.carrier_id or new.truck_id is distinct from old.truck_id then
    raise exception 'A driver cannot move a load to another truck or carrier' using errcode = '42501';
  end if;
  if new.stage is distinct from old.stage and new.stage not in ('dispatched', 'at_pickup', 'in_transit', 'at_delivery', 'delivered') then
    new.stage := old.stage;
    new.data := jsonb_set(new.data, '{stage}', coalesce(old.data -> 'stage', to_jsonb(old.stage)));
  end if;
  foreach k in array array['listedRate', 'targetRate', 'bookedRate', 'brokerId', 'bookRequest', 'invoice', 'rateCon', 'rateConReading', 'tonuFee',
                           'tonuClaimedAt', 'market', 'commission', 'lane', 'referenceNumber', 'brokerContactEmail', 'offerEmail', 'detentionClaims',
                           'surchargePct', 'pickupAt', 'deliveryAt', 'truckId', 'carrierId'] loop
    if old.data ? k then
      new.data := jsonb_set(new.data, array[k], old.data -> k);
    else
      new.data := new.data - k;
    end if;
  end loop;
  return new;
end $$;

revoke all on function public.mark_invoice_paid(text, text, numeric, timestamptz) from public, anon;
grant execute on function public.mark_invoice_paid(text, text, numeric, timestamptz) to authenticated;

-- ─── Audit log ───────────────────────────────────────────────────────────────

create table public.audit_log (
  id bigint generated always as identity primary key,
  carrier_id text not null references public.carriers (id) on delete cascade,
  at timestamptz not null default now(),
  -- Null: the server (the AI dispatcher) or Backroute support.
  user_id uuid,
  who text not null,
  action text not null,
  target text
);
create index audit_log_carrier on public.audit_log (carrier_id, at desc);
alter table public.audit_log enable row level security;
create policy "owner reads the audit log" on public.audit_log for select using (public.member_role(carrier_id) = 'owner');
grant select on public.audit_log to authenticated;
revoke all on public.audit_log from anon;

create function public.audit() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  n jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  o jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  r jsonb := coalesce(n, o);
  c text := case when tg_table_name = 'carriers' then r ->> 'id' else r ->> 'carrier_id' end;
  who text;
  act text;
  tgt text;
begin
  who := coalesce(public.member_role(c), case when auth.uid() is null then 'ai' else 'support' end);
  if tg_table_name = 'carriers' then
    if (n -> 'settings') is distinct from (o -> 'settings') then
      select string_agg(k, ', ' order by k) into tgt from (
        select k from jsonb_object_keys(coalesce(n -> 'settings', '{}'::jsonb) || coalesce(o -> 'settings', '{}'::jsonb)) k
        where (n -> 'settings' -> k) is distinct from (o -> 'settings' -> k) limit 8
      ) s;
      act := case
        when (n -> 'settings' ->> 'paused') is distinct from (o -> 'settings' ->> 'paused')
          then case when coalesce((n -> 'settings' ->> 'paused')::boolean, false) then 'Paused the AI' else 'Resumed the AI' end
        else 'Changed settings' end;
    end if;
  elsif tg_table_name = 'members' then
    tgt := initcap(coalesce(n ->> 'role', o ->> 'role'));
    act := case tg_op when 'INSERT' then 'Signed in for the first time' when 'DELETE' then 'Removed from the team'
      else case when (n ->> 'role') is distinct from (o ->> 'role') then 'Role changed' end end;
  elsif tg_table_name = 'invites' then
    -- An invite goes away when it's used, too: only the owner taking it back is worth a line.
    act := case when tg_op = 'INSERT' then 'Let in a ' || (n ->> 'role') when public.member_role(c) = 'owner' then 'Took back access for a ' || (o ->> 'role') end;
    tgt := '…' || right(r ->> 'phone', 4);
  elsif tg_table_name = 'loads' then
    tgt := coalesce(r -> 'data' ->> 'referenceNumber', r ->> 'id');
    if tg_op = 'INSERT' then act := 'Added a load';
    elsif tg_op = 'DELETE' then act := 'Removed a load';
    elsif (n ->> 'stage') is distinct from (o ->> 'stage') then act := 'Load ' || coalesce(o ->> 'stage', '?') || ' → ' || (n ->> 'stage');
    elsif (n -> 'data' ->> 'bookedRate') is not null and (n -> 'data' ->> 'bookedRate') is distinct from (o -> 'data' ->> 'bookedRate') then act := 'Rate set to $' || (n -> 'data' ->> 'bookedRate');
    elsif (n -> 'data' -> 'invoice' ->> 'paidAt') is not null and (n -> 'data' -> 'invoice' ->> 'paidAt') is distinct from (o -> 'data' -> 'invoice' ->> 'paidAt') then act := 'Marked paid';
    end if;
  elsif tg_table_name in ('trucks', 'drivers') then
    tgt := coalesce(r ->> 'unit_number', r ->> 'name');
    act := case tg_op when 'INSERT' then 'Added a ' || left(tg_table_name, -1) else 'Removed a ' || left(tg_table_name, -1) end;
  elsif tg_table_name = 'records' then
    if r ->> 'kind' = 'pay_run' and tg_op = 'UPDATE' and (n -> 'data' ->> 'status') = 'paid' and (o -> 'data' ->> 'status') is distinct from 'paid' then
      act := 'Paid a driver $' || coalesce(n -> 'data' ->> 'net', '?');
      tgt := n -> 'data' ->> 'period';
    elsif r ->> 'kind' = 'advance' and tg_op = 'INSERT' then
      act := 'Gave an advance of $' || coalesce(n -> 'data' ->> 'amount', '?');
    end if;
  end if;
  -- Not while the carrier itself is being removed (its rows go with it).
  if act is not null and c is not null and exists (select 1 from public.carriers where id = c) then
    insert into public.audit_log (carrier_id, user_id, who, action, target) values (c, auth.uid(), who, act, tgt);
  end if;
  return null;
end $$;

create trigger z_audit after update on public.carriers for each row execute function public.audit();
create trigger z_audit after insert or update or delete on public.members for each row execute function public.audit();
create trigger z_audit after insert or delete on public.invites for each row execute function public.audit();
create trigger z_audit after insert or update or delete on public.loads for each row execute function public.audit();
create trigger z_audit after insert or delete on public.trucks for each row execute function public.audit();
create trigger z_audit after insert or delete on public.drivers for each row execute function public.audit();
create trigger z_audit after insert or update on public.records for each row execute function public.audit();

-- ─── Devices ─────────────────────────────────────────────────────────────────

create table public.devices (
  user_id uuid not null default auth.uid(),
  id text not null check (length(id) between 8 and 64),
  label text not null check (length(label) <= 80),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  primary key (user_id, id)
);
alter table public.devices enable row level security;
create policy "own devices" on public.devices for all using (user_id = auth.uid()) with check (user_id = auth.uid());
grant select, insert, update, delete on public.devices to authenticated;
revoke all on public.devices from anon;

-- ─── Two-step sign-in ────────────────────────────────────────────────────────

-- True unless this person turned on two-step sign-in and this session hasn't passed it. Supabase keeps the
-- authenticator apps in auth.mfa_factors and puts "aal2" on a session that entered the code.
create function public.mfa_ok() returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare
  claims json := nullif(current_setting('request.jwt.claims', true), '')::json;
  aal text := coalesce(nullif(current_setting('request.jwt.claim.aal', true), ''), claims ->> 'aal', 'aal1');
  has boolean;
begin
  if auth.uid() is null or aal = 'aal2' then return true; end if;
  if to_regclass('auth.mfa_factors') is null then return true; end if;
  execute 'select exists (select 1 from auth.mfa_factors where user_id = $1 and status = ''verified'')' into has using auth.uid();
  return not has;
end $$;
grant execute on function public.mfa_ok() to authenticated, anon;

do $$
declare t text;
begin
  foreach t in array array['carriers', 'members', 'invites', 'drivers', 'trucks', 'loads', 'escalations', 'dispatch_calls', 'driver_messages', 'activity', 'records', 'carrier_files', 'held_sends', 'audit_log'] loop
    if to_regclass('public.' || t) is not null then
      execute format('create policy "two-step sign-in" on public.%I as restrictive for all to authenticated using (public.mfa_ok()) with check (public.mfa_ok())', t);
    end if;
  end loop;
end $$;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant all on public.audit_log, public.devices to service_role;
  end if;
end $$;
