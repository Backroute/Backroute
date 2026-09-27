-- What each carrier costs to run, per month: the AI's calls and tokens (counted as they happen), for Backroute's own
-- pricing. Texts, emails and calls are counted from channel_messages. Server only: no one signs in to read this.

create table public.usage (
  carrier_id text not null,
  month text not null,
  ai_calls int not null default 0,
  input_tokens bigint not null default 0,
  output_tokens bigint not null default 0,
  primary key (carrier_id, month)
);
alter table public.usage enable row level security;
revoke all on public.usage from anon, authenticated;

create or replace function public.add_usage(p_carrier text, p_month text, p_input bigint, p_output bigint)
returns void language sql security definer set search_path = public as $$
  insert into public.usage as u (carrier_id, month, ai_calls, input_tokens, output_tokens)
  values (p_carrier, p_month, 1, p_input, p_output)
  on conflict (carrier_id, month) do update
    set ai_calls = u.ai_calls + 1, input_tokens = u.input_tokens + excluded.input_tokens, output_tokens = u.output_tokens + excluded.output_tokens;
$$;
revoke all on function public.add_usage(text, text, bigint, bigint) from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant all on public.usage to service_role;
    grant execute on function public.add_usage(text, text, bigint, bigint) to service_role;
  end if;
end $$;
