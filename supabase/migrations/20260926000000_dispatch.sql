-- Paperwork a dispatcher handles: the carrier's own documents (W-9, insurance certificate, authority letter, notice
-- of assignment) that brokers ask for, and each load's BOL and POD photos, which go with the invoice.
--
-- Files are small (a PDF or a phone photo), so they're kept in the database, base64-encoded, up to about 10 MB each.
-- Everything is written by the server after it checks who's asking; people read what their role allows.

create table public.carrier_files (
  id uuid primary key default gen_random_uuid(),
  carrier_id text not null references public.carriers (id) on delete cascade,
  kind text not null check (kind in ('w9', 'coi', 'authority', 'noa', 'bol', 'pod', 'lumper_receipt', 'rate_con', 'invoice', 'other')),
  load_id text,
  name text not null,
  content_type text not null,
  size integer not null,
  data text not null check (length(data) <= 14000000),
  -- Insurance certificates expire; the AI reminds the owner before it does.
  expires_on date,
  note text,
  uploaded_by uuid,
  created_at timestamptz not null default now()
);
create index on public.carrier_files (carrier_id, kind, created_at desc);
create index on public.carrier_files (carrier_id, load_id);

alter table public.carrier_files enable row level security;

-- The office sees every file; a driver sees the files on loads on their own truck.
create policy "office reads files" on public.carrier_files for select using (public.is_office(carrier_id));
create policy "driver reads own load files" on public.carrier_files for select using (
  load_id is not null and exists (
    select 1 from public.loads l
    where l.carrier_id = carrier_files.carrier_id and l.id = carrier_files.load_id
      and l.truck_id in (select public.my_truck_ids(l.carrier_id))
  )
);

grant select on public.carrier_files to authenticated;
revoke all on public.carrier_files from anon;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant all on public.carrier_files to service_role;
  end if;
end $$;

-- What the AI dispatcher has already done on its own for a load (a check-in text, a call, an invoice), so it does
-- each once, even when two runs of the job overlap: the insert either claims the mark or finds it taken.
create table public.agent_marks (
  carrier_id text not null references public.carriers (id) on delete cascade,
  load_id text not null,
  kind text not null,
  data jsonb not null default '{}',
  created_at timestamptz not null default now(),
  primary key (carrier_id, load_id, kind)
);
alter table public.agent_marks enable row level security;
-- No policies: only the server reads and writes it.
revoke all on public.agent_marks from anon, authenticated;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant all on public.agent_marks to service_role;
  end if;
end $$;
