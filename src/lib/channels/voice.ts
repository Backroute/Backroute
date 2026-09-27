import "server-only";
import { forCarrier } from "../agent/scope";
import { aiConfigured } from "../ai/server";
import { brokerCallBack, carrierById, driverByPhone, loadContext, logChannel, ownerByPhone, threadWith, addActivity } from "../agent/db";
import { brokerCallBackOpening, brokerCallKey } from "../agent/broker-call";
import { toE164 } from "../cloud/phone";
import { deskOpening } from "./desk";
import { driverTurn, event, ownerTurn, passToOwner } from "../agent/dispatcher";
import { checkinText } from "../agent/checkins";
import type { CheckinKind, Driver, Lang } from "../types";
import { streamTwiml, realtimeFor } from "./realtime";
import { CHECKIN_CALL, DIDNT_HEAR, GOODBYE, GREETING, OWNER_GREETING, PASSED_ON_CALL } from "./phrases";
import { publicUrl, say, sayAndListen, twiml } from "./twilio";

/**
 * A driver calls the dispatch number and talks with the AI. Twilio turns their speech into text and reads the AI's
 * answers aloud, one turn per request: speak, listen, answer, listen again, until someone says goodbye.
 */

const callKey = (callSid: string) => `call:${callSid}`.toLowerCase();

export async function answerCall(request: Request, params: Record<string, string>) {
  const found = await driverByPhone(params.From ?? "");
  if (!found) return otherCaller(request, params);
  const { carrierId, driver } = found;
  const carrier = await carrierById(carrierId);
  const lang = driver.prefs?.language ?? "en";
  const first = driver.name.split(" ")[0];
  const greeting = GREETING[lang](first, carrier?.name ?? "your carrier");
  await logChannel({ carrierId, channel: "voice", direction: "out", providerId: `${params.CallSid}:greeting`, driverId: driver.id, counterparty: callKey(params.CallSid), body: greeting });
  await addActivity(carrierId, event({ type: "call_started", message: `${first} called the dispatch line`, detail: "AI dispatcher answered", severity: "info" }));
  if (realtimeFor(lang)) return streamTwiml({ kind: "driver", carrier: carrierId, ref: driver.id, callSid: params.CallSid, lang, opening: greeting });
  return twiml(sayAndListen(greeting, lang, publicUrl(request, "/api/channels/voice/turn")));
}

// On a call the AI placed (a check-in), the driver is the one being called.
const driverNumber = (params: Record<string, string>) => ((params.Direction ?? "").startsWith("outbound") ? params.To : params.From) ?? "";

/** A check-in call the AI placed has been picked up: say who's calling and why, then listen like any other call. */
export async function checkinCall(request: Request, params: Record<string, string>, loadId: string, kind: CheckinKind) {
  const found = await driverByPhone(driverNumber(params));
  if (!found) return twiml("<Hangup/>");
  const { carrierId, driver } = found;
  const ctx = await loadContext(carrierId);
  const load = ctx?.loads.find((l) => l.id === loadId);
  if (!ctx || !load) return twiml("<Hangup/>");
  const lang = driver.prefs?.language ?? "en";
  const opening = `${CHECKIN_CALL[lang](driver.name.split(" ")[0], ctx.carrier.name)} ${checkinText(kind, load, driver)}`;
  await logChannel({ carrierId, channel: "voice", direction: "out", providerId: `${params.CallSid}:greeting`, driverId: driver.id, counterparty: callKey(params.CallSid), body: opening, data: { kind: "checkin", checkin: kind, loadId } });
  if (realtimeFor(lang)) return streamTwiml({ kind: "driver", carrier: carrierId, ref: driver.id, callSid: params.CallSid, lang, opening });
  return twiml(sayAndListen(opening, lang, publicUrl(request, "/api/channels/voice/turn")));
}

