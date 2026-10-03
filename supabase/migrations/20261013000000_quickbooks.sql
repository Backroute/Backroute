-- QuickBooks Online: a carrier's connected company (lib/agent/quickbooks). Its sign-in is sealed with the server's
-- vault key before it's stored; nothing here is readable from the app.
alter table public.carrier_integrations drop constraint if exists carrier_integrations_kind_check;
alter table public.carrier_integrations add constraint carrier_integrations_kind_check
  check (kind in ('samsara', 'motive', 'load_feed', 'fuel_feed', 'toll_feed', 'truckstop', 'dat', 'quickbooks') or kind ~ '^board:[a-z0-9_-]{1,40}$');
