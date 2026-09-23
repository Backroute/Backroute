import { formatEta, legMiles, legProgress } from "./trip-geo";
import type { Load, LoadDocument, LoadStage } from "./types";

export const BOOKING_STAGES: LoadStage[] = ["sourced", "scoring", "negotiating", "rate_confirmed", "booked"];

export type TripCard = "booking" | "pickup" | "delivery";

/** Stages where the truck hasn't rolled with freight yet — the window where the day's pre-trip DVIR is still due. */
export const PRE_TRIP_STAGES: LoadStage[] = ["rate_confirmed", "booked", "dispatched", "at_pickup"];

/** The one thing that has to happen next on a trip, and who does it. `action` is what the driver taps. */
export type NextAction = "pretrip" | "arrive" | "loaded" | "upload_bol" | "start" | "unloaded" | "upload_pod" | "complete" | null;

export interface TripState {
  card: TripCard;
  arrived: boolean;
  /** 0–1 along the current drive (pickup or delivery). */
  legP: number;
  milesLeft: number;
  /** "8 min · 7 mi", "Arriving now" or "Arrived". */
  drive: string;
  /** Loaded at pickup / unloaded at delivery. */
  handled: boolean;
  doc?: LoadDocument;
  docDone: boolean;
  /** Completed steps (drive counts fractionally) out of `total`, for the completion bar. */
  done: number;
  total: number;
  ready: boolean;
  next: { title: string; owner: "driver" | "ai"; action: NextAction };
}

const BOOKING_PROGRESS: Partial<Record<LoadStage, number>> = { sourced: 0.2, scoring: 0.3, negotiating: 0.5, rate_confirmed: 0.75, booked: 0.9 };

const BOOKING_NEXT: Partial<Record<LoadStage, string>> = {
  sourced: "Reaching out to the broker",
  scoring: "Reaching out to the broker",
  negotiating: "Negotiating the rate",
  rate_confirmed: "Signing the rate confirmation",
  booked: "Dispatching the driver",
};

export function tripCardFor(stage: LoadStage): TripCard {
  if (BOOKING_STAGES.includes(stage)) return "booking";
  return stage === "dispatched" || stage === "at_pickup" ? "pickup" : "delivery";
}

/** Everything the trip cards need to know about where a load is, derived in one place so the compact card,
 *  the full card and the carrier's view never disagree about what's done or what's next. */
export function tripState(load: Load, now: number | null, needsPreTrip: boolean): TripState {
  const card = tripCardFor(load.stage);

  if (card === "booking") {
    return {
      card, arrived: false, legP: 0, milesLeft: 0, drive: "", handled: false, docDone: false,
      done: BOOKING_PROGRESS[load.stage] ?? 0.2, total: 1, ready: false,
      next: { title: load.liveCall ? "On the phone with the broker" : BOOKING_NEXT[load.stage] ?? "Booking the load", owner: "ai", action: null },
    };
  }

  const pickup = card === "pickup";
  const arrived = load.stage === (pickup ? "at_pickup" : "at_delivery");
  const legP = legProgress(load, now);
  const milesLeft = Math.max(0, Math.round(legMiles(load, card) * (1 - legP)));
  const drive = arrived ? "Arrived" : legP >= 0.98 ? "Arriving now" : `${formatEta(milesLeft)} · ${milesLeft} mi`;
  const handled = !!(pickup ? load.tripChecklist?.loadedAt : load.tripChecklist?.unloadedAt);
  const doc = load.documents.find((d) => d.type === (pickup ? "bol" : "pod"));
  const docDone = doc?.status === "verified";
  const preTrip = pickup && needsPreTrip;
  const total = preTrip ? 4 : 3;
  const done = (arrived ? 1 : legP * 0.9) + Number(handled) + Number(docDone);
  const ready = arrived && handled && docDone && !preTrip;
  const docName = pickup ? "BOL" : "POD";

  let next: TripState["next"];
  if (preTrip && !arrived) next = { title: "Do your pre-trip inspection", owner: "driver", action: "pretrip" };
  else if (!arrived) next = { title: pickup ? "Drive to the shipper" : "Drive to the receiver", owner: "driver", action: "arrive" };
  else if (!handled) next = { title: pickup ? "Get loaded" : "Get unloaded", owner: "driver", action: pickup ? "loaded" : "unloaded" };
  else if (!docDone) {
    next = doc
      ? { title: `Checking the ${docName}`, owner: "ai", action: null }
      : { title: `Upload the signed ${docName}`, owner: "driver", action: pickup ? "upload_bol" : "upload_pod" };
  } else if (preTrip) next = { title: "Do your pre-trip inspection", owner: "driver", action: "pretrip" };
  else next = { title: pickup ? "Start the trip" : "Complete the delivery", owner: "driver", action: pickup ? "start" : "complete" };

  return { card, arrived, legP, milesLeft, drive, handled, doc, docDone, done, total, ready, next };
}
