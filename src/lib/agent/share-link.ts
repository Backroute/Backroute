import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Links a carrier hands out without a sign-in: a load's tracking page for its broker or shipper, and a direct
 * shipper's page of their loads. The link carries who it's for and when it stops working, signed with a key only the
 * server has, so it can't be changed to show another carrier's load. Nothing secret is in it; it can be read, not forged.
 */
export type ShareKind = "track" | "shipper";
// SHARE_LINK_SECRET when it's set (changing it ends every link at once); otherwise one derived from the service key.
const key = () => createHmac("sha256", process.env.SHARE_LINK_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || "").update("backroute-share-link").digest();
const sign = (body: string) => createHmac("sha256", key()).update(body).digest("base64url").slice(0, 32);

export function shareToken(kind: ShareKind, carrierId: string, id: string, until: number, now = Date.now()): string {
  const body = Buffer.from(JSON.stringify({ k: kind, c: carrierId, i: id, x: Math.floor(until / 1000), t: now })).toString("base64url");
  return `${body}.${sign(body)}`;
}

export function readShareToken(token: string, kind: ShareKind, now = Date.now()): { carrierId: string; id: string; until: number; issued: number } | null {
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const want = Buffer.from(sign(body));
  const got = Buffer.from(sig);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString()) as { k?: string; c?: string; i?: string; x?: number; t?: number };
    return p.k === kind && p.c && p.i && p.x && p.x * 1000 >= now ? { carrierId: p.c, id: p.i, until: p.x * 1000, issued: p.t ?? 0 } : null;
  } catch {
    return null;
  }
}

/** A link made before the owner pressed "Stop sharing" doesn't open any more. */
export const stopped = (link: { issued: number }, offAt?: string | null) => !!offAt && link.issued <= Date.parse(offAt);
