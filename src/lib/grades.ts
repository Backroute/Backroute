import { cityCoords } from "./trip-geo";

/**
 * The long, steep interstate grades truck drivers plan around, by the summit's rough position. Checked against the
 * straight line between a load's pickup and delivery, so it's a heads-up ("on the way, probably"), not a route.
 */
export const GRADES: { name: string; road: string; state: string; lat: number; lon: number; winter?: boolean }[] = [
  { name: "Vail Pass", road: "I-70", state: "CO", lat: 39.53, lon: -106.22, winter: true },
  { name: "Eisenhower Tunnel", road: "I-70", state: "CO", lat: 39.68, lon: -105.91, winter: true },
  { name: "Raton Pass", road: "I-25", state: "NM", lat: 36.99, lon: -104.49, winter: true },
  { name: "Sherman Summit", road: "I-80", state: "WY", lat: 41.24, lon: -105.43, winter: true },
  { name: "Parleys Summit", road: "I-80", state: "UT", lat: 40.76, lon: -111.63, winter: true },
  { name: "Donner Pass", road: "I-80", state: "CA", lat: 39.32, lon: -120.33, winter: true },
  { name: "the Grapevine (Tejon Pass)", road: "I-5", state: "CA", lat: 34.8, lon: -118.88, winter: true },
  { name: "Cajon Pass", road: "I-15", state: "CA", lat: 34.32, lon: -117.47 },
  { name: "Siskiyou Summit", road: "I-5", state: "OR", lat: 42.07, lon: -122.6, winter: true },
  { name: "Cabbage Hill", road: "I-84", state: "OR", lat: 45.62, lon: -118.62, winter: true },
  { name: "Snoqualmie Pass", road: "I-90", state: "WA", lat: 47.42, lon: -121.41, winter: true },
  { name: "Lookout Pass", road: "I-90", state: "ID", lat: 47.46, lon: -115.7, winter: true },
  { name: "Monteagle", road: "I-24", state: "TN", lat: 35.24, lon: -85.84 },
  { name: "Black Mountain (Old Fort)", road: "I-40", state: "NC", lat: 35.62, lon: -82.25 },
  { name: "Fancy Gap", road: "I-77", state: "VA", lat: 36.67, lon: -80.7, winter: true },
  { name: "Sideling Hill", road: "I-68", state: "MD", lat: 39.68, lon: -78.24, winter: true },
];

const R = 3959; // miles
const rad = (d: number) => (d * Math.PI) / 180;

/** Miles from a point to the straight line between two others (fine at these distances). */
function milesFromLine(p: { lat: number; lon: number }, a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const k = Math.cos(rad((a.lat + b.lat) / 2));
  const [ax, ay, bx, by, px, py] = [a.lon * k, a.lat, b.lon * k, b.lat, p.lon * k, p.lat];
  const dx = bx - ax, dy = by - ay;
  const t = dx || dy ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy))) : 0;
  const d = Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
  return rad(d) * R;
}

/** The grades a load likely crosses: within 35 miles of the line between its ends, in order from the pickup. */
export function gradesOnLane(lane: { origin: string; originState: string; destination: string; destState: string }): typeof GRADES {
  const ca = cityCoords(lane.origin, lane.originState), cb = cityCoords(lane.destination, lane.destState);
  if (!ca || !cb) return [];
  const a = { lat: ca[0], lon: ca[1] }, b = { lat: cb[0], lon: cb[1] };
  return GRADES.filter((g) => milesFromLine(g, a, b) <= 35).sort((x, y) => Math.hypot(x.lat - a.lat, x.lon - a.lon) - Math.hypot(y.lat - a.lat, y.lon - a.lon));
}

/** A line for the driver with the new load, or null: the grades, and chain laws in the winter months. */
export function gradeNote(lane: Parameters<typeof gradesOnLane>[0], at = Date.now()): string | null {
  const g = gradesOnLane(lane);
  if (!g.length) return null;
  const month = new Date(at).getUTCMonth();
  const winter = (month >= 9 || month <= 3) && g.some((x) => x.winter);
  return `Grades on the way: ${g.map((x) => `${x.name} (${x.road}, ${x.state})`).join(", ")}. Check brakes before, gear down, and use the brake check areas.${winter ? " Chain laws can be on this time of year: carry chains and check the state's road report." : ""}`;
}
