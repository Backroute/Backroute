import "server-only";
import { canText, textTo } from "../channels/out";
import { toE164 } from "../cloud/phone";
import type { Item } from "../cloud/rows";
import { estimateMiles } from "../fleet";
import type { Load, LoadChange, LoadStop } from "../types";
import { addActivity, claimMark, logChannel, save, saveDriverMessage, type CarrierContext } from "./db";
import { billTo } from "./paperwork";
import { event, passToOwner, uid } from "./dispatcher";
import { sendOrQueue } from "./outbox";
import { route } from "./routing";

/**
 * A broker changing a booked load (another stop, a different delivery) is asked to pay for it, the way a dispatcher
 * prices it before saying yes: the extra miles at what the load pays a mile (never under the owner's lowest), plus
 * stop pay for each stop. The broker gets the number and the new all-in total; their yes (or a revised rate con for
 * it) puts it on the load, the driver hears, and it goes on the invoice. A lower number that still covers most of it
 * is taken; anything less goes to the owner.
 */

const DEFAULT_STOP_PAY = 75;
const round25 = (n: number) => Math.round(n / 25) * 25;
type Place = { city: string; state: string };

async function miles(a: Place, b: Place): Promise<number | null> {
  return (await route(a, b).catch(() => null))?.miles ?? estimateMiles(a, b);
}

/** Extra loaded miles the change adds (0 when it's shorter), or null when a city can't be placed. */
async function extraMiles(load: Load, kind: LoadChange["kind"], places: Place[]): Promise<number | null> {
  const origin = { city: load.lane.origin, state: load.lane.originState };
  const dest = { city: load.lane.destination, state: load.lane.destState };
  if (kind === "reroute") {
    const now = await miles(origin, places[0]);
    const before = await miles(origin, dest);
    return now === null || before === null ? null : Math.max(0, Math.round(now - before));
  }
  // Stops in order between pickup and delivery.
  const path = [origin, ...places, dest];
  let total = 0;
  for (let i = 0; i < path.length - 1; i++) {
    const leg = await miles(path[i], path[i + 1]);
    if (leg === null) return null;
    total += leg;
  }
  const direct = (await miles(origin, dest)) ?? load.lane.miles;
  return Math.max(0, Math.round(total - direct));
}

/** What the change is worth: the extra miles at the load's rate a mile (at least the owner's lowest) and stop pay. */
function priceChange(load: Load, kind: LoadChange["kind"], stops: number, extra: number, settings: CarrierContext["settings"]): number {
  const rate = load.bookedRate ?? load.targetRate;
  const rpm = Math.max(rate / Math.max(1, load.lane.miles), settings.minRpm ?? 0);
  const stopPay = kind === "add_stop" ? stops * (settings.stopPay ?? DEFAULT_STOP_PAY) : 0;
  return round25(extra * rpm + stopPay);
}

/** The broker asked for a change: priced and answered. */
export async function answerChange(ctx: CarrierContext, load: Load, kind: LoadChange["kind"], places: Place[], sender: { from: string; fromName: string; subject: string; messageId?: string; contactName?: string | null }): Promise<string> {
  const clean = places.filter((p) => p.city && p.state).map((p) => ({ city: p.city.trim(), state: p.state.trim().toUpperCase().slice(0, 2) }));
  if (!clean.length) return "no places in the change";
  const extra = await extraMiles(load, kind, clean);
  const what = kind === "reroute" ? `deliver to ${clean[0].city}, ${clean[0].state} instead` : `add ${clean.length === 1 ? "a stop" : `${clean.length} stops`} in ${clean.map((p) => `${p.city}, ${p.state}`).join(" and ")}`;
  if (extra === null) {
    await passToOwner(ctx, { reason: `${sender.fromName} wants ${load.referenceNumber} to ${what}. Backroute couldn't work out the extra miles: price it and reply.`, loadId: load.id, label: "I'll price it", source: "email", to: "decider" });
    return "change passed on (unknown miles)";
  }
  const rate = load.bookedRate ?? load.targetRate;
  const price = priceChange(load, kind, clean.length, extra, ctx.settings);
  const change: LoadChange = { kind, places: clean, extraMiles: extra, extra: price, newTotal: rate + price, askedAt: new Date().toISOString(), status: "asked" };
  const next: Load = { ...load, change, updatedAt: change.askedAt };
  await save("loads", ctx.carrier.id, next as unknown as Item);
  ctx.loads = ctx.loads.map((l) => (l.id === load.id ? next : l));
  const name = sender.contactName ?? undefined;
  const stopPay = kind === "add_stop" ? clean.length * (ctx.settings.stopPay ?? DEFAULT_STOP_PAY) : 0;
  const parts = [stopPay ? `$${stopPay} stop pay` : null, extra ? `${extra} extra miles` : null].filter(Boolean).join(" and ");
  const body = price
    ? `Hi${name ? ` ${name}` : ""},\n\nWe can ${what} on ${load.referenceNumber}. That's $${price.toLocaleString("en-US")} more (${parts}), so $${change.newTotal.toLocaleString("en-US")} all in. Send over a revised rate con and we'll get the driver on it.\n\nThanks,\n${ctx.carrier.name}`
    : `Hi${name ? ` ${name}` : ""},\n\nWe can ${what} on ${load.referenceNumber} at the same rate, $${rate.toLocaleString("en-US")} all in. Send over a revised rate con with the new ${kind === "reroute" ? "delivery" : "stop"} and we'll get the driver on it.\n\nThanks,\n${ctx.carrier.name}`;
  const result = await sendOrQueue(ctx, {
    purpose: "change",
    to: sender.from,
    toName: name,
    subject: /^re:/i.test(sender.subject) ? sender.subject : `Re: ${sender.subject}`,
    body,
    inReplyTo: sender.messageId,
    loadId: load.id,
    amount: change.newTotal,
    withinRules: true,
    why: `${sender.fromName} wants ${load.referenceNumber} to ${what}. Ask $${price} more ($${change.newTotal} all in)?`,
  });
  if (!price) await agreeChange(ctx, next, change.newTotal);
  return `change priced at +$${price} (${result})`;
}

