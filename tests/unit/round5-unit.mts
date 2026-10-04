import { planTrip, runTrip, insertLoad, cantShare, loadFeet, partialShare, nextStop, tripLoads, tripStops, restackNotes, trailerOf, TRIP_MAX } from "../../src/lib/trip-plan.ts";
import { chainOf, chainEnd, linedUp, slotsFor, freeAfter } from "../../src/lib/agent/chain.ts";
import { tripFit, tripWith, stopsLine, nextStopLine, tripEtas } from "../../src/lib/agent/trips.ts";
import { floorFor, askFor } from "../../src/lib/agent/pricing.ts";
import { partialOf, toRow } from "../../src/lib/agent/feeds.ts";
import { hoursFromPeriods } from "../../src/lib/agent/dock-hours.ts";
import { formatHours } from "../../src/lib/agent/facility-notes.ts";
import { etaUpdate } from "../../src/lib/agent/templates.ts";
import { truckLineup } from "../../src/lib/selectors.ts";

let pass = 0, fail = 0;
const ok = (label: string, c: boolean, x?: unknown) => { if (c) { pass++; console.log("PASS", label); } else { fail++; console.log("FAIL", label, x === undefined ? "" : JSON.stringify(x)); } };
const H = 3600_000;
const now = Date.parse("2026-10-05T13:00:00Z");
const iso = (ms: number) => new Date(ms).toISOString();
const lane = (o: string, os: string, d: string, ds: string, miles: number) => ({ origin: o, originState: os, destination: d, destState: ds, miles, marketRpm: 0 });
const P = (id: string, l: any, extra: any = {}) => ({ id, referenceNumber: id.toUpperCase(), lane: l, equipmentType: "Dry Van", weight: 6000, partial: { feet: 12 }, stage: "dispatched", truckId: "t1", pickupWindow: "Mon 8a", deliveryWindow: "Tue 8a", ...extra }) as any;
const trailer = { feet: 53, lbs: 44000 };
const DALLAS: [number, number] = [32.7767, -96.797];
const start = { at: DALLAS, time: now };

// Sizes and price share
ok("feet: given, from pallets (8 → 17 ft), unknown partial half, full load all", loadFeet({ partial: { feet: 10 } }) === 10 && loadFeet({ partial: { pallets: 8 } }) === 17 && loadFeet({ partial: {} }) === 26 && loadFeet({}) === 53);
ok("share: never under about a third, a full load is 1", partialShare({ partial: { feet: 5 } }) === 0.35 && Math.abs(partialShare({ partial: { feet: 26.5 } }) - 0.5) < 1e-9 && partialShare({}) === 1);
ok("trailer: 53 ft dry van, 48 ft flatbed, the owner's own size", trailerOf({ equipmentType: "Dry Van" } as any).feet === 53 && trailerOf({ equipmentType: "Flatbed" } as any).feet === 48 && trailerOf({ equipmentType: "Dry Van", trailer: { feet: 48, payloadLbs: 40000 } } as any).lbs === 40000);

// What can ride together
const A = P("a", lane("Dallas", "TX", "Houston", "TX", 240));
const B = P("b", lane("Dallas", "TX", "Waco", "TX", 95));
const C = P("c", lane("Waco", "TX", "Houston", "TX", 185));
ok("two partials can share", cantShare(A, B) === null);
ok("a full load can't share", /whole trailer/.test(cantShare(A, { ...B, partial: undefined }) ?? ""));
ok("hazmat can't ride with food", /food/.test(cantShare({ ...A, hazmat: true }, { ...B, commodity: "Frozen chicken" }) ?? ""));
ok("reefer set points more than 2°F apart can't share", /34°F and 0°F/.test(cantShare({ ...A, equipmentType: "Reefer", commodity: "Produce 34F" }, { ...B, equipmentType: "Reefer", rateConReading: { reefer: { setF: 0 } } }) ?? ""));
ok("reefer within 2°F can", cantShare({ ...A, equipmentType: "Reefer", commodity: "34F" }, { ...B, equipmentType: "Reefer", commodity: "35 F" }) === null);
ok("exclusive use rides alone", /trailer to itself/.test(cantShare({ ...A, exclusive: true }, B) ?? ""));

