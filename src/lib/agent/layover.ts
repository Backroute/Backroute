import "server-only";
import type { Item } from "../cloud/rows";
import { formatAtStop } from "../stop-time";
import type { LayoverClaim, Load, RateConPdfReading } from "../types";
import { claimMark, releaseMark, save, type CarrierContext } from "./db";
import { passToOwner } from "./dispatcher";
import { sendOrQueue } from "./outbox";
import * as mail from "./templates";

/**
 * Layover: a truck that got to a stop on time and is held there overnight (the load isn't ready, the dock pushed it
 * to tomorrow) is owed a day's pay for each day, on top of the rate, the way a dispatcher claims it the morning after.
 * Claimed while it's happening, so the broker hears before the truck leaves. A stop with a layover gets no hourly
 * detention for the same wait. A truck that got there late isn't owed anything.
 */

const DAY = 24 * 3600_000;
export const DEFAULT_LAYOVER = 250;

/** "Layover $300/day" or "$250 layover" on the rate con, or null. */
export function layoverTerms(r: RateConPdfReading | undefined): number | null {
  if (!r) return null;
  const text = [r.detention ?? "", ...r.finesAndFees, ...r.otherConcerns, r.summary].join("\n");
  const m = text.match(/layover[^$\n]{0,40}\$\s?(\d{2,4})/i) ?? text.match(/\$\s?(\d{2,4})[^.\n$]{0,30}layover/i);
  return m ? Number(m[1]) : null;
}

/** Whole days a truck has been held at each stop it reached on time (still there, or since left). */
export function heldDays(load: Load, now: number): { stop: "pickup" | "delivery"; arrived: string; days: number; left?: string }[] {
  const c = load.tripChecklist;
  const out: { stop: "pickup" | "delivery"; arrived: string; days: number; left?: string }[] = [];
  const at = (stop: "pickup" | "delivery", arrived?: string, left?: string, due?: string) => {
    if (!arrived) return;
    const a = Date.parse(arrived);
    // Late for the appointment: the wait is the carrier's.
    if (due && a > Date.parse(due) + 30 * 60_000) return;
    const from = Math.max(a, due ? Date.parse(due) : a);
    const days = Math.floor(((left ? Date.parse(left) : now) - from) / DAY);
    if (days >= 1) out.push({ stop, arrived, days, left });
  };
  at("pickup", c?.arrivedPickupAt, c?.loadedAt, load.pickupAt);
  at("delivery", c?.arrivedDeliveryAt, c?.unloadedAt, load.deliveryAt);
  return out;
}

export async function sendLayoverClaims(ctx: CarrierContext, now: number): Promise<string[]> {
  const done: string[] = [];
  for (const load of ctx.loads) {
    if (!["at_pickup", "in_transit", "at_delivery", "delivered"].includes(load.stage) || load.imported || Date.parse(load.updatedAt) < now - 7 * DAY) continue;
    const terms = layoverTerms(load.rateConReading);
    const perDay = terms ?? ctx.settings.layoverPay ?? DEFAULT_LAYOVER;
    for (const h of heldDays(load, now)) {
      const current = ctx.loads.find((l) => l.id === load.id) ?? load;
      const had = current.layoverClaims?.find((c) => c.stop === h.stop);
      if (had && had.days >= h.days) continue;
      const mark = `layover_${h.stop}_${h.days}`;
      if (!(await claimMark(ctx.carrier.id, load.id, mark))) continue;
      try {
        const amount = h.days * perDay;
        const claim: LayoverClaim = { stop: h.stop, days: h.days, amount, draftedAt: new Date(now).toISOString() };
        const next: Load = { ...current, layoverClaims: [...(current.layoverClaims ?? []).filter((c) => c.stop !== h.stop), claim], updatedAt: new Date(now).toISOString() };
        await save("loads", ctx.carrier.id, next as unknown as Item);
        ctx.loads = ctx.loads.map((l) => (l.id === load.id ? next : l));
        const broker = ctx.brokers.find((b) => b.id === load.brokerId);
        const to = load.brokerContactEmail ?? broker?.email;
        const state = h.stop === "pickup" ? load.lane.originState : load.lane.destState;
        const place = h.stop === "pickup" ? `${load.lane.origin}, ${load.lane.originState}` : `${load.lane.destination}, ${load.lane.destState}`;
        if (!to) {
          await passToOwner(ctx, { reason: `${load.referenceNumber}: the truck has been held ${h.days} day${h.days === 1 ? "" : "s"} at ${h.stop}, $${amount} in layover, but there's no broker email to claim it.`, loadId: load.id, label: "I'll claim it", source: "email" });
          continue;
        }
        const body = `Hi${broker?.contact ? ` ${broker.contact}` : ""},

Our truck on ${load.referenceNumber} is being held at ${h.stop} in ${place}. It arrived ${formatAtStop(h.arrived, state)}, on time for the appointment, and ${h.left ? `didn't get out until ${formatAtStop(h.left, state)}` : "still hasn't been " + (h.stop === "pickup" ? "loaded" : "unloaded")}.

That's ${h.days} day${h.days === 1 ? "" : "s"} of layover at ${`$${perDay}`}/day: $${amount.toLocaleString("en-US")}${had ? ` in total (this replaces our claim for ${had.days} day${had.days === 1 ? "" : "s"})` : ""}. Please add it to the rate confirmation.

Thanks,
${ctx.carrier.name}`;
        const result = await sendOrQueue(ctx, {
          purpose: "layover",
          to,
          toName: broker?.contact || undefined,
          subject: mail.subjectFor(load, "Layover"),
          body,
          loadId: load.id,
          amount,
          // Without the broker's own layover terms, the day rate is the owner's setting: they check it first.
          withinRules: terms !== null,
          rule: "detention_default",
          why: `${load.referenceNumber} has been held ${h.days} day${h.days === 1 ? "" : "s"} at ${h.stop}. Claim $${amount} in layover${terms ? "" : ` (at $${perDay}/day: the rate con didn't say, so check it)`}?`,
        });
        done.push(`${load.referenceNumber}: layover at ${h.stop} ${result}`);
      } catch (error) {
        console.error("[layover] claim failed", load.id, error);
        await releaseMark(ctx.carrier.id, load.id, mark);
      }
    }
  }
  return done;
}
