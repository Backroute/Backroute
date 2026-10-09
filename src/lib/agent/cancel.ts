import "server-only";
import { chainOf, slotsFor } from "./chain";
import { cancelParking } from "./parking";
import { toE164 } from "../cloud/phone";
import type { Item } from "../cloud/rows";
import { LOAD_CANCELLED } from "../channels/phrases";
import { canText, textTo } from "../channels/out";
import type { Load, Truck } from "../types";
import { addActivity, logChannel, save, saveDriverMessage, type CarrierContext } from "./db";
import { event, uid } from "./dispatcher";
import { requestBooking } from "./booking";
import { floorFor } from "./pricing";
import { assessBroker } from "../broker-policy";
import { sendOrQueue } from "./outbox";
import * as mail from "./templates";

/**
 * A broker cancels a booked load. The AI does what a dispatcher would: takes it off the truck, tells the driver not
 * to go (in their language), claims TONU if the truck was already rolling to it, and gets the truck its next load
 * from the offers still open.
 */

const DEFAULT_TONU = 150;
const ROLLING = new Set(["dispatched", "at_pickup"]);

/** "TONU $250" on the rate con → 250. */
function tonuOnRateCon(load: Load): number | null {
  const text = [...(load.rateConReading?.finesAndFees ?? []), ...(load.rateConReading?.otherConcerns ?? []), load.rateConReading?.summary ?? ""].join(" ");
  const m = text.match(/(?:tonu|truck ordered not used)[^$]{0,30}\$\s?(\d{2,4})/i);
  return m ? Number(m[1]) : null;
}