// Planning a run: Dallas pickups, a Waco drop and pickup, Houston drops
const plan = planTrip([A, B, C], start, trailer);
const seq = plan?.order.map((s) => `${s.kind[0]}${s.loadId}`).join(" ");
ok("a trip is planned for three partials", !!plan, seq);
ok("every pickup comes before its drop", !!plan && ["a", "b", "c"].every((id) => plan.order.findIndex((s) => s.loadId === id && s.kind === "pickup") < plan.order.findIndex((s) => s.loadId === id && s.kind === "delivery")));
ok("B comes off in Waco before C goes on there (no trip back)", !!plan && plan.order.findIndex((s) => s.loadId === "b" && s.kind === "delivery") < plan.order.findIndex((s) => s.loadId === "c" && s.kind === "pickup"), seq);
ok("about the miles of driving Dallas–Waco–Houston once (under 330)", !!plan && plan.run.miles < 330, plan?.run.miles);
ok("Houston drops in the order that needs no restack (C, loaded last, first)", !!plan && plan.run.restacks.length === 0, seq);
ok("an ETA for every stop, in order", !!plan && plan.run.etas.length === 6 && plan.run.etas.every((t, i, a) => i === 0 || t >= a[i - 1]));

// Space and weight
const big = ["w", "x", "y", "z"].map((id) => P(id, lane("Dallas", "TX", "Houston", "TX", 240), { partial: { feet: 16 } }));
const allOn = [...big.map((l) => ({ loadId: l.id, kind: "pickup" as const })), ...big.map((l) => ({ loadId: l.id, kind: "delivery" as const }))];
const tooMuch = runTrip(allOn, new Map(big.map((l) => [l.id, l])), start, trailer);
ok("64 ft of freight doesn't fit a 53-foot trailer", !tooMuch.ok && /no room/.test(tooMuch.why ?? ""), tooMuch.why);
const heavy = runTrip([{ loadId: "a", kind: "pickup" }, { loadId: "b", kind: "pickup" }, { loadId: "a", kind: "delivery" }, { loadId: "b", kind: "delivery" }], new Map([["a", { ...A, weight: 25000 }], ["b", { ...B, weight: 25000 }]]), start, trailer);
ok("50,000 lbs is over what the truck can carry", !heavy.ok && /too heavy/.test(heavy.why ?? ""), heavy.why);
const backwards = runTrip([{ loadId: "a", kind: "delivery" }, { loadId: "a", kind: "pickup" }], new Map([["a", A]]), start, trailer);
ok("a drop before its pickup doesn't run", !backwards.ok && /before it's picked up/.test(backwards.why ?? ""));

// Appointments and hours
const tight = P("t", lane("Dallas", "TX", "Houston", "TX", 240), { deliveryAt: iso(now + 2 * H) });
ok("a drop due in 2 hours 240 miles away can't be planned", planTrip([tight], start, trailer) === null);
const wait = runTrip([{ loadId: "a", kind: "pickup" }, { loadId: "a", kind: "delivery" }], new Map([["a", { ...A, pickupAt: iso(now + 5 * H) }]]), start, trailer);
ok("early for a pickup appointment: the truck waits for it", wait.ok && wait.etas[1] >= now + 5 * H + 1.5 * H, wait.etas.map(iso));
const memphis = P("m", lane("Dallas", "TX", "Memphis", "TN", 450));
const hos = runTrip([{ loadId: "m", kind: "pickup" }, { loadId: "m", kind: "delivery" }], new Map([["m", memphis]]), { ...start, driveLeft: 2 }, trailer);
ok("two hours of driving left: the 10-hour break is in the ETA", hos.ok && hos.etas[1] - now > 18 * H, (hos.etas[1] - now) / H);
ok("over eight loads is too many for one trip", TRIP_MAX === 8 && planTrip(Array.from({ length: 9 }, (_, i) => P(`n${i}`, lane("Dallas", "TX", "Houston", "TX", 240), { partial: { feet: 4 } })), start, trailer) === null);

// Restacks
const lifo = runTrip([{ loadId: "a", kind: "pickup" }, { loadId: "b", kind: "pickup" }, { loadId: "a", kind: "delivery" }, { loadId: "b", kind: "delivery" }], new Map([["a", A], ["b", { ...B, lane: lane("Dallas", "TX", "Houston", "TX", 240) }]]), start, trailer);
ok("A loaded first comes off first: B is in the way (a restack)", lifo.ok && lifo.restacks.length === 1 && lifo.restacks[0].out === "A" && lifo.restacks[0].blocking[0] === "B");
ok("the driver's note says what to ask for", /B is in front of A: ask the shipper to load A by the doors/.test(restackNotes(lifo)[0] ?? ""), restackNotes(lifo));

// Adding one on the way
const onboardA = { ...A, stage: "in_transit" };
const ins = insertLoad([{ loadId: "a", kind: "delivery" }], { ...C, stage: "offered" }, new Map([["a", onboardA]]), { ...start, onboard: [onboardA] }, trailer);
ok("a Waco → Houston partial fits on a truck already headed to Houston", !!ins && ins.order.map((s) => `${s.kind[0]}${s.loadId}`).join(" ") === "pc da dc" || ins?.order.map((s) => `${s.kind[0]}${s.loadId}`).join(" ") === "pc dc da", ins?.order);
const base = runTrip([{ loadId: "a", kind: "delivery" }], new Map([["a", onboardA]]), { ...start, onboard: [onboardA] }, trailer);
ok("...adding far fewer miles than its own 185", !!ins && ins.run.miles - base.miles < 60, ins && ins.run.miles - base.miles);

// The truck's trip in the app
const trip = { id: "trip1", at: iso(now), stops: [{ loadId: "a", kind: "pickup" }, { loadId: "b", kind: "pickup" }, { loadId: "b", kind: "delivery" }, { loadId: "c", kind: "pickup" }, { loadId: "c", kind: "delivery" }, { loadId: "a", kind: "delivery" }] } as any;
const tl = (stages: Record<string, string>) => [A, B, C].map((l) => ({ ...l, tripId: "trip1", stage: stages[l.id] ?? "dispatched" }));
const truck = { id: "t1", currentLoadId: "a", nextLoadId: null, status: "on_load", currentCity: "Dallas", currentState: "TX", equipmentType: "Dry Van", driverId: "d1", mpg: 6.5, trip } as any;
let loads: any[] = tl({ a: "in_transit" });
ok("next stop: pick up B (stop 2 of 6)", nextStop(truck, loads)?.load.id === "b" && nextStop(truck, loads)?.index === 2 && nextStop(truck, loads)?.total === 6);
ok("the stop already made is done", tripStops(truck, loads)[0].done && !tripStops(truck, loads)[1].done);
ok("chain: the next stop's load first, the trip's others after", chainOf(loads, truck).map((l) => l.id).join() === "b,c,a" || chainOf(loads, truck)[0].id === "b", chainOf(loads, truck).map((l) => l.id));
ok("a trip counts as one of the three lined up", linedUp(loads, truck) === 1);
ok("the truck ends where the trip's last drop is", chainEnd(loads, truck)?.id === "a" && freeAfter(loads, truck).city === "Houston");
loads = tl({ a: "in_transit", b: "delivered", c: "in_transit" });
ok("B dropped and C loaded: next is the drop of C", nextStop(truck, loads)?.load.id === "c" && nextStop(truck, loads)?.stop.kind === "delivery" && slotsFor(loads, truck).currentLoadId === "c");
ok("the drop line for the driver", /^Next stop \(5 of 6\): drop C in Houston, TX/.test(nextStopLine(truck, loads) ?? ""), nextStopLine(truck, loads));
const cancelled = tl({ a: "in_transit", b: "cancelled" });
ok("a cancelled load's stops drop off the trip", tripStops(truck, cancelled).length === 4 && nextStop(truck, cancelled)?.load.id === "c");
const after = [...tl({ a: "delivered", b: "delivered", c: "delivered" }), { ...P("f", lane("Houston", "TX", "Austin", "TX", 165), { partial: undefined }), stage: "booked", tripId: undefined, pickupAt: iso(now + 30 * H) }];
const s = slotsFor(after, truck);
ok("every stop made: the trip is over and the next load moves up", !s.trip && s.currentLoadId === "f" && s.status === "on_load", s);
ok("trip loads aren't in the 'Then' lineup", truckLineup(tl({ a: "in_transit" }), truck).length === 0);
ok("where it fits on the trip, for the driver's text", stopsLine(trip, "c") === "Pick it up at stop 4 and drop it at stop 5 of 6.");

// tripFit: the AI's check before asking for a partial
const ctx = { loads: [onboardA], drivers: [{ id: "d1", hoursRemaining: 11 }] } as any;
const onA = { ...truck, trip: undefined, currentLoadId: "a" };
const fitC = tripFit(ctx, onA, { ...C, stage: "offered" }, now);
ok("tripFit: a partial on the way fits on a truck hauling a partial", !!fitC && fitC.extra < 0 && fitC.added < 60, fitC && { extra: fitC.extra, added: fitC.added });
const withC = fitC ? tripWith(ctx, onA, fitC) : null;
ok("the trip keeps the pickup already made at the front", !!withC && withC.stops[0].loadId === "a" && withC.stops[0].kind === "pickup" && withC.stops.length === 4, withC?.stops);
ok("tripFit: no partial joins a full load", tripFit({ ...ctx, loads: [{ ...onboardA, partial: undefined }] }, onA, { ...C, stage: "offered" }, now) === null);
ok("tripFit: a free truck isn't a trip (the usual booking path takes it)", tripFit({ ...ctx, loads: [] }, { ...onA, currentLoadId: null }, C, now) === null);
const later = { ...P("g", lane("Houston", "TX", "Austin", "TX", 165), { partial: undefined }), stage: "booked", pickupAt: iso(now + 6 * H) };
ok("tripFit: not when it would make the truck late for what's lined up after", tripFit({ ...ctx, loads: [onboardA, later] }, { ...onA, nextLoadId: "g" }, { ...C, stage: "offered" }, now) === null);
const asking = { ...B, id: "q", referenceNumber: "Q", stage: "negotiating", lane: lane("Dallas", "TX", "Houston", "TX", 240), partial: { feet: 30 } };
const crowded = tripFit({ ...ctx, loads: [onboardA, asking] }, onA, { ...C, stage: "offered", partial: { feet: 20 } }, now);
ok("tripFit: the partial the AI is already asking for takes its room (no longer on the way: a trip back for it)", !crowded || crowded.added > 150, crowded && crowded.added);
ok("...and so it's past the empty-mile limit the AI books under", !crowded || crowded.extra > 0);

// ETAs through the trip's earlier stops
const etas = tripEtas({ loads: tl({ a: "in_transit" }), drivers: [] } as any, { ...truck, position: { lat: DALLAS[0], lon: DALLAS[1], at: iso(now), source: "samsara" } }, now);
ok("trip ETAs: the last drop comes after the Waco stops", !!etas && etas.get("a:delivery")! > etas.get("c:pickup")! && etas.get("c:pickup")! > now, etas && [...etas.entries()].map(([k, v]) => [k, iso(v)]));
ok("no fresh ELD position: no trip ETAs (a guess isn't enough)", tripEtas({ loads: tl({}), drivers: [] } as any, truck, now) === null);

// Pricing a partial
const fl = floorFor({ lane: { miles: 400 } as any, partial: { feet: 13 } }, { minRpm: 3 } as any);
ok("floor for a quarter of the trailer: 35% of a full load's (the least a partial goes for)", fl === 425, fl);
ok("floor for half the trailer: half", floorFor({ lane: { miles: 400 } as any, partial: { feet: 26.5 } }, { minRpm: 3 } as any) === 600);
ok("ask for a partial with no post: its share, plus room", askFor({ lane: { miles: 400 } as any, listedRate: 0, partial: { feet: 26.5 } } as any, { minRpm: 3 } as any) === 750);

// Partials in feeds and board posts
ok("feed: 'P' flag with feet", JSON.stringify(partialOf({ fullPartial: "P", length: 20 })) === JSON.stringify({ partial: true, pallets: null, lengthFeet: 20 }));
ok("feed notes: 'Partial, 8 pallets'", partialOf({ notes: "Partial, 8 pallets, no touch" }).pallets === 8);
ok("feed: a full load says nothing", JSON.stringify(partialOf({ fullPartial: "FULL", notes: "53' van" })) === "{}");
const row = toRow({ origin_city: "Dallas", origin_state: "tx", destination_city: "Waco", destination_state: "TX", broker_email: "x@y.com", full_partial: "LTL", length_feet: 14 });
ok("feed row carries the partial", row?.partial === true && row?.lengthFeet === 14);

// Per-day dock hours and the late email's reason
const hrs = hoursFromPeriods([1, 2, 3, 4, 5].map((d) => ({ open: { day: d, hour: 7 }, close: { day: d, hour: 17 } })).concat([{ open: { day: 6, hour: 8 }, close: { day: 6, hour: 12 } }]));
ok("Saturday's short hours kept apart", hrs?.opens === "07:00" && hrs?.closes === "17:00" && hrs?.byDay?.Sat?.closes === "12:00", hrs);
ok("...and said", /Sat.*12/.test(formatHours(hrs!)), formatHours(hrs!));
const em = etaUpdate({ name: "Acme" } as any, { signature: "" } as any, { referenceNumber: "R1", lane: lane("Dallas", "TX", "Houston", "TX", 240) } as any, "pickup", "Dallas, TX", "Mon 3:00 PM", "traffic adds 2 h");
ok("the broker's late email says why", /traffic adds 2 h/.test(em), em);

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
