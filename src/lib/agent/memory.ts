import type { Broker, Load } from "../types";

/**
 * What a dispatcher remembers: what this carrier got on a lane before, and how a broker has dealt with it. Worked out
 * from the carrier's own loads, so it's never more than what actually happened.
 */

const WORKED = new Set<Load["stage"]>(["rate_confirmed", "booked", "dispatched", "at_pickup", "in_transit", "at_delivery", "delivered"]);
const DAY = 86400_000;

/** A load the carrier actually hauled (or has booked), with the rate it got. */
const worked = (l: Load) => WORKED.has(l.stage) && (l.bookedRate ?? 0) > 0 && l.lane.miles > 0;

export interface LaneMemory {
  /** Loads booked on this lane (state to state) in the last 120 days. */
  count: number;
  /** Their average rate per mile. */
  avgRpm: number | null;
  last: { rate: number; rpm: number; at: string; broker?: string } | null;
}

export function laneMemory(loads: Load[], brokers: Broker[], lane: { originState: string; destState: string }, now = Date.now()): LaneMemory {
  const same = loads
    .filter((l) => worked(l) && l.lane.originState === lane.originState && l.lane.destState === lane.destState && Date.parse(l.updatedAt) > now - 120 * DAY)
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  if (!same.length) return { count: 0, avgRpm: null, last: null };
  const rpms = same.map((l) => l.bookedRate! / l.lane.miles);
  const l = same[0];
  return {
    count: same.length,
    avgRpm: Math.round((rpms.reduce((a, b) => a + b, 0) / rpms.length) * 100) / 100,
    last: { rate: l.bookedRate!, rpm: Math.round(rpms[0] * 100) / 100, at: l.updatedAt, broker: brokers.find((b) => b.id === l.brokerId)?.company },
  };
}

export interface BrokerMemory {
  booked: number;
  /** Of our asks they answered: how often they took our number as it was. */
  tookOurAsk: number;
  countered: number;
  cancelled: number;
  avgRpm: number | null;
  lanes: string[];
}

export function brokerMemory(loads: Load[], brokerId: string): BrokerMemory {
  const theirs = loads.filter((l) => l.brokerId === brokerId);
  const booked = theirs.filter(worked);
  const rpms = booked.map((l) => l.bookedRate! / l.lane.miles);
  const answered = theirs.filter((l) => l.bookRequest && (l.bookRequest.status === "accepted" || l.bookRequest.brokerOffer));
  const lanes = [...new Set(booked.map((l) => `${l.lane.originState}→${l.lane.destState}`))].slice(0, 5);
  return {
    booked: booked.length,
    tookOurAsk: answered.filter((l) => l.bookRequest!.status === "accepted" && !l.bookRequest!.countered && (l.bookRequest!.brokerOffer ?? l.bookRequest!.ask) >= l.bookRequest!.ask).length,
    countered: answered.filter((l) => l.bookRequest!.countered || (l.bookRequest!.brokerOffer ?? Infinity) < l.bookRequest!.ask).length,
    cancelled: theirs.filter((l) => l.stage === "cancelled").length,
    avgRpm: rpms.length ? Math.round((rpms.reduce((a, b) => a + b, 0) / rpms.length) * 100) / 100 : null,
    lanes,
  };
}

/** One or two plain sentences for the AI's instructions on a call or a reply. Empty when there's no history. */
export function memoryNote(loads: Load[], brokers: Broker[], load: Load): string {
  const out: string[] = [];
  const b = load.brokerId ? brokerMemory(loads, load.brokerId) : null;
  if (b && (b.booked || b.countered || b.cancelled))
    out.push(
      `History with this broker: ${b.booked} load${b.booked === 1 ? "" : "s"} hauled${b.avgRpm ? ` at about $${b.avgRpm.toFixed(2)} a mile` : ""}${b.lanes.length ? ` (${b.lanes.join(", ")})` : ""}; they took our first number ${b.tookOurAsk} time${b.tookOurAsk === 1 ? "" : "s"} and pushed back ${b.countered}${b.cancelled ? `; cancelled on us ${b.cancelled} time${b.cancelled === 1 ? "" : "s"}` : ""}.`,
    );
  const lane = laneMemory(loads.filter((l) => l.id !== load.id), brokers, { originState: load.lane.originState, destState: load.lane.destState });
  if (lane.count) out.push(`On ${load.lane.originState}→${load.lane.destState} the carrier has hauled ${lane.count} load${lane.count === 1 ? "" : "s"} lately, about $${lane.avgRpm!.toFixed(2)} a mile (last: $${lane.last!.rate.toLocaleString()}).`);
  return out.join(" ");
}
