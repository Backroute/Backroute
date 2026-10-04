import "server-only";
import type { Load } from "../types";
import { admin, type CarrierContext } from "./db";
import { norm, slowDocks, type FacilityStats } from "./facilities";

/**
 * What every carrier on Backroute has learned about docks, pooled: how long each shipper and receiver keeps trucks.
 * A dispatcher knows the docks they've sent trucks to; this knows every dock any carrier's truck has been to. Only
 * the facility, the city and the minutes are shared: no load, broker, rate or carrier.
 */

const MIN_VISITS = 3;
const SLOW_MINUTES = 180;

/** Stops this carrier's trucks finished recently: added to the shared record (once each). */
export async function shareFacilityVisits(ctx: CarrierContext, now: number): Promise<number> {
  const rows: { carrier_id: string; load_id: string; stop: string; name_key: string; city: string; state: string; minutes: number }[] = [];
  for (const l of ctx.loads) {
    if (l.imported || Date.parse(l.updatedAt) < now - 3 * 86400_000) continue;
    const c = l.tripChecklist;
    const r = l.rateConReading;
    const add = (stop: "pickup" | "delivery", name: string | null | undefined, city: string, state: string, from?: string, to?: string) => {
      if (!name || !from || !to) return;
      const minutes = Math.round((Date.parse(to) - Date.parse(from)) / 60000);
      if (minutes > 0 && minutes < 2880 && norm(name)) rows.push({ carrier_id: ctx.carrier.id, load_id: l.id, stop, name_key: norm(name), city: city.toLowerCase(), state: state.toUpperCase(), minutes });
    };
    add("pickup", r?.shipper, l.lane.origin, l.lane.originState, c?.arrivedPickupAt, c?.loadedAt);
    add("delivery", r?.receiver, l.lane.destination, l.lane.destState, c?.arrivedDeliveryAt, c?.unloadedAt);
  }
  if (!rows.length) return 0;
  const { error } = await admin().from("facility_visits").upsert(rows, { onConflict: "carrier_id,load_id,stop", ignoreDuplicates: true });
  if (error) {
    console.error("[network] couldn't share facility visits", error);
    return 0;
  }
  return rows.length;
}

/** The shared record for one facility: how many visits and the average time, or null under three visits. */
async function networkStats(name: string | null | undefined, city: string, state: string): Promise<FacilityStats | null> {
  if (!name || !norm(name)) return null;
  const { data, error } = await admin().from("facility_visits").select("minutes").eq("name_key", norm(name)).eq("city", city.toLowerCase()).eq("state", state.toUpperCase()).order("at", { ascending: false }).limit(200);
  if (error || !data || data.length < MIN_VISITS) return null;
  return { name, visits: data.length, avgMinutes: Math.round(data.reduce((a, b) => a + (b.minutes as number), 0) / data.length) };
}

/** Docks on this load that keep trucks 3 hours or more: from this carrier's own history, else from every carrier's. */
export async function slowDocksAnywhere(ctx: CarrierContext, load: Load): Promise<(FacilityStats & { network: boolean })[]> {
  const own = slowDocks(ctx.loads, load).map((f) => ({ ...f, network: false }));
  const r = load.rateConReading;
  const out = [...own];
  for (const [name, city, state] of [
    [r?.shipper, load.lane.origin, load.lane.originState],
    [r?.receiver, load.lane.destination, load.lane.destState],
  ] as const) {
    if (!name || own.some((f) => norm(f.name) === norm(name))) continue;
    const stats = await networkStats(name, city, state).catch(() => null);
    if (stats && stats.avgMinutes >= SLOW_MINUTES) out.push({ ...stats, network: true });
  }
  return out;
}
