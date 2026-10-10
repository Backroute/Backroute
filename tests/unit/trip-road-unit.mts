// A partial's miles on a trip by truck road (agent/trips byRoad), against the HERE stand-in, which answers road miles
// as 1.25 times straight-line between the cities it knows.
import { byRoad, tripFit } from "../../src/lib/agent/trips";
import { roughCoords } from "../../src/lib/trip-geo";

let passed = 0,
  failed = 0;
const check = (label: string, ok: boolean, extra: unknown = "") => {
  ok ? passed++ : failed++;
  console.log(`${ok ? "PASS" : "FAIL"} ${label}${!ok && extra !== "" ? ` (${JSON.stringify(extra)})` : ""}`);
};

// The stand-in's places and its road miles.
const AT: Record<string, [number, number]> = { "Dallas,TX": [32.7767, -96.797], "Little Rock,AR": [34.7465, -92.2896], "Memphis,TN": [35.1495, -90.049] };
const hav = (a: [number, number], b: [number, number]) => {
  const rad = (d: number) => (d * Math.PI) / 180;
  const h = Math.sin(rad(b[0] - a[0]) / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(rad(b[1] - a[1]) / 2) ** 2;
  return 2 * 3958.8 * Math.asin(Math.sqrt(h)) * 1.25;
};

const now = Date.parse("2026-10-05T13:00:00Z");
const lane = (o: string, os: string, d: string, ds: string, miles: number) => ({ origin: o, originState: os, destination: d, destState: ds, miles, marketRpm: 0 });
const P = (id: string, l: ReturnType<typeof lane>, extra: Record<string, unknown> = {}) =>
  ({ id, referenceNumber: id.toUpperCase(), lane: l, equipmentType: "Dry Van", weight: 6000, partial: { feet: 12 }, stage: "dispatched", truckId: "t1", pickupWindow: "", deliveryWindow: "", ...extra }) as never;
const A = P("a", lane("Dallas", "TX", "Memphis", "TN", 452));
const B = P("b", lane("Little Rock", "AR", "Memphis", "TN", 137), { stage: "offered" });
const truck = { id: "t1", currentLoadId: "a", nextLoadId: null, status: "on_load", currentCity: "Dallas", currentState: "TX", equipmentType: "Dry Van", driverId: "d1", mpg: 6.5 } as never;
const ctx = { loads: [A], drivers: [{ id: "d1", hoursRemaining: 11 }] } as never;

const fit = tripFit(ctx, truck, B, now);
check("a Little Rock partial fits on the truck's Dallas-to-Memphis partial", !!fit && fit.order.length === 4, fit?.order);
const road = fit ? await byRoad(fit, 137) : null;
check("…measured again by truck road", !!road?.byRoad);

// What the road miles should be: from where the trip starts, through the stops in the chosen order.
const start = roughCoords("Dallas", "TX")!.at;
const drive = (order: { loadId: string; kind: string }[]) => {
  let from: [number, number] = start;
  let miles = 0;
  for (const s of order) {
    const l = (s.loadId === "a" ? A : B) as unknown as { lane: ReturnType<typeof lane> };
    const to = AT[s.kind === "pickup" ? `${l.lane.origin},${l.lane.originState}` : `${l.lane.destination},${l.lane.destState}`];
    if (to[0] !== from[0] || to[1] !== from[1]) miles += Math.round(hav(from, to));
    from = to;
  }
  return miles;
};
if (fit && road) {
  const after = drive(fit.order);
  const before = drive(fit.before ?? []);
  check("…the trip's miles are the road's, through every stop", Math.abs(road.run.miles - after) <= 3, { road: road.run.miles, expected: after, estimate: fit.run.miles });
  check("…and the miles the load adds are road miles too, against the trip without it", Math.abs(road.added - (after - before)) <= 3 && road.extra === road.added - 137, { road: road.added, expected: after - before, estimate: fit.added });
  check("…which differ from the estimate here (the stand-in's roads are longer)", road.run.miles !== fit.run.miles, { road: road.run.miles, estimate: fit.run.miles });
}

// A place the routing service doesn't know: the estimate stands.
const W = P("w", lane("Waco", "TX", "Memphis", "TN", 560), { stage: "offered" });
const fitW = tripFit(ctx, truck, W, now);
const roadW = fitW ? await byRoad(fitW, 560) : null;
check("a stop the routing service can't find keeps the estimate", !!fitW && roadW === fitW && !roadW.byRoad);

// Without routing set up, nothing changes.
const key = process.env.HERE_API_KEY;
delete process.env.HERE_API_KEY;
check("without HERE set up, the estimate stands", !!fit && (await byRoad(fit, 137)) === fit);
process.env.HERE_API_KEY = key;

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
