import "server-only";
import { LANG_INFO } from "../lang/pack";
import { toE164 } from "../cloud/phone";
import { CHECKIN, DRIVER_SILENT } from "../channels/phrases";
import { canCallOut, sendSms, startCall } from "../channels/twilio";
import { formatAtStop, hourAtStop } from "../stop-time";
import type { CheckinKind, Driver, Load, LoadStage } from "../types";
import { addActivity, claimMark, heardFrom, logChannel, releaseMark, saveDriverMessage, type CarrierContext } from "./db";
import { event, passToOwner, uid } from "./dispatcher";

/**
 * The AI watching the board, the way a dispatcher does between calls. Run every few minutes by /api/cron/dispatch.
 *
 * - Before pickup and before delivery: a text to the driver, "on track?"
 * - An appointment passed and the load hasn't moved: "are you there?"
 * - No answer 45 minutes later: a call to the driver, and the owner is told.
 * - Unloaded with no POD photo: a reminder, then the owner.
 *
 * Each happens once per load (see claimMark). A driver's answer goes to the same AI that handles their texts and calls.
 */

const MIN = 60_000;
const HOUR = 60 * MIN;

const BEFORE_PICKUP: LoadStage[] = ["rate_confirmed", "booked", "dispatched"];
const ROLLING: LoadStage[] = ["at_pickup", "in_transit"];

export interface Due {
  load: Load;
  driver: Driver;
  kind: CheckinKind;
  /** When the check-in this follows up on went out, for the "silent" kinds. */
  since?: string;
}

const hasPod = (l: Load) => l.documents.some((d) => d.type === "pod" && d.status !== "failed");

/**
 * What's due right now, at most one per load: pure, so the timing rules can be read and tested on their own.
 * `marks` holds what was already sent ("loadId:kind" → when).
 */
export function dueCheckins(ctx: Pick<CarrierContext, "loads" | "trucks" | "drivers">, marks: Map<string, { at: string }>, now: number): Due[] {
  const due: Due[] = [];
  for (const load of ctx.loads) {
    const truck = ctx.trucks.find((t) => t.id === load.truckId);
    const driver = ctx.drivers.find((d) => d.id === truck?.driverId);
    if (!truck || !driver) continue;
    const sent = (k: CheckinKind) => marks.get(`${load.id}:${k}`)?.at;
    const pickup = load.pickupAt ? Date.parse(load.pickupAt) : NaN;
    const delivery = load.deliveryAt ? Date.parse(load.deliveryAt) : NaN;
    const justAdded = Date.parse(load.createdAt) > now - HOUR; // They just got the new-load text.

    const pick = (): Due | null => {
      if (BEFORE_PICKUP.includes(load.stage) && pickup) {
        const late = sent("pickup_late");
        if (late && !sent("pickup_silent") && now >= Date.parse(late) + 45 * MIN && now < pickup + 12 * HOUR) return { load, driver, kind: "pickup_silent", since: late };
        if (!late && now >= pickup + 30 * MIN && now < pickup + 12 * HOUR) return { load, driver, kind: "pickup_late" };
        if (!sent("before_pickup") && !justAdded && now >= pickup - 2 * HOUR && now < pickup - 15 * MIN) return { load, driver, kind: "before_pickup" };
      }
      if (ROLLING.includes(load.stage) && delivery) {
        const late = sent("delivery_late");
        if (late && !sent("delivery_silent") && now >= Date.parse(late) + 45 * MIN && now < delivery + 12 * HOUR) return { load, driver, kind: "delivery_silent", since: late };
        if (!late && now >= delivery + 30 * MIN && now < delivery + 12 * HOUR) return { load, driver, kind: "delivery_late" };
        if (load.stage === "in_transit" && !sent("before_delivery") && now >= delivery - 3 * HOUR && now < delivery - 15 * MIN) return { load, driver, kind: "before_delivery" };
      }
      if ((load.stage === "at_delivery" || load.stage === "delivered") && !hasPod(load)) {
        const arrived = Date.parse(load.tripChecklist?.arrivedDeliveryAt ?? load.updatedAt);
        const asked = sent("pod_needed");
        if (asked && !sent("pod_silent") && now >= Date.parse(asked) + 4 * HOUR) return { load, driver, kind: "pod_silent", since: asked };
        if (!asked && now >= Math.max(arrived + 90 * MIN, delivery || 0) && now < arrived + 3 * 24 * HOUR) return { load, driver, kind: "pod_needed" };
      }
      return null;
    };
    const d = pick();
    if (d) due.push(d);
  }
  return due;
}

/** The text a check-in sends (and a check-in call asks), in the driver's language, with times at the stop. */
export function checkinText(kind: CheckinKind, load: Load, driver: Driver): string {
  const lang = driver.prefs?.language ?? "en";
  const locale = LANG_INFO[lang].speech;
  const atPickup = kind.startsWith("pickup") || kind === "before_pickup";
  const base = kind === "pickup_silent" ? "pickup_late" : kind === "delivery_silent" ? "delivery_late" : kind === "pod_silent" ? "pod_needed" : kind;
  const iso = atPickup ? load.pickupAt : load.deliveryAt;
  const state = atPickup ? load.lane.originState : load.lane.destState;
  return CHECKIN[base][lang]({
    ref: load.referenceNumber,
    place: atPickup ? `${load.lane.origin}, ${load.lane.originState}` : `${load.lane.destination}, ${load.lane.destState}`,
    time: iso ? formatAtStop(iso, state, locale) : atPickup ? load.pickupWindow : load.deliveryWindow,
  });
}

