-- The papers a driver shows at a roadside inspection, on the phone: the truck's registration (cab card), the
-- insurance card, the IFTA license and the annual inspection. The office adds them, for one truck or the whole fleet
-- (truck_id null); a driver reads the ones for their own truck.
alter table public.carrier_files add column if not exists truck_id text;
alter table public.carrier_files drop constraint if exists carrier_files_kind_check;
alter table public.carrier_files add constraint carrier_files_kind_check
  check (kind in ('w9', 'coi', 'authority', 'noa', 'bol', 'pod', 'lumper_receipt', 'receipt', 'dvir_photo', 'rate_con', 'rate_con_signed', 'invoice', 'factoring_schedule', 'claim_file', 'damage_photo', 'portal_screenshot', 'voided_check', 'voice_note', 'voice_reply', 'reefer_photo', 'cab_card', 'insurance_card', 'ifta_license', 'annual_inspection', 'other'));

create policy "driver reads truck papers" on public.carrier_files for select using (
  kind in ('cab_card', 'insurance_card', 'ifta_license', 'annual_inspection')
  and (truck_id is null or truck_id in (select public.my_truck_ids(carrier_id)))
);