export async function nextTurn(request: Request, params: Record<string, string>, missed: number) {
  const found = await driverByPhone(driverNumber(params));
  if (!found) return twiml("<Hangup/>");
  const { carrierId, driver } = found;
  const lang = driver.prefs?.language ?? "en";
  const turnUrl = publicUrl(request, "/api/channels/voice/turn");
  const said = (params.SpeechResult ?? "").trim();

  if (!said) {
    // One "didn't catch that", then goodbye.
    if (missed >= 1) return twiml(`${say(GOODBYE[lang], lang)}<Hangup/>`);
    return twiml(sayAndListen(DIDNT_HEAR[lang], lang, `${turnUrl}?missed=1`));
  }

  const answer = await driverCallReply(carrierId, driver, params.CallSid, said, { confidence: params.Confidence });
  return answer.hangUp ? twiml(`${say(answer.reply, lang)}<Hangup/>`) : twiml(sayAndListen(answer.reply, lang, turnUrl));
}

/** One turn of a driver's call, by either kind of call (turn-by-turn, or the voice server): logged, answered, acted on. */
export function driverCallReply(carrierId: string, driver: Driver, callSid: string, said: string, data: Record<string, unknown> = {}): Promise<{ reply: string; hangUp: boolean }> {
  return forCarrier(carrierId, () => driverCallAnswer(carrierId, driver, callSid, said, data));
}

async function driverCallAnswer(carrierId: string, driver: Driver, callSid: string, said: string, data: Record<string, unknown>): Promise<{ reply: string; hangUp: boolean }> {
  const lang = driver.prefs?.language ?? "en";
  const key = callKey(callSid);
  const earlier = await threadWith(carrierId, "voice", key, 16);
  await logChannel({ carrierId, channel: "voice", direction: "in", driverId: driver.id, counterparty: key, body: said, data });
  const ctx = await loadContext(carrierId);
  if (!ctx) return { reply: PASSED_ON_CALL[lang], hangUp: true };

  const history = earlier.map((m) => ({ from: m.direction === "in" ? ("them" as const) : ("ai" as const), text: m.body ?? "" }));
  const result = aiConfigured() ? await driverTurn(ctx, driver, "voice", said, history) : { reply: "", effects: { done: [], failed: true } };
  if (result.effects.failed) {
    await passToOwner(ctx, { reason: `${driver.name} called and said: "${said}". The AI couldn't answer (twice).`, label: "I'll call back", source: "voice", to: "support" });
    await logChannel({ carrierId, channel: "voice", direction: "out", driverId: driver.id, counterparty: key, body: PASSED_ON_CALL[lang] });
    return { reply: PASSED_ON_CALL[lang], hangUp: true };
  }
  await logChannel({ carrierId, channel: "voice", direction: "out", driverId: driver.id, counterparty: key, body: result.reply, data: { did: result.effects.done } });
  if (result.effects.done.length)
    await addActivity(carrierId, event({ type: "call_completed", message: `AI on the phone with ${driver.name.split(" ")[0]}`, detail: result.effects.done.join(" · "), severity: "info" }));
  return { reply: result.reply, hangUp: !!result.effects.hangUp };
}

// ─── Everyone else who calls the dispatch line ───────────────────────────────

/**
 * Not a driver: the owner (the AI answers from the fleet data), a broker calling back the number the AI called them
 * from (the call picks up about that load), or anyone else (the front desk: which carrier, then the load or a
 * message; lib/channels/desk). Nobody gets a recording and a hang-up.
 */
