import "server-only";
import { z } from "zod";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { AI_MODEL, FALLBACK, aiConfigured, claude } from "../ai/server";
import { callTo, canCall, canText, sandboxed, textTo } from "../channels/out";
import { throughPhoneTree, WANT, type CallReply } from "../channels/ivr";
import { absoluteUrl } from "../channels/twilio";
import { toE164 } from "../cloud/phone";
import type { Item } from "../cloud/rows";
import { formatAtStop, hourAtStop, isoToStopLocal, stopLocalToIso, zoneFor } from "../stop-time";
import type { FacilityAppointment, Load } from "../types";
import { addActivity, logChannel, save, saveDriverMessage, threadWith, type CarrierContext } from "./db";
import { event, passToOwner, tellOwner, uid } from "./dispatcher";
import { billTo } from "./paperwork";
import { sendOrQueue } from "./outbox";
import { forCarrier } from "./scope";
import * as mail from "./templates";

/**
 * Dock appointments, the phone work a dispatcher does between booking and delivery: a rate con that says "call to
 * schedule" gets a call to the shipper or receiver to book a time, and a truck that will miss its appointment gets a
 * call to move it before it's missed. The time they give goes on the load, the driver is texted it and the broker
 * hears. A facility that won't set it by phone (the broker has to, or it's their web portal) goes to the broker and
 * the support team. Calls go out in the facility's working hours, up to three tries.
 */

export type Stop = "pickup" | "delivery";
const OPEN = new Set<Load["stage"]>(["booked", "rate_confirmed", "dispatched", "at_pickup", "in_transit"]);
const MAX_TRIES = 3;
const RETRY_MS = 60 * 60_000;
/** A call with no answer read back after this long is over (no one picked up, or it dropped). */
const CALL_OVER_MS = 20 * 60_000;

const phoneOf = (load: Load, stop: Stop) => (stop === "pickup" ? load.rateConReading?.shipperPhone : load.rateConReading?.receiverPhone) ?? null;
const nameOf = (load: Load, stop: Stop) => (stop === "pickup" ? load.rateConReading?.shipper : load.rateConReading?.receiver) ?? (stop === "pickup" ? "the shipper" : "the receiver");
const stateOf = (load: Load, stop: Stop) => (stop === "pickup" ? load.lane.originState : load.lane.destState);
const dueOf = (load: Load, stop: Stop) => (stop === "pickup" ? load.pickupAt : load.deliveryAt);
const driverOf = (ctx: CarrierContext, load: Load) => ctx.drivers.find((d) => d.id === ctx.trucks.find((t) => t.id === load.truckId)?.driverId);
/** Scheduling desks: 7 in the morning to 4 in the afternoon, their time, weekdays and Saturday. */
const deskOpen = (state: string, now: number) => {
  const h = hourAtStop(state, now);
  const day = new Intl.DateTimeFormat("en-US", { timeZone: zoneFor(state), weekday: "short" }).format(new Date(now));
  return h >= 7 && h < 16 && day !== "Sun";
};

async function saveAppt(ctx: CarrierContext, load: Load, stop: Stop, appt: FacilityAppointment, extra: Partial<Load> = {}): Promise<Load> {
  const current = ctx.loads.find((l) => l.id === load.id) ?? load;
  const next: Load = { ...current, ...extra, appointments: { ...current.appointments, [stop]: appt }, updatedAt: new Date().toISOString() };
  await save("loads", ctx.carrier.id, next as unknown as Item);
  ctx.loads = ctx.loads.map((l) => (l.id === load.id ? next : l));
  return next;
}

/**
 * A stop needs an appointment booked, or moved to `eta`. Calls now when the desk is open (the rounds call later
 * otherwise). No number for the facility: the support team calls. Returns what happened, for the log.
 */
