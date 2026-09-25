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

async function twilio(path: string, body: Record<string, string>) {
  const sid = process.env.TWILIO_ACCOUNT_SID!;
  const res = await fetch(`${base()}/Accounts/${sid}${path}`, {
    method: "POST",
    headers: {
      authorization: `Basic ${Buffer.from(`${sid}:${process.env.TWILIO_AUTH_TOKEN}`).toString("base64")}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(body),
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

/** Calling out needs a phone number to call from; a Messaging Service alone can only text. */
export const canCallOut = () => twilioConfigured() && Boolean(process.env.TWILIO_FROM_NUMBER);

/** Rings a driver. When they pick up, Twilio asks `url` what to say (and signs that request like any other). */
export async function startCall(to: string, url: string): Promise<string | undefined> {
  const data = await twilio("/Calls.json", { To: to, From: process.env.TWILIO_FROM_NUMBER!, Url: url, Method: "POST", Timeout: "25" });
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
export function sayAndListen(text: string, lang: Lang, action: string) {
  return `<Gather input="speech" language="${VOICE[lang].speech}" speechTimeout="auto" actionOnEmptyResult="true" action="${xml(action)}" method="POST">${say(text, lang)}</Gather>`;
}
