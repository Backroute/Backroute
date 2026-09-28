import "server-only";
import { createHmac, timingSafeEqual } from "crypto";
import type { Lang } from "../types";

/**
 * Twilio: the dispatch phone number drivers text and call. Talks to Twilio's REST API with fetch, no SDK. Off unless
 * TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and a sender (TWILIO_FROM_NUMBER or TWILIO_MESSAGING_SERVICE_SID) are set.
 */

export const twilioConfigured = () =>
  Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && (process.env.TWILIO_FROM_NUMBER || process.env.TWILIO_MESSAGING_SERVICE_SID));

/** The public address Twilio calls, which is also what it signs. Set PUBLIC_BASE_URL in production. */
export function publicUrl(request: Request, path: string): string {
  const base = process.env.PUBLIC_BASE_URL?.replace(/\/$/, "");
  if (base) return `${base}${path}`;
  const url = new URL(request.url);
  const host = request.headers.get("x-forwarded-host") ?? url.host;
  const proto = request.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "");
  return `${proto}://${host}${path}`;
}

/** An address Twilio can reach when there's no incoming request to take it from (the jobs). Needs PUBLIC_BASE_URL. */
export function absoluteUrl(path: string): string | null {
  const base = process.env.PUBLIC_BASE_URL?.replace(/\/$/, "");
  return base ? `${base}${path}` : null;
}

/**
 * Checks that a webhook really came from Twilio: HMAC-SHA1 over the full URL plus the POST fields sorted by name,
 * keyed with the auth token (Twilio's documented scheme).
 */
export function validTwilioSignature(url: string, params: Record<string, string>, signature: string | null): boolean {
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!token || !signature) return false;
  const payload = url + Object.keys(params).sort().map((k) => k + params[k]).join("");
  const expected = createHmac("sha1", token).update(payload, "utf8").digest("base64");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** A Twilio webhook's form fields, and whether its signature checks out. */
export async function readTwilioWebhook(request: Request, path: string) {
  const form = await request.formData();
  const params = Object.fromEntries([...form.entries()].map(([k, v]) => [k, String(v)]));
  const url = publicUrl(request, path + (new URL(request.url).search ?? ""));
  return { params, valid: validTwilioSignature(url, params, request.headers.get("x-twilio-signature")) };
}

const API = "https://api.twilio.com/2010-04-01";
const base = () => process.env.TWILIO_API_BASE?.replace(/\/$/, "") ?? API;

