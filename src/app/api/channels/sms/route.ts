import { after } from "next/server";
import { aiConfigured } from "@/lib/ai/server";
import { dbConfigured, driverByPhone, driverThread, loadContext, logChannel, ownerByPhone, save, saveDriverMessage, carrierById, threadWith } from "@/lib/agent/db";
import { driverTurn, ownerTurn, passToOwner, uid } from "@/lib/agent/dispatcher";
import { readTwilioWebhook, sendSms, twiml, twilioConfigured, xml } from "@/lib/channels/twilio";
import { PASSED_ON_TEXT, SMS_HELP, UNKNOWN_NUMBER } from "@/lib/channels/phrases";
import type { Item } from "@/lib/cloud/rows";
import { driverPhotos } from "@/lib/agent/photos";
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
  if (!found) {
    // The owner texting the line gets the AI dispatcher, answering from the fleet data.
    const owner = await ownerByPhone(from);
    if (!owner) return twiml(`<Message>${xml(UNKNOWN_NUMBER)}</Message>`);
    const fresh = await logChannel({ carrierId: owner.id, channel: "sms", direction: "in", providerId: params.MessageSid, counterparty: from, body, data: { kind: "owner_text" } });
    if (!fresh) return twiml();
    after(async () => {
      const ctx = await loadContext(owner.id);
      if (!ctx) return;
      const history = (await threadWith(owner.id, "sms", from, 12)).filter((m, i, all) => !(i === all.length - 1 && m.direction === "in" && m.body === body)).map((m) => ({ from: m.direction === "in" ? ("them" as const) : ("ai" as const), text: m.body ?? "" }));
      const result = aiConfigured() ? await ownerTurn(ctx, "sms", body, history) : { reply: "", effects: { done: [], failed: true } };
      if (result.effects.failed) await passToOwner(ctx, { reason: `The owner texted: "${body}". The AI couldn't answer.`, label: "Answered", source: "sms", to: "support" });
      const text = result.reply || PASSED_ON_TEXT[ctx.settings.ownerLanguage ?? "en"];
      const sid = await sendSms(from, text).catch((e) => {
        console.error("[sms] send failed", e);
        return null;
      });
      await logChannel({ carrierId: owner.id, channel: "sms", direction: "out", providerId: sid ?? null, counterparty: from, body: text, data: { kind: "owner_text" } });
    });
    return twiml();
  }
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

  const media = Array.from({ length: Math.min(Number(params.NumMedia ?? 0) || 0, 5) }, (_, i) => ({ url: params[`MediaUrl${i}`] ?? "" })).filter((m) => m.url);
  const incoming: DriverMessage = { id: uid("dm"), driverId: driver.id, from: "driver", content: body || (media.length ? `(sent ${media.length} photo${media.length === 1 ? "" : "s"})` : ""), timestamp: new Date().toISOString(), channel: "sms" };
  await saveDriverMessage(carrierId, incoming);

  after(async () => {
    const ctx = await loadContext(carrierId);
    if (!ctx) return;
    const history = (await driverThread(carrierId, driver.id, 13))
      .filter((m) => m.id !== incoming.id)
      .map((m) => ({ from: m.from === "driver" ? ("them" as const) : ("ai" as const), text: m.content }));
    const lang = driver.prefs?.language ?? "en";
    // Photos (a POD, a BOL, a lumper receipt): stored, checked and put on the load. A caption that says more than
    // what the photo is still gets the AI's answer too.
    const photos = media.length ? await driverPhotos(ctx, driver, media, body).catch((e) => (console.error("[sms] photos failed", e), "Got your photo, but it didn't save. Please send it again or use the app.")) : "";
    const talk = !media.length || body.length > 40 || body.includes("?");
    const result = talk && aiConfigured() ? await driverTurn(ctx, driver, "sms", body || "(sent a photo)", history) : { reply: "", effects: { done: [] as string[], failed: talk } };
    if (result.effects.failed) await passToOwner(ctx, { reason: `${driver.name} texted: "${body}"`, label: "I'll answer", source: "sms" });
    const text = [photos, result.reply].filter(Boolean).join(" ") || PASSED_ON_TEXT[lang];
    const sid = await sendSms(from, text).catch((e) => {
      console.error("[sms] send failed", e);
      return undefined;
    });
    await saveDriverMessage(carrierId, { id: uid("dm"), driverId: driver.id, from: "ai", content: text, timestamp: new Date().toISOString(), channel: "sms", ai: !result.effects.failed });
    await logChannel({ carrierId, channel: "sms", direction: "out", providerId: sid ?? null, driverId: driver.id, counterparty: from, body: text, data: { did: result.effects.done } });
  });
  return twiml();
}
