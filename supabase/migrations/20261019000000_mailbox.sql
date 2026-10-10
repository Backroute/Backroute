-- The owner's mailbox (Gmail or Outlook), read for broker mail (lib/agent/mailbox). Its sign-in is sealed with the
-- server's vault key before it's stored; nothing here is readable from the app.
alter table public.carrier_integrations drop constraint if exists carrier_integrations_kind_check;
alter table public.carrier_integrations add constraint carrier_integrations_kind_check
  check (kind in ('samsara', 'motive', 'load_feed', 'fuel_feed', 'toll_feed', 'truckstop', 'dat', 'quickbooks', 'gmail', 'outlook') or kind ~ '^board:[a-z0-9_-]{1,40}$');

-- The same email can arrive twice (forwarded, and read from the connected mailbox): it's matched on its Message-ID.
create index if not exists channel_messages_email_message_id on public.channel_messages (carrier_id, (data->>'messageId')) where channel = 'email';
