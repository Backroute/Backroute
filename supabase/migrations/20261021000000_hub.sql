-- The integrations hub: Geotab as a third ELD, Xero for the books, and driver direct deposit (the sending bank and
-- each driver's account, the account numbers sealed with the vault key before they get here).
alter table public.carrier_integrations drop constraint if exists carrier_integrations_kind_check;
alter table public.carrier_integrations add constraint carrier_integrations_kind_check
  check (kind in ('samsara', 'motive', 'geotab', 'load_feed', 'fuel_feed', 'toll_feed', 'truckstop', 'dat', 'quickbooks', 'xero', 'gmail', 'outlook', 'payouts') or kind ~ '^board:[a-z0-9_-]{1,40}$');

-- Pickup photos (the truck, the trailer, the seal) and scale tickets, from the driver's trip card.
alter table public.carrier_files drop constraint if exists carrier_files_kind_check;
alter table public.carrier_files add constraint carrier_files_kind_check
  check (kind in ('w9', 'coi', 'authority', 'noa', 'bol', 'pod', 'lumper_receipt', 'receipt', 'dvir_photo', 'rate_con', 'rate_con_signed', 'invoice', 'factoring_schedule', 'claim_file', 'damage_photo', 'portal_screenshot', 'voided_check', 'voice_note', 'voice_reply', 'reefer_photo', 'cab_card', 'insurance_card', 'ifta_license', 'annual_inspection', 'pickup_photo', 'scale_ticket', 'other'));
