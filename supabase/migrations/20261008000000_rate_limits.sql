-- Limits on how often something can be done (a public lookup from one address, AI questions from one account),
-- counted in the database so every server instance shares the count. Server-only.
create table public.rate_limits (
  key text primary key,
  window_start timestamptz not null default now(),
  hits integer not null default 0
);
alter table public.rate_limits enable row level security;
revoke all on public.rate_limits from anon, authenticated;

-- Counts one more for the key in the current window; true while still within the limit.
create or replace function public.hit_rate_limit(p_key text, p_window_seconds integer, p_max integer)
returns boolean language sql security definer set search_path = public as $$
  insert into public.rate_limits as r (key, window_start, hits) values (p_key, now(), 1)
  on conflict (key) do update set
    hits = case when r.window_start < now() - make_interval(secs => p_window_seconds) then 1 else r.hits + 1 end,
    window_start = case when r.window_start < now() - make_interval(secs => p_window_seconds) then now() else r.window_start end
  returning hits <= p_max;
$$;
revoke all on function public.hit_rate_limit(text, integer, integer) from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant all on public.rate_limits to service_role;
    grant execute on function public.hit_rate_limit(text, integer, integer) to service_role;
  end if;
end $$;
