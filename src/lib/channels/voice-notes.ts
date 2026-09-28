import "server-only";
import { createHmac, timingSafeEqual } from "crypto";
import type { Lang } from "../types";
import { absoluteUrl } from "./twilio";

/**
 * Voice messages. A driver at the wheel holds the mic button and talks instead of typing: WhatsApp voice notes and
 * MMS audio are turned into text (Deepgram, DEEPGRAM_API_KEY) and handled like any text. On WhatsApp the answer can
 * come back spoken too (ElevenLabs, ELEVENLABS_API_KEY and ELEVENLABS_VOICE_ID), so they never have to look down.
 */

export const transcriptionConfigured = () => Boolean(process.env.DEEPGRAM_API_KEY);
export const spokenRepliesConfigured = () => Boolean(process.env.ELEVENLABS_API_KEY && process.env.ELEVENLABS_VOICE_ID && process.env.PUBLIC_BASE_URL);

export const isAudio = (contentType: string | undefined) => /^audio\//i.test(contentType ?? "") || /^video\/3gpp/i.test(contentType ?? "");

// Deepgram's languages for the ones drivers pick. Punjabi isn't one: those are auto-detected, and may not come through.
const DG_LANG: Partial<Record<Lang, string>> = { en: "en-US", es: "es", fr: "fr", hi: "hi", ru: "ru", uk: "uk" };

/** What they said, or null when it couldn't be made out. */
export async function transcribe(bytes: Buffer, contentType: string, lang: Lang): Promise<string | null> {
  if (!transcriptionConfigured()) return null;
  const base = (process.env.DEEPGRAM_API_BASE ?? "https://api.deepgram.com").replace(/\/$/, "");
  const params = new URLSearchParams({ model: process.env.DEEPGRAM_MODEL ?? "nova-3", smart_format: "true", punctuate: "true" });
  if (DG_LANG[lang]) params.set("language", DG_LANG[lang]!);
  else params.set("detect_language", "true");
  // The same trucking words the phone calls listen for, so "reefer" isn't heard as "real fur".
  for (const k of ["reefer", "lumper", "detention", "BOL", "POD", "deadhead", "bobtail"]) params.append("keyterm", k);
  const res = await fetch(`${base}/v1/listen?${params}`, {
    method: "POST",
    headers: { authorization: `Token ${process.env.DEEPGRAM_API_KEY}`, "content-type": contentType || "audio/ogg" },
    body: new Uint8Array(bytes),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`Deepgram ${res.status}`);
  const data = (await res.json()) as { results?: { channels?: { alternatives?: { transcript?: string }[] }[] } };
  const text = data.results?.channels?.[0]?.alternatives?.[0]?.transcript?.trim();
  return text || null;
}

/** The answer, spoken: an MP3 in the driver's language, or null. */
export async function speak(text: string): Promise<Buffer | null> {
  if (!spokenRepliesConfigured()) return null;
  const base = (process.env.ELEVENLABS_BASE ?? "https://api.elevenlabs.io").replace(/\/$/, "");
  const res = await fetch(`${base}/v1/text-to-speech/${encodeURIComponent(process.env.ELEVENLABS_VOICE_ID!)}?output_format=mp3_44100_64`, {
    method: "POST",
    headers: { "xi-api-key": process.env.ELEVENLABS_API_KEY!, "content-type": "application/json", accept: "audio/mpeg" },
    body: JSON.stringify({ text: text.slice(0, 800), model_id: process.env.ELEVENLABS_MODEL ?? "eleven_multilingual_v2" }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`ElevenLabs ${res.status}`);
  const bytes = Buffer.from(await res.arrayBuffer());
  return bytes.length ? bytes : null;
}

// A link to one stored voice answer that only works for two hours: long enough for WhatsApp to fetch it, and no
// sign-in, since it's WhatsApp's servers asking. Signed with a key derived from the server's own secret.
const key = () => createHmac("sha256", process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").update("backroute-media-links").digest();
const sign = (id: string, exp: number) => createHmac("sha256", key()).update(`${id}.${exp}`).digest("hex");

export function mediaLink(fileId: string, now = Date.now()): string | null {
  const exp = Math.floor(now / 1000) + 2 * 3600;
  return absoluteUrl(`/api/media/${encodeURIComponent(fileId)}?e=${exp}&s=${sign(fileId, exp)}`);
}

export function validMediaLink(fileId: string, exp: string | null, sig: string | null, now = Date.now()): boolean {
  const e = Number(exp);
  if (!sig || !Number.isFinite(e) || e * 1000 < now) return false;
  const want = Buffer.from(sign(fileId, e));
  const got = Buffer.from(sig);
  return want.length === got.length && timingSafeEqual(want, got);
}
