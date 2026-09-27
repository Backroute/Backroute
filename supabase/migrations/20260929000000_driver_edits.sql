-- What a driver can change on a load on their truck: the trip (stage, times, documents, stops), not the business.
-- A driver's app saves the whole load; this keeps the money, the broker and the contract as they were (so a stale
-- copy on a phone can't undo a newer rate, invoice or rate con either), and only lets the stage move along the trip.
-- The office and the server (no signed-in user) aren't limited.

create or replace function public.guard_driver_load_edits() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  k text;
begin
  if auth.uid() is null or public.is_office(old.carrier_id) then
    return new;
  end if;
  if new.carrier_id is distinct from old.carrier_id or new.truck_id is distinct from old.truck_id then
    raise exception 'A driver cannot move a load to another truck or carrier' using errcode = '42501';
  end if;
  if new.stage is distinct from old.stage and new.stage not in ('dispatched', 'at_pickup', 'in_transit', 'at_delivery', 'delivered') then
    new.stage := old.stage;
    new.data := jsonb_set(new.data, '{stage}', coalesce(old.data -> 'stage', to_jsonb(old.stage)));
  end if;
  foreach k in array array['listedRate', 'targetRate', 'bookedRate', 'brokerId', 'bookRequest', 'invoice', 'rateCon', 'rateConReading', 'tonuFee',
                           'tonuClaimedAt', 'market', 'commission', 'lane', 'referenceNumber', 'brokerContactEmail', 'offerEmail', 'detentionClaims',
                           'surchargePct', 'pickupAt', 'deliveryAt', 'truckId', 'carrierId'] loop
    if old.data ? k then
      new.data := jsonb_set(new.data, array[k], old.data -> k);
    else
      new.data := new.data - k;
    end if;
  end loop;
  return new;
end $$;

drop trigger if exists guard_driver_load_edits on public.loads;
create trigger guard_driver_load_edits before update on public.loads for each row execute function public.guard_driver_load_edits();
