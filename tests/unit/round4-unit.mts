import { bestAssignment } from "../../src/lib/agent/match.ts";
import { chainOf, slotsFor, freeAfter, reloadOutlook, reloadValue, LINED_UP_MAX } from "../../src/lib/agent/chain.ts";
import { learnedAsk, askOutcomes } from "../../src/lib/agent/ask-learning.ts";
import { pointsAlong } from "../../src/lib/weather.ts";
import { askFor, learnedFor } from "../../src/lib/agent/pricing.ts";
import { hoursFromPeriods, postedHours } from "../../src/lib/agent/dock-hours.ts";
import { scheduleWarnings } from "../../src/lib/agent/schedule.ts";
import { weatherFactor, stillSince, stoppedOddly, etaWithReasons } from "../../src/lib/agent/late-risk.ts";
import { askedForIt, whereToPark } from "../../src/lib/agent/parking.ts";
import { connectUrl, readState } from "../../src/lib/agent/quickbooks.ts";

let pass = 0, fail = 0;
const ok = (label: string, c: boolean, _x?: string) => { if (c) { pass++; console.log("PASS", label); } else { fail++; console.log("FAIL", label); } };
const DAY = 86400_000;
const now = Date.parse("2026-10-02T15:00:00Z");
const iso = (ms: number) => new Date(ms).toISOString();

// Fleet-wide matching
const pairs = bestAssignment([
  [100, 90],
  [95, 10],
]);
ok("best total, not each load's best truck: load 0 → truck 1, load 1 → truck 0", JSON.stringify(pairs) === JSON.stringify([[0, 1], [1, 0]]));
ok("a truck that can't take a load is never paired with it", JSON.stringify(bestAssignment([[null, 50], [null, 40]])) === JSON.stringify([[0, 1]]));
ok("more loads than trucks: the better load wins the truck", JSON.stringify(bestAssignment([[10], [80], [30]])) === JSON.stringify([[1, 0]]));
ok("more trucks than loads", JSON.stringify(bestAssignment([[5, 70, 20]])) === JSON.stringify([[0, 1]]));
ok("empty table", bestAssignment([]).length === 0);
ok("negative values still pair (home-time priority in the millions)", JSON.stringify(bestAssignment([[-50, 1e6], [-20, -500]])) === JSON.stringify([[0, 1], [1, 0]]));

// Loads lined up
const L = (id: string, stage: string, pickup: number, extra: any = {}) => ({ id, stage, truckId: "t1", pickupAt: iso(pickup), deliveryAt: iso(pickup + DAY), lane: { origin: "Dallas", originState: "TX", destination: "Memphis", destState: "TN" }, ...extra }) as any;
const truck = { id: "t1", currentLoadId: "a", status: "on_load", currentCity: "Dallas", currentState: "TX" } as any;
const loads = [L("c", "booked", now + 3 * DAY, { lane: { origin: "Atlanta", originState: "GA", destination: "Chicago", destState: "IL" } }), L("a", "in_transit", now - DAY), L("b", "rate_confirmed", now + DAY), L("x", "delivered", now - 5 * DAY)];
ok("chain: current first, then by pickup, delivered left out", chainOf(loads, truck, now).map((l) => l.id).join() === "a,b,c");
const free = freeAfter(loads, truck, now);
ok("free after the last lined-up load, where it delivers", free.city === "Chicago" && free.lined === 3 && free.at === now + 4 * DAY + 2 * 3600_000);
ok("lined-up cap is three", LINED_UP_MAX === 3);
const after = slotsFor(loads.filter((l) => l.id !== "a"), { ...truck, currentLoadId: null }, now);
ok("when the current one delivers, the next moves up", after.currentLoadId === "b" && after.nextLoadId === "c" && after.status === "on_load");
ok("nothing lined up: available", slotsFor([], truck).status === "available" && slotsFor([], truck).currentLoadId === null);
ok("in the shop stays in the shop", slotsFor(loads, { ...truck, status: "maintenance" }).status === "maintenance");

