import "server-only";
import { toE164 } from "../cloud/phone";
import { LOAD_CANCELLED, NEW_LOAD_SPOKEN } from "../channels/phrases";
import { callTo, canCall } from "../channels/out";
import { absoluteUrl } from "../channels/twilio";
import { hourAtStop } from "../stop-time";
import type { Driver, Load } from "../types";
import { claimMark, heardFrom, logChannel, marksFor, releaseMark, setMarkData, type CarrierContext } from "./db";

/**
 * Calls to drivers when their plans change, the way a dispatcher picks up the phone instead of leaving it to a text:
 * a new load booked for them, a load cancelled under them, an appointment moved. The text with every detail still
 * goes out; the call is so they hear it. A call nobody picks up is tried again three minutes later, up to three times,
 * unless the driver has called or texted back since. Voicemail gets a short message pointing to the text.
 */

export type UpdateKind = "next_load" | "cancelled" | "appointment";
export const UPDATE_KINDS: UpdateKind[] = ["next_load", "cancelled", "appointment"];

export const CALL_TRIES = 3;
export const CALL_GAP_MS = 3 * 60_000;
/** One call about new loads at a time: a plan of several booked together is one call. */
const SAME_PLAN_MS = 15 * 60_000;

const markKind = (kind: UpdateKind) => `call_${kind}`;

interface CallMark {
  tries: number;
  at: string;
  answered?: boolean;
  /** What the call says (the appointment's new time, for instance), so a call back says the same. */
  said?: string;
}

/** What the call says after "Hi, it's dispatch", in the driver's language. */
export function updateCallText(kind: UpdateKind, load: Load, driver: Driver, said?: string): string {
  const lang = driver.prefs?.language ?? "en";
  if (said) return said;
  if (kind === "cancelled") return LOAD_CANCELLED[lang](load.referenceNumber, `${load.lane.origin}, ${load.lane.originState}`);
  return NEW_LOAD_SPOKEN[lang]({
    ref: load.referenceNumber,
    from: `${load.lane.origin}, ${load.lane.originState}`,
    to: `${load.lane.destination}, ${load.lane.destState}`,
    pickup: load.pickupWindow,
    delivery: load.deliveryWindow,
  });
}

function driverFor(ctx: Pick<CarrierContext, "trucks" | "drivers">, load: Load): Driver | undefined {
  const truck = ctx.trucks.find((t) => t.id === load.truckId);
  return ctx.drivers.find((d) => d.id === truck?.driverId);
}

/** Whether the driver can be called about this now: a number, calls switched on, and not before the hour they set. */
function callable(ctx: CarrierContext, driver: Driver | undefined, load: Load, kind: UpdateKind, now: number): driver is Driver {
  if (!driver || !canCall(ctx.carrier) || !toE164(driver.phone)) return false;
  // "New load options: just a text" covers new loads; changes to a load they're on still get a call.
  if (kind === "next_load" && driver.prefs?.newLoads === "text") return false;
  const state = kind === "appointment" ? load.lane.destState : load.lane.originState;
  return driver.prefs?.noCallsBefore === undefined || hourAtStop(state, now) >= driver.prefs.noCallsBefore;
}

async function dial(ctx: CarrierContext, load: Load, driver: Driver, kind: UpdateKind, text: string): Promise<boolean> {
  const to = toE164(driver.phone)!;
  const url = absoluteUrl(`/api/channels/voice/update?load=${encodeURIComponent(load.id)}&kind=${kind}`);
  try {
    const sid = await callTo(ctx.carrier, to, url, { kind: "update", ref: `${load.id}:${kind}`, opening: text, machineDetection: true });
    await logChannel({ carrierId: ctx.carrier.id, channel: "voice", direction: "out", providerId: sid ? `${sid}:dial` : null, driverId: driver.id, counterparty: to, body: `Calling ${driver.name.split(" ")[0]}: ${text}`, data: { kind: "update_call", update: kind, loadId: load.id } });
    return true;
  } catch (e) {
    console.error("[driver-calls] call failed", load.id, kind, e);
    return false;
  }
}