/** The broker said yes to the change (or sent a rate con for it): on the load, to the driver, on the invoice. */
async function agreeChange(ctx: CarrierContext, load: Load, total: number): Promise<Load> {
  const c = load.change!;
  const rate = load.bookedRate ?? load.targetRate;
  const at = new Date().toISOString();
  const change: LoadChange = { ...c, status: "agreed", agreedAt: at, extra: Math.max(0, total - rate), newTotal: total };
  const lane =
    c.kind === "reroute" ? { ...load.lane, destination: c.places[0].city, destState: c.places[0].state, miles: load.lane.miles + c.extraMiles } : { ...load.lane, miles: load.lane.miles + c.extraMiles };
  const stops: LoadStop[] =
    c.kind === "add_stop"
      ? [...(load.stops ?? []), ...c.places.map((p, i) => ({ id: uid("stop"), kind: "delivery" as const, city: p.city, state: p.state, window: "Ask the broker", sequence: (load.stops?.length ?? 0) + i + 1, completed: false }))]
      : (load.stops ?? []);
  const next: Load = { ...load, change, lane, stops, updatedAt: at };
  await save("loads", ctx.carrier.id, next as unknown as Item);
  ctx.loads = ctx.loads.map((l) => (l.id === load.id ? next : l));
  const where = c.places.map((p) => `${p.city}, ${p.state}`).join(" and ");
  await addActivity(ctx.carrier.id, event({ type: "rate_confirmed", loadId: load.id, message: `${load.referenceNumber} changed: ${c.kind === "reroute" ? `now delivers to ${where}` : `stop added in ${where}`}`, detail: `+$${change.extra.toLocaleString("en-US")} · $${total.toLocaleString("en-US")} all in`, severity: "success" }));
  const driver = ctx.drivers.find((d) => d.id === ctx.trucks.find((t) => t.id === load.truckId)?.driverId);
  const to = driver ? toE164(driver.phone) : null;
  if (driver && to && !driver.prefs?.smsOptOut && canText(ctx.carrier) && load.stage !== "booked") {
    const body = `${driver.name.split(" ")[0]}, ${load.referenceNumber} changed: ${c.kind === "reroute" ? `it now delivers to ${where}` : `there's an extra stop in ${where} before ${load.lane.destination}`}. Details are in the app.`;
    const sid = await textTo(ctx.carrier, to, body);
    await saveDriverMessage(ctx.carrier.id, { id: uid("dm"), driverId: driver.id, from: "ai", content: body, timestamp: at, channel: "sms", ai: true });
    await logChannel({ carrierId: ctx.carrier.id, channel: "sms", direction: "out", providerId: sid, driverId: driver.id, counterparty: to, body, data: { kind: "load_changed", loadId: load.id } });
  }
  return next;
}

/** The broker answered our price for the change. Returns true when it's settled here. */
export async function changeReply(ctx: CarrierContext, load: Load, r: { agreed: boolean; brokerRate: number | null }, fromName: string): Promise<boolean> {
  const c = load.change;
  if (!c || c.status !== "asked") return false;
  const rate = load.bookedRate ?? load.targetRate;
  if (r.agreed && (r.brokerRate === null || r.brokerRate >= c.newTotal)) {
    await agreeChange(ctx, load, c.newTotal);
    return true;
  }
  // Their number: fine if it still covers three quarters of what the change is worth.
  if (r.brokerRate !== null && r.brokerRate - rate >= c.extra * 0.75) {
    await agreeChange(ctx, load, r.brokerRate);
    return true;
  }
  // Too little: the AI holds its number once, with the reason, the way a dispatcher would. Still too little after
  // that, and it's the owner's call.
  const to = billTo(ctx, load);
  if (to && (await claimMark(ctx.carrier.id, load.id, "change_hold"))) {
    await sendOrQueue(ctx, {
      purpose: "change",
      to,
      subject: `Re: ${load.referenceNumber}`,
      body: `Hi,\n\nWe can't do the ${c.kind === "reroute" ? "reroute" : "extra stop"} on ${load.referenceNumber} for${r.brokerRate ? ` $${r.brokerRate.toLocaleString("en-US")}` : " that"}: it's ${c.extraMiles} more miles${c.kind === "add_stop" ? " plus the stop" : ""}, so we need $${c.newTotal.toLocaleString("en-US")} all in. Let us know.\n\nThanks,\n${ctx.carrier.name}`,
      loadId: load.id,
      amount: c.newTotal,
      withinRules: true,
      why: `Hold at $${c.newTotal} for the change on ${load.referenceNumber}?`,
    });
    return true;
  }
  if (r.brokerRate !== null || !r.agreed) {
    await passToOwner(ctx, { reason: `${fromName} came back on the change to ${load.referenceNumber}${r.brokerRate ? ` with $${r.brokerRate.toLocaleString("en-US")} all in` : ""}; Backroute asked $${c.newTotal.toLocaleString("en-US")} (+$${c.extra} for ${c.extraMiles} extra miles${c.kind === "add_stop" ? " and stop pay" : ""}). Take it or push back?`, loadId: load.id, label: "Decided", source: "email", to: "decider" });
    return true;
  }
  return false;
}