export async function needAppointment(ctx: CarrierContext, load: Load, stop: Stop, purpose: "book" | "move", eta?: number, now = Date.now()): Promise<string> {
  const current = ctx.loads.find((l) => l.id === load.id) ?? load;
  const had = current.appointments?.[stop];
  if (had && had.status !== "set" && had.status !== "failed" && had.purpose === purpose) return `${stop} appointment already being worked`;
  const appt: FacilityAppointment = { purpose, status: "needed", tries: 0, ...(eta ? { eta: new Date(eta).toISOString() } : {}) };
  const saved = await saveAppt(ctx, current, stop, appt);
  if (!toE164(phoneOf(saved, stop) ?? "")) return giveUp(ctx, saved, stop, "no phone number for the facility on the rate con");
  if (deskOpen(stateOf(saved, stop), now) && (await callFacility(ctx, saved, stop))) return `calling ${nameOf(saved, stop)} to ${purpose} the ${stop} appointment`;
  return `${stop} appointment to ${purpose}: calling when ${nameOf(saved, stop)} opens`;
}

/**
 * The facility can't be reached (no number, three calls with no time) or won't set it by phone: the broker is asked
 * to set it and send the time, the way a dispatcher hands it back to them. Their answer is read off their email
 * (lib/agent/email), and the AI reminds them once if it doesn't come. Only when there's no broker email at all does
 * the owner hear.
 */
async function giveUp(ctx: CarrierContext, load: Load, stop: Stop, why: string): Promise<string> {
  const appt = load.appointments?.[stop];
  if (!appt) return why;
  const email = billTo(ctx, load);
  const state = stateOf(load, stop);
  const saved = await saveAppt(ctx, load, stop, { ...appt, status: email ? "broker" : "failed", note: why, brokerAskedAt: new Date().toISOString() });
  if (!email) {
    await passToOwner(ctx, { reason: `${load.referenceNumber}: the AI couldn't ${appt.purpose === "move" ? "move" : "book"} the ${stop} appointment with ${nameOf(load, stop)} (${why}), and there's no broker email to ask. ${phoneOf(load, stop) ? `Their number: ${phoneOf(load, stop)}.` : ""}`, loadId: load.id, label: "Set", source: "voice", to: "owner" });
    return `${stop} appointment: owner told (${why})`;
  }
  const broker = ctx.brokers.find((b) => b.id === load.brokerId);
  await sendOrQueue(ctx, {
    purpose: "ack",
    to: email,
    toName: broker?.contact || undefined,
    subject: mail.subjectFor(saved, "Appointment"),
    body: `Hi${broker?.contact ? ` ${broker.contact}` : ""},\n\n${/they said/.test(why) ? `We called ${nameOf(load, stop)} about the ${stop} appointment on ${load.referenceNumber} and they said it has to come from you.` : `We couldn't reach ${nameOf(load, stop)} to ${appt.purpose === "move" ? "move" : "book"} the ${stop} appointment on ${load.referenceNumber}.`} Can you ${appt.purpose === "move" ? `move it to ${appt.eta ? formatAtStop(appt.eta, state) : "the next time open"} or later` : "set it"} and send us the time?\n\nThanks,\n${ctx.carrier.name}`,
    loadId: load.id,
    withinRules: true,
    why: `Ask ${broker?.company ?? "the broker"} to set the ${stop} appointment on ${load.referenceNumber}?`,
  });
  await tellOwner(ctx, { reason: `${load.referenceNumber}: ${nameOf(load, stop)} ${/they said/.test(why) ? "wants the broker to set" : "couldn't be reached about"} the ${stop} appointment, so the AI asked ${broker?.company ?? "the broker"} to set it.`, loadId: load.id, source: "voice" });
  return `${stop} appointment: broker asked (${why})`;
}

