import "server-only";
import { assessBroker } from "../broker-policy";
import { homeTimeStatus } from "../home";
import { emailConfigured } from "../channels/email";
import { formatAtStop } from "../stop-time";
import { whereTrucksFree } from "./boards";
import { claimMark, type CarrierContext } from "./db";
import { sendOrQueue } from "./outbox";
import * as mail from "./templates";

/**
 * What a dispatcher does the day before a truck empties out: email the brokers who've sent loads from that area and
 * say the truck will be free. Their answers come back as load offers and go through the usual matching and booking.
 * At most one of these a day to any broker, only to brokers who passed the check, and only on autopilot (it names no
 * price, so "Within my rules" covers it).
 */

const DAY = 86400_000;
const PER_TRUCK = 4;

export async function offerCapacity(ctx: CarrierContext, now: number): Promise<string[]> {
  if (ctx.settings.autonomy === "ask" || !emailConfigured()) return [];
  const done: string[] = [];
  const day = new Date(now).toISOString().slice(0, 10);
  for (const { truck, q } of whereTrucksFree(ctx, now)) {
    // Already has offers waiting: nothing to go looking for.
    if (ctx.loads.some((l) => l.truckId === truck.id && l.stage === "offered" && Date.parse(l.updatedAt) > now - DAY)) continue;
    const worked = new Map<string, number>();
    for (const l of ctx.loads)
      if (l.brokerId && l.lane.originState === q.originState && Date.parse(l.createdAt ?? l.updatedAt) > now - 90 * DAY) worked.set(l.brokerId, (worked.get(l.brokerId) ?? 0) + 1);
    const brokers = ctx.brokers
      .filter((b) => b.email && worked.has(b.id) && assessBroker(b, ctx.settings.brokerOverrides).policy !== "block")
      .sort((a, b) => worked.get(b.id)! - worked.get(a.id)!)
      .slice(0, PER_TRUCK);
    // Say where the driver wants to go only when they need to head home.
    const driver = ctx.drivers.find((d) => d.id === truck.driverId);
    const home = driver?.homeBase ? homeTimeStatus(driver, q.originCity, q.originState, new Date(q.availableFrom)).state : "no_target";
    const toward = driver && (driver.homePriority || home === "head_home" || home === "late") ? driver.homeBase : undefined;
    const when = Date.parse(q.availableFrom) <= now + 2 * 3600_000 ? "now" : `from ${formatAtStop(q.availableFrom, q.originState)}`;
    let sent = 0;
    for (const b of brokers) {
      if (!(await claimMark(ctx.carrier.id, `broker:${b.id}`, `capacity:${day}`))) continue;
      await sendOrQueue(ctx, {
        purpose: "capacity",
        to: b.email!,
        toName: b.contact || undefined,
        subject: `${truck.equipmentType} available in ${q.originCity}, ${q.originState}`,
        body: mail.capacity(ctx.carrier, ctx.settings, { equipment: truck.equipmentType, city: q.originCity, state: q.originState, when, toward }, b.contact || undefined),
        withinRules: true,
        why: `Tell ${b.company} truck ${truck.unitNumber} will be free in ${q.originCity}, ${q.originState}?`,
      });
      sent++;
    }
    if (sent) done.push(`Truck ${truck.unitNumber}: told ${sent} broker${sent === 1 ? "" : "s"} it's free in ${q.originCity}`);
  }
  return done;
}
