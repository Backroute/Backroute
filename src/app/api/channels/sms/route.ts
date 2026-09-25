import { after } from "next/server";
import { aiConfigured } from "@/lib/ai/server";
import { dbConfigured, driverByPhone, driverThread, loadContext, logChannel, save, saveDriverMessage, carrierById } from "@/lib/agent/db";
import { driverTurn, passToOwner, uid } from "@/lib/agent/dispatcher";
import { readTwilioWebhook, sendSms, twiml, twilioConfigured, xml } from "@/lib/channels/twilio";
import { PASSED_ON_TEXT, SMS_HELP, UNKNOWN_NUMBER } from "@/lib/channels/phrases";
import type { Item } from "@/lib/cloud/rows";
import type { Driver, DriverMessage } from "@/lib/types";

export const maxDuration = 60;

const STOP = new Set(["STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT"]);
const START = new Set(["START", "UNSTOP", "YES"]);
const HELP = new Set(["HELP", "INFO"]);

/**
 * A driver texted the dispatch number. Twilio gets an empty answer right away; the AI's reply goes out as its own
 * text a few seconds later, so a slow answer never makes Twilio retry.
 */
export async function POST(request: Request) {
  if (!twilioConfigured() || !dbConfigured()) return twiml();
  const { params, valid } = await readTwilioWebhook(request, "/api/channels/sms");
  if (!valid) return new Response("Invalid signature", { status: 403 });

  const from = params.From ?? "";
  const body = (params.Body ?? "").trim();
  const found = await driverByPhone(from);
  if (!found) return twiml(`<Message>${xml(UNKNOWN_NUMBER)}</Message>`);
  const { carrierId, driver } = found;

  const fresh = await logChannel({ carrierId, channel: "sms", direction: "in", providerId: params.MessageSid, driverId: driver.id, counterparty: from, body });
  if (!fresh) return twiml(); // Twilio retried a text we already have.

  const word = body.toUpperCase();
  if (STOP.has(word) || START.has(word)) {
    // Twilio blocks texts to a number that sent STOP and confirms it itself; this keeps the app in step.
    const updated: Driver = { ...driver, prefs: { ...driver.prefs, smsOptOut: STOP.has(word) } };
    await save("drivers", carrierId, updated as unknown as Item);
    return twiml();
  }
  if (HELP.has(word)) {
    const carrier = await carrierById(carrierId);
    return twiml(`<Message>${xml(SMS_HELP(carrier?.name ?? "your carrier"))}</Message>`);
  }

  const incoming: DriverMessage = { id: uid("dm"), driverId: driver.id, from: "driver", content: body, timestamp: new Date().toISOString(), channel: "sms" };
  await saveDriverMessage(carrierId, incoming);

  after(async () => {
    const ctx = await loadContext(carrierId);
    if (!ctx) return;
    const history = (await driverThread(carrierId, driver.id, 13))
      .filter((m) => m.id !== incoming.id)
      .map((m) => ({ from: m.from === "driver" ? ("them" as const) : ("ai" as const), text: m.content }));
    const result = aiConfigured() ? await driverTurn(ctx, driver, "sms", body, history) : { reply: "", effects: { done: [], failed: true } };
    const lang = driver.prefs?.language ?? "en";
    if (result.effects.failed) await passToOwner(ctx, { reason: `${driver.name} texted: "${body}"`, label: "I'll answer", source: "sms" });
    const text = result.reply || PASSED_ON_TEXT[lang];
    const sid = await sendSms(from, text).catch((e) => {
      console.error("[sms] send failed", e);
      return undefined;
    });
    await saveDriverMessage(carrierId, { id: uid("dm"), driverId: driver.id, from: "ai", content: text, timestamp: new Date().toISOString(), channel: "sms", ai: !result.effects.failed });
    await logChannel({ carrierId, channel: "sms", direction: "out", providerId: sid ?? null, driverId: driver.id, counterparty: from, body: text, data: { did: result.effects.done } });
  });
  return twiml();
}
