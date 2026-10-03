import "server-only";

/**
 * Weather that matters to a truck: active warnings and advisories at a point, like winter storms, ice, high wind, dense
 * fog, floods. In the US from the National Weather Service, in Canada from Environment Canada (both free, no key).
 * Off with WEATHER_ALERTS=off.
 */

export interface WeatherAlert {
  event: string;
  headline: string;
  severity: string;
}

const MATTERS = /winter|ice|freez|blizzard|snow|wind|dust|fog|flood|tornado|hurricane|tropical|storm|heat/i;

export const weatherOn = () => process.env.WEATHER_ALERTS !== "off";

export async function alertsAt(lat: number, lon: number): Promise<WeatherAlert[]> {
  if (!weatherOn()) return [];
  const [us, ca] = await Promise.all([usAlerts(lat, lon), maybeCanada(lat, lon) ? canadaAlerts(lat, lon) : Promise.resolve([])]);
  const seen = new Set<string>();
  return [...us, ...ca].filter((a) => (seen.has(a.event) ? false : (seen.add(a.event), true))).slice(0, 3);
}

async function usAlerts(lat: number, lon: number): Promise<WeatherAlert[]> {
  const base = (process.env.WEATHER_API_BASE ?? "https://api.weather.gov").replace(/\/$/, "");
  try {
    const res = await fetch(`${base}/alerts/active?point=${lat.toFixed(4)},${lon.toFixed(4)}`, {
      headers: { accept: "application/geo+json", "user-agent": `Backroute dispatch (${process.env.SUPPORT_EMAIL ?? "support@backroute.app"})` },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { features?: { properties?: { event?: string; headline?: string; severity?: string } }[] };
    return (data.features ?? [])
      .map((f) => f.properties ?? {})
      .filter((p) => p.event && (MATTERS.test(p.event) || p.severity === "Severe" || p.severity === "Extreme"))
      .map((p) => ({ event: p.event!, headline: (p.headline ?? p.event!).slice(0, 200), severity: p.severity ?? "Unknown" }));
  } catch {
    return [];
  }
}

/** Far enough north that it may be in Canada (Canada's southern tip is about 41.7°N); Alaska is left to the US service. */
const maybeCanada = (lat: number, lon: number) => lat > 41.6 && lon > -141 && lon < -50;

const CA_SEVERITY: Record<string, string> = { warning: "Severe", watch: "Moderate", advisory: "Minor", statement: "Minor" };

/** Environment Canada's active alerts for the area around a point (its GeoMet OGC API, weather-alerts collection). */
async function canadaAlerts(lat: number, lon: number): Promise<WeatherAlert[]> {
  const base = (process.env.WEATHER_CA_API_BASE ?? "https://api.weather.gc.ca").replace(/\/$/, "");
  const d = 0.05;
  const bbox = [lon - d, lat - d, lon + d, lat + d].map((n) => n.toFixed(4)).join(",");
  try {
    const res = await fetch(`${base}/collections/weather-alerts/items?bbox=${bbox}&lang=en&f=json&limit=20`, { headers: { accept: "application/geo+json" }, signal: AbortSignal.timeout(8000) });
    if (!res.ok) return [];
    const data = (await res.json()) as { features?: { properties?: { alert_name_en?: string; alert_short_name_en?: string; alert_type?: string; alert_text_en?: string; status_en?: string } }[] };
    return (data.features ?? [])
      .map((f) => f.properties ?? {})
      .filter((p) => p.alert_name_en && !/ended|cancel/i.test(p.status_en ?? "") && p.alert_type !== "statement" && (MATTERS.test(p.alert_name_en) || p.alert_type === "warning"))
      .map((p) => {
        const event = p.alert_name_en!.replace(/\b\w/g, (c) => c.toUpperCase());
        return { event, headline: (p.alert_text_en ?? event).replace(/\s+/g, " ").slice(0, 200), severity: CA_SEVERITY[p.alert_type ?? ""] ?? "Unknown" };
      });
  } catch {
    return [];
  }
}

/** Points every ~100 miles along a path (the truck's road, or just its two ends), at most `max`. */
export function pointsAlong(path: [number, number][], max = 6): [number, number][] {
  if (path.length < 2) return path;
  const miles = (a: [number, number], b: [number, number]) => {
    const R = 3958.8, r = (x: number) => (x * Math.PI) / 180;
    const h = Math.sin(r(b[0] - a[0]) / 2) ** 2 + Math.cos(r(a[0])) * Math.cos(r(b[0])) * Math.sin(r(b[1] - a[1]) / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  };
  const seg = path.slice(1).map((p, i) => miles(path[i], p));
  const total = seg.reduce((a, b) => a + b, 0);
  const n = Math.min(max, Math.max(2, Math.ceil(total / 100) + 1));
  const out: [number, number][] = [];
  for (let k = 0; k < n; k++) {
    let target = (total * k) / (n - 1);
    let i = 0;
    while (i < seg.length - 1 && target > seg[i]) target -= seg[i++];
    const t = seg[i] ? Math.min(1, target / seg[i]) : 0;
    const [a, b] = [path[i], path[i + 1]];
    out.push([Math.round((a[0] + (b[0] - a[0]) * t) * 1000) / 1000, Math.round((a[1] + (b[1] - a[1]) * t) * 1000) / 1000]);
  }
  return out;
}

/** Warnings anywhere along a path, each with where it is (the point's index), at most one entry per kind of warning. */
export async function alertsAlong(path: [number, number][], max = 6): Promise<(WeatherAlert & { at: [number, number] })[]> {
  const pts = pointsAlong(path, max);
  const found = await Promise.all(pts.map(async (p) => (await alertsAt(p[0], p[1])).map((a) => ({ ...a, at: p }))));
  const seen = new Set<string>();
  return found.flat().filter((a) => (seen.has(a.event) ? false : (seen.add(a.event), true)));
}
