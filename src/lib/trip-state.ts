import { formatEta, legMiles, legProgressInfo } from "./trip-geo";
import type { Load, LoadDocument, LoadStage } from "./types";

export const BOOKING_STAGES: LoadStage[] = ["sourced", "scoring", "negotiating", "rate_confirmed", "booked"];

export type TripCard = "booking" | "pickup" | "delivery";

/** Stages where the truck hasn't rolled with freight yet — the window where the day's pre-trip DVIR is still due. */
export const PRE_TRIP_STAGES: LoadStage[] = ["rate_confirmed", "booked", "dispatched", "at_pickup"];

/** The one thing that has to happen next on a trip, and who does it. `action` is what the driver taps. */
export type NextAction = "pretrip" | "arrive" | "loaded" | "upload_bol" | "start" | "unloaded" | "upload_pod" | "complete" | null;

/** Which next step this is, so the driver app can say it in the driver's language (`title` is the English). */
export type NextKey =
  | "liveCall" | "rcChecking" | "rcFixing" | "rcOwner" | "reaching" | "negotiating" | "signing" | "dispatching" | "booking"
  | "pretrip" | "toShipper" | "toReceiver" | "getLoaded" | "getUnloaded" | "checkBol" | "checkPod" | "uploadBol" | "uploadPod" | "start" | "complete";

export interface TripState {
  card: TripCard;
  arrived: boolean;
  /** 0–1 along the current drive (pickup or delivery). */
  legP: number;
  /** The progress comes from where the truck is (ELD), or the demo's drive; false: a real truck with no fresh position. */
  located: boolean;
  milesLeft: number;
  /** "8 min · 7 mi", "Arriving now" or "Arrived". */
  drive: string;
  /** Set when `drive` is a word rather than a time and distance, so it can be translated. */
  driveKey?: "arrived" | "noGps" | "arriving";
  /** Loaded at pickup / unloaded at delivery. */
  handled: boolean;
  doc?: LoadDocument;
  docDone: boolean;
  /** Completed steps (drive counts fractionally) out of `total`, for the completion bar. */
  done: number;
  total: number;
  ready: boolean;
  next: { title: string; owner: "driver" | "ai"; action: NextAction; key: NextKey };
}

const BOOKING_PROGRESS: Partial<Record<LoadStage, number>> = { sourced: 0.2, scoring: 0.3, negotiating: 0.5, rate_confirmed: 0.75, booked: 0.9 };

const BOOKING_KEY: Partial<Record<LoadStage, NextKey>> = { sourced: "reaching", scoring: "reaching", negotiating: "negotiating", rate_confirmed: "signing", booked: "dispatching" };

const BOOKING_NEXT: Partial<Record<LoadStage, string>> = {
  sourced: "Reaching out to the broker",
  scoring: "Reaching out to the broker",
  negotiating: "Negotiating the rate",
  rate_confirmed: "Signing the rate confirmation",
  booked: "Dispatching the driver",
};

/** Where the rate con check is, when that's what the load is waiting on. */
function rateConStep(load: Load): { title: string; key: NextKey } | undefined {
  if (load.stage !== "rate_confirmed" || !load.rateCon) return undefined;
  return {
    checking: { title: "Checking the rate con", key: "rcChecking" as const },
    fixing: { title: "Getting the broker to fix the rate con", key: "rcFixing" as const },
    needs_you: { title: "Rate con needs the owner's OK", key: "rcOwner" as const },
    signed: undefined,
    walked: undefined,
  }[load.rateCon.status];
}

function tripCardFor(stage: LoadStage): TripCard {
  if (BOOKING_STAGES.includes(stage)) return "booking";
  return stage === "dispatched" || stage === "at_pickup" ? "pickup" : "delivery";
}

/** Everything the trip cards need to know about where a load is, derived in one place so the compact card,
 *  the full card and the carrier's view never disagree about what's done or what's next. */
export function tripState(load: Load, now: number | null, needsPreTrip: boolean): TripState {
  const card = tripCardFor(load.stage);

  if (card === "booking") {
    return {
      card, arrived: false, legP: 0, located: false, milesLeft: 0, drive: "", handled: false, docDone: false,
      done: BOOKING_PROGRESS[load.stage] ?? 0.2, total: 1, ready: false,
      next: load.liveCall
        ? { title: "On the phone with the broker", owner: "ai", action: null, key: "liveCall" }
        : { ...(rateConStep(load) ?? { title: BOOKING_NEXT[load.stage] ?? "Booking the load", key: BOOKING_KEY[load.stage] ?? "booking" }), owner: "ai", action: null },
    };
  }

  const pickup = card === "pickup";
  const arrived = load.stage === (pickup ? "at_pickup" : "at_delivery");
  const { p: legP, located } = legProgressInfo(load, now);
  const milesLeft = Math.max(0, Math.round(legMiles(load, card) * (1 - legP)));
  const driveKey = arrived ? "arrived" : !located ? "noGps" : legP >= 0.98 ? "arriving" : undefined;
  const drive = arrived ? "Arrived" : !located ? "No GPS yet" : legP >= 0.98 ? "Arriving now" : `${formatEta(milesLeft)} · ${milesLeft} mi`;
  const handled = !!(pickup ? load.tripChecklist?.loadedAt : load.tripChecklist?.unloadedAt);
  const doc = load.documents.find((d) => d.type === (pickup ? "bol" : "pod"));
  const docDone = doc?.status === "verified";
  const preTrip = pickup && needsPreTrip;
  const total = preTrip ? 4 : 3;
  const done = (arrived ? 1 : legP * 0.9) + Number(handled) + Number(docDone);
  const ready = arrived && handled && docDone && !preTrip;
  const docName = pickup ? "BOL" : "POD";

  let next: TripState["next"];
  if (preTrip && !arrived) next = { title: "Do your pre-trip inspection", owner: "driver", action: "pretrip", key: "pretrip" };
  else if (!arrived) next = { title: pickup ? "Drive to the shipper" : "Drive to the receiver", owner: "driver", action: "arrive", key: pickup ? "toShipper" : "toReceiver" };
  else if (!handled) next = { title: pickup ? "Get loaded" : "Get unloaded", owner: "driver", action: pickup ? "loaded" : "unloaded", key: pickup ? "getLoaded" : "getUnloaded" };
  else if (!docDone) {
    next = doc
      ? { title: `Checking the ${docName}`, owner: "ai", action: null, key: pickup ? "checkBol" : "checkPod" }
      : { title: `Upload the signed ${docName}`, owner: "driver", action: pickup ? "upload_bol" : "upload_pod", key: pickup ? "uploadBol" : "uploadPod" };
  } else if (preTrip) next = { title: "Do your pre-trip inspection", owner: "driver", action: "pretrip", key: "pretrip" };
  else next = { title: pickup ? "Start the trip" : "Complete the delivery", owner: "driver", action: pickup ? "start" : "complete", key: pickup ? "start" : "complete" };

  return { card, arrived, legP, located, milesLeft, drive, driveKey, handled, doc, docDone, done, total, ready, next };
}