async function twilio(path: string, body: Record<string, string | string[]>) {
  const sid = process.env.TWILIO_ACCOUNT_SID!;
  const form = new URLSearchParams();
  for (const [k, v] of Object.entries(body)) for (const one of Array.isArray(v) ? v : [v]) form.append(k, one);
  const res = await fetch(`${base()}/Accounts/${sid}${path}`, {
    method: "POST",
    headers: {
      authorization: `Basic ${Buffer.from(`${sid}:${process.env.TWILIO_AUTH_TOKEN}`).toString("base64")}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: form,
  });
  const data = (await res.json().catch(() => ({}))) as { sid?: string; message?: string; code?: number };
  if (!res.ok) throw new Error(`Twilio ${res.status}: ${data.message ?? "error"} (${data.code ?? "?"})`);
  return data;
}

/** Sends a text. Twilio itself blocks numbers that replied STOP. */
export async function sendSms(to: string, body: string): Promise<string | undefined> {
  const service = process.env.TWILIO_MESSAGING_SERVICE_SID;
  const from: Record<string, string> = service ? { MessagingServiceSid: service } : { From: process.env.TWILIO_FROM_NUMBER! };
  const data = await twilio("/Messages.json", { To: to, Body: body.slice(0, 1500), ...from });
  return data.sid;
}

/**
 * WhatsApp through the same Twilio account: on when TWILIO_WHATSAPP_FROM (the WhatsApp sender's number) is set. A
 * free-form message can go only within 24 hours of the driver's last message; outside that, WhatsApp takes only an
 * approved template (TWILIO_WHATSAPP_TEMPLATE_SID, one variable: the message), else the text goes by SMS.
 */
export const whatsappConfigured = () => twilioConfigured() && Boolean(process.env.TWILIO_WHATSAPP_FROM);
export const whatsappTemplate = () => process.env.TWILIO_WHATSAPP_TEMPLATE_SID || null;

const wa = (n: string) => `whatsapp:${n.replace(/^whatsapp:/, "")}`;

export async function sendWhatsApp(to: string, body: string, media: string[] = []): Promise<string | undefined> {
  const data = await twilio("/Messages.json", { To: wa(to), From: wa(process.env.TWILIO_WHATSAPP_FROM!), Body: body.slice(0, 1500), ...(media.length ? { MediaUrl: media.slice(0, 1) } : {}) });
  return data.sid;
}

/** Outside WhatsApp's 24 hours: the approved template, with the message as its one variable (no line breaks allowed). */
export async function sendWhatsAppTemplate(to: string, body: string): Promise<string | undefined> {
  const text = body.replace(/\s*\n+\s*/g, " · ").replace(/\s{2,}/g, " ").slice(0, 1000);
  const data = await twilio("/Messages.json", { To: wa(to), From: wa(process.env.TWILIO_WHATSAPP_FROM!), ContentSid: whatsappTemplate()!, ContentVariables: JSON.stringify({ "1": text }) });
  return data.sid;
}

/** Calling out needs a phone number to call from; a Messaging Service alone can only text. */
export const canCallOut = () => twilioConfigured() && Boolean(process.env.TWILIO_FROM_NUMBER);

/** Rings a driver. When they pick up, Twilio asks `url` what to say (and signs that request like any other). */
export async function startCall(to: string, url: string, opts: { machineDetection?: boolean } = {}): Promise<string | undefined> {
  // Machine detection tells a person from voicemail (AnsweredBy), so the AI can leave a message instead of talking.
  const data = await twilio("/Calls.json", { To: to, From: process.env.TWILIO_FROM_NUMBER!, Url: url, Method: "POST", Timeout: "25", ...(opts.machineDetection ? { MachineDetection: "Enable" } : {}) });
  return data.sid;
}

// ─── TwiML ───────────────────────────────────────────────────────────────────

export const xml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");

export function twiml(inner = ""): Response {
  return new Response(`<?xml version="1.0" encoding="UTF-8"?><Response>${inner}</Response>`, { headers: { "content-type": "text/xml" } });
}

/**
 * The voice and speech-recognition language for each language drivers can pick. Google voices through Twilio cover
 * all seven; check the Twilio console lists each one for your account before relying on it.
 */
export const VOICE: Record<Lang, { speech: string; voice: string }> = {
  en: { speech: "en-US", voice: "Google.en-US-Standard-C" },
  es: { speech: "es-US", voice: "Google.es-US-Standard-A" },
  pa: { speech: "pa-IN", voice: "Google.pa-IN-Standard-A" },
  hi: { speech: "hi-IN", voice: "Google.hi-IN-Standard-A" },
  ru: { speech: "ru-RU", voice: "Google.ru-RU-Standard-A" },
  uk: { speech: "uk-UA", voice: "Google.uk-UA-Standard-A" },
  fr: { speech: "fr-CA", voice: "Google.fr-CA-Standard-A" },
};

export function say(text: string, lang: Lang) {
  const v = VOICE[lang];
  return `<Say voice="${v.voice}" language="${v.speech}">${xml(text)}</Say>`;
}

/** Speaks, then listens for the driver's answer and posts it to `action`. */
/** Words speech recognition should expect on a dispatch call (Twilio's hints), so "reefer" isn't heard as "real fur". */
export const SPEECH_HINTS = [
  "reefer", "dry van", "flatbed", "step deck", "power only", "rate con", "rate confirmation", "BOL", "bill of lading", "POD", "lumper", "detention", "TONU",
  "deadhead", "bobtail", "drop and hook", "live unload", "check call", "all in", "per mile", "MC number", "DOT", "weigh station", "scale", "blowout",
  "breakdown", "loaded", "empty", "at the shipper", "at the receiver", "hours of service", "34 reset", "out of hours", "10-4", "copy that",
];

export function sayAndListen(text: string, lang: Lang, action: string) {
  // English calls use the phone-call speech model and the trucking vocabulary; other languages use the default model.
  const tuned = lang === "en" ? ` speechModel="phone_call" enhanced="true" hints="${xml(SPEECH_HINTS.join(", "))}"` : "";
  return `<Gather input="speech" language="${VOICE[lang].speech}" speechTimeout="auto" actionOnEmptyResult="true"${tuned} action="${xml(action)}" method="POST">${say(text, lang)}</Gather>`;
}

/**
 * Listens without saying anything: after pressing a key on a phone menu, and while on hold. Waits up to `seconds` for
 * someone to speak (hold music isn't speech), then posts to `action` either way.
 */
export function listen(lang: Lang, action: string, seconds = 30) {
  const tuned = lang === "en" ? ` speechModel="phone_call" enhanced="true" hints="${xml(SPEECH_HINTS.join(", "))}"` : "";
  return `<Gather input="speech" language="${VOICE[lang].speech}" timeout="${seconds}" speechTimeout="auto" actionOnEmptyResult="true"${tuned} action="${xml(action)}" method="POST"></Gather>`;
}

/** Presses keys on the other side's phone menu ("w" waits half a second first, so the menu has finished talking). */
export const press = (digits: string) => `<Play digits="w${xml(digits.replace(/[^0-9*#w]/g, ""))}"/>`;

/** Replaces what a live call is doing with new TwiML (a key press on a menu during a natural call). */
export async function updateCall(callSid: string, twimlXml: string) {
  await twilio(`/Calls/${encodeURIComponent(callSid)}.json`, { Twiml: twimlXml });
}

/** A photo or file a driver texted (MMS), from Twilio's media store. Only Twilio's own addresses are fetched. */
export async function twilioMedia(url: string): Promise<{ bytes: Buffer; contentType: string } | null> {
  if (!url.startsWith(`${base()}/`) && !url.startsWith(`${API}/`)) return null;
  const sid = process.env.TWILIO_ACCOUNT_SID!;
  const res = await fetch(url, { headers: { authorization: `Basic ${Buffer.from(`${sid}:${process.env.TWILIO_AUTH_TOKEN}`).toString("base64")}` }, signal: AbortSignal.timeout(20000) });
  if (!res.ok) return null;
  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.length > 10 * 1024 * 1024) return null;
  return { bytes, contentType: (res.headers.get("content-type") ?? "").split(";")[0].trim() };
}
