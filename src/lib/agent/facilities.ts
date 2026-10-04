import type { Load } from "../types";

/**
 * What a dispatcher knows about docks after a few months: which shippers and receivers keep trucks waiting. Worked out
 * from the carrier's own loads (the names on the rate con, and the driver's in and out times at each stop).
 */

export const norm = (s: string) => s.toLowerCase().replace(/\b(inc|llc|co|corp|company|dc|warehouse)\b/g, "").replace(/[^a-z0-9]/g, "");

export interface FacilityStats {
  name: string;
  visits: number;
  /** Average time from arriving to leaving, in minutes. */
  avgMinutes: number;
}

function stops(load: Load): { name: string; city: string; minutes: number }[] {
  const c = load.tripChecklist;
  const r = load.rateConReading;
  const out: { name: string; city: string; minutes: number }[] = [];
  if (r?.shipper && c?.arrivedPickupAt && c.loadedAt) out.push({ name: r.shipper, city: load.lane.origin, minutes: (Date.parse(c.loadedAt) - Date.parse(c.arrivedPickupAt)) / 60000 });
  if (r?.receiver && c?.arrivedDeliveryAt && c.unloadedAt) out.push({ name: r.receiver, city: load.lane.destination, minutes: (Date.parse(c.unloadedAt) - Date.parse(c.arrivedDeliveryAt)) / 60000 });
  return out.filter((s) => s.minutes > 0 && s.minutes < 48 * 60);
}

/** The history at one facility (by name and city), or null when the trucks haven't been there. */
function facilityStats(loads: Load[], name: string | null | undefined, city: string, excludeLoadId?: string): FacilityStats | null {
  if (!name) return null;
  const key = norm(name);
  const visits = loads
    .filter((l) => l.id !== excludeLoadId)
    .flatMap(stops)
    .filter((s) => norm(s.name) === key && s.city.toLowerCase() === city.toLowerCase());
  if (!visits.length) return null;
  return { name, visits: visits.length, avgMinutes: Math.round(visits.reduce((a, b) => a + b.minutes, 0) / visits.length) };
}

/** Facilities on this load that usually keep trucks 3 hours or more (seen at least twice). */
export function slowDocks(loads: Load[], load: Load): FacilityStats[] {
  const r = load.rateConReading;
  return [facilityStats(loads, r?.shipper, load.lane.origin, load.id), facilityStats(loads, r?.receiver, load.lane.destination, load.id)].filter(
    (f): f is FacilityStats => !!f && f.visits >= 2 && f.avgMinutes >= 180,
  );
}
