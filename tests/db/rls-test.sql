\set ON_ERROR_STOP 1
-- People
insert into auth.users values
 ('aaaaaaaa-0000-0000-0000-000000000001', '12145550100'),  -- A: fleet owner, carrier-a
 ('bbbbbbbb-0000-0000-0000-000000000002', '14695550200'),  -- B: owner of a different fleet
 ('dddddddd-0000-0000-0000-000000000003', '12145550148'),  -- D: driver in carrier-a (drv-1, truck t1)
 ('eeeeeeee-0000-0000-0000-000000000004', '19725550163'),  -- E: driver in carrier-a (drv-2, truck t2)
 ('00000000-0000-0000-0000-00000000000f', '15595550111');  -- O: owner-operator

create or replace function pg_temp.as_user(u text) returns void language plpgsql as $$
begin perform set_config('request.jwt.claim.sub', u, false); end $$;
create or replace function pg_temp.check(label text, ok boolean) returns void language plpgsql as $$
begin raise notice '% %', case when ok then 'PASS' else 'FAIL' end, label; end $$;

set role authenticated;

-- Sign-ups
select pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000001');
select public.create_carrier('carrier-a', 'Titan Freight', '548213', '3123456', false);
insert into public.drivers (id, carrier_id, name, phone) values ('drv-1', 'carrier-a', 'Marcus Bell', '(214) 555-0148'), ('drv-2', 'carrier-a', 'Ava Whitmore', '(972) 555-0163');
insert into public.trucks (id, carrier_id, unit_number, driver_id) values ('t1', 'carrier-a', 'T-101', 'drv-1'), ('t2', 'carrier-a', 'T-102', 'drv-2');
insert into public.loads (id, carrier_id, truck_id, stage) values ('L1', 'carrier-a', 't1', 'in_transit'), ('L2', 'carrier-a', 't2', 'dispatched');
insert into public.escalations (id, carrier_id, load_id, status) values ('E1', 'carrier-a', 'L1', 'open');
insert into public.dispatch_calls (id, carrier_id, driver_id, status) values ('C1', 'carrier-a', 'drv-1', 'ringing'), ('C2', 'carrier-a', 'drv-2', 'ringing');
insert into public.activity (id, carrier_id, load_id) values ('A1', 'carrier-a', 'L1');
insert into public.invites (carrier_id, phone, role, driver_id) values ('carrier-a', '+1 (214) 555-0148', 'driver', 'drv-1'), ('carrier-a', '+19725550163', 'driver', 'drv-2');

select pg_temp.as_user('bbbbbbbb-0000-0000-0000-000000000002');
select public.create_carrier('carrier-b', 'Other Fleet', '777777', '1111111', false);

select pg_temp.as_user('00000000-0000-0000-0000-00000000000f');
select public.create_carrier('carrier-o', 'Sandhu Transport', '999001', '2222222', true, 'drv-o');
insert into public.drivers (id, carrier_id, name) values ('drv-o', 'carrier-o', 'Harpreet Sandhu');
insert into public.trucks (id, carrier_id, unit_number, driver_id) values ('to', 'carrier-o', 'T-1', 'drv-o');
insert into public.loads (id, carrier_id, truck_id, stage) values ('LO', 'carrier-o', 'to', 'rate_confirmed');
insert into public.escalations (id, carrier_id, load_id, status) values ('EO', 'carrier-o', 'LO', 'open');

-- Drivers sign in for the first time: invites by phone become memberships
select pg_temp.as_user('dddddddd-0000-0000-0000-000000000003');
select pg_temp.check('driver D claims invite typed with punctuation', public.claim_invites() = 1);
select pg_temp.as_user('eeeeeeee-0000-0000-0000-000000000004');
select pg_temp.check('driver E claims invite typed with +1', public.claim_invites() = 1);

-- Another fleet's owner sees nothing of carrier-a
select pg_temp.as_user('bbbbbbbb-0000-0000-0000-000000000002');
select pg_temp.check('other owner: no carrier-a loads', (select count(*) from public.loads where carrier_id = 'carrier-a') = 0);
select pg_temp.check('other owner: no carrier-a drivers', (select count(*) from public.drivers where carrier_id = 'carrier-a') = 0);
select pg_temp.check('other owner: sees only own carrier', (select count(*) from public.carriers) = 1);
with u as (update public.loads set stage = 'cancelled' where id = 'L1' returning 1) select pg_temp.check('other owner: cannot change carrier-a load', (select count(*) from u) = 0);