const OWNER_REASON: Partial<Record<CheckinKind, (d: string, l: Load) => string>> = {
  pickup_silent: (d, l) => `${d} hasn't answered about pickup ${l.referenceNumber} in ${l.lane.origin}, ${l.lane.originState} (due ${l.pickupWindow}), and the load isn't marked at pickup. The AI texted and tried calling.`,
  delivery_silent: (d, l) => `${d} hasn't answered about delivery ${l.referenceNumber} in ${l.lane.destination}, ${l.lane.destState} (due ${l.deliveryWindow}). The AI texted and tried calling.`,
  pod_silent: (d, l) => `No signed POD from ${d} for ${l.referenceNumber} yet, so it can't be invoiced. The AI asked for it.`,
};

/** Sends what's due for one carrier. Returns what it did, for the job's log. */
export async function runCheckins(ctx: CarrierContext, marks: Map<string, { at: string }>, now: number, callUrl: (loadId: string, kind: CheckinKind) => string): Promise<string[]> {
  if (ctx.settings.checkIns === false) return [];
  const done: string[] = [];
  for (const d of dueCheckins(ctx, marks, now)) {
    const { load, driver, kind } = d;
    const silent = kind.endsWith("_silent");
    // The driver answered since the last check-in (a text, a call, the app): the AI already has it, nothing to chase.
    if (silent && d.since && (await heardFrom(ctx.carrier.id, driver.id, d.since))) {
      await claimMark(ctx.carrier.id, load.id, kind, { skipped: "answered" });
      continue;
    }
    if (!(await claimMark(ctx.carrier.id, load.id, kind))) continue; // Another run got it first.
    try {
      const phone = toE164(driver.phone);
      const text = checkinText(kind, load, driver);
      const first = driver.name.split(" ")[0];
      const stopState = kind.startsWith("pickup") || kind === "before_pickup" ? load.lane.originState : load.lane.destState;
      const callOk = canCallOut() && !!phone && (driver.prefs?.noCallsBefore === undefined || hourAtStop(stopState, now) >= driver.prefs.noCallsBefore);

      if (silent || driver.prefs?.smsOptOut) {
        if (callOk) {
          const sid = await startCall(phone!, callUrl(load.id, kind));
          await logChannel({ carrierId: ctx.carrier.id, channel: "voice", direction: "out", providerId: sid ? `${sid}:dial` : null, driverId: driver.id, counterparty: phone, body: `Calling ${first}: ${text}`, data: { kind: "checkin", checkin: kind, loadId: load.id } });
          done.push(`${load.referenceNumber}: called ${first} (${kind})`);
        }
      } else if (phone) {
        const sid = await sendSms(phone, text);
        await saveDriverMessage(ctx.carrier.id, { id: uid("dm"), driverId: driver.id, from: "ai", content: text, timestamp: new Date(now).toISOString(), channel: "sms", ai: true });
        await logChannel({ carrierId: ctx.carrier.id, channel: "sms", direction: "out", providerId: sid ?? null, driverId: driver.id, counterparty: phone, body: text, data: { kind: "checkin", checkin: kind, loadId: load.id } });
        done.push(`${load.referenceNumber}: texted ${first} (${kind})`);
      }

      const reason = OWNER_REASON[kind]?.(driver.name, load);
      if (reason) {
        await passToOwner(ctx, { reason, loadId: load.id, critical: kind !== "pod_silent", label: "I've reached them", source: "sms" });
        const owner = ctx.carrier.owner_phone ? toE164(ctx.carrier.owner_phone) : null;
        // A driver who can't be reached on a late load is treated like a safety alert: the owner gets it whatever the
        // notification setting. A missing POD only comes by text if they asked for texts.
        if (owner && (kind !== "pod_silent" || ctx.settings.notifySms)) {
          const note = DRIVER_SILENT[ctx.settings.ownerLanguage ?? "en"](first, load.referenceNumber);
          const sid = await sendSms(owner, note);
          await logChannel({ carrierId: ctx.carrier.id, channel: "sms", direction: "out", providerId: sid ?? null, counterparty: owner, body: note, data: { kind: "owner_alert", loadId: load.id } });
        }
        done.push(`${load.referenceNumber}: told the owner (${kind})`);
      }
      await addActivity(
        ctx.carrier.id,
        event({
          type: silent ? "escalation" : "check_call",
          loadId: load.id,
          message: silent ? `${first} hasn't answered` : `AI checked in with ${first}`,
          detail: `${load.referenceNumber} · ${text}`,
          severity: silent ? "warning" : "info",
        }),
      );
    } catch (error) {
      // Nothing went out: give the mark back so the next run tries again.
      console.error("[checkins] failed", load.id, kind, error);
      await releaseMark(ctx.carrier.id, load.id, kind);
    }
  }
  return done;
}
