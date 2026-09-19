import type { Load, LoadStage } from "./types";

/** Driver-facing headline for each stage a "current load" can be in — what an Uber-style trip screen
 *  shows instead of a generic stage pill, so the card reads as live progress instead of a static label. */
export const LOAD_STATUS_HEADLINE: Partial<Record<LoadStage, string>> = {
  negotiating: "AI is negotiating your rate",
  rate_confirmed: "Rate locked, getting you dispatched",
  booked: "Booked, getting you dispatched",
  dispatched: "Heading to pickup",
  at_pickup: "At pickup: load & confirm",
  in_transit: "En route to delivery",
  at_delivery: "At delivery: unload & confirm",
  delivered: "Delivered",
};

/** How far along the physical pickup-to-delivery trip each stage is — a narrower, driver-relevant
 *  scale than Load.progressPct (which spans the whole sourcing-to-delivery lifecycle and would make a
 *  driver who hasn't even reached pickup yet look "64% done"). Only stages where the truck has been
 *  dispatched get a position on this line. */
const TRANSIT_PROGRESS: Partial<Record<LoadStage, number>> = {
  dispatched: 6,
  at_pickup: 30,
  in_transit: 68,
  at_delivery: 94,
  delivered: 100,
};

export function isTransitStage(stage: LoadStage): boolean {
  return stage in TRANSIT_PROGRESS;
}

export function transitProgress(stage: LoadStage): number {
  return TRANSIT_PROGRESS[stage] ?? 0;
}

/** Which stop the driver actually needs right now — showing both pickup and delivery windows at once
 *  stops being useful the moment one of them is already behind you. */
export function nextStop(load: Load): { label: string; window: string } {
  if (load.stage === "in_transit" || load.stage === "at_delivery" || load.stage === "delivered") {
    return { label: "Delivery", window: load.deliveryWindow };
  }
  return { label: "Pickup", window: load.pickupWindow };
}

/** What the AI dispatcher is doing on this load right now — the load detail page surfaces this as a
 *  small live badge so it reads as an actively-managed AI dispatch, not just a static record. */
export function aiDispatcherNote(stage: LoadStage): string {
  if (stage === "negotiating") return "AI Dispatcher · Negotiating rate";
  if (stage === "rate_confirmed" || stage === "booked") return "AI Dispatcher · Dispatching";
  if (stage === "delivered") return "AI Dispatcher · Trip complete";
  if (isTransitStage(stage)) return "AI Dispatcher · Monitoring trip";
  return "AI Dispatcher";
}
