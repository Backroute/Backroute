import type { Load } from "../types";

/**
 * The carrier's report card, the thing that gets a carrier on a broker's preferred list: how many loads it ran in the
 * last six months, how many were on time, whether tracking was on, how fast the paperwork came. From the carrier's
 * own loads (the driver's app times against the appointments). Brokers see it in book requests and setup packets once
 * there's enough of a record to be worth saying, and only when it's good.
 */

const DAY = 86400_000;
const LATE_MIN = 30;

interface CarrierRecord {
  loads: number;
  /** Stops with an appointment and an arrival time, and how many were on time. */
  timedStops: number;
  onTimePct: number | null;
  /** Loads the broker asked tracking for, and the share where the driver turned it on. */
  trackingAsked: number;
  trackingPct: number | null;
  /** Median hours from unloading to the invoice with the POD going out. */
  paperworkHours: number | null;
  claims: number;
}

export function carrierRecord(loads: Load[], now = Date.now()): CarrierRecord {
  const done = loads.filter((l) => l.stage === "delivered" && !l.imported && Date.parse(l.updatedAt) > now - 180 * DAY);
  let timed = 0;
  let onTime = 0;
  for (const l of done) {
    const c = l.tripChecklist;
    for (const [due, arrived] of [
      [l.pickupAt, c?.arrivedPickupAt],
      [l.deliveryAt, c?.arrivedDeliveryAt],
    ]) {
      if (!due || !arrived) continue;
      timed++;
      if (Date.parse(arrived) <= Date.parse(due) + LATE_MIN * 60_000) onTime++;
    }
  }
  const tracked = done.filter((l) => l.tracking?.askedAt);
  const paper = done
    .filter((l) => l.tripChecklist?.unloadedAt && l.invoice?.sentAt)
    .map((l) => (Date.parse(l.invoice!.sentAt!) - Date.parse(l.tripChecklist!.unloadedAt!)) / 3600_000)
    .filter((h) => h >= 0)
    .sort((a, b) => a - b);
  return {
    loads: done.length,
    timedStops: timed,
    onTimePct: timed ? Math.round((onTime / timed) * 100) : null,
    trackingAsked: tracked.length,
    trackingPct: tracked.length ? Math.round((tracked.filter((l) => l.tracking?.acceptedAt).length / tracked.length) * 100) : null,
    paperworkHours: paper.length ? Math.round(paper[Math.floor(paper.length / 2)]) : null,
    claims: done.filter((l) => l.claim).length,
  };
}

/** One sentence for a broker, or null when the record is too short or not good enough to brag about. */
export function recordLine(r: CarrierRecord): string | null {
  if (r.loads < 5 || r.timedStops < 5 || r.onTimePct === null || r.onTimePct < 90) return null;
  const bits = [`${r.loads} loads in the last six months, ${r.onTimePct}% on time`];
  if (r.trackingPct !== null && r.trackingAsked >= 3 && r.trackingPct >= 95) bits.push("tracking on every load that asked for it");
  if (r.paperworkHours !== null && r.paperworkHours <= 24) bits.push("paperwork the same day");
  if (r.claims === 0) bits.push("no claims");
  return `Our record: ${bits.join(", ")}.`;
}
