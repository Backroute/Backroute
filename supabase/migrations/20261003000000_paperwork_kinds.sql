-- Files the AI now keeps for the paperwork a dispatcher does: the signed rate con it returns, the factoring
-- company's schedule of accounts, a cargo claim file, and the driver's photos of damage.
alter table public.carrier_files drop constraint if exists carrier_files_kind_check;
alter table public.carrier_files add constraint carrier_files_kind_check
  check (kind in ('w9', 'coi', 'authority', 'noa', 'bol', 'pod', 'lumper_receipt', 'rate_con', 'rate_con_signed', 'invoice', 'factoring_schedule', 'claim_file', 'damage_photo', 'other'));