-- Fleet owner sees the whole fleet
select pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000001');
select pg_temp.check('owner sees both loads', (select count(*) from public.loads) = 2);
select pg_temp.check('owner sees team', (select count(*) from public.members) = 3);
select pg_temp.check('owner sees escalations', (select count(*) from public.escalations) = 1);
with u as (update public.loads set data = data || '{"targetRate": 2000, "invoice": {"amount": 2000}}' where id = 'L1' returning 1) select pg_temp.check('owner sets the rate and invoice', (select count(*) from u) = 1);
-- Two screens (or a screen and the AI) on one load: a save from a stale copy carries only the fields it changed.
update public.loads set data = data || '{"bookRequest": {"ask": 2100, "status": "accepted"}}' where id = 'L1';
update public.loads set data = '{"notes": "Dock 4", "targetRate": 2000, "invoice": {"amount": 2000}, "_changed": ["notes"]}' where id = 'L1';
select pg_temp.check('a stale copy saving one field changes only that field: the newer negotiation stays', (select data -> 'bookRequest' ->> 'ask' = '2100' and data ->> 'notes' = 'Dock 4' and (data ->> 'targetRate')::int = 2000 and not (data ? '_changed') from public.loads where id = 'L1'));
update public.loads set data = '{"stage": "at_pickup", "_changed": ["notes", "stage"]}' where id = 'L1';
select pg_temp.check('...a field cleared on the screen is cleared, and the stage column follows the load', (select not (data ? 'notes') and data -> 'bookRequest' ->> 'ask' = '2100' and stage = 'at_pickup' from public.loads where id = 'L1'));
-- The app saves with an upsert: the merge still happens (the insert step used to drop "_changed" first).
insert into public.loads (id, carrier_id, stage, data) select 'L1', carrier_id, 'at_pickup', '{"id": "L1", "notes": "Gate 2", "bookRequest": {"ask": 1}, "_changed": ["notes"]}' from public.loads where id = 'L1'
  on conflict (carrier_id, id) do update set data = excluded.data, stage = excluded.stage;
select pg_temp.check('an upsert from a stale copy merges too: only the edited field changes', (select data ->> 'notes' = 'Gate 2' and data -> 'bookRequest' ->> 'ask' = '2100' and not (data ? '_changed') from public.loads where id = 'L1'));
update public.trucks set data = data || '{"status": "rolling", "unitNumber": "101"}' where id = 't1';
insert into public.trucks (id, carrier_id, unit_number, data) select 't1', carrier_id, '101B', '{"id": "t1", "unitNumber": "101B", "status": "old", "_changed": ["unitNumber"]}' from public.trucks where id = 't1'
  on conflict (carrier_id, id) do update set data = excluded.data, unit_number = excluded.unit_number;
select pg_temp.check('a truck edited on a stale screen keeps what the AI changed meanwhile', (select data ->> 'status' = 'rolling' and unit_number = '101B' and data ->> 'unitNumber' = '101B' from public.trucks where id = 't1'));
update public.escalations set status = 'resolved', data = data || '{"status": "resolved", "resolvedAt": "2026-01-01"}';
update public.escalations set status = 'open', data = data || '{"status": "open"}';
select pg_temp.check('an old copy can''t reopen a closed Needs you item', (select bool_and(status = 'resolved' and data ->> 'status' = 'resolved') from public.escalations));

