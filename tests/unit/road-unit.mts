// What goes wrong after booking (lib/road-exceptions): extra pay and what it's worth, the driver's share on their pay,
// a shop's ETA, when a breakdown needs another truck, a truck heading the wrong way; and the evening-before text.
import { etaHours, extraAmount, extraPayLines, extraShare, longBreakdown, rateConTerm, recoveryTruck, wrongWay } from "../../src/lib/road-exceptions.ts";
import { eveningFacts } from "../../src/lib/agent/brief.ts";
import { buildPayRun } from "../../src/lib/pay-runs.ts";

let pass = 0, fail = 0;
const ok = (label: string, c: boolean, x?: unknown) => { if (c) { pass++; console.log("PASS", label); } else { fail++; console.log("FAIL", label, x === undefined ? "" : JSON.stringify(x)); } };

// ── The broker's own price, from what they wrote ──
ok("tarp pay on the rate con", rateConTerm("tarp", "Tarp pay $100 if required") === 100);
ok("price before the words", rateConTerm("driver_assist", "Carrier gets $75 for driver assist unload") === 75);
ok("redelivery", rateConTerm("redelivery", "Redelivery: $150") === 150);
ok("out of route a mile", rateConTerm("out_of_route", "Out of route miles paid at $2.25/mi") === 2.25);
ok("nothing said, nothing found", rateConTerm("tarp", "Detention $50/hr after 2 hours") === null);

const load = { bookedRate: 2000, lane: { miles: 800 }, rateConReading: { detention: "$50/hr after 2", finesAndFees: ["Tarp pay $100"], otherConcerns: [], summary: "" }, offerNotes: "" } as never;
ok("tarping: the rate con's price", JSON.stringify(extraAmount({ kind: "tarp" }, load)) === JSON.stringify({ amount: 100, basis: "rate_con" }));
ok("driver assist: the owner's price when the rate con is silent", JSON.stringify(extraAmount({ kind: "driver_assist" }, load, { driver_assist: 85 })) === JSON.stringify({ amount: 85, basis: "owner" }));
ok("and no price at all: ask", extraAmount({ kind: "redelivery" }, load) === null);
ok("a scale ticket is the receipt", JSON.stringify(extraAmount({ kind: "scale", amount: 13.5 }, load)) === JSON.stringify({ amount: 13.5, basis: "receipt" }));
ok("no receipt total, nothing to claim yet", extraAmount({ kind: "reefer_fuel" }, load) === null);
ok("40 miles out of route at the load's $2.50 a mile", JSON.stringify(extraAmount({ kind: "out_of_route", miles: 40 }, load)) === JSON.stringify({ amount: 100, basis: "per_mile" }));
ok("the posting's notes count too", JSON.stringify(extraAmount({ kind: "tarp" }, { ...(load as object), rateConReading: undefined, offerNotes: "Tarps required, $125 tarp pay" } as never)) === JSON.stringify({ amount: 125, basis: "rate_con" }));

// ── The driver's share ──
ok("a 30% driver gets 30% of it", extraShare({ payType: "percentage", payRate: 0.3 }) === 0.3);
ok("a mileage driver gets none unless set", extraShare({ payType: "per_mile", payRate: 0.6 }) === 0 && extraShare({ payType: "per_mile", payRate: 0.6, extraShare: 0.5 }) === 0.5);
const claimed = { referenceNumber: "A-1", extraClaims: [
  { id: "1", kind: "tarp", detail: "", at: "", amount: 100, sentAt: "2026-10-12T10:00:00Z" },
  { id: "2", kind: "scale", detail: "", at: "", amount: 13, sentAt: "2026-10-12T10:00:00Z" },
  { id: "3", kind: "driver_assist", detail: "", at: "", amount: 80 },
] } as never;
const lines = extraPayLines(claimed, { payType: "percentage", payRate: 0.3 });
ok("only work they did, only once it's claimed", lines.length === 1 && lines[0].label === "Tarping on A-1" && lines[0].amount === 30, lines);
ok("a team splits it", extraPayLines(claimed, { payType: "percentage", payRate: 0.3 }, true)[0].amount === 15);

const run = buildPayRun({
  driver: { id: "d1", carrierId: "c", name: "Ana Diaz", payType: "percentage", payRate: 0.3 } as never,
  period: "2026-10-12",
  loads: [{ id: "l1", referenceNumber: "A-1", stage: "delivered", truckId: "t1", bookedRate: 2000, lane: { origin: "A", originState: "TX", destination: "B", destState: "TN", miles: 500 }, tripChecklist: { unloadedAt: "2026-10-13T15:00:00Z" }, updatedAt: "2026-10-13T15:00:00Z", extraClaims: (claimed as { extraClaims: unknown[] }).extraClaims } as never],
  trucks: [{ id: "t1", driverId: "d1" } as never],
  expenses: [],
  advances: [],
  runs: [],
});
ok("on the pay run: 30% of the load plus 30% of the tarp pay", run.gross === 630 && run.extras.some((e) => e.label === "Tarping on A-1"), run);

