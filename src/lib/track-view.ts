import type { Load, Truck } from "./types";
import { cityCoords, nearestCity, roadMiles, type LatLng } from "./trip-geo";

/**
 * What a broker or shipper sees on a shared tracking page: the load, where the truck is to the nearest town (never the
 * exact spot), and when it should arrive. Nothing about money, the driver or other loads. Once it delivers, only that.
 */
export interface TrackView {
  ref: string;
  carrier: string;
  origin: string;
  destination: string;
  step: "booked" | "to_pickup" | "at_pickup" | "in_transit" | "at_delivery" | "delivered" | "cancelled";
  status: string;
  where: string | null;
  whereAt: string | null;
  eta: string | null;
  pickupAt: string | null;
  deliveryAt: string | null;
  deliveredAt: string | null;
  podReceived: boolean;
}

const STEP: Partial<Record<Load["stage"], TrackView["step"]>> = {
  rate_confirmed: "booked",
  booked: "booked",
  dispatched: "to_pickup",
  at_pickup: "at_pickup",
  in_transit: "in_transit",
  at_delivery: "at_delivery",
  delivered: "delivered",
  cancelled: "cancelled",
};

const STATUS: Record<TrackView["step"], string> = {
  booked: "Booked",
  to_pickup: "On the way to pick up",
  at_pickup: "At pickup",
  in_transit: "On the way to deliver",
  at_delivery: "At delivery",
  delivered: "Delivered",
  cancelled: "Cancelled",
};

/** A position older than this isn't used for where or when. */
const FRESH_MS = 2 * 3600_000;

export function trackView(load: Load, truck: Truck | undefined, carrier: string, now: number): TrackView | null {
  const step = STEP[load.stage];
  if (!step) return null;
  const moving = step === "to_pickup" || step === "at_pickup" || step === "in_transit" || step === "at_delivery";
  const pos = moving && truck?.position && now - Date.parse(truck.position.at) < FRESH_MS ? truck.position : undefined;
  const at: LatLng | undefined = pos ? [pos.lat, pos.lon] : undefined;
  const town = at ? nearestCity(at, 60) : undefined;
  const where = !moving ? null : town ? `Near ${town.city}, ${town.state}` : pos?.description ? pos.description.replace(/^.*?,\s*(?=[^,]+,\s*[A-Z]{2}$)/, "") : truck?.currentCity ? `${truck.currentCity}, ${truck.currentState}` : null;
  const dest = cityCoords(load.lane.destination, load.lane.destState);
  // An arrival time only from a fresh position, at a truck's usual 50 mph: the broker gets no guess dressed up as a fact.
  const eta = step === "in_transit" && at && dest ? new Date(now + (roadMiles(at, dest) / 50) * 3600_000).toISOString() : null;
  const delivered = step === "delivered";
  return {
    ref: load.referenceNumber,
    carrier,
    origin: `${load.lane.origin}, ${load.lane.originState}`,
    destination: `${load.lane.destination}, ${load.lane.destState}`,
    step,
    status: STATUS[step],
    where: delivered ? null : where,
    whereAt: delivered || !where ? null : (pos?.at ?? null),
    eta,
    pickupAt: load.pickupAt ?? null,
    deliveryAt: load.deliveryAt ?? null,
    deliveredAt: delivered ? (load.tripChecklist?.unloadedAt ?? load.updatedAt) : null,
    podReceived: load.documents.some((d) => d.type === "pod" && d.status === "verified"),
  };
}
