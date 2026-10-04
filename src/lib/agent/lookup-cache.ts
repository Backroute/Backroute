import "server-only";
import { admin, dbConfigured } from "./db";

/**
 * Answers from outside services kept for a while: in this server's memory first, then in the database so a fresh
 * server (a new serverless instance) doesn't ask again and pay again. A lookup that fails isn't kept.
 */
const memory = new Map<string, { value: unknown; until: number }>();

export async function cached<T>(key: string, ttlMs: number, fetch: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const hit = memory.get(key);
  if (hit && hit.until > now) return hit.value as T;
  if (dbConfigured()) {
    const { data } = await admin().from("lookup_cache").select("value, expires_at").eq("key", key).maybeSingle().then((r) => r, () => ({ data: null }));
    if (data && Date.parse(data.expires_at as string) > now) {
      memory.set(key, { value: data.value, until: Date.parse(data.expires_at as string) });
      return data.value as T;
    }
  }
  const value = await fetch();
  const until = now + ttlMs;
  if (memory.size > 5000) memory.clear();
  memory.set(key, { value, until });
  if (dbConfigured())
    await admin()
      .from("lookup_cache")
      .upsert({ key, value: value as object, expires_at: new Date(until).toISOString() })
      .then(
        () => 0,
        () => 0,
      );
  return value;
}