// ── How long the shop said ──
ok("about 90 minutes", etaHours("about 90 minutes") === 1.5);
ok("two to three hours: the long end", etaHours("2-3 hours") === 3);
ok("an hour", etaHours("an hour or so") === 1);
ok("tomorrow morning", etaHours("first thing tomorrow morning") === 16);
ok("on Monday", etaHours("not until Monday") === 24);
ok("on our way", etaHours("we're on our way") === 1);
ok("didn't say", etaHours(null) === null && etaHours("we can help") === null);

// ── A long breakdown ──
const now = Date.parse("2026-10-14T22:00:00Z");
const H = 3600_000;
ok("nobody could come", longBreakdown({ at: new Date(now - H).toISOString(), exhausted: true }, now) === "no repair shop or tow could come");
ok("the shop said tomorrow", /tomorrow/.test(longBreakdown({ at: new Date(now - H).toISOString(), found: { shop: "A", phone: "1", eta: "tomorrow at 8" } }, now) ?? ""));
ok("the shop is coming in an hour: not long", longBreakdown({ at: new Date(now - H).toISOString(), found: { shop: "A", phone: "1", eta: "about an hour" } }, now) === null);
ok("three hours and no shop", longBreakdown({ at: new Date(now - 3.5 * H).toISOString() }, now) === "no shop has taken it in three hours");

// ── A truck to repower it ──
const truck = (id: string, city: string, state: string, extra: object = {}) => ({ id, unitNumber: id.toUpperCase(), equipmentType: "Dry Van", driverId: `d-${id}`, status: "available", currentCity: city, currentState: state, ...extra }) as never;
const broken = truck("t1", "Dallas", "TX");
const fleet = [broken, truck("t2", "Houston", "TX"), truck("t3", "Waco", "TX", { equipmentType: "Reefer" }), truck("t4", "Fort Worth", "TX", { currentLoadId: "busy" }), truck("t5", "Denver", "CO")];
const loads = [{ id: "busy", stage: "in_transit" }] as never;
const rescue = recoveryTruck(broken, fleet, loads, now);
ok("the closest free van: Houston, not the reefer, not the loaded truck", (rescue?.truck as { id: string } | undefined)?.id === "t2" && rescue!.miles > 200 && rescue!.miles < 300, rescue && { id: (rescue.truck as { id: string }).id, miles: rescue.miles });
ok("nothing within 300 miles", recoveryTruck(broken, [broken, fleet[4]], [], now) === null);

// ── The wrong way ──
const before = { miles: 120, at: new Date(now - 30 * 60_000).toISOString() };
ok("15 miles farther in half an hour", wrongWay(before, 135, now) === 15);
ok("closer: fine", wrongWay(before, 100, now) === null);
ok("a few miles off (a fuel stop): fine", wrongWay(before, 126, now) === null);
ok("already at the stop: not counted", wrongWay({ miles: 8, at: before.at }, 30, now) === null);
ok("a reading three hours old: not compared", wrongWay({ miles: 120, at: new Date(now - 3 * H).toISOString() }, 200, now) === null);

// ── The evening before ──
const eve = Date.parse("2026-10-14T00:30:00Z"); // 7:30 PM Central, Oct 13
const tomorrowLoad = { id: "n1", referenceNumber: "N-1", truckId: "t1", stage: "booked", pickupAt: "2026-10-14T13:00:00Z", lane: { origin: "Houston", originState: "TX", destination: "Memphis", destState: "TN" }, pickupAddress: "100 Main St" } as never;
const f = eveningFacts([tomorrowLoad], truck("t1", "Dallas", "TX"), { name: "Ana Diaz", hoursRemaining: 1.5 }, eve);
ok("tomorrow's pickup, where and when, how far, when to leave, and the break", !!f && /tomorrow: pickup N-1 in Houston, TX at/.test(f.text) && /about 2\d\d miles away: leave by/.test(f.text) && /10-hour break/.test(f.text), f);
ok("nothing tomorrow, no text", eveningFacts([{ ...(tomorrowLoad as object), pickupAt: "2026-10-16T13:00:00Z" } as never], truck("t1", "Dallas", "TX"), { name: "Ana" }, eve) === null);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