// Reload outlook from the carrier's own offers
const offer = (city: string, st: string, ago: number) => ({ id: city + ago, equipmentType: "dry_van", createdAt: iso(now - ago * DAY), updatedAt: iso(now), lane: { origin: city, originState: st } }) as any;
const history = [...Array(6)].map((_, i) => offer("Dallas", "TX", i + 1)).concat([...Array(6)].map((_, i) => offer("Fort Worth", "TX", i + 2)));
ok("lots of offers near Dallas: strong", reloadOutlook(history, "Dallas", "TX", "dry_van", now).outlook === "strong");
ok("none near Billings: weak", reloadOutlook(history, "Billings", "MT", "dry_van", now).outlook === "weak");
ok("other equipment doesn't count", reloadOutlook(history, "Dallas", "TX", "reefer", now).count === 0);
ok("old offers don't count (falls back to the market map)", reloadOutlook(history.map((o) => ({ ...o, createdAt: iso(now - 40 * DAY) })), "Dallas", "TX", "dry_van", now).count <= 3);
ok("reload value: weak costs most", reloadValue("weak") < reloadValue("fair") && reloadValue("fair") < reloadValue("strong"));

// Learning the opening number
const ask = (i: number, won: boolean, opening = 2000, final = 2000, broker = "b1") => ({ id: `q${i}`, brokerId: broker, stage: won ? "delivered" : "declined", bookedRate: won ? final : undefined, lane: { originState: "TX", destState: "TN" }, bookRequest: { ask: opening, opening, askedAt: iso(now - (i + 4) * DAY), status: won ? "accepted" : "declined" } }) as any;
const scope = { brokerId: "b1", brokerName: "Acme Logistics", lane: { originState: "TX", destState: "TN" } };
const allWon = [0, 1, 2, 3, 4].map((i) => ask(i, true));
const up = learnedAsk(allWon, scope, now);
ok("took our first number 5 of 5: open 7% higher", up.factor === 1.07 && up.source === "broker" && /Acme Logistics/.test(up.why ?? ""));
ok("4 of 4 at our number: 5% higher", learnedAsk(allWon.slice(0, 4), scope, now).factor === 1.05);
ok("won but only after coming down: no raise", learnedAsk([0, 1, 2, 3].map((i) => ask(i, true, 2000, 1850)), scope, now).factor === 1);
const lost = [ask(0, false), ask(1, false), ask(2, false), ask(3, true, 2000, 1880), ask(4, false)];
const down = learnedAsk(lost, scope, now);
ok("lost 4 of 5: open lower, toward where the win landed", down.factor === 0.94 && /lost 4 of the last 5/.test(down.why ?? ""));
ok("never more than 8% lower", learnedAsk([ask(0, false), ask(1, false), ask(2, false)], scope, now).factor === 0.95 || learnedAsk([ask(0, false), ask(1, true, 2000, 1500), ask(2, false)], scope, now).factor === 0.92);
ok("two asks with this broker isn't enough; the lane needs four", learnedAsk(allWon.slice(0, 2), scope, now).source === null);
const laneOnly = [0, 1, 2, 3].map((i) => ask(i, true, 2000, 2000, `other${i}`));
ok("the lane with anyone, when the broker is new", learnedAsk(laneOnly, scope, now).source === "lane" && learnedAsk(laneOnly, scope, now).factor === 1.05);
const pending = { ...ask(9, false), bookRequest: { ask: 2000, opening: 2000, askedAt: iso(now - DAY), status: "sent" }, stage: "negotiating" };
ok("a load we set aside ourselves isn't a lost ask", askOutcomes([{ ...pending, stage: "declined", bookRequest: { ...pending.bookRequest, askedAt: iso(now - 9 * DAY) } }], () => true, now).length === 0);
ok("an ask still going doesn't count; one unanswered for 3 days is lost", askOutcomes([pending], () => true, now).length === 0 && askOutcomes([{ ...pending, bookRequest: { ...pending.bookRequest, askedAt: iso(now - 4 * DAY) } }], () => true, now)[0]?.won === false);
ok("asks older than 120 days are forgotten", askOutcomes([{ ...ask(0, true), bookRequest: { ...ask(0, true).bookRequest, askedAt: iso(now - 200 * DAY) } }], () => true, now).length === 0);

// Weather along the route
const path: [number, number][] = [[32.78, -96.8], [33.5, -94.0], [35.15, -90.05]];
const pts = pointsAlong(path, 6);
ok("route points start and end at the ends", pts[0][0] === 32.78 && pts[pts.length - 1][1] === -90.05);
ok("Dallas → Memphis (~450 mi): 6 points at most", pts.length >= 5 && pts.length <= 6);
ok("a short hop still checks both ends", pointsAlong([[32.78, -96.8], [32.8, -96.7]], 6).length === 2);


