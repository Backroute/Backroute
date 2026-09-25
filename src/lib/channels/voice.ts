import "server-only";
import { aiConfigured } from "../ai/server";
import { carrierById, driverByPhone, loadContext, logChannel, threadWith, addActivity } from "../agent/db";
import { driverTurn, event, passToOwner } from "../agent/dispatcher";
import { checkinText } from "../agent/checkins";
import type { CheckinKind } from "../types";
import { CHECKIN_CALL, DIDNT_HEAR, GOODBYE, GREETING, PASSED_ON_CALL, UNKNOWN_NUMBER } from "./phrases";
import { publicUrl, say, sayAndListen, twiml } from "./twilio";

/**
 * A driver calls the dispatch number and talks with the AI. Twilio turns their speech into text and reads the AI's
 * answers aloud, one turn per request: speak, listen, answer, listen again, until someone says goodbye.
 */

const callKey = (callSid: string) => `call:${callSid}`.toLowerCase();

export async function answerCall(request: Request, params: Record<string, string>) {
  const found = await driverByPhone(params.From ?? "");
  if (!found) return twiml(`${say(UNKNOWN_NUMBER, "en")}<Hangup/>`);
  const { carrierId, driver } = found;
  const carrier = await carrierById(carrierId);
  const lang = driver.prefs?.language ?? "en";
  const first = driver.name.split(" ")[0];
  const greeting = GREETING[lang](first, carrier?.name ?? "your carrier");
  await logChannel({ carrierId, channel: "voice", direction: "out", providerId: `${params.CallSid}:greeting`, driverId: driver.id, counterparty: callKey(params.CallSid), body: greeting });
  await addActivity(carrierId, event({ type: "call_started", message: `${first} called the dispatch line`, detail: "AI dispatcher answered", severity: "info" }));
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

  const key = callKey(params.CallSid);
  const earlier = await threadWith(carrierId, "voice", key, 16);
  await logChannel({ carrierId, channel: "voice", direction: "in", driverId: driver.id, counterparty: key, body: said, data: { confidence: params.Confidence } });
  const ctx = await loadContext(carrierId);
  if (!ctx) return twiml(`${say(PASSED_ON_CALL[lang], lang)}<Hangup/>`);

  const history = earlier.map((m) => ({ from: m.direction === "in" ? ("them" as const) : ("ai" as const), text: m.body ?? "" }));
  const result = aiConfigured() ? await driverTurn(ctx, driver, "voice", said, history) : { reply: "", effects: { done: [], failed: true } };
  if (result.effects.failed) {
    await passToOwner(ctx, { reason: `${driver.name} called and said: "${said}"`, label: "I'll call back", source: "voice" });
    await logChannel({ carrierId, channel: "voice", direction: "out", driverId: driver.id, counterparty: key, body: PASSED_ON_CALL[lang] });
    return twiml(`${say(PASSED_ON_CALL[lang], lang)}<Hangup/>`);
  }
  await logChannel({ carrierId, channel: "voice", direction: "out", driverId: driver.id, counterparty: key, body: result.reply, data: { did: result.effects.done } });
  if (result.effects.done.length)
    await addActivity(carrierId, event({ type: "call_completed", message: `AI on the phone with ${driver.name.split(" ")[0]}`, detail: result.effects.done.join(" · "), severity: "info" }));
  return result.effects.hangUp ? twiml(`${say(result.reply, lang)}<Hangup/>`) : twiml(sayAndListen(result.reply, lang, turnUrl));
}