-- Driver D: only their own things
select pg_temp.as_user('dddddddd-0000-0000-0000-000000000003');
select pg_temp.check('driver sees own load only', (select array_agg(id) from public.loads) = array['L1']);
select pg_temp.check('driver sees own truck only', (select array_agg(id) from public.trucks) = array['t1']);
select pg_temp.check('driver sees own calls only', (select array_agg(id) from public.dispatch_calls) = array['C1']);
select pg_temp.check('driver sees own profile only', (select array_agg(id) from public.drivers) = array['drv-1']);
select pg_temp.check('driver sees no escalations', (select count(*) from public.escalations) = 0);
select pg_temp.check('driver sees no activity log', (select count(*) from public.activity) = 0);
with u as (update public.loads set stage = 'at_delivery' where id = 'L1' returning 1) select pg_temp.check('driver can confirm own load', (select count(*) from u) = 1);
with u as (update public.loads set stage = 'delivered' where id = 'L2' returning 1) select pg_temp.check('driver cannot touch coworker load', (select count(*) from u) = 0);
update public.loads set stage = 'cancelled', data = data || '{"targetRate": 1, "invoice": {"amount": 1}, "brokerId": "evil", "documents": [{"type": "pod"}], "tripChecklist": {"loadedAt": "2026-09-29T10:00:00Z"}}' where id = 'L1';
select pg_temp.check('driver saving the whole load: the trip changes stick', (select jsonb_array_length(data -> 'documents') = 1 and data -> 'tripChecklist' ->> 'loadedAt' = '2026-09-29T10:00:00Z' from public.loads where id = 'L1'));
select pg_temp.check('...but not the rate, invoice or broker', (select (data ->> 'targetRate')::int = 2000 and (data -> 'invoice' ->> 'amount')::int = 2000 and not (data ? 'brokerId') from public.loads where id = 'L1'));
select pg_temp.check('...and a driver cannot cancel a load (only move it along the trip)', (select stage from public.loads where id = 'L1') = 'at_delivery');
with u as (update public.dispatch_calls set status = 'live' where id = 'C1' returning 1) select pg_temp.check('driver answers own call', (select count(*) from u) = 1);
with u as (update public.drivers set data = '{"prefs":{"language":"pa"}}' where id = 'drv-1' returning 1) select pg_temp.check('driver sets own language', (select count(*) from u) = 1);
with u as (update public.drivers set data = '{}' where id = 'drv-2' returning 1) select pg_temp.check('driver cannot edit coworker', (select count(*) from u) = 0);
do $$ begin
  update public.loads set truck_id = 't2' where id = 'L1';
  raise notice 'FAIL driver moved load to another truck';
exception when others then raise notice 'PASS driver cannot move a load to another truck';
end $$;
do $$ begin
  insert into public.members (user_id, carrier_id, role) values ('dddddddd-0000-0000-0000-000000000003', 'carrier-a', 'owner');
  raise notice 'FAIL driver made themselves owner';
exception when others then raise notice 'PASS driver cannot make themselves owner';
end $$;
with u as (update public.members set role = 'owner' where user_id = auth.uid() returning 1) select pg_temp.check('driver cannot promote own membership', (select count(*) from u) = 0);
do $$ begin
  insert into public.invites (carrier_id, phone, role) values ('carrier-a', '5550000', 'owner');
  raise notice 'FAIL driver invited an owner';
exception when others then raise notice 'PASS driver cannot invite people';
end $$;

-- Owner-operator: owner and driver in one
select pg_temp.as_user('00000000-0000-0000-0000-00000000000f');
select pg_temp.check('owner-operator sees own escalation', (select count(*) from public.escalations) = 1);
select pg_temp.check('owner-operator sees own load', (select count(*) from public.loads) = 1);
select pg_temp.check('owner-operator has driver identity', public.my_driver_id('carrier-o') = 'drv-o');

-- Records and per-carrier ids
select pg_temp.as_user('bbbbbbbb-0000-0000-0000-000000000002');
insert into public.loads (id, carrier_id, truck_id, stage) values ('L1', 'carrier-b', 'tb', 'offered');
select pg_temp.check('two carriers can use the same load id', (select count(*) from public.loads where id = 'L1') = 1);
select pg_temp.as_user('dddddddd-0000-0000-0000-000000000003');
insert into public.records (id, carrier_id, kind, driver_id) values ('R1', 'carrier-a', 'dvir', 'drv-1');
select pg_temp.check('driver files own inspection', (select count(*) from public.records where id = 'R1') = 1);
insert into public.driver_messages (id, carrier_id, driver_id) values ('M1', 'carrier-a', 'drv-1');
select pg_temp.check('driver writes own message', (select count(*) from public.driver_messages) = 1);
do $$ begin
  insert into public.records (id, carrier_id, kind, driver_id) values ('R2', 'carrier-a', 'expense', 'drv-2');
  raise notice 'FAIL driver filed an expense as a coworker';
exception when others then raise notice 'PASS driver cannot file for a coworker';
end $$;
do $$ begin
  insert into public.records (id, carrier_id, kind, driver_id) values ('R3', 'carrier-a', 'maintenance', 'drv-1');
  raise notice 'FAIL driver booked shop time';
exception when others then raise notice 'PASS driver cannot add office-only records';
end $$;
insert into public.dispatch_calls (id, carrier_id, driver_id, status) values ('C3', 'carrier-a', 'drv-1', 'live');
select pg_temp.check('driver calls in', (select count(*) from public.dispatch_calls where id = 'C3') = 1);
do $$ begin
  insert into public.dispatch_calls (id, carrier_id, driver_id, status) values ('C4', 'carrier-a', 'drv-2', 'live');
  raise notice 'FAIL driver started a call as a coworker';
