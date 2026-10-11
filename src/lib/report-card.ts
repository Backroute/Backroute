import type { Escalation, Load } from "./types";

/**
 * How the AI did as the carrier's dispatcher over a stretch of time, measured the way an owner judges a human one:
 * what it booked and for how much against the market, what extra money it got paid, how fast the invoices went out
 * and came back, how long trucks sat empty, and how often it had to ask. Only from the carrier's own records; a
 * number with nothing behind it is null, not zero.
 */
export interface ReportCard {
  days: number;
  delivered: number;
  bookedByAi: number;
  bookedByOwner: number;
  revenue: number;
  /** Dollars a loaded mile, and against the rate data where the load had a market number. */
  rpm: number | null;
  vsMarket: { cents: number; loads: number } | null;
  /** Detention, layover and TONU billed. */
  extras: { amount: number; claims: number };
  /** Invoices sent within a day of delivery, of those sent. */
  invoicedSameDay: { share: number; of: number } | null;
  daysToPaid: number | null;
  onTime: { share: number; of: number } | null;
  /** Hours a truck sat empty between one delivery and the next pickup. */
  emptyHours: number | null;
  askedOwner: number;
  /** The carrier's own history from before (imported loads): what a mile paid then, to compare. */
  before: { rpm: number; loads: number } | null;
  /** Of the things Backroute asked the owner to OK (a message, a move), how many they said yes to. */
  approvals: { yes: number; of: number } | null;
  /** Revenue by truck over the period: the best and the least, to see that no driver is left with the scraps. */
  spread: { top: number; bottom: number; trucks: number } | null;
}

const DAY = 86400_000;
const BOOKED = new Set(["rate_confirmed", "booked", "dispatched", "at_pickup", "in_transit", "at_delivery", "delivered"]);
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const deliveredAt = (l: Load) => l.tripChecklist?.unloadedAt ?? (l.stage === "delivered" ? l.updatedAt : undefined);

