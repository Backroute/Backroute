-- Photos drivers take of what they paid on the road (a receipt for an expense, read for its amount) and of defects
-- found on an inspection.
alter table public.carrier_files drop constraint if exists carrier_files_kind_check;
alter table public.carrier_files add constraint carrier_files_kind_check
  check (kind in ('w9', 'coi', 'authority', 'noa', 'bol', 'pod', 'lumper_receipt', 'receipt', 'dvir_photo', 'rate_con', 'rate_con_signed', 'invoice', 'factoring_schedule', 'claim_file', 'damage_photo', 'portal_screenshot', 'voided_check', 'voice_note', 'voice_reply', 'reefer_photo', 'other'));