exception when others then raise notice 'PASS driver cannot start a call as a coworker';
end $$;
select pg_temp.as_user('eeeeeeee-0000-0000-0000-000000000004');
select pg_temp.check('coworker cannot see the inspection', (select count(*) from public.records) = 0);
select pg_temp.check('coworker cannot see the message', (select count(*) from public.driver_messages) = 0);
select pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000001');
select pg_temp.check('owner sees the inspection', (select count(*) from public.records) = 1);
with u as (update public.driver_messages set data = '{"read":true}' where id = 'M1' returning 1) select pg_temp.check('office updates a message', (select count(*) from u) = 1);

-- Channels (second migration)
select pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000001');
select pg_temp.check('sign-up records the owner phone', (select owner_phone from public.carriers where id = 'carrier-a') = '12145550100');
select pg_temp.check('every carrier gets an inbound email key', (select length(inbound_key) from public.carriers where id = 'carrier-a') = 12);
reset role;
insert into public.channel_messages (carrier_id, channel, direction, provider_id, driver_id, counterparty, body) values
  ('carrier-a', 'sms', 'in', 'SM1', 'drv-1', '+12145550148', 'loaded'),
  ('carrier-a', 'email', 'in', 'em1', null, 'broker@x.test', 'rate con');
do $$ begin
  insert into public.channel_messages (carrier_id, channel, direction, provider_id) values ('carrier-a', 'sms', 'in', 'SM1');
  raise notice 'FAIL the same provider message was stored twice';
exception when unique_violation then raise notice 'PASS a provider message is stored once';
end $$;
insert into public.outbound (carrier_id, channel, recipient, body, status) values ('carrier-a', 'email', 'loads@tql.test', 'Can we get it?', 'held');
set role authenticated;
select pg_temp.check('driver lookup by phone digits', (select count(*) from public.drivers where phone_last10 = '2145550148') = 1);
select pg_temp.check('owner sees the channel log', (select count(*) from public.channel_messages) = 2);
select pg_temp.check('owner sees what practice mode held back', (select count(*) from public.outbound where status = 'held') = 1);
do $$ begin
  insert into public.outbound (carrier_id, channel, recipient, status) values ('carrier-a', 'sms', '+12145550148', 'retry');
  raise notice 'FAIL the owner queued a message to send';
exception when others then raise notice 'PASS only the server sends or holds messages';
end $$;
insert into public.records (id, carrier_id, kind, data) values ('B1', 'carrier-a', 'broker', '{"company":"Coastal"}');
select pg_temp.as_user('dddddddd-0000-0000-0000-000000000003');
select pg_temp.check('driver sees only their own texts in the log', (select count(*) from public.channel_messages) = 1);
select pg_temp.check('driver does not see held messages', (select count(*) from public.outbound) = 0);
select pg_temp.check('driver can read the carrier brokers', (select count(*) from public.records where kind = 'broker') = 1);
do $$ begin
  insert into public.records (id, carrier_id, kind, driver_id) values ('B2', 'carrier-a', 'broker', 'drv-1');
  raise notice 'FAIL driver added a broker';
exception when others then raise notice 'PASS driver cannot add brokers';
end $$;
do $$ begin
  insert into public.channel_messages (carrier_id, channel, direction) values ('carrier-a', 'sms', 'out');
  raise notice 'FAIL driver wrote to the channel log';
exception when others then raise notice 'PASS only the server writes the channel log';
end $$;
select pg_temp.as_user('bbbbbbbb-0000-0000-0000-000000000002');
select pg_temp.check('another fleet sees none of the channel log', (select count(*) from public.channel_messages) = 0);
select pg_temp.check('another fleet sees none of the held messages', (select count(*) from public.outbound) = 0);
select pg_temp.check('another fleet sees none of the brokers', (select count(*) from public.records where kind = 'broker') = 0);

-- Files: the carrier's papers are the office's; a driver sees the files on their own truck's loads
reset role;
insert into public.carrier_files (id, carrier_id, kind, load_id, name, content_type, size, data) values
  ('11111111-0000-0000-0000-000000000001', 'carrier-a', 'w9', null, 'w9.pdf', 'application/pdf', 3, 'AAA'),
  ('11111111-0000-0000-0000-000000000002', 'carrier-a', 'pod', 'L1', 'pod1.jpg', 'image/jpeg', 3, 'AAA'),
  ('11111111-0000-0000-0000-000000000003', 'carrier-a', 'pod', 'L2', 'pod2.jpg', 'image/jpeg', 3, 'AAA');
