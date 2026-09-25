import { admin, dbConfigured } from "@/lib/agent/db";
import { supportCaller } from "@/lib/agent/support";
import type { AgentSettings } from "@/lib/store";
import type { Broker, Driver, Escalation, Load, Truck } from "@/lib/types";

/**
 * Everything waiting on Backroute's support team, across all carriers, with what's needed to act on it: the carrier,
 * the load, the driver and broker and how to reach them, and the latest texts, calls or emails about it.
 */
export async function GET(request: Request) {
  if (!dbConfigured()) return Response.json({ error: "not_set_up" }, { status: 503 });
  const me = await supportCaller(request);
  if (!me) return Response.json({ error: "support_only" }, { status: 403 });
  const db = admin();

  const [{ data: open }, { data: carriers }] = await Promise.all([
    db.from("escalations").select("carrier_id, data").eq("status", "with_support").limit(300),
    db.from("carriers").select("id, name, mc, owner_phone, settings"),
  ]);
  const byCarrier = new Map((carriers ?? []).map((c) => [c.id as string, c]));
  const ids = [...new Set((open ?? []).map((r) => r.carrier_id as string))];
  const rows = async <T,>(table: string, kind?: string) => {
    if (!ids.length) return [] as { carrier_id: string; data: T }[];
    let q = db.from(table).select("carrier_id, data").in("carrier_id", ids);
    if (kind) q = q.eq("kind", kind);
    const { data } = await q.limit(5000);
    return (data ?? []) as { carrier_id: string; data: T }[];
  };
  const [loads, drivers, trucks, brokers] = await Promise.all([rows<Load>("loads"), rows<Driver>("drivers"), rows<Truck>("trucks"), rows<Broker>("records", "broker")]);
  const find = <T extends { id: string }>(list: { carrier_id: string; data: T }[], carrierId: string, id?: string | null) => (id ? list.find((r) => r.carrier_id === carrierId && r.data.id === id)?.data : undefined);

  const items = await Promise.all(
    (open ?? []).map(async (r) => {
      const e = r.data as Escalation;
      const carrierId = r.carrier_id as string;
      const load = find(loads, carrierId, e.loadId);
      const truck = find(trucks, carrierId, load?.truckId);
      const driver = find(drivers, carrierId, truck?.driverId);
      const broker = find(brokers, carrierId, load?.brokerId ?? e.brokerId);
      // The conversation it came from: the driver's texts and calls, or the broker's emails.
      let q = db.from("channel_messages").select("channel, direction, counterparty, body, created_at, data").eq("carrier_id", carrierId);
      const emailWith = e.draft?.to ?? load?.brokerContactEmail ?? broker?.email;
      if (e.source === "email" && emailWith) q = q.eq("channel", "email").eq("counterparty", emailWith.toLowerCase());
      else if (driver) q = q.eq("driver_id", driver.id);
      else q = q.eq("channel", "none");
      const { data: thread } = await q.order("created_at", { ascending: false }).limit(12);
      const c = byCarrier.get(carrierId);
      return {
        carrier: { id: carrierId, name: c?.name ?? "", mc: c?.mc ?? null, ownerPhone: c?.owner_phone ?? null, autonomy: (c?.settings as Partial<AgentSettings> | null)?.autonomy ?? "ask" },
        escalation: e,
        load: load ? { id: load.id, ref: load.referenceNumber, lane: `${load.lane.origin}, ${load.lane.originState} → ${load.lane.destination}, ${load.lane.destState}`, stage: load.stage, pickup: load.pickupWindow, delivery: load.deliveryWindow, rate: load.bookedRate ?? load.targetRate } : null,
        truck: truck ? { unit: truck.unitNumber } : null,
        driver: driver ? { id: driver.id, name: driver.name, phone: driver.phone, language: driver.prefs?.language ?? "en", smsOptOut: !!driver.prefs?.smsOptOut } : null,
        broker: broker ? { id: broker.id, company: broker.company, email: load?.brokerContactEmail ?? broker.email, phone: broker.phone, mc: broker.mc ?? null, verified: broker.authorityVerified, note: broker.verifyNote ?? null } : null,
        thread: (thread ?? []).reverse(),
      };
    }),
  );
  items.sort((a, b) => Number(b.escalation.complexity === "critical") - Number(a.escalation.complexity === "critical") || Date.parse(a.escalation.createdAt) - Date.parse(b.escalation.createdAt));

  const summary = (carriers ?? []).map((c) => ({
    id: c.id as string,
    name: c.name as string,
    mc: c.mc as string | null,
    ownerPhone: c.owner_phone as string | null,
    autonomy: (c.settings as Partial<AgentSettings> | null)?.autonomy ?? "ask",
    waiting: items.filter((i) => i.carrier.id === c.id).length,
  }));
  return Response.json({ me, items, carriers: summary });
}
