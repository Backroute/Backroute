import "server-only";
import { aiConfigured } from "../ai/server";
import { carrierById, driverByPhone, driverThread, loadContext, logChannel, ownerByPhone, save, saveDriverMessage, threadWith } from "../agent/db";
import { driverTurn, ownerTurn, passToOwner, uid } from "../agent/dispatcher";
import { driverPhotos } from "../agent/photos";
import { trackingReply } from "../agent/tracking";
import { claimStatementReply } from "../agent/claims";
import type { Item } from "../cloud/rows";
import type { Driver, DriverMessage } from "../types";
import { forCarrier } from "../agent/scope";
import { textTo } from "./out";
import { PASSED_ON_TEXT, SMS_HELP, UNKNOWN_NUMBER } from "./phrases";

const STOP = new Set(["STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT"]);
const START = new Set(["START", "UNSTOP", "YES"]);
const HELP = new Set(["HELP", "INFO"]);

export interface IncomingText {
  from: string;
  body: string;
  /** The provider's id, so a retried webhook isn't answered twice. */
  messageSid: string;
  media?: { url: string }[];
}

/**
 * A text to the dispatch number, from a driver or the owner. `now` is an answer that goes straight back (TwiML, for
 * STOP/HELP/unknown numbers); `later` is the AI's answer, sent as its own text: the webhook runs it after answering
 * Twilio (so a slow answer never makes Twilio retry), the simulator awaits it.
 */
export async function receiveText(t: IncomingText): Promise<{ now?: string; later?: () => Promise<void> }> {
  const { from, messageSid } = t;
  const body = t.body.trim();
  const found = await driverByPhone(from);
  if (!found) {
    // The owner texting the line gets the AI dispatcher, answering from the fleet data.
    const owner = await ownerByPhone(from);
    if (!owner) return { now: UNKNOWN_NUMBER };
    const fresh = await logChannel({ carrierId: owner.id, channel: "sms", direction: "in", providerId: messageSid, counterparty: from, body, data: { kind: "owner_text" } });
    if (!fresh) return {};
    return {
      later: () => forCarrier(owner.id, async () => {
        const ctx = await loadContext(owner.id);
        if (!ctx) return;
        const history = (await threadWith(owner.id, "sms", from, 12)).filter((m, i, all) => !(i === all.length - 1 && m.direction === "in" && m.body === body)).map((m) => ({ from: m.direction === "in" ? ("them" as const) : ("ai" as const), text: m.body ?? "" }));
        const result = aiConfigured() ? await ownerTurn(ctx, "sms", body, history) : { reply: "", effects: { done: [], failed: true } };
        if (result.effects.failed) await passToOwner(ctx, { reason: `The owner texted: "${body}". The AI couldn't answer.`, label: "Answered", source: "sms", to: "support" });
        const text = result.reply || PASSED_ON_TEXT[ctx.settings.ownerLanguage ?? "en"];
        const sid = await textTo(ctx.carrier, from, text).catch((e) => {
          console.error("[sms] send failed", e);
          return null;
        });
        await logChannel({ carrierId: owner.id, channel: "sms", direction: "out", providerId: sid ?? null, counterparty: from, body: text, data: { kind: "owner_text" } });
      }),
    };
  }
  const { carrierId, driver } = found;

  const fresh = await logChannel({ carrierId, channel: "sms", direction: "in", providerId: messageSid, driverId: driver.id, counterparty: from, body });
  if (!fresh) return {}; // Twilio retried a text we already have.

  const word = body.toUpperCase();
  // "Yes" is START only from someone who opted out; otherwise it's an answer (to a tracking request, say).
  if (STOP.has(word) || (START.has(word) && (word !== "YES" || driver.prefs?.smsOptOut))) {
    // Twilio blocks texts to a number that sent STOP and confirms it itself; this keeps the app in step.
    const updated: Driver = { ...driver, prefs: { ...driver.prefs, smsOptOut: STOP.has(word) } };
    await save("drivers", carrierId, updated as unknown as Item);
    return {};
  }
  if (HELP.has(word)) {
    const carrier = await carrierById(carrierId);
    return { now: SMS_HELP(carrier?.name ?? "your carrier") };
  }

  const media = (t.media ?? []).slice(0, 5).filter((m) => m.url);
  const incoming: DriverMessage = { id: uid("dm"), driverId: driver.id, from: "driver", content: body || (media.length ? `(sent ${media.length} photo${media.length === 1 ? "" : "s"})` : ""), timestamp: new Date().toISOString(), channel: "sms" };
  await saveDriverMessage(carrierId, incoming);

  return {
    later: () => forCarrier(carrierId, async () => {
      const ctx = await loadContext(carrierId);
      if (!ctx) return;
      const history = (await driverThread(carrierId, driver.id, 13))
        .filter((m) => m.id !== incoming.id)
        .map((m) => ({ from: m.from === "driver" ? ("them" as const) : ("ai" as const), text: m.content }));
      const lang = driver.prefs?.language ?? "en";
      // Photos (a POD, a BOL, a lumper receipt): stored, checked and put on the load. A caption that says more than
      // what the photo is still gets the AI's answer too.
      const photos = media.length ? await driverPhotos(ctx, driver, media, body).catch((e) => (console.error("[sms] photos failed", e), "Got your photo, but it didn't save. Please send it again or use the app.")) : "";
      // "Yes" to the tracking-app request (tracking's on, the broker hears), or the driver's account for a cargo
      // claim: nothing more to answer.
      const tracked = !media.length ? ((await trackingReply(ctx, driver, body).catch(() => null)) ?? (await claimStatementReply(ctx, driver, body).catch(() => null))) : null;
      const talk = !tracked && (!media.length || body.length > 40 || body.includes("?"));
      const result = talk && aiConfigured() ? await driverTurn(ctx, driver, "sms", body || "(sent a photo)", history) : { reply: "", effects: { done: [] as string[], failed: talk } };
      if (result.effects.failed) await passToOwner(ctx, { reason: `${driver.name} texted: "${body}"`, label: "I'll answer", source: "sms" });
      const text = [photos, tracked, result.reply].filter(Boolean).join(" ") || PASSED_ON_TEXT[lang];
      const sid = await textTo(ctx.carrier, from, text).catch((e) => {
        console.error("[sms] send failed", e);
        return undefined;
      });
      await saveDriverMessage(carrierId, { id: uid("dm"), driverId: driver.id, from: "ai", content: text, timestamp: new Date().toISOString(), channel: "sms", ai: !result.effects.failed });
      await logChannel({ carrierId, channel: "sms", direction: "out", providerId: sid ?? null, driverId: driver.id, counterparty: from, body: text, data: { did: result.effects.done } });
    }),
  };
}
