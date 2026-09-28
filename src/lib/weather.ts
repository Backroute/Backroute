import "server-only";

/**
 * Weather that matters to a truck, from the National Weather Service (free, no key; US only): active warnings and
 * advisories at a point, like winter storms, ice, high wind, dense fog, floods. Off with WEATHER_ALERTS=off.
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
  const base = (process.env.WEATHER_API_BASE ?? "https://api.weather.gov").replace(/\/$/, "");
  try {
    const res = await fetch(`${base}/alerts/active?point=${lat.toFixed(4)},${lon.toFixed(4)}`, {
      headers: { accept: "application/geo+json", "user-agent": `Backroute dispatch (${process.env.SUPPORT_EMAIL ?? "support@backroute.app"})` },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { features?: { properties?: { event?: string; headline?: string; severity?: string } }[] };
    const seen = new Set<string>();
    return (data.features ?? [])
      .map((f) => f.properties ?? {})
      .filter((p) => p.event && (MATTERS.test(p.event) || p.severity === "Severe" || p.severity === "Extreme"))
      .filter((p) => (seen.has(p.event!) ? false : (seen.add(p.event!), true)))
      .slice(0, 3)
      .map((p) => ({ event: p.event!, headline: (p.headline ?? p.event!).slice(0, 200), severity: p.severity ?? "Unknown" }));
  } catch {
    return [];
  }
}
