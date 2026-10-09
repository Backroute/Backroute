-- Indexes for the queries that read across every carrier, found with the 200-carrier load test (docs/testing.md):
-- the health check and the support queue (escalations with support, by time), the outbox (given up and held
-- messages, by time), and a driver's own thread (heard from them since a check-in).
create index if not exists escalations_status_updated on public.escalations (status, updated_at desc);
create index if not exists outbound_status_created on public.outbound (status, created_at desc);
create index if not exists channel_messages_driver on public.channel_messages (carrier_id, driver_id, created_at desc) where driver_id is not null;
