import "server-only";
import { canText, textTo } from "../channels/out";
import { toE164 } from "../cloud/phone";
import type { Item } from "../cloud/rows";
import type { Driver, Load } from "../types";
import { claimMark, logChannel, save, saveDriverMessage, type CarrierContext } from "./db";
import { tellOwner, uid } from "./dispatcher";
import { sendOrQueue } from "./outbox";

/**
 * The broker's tracking app (Macropoint, Trucker Tools, FourKites, project44...), the way a dispatcher handles it:
 * spot that the load needs it (on the rate con or in the broker's email), text the driver what to accept and the link
 * if there is one, confirm when they say it's on and tell the broker, and chase it before pickup. Brokers hold pay on
 * loads that weren't tracked.
 */

const APPS: { name: string; re: RegExp }[] = [
  { name: "Macropoint", re: /macro ?point|descartes/i },
  { name: "Trucker Tools", re: /trucker ?tools/i },
  { name: "FourKites", re: /four ?kites/i },
  { name: "project44", re: /project ?44|\bp44\b/i },
  { name: "Transflo", re: /transflo/i },
  { name: "Highway", re: /highway (app|tracking)/i },
];

export interface TrackingNeed {
  app: string | null;
  link: string | null;
}

/** What a rate con or broker email says about tracking, or null when it doesn't ask for any. */
export function trackingNeed(text: string): TrackingNeed | null {
  const app = APPS.find((a) => a.re.test(text))?.name ?? null;
  const link = text.match(/https?:\/\/[^\s<>")]*(macropoint|truckertools|fourkites|project44|p-44|transflo|visibility|track)[^\s<>")]*/i)?.[0] ?? null;
  if (!app && !link && !/\b(tracking (is )?required|must (be )?track|app tracking|track(ing)? app|accept (the )?tracking)\b/i.test(text)) return null;
  return { app, link };
}

const driverOf = (ctx: CarrierContext, load: Load) => ctx.drivers.find((d) => d.id === ctx.trucks.find((t) => t.id === load.truckId)?.driverId);

async function text(ctx: CarrierContext, driver: Driver, body: string, kind: string, loadId: string) {
  const to = toE164(driver.phone);
  if (!to || driver.prefs?.smsOptOut || !canText(ctx.carrier)) return false;
  const sid = await textTo(ctx.carrier, to, body);
  await saveDriverMessage(ctx.carrier.id, { id: uid("dm"), driverId: driver.id, from: "ai", content: body, timestamp: new Date().toISOString(), channel: "sms", ai: true });
  await logChannel({ carrierId: ctx.carrier.id, channel: "sms", direction: "out", providerId: sid, driverId: driver.id, counterparty: to, body, data: { kind, loadId } });
  return true;
}

/** Asks the driver to turn tracking on for a load (once; again if the broker sends a new link). */
export async function askDriverToTrack(ctx: CarrierContext, load: Load, need: TrackingNeed): Promise<boolean> {
  const current = ctx.loads.find((l) => l.id === load.id) ?? load;
  if (current.tracking?.acceptedAt) return false;
  const again = !!current.tracking && !!need.link && current.tracking.link !== need.link;
  if (!again && !(await claimMark(ctx.carrier.id, load.id, "tracking_ask"))) return false;
  const app = need.app ?? current.tracking?.app ?? null;
  const next: Load = { ...current, tracking: { app, link: need.link ?? current.tracking?.link ?? null, askedAt: new Date().toISOString() }, updatedAt: new Date().toISOString() };
  await save("loads", ctx.carrier.id, next as unknown as Item);
  ctx.loads = ctx.loads.map((l) => (l.id === load.id ? next : l));
  const driver = driverOf(ctx, next);
  if (!driver) return false;
  const first = driver.name.split(" ")[0];
  const body = `${first}, ${next.referenceNumber} needs ${app ?? "the broker's"} tracking. ${next.tracking!.link ? `Open this and accept: ${next.tracking!.link}` : `You'll get a text${app ? ` from ${app}` : ""}: accept it and leave location on.`} Reply YES once it's on.`;
  return text(ctx, driver, body, "tracking_ask", load.id);
}

const YES = /^\s*(y|yes|yep|yeah|ya|done|ok(ay)?|got it|accepted|it'?s on|tracking (is )?on|all set|si|sí)\b/i;

/**
 * A driver's text, before the AI answers it: "yes" to a tracking request turns it on for the load and tells the
 * broker. Returns the reply to send, or null when the text is about something else.
 */
export async function trackingReply(ctx: CarrierContext, driver: Driver, said: string): Promise<string | null> {
  if (!YES.test(said)) return null;
  const trucks = new Set(ctx.trucks.filter((t) => t.driverId === driver.id || t.secondDriverId === driver.id).map((t) => t.id));
  const load = ctx.loads.find((l) => l.truckId && trucks.has(l.truckId) && l.tracking?.askedAt && !l.tracking.acceptedAt && !["delivered", "cancelled", "declined"].includes(l.stage));
  if (!load) return null;
  const at = new Date().toISOString();
  const next: Load = { ...load, tracking: { ...load.tracking!, acceptedAt: at }, updatedAt: at };
  await save("loads", ctx.carrier.id, next as unknown as Item);
  ctx.loads = ctx.loads.map((l) => (l.id === load.id ? next : l));
  const broker = ctx.brokers.find((b) => b.id === load.brokerId);
  const to = load.brokerContactEmail ?? broker?.email;
  if (to)
    await sendOrQueue(ctx, {
      purpose: "ack",
      to,
      toName: broker?.contact || undefined,
      subject: `Tracking on ${load.referenceNumber}`,
      body: `Hi${broker?.contact ? ` ${broker.contact}` : ""},\n\nThe driver accepted ${load.tracking?.app ?? "tracking"} on ${load.referenceNumber}. Let us know if it isn't showing on your end.\n\nThanks,\n${ctx.carrier.name}`,
      loadId: load.id,
      withinRules: true,
      why: `Tell ${broker?.company ?? "the broker"} tracking is on for ${load.referenceNumber}?`,
    });
  return `Thanks, tracking's on for ${load.referenceNumber}. I let the broker know.`;
}

