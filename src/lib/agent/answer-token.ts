import "server-only";
import { createHmac, timingSafeEqual } from "crypto";

/**
 * The owner's Yes / No on a phone notification, without opening the app: the notification carries a signed token
 * for that one item (it works for two days, and only for answering that item). Pushes go only to the office's own
 * devices, encrypted end to end, so the token travels only where the owner's notifications do.
 */

const key = () => createHmac("sha256", process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").update("backroute-answer-links").digest();
const b64 = (s: string) => Buffer.from(s).toString("base64url");
const sign = (body: string) => createHmac("sha256", key()).update(body).digest("base64url");

export function answerToken(carrierId: string, escalationId: string, now = Date.now()): string {
  const body = b64(JSON.stringify({ c: carrierId, e: escalationId, x: Math.floor(now / 1000) + 2 * 86400 }));
  return `${body}.${sign(body)}`;
}

export function readAnswerToken(token: string, now = Date.now()): { carrierId: string; escalationId: string } | null {
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const want = Buffer.from(sign(body));
  const got = Buffer.from(sig);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString()) as { c?: string; e?: string; x?: number };
    if (!p.c || !p.e || !p.x || p.x * 1000 < now) return null;
    return { carrierId: p.c, escalationId: p.e };
  } catch {
    return null;
  }
}
