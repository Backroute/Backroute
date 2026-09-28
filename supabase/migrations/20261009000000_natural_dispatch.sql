-- Reaching drivers the way they already talk, and the records that make that fair to them:
--
-- - text_routes: which way each phone number texts us (SMS or WhatsApp) and when, so replies go back the same way,
--   and whether the one-time notice about who's texting them went out.
-- - facility_notes: what drivers tell the AI about a dock (gate, check-in, parking, hours), passed to the next driver.
-- - driver_consents: every yes and no a driver gave to texts and calls, kept as a record that can't be edited.
-- - weekly_reviews: the owner's one-minute review of each week.

-- Server only: a phone number and how it texts is nobody else's business.
create table public.text_routes (
  phone_last10 text primary key check (phone_last10 ~ '^\d{10}$'),
  whatsapp_at timestamptz,
  sms_at timestamptz,
  notice_at timestamptz,
  updated_at timestamptz not null default now()
);
alter table public.text_routes enable row level security;
revoke all on public.text_routes from anon, authenticated;

-- Tips about a dock from the drivers who've been there. Each carrier's office can read its own drivers' tips; every
-- carrier's AI reads them all through the server (they're about a place, written without names or phone numbers).
create table public.facility_notes (
  id bigint generated always as identity primary key,
  carrier_id text not null references public.carriers (id) on delete cascade,
  driver_id text,
  name_key text not null,
  city text not null,
  state text not null,
  note text not null check (length(note) between 3 and 300),
  hours jsonb,
  created_at timestamptz not null default now()
);
create index on public.facility_notes (name_key, city, state, created_at desc);
alter table public.facility_notes enable row level security;
create policy "office reads own facility notes" on public.facility_notes for select using (public.is_office(carrier_id));
grant select on public.facility_notes to authenticated;
revoke all on public.facility_notes from anon;

-- A driver's consent to texts and calls, and every change to it (STOP, START, the checkbox in the app, the owner
-- saying the driver agreed when they hired them). Written only by the server; never changed or deleted afterwards,
-- except when the whole carrier is removed.
create table public.driver_consents (
  id bigint generated always as identity primary key,
  carrier_id text not null references public.carriers (id) on delete cascade,
  driver_id text not null,
  phone text,
  granted boolean not null,
  via text not null check (via in ('app', 'sms', 'whatsapp', 'voice', 'owner')),
  wording text not null,
  version text not null,
  by_user uuid,
  ip text,
  user_agent text,
  at timestamptz not null default now()
);
create index on public.driver_consents (carrier_id, driver_id, at desc);
alter table public.driver_consents enable row level security;
create policy "office reads consents" on public.driver_consents for select using (public.is_office(carrier_id));
create policy "driver reads own consents" on public.driver_consents for select using (driver_id = public.my_driver_id(carrier_id));
grant select on public.driver_consents to authenticated;
revoke all on public.driver_consents from anon;

create or replace function public.keep_consent_record() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'UPDATE' then
    raise exception 'Consent records are never changed; add a new one' using errcode = '42501';
  end if;
  -- Removing the carrier removes its records (the carrier row is already gone by then); nothing else deletes one.
  if exists (select 1 from public.carriers where id = old.carrier_id) then
    raise exception 'Consent records are kept' using errcode = '42501';
  end if;
  return old;
end $$;
create trigger keep_consent_record before update or delete on public.driver_consents for each row execute function public.keep_consent_record();

-- The owner's weekly review: the numbers and the one thing to change. The office reads it in the app.
create table public.weekly_reviews (
  carrier_id text not null references public.carriers (id) on delete cascade,
  week text not null,
  data jsonb not null,
  created_at timestamptz not null default now(),
  primary key (carrier_id, week)
);
alter table public.weekly_reviews enable row level security;
create policy "office reads weekly reviews" on public.weekly_reviews for select using (public.is_office(carrier_id));
grant select on public.weekly_reviews to authenticated;
revoke all on public.weekly_reviews from anon;

-- Voice messages drivers send (kept with their transcript) and the AI's spoken answers.
alter table public.carrier_files drop constraint if exists carrier_files_kind_check;
alter table public.carrier_files add constraint carrier_files_kind_check
  check (kind in ('w9', 'coi', 'authority', 'noa', 'bol', 'pod', 'lumper_receipt', 'rate_con', 'rate_con_signed', 'invoice', 'factoring_schedule', 'claim_file', 'damage_photo', 'portal_screenshot', 'voided_check', 'voice_note', 'voice_reply', 'reefer_photo', 'other'));

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant all on public.text_routes, public.facility_notes, public.driver_consents, public.weekly_reviews to service_role;
    grant usage, select on all sequences in schema public to service_role;
  end if;
end $$;