/** Phones the facility; false when the call can't go out. */
async function callFacility(ctx: CarrierContext, load: Load, stop: Stop): Promise<boolean> {
  const to = toE164(phoneOf(load, stop) ?? "");
  const appt = load.appointments?.[stop];
  const url = absoluteUrl(`/api/channels/voice/facility?carrier=${encodeURIComponent(ctx.carrier.id)}&load=${encodeURIComponent(load.id)}&stop=${stop}`);
  if (!to || !appt || ctx.settings.paused || (!url && !sandboxed(ctx.carrier)) || !canCall(ctx.carrier)) return false;
  const saved = await saveAppt(ctx, load, stop, { ...appt, status: "calling", tries: appt.tries + 1, lastCallAt: new Date().toISOString() });
  const sid = await callTo(ctx.carrier, to, url, { kind: "facility_call", ref: `${load.id}:${stop}`, opening: facilityOpening(ctx, saved, stop), machineDetection: true });
  await logChannel({ carrierId: ctx.carrier.id, channel: "voice", direction: "out", providerId: sid ? `${sid}:dial` : null, counterparty: to, body: `Calling ${nameOf(load, stop)} to ${appt.purpose} the ${stop} appointment on ${load.referenceNumber}`, data: { kind: "facility_call", loadId: load.id, stop } });
  return true;
}

/** What the AI says when the facility picks up. */
export function facilityOpening(ctx: CarrierContext, load: Load, stop: Stop): string {
  const appt = load.appointments?.[stop];
  const state = stateOf(load, stop);
  const broker = ctx.brokers.find((b) => b.id === load.brokerId);
  const who = `Hi, this is the AI dispatcher for ${ctx.carrier.name}, a trucking company. This call is transcribed.`;
  const ref = `load ${load.referenceNumber}${broker ? ` with ${broker.company}` : ""}`;
  const due = dueOf(load, stop);
  if (appt?.purpose === "move") {
    const eta = appt.eta ? formatAtStop(appt.eta, state) : "later than planned";
    return `${who} We have a ${stop} appointment${due ? ` at ${formatAtStop(due, state)}` : ""} for ${ref}, and our truck is running behind: it'll get there around ${eta}. Can you move us to that time or the next one open after it?`;
  }
  const window = stop === "pickup" ? load.pickupWindow : load.deliveryWindow;
  return `${who} I'm calling to book a ${stop} appointment for ${ref}, ${stop === "pickup" ? "picking up" : "delivering"} ${due ? formatAtStop(due, state) : window}. What time can you give us?`;
}

export const FACILITY_VOICEMAIL = (ctx: CarrierContext, load: Load) => `Hi, this is the AI dispatcher for ${ctx.carrier.name}, calling about an appointment for load ${load.referenceNumber}. We'll call back shortly. Thanks.`;

const FacilityAnswer = z.object({
  outcome: z.enum(["set", "no", "question", "unclear"]),
  time: z.string().nullable().describe("The appointment date and time they gave or confirmed, as YYYY-MM-DDTHH:mm in the facility's local time; null if they didn't give one."),
  confirmation: z.string().nullable().describe("A confirmation or appointment number they gave, as said; null if none."),
  asks: z.string().nullable().describe("What they asked for before they can set it (a PO number, the weight, pallet count...), in a few words; null if nothing."),
});
type Answer = z.infer<typeof FacilityAnswer>;

async function readAnswer(said: string, today: string): Promise<Answer> {
  const none: Answer = { outcome: "unclear", time: null, confirmation: null, asks: null };
  if (!aiConfigured()) return none;
  try {
    const response = await claude().beta.messages.parse({
      model: AI_MODEL,
      max_tokens: 500,
      ...FALLBACK,
      output_config: { effort: "low", format: betaZodOutputFormat(FacilityAnswer) },
      system: `You read what a shipping or receiving facility's scheduler said on the phone when a trucking company called to book or move a dock appointment. Today at the facility is ${today}. outcome: set when they gave or confirmed a specific date and time; no when they can't or won't (the broker or shipper has to set it, it's done online, nothing open, call back another day); question when they asked for something first (a PO or load number, the weight, pallets); unclear for anything else. Only what they actually said.`,
      messages: [{ role: "user", content: said }],
    });
    return response.parsed_output ?? none;
  } catch (e) {
    console.error("[appointments] couldn't read the facility's answer", e);
    return none;
  }
}

