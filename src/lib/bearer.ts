import { createHash, timingSafeEqual } from "crypto";

/**
 * Whether the request carries `Authorization: Bearer <secret>`, compared in constant time (both sides hashed, so their
 * lengths match). Never true when the secret isn't set.
 */
export function hasBearer(request: Request, secret: string | undefined): boolean {
  if (!secret) return false;
  const hash = (s: string) => createHash("sha256").update(s).digest();
  return timingSafeEqual(hash(request.headers.get("authorization") ?? ""), hash(`Bearer ${secret}`));
}
