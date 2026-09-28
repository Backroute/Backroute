import "server-only";
import { admin, dbConfigured } from "./agent/db";

/** The address a request came from (Vercel puts it first in x-forwarded-for). */
export const clientIp = (request: Request) => request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";

/**
 * True when `key` has been used more than `max` times in the last `windowSec` seconds (and counts this use). Shared
 * by every server instance through the database. If the database can't answer, it lets the request through: a limit
 * is a guard against abuse, not a reason to turn real users away.
 */
export async function overLimit(key: string, windowSec: number, max: number): Promise<boolean> {
  if (!dbConfigured()) return false;
  const { data, error } = await admin().rpc("hit_rate_limit", { p_key: key.slice(0, 200), p_window_seconds: windowSec, p_max: max });
  if (error) {
    console.error("[rate-limit]", error.message);
    return false;
  }
  return data === false;
}

export const tooMany = () => Response.json({ error: "too_many_requests" }, { status: 429, headers: { "retry-after": "600" } });
