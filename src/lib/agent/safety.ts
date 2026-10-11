import "server-only";
import type { Item } from "../cloud/rows";
import type { Driver, SafetyEvent } from "../types";
import { mergeSafety, safetyKind } from "../safety";
import { save, type CarrierContext } from "./db";

/**
 * Safety events from the ELD each round, put on the driver who was driving: Samsara's safety events
 * (GET /fleet/safety-events) and Motive's driver performance events (GET /v2/driver_performance_events). The field
 * names below follow each vendor's API reference and are worth checking against a live account before relying on them;
 * an event without a driver name is skipped rather than guessed.
 */
const SAMSARA = () => process.env.SAMSARA_API_BASE?.replace(/\/$/, "") ?? "https://api.samsara.com";
const MOTIVE = () => process.env.MOTIVE_API_BASE?.replace(/\/$/, "") ?? "https://api.gomotive.com";

const sameName = (a: string, b: string) => a.trim().toLowerCase().replace(/\s+/g, " ") === b.trim().toLowerCase().replace(/\s+/g, " ");

type Read = { driverName: string; event: SafetyEvent };

export async function readSafety(kind: "samsara" | "motive", apiKey: string, now: number): Promise<Read[]> {
  const since = new Date(now - 2 * 86400_000).toISOString();
  const until = new Date(now).toISOString();
  const out: Read[] = [];
  if (kind === "samsara") {
    const res = await fetch(`${SAMSARA()}/fleet/safety-events?startTime=${encodeURIComponent(since)}&endTime=${encodeURIComponent(until)}`, {
      headers: { authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(`Samsara safety events ${res.status}`);
    const body = (await res.json()) as { data?: { id?: string; time?: string; driver?: { name?: string }; vehicle?: { name?: string }; behaviorLabels?: { label?: string; name?: string }[] }[] };
    for (const e of body.data ?? []) {
      const label = e.behaviorLabels?.[0]?.name ?? e.behaviorLabels?.[0]?.label;
      if (!e.id || !e.time || !e.driver?.name || !label) continue;
      out.push({ driverName: e.driver.name, event: { id: `samsara:${e.id}`, at: e.time, kind: safetyKind(label), label, unit: e.vehicle?.name, source: "samsara" } });
    }
  } else {
    const res = await fetch(`${MOTIVE()}/v2/driver_performance_events?start_time=${encodeURIComponent(since)}&end_time=${encodeURIComponent(until)}&per_page=100`, {
      headers: { "x-api-key": apiKey },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(`Motive performance events ${res.status}`);
    const body = (await res.json()) as {
      driver_performance_events?: { driver_performance_event?: { id?: number | string; type?: string; start_time?: string; driver?: { first_name?: string; last_name?: string }; vehicle?: { number?: string } } }[];
    };
    for (const { driver_performance_event: e } of body.driver_performance_events ?? []) {
      const name = `${e?.driver?.first_name ?? ""} ${e?.driver?.last_name ?? ""}`.trim();
      if (!e?.id || !e.start_time || !e.type || !name) continue;
      out.push({ driverName: name, event: { id: `motive:${e.id}`, at: e.start_time, kind: safetyKind(e.type), label: e.type, unit: e.vehicle?.number, source: "motive" } });
    }
  }
  return out;
}

/** Puts the events on the drivers they belong to. Returns how many were new. */
export async function applySafety(ctx: CarrierContext, reads: Read[], now: number): Promise<number> {
  let added = 0;
  for (const driver of ctx.drivers) {
    const mine = reads.filter((r) => sameName(r.driverName, driver.name)).map((r) => r.event);
    if (!mine.length) continue;
    const before = new Set((driver.safetyEvents ?? []).map((e) => e.id));
    const merged = mergeSafety(driver.safetyEvents, mine, now);
    const fresh = merged.filter((e) => !before.has(e.id)).length;
    if (!fresh) continue;
    added += fresh;
    const next: Driver = { ...driver, safetyEvents: merged };
    await save("drivers", ctx.carrier.id, next as unknown as Item);
    ctx.drivers = ctx.drivers.map((d) => (d.id === driver.id ? next : d));
  }
  return added;
}
