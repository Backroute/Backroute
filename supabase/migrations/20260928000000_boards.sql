-- Load boards join the carrier's connections: Truckstop, DAT, and any other board with an API ("board:<name>").
alter table public.carrier_integrations drop constraint if exists carrier_integrations_kind_check;
alter table public.carrier_integrations add constraint carrier_integrations_kind_check
  check (kind in ('samsara', 'motive', 'load_feed', 'truckstop', 'dat') or kind ~ '^board:[a-z0-9_-]{1,40}$');
