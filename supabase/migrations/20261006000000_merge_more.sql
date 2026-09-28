-- Trucks, drivers and Needs you items merge the same way loads do (20261001000000_merge_edits.sql): a screen's save
-- carries "_changed", the fields the person edited since that screen last had the row, and only those are taken. So
-- the owner renaming a driver on one screen can't undo the AI moving that driver's truck on another, and an old copy
-- of a Needs you item can't reopen one the AI or support already closed.
--
-- Also fixes loads: the app saves with an upsert (insert ... on conflict do update), and the insert step took
-- "_changed" off before the update step could merge, so a stale copy still replaced the whole load. Now "_changed" is
-- only taken off an insert when there's no row yet to merge into.

create or replace function public.merge_changed_fields() returns trigger
language plpgsql as $$
declare
  sent jsonb := new.data;
  keys text[];
  existing boolean;
begin
  if not (sent ? '_changed') then
    return new;
  end if;
  if tg_op = 'INSERT' then
    select exists (select 1 from public.loads where carrier_id = new.carrier_id and id = new.id) into existing;
    if not existing then new.data := sent - '_changed'; end if;
    return new;
  end if;
  select coalesce(array_agg(k), '{}') into keys from jsonb_array_elements_text(sent -> '_changed') k;
  new.data := (old.data - keys) || (select coalesce(jsonb_object_agg(k, sent -> k), '{}'::jsonb) from unnest(keys) k where sent ? k);
  new.stage := case when 'stage' = any (keys) then coalesce(new.data ->> 'stage', old.stage) else old.stage end;
  new.truck_id := case when 'truckId' = any (keys) then new.data ->> 'truckId' else old.truck_id end;
  return new;
end $$;

create or replace function public.merge_changed_row() returns trigger
language plpgsql as $$
declare
  sent jsonb := new.data;
  keys text[];
  existing boolean;
begin
  if not (sent ? '_changed') then
    return new;
  end if;
  if tg_op = 'INSERT' then
    execute format('select exists (select 1 from %I.%I where carrier_id = $1 and id = $2)', tg_table_schema, tg_table_name) into existing using new.carrier_id, new.id;
    if not existing then new.data := sent - '_changed'; end if;
    return new;
  end if;
  select coalesce(array_agg(k), '{}') into keys from jsonb_array_elements_text(sent -> '_changed') k;
  new.data := (old.data - keys) || (select coalesce(jsonb_object_agg(k, sent -> k), '{}'::jsonb) from unnest(keys) k where sent ? k);
  -- The indexed columns follow the fields this save changed; the rest stay as they are.
  if tg_table_name = 'drivers' then
    new.name := case when 'name' = any (keys) then coalesce(new.data ->> 'name', old.name) else old.name end;
    new.phone := case when 'phone' = any (keys) then new.data ->> 'phone' else old.phone end;
  elsif tg_table_name = 'trucks' then
    new.unit_number := case when 'unitNumber' = any (keys) then new.data ->> 'unitNumber' else old.unit_number end;
    new.driver_id := case when 'driverId' = any (keys) then new.data ->> 'driverId' else old.driver_id end;
    new.second_driver_id := case when 'secondDriverId' = any (keys) then new.data ->> 'secondDriverId' else old.second_driver_id end;
  elsif tg_table_name = 'escalations' then
    new.load_id := case when 'loadId' = any (keys) then new.data ->> 'loadId' else old.load_id end;
    new.status := case when 'status' = any (keys) then coalesce(new.data ->> 'status', old.status) else old.status end;
  end if;
  return new;
end $$;

create trigger a_merge_changed_row before insert or update on public.drivers for each row execute function public.merge_changed_row();
create trigger a_merge_changed_row before insert or update on public.trucks for each row execute function public.merge_changed_row();
create trigger a_merge_changed_row before insert or update on public.escalations for each row execute function public.merge_changed_row();

-- A Needs you item someone closed stays closed: a save from an old copy can't reopen it (only the server can).
create or replace function public.keep_resolved() returns trigger
language plpgsql as $$
begin
  if old.status = 'resolved' and new.status <> 'resolved' and current_user in ('authenticated', 'anon') then
    new.status := old.status;
    new.data := new.data || jsonb_build_object('status', old.data -> 'status', 'resolvedAt', old.data -> 'resolvedAt', 'resolvedBy', old.data -> 'resolvedBy');
  end if;
  return new;
end $$;
create trigger b_keep_resolved before update on public.escalations for each row execute function public.keep_resolved();
