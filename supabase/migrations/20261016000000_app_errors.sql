-- Errors the app hit, on the server (instrumentation.ts) and in people's browsers (api/errors), so the team hears
-- about a crash before a carrier calls. One row per kind of error per day, counted; the support console's System tab
-- and the alerts read it (lib/health). Server-only: messages can carry details of the page someone was on.
create table if not exists public.app_errors (
  fingerprint text primary key,
  day date not null default current_date,
  source text not null check (source in ('server', 'browser')),
  path text,
  message text not null,
  digest text,
  stack text,
  count integer not null default 1,
  first_at timestamptz not null default now(),
  last_at timestamptz not null default now()
);
create index if not exists app_errors_last on public.app_errors (last_at desc);
alter table public.app_errors enable row level security;
revoke all on public.app_errors from anon, authenticated;

-- Counts one more of an error (adds it the first time it's seen that day).
create or replace function public.note_error(p_fingerprint text, p_source text, p_path text, p_message text, p_digest text, p_stack text)
returns void language sql security definer set search_path = public as $$
  insert into public.app_errors (fingerprint, source, path, message, digest, stack)
  values (p_fingerprint, p_source, left(p_path, 300), left(p_message, 500), left(p_digest, 100), left(p_stack, 4000))
  on conflict (fingerprint) do update set count = public.app_errors.count + 1, last_at = now();
$$;
revoke all on function public.note_error(text, text, text, text, text, text) from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant all on public.app_errors to service_role;
    grant execute on function public.note_error(text, text, text, text, text, text) to service_role;
  end if;
end $$;