/** The facts a scheduler asks for, from the load and the rate con. */
function facts(ctx: CarrierContext, load: Load): string {
  const r = load.rateConReading;
  const broker = ctx.brokers.find((b) => b.id === load.brokerId);
  const bits = [
    `It's load ${load.referenceNumber}${broker ? ` from ${broker.company}` : ""}`,
    load.commodity ? load.commodity : null,
    load.weight ? `${load.weight.toLocaleString("en-US")} pounds` : null,
    r?.equipment ? `on a ${r.equipment}` : `on a ${load.equipmentType.toLowerCase()}`,
  ].filter(Boolean);
  return `${bits.join(", ")}. The carrier is ${ctx.carrier.name}${ctx.carrier.mc ? `, MC ${String(ctx.carrier.mc).replace(/^mc\s*/i, "")}` : ""}.`;
}

/** What the facility said. Returns the words to say back and whether the call is over. */
async function facilityCallTurn(ctx: CarrierContext, load: Load, stop: Stop, said: string, asked: number): Promise<{ reply: string; hangUp: boolean }> {
  const appt = load.appointments?.[stop];
  if (!appt || appt.status === "set") return { reply: "Thanks, we're all set.", hangUp: true };
  const state = stateOf(load, stop);
  const answer = await readAnswer(said, isoToStopLocal(new Date().toISOString(), state).slice(0, 10));
  if (answer.outcome === "set" && answer.time) {
    const iso = stopLocalToIso(answer.time, state);
    if (iso) {
      // Too early for where the truck really is: ask for later, once.
      if (appt.purpose === "move" && appt.eta && Date.parse(iso) < Date.parse(appt.eta) - 30 * 60_000 && asked < 5)
        return { reply: `That's a little early for us: the truck gets there around ${formatAtStop(appt.eta, state)}. Do you have anything after that?`, hangUp: false };
      await setAppointment(ctx, load, stop, iso, answer.confirmation);
      return { reply: `Perfect, so that's ${formatAtStop(iso, state)}${answer.confirmation ? `, confirmation ${answer.confirmation}` : ""}. I'll let our driver know. Thank you!`, hangUp: true };
    }
  }
  if (answer.outcome === "question" && asked < 5) return { reply: `Sure. ${facts(ctx, load)}${answer.asks && /\bpo\b|purchase order|pickup number|reference/i.test(answer.asks) ? ` The PO or pickup number should be on the broker's paperwork under ${load.referenceNumber}.` : ""} What time can you give us?`, hangUp: false };
  if (answer.outcome === "no") {
    await cantByPhone(ctx, load, stop, said);
    return { reply: "Understood. We'll have the broker set it up. Thanks for your help.", hangUp: true };
  }
  if (asked >= 5) return { reply: "No problem, we'll call back a little later. Thanks.", hangUp: true };
  return { reply: "Sorry, just to be sure: what date and time can you give us?", hangUp: false };
}

/** The facility gave a time: on the load, to the driver, to the broker. */
export async function setAppointment(ctx: CarrierContext, load: Load, stop: Stop, iso: string, confirmation: string | null, by: "facility" | "broker" | "portal" = "facility") {
  const state = stateOf(load, stop);
  const when = formatAtStop(iso, state);
  const current = ctx.loads.find((l) => l.id === load.id) ?? load;
  const appt = current.appointments?.[stop] ?? { purpose: "book" as const, tries: 1, status: "calling" as const };
  const note = `${stop === "pickup" ? "Pickup" : "Delivery"} appointment ${when}${confirmation ? `, confirmation ${confirmation}` : ""}`;
  const saved = await saveAppt(ctx, current, stop, { ...appt, status: "set", at: iso, ...(confirmation ? { confirmation } : {}) }, stop === "pickup" ? { pickupAt: iso, pickupWindow: when, appointmentNote: note } : { deliveryAt: iso, deliveryWindow: when, appointmentNote: note });
  await addActivity(ctx.carrier.id, event({ type: "check_call", loadId: load.id, message: `${stop === "pickup" ? "Pickup" : "Delivery"} appointment ${appt.purpose === "move" ? "moved" : "set"} for ${saved.referenceNumber}`, detail: `${when}${confirmation ? ` · confirmation ${confirmation}` : ""} · ${by === "broker" ? "set by the broker" : by === "portal" ? "booked on the scheduling website" : `by phone with ${nameOf(saved, stop)}`}`, severity: "success" }));
  const driver = driverOf(ctx, saved);
  const to = driver ? toE164(driver.phone) : null;
  if (driver && to && !driver.prefs?.smsOptOut && canText(ctx.carrier)) {
    const body = `${driver.name.split(" ")[0]}, ${saved.referenceNumber} ${stop} appointment ${appt.purpose === "move" ? "moved to" : "is"} ${when} at ${nameOf(saved, stop)}${confirmation ? `, confirmation ${confirmation}` : ""}.`;
    const sid = await textTo(ctx.carrier, to, body);
    await saveDriverMessage(ctx.carrier.id, { id: uid("dm"), driverId: driver.id, from: "ai", content: body, timestamp: new Date().toISOString(), channel: "sms", ai: true });
    await logChannel({ carrierId: ctx.carrier.id, channel: "sms", direction: "out", providerId: sid, driverId: driver.id, counterparty: to, body, data: { kind: "appointment_set", loadId: load.id } });
  }
  const broker = ctx.brokers.find((b) => b.id === saved.brokerId);
  const email = billTo(ctx, saved);
  // The broker set it themselves: they don't need telling.
  if (email && by !== "broker")
    await sendOrQueue(ctx, {
      purpose: "ack",
      to: email,
      toName: broker?.contact || undefined,
      subject: mail.subjectFor(saved, "Appointment"),
      body: `Hi${broker?.contact ? ` ${broker.contact}` : ""},\n\n${appt.purpose === "move" ? `We moved the ${stop} appointment on ${saved.referenceNumber} with ${nameOf(saved, stop)}` : `We booked the ${stop} appointment on ${saved.referenceNumber} with ${nameOf(saved, stop)}`}: ${when}${confirmation ? `, confirmation ${confirmation}` : ""}.\n\nThanks,\n${ctx.carrier.name}`,
      loadId: saved.id,
      withinRules: true,
      why: `Tell ${broker?.company ?? "the broker"} the ${stop} appointment on ${saved.referenceNumber} is ${when}?`,
    });
}

/** The facility won't set it by phone: the broker is asked to. */
async function cantByPhone(ctx: CarrierContext, load: Load, stop: Stop, said: string) {
  await giveUp(ctx, load, stop, `they said: "${said.slice(0, 160)}"`);
}

/** A call ended without a time (voicemail, no answer, hung up): tried again later, or support after three tries. */
export async function facilityMissed(ctx: CarrierContext, load: Load, stop: Stop) {
  const appt = load.appointments?.[stop];
  if (!appt || appt.status !== "calling") return;
  if (appt.tries >= MAX_TRIES) await giveUp(ctx, load, stop, `no time after ${appt.tries} calls`);
  else await saveAppt(ctx, load, stop, { ...appt, status: "needed" });
}

/**
 * Every round: rate cons that say to call for an appointment get one booked; calls that ended without a time are
 * tried again after an hour, in working hours; three tries and support calls.
 */
export async function appointmentRounds(ctx: CarrierContext, now: number): Promise<string[]> {
  const done: string[] = [];
  for (const load of [...ctx.loads]) {
    if (!OPEN.has(load.stage) || load.imported) continue;
    const need = load.rateConReading?.appointmentNeeded;
    for (const stop of ["pickup", "delivery"] as Stop[]) {
      if (stop === "pickup" && !["booked", "rate_confirmed", "dispatched"].includes(load.stage)) continue;
      const current = ctx.loads.find((l) => l.id === load.id) ?? load;
      const appt = current.appointments?.[stop];
      if (!appt && (need === stop || need === "both")) {
        done.push(`${load.referenceNumber}: ${await needAppointment(ctx, current, stop, "book", undefined, now)}`);
        continue;
      }
      if (!appt) continue;
      // Asked the broker two hours ago and no time yet: one reminder.
      if (appt.status === "broker" && appt.brokerAskedAt && !appt.brokerRemindedAt && now - Date.parse(appt.brokerAskedAt) > 2 * 3600_000) {
        const email = billTo(ctx, current);
        if (email) {
          await saveAppt(ctx, current, stop, { ...appt, brokerRemindedAt: new Date(now).toISOString() });
          await sendOrQueue(ctx, { purpose: "ack", to: email, subject: mail.subjectFor(current, "Appointment"), body: `Hi,\n\nFollowing up on the ${stop} appointment for ${current.referenceNumber}: can you send us the time when it's set?\n\nThanks,\n${ctx.carrier.name}`, loadId: current.id, withinRules: true, why: `Remind the broker about the ${stop} appointment on ${current.referenceNumber}?` });
          done.push(`${load.referenceNumber}: reminded the broker about the ${stop} appointment`);
        }
        continue;
      }
      if (appt.status === "calling" && appt.lastCallAt && now - Date.parse(appt.lastCallAt) > CALL_OVER_MS) await facilityMissed(ctx, current, stop);
      const fresh = (ctx.loads.find((l) => l.id === load.id) ?? current).appointments?.[stop];
      if (fresh?.status !== "needed") continue;
      if (fresh.tries >= MAX_TRIES) {
        done.push(`${load.referenceNumber}: ${await giveUp(ctx, current, stop, `no time after ${fresh.tries} calls`)}`);
        continue;
      }
      if (fresh.lastCallAt && now - Date.parse(fresh.lastCallAt) < RETRY_MS) continue;
      if (!deskOpen(stateOf(current, stop), now)) continue;
      if (await callFacility(ctx, ctx.loads.find((l) => l.id === load.id) ?? current, stop)) done.push(`${load.referenceNumber}: calling ${nameOf(current, stop)} about the ${stop} appointment`);
    }
  }
  return done;
}

// ─── One turn of the call ────────────────────────────────────────────────────

export function facilityCallReply(ctx: CarrierContext, load: Load, stop: Stop, callSid: string, said: string): Promise<CallReply> {
  return forCarrier(ctx.carrier.id, () => facilityCallAnswer(ctx, load, stop, callSid, said));
}

async function facilityCallAnswer(ctx: CarrierContext, load: Load, stop: Stop, callSid: string, said: string): Promise<CallReply> {
  const key = `facility:${callSid}`;
  const earlier = await threadWith(ctx.carrier.id, "voice", key, 40);
  const log = (direction: "in" | "out", body: string, extra: Record<string, unknown> = {}) => logChannel({ carrierId: ctx.carrier.id, channel: "voice", direction, counterparty: key, body, data: { kind: "facility_call", loadId: load.id, stop, ...extra } });
  const tree = await throughPhoneTree(said, WANT.facility, earlier, log);
  if (tree) {
    if (tree.hangUp) await facilityMissed(ctx, load, stop);
    return tree;
  }
  await log("in", said);
  const asked = earlier.filter((m) => m.direction === "out" && !(m.data as Record<string, unknown> | null)?.pressed).length;
  const result = await facilityCallTurn(ctx, load, stop, said, asked);
  await log("out", result.reply);
  if (result.hangUp) await facilityMissed(ctx, ctx.loads.find((l) => l.id === load.id) ?? load, stop);
  return result;
}