// Posted dock hours (item 6)
const wk = (o: number, c: number) => [1, 2, 3, 4, 5].map((d) => ({ open: { day: d, hour: o, minute: 0 }, close: { day: d, hour: c, minute: 0 } }));
ok("weekday 7 to 3 reads as Mon-Fri 07:00-15:00", JSON.stringify(hoursFromPeriods(wk(7, 15))) === JSON.stringify({ days: ["Mon", "Tue", "Wed", "Thu", "Fri"], opens: "07:00", closes: "15:00" }));
ok("open around the clock: nothing to warn about", JSON.stringify(hoursFromPeriods([{ open: { day: 0, hour: 0, minute: 0 } }])) === "{}");
ok("no hours listed: unknown", hoursFromPeriods([]) === null && hoursFromPeriods(undefined) === null);
ok("closing past midnight leaves no closing time", hoursFromPeriods([1, 2, 3, 4, 5, 6, 0].map((d) => ({ open: { day: d, hour: 18, minute: 0 }, close: { day: (d + 1) % 7, hour: 2, minute: 0 } })))?.closes === undefined);
if (process.env.GOOGLE_PLACES_API_KEY) {
  const delta = await postedHours({ name: "Delta Cold Storage", city: "Memphis", state: "TN" });
  ok("looks up the receiver's posted hours", delta?.opens === "07:00" && delta?.closes === "15:00");
  ok("a different business by that search isn't taken as the dock", (await postedHours({ name: "Lone Star Foods", city: "Dallas", state: "TX" })) === null);
  ok("not found: unknown", (await postedHours({ name: "Nowhere Freight", city: "Dallas", state: "TX" })) === null);
  // A Saturday 06:00 delivery at Delta (Memphis, central time).
  const load = { id: "h1", lane: { origin: "Dallas", originState: "TX", destination: "Memphis", destState: "TN", miles: 450 }, pickupAt: "2026-10-09T13:00:00Z", deliveryAt: "2026-10-10T11:00:00Z", rateConReading: { shipper: "Night Owl DC", receiver: "Delta Cold Storage", receiverAddress: "1 Delta Way, Memphis, TN 38118" } } as any;
  const w = await scheduleWarnings(load, null, "c1", null, now);
  const posted = w.find((x) => /posted hours/.test(x.text));
  ok("a stop outside the posted hours is a heads-up, never a hard stop", !!posted && posted.hard === false && /Delta Cold Storage closed on Sats/.test(posted.text) && !w.some((x) => /Night Owl/.test(x.text)));
}


// Late trucks, early (item 8)
ok("ice slows most, snow less, wind least", weatherFactor([{ event: "Ice Storm Warning" }]) === 1.35 && weatherFactor([{ event: "Winter Weather Advisory" }]) === 1.2 && weatherFactor([{ event: "Wind Advisory" }]) === 1.1 && weatherFactor([]) === 1);
const p0 = { lat: 31.7, lon: -97.1, at: iso(now - 3600_000), source: "samsara" } as any;
ok("a truck that hasn't moved keeps its first still time", stillSince(p0, { lat: 31.7001, lon: -97.1001, at: iso(now) }, undefined) === p0.at && stillSince(p0, { lat: 31.7001, lon: -97.1, at: iso(now) }, "X") === "X");
ok("a truck that moved is rolling again", stillSince(p0, { lat: 31.9, lon: -97.1, at: iso(now) }, "X") === undefined && stillSince(undefined, { lat: 1, lon: 1, at: "" }, undefined) === undefined);
const rolling = { stage: "in_transit", lane: { origin: "Austin", originState: "TX", destination: "Memphis", destState: "TN" } } as any;
const sitting = { stoppedSince: iso(now - 2 * 3600_000), position: { lat: 31.7, lon: -97.1, at: iso(now) } } as any;
ok("stopped 2 hours on the road, on duty: odd", stoppedOddly(rolling, sitting, { hosStatus: "on_duty" } as any, now)?.minutes === 120);
ok("in the sleeper or off duty: a planned stop", stoppedOddly(rolling, sitting, { hosStatus: "sleeper" } as any, now) === null && stoppedOddly(rolling, sitting, { hosStatus: "off_duty" } as any, now) === null);
ok("at the receiver: not odd", stoppedOddly(rolling, { ...sitting, position: { lat: 35.15, lon: -90.05, at: iso(now) } }, undefined, now) === null);
ok("under 90 minutes: not yet", stoppedOddly(rolling, { ...sitting, stoppedSince: iso(now - 60 * 60_000) }, undefined, now) === null);
ok("delivered: not watched", stoppedOddly({ ...rolling, stage: "delivered" }, sitting, undefined, now) === null);

