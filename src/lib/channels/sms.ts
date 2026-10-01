import "server-only";
import { aiConfigured } from "../ai/server";
import { carrierById, driverByPhone, driverThread, loadContext, logChannel, ownerByPhone, save, saveDriverMessage, storeFile, threadWith } from "../agent/db";
import { driverTurn, ownerTurn, passToOwner, uid } from "../agent/dispatcher";
import { driverPhotos } from "../agent/photos";
import { trackingReply } from "../agent/tracking";
import { claimStatementReply } from "../agent/claims";
import type { Item } from "../cloud/rows";
import type { Driver, DriverMessage, Lang } from "../types";
import { forCarrier } from "../agent/scope";
import { awaitingYes, recordConsent, releaseHeld, THANKS_YES } from "../consent";
import { textTo } from "./out";
import { PASSED_ON_TEXT, SMS_HELP, UNKNOWN_NUMBER, VOICE_UNHEARD } from "./phrases";
import { noteInbound, type Via } from "./texting";
import { twilioMedia } from "./twilio";
import { isAudio, mediaLink, speak, spokenRepliesConfigured, transcribe } from "./voice-notes";

const STOP = new Set(["STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT"]);
const START = new Set(["START", "UNSTOP", "YES"]);
const HELP = new Set(["HELP", "INFO"]);
const YES = new Set(["YES", "Y", "YES.", "YES!", "OK", "SI", "SÍ", "OUI", "ДА", "ТАК", "ਹਾਂ", "हाँ", "हां"]);

export interface IncomingText {
  from: string;
  body: string;
  /** The provider's id, so a retried webhook isn't answered twice. */
  messageSid: string;
  media?: { url: string; contentType?: string }[];
  /** SMS or WhatsApp: the answer goes back the same way. */
  via?: Via;
}

/** Voice messages, turned into what they said. `heard` is false when there was audio and none of it came through. */
async function listenTo(audio: { url: string; contentType?: string }[], lang: Lang, keep?: { carrierId: string; driverId: string }): Promise<{ text: string; heard: boolean }> {
  const said: string[] = [];
  for (const a of audio.slice(0, 2)) {
    const file = await twilioMedia(a.url).catch(() => null);
    if (!file) continue;
    const text = await transcribe(file.bytes, file.contentType || a.contentType || "audio/ogg", lang).catch((e) => (console.error("[sms] couldn't transcribe", e), null));
    if (!text) continue;
    said.push(text);
    // Kept with what it said, for the owner and for anything that's disputed later.
    if (keep) await storeFile(keep.carrierId, { kind: "voice_note", name: `voice-${keep.driverId}-${Date.now().toString(36)}.${(file.contentType.split("/")[1] ?? "ogg").split(";")[0]}`, contentType: file.contentType, bytes: file.bytes, note: text.slice(0, 500) }).catch((e) => console.error("[sms] couldn't keep the voice note", e));
  }
  return { text: said.join(" "), heard: said.length > 0 };
}

/**
 * A text to the dispatch number, from a driver or the owner, by SMS or WhatsApp. `now` is an answer that goes straight
 * back (TwiML, for STOP/HELP/unknown numbers); `later` is the AI's answer, sent as its own message: the webhook runs it
 * after answering Twilio (so a slow answer never makes Twilio retry), the simulator awaits it.
 */
