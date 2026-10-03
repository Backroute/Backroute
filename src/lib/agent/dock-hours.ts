import "server-only";
import type { FacilityHours, FacilityRef } from "./facility-notes";
import { placesConfigured } from "./roadside";

/**
 * A shipper's or receiver's posted hours (Google Places), for docks no driver has reported on yet. Posted hours are
 * often the office's, not the dock's, so they're only ever a heads-up to the owner and the driver; drivers' own word
 * (lib/agent/facility-notes) wins whenever there is one, and only that can stop a booking.
 */

const PLACES = () => process.env.PLACES_API_BASE?.replace(/\/$/, "") ?? "https://places.googleapis.com";
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAY = 86400_000;
const cache = new Map<string, { hours: FacilityHours | null; at: number }>();

interface Period {
  open?: { day?: number; hour?: number; minute?: number };
  close?: { day?: number; hour?: number; minute?: number };
}

const hhmm = (t?: { hour?: number; minute?: number }) => (t ? `${String(t.hour ?? 0).padStart(2, "0")}:${String(t.minute ?? 0).padStart(2, "0")}` : undefined);
const mostCommon = (xs: string[]) => {
  const n = new Map<string, number>();
  for (const x of xs) n.set(x, (n.get(x) ?? 0) + 1);
  return [...n.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
};

/** Places' opening periods as the same hours drivers report: the days it opens, and its usual open and close. */
export function hoursFromPeriods(periods: Period[] | undefined): FacilityHours | null {
  if (!periods?.length) return null;
  // Open around the clock: one period with no close.
  if (periods.length === 1 && !periods[0].close) return {};
  const days = DAYS.filter((_, d) => periods.some((p) => p.open?.day === d));
  const opens = mostCommon(periods.map((p) => hhmm(p.open)).filter((x): x is string => !!x));
  // A close past midnight (or at it) leaves the evening open: no closing time to warn about.
  const closes = mostCommon(periods.filter((p) => p.close && p.close.day === p.open?.day).map((p) => hhmm(p.close)!));
  return {
    ...(days.length && days.length < 7 ? { days } : {}),
    ...(opens && opens !== "00:00" ? { opens } : {}),
    ...(closes ? { closes } : {}),
  };
}

const words = (s: string) => new Set(s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((w) => w.length > 2 && !["inc", "llc", "the", "corp", "company", "warehouse", "distribution", "center"].includes(w)));

/** The place's posted hours, or null when Places isn't set up, can't find it, or found something else by that name. */
export async function postedHours(f: Pick<FacilityRef, "name" | "city" | "state" | "zip">, address?: string | null): Promise<FacilityHours | null> {
  if (!placesConfigured() || !f.name) return null;
  const query = `${f.name}, ${address?.trim() || `${f.city}, ${f.state}${f.zip ? ` ${f.zip}` : ""}`}`;
  const hit = cache.get(query);
  if (hit && Date.now() - hit.at < 7 * DAY) return hit.hours;
  let hours: FacilityHours | null = null;
  try {
    const res = await fetch(`${PLACES()}/v1/places:searchText`, {
      method: "POST",
      headers: { "content-type": "application/json", "X-Goog-Api-Key": process.env.GOOGLE_PLACES_API_KEY!, "X-Goog-FieldMask": "places.displayName,places.regularOpeningHours" },
      body: JSON.stringify({ textQuery: query, maxResultCount: 1 }),
      signal: AbortSignal.timeout(10000),
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`Places ${res.status}`);
    const data = (await res.json()) as { places?: { displayName?: { text?: string }; regularOpeningHours?: { periods?: Period[] } }[] };
    const place = data.places?.[0];
    // Only when it found the same business: a name word in common (a search for a small DC can land on a store).
    const want = words(f.name);
    const same = place?.displayName?.text && [...words(place.displayName.text)].some((w) => want.has(w));
    hours = same ? hoursFromPeriods(place?.regularOpeningHours?.periods) : null;
  } catch (e) {
    console.error("[dock-hours] lookup failed", e);
    return null; // Not cached: try again next time.
  }
  cache.set(query, { hours, at: Date.now() });
  return hours;
}