/**
 * Tracking asked for and not on: a reminder 2 hours before pickup. At pickup, the broker gets the driver's number to
 * send the request again (the usual fix: the invite went to the wrong phone), the driver another text, and the owner
 * a note.
 */
export async function trackingRounds(ctx: CarrierContext, now: number): Promise<string[]> {
  const done: string[] = [];
  for (const load of ctx.loads) {
    const t = load.tracking;
    if (!t?.askedAt || t.acceptedAt || !load.pickupAt || ["delivered", "cancelled", "declined"].includes(load.stage)) continue;
    const pickup = Date.parse(load.pickupAt);
    const driver = driverOf(ctx, load);
    if (driver && now >= pickup - 2 * 3600_000 && now < pickup && (await claimMark(ctx.carrier.id, load.id, "tracking_remind"))) {
      if (await text(ctx, driver, `${driver.name.split(" ")[0]}, tracking for ${load.referenceNumber} still isn't on. ${t.link ? `Tap ${t.link} and accept.` : `Accept the ${t.app ?? "tracking"} text.`} Reply YES when it's done.`, "tracking_remind", load.id)) done.push(`${load.referenceNumber}: tracking reminder`);
    }
    if (now >= pickup && now < pickup + 12 * 3600_000 && (await claimMark(ctx.carrier.id, load.id, "tracking_missing"))) {
      const broker = ctx.brokers.find((b) => b.id === load.brokerId);
      const to = load.brokerContactEmail || broker?.email;
      if (to && driver)
        await sendOrQueue(ctx, {
          purpose: "ack",
          to,
          toName: broker?.contact || undefined,
          subject: `Tracking on ${load.referenceNumber}`,
          body: `Hi${broker?.contact ? ` ${broker.contact}` : ""},\n\nOur driver on ${load.referenceNumber} hasn't been able to get ${t.app ?? "tracking"} going yet. Can you send the request again to ${driver.name.split(" ")[0]} at ${driver.phone}? We'll make sure it's accepted.\n\nThanks,\n${ctx.carrier.name}`,
          loadId: load.id,
          withinRules: true,
          why: `Ask ${broker?.company ?? "the broker"} to resend the tracking request for ${load.referenceNumber}?`,
        });
      if (driver) await text(ctx, driver, `${driver.name.split(" ")[0]}, the broker is sending the ${t.app ?? "tracking"} request for ${load.referenceNumber} again. Accept it when it comes and reply YES.`, "tracking_resend", load.id);
      await tellOwner(ctx, { reason: `${load.referenceNumber} needs ${t.app ?? "tracking"} and the driver hasn't confirmed it's on. The AI asked the broker to resend it and told the driver. Brokers can hold pay on untracked loads.`, loadId: load.id, source: "sms", severity: "warning" });
      done.push(`${load.referenceNumber}: tracking not confirmed, broker asked to resend`);
    }
  }
  return done;
}