// Parking only when asked (item 7)
ok("the driver's own words must be in what they said", askedForIt("book me a spot", "Hey, can you book me a spot near Texarkana?") && askedForIt("sí, resérvalo", "Sí, resérvalo por favor"));
ok("words they didn't say don't count", !askedForIt("book me a spot", "Where can I park tonight?") && !askedForIt("", "book it") && !askedForIt(undefined, "yes"));
const tr = { id: "t1", currentCity: "Dallas", currentState: "TX", currentLoadId: "L1", position: { lat: 32.7767, lon: -96.797, at: iso(Date.now()) } } as any;
const going = [{ id: "L1", stage: "in_transit", lane: { origin: "Dallas", originState: "TX", destination: "Memphis", destState: "TN" } }] as any;
const w3 = whereToPark(tr, { hos: { drive: 3, shift: 5, cycle: 30, at: iso(Date.now()) }, hosStatus: "driving", hoursRemaining: 3 } as any, going, Date.now());
ok("three hours left: spots where the hours run out, about 150 miles on", !!w3 && /hours run out, about 150 miles/.test(w3.note) && w3.at[1] > -96.5);
const w11 = whereToPark(tr, { hos: { drive: 11, shift: 14, cycle: 60, at: iso(Date.now()) }, hosStatus: "driving", hoursRemaining: 11 } as any, going, Date.now());
ok("makes the stop: spots near the delivery", !!w11 && w11.note === "near the delivery");

// QuickBooks connect note (item 11)
process.env.QBO_CLIENT_ID ??= "qbo-id";
process.env.PUBLIC_BASE_URL ??= "http://localhost:3210";
const cu = new URL(connectUrl("c-1", "u-1", now));
const st = cu.searchParams.get("state")!;
ok("the connect note says who asked", JSON.stringify(readState(st, now)) === JSON.stringify({ carrierId: "c-1", userId: "u-1" }));
ok("...expires in 15 minutes", readState(st, now + 16 * 60_000) === null);
ok("...and can't be changed", readState(st.replace(/^./, (c) => (c === "e" ? "f" : "e")), now) === null && readState("x.y", now) === null);

if (process.env.HERE_API_KEY) {
  const eta = await etaWithReasons({ id: "t", position: { lat: 32.7767, lon: -96.797, at: iso(Date.now()) } } as any, undefined, "Houston", "TX", Date.now(), { weather: false });
  ok("live road time into a jam: the ETA says traffic adds about 2 hours", !!eta && eta.reasons.some((r) => /^traffic adds 2(\.\d)? h$/.test(r)), JSON.stringify(eta));
  const calm = await etaWithReasons({ id: "t", position: { lat: 32.7767, lon: -96.797, at: iso(Date.now()) } } as any, { hos: { drive: 1, shift: 2, cycle: 30, at: iso(Date.now()) } } as any, "Memphis", "TN", Date.now(), { weather: false });
  ok("no jam, but the driver's hours run out: a 10-hour break counted", !!calm && calm.reasons.length === 1 && /10-hour break/.test(calm.reasons[0]));
}


// The broker's habit outranks what the lane did with anyone
const pushesBack = { booked: 0, avgRpm: null, tookOurAsk: 0, countered: 3 };
ok("lane learning steps aside for a broker with a clear habit", learnedFor({ factor: 0.95, source: "lane" }, pushesBack) === null && learnedFor({ factor: 0.95, source: "broker" }, pushesBack)?.factor === 0.95 && learnedFor({ factor: 0.95, source: "lane" }, null)?.factor === 0.95 && learnedFor({ factor: 1, source: "broker" }, null) === null);
const mem = { lane: { origin: "Memphis", originState: "TN", destination: "Nashville", destState: "TN", miles: 210 }, listedRate: 600 } as any;
ok("posted $600, always pushes back: room left ($725) even when the lane's asks were lost", askFor(mem, { minRpm: 2.75 } as any, undefined, { rpm: 3.2, high: 3.6 }, pushesBack, { factor: 0.95, source: "lane" }) === 725);
ok("...and lower when it's this broker's own asks that were lost", (askFor(mem, { minRpm: 2.75 } as any, undefined, { rpm: 3.2, high: 3.6 }, pushesBack, { factor: 0.93, source: "broker" }) ?? 0) < 725);

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
