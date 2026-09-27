import "server-only";
import { REPOSITION } from "../channels/phrases";
import { canText, textTo } from "../channels/out";
import { toE164 } from "../cloud/phone";
import type { Item } from "../cloud/rows";
import { estimateMiles } from "../fleet";
import type { Load, Truck } from "../types";
import { addActivity, claimMark, logChannel, save, saveDriverMessage, type CarrierContext } from "./db";
import { event, passToOwner, uid } from "./dispatcher";

/**
 * A truck sitting empty where nothing ships: a dispatcher moves it to where the freight is. The AI looks at where the
 * carrier's loads have come from (every load offered to it in the last three weeks, from email, feeds and boards) and
 * picks the nearest place with plenty. On full autopilot, within half the owner's empty-miles limit, it sends the
 * driver; otherwise it asks the owner. Once a day per truck.
 */

const HOUR = 3600_000;
const DAY = 24 * HOUR;
const IDLE_HOURS = 12;
const BUSY = new Set<Load["stage"]>(["negotiating", "booked", "rate_confirmed", "dispatched", "at_pickup", "in_transit", "at_delivery"]);

/** When the truck's last load was unloaded (the driver's tap), or when it was marked delivered. Later paperwork doesn't count. */
export function emptySince(ctx: Pick<CarrierContext, "loads">, truck: Truck): number | null {
  const at = (l: Load) => Date.parse(l.tripChecklist?.unloadedAt ?? l.updatedAt);
  const last = ctx.loads.filter((l) => l.truckId === truck.id && l.stage === "delivered").sort((a, b) => at(b) - at(a))[0];
  return last ? at(last) : null;
}

/** Where the freight is: origins of loads seen lately, counted, with how far each is from the truck. */
export function markets(ctx: Pick<CarrierContext, "loads">, truck: Truck, now: number, equipmentOnly = true) {
  const counts = new Map<string, { city: string; state: string; loads: number }>();
  for (const l of ctx.loads) {
    if (Date.parse(l.createdAt ?? l.updatedAt) < now - 21 * DAY) continue;
    if (equipmentOnly && l.equipmentType !== truck.equipmentType) continue;
    const key = `${l.lane.origin}, ${l.lane.originState}`;
    const m = counts.get(key) ?? { city: l.lane.origin, state: l.lane.originState, loads: 0 };
    m.loads++;
    counts.set(key, m);
  }
  return [...counts.values()]
    .map((m) => ({ ...m, miles: estimateMiles({ city: truck.currentCity, state: truck.currentState }, { city: m.city, state: m.state }) }))
    .filter((m): m is typeof m & { miles: number } => m.miles !== null);
}

export async function suggestRepositions(ctx: CarrierContext, now: number): Promise<string[]> {
  const done: string[] = [];
  const day = new Date(now).toISOString().slice(0, 10);
  const limit = ctx.settings.maxDeadhead ?? 300;
  for (const truck of ctx.trucks) {
    if (!truck.driverId || truck.status !== "available" || truck.nextLoadId || truck.currentLoadId) continue;
    if (ctx.loads.some((l) => l.truckId === truck.id && (BUSY.has(l.stage) || (l.stage === "offered" && Date.parse(l.updatedAt) > now - IDLE_HOURS * HOUR)))) continue;
    const since = emptySince(ctx, truck);
    if (!since || now - since < IDLE_HOURS * HOUR) continue;
    const all = markets(ctx, truck, now);
    const here = all.find((m) => m.miles < 60)?.loads ?? 0;
    // Somewhere within the limit with at least 3 loads and twice what's around the truck now; closest wins ties.
    const best = all
      .filter((m) => m.miles >= 60 && m.miles <= limit && m.loads >= 3 && m.loads >= 2 * Math.max(1, here))
      .sort((a, b) => b.loads / (1 + b.miles / 100) - a.loads / (1 + a.miles / 100))[0];
    if (!best || !(await claimMark(ctx.carrier.id, `truck:${truck.id}`, `reposition:${day}`))) continue;
    const hours = Math.round((now - since) / HOUR);
    const driver = ctx.drivers.find((d) => d.id === truck.driverId);
    const goes = ctx.settings.autonomy === "full" && best.miles <= limit / 2;
    const why = `Truck ${truck.unitNumber} has been empty in ${truck.currentCity}, ${truck.currentState} for ${hours} hours with no load that fits. ${best.city}, ${best.state} is ${best.miles} miles away and ${best.loads} of your loads came out of it in the last 3 weeks.`;
    if (goes && driver && canText(ctx.carrier) && !driver.prefs?.smsOptOut) {
      const next: Truck = { ...truck, repositionTo: { city: best.city, state: best.state, at: new Date(now).toISOString() } };
      await save("trucks", ctx.carrier.id, next as unknown as Item);
      ctx.trucks = ctx.trucks.map((t) => (t.id === truck.id ? next : t));
      const to = toE164(driver.phone);
      if (to) {
        const text = REPOSITION[driver.prefs?.language ?? "en"]({ city: `${best.city}, ${best.state}`, miles: best.miles });
        const sid = await textTo(ctx.carrier, to, text);
        await saveDriverMessage(ctx.carrier.id, { id: uid("dm"), driverId: driver.id, from: "ai", content: text, timestamp: new Date(now).toISOString(), channel: "sms", ai: true });
        await logChannel({ carrierId: ctx.carrier.id, channel: "sms", direction: "out", providerId: sid ?? null, driverId: driver.id, counterparty: to, body: text, data: { kind: "reposition" } });
      }
      await addActivity(ctx.carrier.id, event({ type: "dispatched", message: `Truck ${truck.unitNumber} moving empty to ${best.city}, ${best.state}`, detail: why, severity: "info" }));
      done.push(`Truck ${truck.unitNumber}: moving to ${best.city}`);
    } else {
      await passToOwner(ctx, { reason: `${why} Send it there empty (about $${Math.round(best.miles * 0.75)} in fuel)? Tell ${driver?.name.split(" ")[0] ?? "the driver"}, or wait.`, label: "Decided", source: "app", to: "owner" });
      done.push(`Truck ${truck.unitNumber}: asked the owner about moving to ${best.city}`);
    }
  }
  return done;
}
