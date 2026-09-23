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

/** Carrier-facing version of the same status: who is actually working the load right now, so a fleet
 *  row reads as "AI is negotiating" vs. "driver is loading" at a glance. */
export const LOAD_STATUS_CARRIER: Partial<Record<LoadStage, { owner: "ai" | "driver"; text: string }>> = {
  sourced: { owner: "ai", text: "AI contacting broker" },
  scoring: { owner: "ai", text: "AI contacting broker" },
  negotiating: { owner: "ai", text: "AI negotiating rate" },
  rate_confirmed: { owner: "ai", text: "AI dispatching driver" },
  booked: { owner: "ai", text: "AI dispatching driver" },
  dispatched: { owner: "driver", text: "Heading to pickup" },
  at_pickup: { owner: "driver", text: "Loading at pickup" },
  in_transit: { owner: "driver", text: "En route to delivery" },
  at_delivery: { owner: "driver", text: "Unloading at delivery" },
  delivered: { owner: "ai", text: "Invoicing broker" },
};

export type JourneyStepKey = "book" | "pickup" | "deliver" | "paid" | "next";
export type JourneyStepState = "done" | "current" | "upcoming";

/** The full job, start to finish, and who owns each step — the AI books, invoices and lines up the
 *  next load; the driver only has to physically pick up and deliver. */
export const JOURNEY_STEPS: { key: JourneyStepKey; label: string; owner: "ai" | "driver" }[] = [
  { key: "book", label: "Book", owner: "ai" },
  { key: "pickup", label: "Pickup", owner: "driver" },
  { key: "deliver", label: "Deliver", owner: "driver" },
  { key: "paid", label: "Get paid", owner: "ai" },
  { key: "next", label: "Next load", owner: "ai" },
];

/** Where the truck's following load stands — the last journey step runs in parallel with the trip. */
export type NextLoadStatus = "none" | "choose" | "negotiating" | "locked";

export function nextLoadStatus(next: Load | undefined, hasOffers: boolean): NextLoadStatus {
  if (next) return next.stage === "negotiating" ? "negotiating" : "locked";
  return hasOffers ? "choose" : "none";
}

function journeyIndex(stage: LoadStage): number {
  if (stage === "dispatched" || stage === "at_pickup") return 1;
  if (stage === "in_transit" || stage === "at_delivery") return 2;
  if (stage === "delivered") return 3;
  return 0;
}

export function journeyStates(stage: LoadStage, next: NextLoadStatus): { state: JourneyStepState; needsYou: boolean }[] {
  const idx = journeyIndex(stage);
  return JOURNEY_STEPS.map((step, i) => {
    if (step.key === "next") {
      if (next === "locked") return { state: "done", needsYou: false };
      if (next === "choose") return { state: "current", needsYou: true };
      // The AI starts hunting for the follow-on load once the truck is rolling to delivery.
      if (next === "negotiating" || idx >= 2) return { state: "current", needsYou: false };
      return { state: "upcoming", needsYou: false };
    }
    const state: JourneyStepState = i < idx ? "done" : i === idx ? "current" : "upcoming";
    return { state, needsYou: state === "current" && step.owner === "driver" };
  });
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
