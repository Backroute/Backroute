import type { Load, LoadStage } from "./types";

export type LatLng = [number, number];

/** Every city a lane or truck can sit in (see LANES and US_CITY_PAIRS in mock-data). */
const CITY_COORDS: Record<string, LatLng> = {
  "Atlanta, GA": [33.749, -84.388],
  "Austin, TX": [30.2672, -97.7431],
  "Charlotte, NC": [35.2271, -80.8431],
  "Chicago, IL": [41.8781, -87.6298],
  "Columbus, OH": [39.9612, -82.9988],
  "Dallas, TX": [32.7767, -96.797],
  "Fort Worth, TX": [32.7555, -97.3308],
  "Garland, TX": [32.9126, -96.6389],
  "Grand Prairie, TX": [32.7459, -96.9978],
  "Haslet, TX": [32.9746, -97.3478],
  "Coppell, TX": [32.9546, -97.015],
  "Denver, CO": [39.7392, -104.9903],
  "Houston, TX": [29.7604, -95.3698],
  "Indianapolis, IN": [39.7684, -86.1581],
  "Kansas City, MO": [39.0997, -94.5786],
  "Lancaster, TX": [32.5921, -96.7561],
  "Los Angeles, CA": [34.0522, -118.2437],
  "Memphis, TN": [35.1495, -90.049],
  "Nashville, TN": [36.1627, -86.7816],
  "Newark, NJ": [40.7357, -74.1724],
  "Oklahoma City, OK": [35.4676, -97.5164],
  "Orlando, FL": [28.5383, -81.3792],
  "Phoenix, AZ": [33.4484, -112.074],
  "Portland, OR": [45.5152, -122.6784],
  "Salt Lake City, UT": [40.7608, -111.891],
  "San Antonio, TX": [29.4241, -98.4936],
  "San Diego, CA": [32.7157, -117.1611],
  "Seattle, WA": [47.6062, -122.3321],
  "Tyler, TX": [32.3513, -95.3011],
  "Waco, TX": [31.5493, -97.1467],
  "Wilmer, TX": [32.5893, -96.6853],
};

export function cityCoords(city: string, state: string): LatLng | undefined {
  return CITY_COORDS[`${city}, ${state}`];
}

/** Like cityCoords, but home bases around Dallas–Fort Worth (Plano, Irving, Arlington…) count as the metro. */
export function placeCoords(city: string, state: string): LatLng | undefined {
  return cityCoords(city, state) ?? (state === "TX" ? cityCoords("Dallas", "TX") : undefined);
}

/** Straight-line distance times the usual detour of real roads. */
export function roadMiles(a: LatLng, b: LatLng): number {
  return distanceMiles(a, b) * 1.18;
}

/** Hours of work a load takes: the empty drive to it, loading, the loaded miles and unloading (2 hours each dock). */
export function legHours(miles: number, deadheadMiles: number): number {
  return (miles + deadheadMiles) / 50 + 4;
}

/** Great-circle distance in miles. */
export function distanceMiles(a: LatLng, b: LatLng): number {
  const rad = Math.PI / 180;
  const dLat = (b[0] - a[0]) * rad;
  const dLng = (b[1] - a[1]) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(dLng / 2) ** 2;
  return 3958.8 * 2 * Math.asin(Math.sqrt(h));
}

/** Demo pacing: a leg "drives" in this long of real time, so the map and bar visibly move while you watch.
 *  The driver can still swipe early — they, not the timer, decide when they've actually arrived. */
const DEMO_LEG_MS = { pickup: 45_000, delivery: 90_000 } as const;
/** Loads already rolling when the app opens start partway down the road, not parked at the origin. */
const SEEDED_HEAD_START_MS = 30_000;
const SESSION_START = typeof window === "undefined" ? 0 : Date.now();
const AVG_MPH = 52;

export type TripLeg = "pickup" | "delivery";

export function legFor(stage: LoadStage): TripLeg | null {
  if (stage === "dispatched" || stage === "at_pickup") return "pickup";
  if (stage === "in_transit" || stage === "at_delivery") return "delivery";
  return null;
}

/** 0–1 along the current leg. Arrival stages (at_pickup / at_delivery) are the end of their leg; a leg that's
 *  still driving tops out just short of 1 until the driver actually swipes that they've arrived. */
export function legProgress(load: Load, now: number | null): number {
  if (load.stage === "at_pickup" || load.stage === "at_delivery") return 1;
  const leg = legFor(load.stage);
  if (!leg || now === null) return 0;
  const started = Math.max(Date.parse(load.updatedAt), SESSION_START - SEEDED_HEAD_START_MS);
  return Math.min(0.98, Math.max(0, (now - started) / DEMO_LEG_MS[leg]));
}

export function legMiles(load: Load, leg: TripLeg): number {
  return leg === "pickup" ? Math.max(8, load.deadheadMiles) : load.lane.miles;
}

export function formatEta(milesLeft: number): string {
  const mins = Math.round((milesLeft / AVG_MPH) * 60);
  if (mins < 1) return "Arriving";
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

/** Where the pickup leg starts: the truck's last known city, or — when it's already parked in the pickup
 *  city — a point its deadhead distance back, on the side away from the delivery. */
export function pickupLegStart(load: Load, truckCity: string | undefined, truckState: string | undefined): LatLng | undefined {
  const origin = cityCoords(load.lane.origin, load.lane.originState);
  const dest = cityCoords(load.lane.destination, load.lane.destState);
  if (!origin) return undefined;
  const truckAt = truckCity && truckState ? cityCoords(truckCity, truckState) : undefined;
  if (truckAt && (truckAt[0] !== origin[0] || truckAt[1] !== origin[1])) return truckAt;
  const miles = Math.max(8, load.deadheadMiles);
  const away = dest ? [origin[0] - dest[0], origin[1] - dest[1]] : [0, -1];
  const len = Math.hypot(away[0], away[1]) || 1;
  const latPerMile = 1 / 69;
  const lngPerMile = 1 / (69 * Math.cos((origin[0] * Math.PI) / 180));
  return [origin[0] + (away[0] / len) * miles * latPerMile, origin[1] + (away[1] / len) * miles * lngPerMile];
}

/** Delivery timing a broker would post for a run this long: short hauls deliver the same day, a day's drive the next. */
export function transitWindow(miles: number): string {
  if (miles <= 60) return "Same day, by appointment";
  if (miles <= 300) return "Same day";
  if (miles <= 600) return "Next day";
  return `${Math.ceil(miles / 500)} day transit`;
}
