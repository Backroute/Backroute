// Nothing that sends a truck the wrong way: the polyline decoder, progress from the real position, the dock target,
// and lane comparisons only against a real market rate.
import { decodeFlexPolyline } from "../../src/lib/flexpolyline.ts";
import { legProgressInfo, setLocator } from "../../src/lib/trip-geo";
import { dockOf, dockSearchText } from "../../src/lib/dock-spot.ts";
import { laneHistory } from "../../src/lib/lane-history.ts";

let pass = 0, fail = 0;
const ok = (label: string, cond: boolean, extra?: unknown) => { cond ? pass++ : fail++; console.log(`${cond ? "PASS" : "FAIL"} ${label}${!cond && extra !== undefined ? ` (${JSON.stringify(extra)})` : ""}`); };

// HERE's own example from the flexible-polyline spec.
const pts = decodeFlexPolyline("BFoz5xJ67i1B1B7PzIhaxL7Y");
ok("decodes HERE's sample polyline", pts.length === 4 && Math.abs(pts[0][0] - 50.10228) < 1e-5 && Math.abs(pts[0][1] - 8.69821) < 1e-5 && Math.abs(pts[3][0] - 50.09878) < 1e-5 && Math.abs(pts[3][1] - 8.68752) < 1e-5, pts);
let threw = false;
try { decodeFlexPolyline("B!"); } catch { threw = true; }
ok("refuses a broken polyline", threw);

const load = { id: "L1", truckId: "t1", stage: "in_transit", updatedAt: new Date().toISOString(), deadheadMiles: 20, lane: { origin: "Dallas", originState: "TX", destination: "Memphis", destState: "TN", miles: 452 }, documents: [], rateConReading: { receiver: "Kroger DC", receiverAddress: null } } as never;

setLocator(() => "simulate");
ok("demo: the simulated drive", legProgressInfo(load, Date.now() + 30_000).located);
setLocator(() => null);
const blind = legProgressInfo(load, Date.now() + 60_000);
ok("real truck with no GPS: not located, no made-up progress", !blind.located && blind.p === 0, blind);
setLocator(() => ({ lat: 35.15, lon: -90.2 })); // just outside Memphis
const near = legProgressInfo(load, Date.now());
ok("real truck near Memphis: nearly there, from GPS", near.located && near.p > 0.9, near);
setLocator(() => ({ lat: 32.78, lon: -96.8 })); // still in Dallas
ok("real truck still in Dallas: at the start", legProgressInfo(load, Date.now() + 600_000).p < 0.05);
setLocator(null);

const dock = dockOf(load, "delivery");
ok("no street address: says the facility and city, never coordinates", dock.address === null && dockSearchText(dock) === "Kroger DC, Memphis, TN");
const withAddr = dockOf({ ...(load as object), deliveryAddress: "4500 Industrial Pkwy, Memphis, TN 38118" } as never, "delivery");
ok("the office's address wins", dockSearchText(withAddr) === "4500 Industrial Pkwy, Memphis, TN 38118");

const lane = (rpm: number, month: string, market?: number) => ({ stage: "delivered", rpm, lane: { originState: "TX", destState: "TN", miles: 450, marketRpm: rpm }, pickupAt: `${month}-03T00:00:00Z`, createdAt: "x", ...(market ? { market: { rpm: market, source: "dat" } } : {}) }) as never;
const typed = laneHistory([lane(2.6, "2026-08"), lane(2.8, "2026-09")], { serviceOnly: true });
ok("real account, typed-in loads: no fake market", typed[0].market === null && typed[0].vsMarket === null && typed[0].yours === 2.7, typed[0]);
const rated = laneHistory([lane(2.6, "2026-08", 2.5), lane(2.8, "2026-09")], { serviceOnly: true });
ok("a rate service's market counts", rated[0].market === 2.5 && rated[0].points[1].market === null, rated[0]);

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