export async function receiveText(t: IncomingText): Promise<{ now?: string; later?: () => Promise<void> }> {
  const { from, messageSid } = t;
  const via: Via = t.via ?? "sms";
  const body = t.body.trim();
  const all = (t.media ?? []).slice(0, 5).filter((m) => m.url);
  const audio = all.filter((m) => isAudio(m.contentType));
  const media = all.filter((m) => !isAudio(m.contentType));
  await noteInbound(from, via);
  const found = await driverByPhone(from);
  if (!found) {
    // The owner texting the line gets the AI dispatcher, answering from the fleet data.
    const owner = await ownerByPhone(from);
    if (!owner) return { now: UNKNOWN_NUMBER };
    const fresh = await logChannel({ carrierId: owner.id, channel: "sms", direction: "in", providerId: messageSid, counterparty: from, body: body || (audio.length ? "(voice message)" : ""), data: { kind: "owner_text", via } });
    if (!fresh) return {};
    return {
      later: () => forCarrier(owner.id, async () => {
        const ctx = await loadContext(owner.id);
        if (!ctx) return;
        const lang = ctx.settings.ownerLanguage ?? "en";
        const voice = audio.length ? await listenTo(audio, lang) : null;
        const said = [body, voice?.text].filter(Boolean).join(" ");
        const history = (await threadWith(owner.id, "sms", from, 12)).filter((m, i, all) => !(i === all.length - 1 && m.direction === "in")).map((m) => ({ from: m.direction === "in" ? ("them" as const) : ("ai" as const), text: m.body ?? "" }));
        if (voice && !voice.heard && !body) {
          await textTo(ctx.carrier, from, VOICE_UNHEARD[lang]).catch((e) => console.error("[sms] send failed", e));
          return;
        }
        const result = aiConfigured() ? await ownerTurn(ctx, "sms", said, history) : { reply: "", effects: { done: [], failed: true } };
        if (result.effects.failed) await passToOwner(ctx, { reason: `The owner texted: "${said}". The AI couldn't answer (twice).`, label: "Answered", source: "sms", to: "support" });
        const text = result.reply || PASSED_ON_TEXT[lang];
        const sid = await textTo(ctx.carrier, from, text).catch((e) => {
          console.error("[sms] send failed", e);
          return null;
        });
        await logChannel({ carrierId: owner.id, channel: "sms", direction: "out", providerId: sid ?? null, counterparty: from, body: text, data: { kind: "owner_text" } });
      }),
    };
  }
  const { carrierId, driver } = found;

  const fresh = await logChannel({ carrierId, channel: "sms", direction: "in", providerId: messageSid, driverId: driver.id, counterparty: from, body: body || (audio.length ? "(voice message)" : ""), data: { via } });
  if (!fresh) return {}; // Twilio retried a text we already have.

  const word = body.toUpperCase().replace(/\s+/g, " ").trim();
  const lang = driver.prefs?.language ?? "en";
  // "Yes" is START only from someone who opted out; otherwise it's an answer (to a tracking request, say).
  if (STOP.has(word) || (START.has(word) && (word !== "YES" || driver.prefs?.smsOptOut))) {
    // Twilio blocks texts to a number that sent STOP and confirms it itself; this keeps the app in step, and the
    // consent record shows when they said it.
    const updated: Driver = { ...driver, prefs: { ...driver.prefs, smsOptOut: STOP.has(word) } };
    await save("drivers", carrierId, updated as unknown as Item);
    await recordConsent({ carrierId, driverId: driver.id, phone: from, granted: !STOP.has(word), via, wording: `Texted "${body}"` }).catch((e) => console.error("[sms] couldn't record consent", e));
    if (!STOP.has(word)) await releaseHeld(carrierId, from).catch((e) => console.error("[sms] couldn't send held texts", e));
    return {};
  }
  if (HELP.has(word)) {
    const carrier = await carrierById(carrierId);
    return { now: SMS_HELP(carrier?.name ?? "your carrier") };
  }
  // The answer to the first text ("Reply YES to confirm"): recorded and thanked (unless the yes was also for the
  // tracking app, which then gets its own answer).
  const consentYes = YES.has(word) && !media.length && !audio.length && (await awaitingYes(carrierId, driver.id, from).catch(() => false));
  if (consentYes) {
    await recordConsent({ carrierId, driverId: driver.id, phone: from, granted: true, via, wording: `Texted "${body}" to the first text` });
    // Anything that waited for their yes (CONSENT_REQUIRED=1) goes now.
    await releaseHeld(carrierId, from).catch((e) => console.error("[sms] couldn't send held texts", e));
  }

  const incoming: DriverMessage = { id: uid("dm"), driverId: driver.id, from: "driver", content: body || (media.length ? `(sent ${media.length} photo${media.length === 1 ? "" : "s"})` : audio.length ? "(voice message)" : ""), timestamp: new Date().toISOString(), channel: "sms" };
  if (!audio.length) await saveDriverMessage(carrierId, incoming);

  return {
    later: () => forCarrier(carrierId, async () => {
      const ctx = await loadContext(carrierId);
      if (!ctx) return;
      // A voice message: what they said is the message.
      const voice = audio.length ? await listenTo(audio, lang, { carrierId, driverId: driver.id }) : null;
      const said = [body, voice?.text].filter(Boolean).join(" ");
      if (voice) await saveDriverMessage(carrierId, { ...incoming, content: voice.heard ? `🎤 ${said}` : body || "(voice message)" });
      if (voice && !voice.heard && !body && !media.length) {
        const sid = await textTo(ctx.carrier, from, VOICE_UNHEARD[lang]).catch(() => undefined);
        await saveDriverMessage(carrierId, { id: uid("dm"), driverId: driver.id, from: "ai", content: VOICE_UNHEARD[lang], timestamp: new Date().toISOString(), channel: "sms", ai: true });
        await logChannel({ carrierId, channel: "sms", direction: "out", providerId: sid ?? null, driverId: driver.id, counterparty: from, body: VOICE_UNHEARD[lang], data: { kind: "voice_unheard" } });
        return;
      }
      const history = (await driverThread(carrierId, driver.id, 13))
        .filter((m) => m.id !== incoming.id)
        .map((m) => ({ from: m.from === "driver" ? ("them" as const) : ("ai" as const), text: m.content }));
      // Photos (a POD, a BOL, a lumper receipt): stored, checked and put on the load. A caption that says more than
      // what the photo is still gets the AI's answer too.
      const photos = media.length ? await driverPhotos(ctx, driver, media, said).catch((e) => (console.error("[sms] photos failed", e), "Got your photo, but it didn't save. Please send it again or use the app.")) : "";
      // "Yes" to the tracking-app request (tracking's on, the broker hears), or the driver's account for a cargo
      // claim: nothing more to answer.
      const tracked = !media.length ? ((await trackingReply(ctx, driver, said).catch(() => null)) ?? (await claimStatementReply(ctx, driver, said).catch(() => null))) : null;
      const talk = !tracked && !consentYes && (!media.length || said.length > 40 || said.includes("?"));
      const result = talk && aiConfigured() ? await driverTurn(ctx, driver, "sms", said || "(sent a photo)", history) : { reply: "", effects: { done: [] as string[], failed: talk } };
      if (result.effects.failed) await passToOwner(ctx, { reason: `${driver.name} texted: "${said}". The AI couldn't answer (twice).`, label: "I'll answer", source: "sms", to: "support" });
      const text = [photos, tracked, result.reply].filter(Boolean).join(" ") || (consentYes ? THANKS_YES[lang] : PASSED_ON_TEXT[lang]);
      // A voice message gets a voice answer too (on WhatsApp, or as MMS to a phone that just sent one), so they can
      // listen instead of reading at the wheel.
      const spoken = voice?.heard && driver.prefs?.voiceReplies !== false && spokenRepliesConfigured() && !ctx.carrier.settings?.sandbox ? await spokenAnswer(carrierId, driver.id, text) : null;
      const sid = await textTo(ctx.carrier, from, text, spoken ? { media: [spoken] } : {}).catch((e) => {
        console.error("[sms] send failed", e);
        return undefined;
      });
      await saveDriverMessage(carrierId, { id: uid("dm"), driverId: driver.id, from: "ai", content: text, timestamp: new Date().toISOString(), channel: "sms", ai: !result.effects.failed });
      await logChannel({ carrierId, channel: "sms", direction: "out", providerId: sid ?? null, driverId: driver.id, counterparty: from, body: text, data: { did: result.effects.done, ...(spoken ? { spoken: true } : {}) } });
    }),
  };
}

/** The answer as a short-lived link to it spoken, or null when it couldn't be made. */
async function spokenAnswer(carrierId: string, driverId: string, text: string): Promise<string | null> {
  try {
    const audio = await speak(text);
    if (!audio) return null;
    const id = await storeFile(carrierId, { kind: "voice_reply", name: `reply-${driverId}-${Date.now().toString(36)}.mp3`, contentType: "audio/mpeg", bytes: audio, note: text.slice(0, 500) });
    return mediaLink(id);
  } catch (e) {
    console.error("[sms] couldn't speak the answer", e);
    return null;
  }
}