/**
 * Rings the driver about a change. `said` replaces the usual words (an appointment's new time). Returns whether a
 * call went out. A new load already called about for this truck in the last 15 minutes (a plan booked together) isn't
 * called about again.
 */
export async function callDriverAbout(ctx: CarrierContext, load: Load, kind: UpdateKind, opts: { said?: string; now?: number } = {}): Promise<boolean> {
  const now = opts.now ?? Date.now();
  const driver = driverFor(ctx, load);
  if (!callable(ctx, driver, load, kind, now)) return false;
  if (kind === "next_load") {
    const marks = await marksFor(ctx.carrier.id);
    // Loads booked with it for the same truck that the driver hasn't picked up yet (a plan, a trip of partials).
    const sameTruck = new Set(ctx.loads.filter((l) => l.truckId === load.truckId && l.id !== load.id && ["rate_confirmed", "booked", "dispatched"].includes(l.stage)).map((l) => l.id));
    for (const [key, m] of marks) {
      const [loadId, k] = key.split(":");
      if (k === markKind("next_load") && sameTruck.has(loadId) && now - Date.parse(m.at) < SAME_PLAN_MS) return false;
    }
  }
  // A change replaces the one before it (an appointment moved twice): the latest is what the driver hears.
  if (kind === "appointment") await releaseMark(ctx.carrier.id, load.id, markKind(kind));
  const mark: CallMark = { tries: 1, at: new Date(now).toISOString(), ...(opts.said ? { said: opts.said } : {}) };
  if (!(await claimMark(ctx.carrier.id, load.id, markKind(kind), mark as unknown as Record<string, unknown>))) return false;
  const ok = await dial(ctx, load, driver, kind, updateCallText(kind, load, driver, opts.said));
  if (!ok) await releaseMark(ctx.carrier.id, load.id, markKind(kind));
  return ok;
}

/** The call was picked up by a person: no more calling back about it. */
export async function markAnswered(carrierId: string, loadId: string, kind: UpdateKind, marks: Map<string, { at: string; data: Record<string, unknown> }>) {
  const m = marks.get(`${loadId}:${markKind(kind)}`);
  if (m) await setMarkData(carrierId, loadId, markKind(kind), { ...m.data, answered: true });
}

/** The words a call back says, from what the first call said. */
export function saidBefore(marks: Map<string, { at: string; data: Record<string, unknown> }>, loadId: string, kind: UpdateKind): string | undefined {
  return (marks.get(`${loadId}:${markKind(kind)}`)?.data as Partial<CallMark> | undefined)?.said;
}

/** The rounds: calls about changes nobody picked up, tried again three minutes apart, three times in all. */
export async function callBacks(ctx: CarrierContext, marks: Map<string, { at: string; data: Record<string, unknown> }>, now: number): Promise<string[]> {
  const done: string[] = [];
  for (const [key, m] of marks) {
    const [loadId, k] = key.split(":");
    const kind = UPDATE_KINDS.find((x) => markKind(x) === k);
    if (!kind) continue;
    const data = m.data as Partial<CallMark>;
    const tries = data.tries ?? 1;
    const last = Date.parse(data.at ?? m.at);
    if (data.answered || tries >= CALL_TRIES || now - last < CALL_GAP_MS) continue;
    const load = ctx.loads.find((l) => l.id === loadId);
    const driver = load ? driverFor(ctx, load) : undefined;
    // Nothing to call about any more (the load's gone, or it's over), or the driver got back to us.
    if (!load || !driver || (kind !== "cancelled" && ["cancelled", "declined", "delivered"].includes(load.stage))) continue;
    if (await heardFrom(ctx.carrier.id, driver.id, data.at ?? m.at)) {
      await setMarkData(ctx.carrier.id, loadId, k, { ...data, answered: true });
      continue;
    }
    if (!callable(ctx, driver, load, kind, now)) continue;
    await setMarkData(ctx.carrier.id, loadId, k, { ...data, tries: tries + 1, at: new Date(now).toISOString() });
    if (await dial(ctx, load, driver, kind, updateCallText(kind, load, driver, data.said))) done.push(`${load.referenceNumber}: called ${driver.name.split(" ")[0]} back (${kind.replace("_", " ")}, try ${tries + 1})`);
  }
  return done;
}
