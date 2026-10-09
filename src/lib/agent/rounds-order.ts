import "server-only";
import { admin } from "./db";

/**
 * How the dispatcher's rounds get through many carriers inside one run's time limit: a few carriers at a time, the
 * ones served longest ago first, and no new carrier started once the budget is spent (the rest go first next run, ten
 * minutes later). Each carrier's last round is kept as a heartbeat ("rounds:<id>").
 */

export const POOL = Math.max(1, Number(process.env.ROUNDS_POOL) || 6);
/** Seconds of a run spent starting carriers; the rest is left for the ones in progress and the health check. */
export const BUDGET_MS = Math.max(10, Number(process.env.ROUNDS_BUDGET_SECONDS) || 220) * 1000;

/** Carrier ids, longest since their last round first (never served: first of all). */
export async function servedOrder(ids: string[]): Promise<string[]> {
  const { data } = await admin().from("service_heartbeats").select("name, at").like("name", "rounds:%");
  const last = new Map((data ?? []).map((r) => [String(r.name).slice(7), Date.parse(r.at as string)]));
  // Carriers that are gone don't keep a row.
  const gone = [...last.keys()].filter((id) => !ids.includes(id));
  if (gone.length) await admin().from("service_heartbeats").delete().in("name", gone.map((id) => `rounds:${id}`));
  return [...ids].sort((a, b) => (last.get(a) ?? 0) - (last.get(b) ?? 0));
}

export async function markServed(id: string, at = new Date()) {
  await admin()
    .from("service_heartbeats")
    .upsert({ name: `rounds:${id}`, at: at.toISOString(), data: {} }, { onConflict: "name" })
    .then(({ error }) => error && console.error("[rounds] couldn't record the round", id, error.message));
}

/**
 * Runs `work` for each id, `pool` at a time, starting none after `deadline`. Returns how many were left unstarted.
 * One carrier failing doesn't stop the others.
 */
export async function inPool(ids: string[], pool: number, deadline: number, work: (id: string) => Promise<void>): Promise<number> {
  let next = 0;
  let skipped = 0;
  async function lane() {
    while (next < ids.length) {
      if (Date.now() > deadline) {
        skipped = ids.length - next;
        next = ids.length;
        return;
      }
      const id = ids[next++];
      await work(id).catch((e) => console.error("[rounds] failed for", id, e));
    }
  }
  await Promise.all(Array.from({ length: Math.min(pool, ids.length) }, lane));
  return skipped;
}
