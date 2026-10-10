import "server-only";
import type { Item } from "../cloud/rows";
import { distanceMiles } from "../trip-geo";
import type { Load, LoadStage, TripChecklist } from "../types";
import { addActivity, save, type CarrierContext } from "./db";
import { event } from "./dispatcher";
import { geocodeAddress } from "./routing";

/** In the dock's lot: a big warehouse yard runs a few hundred yards from the street address. */
export const AT_DOCK_MILES = 0.3;
/** Out of the lot and on the road (a margin over the above, so a truck idling at the gate doesn't flip back and forth). */
export const LEFT_DOCK_MILES = 0.75;
/** A GPS fix older than this doesn't say where the truck is now. */
const FRESH_MS = 20 * 60_000;

type Stop = "pickup" | "delivery";
const ARRIVED = { pickup: "arrivedPickupAt", delivery: "arrivedDeliveryAt" } as const;
const LEFT = { pickup: "leftPickupAt", delivery: "leftDeliveryAt" } as const;
const AT_STAGE: Record<Stop, LoadStage> = { pickup: "at_pickup", delivery: "at_delivery" };
const BEFORE: Record<Stop, LoadStage> = { pickup: "dispatched", delivery: "in_transit" };

/** Which dock the truck is working on: the pickup until loaded, then the delivery. */
export function stopFor(stage: LoadStage): Stop | null {
  if (stage === "booked" || stage === "dispatched" || stage === "at_pickup") return "pickup";
  if (stage === "in_transit" || stage === "at_delivery") return "delivery";
  return null;
}

/**
 * What the truck's GPS says about one dock: it just pulled in (arrived), just drove out (left), or nothing new.
 * Only arrives once and only leaves after arriving; the driver's own tap, when it came first, stays.
 */
export function dockChange(c: TripChecklist | undefined, stop: Stop, miles: number): "arrived" | "left" | null {
  const arrived = c?.[ARRIVED[stop]];
  if (!arrived && miles <= AT_DOCK_MILES) return "arrived";
  if (arrived && !c?.[LEFT[stop]] && miles >= LEFT_DOCK_MILES) return "left";
  return null;
}

/**
 * The ELD's GPS sets the dock times a driver would otherwise tap (or forget to): pulling into the shipper's or
 * receiver's lot marks the truck arrived, and driving out records the time it left, which is what a detention claim
 * is measured to. Only with the dock's exact spot from its street address, never a city's middle.
 */
export async function eldDockTimes(ctx: CarrierContext, now: number): Promise<string[]> {
  const done: string[] = [];
  for (const truck of ctx.trucks) {
    const pos = truck.position;
    if (!pos || now - Date.parse(pos.at) > FRESH_MS) continue;
    const load = ctx.loads.find((l) => l.id === truck.currentLoadId && l.truckId === truck.id);
    const stop = load ? stopFor(load.stage) : null;
    if (!load || !stop) continue;
    let next: Load = load;
    // The dock's spot, looked up once and kept on the load.
    if (next.dockPoints?.[stop] === undefined) {
      const address = stop === "pickup" ? (load.pickupAddress ?? load.rateConReading?.shipperAddress) : (load.deliveryAddress ?? load.rateConReading?.receiverAddress);
      if (!address) continue;
      const point = await geocodeAddress(address).catch(() => null);
      next = { ...next, dockPoints: { ...next.dockPoints, [stop]: point } };
    }
    const dock = next.dockPoints?.[stop];
    const change = dock ? dockChange(next.tripChecklist, stop, distanceMiles([pos.lat, pos.lon], [dock.lat, dock.lon])) : null;
    if (change) {
      const key = change === "arrived" ? ARRIVED[stop] : LEFT[stop];
      const c = next.tripChecklist ?? {};
      next = {
        ...next,
        tripChecklist: { ...c, [key]: pos.at, fromEld: [...(c.fromEld ?? []), key] },
        // Pulling in moves the load to "at the dock", the way the driver's own tap would; leaving waits for the driver's
        // "loaded" (with the BOL) or the POD.
        ...(change === "arrived" && next.stage === BEFORE[stop] ? { stage: AT_STAGE[stop], ticksInStage: 0, progressPct: stop === "pickup" ? 20 : 90 } : {}),
        updatedAt: new Date(now).toISOString(),
      };
      const place = stop === "pickup" ? (load.rateConReading?.shipper ?? `the shipper in ${load.lane.origin}`) : (load.rateConReading?.receiver ?? `the receiver in ${load.lane.destination}`);
      const what = change === "arrived" ? `${truck.unitNumber} pulled in at ${place}` : `${truck.unitNumber} left ${place}`;
      await addActivity(ctx.carrier.id, event({ type: "check_call", loadId: load.id, message: what, detail: `${load.referenceNumber} · from the ELD (${pos.source === "samsara" ? "Samsara" : "Motive"})`, severity: "info" }));
      done.push(`${load.referenceNumber}: ${change} ${stop} (ELD)`);
    }
    if (next !== load) {
      await save("loads", ctx.carrier.id, next as unknown as Item);
      ctx.loads = ctx.loads.map((l) => (l.id === load.id ? next : l));
    }
  }
  return done;
}
