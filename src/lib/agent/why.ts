import "server-only";
import { homeTimeStatus } from "../home";
import type { Load } from "../types";
import type { CarrierContext } from "./db";
import { floorFor } from "./pricing";

/**
 * Why the AI went for a load, in the owner's words: what it pays against their lowest and the market, the empty miles
 * to get there, what it does for the driver's home time, how the broker pays, and what else was on the table. Shown
 * on the load and on anything waiting for the owner's OK, so a yes (or a no) takes a glance, not a phone call.
 */

const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const perMile = (n: number) => `$${n.toFixed(2)}/mi`;

export function whyBook(ctx: Pick<CarrierContext, "trucks" | "drivers" | "brokers" | "loads" | "settings">, load: Load, ask: number, now = new Date()): string[] {
  const lines: string[] = [];
  const miles = load.lane.miles || 0;
  const floor = floorFor(load, ctx.settings);
  // Money: against the owner's lowest, and what the lane pays now.
  if (miles) {
    const parts = [`${money(ask)} is ${perMile(ask / miles)}`];
    if (floor !== null && ctx.settings.minRpm) parts.push(ask >= floor ? `above your ${perMile(ctx.settings.minRpm)} lowest` : `under your ${perMile(ctx.settings.minRpm)} lowest`);
    if (load.market?.rpm) parts.push(`the market pays about ${perMile(load.market.rpm)} (${load.market.source})`);
    lines.push(`${parts.join("; ")}.`);
  }
  if (load.surchargePct) lines.push(`Asked ${load.surchargePct}% more because this broker is slow to pay.`);
  // Empty miles to get there.
  const truck = ctx.trucks.find((t) => t.id === load.truckId);
  if (truck) lines.push(`${Math.round(load.deadheadMiles)} empty miles to the pickup for truck ${truck.unitNumber}${truck.currentCity ? ` from ${truck.currentCity}, ${truck.currentState}` : ""}.`);
  // Home time.
  const driver = ctx.drivers.find((d) => d.id === truck?.driverId);
  if (driver?.homeBase) {
    const at = new Date(Math.max(now.getTime(), Date.parse(load.deliveryAt ?? load.pickupAt ?? "") || 0));
    const after = homeTimeStatus(driver, load.lane.destination, load.lane.destState, at);
    const first = driver.name.split(" ")[0];
    if (after.state === "home") lines.push(`Ends at ${first}'s home.`);
    else if (after.hoursHome !== null && after.state !== "no_target")
      lines.push(after.state === "late" ? `Heads-up: ${first} would miss their home time (${after.target ?? "their target"}).` : `Ends ${Math.round(after.hoursHome)} hours' drive from ${first}'s home, still on track to be ${after.target?.replace(/^Home /, "home ") ?? "home on time"}.`);
  }
  // How the broker pays.
  const broker = ctx.brokers.find((b) => b.id === load.brokerId);
  if (broker) {
    const days = broker.credit?.daysToPay ?? null;
    const own = ctx.loads.filter((l) => l.brokerId === broker.id && l.invoice?.sentAt && l.invoice.paidAt);
    const avg = own.length ? Math.round(own.reduce((s, l) => s + (Date.parse(l.invoice!.paidAt!) - Date.parse(l.invoice!.sentAt!)) / 86400_000, 0) / own.length) : null;
    const pays = avg ?? days;
    lines.push(`${broker.company}${pays ? ` pays in about ${pays} days${avg ? " (your own invoices)" : ""}` : own.length === 0 ? " is new to you" : ""}${broker.authorityVerified ? ", authority checked" : ""}.`);
  }
  // What else this truck had.
  const others = load.offerGroupId ? ctx.loads.filter((l) => l.offerGroupId === load.offerGroupId && l.id !== load.id && ["offered", "declined"].includes(l.stage) && Date.parse(l.updatedAt) > now.getTime() - 86400_000) : [];
  if (others.length) {
    const best = [...others].sort((a, b) => (b.netProfit ?? 0) - (a.netProfit ?? 0))[0];
    lines.push(`Best of ${others.length + 1} offers for this truck${best?.netProfit != null && load.netProfit != null ? `; the next best nets ${money(best.netProfit)} against ${money(load.netProfit)}` : ""}.`);
  }
  for (const w of load.scheduleWarnings ?? []) lines.push(w.text);
  return lines.slice(0, 7);
}

/** The why, stamped on the load. */
export function withWhy(load: Load, lines: string[]): Load {
  return lines.length ? { ...load, why: { at: new Date().toISOString(), lines } } : load;
}

/** A line added to what's already there (a counter, an acceptance), newest last. */
export function addWhy(load: Load, line: string): Load {
  const lines = [...(load.why?.lines ?? []).filter((l) => !l.startsWith("Broker offered")), line].slice(-8);
  return { ...load, why: { at: new Date().toISOString(), lines } };
}
