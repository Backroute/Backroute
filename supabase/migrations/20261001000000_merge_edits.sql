-- Two screens (or a screen and the AI) changing the same load: each saves only what it changed. A screen's save
-- carries "_changed", the fields the person actually edited since that screen last had the load; the database takes
-- those from the save and keeps everything else as it is now. So an owner fixing a pickup time on a copy from a
-- minute ago can't undo the negotiation, rate con or invoice the AI recorded in that minute. Saves without "_changed"
-- (the server's) replace the load as before.

create or replace function public.merge_changed_fields() returns trigger
language plpgsql as $$
declare
  sent jsonb := new.data;
  keys text[];
begin
  if not (sent ? '_changed') then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.data := sent - '_changed';
    return new;
  end if;
  select coalesce(array_agg(k), '{}') into keys from jsonb_array_elements_text(sent -> '_changed') k;
  -- What they changed (or removed) wins; everything else stays as it is in the database now.
  new.data := (old.data - keys) || (select coalesce(jsonb_object_agg(k, sent -> k), '{}'::jsonb) from unnest(keys) k where sent ? k);
  -- The indexed columns follow the load, but only where this save changed them.
  new.stage := case when 'stage' = any (keys) then coalesce(new.data ->> 'stage', old.stage) else old.stage end;
  new.truck_id := case when 'truckId' = any (keys) then new.data ->> 'truckId' else old.truck_id end;
  return new;
end $$;

-- Named to run before guard_driver_load_edits (triggers run in name order), so a driver's merged save is still guarded.
create trigger a_merge_changed_fields before insert or update on public.loads for each row execute function public.merge_changed_fields();
