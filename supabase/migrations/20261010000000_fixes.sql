-- Fixes from the review before the pilot:
--
-- - The app saved the owner's whole settings object, so a change made on the server meanwhile (Backroute's team
--   moving a pilot carrier out of practice mode, the owner's website switch set by a job) was put back by the next
--   tap. Now the app sends only what it changed and the database merges it.
-- - Dock tips carry the place's ZIP when the rate con has it, so two docks with the same name in one city don't share
--   tips and hours.

-- Merges `p_patch` into the carrier's settings: keys set to null are removed. Runs as the caller, so the access
-- rules still decide (only the carrier's office can update it). Returns the settings as they now are.
create or replace function public.merge_carrier_settings(p_carrier text, p_patch jsonb, p_owner_operator boolean)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare
  merged jsonb;
  k text;
begin
  select coalesce(settings, '{}'::jsonb) || coalesce(p_patch, '{}'::jsonb) into merged from public.carriers where id = p_carrier;
  if merged is null then
    raise exception 'Not your carrier' using errcode = '42501';
  end if;
  for k in select key from jsonb_each(coalesce(p_patch, '{}'::jsonb)) where value = 'null'::jsonb loop
    merged := merged - k;
  end loop;
  update public.carriers set settings = merged, owner_operator = p_owner_operator where id = p_carrier;
  if not found then
    raise exception 'Not allowed to change this carrier' using errcode = '42501';
  end if;
  return merged;
end $$;
revoke all on function public.merge_carrier_settings(text, jsonb, boolean) from public, anon;
grant execute on function public.merge_carrier_settings(text, jsonb, boolean) to authenticated;

alter table public.facility_notes add column if not exists zip text check (zip is null or zip ~ '^\d{5}$');
create index if not exists facility_notes_zip on public.facility_notes (name_key, zip);