insert into public.agent_marks (carrier_id, load_id, kind) values ('carrier-a', 'L1', 'before_pickup');
do $$ begin
  insert into public.agent_marks (carrier_id, load_id, kind) values ('carrier-a', 'L1', 'before_pickup');
  raise notice 'FAIL a check-in was marked twice';
exception when unique_violation then raise notice 'PASS each check-in is claimed once';
end $$;
set role authenticated;
select pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000001');
select pg_temp.check('owner sees all the carrier files', (select count(*) from public.carrier_files) = 3);
select pg_temp.as_user('dddddddd-0000-0000-0000-000000000003');
select pg_temp.check('driver sees only the POD on their own load', (select array_agg(name) from public.carrier_files) = array['pod1.jpg']);
do $$ begin
  insert into public.carrier_files (carrier_id, kind, name, content_type, size, data) values ('carrier-a', 'w9', 'x', 'x', 1, 'x');
  raise notice 'FAIL a driver wrote a file directly';
exception when others then raise notice 'PASS only the server stores files';
end $$;
do $$ begin
  perform count(*) from public.agent_marks;
  raise notice 'FAIL a signed-in person read the AI''s marks';
exception when insufficient_privilege then raise notice 'PASS only the server reads the AI''s marks';
end $$;
select pg_temp.as_user('bbbbbbbb-0000-0000-0000-000000000002');
select pg_temp.check('another fleet sees none of the files', (select count(*) from public.carrier_files) = 0);

-- Backroute's support list and carriers' ELD / feed keys: only the server reads them
reset role;
insert into public.support_staff (user_id, name) values ('bbbbbbbb-0000-0000-0000-000000000002', 'Sam');
insert into public.carrier_integrations (carrier_id, kind, config) values ('carrier-a', 'samsara', '{"apiKey":"secret"}');
set role authenticated;
select pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000001');
do $$ begin
  perform count(*) from public.carrier_integrations;
  raise notice 'FAIL the owner read the stored ELD key';
exception when insufficient_privilege then raise notice 'PASS even the owner cannot read stored keys back';
end $$;
do $$ begin
  perform count(*) from public.support_staff;
  raise notice 'FAIL someone read the support list';
exception when insufficient_privilege then raise notice 'PASS the support list is server-only';
end $$;
do $$ begin
  perform count(*) from public.usage;
  raise notice 'FAIL an owner read what carriers cost to run';
exception when insufficient_privilege then raise notice 'PASS what carriers cost to run is server-only';
end $$;
do $$ begin
  perform count(*) from public.facility_visits;
  raise notice 'FAIL an owner read the shared dock record';
exception when insufficient_privilege then raise notice 'PASS the shared dock record is server-only';
end $$;
do $$ begin
  perform count(*) from public.portal_logins;
  raise notice 'FAIL an owner read the website password vault';
exception when insufficient_privilege then raise notice 'PASS even the owner cannot read the website password vault';
end $$;
do $$ begin
  insert into public.portal_logins (id, carrier_id, kind, site, label, secret) values ('x', 'carrier-a', 'login', 'evil.com', 'x', 'x');
  raise notice 'FAIL an owner wrote to the password vault directly';
exception when insufficient_privilege then raise notice 'PASS only the server writes the password vault';
end $$;
do $$ begin
  perform count(*) from public.portal_tasks;
  raise notice 'FAIL an owner read the website job queue directly';
exception when insufficient_privilege then raise notice 'PASS the website job queue is server-only';
end $$;
do $$ begin
  perform public.claim_portal_task('me', 60);
  raise notice 'FAIL an owner took a website job like the worker';
exception when insufficient_privilege then raise notice 'PASS only the worker (server) takes website jobs';
end $$;
do $$ begin
  perform count(*) from public.carrier_billing;
  raise notice 'FAIL an owner read the billing table directly';
exception when insufficient_privilege then raise notice 'PASS billing is server-only (read through the app)';
end $$;
do $$ begin
  insert into public.carrier_billing (carrier_id, status) values ('carrier-a', 'active');
  raise notice 'FAIL an owner marked their own account paid';
exception when insufficient_privilege then raise notice 'PASS no one can mark their own account paid';
end $$;
do $$ begin
  perform count(*) from public.push_subscriptions;
  raise notice 'FAIL an owner read the push devices directly';
