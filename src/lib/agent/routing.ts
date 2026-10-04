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
  /** Live routes: the drive time with no traffic, so the traffic's share is `hours - freeHours`. */
  freeHours?: number;
  /** Live routes: the road itself, thinned to about 100 points (for weather along the way). */
  path?: [number, number][];
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

/**
 * Road miles and driving hours for a truck between two places, or null (not set up, or the service had no route).
 * `live` is for an ETA: traffic now, kept for 15 minutes; otherwise typical times, kept for a day.
 */
export async function route(from: Place, to: Place, opts: { live?: boolean } = {}): Promise<Route | null> {
  if (!routingConfigured()) return null;
  try {
    const [a, b] = await Promise.all([point(from), point(to)]);
    if (!a || !b) return null;
    // Positions are rounded to about a kilometer so a moving truck still hits the cache.
    const key = `${opts.live ? "live:" : ""}${a.lat.toFixed(2)},${a.lon.toFixed(2)}>${b.lat.toFixed(2)},${b.lon.toFixed(2)}`;
    const hit = routes.get(key);
    if (hit && Date.now() - hit.at < (opts.live ? 15 * 60_000 : FRESH)) return hit.route;
    const when = opts.live ? `&departureTime=${encodeURIComponent(new Date().toISOString().replace(/\.\d{3}Z$/, "Z"))}` : "&departureTime=any";
    const body = (await get(`${ROUTER()}/v8/routes?transportMode=truck&origin=${a.lat},${a.lon}&destination=${b.lat},${b.lon}&return=summary${opts.live ? ",polyline" : ""}${when}&apiKey=${encodeURIComponent(process.env.HERE_API_KEY!)}`)) as {
      routes?: { sections?: { summary?: { length?: number; duration?: number; baseDuration?: number }; polyline?: string }[] }[];
    };
    const sections = body.routes?.[0]?.sections ?? [];
    const meters = sections.reduce((s, x) => s + (x.summary?.length ?? 0), 0);
    const seconds = sections.reduce((s, x) => s + (x.summary?.duration ?? 0), 0);
    const base = sections.reduce((s, x) => s + (x.summary?.baseDuration ?? x.summary?.duration ?? 0), 0);
    let path: [number, number][] | undefined;
    if (opts.live) {
      const { decodeFlexPolyline } = await import("../flexpolyline");
      const all = sections.flatMap((x) => (x.polyline ? decodeFlexPolyline(x.polyline) : []));
      const step = Math.max(1, Math.ceil(all.length / 100));
      if (all.length >= 2) path = all.filter((_, i) => i % step === 0 || i === all.length - 1);
    }
    const r = meters > 0 ? { miles: Math.round(meters / 1609.34), hours: Math.round((seconds / 3600) * 10) / 10, ...(opts.live ? { freeHours: Math.round((base / 3600) * 10) / 10, ...(path ? { path } : {}) } : {}) } : null;
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
  const r = await route({ lat: pos.lat, lon: pos.lon }, { city, state }, { live: true });
  if (!r) return null;
  const clocksFresh = driver?.hos && now - Date.parse(driver.hos.at) < 2 * 3600_000;
  const left = clocksFresh ? Math.min(driver!.hos!.drive, driver!.hos!.shift) : Infinity;
  return now + (r.hours + (r.hours > left ? 10 : 0)) * 3600_000;
}

// ─── For the driver's screen: the dock's exact spot, and the truck's road to it ──────────────────────────────

/** A dock's street address to its exact spot, for the driver's truck GPS. Null when not set up or not found. */
export async function geocodeAddress(address: string): Promise<{ lat: number; lon: number } | null> {
  if (!routingConfigured()) return null;
  const key = `addr:${address.trim().toLowerCase()}`;
  if (places.has(key)) return places.get(key)!;
  try {
    const body = (await get(`${GEOCODE()}/v1/geocode?q=${encodeURIComponent(address)}&in=countryCode:USA,CAN&limit=1&apiKey=${encodeURIComponent(process.env.HERE_API_KEY!)}`)) as {
      items?: { position?: { lat: number; lng: number }; resultType?: string }[];
    };
    const item = body.items?.[0];
    // Only a street-level answer: a city or ZIP match would put the pin in the wrong place.
    const exact = item?.position && ["houseNumber", "street", "place", "intersection"].includes(item.resultType ?? "");
    const found = exact ? { lat: item!.position!.lat, lon: item!.position!.lng } : null;
    places.set(key, found);
    return found;
  } catch (e) {
    console.error("[routing] geocode failed", e);
    return null;
  }
}

export interface TruckSize {
  heightIn: number;
  weightLbs: number;
  lengthFt: number;
}

const paths = new Map<string, { at: number; path: [number, number][] | null }>();

/** The road a truck of this size takes (HERE, truck mode: no low bridges, parkways or truck-restricted roads). */
export async function truckPath(from: Point, to: Point, size: TruckSize): Promise<[number, number][] | null> {
  if (!routingConfigured()) return null;
  const key = `${from.lat.toFixed(2)},${from.lon.toFixed(2)}>${to.lat.toFixed(3)},${to.lon.toFixed(3)}:${size.heightIn}:${size.weightLbs}:${size.lengthFt}`;
  const hit = paths.get(key);
  if (hit && Date.now() - hit.at < FRESH) return hit.path;
  try {
    const vehicle = `&vehicle[height]=${Math.round(size.heightIn * 2.54)}&vehicle[grossWeight]=${Math.round(size.weightLbs * 0.4536)}&vehicle[length]=${Math.round(size.lengthFt * 30.48)}`;
    const body = (await get(`${ROUTER()}/v8/routes?transportMode=truck&origin=${from.lat},${from.lon}&destination=${to.lat},${to.lon}&return=polyline${vehicle}&apiKey=${encodeURIComponent(process.env.HERE_API_KEY!)}`)) as {
      routes?: { sections?: { polyline?: string }[] }[];
    };
    const { decodeFlexPolyline } = await import("../flexpolyline");
    const all = (body.routes?.[0]?.sections ?? []).flatMap((x) => (x.polyline ? decodeFlexPolyline(x.polyline) : []));
    // Thinned for the phone: about 400 points is plenty for a map line.
    const step = Math.max(1, Math.ceil(all.length / 400));
    const path = all.length >= 2 ? all.filter((_, i) => i % step === 0 || i === all.length - 1) : null;
    paths.set(key, { at: Date.now(), path });
    return path;
  } catch (e) {
    console.error("[routing] truck path failed", e);
    return null;
  }
}