async function otherCaller(request: Request, params: Record<string, string>) {
  const from = params.From ?? "";
  const owner = await ownerByPhone(from);
  if (owner) {
    const lang = (owner.settings.ownerLanguage ?? "en") as Lang;
    const greeting = OWNER_GREETING[lang](owner.name);
    await logChannel({ carrierId: owner.id, channel: "voice", direction: "out", providerId: `${params.CallSid}:greeting`, counterparty: callKey(params.CallSid), body: greeting, data: { kind: "owner_call" } });
    if (realtimeFor(lang)) return streamTwiml({ kind: "owner", carrier: owner.id, ref: owner.id, callSid: params.CallSid, lang, opening: greeting });
    return twiml(sayAndListen(greeting, lang, publicUrl(request, "/api/channels/voice/owner/turn")));
  }
  const back = await brokerCallBack(toE164(from) ?? from);
  const ctx = back ? await loadContext(back.carrierId) : null;
  const load = ctx?.loads.find((l) => l.id === back?.loadId);
  if (ctx && load) {
    const opening = brokerCallBackOpening(ctx, load);
    await logChannel({ carrierId: ctx.carrier.id, channel: "voice", direction: "out", providerId: `${params.CallSid}:greeting`, counterparty: brokerCallKey(params.CallSid), body: opening, data: { kind: "broker_call", loadId: load.id, callback: true } });
    await addActivity(ctx.carrier.id, event({ type: "call_started", loadId: load.id, message: `${ctx.brokers.find((b) => b.id === load.brokerId)?.company ?? "A broker"} called back`, detail: `${load.referenceNumber} · AI dispatcher answered`, severity: "info" }));
    if (realtimeFor("en")) return streamTwiml({ kind: "broker", carrier: ctx.carrier.id, ref: load.id, callSid: params.CallSid, lang: "en", opening });
    return twiml(sayAndListen(opening, "en", publicUrl(request, `/api/channels/voice/broker/turn?carrier=${encodeURIComponent(ctx.carrier.id)}&load=${encodeURIComponent(load.id)}`)));
  }
  return deskOpening(request);
}

/** The owner's call, one turn at a time (Twilio's speech recognition). */
export async function ownerNextTurn(request: Request, params: Record<string, string>, missed: number) {
  const owner = await ownerByPhone(params.From ?? "");
  if (!owner) return twiml("<Hangup/>");
  const lang = (owner.settings.ownerLanguage ?? "en") as Lang;
  const turnUrl = publicUrl(request, "/api/channels/voice/owner/turn");
  const said = (params.SpeechResult ?? "").trim();
  if (!said) return missed >= 1 ? twiml(`${say(GOODBYE[lang], lang)}<Hangup/>`) : twiml(sayAndListen(DIDNT_HEAR[lang], lang, `${turnUrl}?missed=1`));
  const result = await ownerCallReply(owner.id, params.CallSid, said);
  return result.hangUp ? twiml(`${say(result.reply, lang)}<Hangup/>`) : twiml(sayAndListen(result.reply, lang, turnUrl));
}

/** One turn of the owner's call, by either kind of call (turn-by-turn, or the voice server): logged and answered. */
export function ownerCallReply(carrierId: string, callSid: string, said: string, data: Record<string, unknown> = {}): Promise<{ reply: string; hangUp: boolean }> {
  return forCarrier(carrierId, () => ownerCallAnswer(carrierId, callSid, said, data));
}

async function ownerCallAnswer(carrierId: string, callSid: string, said: string, data: Record<string, unknown>): Promise<{ reply: string; hangUp: boolean }> {
  const key = callKey(callSid);
  const earlier = await threadWith(carrierId, "voice", key, 16);
  await logChannel({ carrierId, channel: "voice", direction: "in", counterparty: key, body: said, data: { kind: "owner_call", ...data } });
  const ctx = await loadContext(carrierId);
  const lang = (ctx?.settings.ownerLanguage ?? "en") as Lang;
  const history = earlier.map((m) => ({ from: m.direction === "in" ? ("them" as const) : ("ai" as const), text: m.body ?? "" }));
  const result = ctx && aiConfigured() ? await ownerTurn(ctx, "voice", said, history) : { reply: "", effects: { done: [], failed: true } as { done: string[]; failed?: boolean; hangUp?: boolean } };
  if (result.effects.failed) {
    if (ctx) await passToOwner(ctx, { reason: `The owner called and said: "${said}". The AI couldn't answer.`, label: "Called back", source: "voice", to: "support" });
    return { reply: PASSED_ON_CALL[lang], hangUp: true };
  }
  await logChannel({ carrierId, channel: "voice", direction: "out", counterparty: key, body: result.reply, data: { kind: "owner_call" } });
  return { reply: result.reply, hangUp: !!result.effects.hangUp };
}