export function reportCard(loads: Load[], escalations: Escalation[], now: number, days = 30): ReportCard {
  const since = now - days * DAY;
  const real = loads.filter((l) => !l.imported);
  const inPeriod = real.filter((l) => BOOKED.has(l.stage) && Date.parse(l.pickupAt ?? l.createdAt) >= since && Date.parse(l.pickupAt ?? l.createdAt) <= now);
  const delivered = real.filter((l) => l.stage === "delivered" && deliveredAt(l) && Date.parse(deliveredAt(l)!) >= since);
  const byOwner = (l: Load) => l.pickedBy === "carrier" || l.pickedBy === "driver" || !!l.bookRequest?.byOwner;
  const revenue = delivered.reduce((s, l) => s + (l.invoice?.amount ?? l.bookedRate ?? 0), 0);
  const miles = delivered.reduce((s, l) => s + l.lane.miles, 0);
  const marketed = delivered.filter((l) => l.market?.rpm && l.bookedRate && l.lane.miles);
  const extrasList = [
    ...delivered.flatMap((l) => (l.detentionClaims ?? []).filter((d) => d.sentAt).map((d) => d.amount)),
    ...delivered.flatMap((l) => (l.layoverClaims ?? []).filter((d) => d.sentAt).map((d) => d.amount)),
    ...real.filter((l) => l.stage === "cancelled" && l.tonuClaimedAt && Date.parse(l.tonuClaimedAt) >= since).map((l) => l.tonuFee ?? 0),
  ].filter((x) => x > 0);
  const sent = delivered.filter((l) => l.invoice?.sentAt);
  const sameDay = sent.filter((l) => Date.parse(l.invoice!.sentAt!) - Date.parse(deliveredAt(l)!) <= DAY);
  const paid = sent.filter((l) => l.invoice?.paidAt).map((l) => (Date.parse(l.invoice!.paidAt!) - Date.parse(l.invoice!.sentAt!)) / DAY);
  // On time: delivered with no late notice on the delivery, of those that had an appointment.
  const timed = delivered.filter((l) => l.deliveryAt);
  const onTime = timed.filter((l) => !(l.late?.stop === "delivery") && (!l.tripChecklist?.arrivedDeliveryAt || Date.parse(l.tripChecklist.arrivedDeliveryAt) <= Date.parse(l.deliveryAt!) + 30 * 60_000));
  // Empty time: per truck, from one load's delivery to the next one's pickup, in order.
  const gaps: number[] = [];
  const byTruck = new Map<string, Load[]>();
  for (const l of real.filter((x) => x.truckId && BOOKED.has(x.stage))) byTruck.set(l.truckId!, [...(byTruck.get(l.truckId!) ?? []), l]);
  for (const list of byTruck.values()) {
    const sorted = list.filter((l) => l.pickupAt).sort((a, b) => Date.parse(a.pickupAt!) - Date.parse(b.pickupAt!));
    for (let i = 1; i < sorted.length; i++) {
      const end = deliveredAt(sorted[i - 1]) ?? sorted[i - 1].deliveryAt;
      const start = sorted[i].tripChecklist?.arrivedPickupAt ?? sorted[i].pickupAt;
      if (!end || !start || Date.parse(start) < since) continue;
      const h = (Date.parse(start) - Date.parse(end)) / 3600_000;
      if (h >= 0 && h < 24 * 14) gaps.push(h);
    }
  }
  const asked = escalations.filter((e) => e.status !== "with_support" && Date.parse(e.createdAt) >= since && Date.parse(e.createdAt) <= now).length;
  const past = loads.filter((l) => l.imported && (l.bookedRate ?? 0) > 0 && l.lane.miles > 0);
  const pastMiles = past.reduce((s, l) => s + l.lane.miles, 0);
  const cents = avg(marketed.map((l) => (l.bookedRate! / l.lane.miles - l.market!.rpm) * 100));
  // The owner's answers to what Backroute asked them to OK: a yes means it judged right.
  const answered = escalations.filter((e) => e.resolvedBy === "carrier" && typeof e.approved === "boolean" && Date.parse(e.resolvedAt ?? e.createdAt) >= since && Date.parse(e.resolvedAt ?? e.createdAt) <= now);
  // Revenue per truck, for trucks that ran at least one load.
  const perTruck = new Map<string, number>();
  for (const l of delivered) if (l.truckId) perTruck.set(l.truckId, (perTruck.get(l.truckId) ?? 0) + (l.invoice?.amount ?? l.bookedRate ?? 0));
  const truckRevenue = [...perTruck.values()].sort((a, b) => b - a);
  return {
    days,
    delivered: delivered.length,
    bookedByAi: inPeriod.filter((l) => !byOwner(l)).length,
    bookedByOwner: inPeriod.filter(byOwner).length,
    revenue: Math.round(revenue),
    rpm: miles ? Math.round((revenue / miles) * 100) / 100 : null,
    vsMarket: cents === null ? null : { cents: Math.round(cents), loads: marketed.length },
    extras: { amount: Math.round(extrasList.reduce((a, b) => a + b, 0)), claims: extrasList.length },
    invoicedSameDay: sent.length ? { share: sameDay.length / sent.length, of: sent.length } : null,
    daysToPaid: paid.length ? Math.round(avg(paid)! * 10) / 10 : null,
    onTime: timed.length ? { share: onTime.length / timed.length, of: timed.length } : null,
    emptyHours: gaps.length ? Math.round(avg(gaps)! * 10) / 10 : null,
    askedOwner: asked,
    before: past.length >= 5 ? { rpm: Math.round((past.reduce((s, l) => s + (l.bookedRate ?? 0), 0) / pastMiles) * 100) / 100, loads: past.length } : null,
    approvals: answered.length ? { yes: answered.filter((e) => e.approved).length, of: answered.length } : null,
    spread: truckRevenue.length >= 2 ? { top: Math.round(truckRevenue[0]), bottom: Math.round(truckRevenue.at(-1)!), trucks: truckRevenue.length } : null,
  };
}

/** One thing full autopilot should have earned first, and whether it has. */
export interface ReadyCheck {
  label: string;
  met: boolean;
  /** Where it stands now, in a few words. */
  now: string;
}

/**
 * Before the owner hands over everything: what Backroute has to have shown on "Within my rules" first, the way you'd
 * watch a new dispatcher for a few weeks. Enough loads booked by itself, the owner agreeing with what it asked,
 * deliveries on time, and rates at or over the market where that's known. It's advice, not a lock: the owner decides.
 */
export function fullModeReady(r: ReportCard): { ready: boolean; checks: ReadyCheck[] } {
  const checks: ReadyCheck[] = [
    { label: "10 loads booked by Backroute and delivered", met: r.bookedByAi >= 10 && r.delivered >= 10, now: `${Math.min(r.bookedByAi, r.delivered)} so far` },
    {
      label: "You said yes to 9 in 10 of its asks",
      met: !!r.approvals && r.approvals.of >= 10 && r.approvals.yes / r.approvals.of >= 0.9,
      now: r.approvals ? `${r.approvals.yes} of ${r.approvals.of}` : "nothing asked yet",
    },
    { label: "9 in 10 deliveries on time", met: !!r.onTime && r.onTime.of >= 5 && r.onTime.share >= 0.9, now: r.onTime ? `${Math.round(r.onTime.share * 100)}% of ${r.onTime.of}` : "no appointments yet" },
    { label: "At or over the market rate", met: !r.vsMarket || r.vsMarket.cents >= 0, now: r.vsMarket ? `${r.vsMarket.cents >= 0 ? "+" : ""}${r.vsMarket.cents}¢ a mile` : "no market data (not counted)" },
  ];
  return { ready: checks.every((c) => c.met), checks };
}
