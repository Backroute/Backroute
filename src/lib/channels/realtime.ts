import "server-only";
import crypto from "node:crypto";
import type { Lang } from "../types";
import { xml } from "./twilio";

/**
 * Natural phone calls. With a voice server running (voice-server/, outside Vercel), a call's audio streams to it
 * instead of taking turns through Twilio's speech recognition: the AI hears while it talks, and stops when
 * interrupted. The server sends each finished sentence back to /api/voice/turn, which runs the same AI and rules.
 *
 * Languages the streaming speech services handle well; others (Punjabi) keep the turn-by-turn calls.
 */

export const REALTIME_LANGS = new Set<Lang>(["en", "es", "fr", "hi", "ru", "uk"]);

export const realtimeConfigured = () => Boolean(process.env.VOICE_SERVER_URL && process.env.VOICE_SERVER_SECRET);
export const realtimeFor = (lang: Lang) => realtimeConfigured() && REALTIME_LANGS.has(lang);

export type CallKind = "driver" | "broker" | "shop" | "owner";

export function voiceToken(kind: CallKind, carrier: string, ref: string, callSid: string): string {
  return crypto.createHmac("sha256", process.env.VOICE_SERVER_SECRET!).update(`${kind}|${carrier}|${ref}|${callSid}`).digest("hex");
}

export function validVoiceToken(kind: string, carrier: string, ref: string, callSid: string, token: string): boolean {
  if (!realtimeConfigured() || !token) return false;
  const want = Buffer.from(voiceToken(kind as CallKind, carrier, ref, callSid));
  const got = Buffer.from(token);
  return want.length === got.length && crypto.timingSafeEqual(want, got);
}

/** TwiML that hands the call's audio to the voice server; when the server closes the stream, the call ends. */
export function streamTwiml(p: { kind: CallKind; carrier: string; ref: string; callSid: string; lang: Lang; opening: string }): Response {
  const url = `${process.env.VOICE_SERVER_URL!.replace(/\/$/, "")}/stream`;
  const params = { kind: p.kind, carrier: p.carrier, ref: p.ref, lang: p.lang, opening: p.opening.slice(0, 480), token: voiceToken(p.kind, p.carrier, p.ref, p.callSid) };
  const inner = Object.entries(params)
    .map(([k, v]) => `<Parameter name="${k}" value="${xml(v)}"/>`)
    .join("");
  return new Response(`<?xml version="1.0" encoding="UTF-8"?><Response><Connect><Stream url="${xml(url)}">${inner}</Stream></Connect><Hangup/></Response>`, { headers: { "content-type": "text/xml" } });
}
