import "server-only";
import type { Driver, Truck } from "../types";

/**
 * Truck routing: real road miles and drive time for a truck (HERE Routing v8, transportMode=truck, which keeps to
 * truck-legal roads). Without HERE_API_KEY everything falls back to the built-in estimate from city coordinates.
 * HERE_GEOCODE_BASE and HERE_ROUTER_BASE can point somewhere else (a proxy, or the stand-ins used in testing).
 */

export const routingConfigured = () => Boolean(process.env.HERE_API_KEY);
const GEOCODE = () => process.env.HERE_GEOCODE_BASE?.replace(/\/$/, "") ?? "https://geocode.search.hereapi.com";
const ROUTER = () => process.env.HERE_ROUTER_BASE?.replace(/\/$/, "") ?? "https://router.hereapi.com";

type Point = { lat: number; lon: number };
export type Place = Point | { city: string; state: string };

const places = new Map<string, Point | null>();
const routes = new Map<string, { at: number; route: Route | null }>();
const FRESH = 24 * 3600_000;

export interface Route {
  miles: number;
  hours: number;
}

async function get(url: string): Promise<unknown> {
  const res = await fetch(url, { signal: AbortSignal.timeout(10000), cache: "no-store" });
  if (!res.ok) throw new Error(`routing ${res.status}`);
  return res.json();
}

async function point(p: Place): Promise<Point | null> {
  if ("lat" in p) return p;
  const key = `${p.city},${p.state}`.toLowerCase();
  if (places.has(key)) return places.get(key)!;
  const body = (await get(`${GEOCODE()}/v1/geocode?q=${encodeURIComponent(`${p.city}, ${p.state}, USA`)}&limit=1&apiKey=${encodeURIComponent(process.env.HERE_API_KEY!)}`)) as { items?: { position?: { lat: number; lng: number } }[] };
  const pos = body.items?.[0]?.position;
  const found = pos ? { lat: pos.lat, lon: pos.lng } : null;
  places.set(key, found);
  return found;
}

/** Road miles and driving hours for a truck between two places, or null (not set up, or the service had no route). */
export async function route(from: Place, to: Place): Promise<Route | null> {
  if (!routingConfigured()) return null;
  try {
    const [a, b] = await Promise.all([point(from), point(to)]);
    if (!a || !b) return null;
    // Positions are rounded to about a kilometer so a moving truck still hits the cache.
    const key = `${a.lat.toFixed(2)},${a.lon.toFixed(2)}>${b.lat.toFixed(2)},${b.lon.toFixed(2)}`;
    const hit = routes.get(key);
    if (hit && Date.now() - hit.at < FRESH) return hit.route;
    const body = (await get(`${ROUTER()}/v8/routes?transportMode=truck&origin=${a.lat},${a.lon}&destination=${b.lat},${b.lon}&return=summary&apiKey=${encodeURIComponent(process.env.HERE_API_KEY!)}`)) as {
      routes?: { sections?: { summary?: { length?: number; duration?: number } }[] }[];
    };
    const sections = body.routes?.[0]?.sections ?? [];
    const meters = sections.reduce((s, x) => s + (x.summary?.length ?? 0), 0);
    const seconds = sections.reduce((s, x) => s + (x.summary?.duration ?? 0), 0);
    const r = meters > 0 ? { miles: Math.round(meters / 1609.34), hours: Math.round((seconds / 3600) * 10) / 10 } : null;
    routes.set(key, { at: Date.now(), route: r });
    return r;
  } catch (e) {
    console.error("[routing] failed", e);
    return null;
  }
}

/** When the truck gets to a stop by road, counting a 10-hour reset if the driver's hours run out on the way. */
export async function routedEta(truck: Truck, driver: Driver | undefined, city: string, state: string, now: number): Promise<number | null> {
  const pos = truck.position;
  if (!pos || now - Date.parse(pos.at) > 30 * 60_000) return null;
  const r = await route({ lat: pos.lat, lon: pos.lon }, { city, state });
  if (!r) return null;
  const clocksFresh = driver?.hos && now - Date.parse(driver.hos.at) < 2 * 3600_000;
  const left = clocksFresh ? Math.min(driver!.hos!.drive, driver!.hos!.shift) : Infinity;
  return now + (r.hours + (r.hours > left ? 10 : 0)) * 3600_000;
}