exception when insufficient_privilege then raise notice 'PASS push devices are server-only';
end $$;
do $$ begin
  perform count(*) from public.service_heartbeats;
  raise notice 'FAIL someone read the system heartbeats';
exception when insufficient_privilege then raise notice 'PASS system heartbeats are server-only';
end $$;
do $$ begin
  perform public.hit_rate_limit('x', 60, 1);
  raise notice 'FAIL an owner reset a rate limit';
exception when insufficient_privilege then raise notice 'PASS only the server counts rate limits';
end $$;
do $$ begin
  perform public.add_usage('carrier-a', '2026-09', 1, 1);
  raise notice 'FAIL an owner wrote to the usage count';
exception when insufficient_privilege then raise notice 'PASS only the server counts usage';
end $$;
do $$ begin
  insert into public.support_staff (user_id, name) values ('aaaaaaaa-0000-0000-0000-000000000001', 'Me');
  raise notice 'FAIL an owner made themselves support staff';
exception when insufficient_privilege then raise notice 'PASS nobody can add themselves to support';
end $$;

-- Reaching drivers (natural dispatch): consent records, dock tips, text routes, weekly reviews
reset role;
insert into public.driver_consents (carrier_id, driver_id, phone, granted, via, wording, version) values
  ('carrier-a', 'drv-1', '+12145550148', true, 'app', 'I agree', 'v1'),
  ('carrier-a', 'drv-2', '+19725550163', true, 'owner', 'They agreed', 'v1'),
  ('carrier-b', 'drv-x', '+14695550999', true, 'owner', 'They agreed', 'v1');
insert into public.facility_notes (carrier_id, driver_id, name_key, city, state, note) values ('carrier-a', 'drv-1', 'acmedc', 'memphis', 'TN', 'Back in from the east gate'), ('carrier-b', 'drv-x', 'acmedc', 'memphis', 'TN', 'Guard shack on Elm');
insert into public.weekly_reviews (carrier_id, week, data) values ('carrier-a', '2026-W39', '{"loads": 3}'), ('carrier-b', '2026-W39', '{"loads": 9}');
insert into public.text_routes (phone_last10, whatsapp_at) values ('2145550148', now());
do $$ begin
  update public.driver_consents set granted = false where driver_id = 'drv-1';
  raise notice 'FAIL a consent record was changed after the fact';
exception when insufficient_privilege then raise notice 'PASS consent records can''t be changed, even by the server';
end $$;
do $$ begin
  delete from public.driver_consents where driver_id = 'drv-1';
  raise notice 'FAIL a consent record was deleted';
exception when insufficient_privilege then raise notice 'PASS consent records can''t be deleted while the carrier exists';
end $$;
set role authenticated;
select pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000001');
select pg_temp.check('owner sees their drivers'' consent records only', (select count(*) from public.driver_consents) = 2);
select pg_temp.check('owner sees their own drivers'' dock tips only', (select count(*) from public.facility_notes) = 1);
select pg_temp.check('owner sees their own weekly review only', (select count(*) from public.weekly_reviews) = 1);
do $$ begin
  insert into public.driver_consents (carrier_id, driver_id, granted, via, wording, version) values ('carrier-a', 'drv-1', true, 'owner', 'x', 'v1');
  raise notice 'FAIL an owner wrote a consent record directly';
exception when insufficient_privilege then raise notice 'PASS consent is recorded only by the server (with who and when)';
end $$;
do $$ begin
  perform count(*) from public.text_routes;
  raise notice 'FAIL an owner read how phone numbers text us';
exception when insufficient_privilege then raise notice 'PASS text routes are server-only';
end $$;
select pg_temp.as_user('dddddddd-0000-0000-0000-000000000003');
select pg_temp.check('driver sees only their own consent record', (select count(*) from public.driver_consents) = 1 and (select driver_id from public.driver_consents) = 'drv-1');
select pg_temp.check('driver reads no dock tips table directly', (select count(*) from public.facility_notes) = 0);
select pg_temp.check('driver sees no weekly review', (select count(*) from public.weekly_reviews) = 0);
do $$ begin
  perform public.merge_carrier_settings('carrier-a', '{"sandbox": false}'::jsonb, false);
  raise notice 'FAIL a driver changed the carrier''s settings';
