import { advanceLoad, createLoadOfferBatch, lineUpChoice, replacePlanLeg, resolveLoadOffer } from "../../src/lib/engine";
import { generateWorld } from "../../src/lib/mock-data";
import { offerOptions, planStops, planTotals } from "../../src/lib/plans";
import { promoteChainedLoad } from "../../src/lib/store/support";
import type { Load, Truck } from "../../src/lib/types";

let pass = 0;
let fail = 0;
const ok = (label: string, c: boolean, x?: unknown) => {
  if (c) pass++;
  else fail++;
  console.log(c ? "PASS" : "FAIL", label, c ? "" : JSON.stringify(x)?.slice(0, 300));
};

const world = generateWorld();
const brokers = world.brokers;
const truck: Truck = { ...world.trucks[0], status: "available", currentLoadId: null, nextLoadId: null, trip: undefined, currentCity: "Dallas", currentState: "TX" };

// Many batches, so every kind of plan shows up at least once.
const batches: Load[][] = [];
for (let i = 0; i < 40; i++) {
  batches.push(createLoadOfferBatch(brokers, truck.carrierId, truck.id, 100 + i * 10, false, 3, { from: { city: "Dallas", state: "TX" }, homeBase: "Dallas, TX", runType: i % 2 ? "otr" : "regional", equipmentType: truck.equipmentType }));
}
const all = batches.flat();

ok("every batch has exactly one best-fit choice", batches.every((b) => new Set(offerOptions(b).filter((o) => o.some((l) => l.recommended)).map((o) => o[0].id)).size === 1));
ok("a best-fit plan marks all its loads, a single marks one", batches.every((b) => offerOptions(b).every((o) => o.every((l) => !!l.recommended === !!o[0].recommended))));

const b2b = batches.flatMap((b) => offerOptions(b)).filter((o) => o[0].plan?.kind === "back_to_back");
ok("loads back to back are offered", b2b.length > 10, b2b.length);
ok("…each reload picks up near where the load before it delivers (150 mi or less)", b2b.every((o) => o.slice(1).every((l) => l.deadheadMiles <= 150)));
ok("…never straight back over the same road", b2b.every((o) => o.slice(1).every((l, i) => !(l.lane.destination === o[i].lane.origin && l.lane.destState === o[i].lane.originState))));
ok("…long-haul drivers get three in a row when there's freight for it", b2b.some((o) => o.length === 3));
ok("…later pickups are dated after the load before delivers", b2b.every((o) => o.slice(1).every((l) => /^\d{4}-\d{2}-\d{2}, /.test(l.pickupWindow))));

const shared = batches.flatMap((b) => offerOptions(b)).filter((o) => o[0].plan?.kind === "shared_trailer");
ok("partials sharing the trailer are offered", shared.length > 5, shared.length);
ok("…every load is a partial, together no more than a trailer (26 pallets)", shared.every((o) => o.every((l) => !!l.partial) && o.reduce((n, l) => n + (l.partial?.pallets ?? 0), 0) <= 26));
ok("…every pickup comes before its drop", shared.every((o) => o[0].plan!.order!.every((s, i, order) => s.kind === "pickup" || order.findIndex((x) => x.loadId === s.loadId && x.kind === "pickup") < i)));
ok("…the towns on the way are dropped before the long one", shared.every((o) => o[0].plan!.order![o[0].plan!.order!.length - 1].loadId === o[0].id));
ok("…the run's fuel is carried once, split by pay", shared.every((o) => {
  const one = Math.round(((o[0].lane.miles + o[0].deadheadMiles) / 6.4) * 3.89);
  return Math.abs(o.reduce((n, l) => n + l.fuelCost, 0) - one) <= o.length;
}));

const multi = all.filter((l) => l.stops?.length);
ok("some loads have a second drop on the way (multi-stop)", multi.length > 0, multi.length);
ok("…and pay for it", multi.every((l) => l.targetRate > 0));

// A long run: days on the road and where the driver sleeps.
const long: Load = { ...all[0], plan: undefined, stops: undefined, deadheadMiles: 0, lane: { origin: "Chicago", originState: "IL", destination: "Los Angeles", destState: "CA", miles: 2015, marketRpm: 2.08 } };
const lt = planTotals([long]);
ok("a 2,015-mile run is 4 days of driving", lt.days === 4, lt);
ok("…with 3 nights' rest, each in a town on the road", lt.rests.length === 3 && lt.rests.every((r) => /, [A-Z]{2}$/.test(r.place)), lt.rests);
ok("a 500-mile load is 1 day, no rest", planTotals([{ ...long, lane: { ...long.lane, destination: "Memphis", destState: "TN", miles: 530 } }]).days === 1);

// The week: a driver near the end of their 70 hours gets the 34-hour reset in the plan.
const tired = planTotals([long], { cycleLeft: 6 });
ok("6 hours left on the week: the long run includes a 34-hour reset", tired.rests.some((r) => r.hours === 34), tired.rests);
ok("…and takes longer than a fresh driver's", tired.days > lt.days, { tired: tired.days, fresh: lt.days });

