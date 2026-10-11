// The 50-item round: the driver app in every language, IFTA from the ELD and the rate file, and the rest of the list.
import { addReading, fleetStateMiles, gallonsInQuarter, iftaReturn, parseIftaMatrix, quarterOf, quarterRange } from "../../src/lib/ifta.ts";
import { TRIP } from "../../src/lib/lang/trip-ui.ts";
import { PAGES } from "../../src/lib/lang/pages-ui.ts";
import { DVIR_CHECKLIST } from "../../src/lib/dvir.ts";
import { tripState } from "../../src/lib/trip-state.ts";

let pass = 0, fail = 0;
const ok = (label: string, c: boolean, x?: unknown) => { if (c) { pass++; console.log("PASS", label); } else { fail++; console.log("FAIL", label, x === undefined ? "" : JSON.stringify(x)); } };

// Every language has every word the English has (a missing key would show "undefined" on a driver's screen).
const keysOf = (o: unknown, at = ""): string[] =>
  o && typeof o === "object" && !Array.isArray(o) ? Object.entries(o).flatMap(([k, v]) => [`${at}${k}`, ...keysOf(v, `${at}${k}.`)]) : [];
for (const [name, set] of [["trip", TRIP], ["pages", PAGES]] as const) {
  const en = keysOf(set.en).sort().join();
  for (const [lang, words] of Object.entries(set)) ok(`${name} words complete in ${lang}`, keysOf(words).sort().join() === en);
}
ok("the inspection list is translated item for item", Object.values(PAGES).every((p) => p.insp.items.length === DVIR_CHECKLIST.length));
ok("Spanish trip steps aren't English", TRIP.es.swipeArrive !== TRIP.en.swipeArrive && TRIP.es.next.toShipper !== TRIP.en.next.toShipper);

// Each next step and drive word has a key the driver's language can say.
const load = (stage: string, extra: object = {}) => ({ id: "l", stage, lane: { origin: "Dallas", originState: "TX", destination: "Memphis", destState: "TN", miles: 450 }, documents: [], ...extra }) as any;
const booking = tripState(load("negotiating"), null, false);
ok("booking's next step has a key", booking.next.key === "negotiating" && TRIP.pa.next[booking.next.key].length > 0);
const atPickup = tripState(load("at_pickup"), Date.now(), false);
ok("at the shipper: get loaded, and the drive word translates", atPickup.next.key === "getLoaded" && atPickup.driveKey === "arrived" && TRIP.ru.drive.arrived === "На месте");

// IFTA: miles by state from one ELD reading to the next.
const t0 = { lat: 32.78, lon: -96.8, odometer: 1000, state: "TX", at: "2026-10-01T10:00:00Z" };
let r = addReading(undefined, undefined, t0);
ok("the first reading only starts the count", r.added === 0 && Object.keys(r.quarters).length === 0);
r = addReading(r.quarters, r.track, { lat: 33.5, lon: -96.6, odometer: 1060, state: "TX", at: "2026-10-01T11:00:00Z" });
ok("odometer miles go to the state", r.quarters["2026-Q4"]?.TX === 60, r.quarters);
r = addReading(r.quarters, r.track, { lat: 34.0, lon: -96.4, odometer: 1100, state: "OK", at: "2026-10-01T12:00:00Z" });
ok("a state line crossed between readings splits the miles", r.quarters["2026-Q4"].TX === 80 && r.quarters["2026-Q4"].OK === 20, r.quarters);
const noOdo = addReading(r.quarters, { ...r.track, odometer: undefined }, { lat: 34.5, lon: -96.4, state: "OK", at: "2026-10-01T13:00:00Z" });
ok("without an odometer, the distance between the spots (road-adjusted)", noOdo.added > 34 && noOdo.added < 45, noOdo.added);
const jump = addReading(r.quarters, r.track, { lat: 34.0, lon: -96.4, odometer: 5000, state: "OK", at: "2026-10-01T14:00:00Z" });
ok("a jump of thousands of miles is a data gap, not driving", jump.added === 0);
const older = addReading(r.quarters, r.track, { ...t0, at: "2026-09-30T00:00:00Z" });
ok("an older reading adds nothing", older.added === 0);
ok("quarters", quarterOf("2026-11-03") === "2026-Q4" && quarterRange("2026-Q1").to === "2026-03-31" && quarterRange("2026-Q4").from === "2026-10-01");
ok("fleet miles add up across trucks", fleetStateMiles([{ stateMiles: { "2026-Q4": { TX: 10 } } }, { stateMiles: { "2026-Q4": { TX: 5, OK: 3 } } }, {}], "2026-Q4").TX === 15);

// The rate matrix: read from the file, never made up.
const matrix = `IFTA Tax Rate Matrix,4th Quarter 2026
Jurisdiction,Gasoline (U.S.),Special Diesel (U.S.),Special Diesel (Canadian)
Texas,0.2000,0.2000,0.0728
Oklahoma,0.1900,0.1900,0.0691
Arkansas,0.2450,0.2850,0.1037
Tennessee,0.2700,0.2800,0.1019
Louisiana,0.2000,0.2000,0.0728
Ontario,0.0000,0.4520,0.1450`;
const parsed = parseIftaMatrix(matrix);
ok("the US diesel column is read by state", "rates" in parsed && parsed.rates.TX === 0.2 && parsed.rates.AR === 0.285 && parsed.rates.ON === 0.452, parsed);
ok("a file without the columns is refused", "error" in parseIftaMatrix("a,b\n1,2"));

// The return: taxable gallons from fleet MPG, minus gallons bought there, times the rate.
const ret = iftaReturn({ TX: 600, OK: 400 }, { TX: 150, OK: 50 }, { TX: 0.2, OK: 0.19 });
ok("fleet MPG is all miles over all gallons", ret.mpg === 5);
const tx = ret.lines.find((l) => l.state === "TX")!;
const okl = ret.lines.find((l) => l.state === "OK")!;
ok("bought more than burned in TX: a credit", tx.taxableGallons === 120 && tx.net === -6);
ok("burned more than bought in OK: owed", okl.taxableGallons === 80 && okl.net === 5.7);
ok("net across states", ret.net === -0.3);
ok("a state without a rate is called out, not guessed", iftaReturn({ TX: 100, NM: 100 }, { TX: 40 }, { TX: 0.2 }).missingRates.join() === "NM");
const fuel = [
  { product: "diesel", state: "TX", date: "2026-10-04", gallons: 100 },
  { product: "def", state: "TX", date: "2026-10-04", gallons: 5 },
  { product: "diesel", state: "OK", date: "2026-09-30", gallons: 80 },
] as any;
ok("gallons by state count diesel inside the quarter only", JSON.stringify(gallonsInQuarter(fuel, "2026-Q4")) === JSON.stringify({ TX: 100 }));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