exception when insufficient_privilege then raise notice 'PASS a driver can''t change the carrier''s settings';
end $$;
-- Settings: the app sends only what changed, and the database merges it (a key the server set meanwhile stays).
reset role;
update public.carriers set settings = coalesce(settings, '{}'::jsonb) || '{"sandbox": true, "keepMe": 1, "dropMe": 2}'::jsonb where id = 'carrier-a';
set role authenticated;
select pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000001');
select pg_temp.check('owner merges a settings change', (public.merge_carrier_settings('carrier-a', '{"maxDeadhead": 250, "dropMe": null}'::jsonb, false) ->> 'maxDeadhead') = '250');
reset role;
select pg_temp.check('a key set elsewhere survives the owner''s save', (select settings ->> 'keepMe' from public.carriers where id = 'carrier-a') = '1' and (select settings ->> 'sandbox' from public.carriers where id = 'carrier-a') = 'true');
select pg_temp.check('a key the owner cleared is removed', (select settings ? 'dropMe' from public.carriers where id = 'carrier-a') = false);
set role authenticated;
select pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000001');
do $$ begin
  perform public.merge_carrier_settings('carrier-b', '{"sandbox": false}'::jsonb, false);
  raise notice 'FAIL an owner changed another carrier''s settings';
exception when insufficient_privilege then raise notice 'PASS an owner can''t change another carrier''s settings';
end $$;
reset role;
select pg_temp.check('the other carrier''s settings are untouched', (select coalesce(settings ->> 'maxDeadhead', '') from public.carriers where id = 'carrier-b') <> '250');
set role anon;
select pg_temp.as_user('');
do $$ begin
  perform public.merge_carrier_settings('carrier-a', '{}'::jsonb, false);
  raise notice 'FAIL anonymous called the settings merge';
exception when insufficient_privilege then raise notice 'PASS anonymous can''t call the settings merge';
end $$;
reset role;
set role authenticated;
select pg_temp.as_user('dddddddd-0000-0000-0000-000000000003');
reset role;
insert into public.held_sends (id, carrier_id, purpose, summary, draft, send_at) values ('hs_a', 'carrier-a', 'counter', 'Countering at $2,000', '{}', now() + interval '1 minute'), ('hs_b', 'carrier-b', 'counter', 'Countering at $9,000', '{}', now() + interval '1 minute');
set role authenticated;
select pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000001');
select pg_temp.check('owner sees what the AI is about to send, for their carrier only', (select count(*) from public.held_sends) = 1 and (select id from public.held_sends) = 'hs_a');
do $$ begin
  update public.held_sends set status = 'stopped' where id = 'hs_a';
  raise notice 'FAIL an owner changed a held email directly';
exception when insufficient_privilege then raise notice 'PASS stopping one goes through the server (it checks who asks), not straight to the table';
end $$;
select pg_temp.as_user('dddddddd-0000-0000-0000-000000000003');
select pg_temp.check('a driver sees none of it', (select count(*) from public.held_sends) = 0);
reset role;
delete from public.carriers where id = 'carrier-b';
select pg_temp.check('removing a carrier removes its consent records', (select count(*) from public.driver_consents where carrier_id = 'carrier-b') = 0);
set role authenticated;

-- ─── Owner tools: bookkeeper, audit log, devices, two-step sign-in ───────────
reset role;
insert into auth.users values ('cccccccc-0000-0000-0000-00000000000c', '12145550177');
set role authenticated;
select pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000001');
insert into public.invites (carrier_id, phone, role) values ('carrier-a', '12145550177', 'bookkeeper');
insert into public.records (id, carrier_id, kind, driver_id, data) values ('PR1', 'carrier-a', 'pay_run', 'drv-1', '{"status": "draft", "net": 1200, "period": "2026-09-28"}'), ('PR2', 'carrier-a', 'pay_run', 'drv-2', '{"status": "draft", "net": 900}');
update public.records set data = data || '{"status": "paid"}' where id = 'PR1' and kind = 'pay_run';
select pg_temp.as_user('cccccccc-0000-0000-0000-00000000000c');
select pg_temp.check('bookkeeper claims their invite', public.claim_invites() = 1);
select pg_temp.check('bookkeeper sees the loads, trucks and drivers', (select count(*) from public.loads) = 2 and (select count(*) from public.trucks) = 2 and (select count(*) from public.drivers) = 2);
select pg_temp.check('bookkeeper sees no escalations or driver messages', (select count(*) from public.escalations) = 0 and (select count(*) from public.driver_messages) = 0);
insert into public.records (id, carrier_id, kind, data) values ('F1', 'carrier-a', 'fuel', '{"gallons": 120, "amount": 480}');
select pg_temp.check('bookkeeper adds a fuel transaction', (select count(*) from public.records where kind = 'fuel') = 1);
do $$ begin
  insert into public.records (id, carrier_id, kind, data) values ('X1', 'carrier-a', 'incident', '{}');
  raise notice 'FAIL a bookkeeper wrote an incident';