// Team freight: long runs pay more for a team truck.
const teamOffers = Array.from({ length: 30 }, (_, i) => createLoadOfferBatch(brokers, truck.carrierId, truck.id, 700 + i * 10, false, 3, { from: { city: "Dallas", state: "TX" }, homeBase: "Dallas, TX", runType: "otr", equipmentType: truck.equipmentType, crew: { team: true } })).flat();
const teamLong = teamOffers.filter((l) => l.lane.miles >= 1000 && !l.lane.moveKind && !l.partial);
ok("team truck: long runs are team freight (partials are priced by trailer space instead)", teamLong.length > 0 && teamLong.every((l) => l.teamRate), teamLong.length);
ok("…short ones aren't", teamOffers.filter((l) => l.lane.miles < 1000).every((l) => !l.teamRate));
ok("solo trucks never get team freight", all.every((l) => !l.teamRate));
const perMile = (ls: Load[]) => ls.reduce((n, l) => n + l.targetRate, 0) / ls.reduce((n, l) => n + l.lane.miles, 0);
const soloLong = all.filter((l) => l.lane.miles >= 1000 && !l.lane.moveKind && !l.partial);
ok("…and it pays more a mile than the same runs solo", perMile(teamLong) > perMile(soloLong) * 1.1, { team: perMile(teamLong), solo: perMile(soloLong) });

// Booking a plan books every load in it, and lines them up on the truck.
const batch = batches.find((b) => offerOptions(b).some((o) => o[0].plan?.kind === "back_to_back" && o.length === 3))!;
const plan = offerOptions(batch).find((o) => o[0].plan?.kind === "back_to_back" && o.length === 3)!;
const r = resolveLoadOffer(batch, plan[0].offerGroupId!, plan[1].id, "driver");
const planIds = new Set(plan.map((l) => l.id));
ok("picking any load of a plan books the whole plan", r.loads.filter((l) => planIds.has(l.id)).every((l) => l.stage === "scoring"));
ok("…and turns down every other choice", r.loads.filter((l) => !planIds.has(l.id)).every((l) => l.stage === "declined"));
ok("…the note says what was booked", /3 loads back to back, every broker asked at once/.test(r.events[0]?.detail ?? ""), r.events[0]?.detail);
const lined = lineUpChoice([truck], r.loads, plan[0].id);
ok("a free truck: the second load is next", lined.trucks[0].nextLoadId === plan[1].id && lined.trucks[0].currentLoadId === null);
const busyTruck = { ...truck, currentLoadId: "other", status: "on_load" as const };
ok("a truck on a load: the plan's first load is next", lineUpChoice([busyTruck], r.loads, plan[2].id).trucks[0].nextLoadId === plan[0].id);

// Each waits its turn once booked.
const booked = (l: Load): Load => ({ ...l, stage: "booked" });
const t1 = lined.trucks[0];
ok("load 2 booked first waits, booked", advanceLoad(booked(plan[1]), undefined, t1).load.stage === "booked");
ok("load 3 waits too", advanceLoad(booked(plan[2]), undefined, t1).load.stage === "booked");
const go = advanceLoad(booked(plan[0]), undefined, t1);
ok("load 1 goes out and becomes the truck's", go.load.stage === "dispatched" && go.truckUpdates?.currentLoadId === plan[0].id);
const onLoad1 = { ...t1, currentLoadId: plan[0].id, status: "on_load" as const };
ok("a single chained load waits behind the one the truck is on", advanceLoad(booked({ ...plan[1], plan: undefined }), undefined, { ...onLoad1, nextLoadId: plan[1].id }).load.stage === "booked");
const promoted = promoteChainedLoad([{ ...onLoad1, currentLoadId: null }], t1.id, t1.carrierId, r.loads);
ok("load 1 delivered: load 2 is the truck's and load 3 is next", promoted.trucks[0].currentLoadId === plan[1].id && promoted.trucks[0].nextLoadId === plan[2].id, promoted.trucks[0]);
ok("load 2's turn: it goes out", advanceLoad(booked(plan[1]), undefined, promoted.trucks[0]).load.stage === "dispatched");

// A broker in the plan drops out: another load takes its place.
const dropped: Load = { ...r.loads.find((l) => l.id === plan[1].id)!, stage: "declined" };
const rep = replacePlanLeg(dropped, r.loads.map((l) => (l.id === dropped.id ? dropped : l)), lined.trucks, brokers, 900);
ok("a dropped load is replaced, as the same load of the plan", !!rep && rep.loads[0].plan?.leg === 2 && rep.loads[0].plan?.id === plan[0].plan!.id && rep.loads[0].stage === "scoring");
ok("…from a different broker", !!rep && rep.loads[0].brokerId !== dropped.brokerId);
ok("…and the truck's lineup points at it", !!rep && rep.trucks[0].nextLoadId === rep.loads[0].id);
ok("…the note says so", !!rep && /in its place, so the plan still runs/.test(rep.event.detail));

// Partials: the trip goes on the truck.
const sBatch = batches.find((b) => offerOptions(b).some((o) => o[0].plan?.kind === "shared_trailer"))!;
const sPlan = offerOptions(sBatch).find((o) => o[0].plan?.kind === "shared_trailer")!;
const sr = resolveLoadOffer(sBatch, sPlan[0].offerGroupId!, sPlan[0].id, "carrier");
const sl = lineUpChoice([truck], sr.loads, sPlan[0].id);
ok("partials: the truck gets the trip's stops, heading for the first pickup", sl.trucks[0].trip?.stops.length === sPlan.length * 2 && sl.trucks[0].currentLoadId === sPlan[0].plan!.order![0].loadId);
ok("…every load is on the trip", sl.loads.filter((l) => l.plan?.id === sPlan[0].plan!.id).every((l) => l.tripId === sPlan[0].plan!.id));
const mate = sl.loads.find((l) => l.id === sPlan[1].id)!;
const mateGo = advanceLoad(booked(mate), undefined, sl.trucks[0]);
ok("…a load riding along goes out without taking the truck from the first", mateGo.load.stage === "dispatched" && mateGo.truckUpdates?.currentLoadId === undefined);
ok("the stops read in order on the card", planStops(sPlan).map((s) => s.kind).join() === sPlan[0].plan!.order!.map((s) => s.kind).join());

console.log(`${pass} passed, ${fail} failed`);
