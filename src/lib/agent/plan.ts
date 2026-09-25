import "server-only";
import { homeTimeStatus } from "../home";
import { formatAtStop } from "../stop-time";
import type { Item } from "../cloud/rows";
import type { Load, Truck } from "../types";
import { save, type CarrierContext } from "./db";

/**
 * The plan a dispatcher keeps in their head for each truck, written down: what it's on, what's lined up next (or
 * where the AI is looking), and whether the driver still makes it home on time. Shown on the Fleet page.
 */

const ROLLING = new Set<Load["stage"]>(["dispatched", "at_pickup", "in_transit", "at_delivery"]);
const at = (iso: string | undefined, state: string, fallback: string) => (iso ? formatAtStop(iso, state) : fallback);

export function planFor(ctx: Pick<CarrierContext, "loads" | "drivers">, truck: Truck, now: number): string[] {
  const lines: string[] = [];
  const current = ctx.loads.find((l) => l.id === truck.currentLoadId && ROLLING.has(l.stage));
  const next = ctx.loads.find((l) => l.id === truck.nextLoadId && !["cancelled", "declined", "delivered"].includes(l.stage));
  const chasing = ctx.loads.find((l) => l.truckId === truck.id && l.stage === "negotiating");
  const offered = ctx.loads.filter((l) => l.truckId === truck.id && l.stage === "offered").length;
  if (truck.status === "maintenance") lines.push("In the shop.");
  if (current) lines.push(`Now: ${current.referenceNumber} to ${current.lane.destination}, ${current.lane.destState}, delivering ${at(current.deliveryAt, current.lane.destState, current.deliveryWindow)}.`);
  else if (truck.status !== "maintenance") lines.push(`Empty in ${truck.currentCity}, ${truck.currentState}.`);
  if (next) lines.push(`Next: ${next.referenceNumber}, ${next.lane.origin} → ${next.lane.destination}, ${next.stage === "negotiating" ? "waiting on the broker" : `picks up ${at(next.pickupAt, next.lane.originState, next.pickupWindow)}`}.`);
  else if (chasing) lines.push(`Next: asking ${chasing.lane.origin} → ${chasing.lane.destination} at $${(chasing.bookRequest?.ask ?? chasing.targetRate).toLocaleString()}, waiting on the broker.`);
  else if (truck.status !== "maintenance") {
    const from = current ? `${current.lane.destination}, ${current.lane.destState}` : `${truck.currentCity}, ${truck.currentState}`;
    lines.push(`Next: nothing booked yet. The AI is looking near ${from}${offered ? ` (${offered} offer${offered === 1 ? "" : "s"} in hand)` : ""}.`);
  }
  const driver = ctx.drivers.find((d) => d.id === truck.driverId);
  if (driver?.homeBase) {
    const lastLoad = next ?? current;
    const empty = lastLoad ? { city: lastLoad.lane.destination, state: lastLoad.lane.destState, when: Date.parse(lastLoad.deliveryAt ?? "") || now } : { city: truck.currentCity, state: truck.currentState, when: now };
    const home = homeTimeStatus(driver, empty.city, empty.state, new Date(Math.max(now, empty.when)));
    const first = driver.name.split(" ")[0];
    const words: Record<string, string> = {
      home: `${first} is home or close to it.`,
      on_track: `${first}: ${home.target ?? "home time"}, on track.`,
      head_home: `${first}: ${home.target ?? "home time"}. The next load has to head home.`,
      late: `${first} can't make ${home.target ?? "home time"} from there. The AI is looking for loads toward ${home.homeCity}.`,
    };
    if (driver.homePriority && home.state !== "home") lines.push(`Getting ${first} home to ${home.homeCity} first, as you asked.`);
    else if (words[home.state]) lines.push(words[home.state]);
  }
  return lines;
}

/** Refreshes every truck's plan; saves only the ones that changed. */
export async function refreshPlans(ctx: CarrierContext, now: number) {
  for (const truck of ctx.trucks) {
    const lines = planFor(ctx, truck, now);
    if (JSON.stringify(lines) === JSON.stringify(truck.plan?.lines)) continue;
    const next = { ...truck, plan: { lines, at: new Date(now).toISOString() } };
    await save("trucks", ctx.carrier.id, next as unknown as Item);
    ctx.trucks = ctx.trucks.map((t) => (t.id === truck.id ? next : t));
  }
}