exception when insufficient_privilege then raise notice 'PASS a bookkeeper writes only money records';
end $$;
with u as (update public.loads set stage = 'delivered' where id = 'L1' returning 1) select pg_temp.check('bookkeeper cannot move a load', (select count(*) from u) = 0);
select pg_temp.check('bookkeeper''s mark-paid goes through', public.mark_invoice_paid('carrier-a', 'L1', 2000));
select pg_temp.check('bookkeeper marks an invoiced load paid, and only that', (select data -> 'invoice' ->> 'paidAmount' = '2000' and (data -> 'invoice' ->> 'amount')::int = 2000 and stage = 'at_delivery' from public.loads where id = 'L1'));
do $$ begin
  perform public.mark_invoice_paid('carrier-b', 'X', 1);
  raise notice 'FAIL bookkeeper marked another carrier''s invoice';
exception when insufficient_privilege then raise notice 'PASS bookkeeper can''t touch another carrier';
end $$;
select pg_temp.check('bookkeeper can''t read the audit log', (select count(*) from public.audit_log) = 0);
insert into public.devices (id, label) values ('device-bk-1', 'Chrome on Mac');
select pg_temp.as_user('dddddddd-0000-0000-0000-000000000003');
select pg_temp.check('driver sees only their own pay run', (select count(*) from public.records where kind = 'pay_run') = 1);
select pg_temp.check('driver sees no one else''s devices', (select count(*) from public.devices) = 0);
select pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000001');
select pg_temp.check('owner''s audit log has the invite, the bookkeeper, the paid run and the paid invoice',
  (select count(*) from public.audit_log where action = 'Let in a bookkeeper') = 1
  and (select count(*) from public.audit_log where action = 'Signed in for the first time' and target = 'Bookkeeper') = 1
  and (select count(*) from public.audit_log where action like 'Took back%') = 0
  and (select count(*) from public.audit_log where action like 'Paid a driver $1200%') = 1
  and (select count(*) from public.audit_log where action = 'Marked paid' and target = 'L1' and who = 'bookkeeper') = 1);
select pg_temp.check('owner''s audit log is theirs alone', (select count(distinct carrier_id) from public.audit_log) = 1);
do $$ begin
  insert into public.audit_log (carrier_id, who, action) values ('carrier-a', 'owner', 'forged');
  raise notice 'FAIL someone wrote to the audit log directly';
exception when insufficient_privilege then raise notice 'PASS nobody writes the audit log by hand';
end $$;
-- Two-step sign-in: the owner turns it on; a session that hasn't entered the code reads nothing.
reset role;
create table if not exists auth.mfa_factors (id uuid primary key default gen_random_uuid(), user_id uuid, status text);
insert into auth.mfa_factors (user_id, status) values ('aaaaaaaa-0000-0000-0000-000000000001', 'verified');
set role authenticated;
select pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000001');
select pg_temp.check('two-step on, code not entered: no loads', (select count(*) from public.loads) = 0);
with u as (update public.loads set stage = 'cancelled' where id = 'L2' returning 1) select pg_temp.check('two-step on, code not entered: can''t change a load', (select count(*) from u) = 0);
select set_config('request.jwt.claim.aal', 'aal2', false);
select pg_temp.check('two-step passed: the loads are back', (select count(*) from public.loads) = 2);
select set_config('request.jwt.claim.aal', '', false);
select pg_temp.as_user('dddddddd-0000-0000-0000-000000000003');
select pg_temp.check('people without two-step aren''t affected', (select count(*) from public.loads) = 1);
reset role;
delete from auth.mfa_factors;
set role authenticated;

-- Not signed in: nothing
reset role;
set role anon;
select pg_temp.as_user('');
do $$ begin
  perform count(*) from public.portal_logins;
  raise notice 'FAIL anonymous read the password vault';
exception when insufficient_privilege then raise notice 'PASS anonymous cannot read the password vault';
end $$;
do $$ begin
  perform count(*) from public.loads;
  raise notice 'FAIL anonymous read loads';
exception when insufficient_privilege then raise notice 'PASS anonymous cannot read anything';
end $$;