export async function cancelLoad(ctx: CarrierContext, load: Load, reason: string, from: string): Promise<void> {
  if (["cancelled", "delivered", "in_transit", "at_delivery", "declined"].includes(load.stage)) return;
  const at = new Date().toISOString();
  const wasRolling = ROLLING.has(load.stage);
  const tonu = wasRolling ? (tonuOnRateCon(load) ?? ctx.settings.tonuFee ?? DEFAULT_TONU) : 0;
  const cancelled: Load = { ...load, stage: "cancelled", cancellationReason: `Broker cancelled: ${reason}`, tonuFee: tonu || undefined, updatedAt: at };
  await save("loads", ctx.carrier.id, cancelled as unknown as Item);
  ctx.loads = ctx.loads.map((l) => (l.id === load.id ? cancelled : l));

  // Off the truck: its next load (if any) moves up.
  const truck = ctx.trucks.find((t) => t.id === load.truckId);
  let freed: Truck | undefined;
  if (truck?.trip && (truck.trip.stops.some((s) => s.loadId === load.id) || truck.currentLoadId === load.id)) {
    // Off a multi-load trip: its stops come out, the rest of the trip keeps its order, and the truck heads to the
    // next stop (lib/trip-plan). A trip with nothing left is over. The full load before a trip planned ahead: the trip
    // starts now.
    const trip = { ...truck.trip, stops: truck.trip.stops.filter((s) => s.loadId !== load.id), warnings: truck.trip.warnings?.filter((w) => !w.includes(load.referenceNumber)) };
    freed = { ...truck, trip, ...slotsFor(ctx.loads, { ...truck, trip }) };
    if (!freed.trip) delete freed.trip;
    await save("trucks", ctx.carrier.id, freed as unknown as Item);
    ctx.trucks = ctx.trucks.map((t) => (t.id === truck.id ? freed! : t));
    const first = truck.currentLoadId === load.id ? ctx.loads.find((l) => l.id === freed!.currentLoadId && l.stage === "booked") : undefined;
    if (first) {
      const p: Load = { ...first, stage: "dispatched", isChained: false, updatedAt: at };
      await save("loads", ctx.carrier.id, p as unknown as Item);
      ctx.loads = ctx.loads.map((l) => (l.id === p.id ? p : l));
    }
  } else if (truck && (truck.currentLoadId === load.id || truck.nextLoadId === load.id)) {
    // Whatever's lined up behind it moves up (lib/agent/chain): the next load becomes current, the one after it next.
    const behind = chainOf(ctx.loads, { ...truck, currentLoadId: null }).filter((l) => l.id !== truck.currentLoadId);
    const next = truck.currentLoadId === load.id ? (behind[0]?.id ?? null) : truck.currentLoadId;
    const after = behind.find((l) => l.id !== next)?.id ?? null;
    freed = { ...truck, currentLoadId: next, nextLoadId: after, status: next ? "on_load" : "available" };
    await save("trucks", ctx.carrier.id, freed as unknown as Item);
    ctx.trucks = ctx.trucks.map((t) => (t.id === truck.id ? freed! : t));
    if (next) {
      const promoted = ctx.loads.find((l) => l.id === next);
      if (promoted && promoted.stage === "booked") {
        const p: Load = { ...promoted, stage: "dispatched", isChained: false, updatedAt: at };
        await save("loads", ctx.carrier.id, p as unknown as Item);
        ctx.loads = ctx.loads.map((l) => (l.id === p.id ? p : l));
      }
    }
  }
  // A spot reserved for the night on this load isn't needed now (the driver or owner can book again if they want).
  if (truck?.parking?.status === "booked" && truck.currentLoadId === load.id && !freed?.trip)
    await cancelParking(ctx, freed ?? truck, "ai", `${load.referenceNumber} was cancelled`).catch((e) => console.error("[parking] cancel failed", e));
  await addActivity(ctx.carrier.id, event({ type: "load_cancelled", loadId: load.id, message: `Broker cancelled ${load.referenceNumber}`, detail: `${reason}${tonu ? ` · claiming $${tonu} TONU` : ""}`, severity: "warning" }));

  // Tell the driver not to go.
  const driver = ctx.drivers.find((d) => d.id === truck?.driverId);
  const to = driver ? toE164(driver.phone) : null;
  if (driver && to && !driver.prefs?.smsOptOut && canText(ctx.carrier)) {
    const text = LOAD_CANCELLED[driver.prefs?.language ?? "en"](load.referenceNumber, `${load.lane.origin}, ${load.lane.originState}`);
    const sid = await textTo(ctx.carrier, to, text);
    await saveDriverMessage(ctx.carrier.id, { id: uid("dm"), driverId: driver.id, from: "ai", content: text, timestamp: at, channel: "sms", ai: true });
    await logChannel({ carrierId: ctx.carrier.id, channel: "sms", direction: "out", providerId: sid ?? null, driverId: driver.id, counterparty: to, body: text, data: { kind: "cancelled", loadId: load.id } });
  }

  // TONU when the truck was already rolling to it.
  if (tonu)
    await sendOrQueue(ctx, {
      purpose: "tonu",
      to: from,
      subject: mail.subjectFor(load, "TONU"),
      body: mail.tonuClaim(ctx.carrier, ctx.settings, load, tonu),
      loadId: load.id,
      amount: tonu,
      // The rate con's own TONU amount is inside the rules; the AI's usual amount is a judgment call.
      withinRules: tonuOnRateCon(load) !== null,
      rule: "tonu_default",
      why: `${load.referenceNumber} was cancelled after the truck was dispatched. Claim $${tonu} TONU${tonuOnRateCon(load) ? "" : " (the rate con didn't say, so this is the usual amount)"}?`,
    });

  // Not rolling yet: nothing to claim, just a "got it" the way a dispatcher answers.
  else if (from.includes("@"))
    await sendOrQueue(ctx, { purpose: "ack", to: from, subject: mail.subjectFor(load, "Cancelled"), body: mail.cancelledAck(ctx.carrier, ctx.settings, load), loadId: load.id, withinRules: true, why: `Tell the broker you got the cancellation of ${load.referenceNumber}?` });

  if (freed && !freed.currentLoadId) await rebook(ctx, freed);
}

/** A truck that just lost its load: offers it passed on come back, and within the rules the AI asks for the best. */
async function rebook(ctx: CarrierContext, truck: Truck) {
  const now = Date.now();
  const again = ctx.loads.filter((l) => l.truckId === truck.id && l.stage === "declined" && l.offerGroupId && (!l.pickupAt || Date.parse(l.pickupAt) > now + 2 * 3600_000) && Date.parse(l.createdAt) > now - 24 * 3600_000);
  for (const l of again) {
    const back: Load = { ...l, stage: "offered", updatedAt: new Date().toISOString() };
    await save("loads", ctx.carrier.id, back as unknown as Item);
    ctx.loads = ctx.loads.map((x) => (x.id === l.id ? back : x));
  }
  if (ctx.settings.autonomy === "ask") return;
  const pick = ctx.loads
    .filter((l) => l.truckId === truck.id && l.stage === "offered" && floorFor(l, ctx.settings) !== null && l.targetRate >= floorFor(l, ctx.settings)!)
    .sort((a, b) => (b.netProfit ?? 0) - (a.netProfit ?? 0))[0];
  const broker = pick && ctx.brokers.find((b) => b.id === pick.brokerId);
  if (pick && broker && assessBroker(broker, ctx.settings.brokerOverrides).policy !== "block") await requestBooking(ctx, pick, pick.targetRate, { byRules: true });
}
