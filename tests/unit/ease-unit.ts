// The time-savers: an answer right on the urgent card books or walks away, a driver saying how late, choices counted.
import { generateWorld } from "../../src/lib/mock-data";
import { offerOptions } from "../../src/lib/plans";
import { minutesIn } from "../../src/lib/spoken";
import { takeOrWalk } from "../../src/lib/store/support";
import type { StoreState } from "../../src/lib/store/state";
import type { Escalation, Load } from "../../src/lib/types";

let pass = 0;
let fail = 0;
const ok = (label: string, c: boolean, x?: unknown) => {
  if (c) pass++;
  else fail++;
  console.log(c ? "PASS" : "FAIL", label, c ? "" : JSON.stringify(x)?.slice(0, 300));
};

// How late, from what a driver says.
ok("“late, about 30 minutes” is 30", minutesIn("i'm late about 30 minutes") === 30, minutesIn("i'm late about 30 minutes"));
ok("“an hour” is 60", minutesIn("running an hour late") === 60);
ok("“half an hour” is 30", minutesIn("half an hour behind") === 30);
ok("“an hour and a half” is 90", minutesIn("an hour and a half late") === 90);
ok("“2 hours” is 120", minutesIn("2 hours late traffic") === 120);
ok("“45” alone is 45", minutesIn("late 45") === 45);
ok("no number, no minutes", minutesIn("i'm running late") === null);
ok("Spanish digits still count (“20 minutos”)", minutesIn("llego tarde 20 minutos") === 20);

// Take it or walk away, right from the card.
const world = generateWorld();
const load: Load = { ...world.loads.find((l) => l.stage === "negotiating")!, messages: [] };
load.messages = [{ id: "m1", channel: "email", direction: "inbound", from: "Broker", timestamp: new Date().toISOString(), content: "Best I can do", offerAmount: 1777 }];
const esc: Escalation = { id: "esc-x", loadId: load.id, carrierId: load.carrierId, reason: "The broker offered 9% under your floor. Take it or walk?", createdAt: new Date().toISOString(), status: "open", complexity: "critical", answers: { yes: "Take it", no: "Walk away" } };
const state = { ...world, loads: world.loads.map((l) => (l.id === load.id ? load : l)), escalations: [esc] } as unknown as StoreState;
const took = takeOrWalk(state, esc.id, true);
const booked = took?.loads.find((l) => l.id === load.id);
ok("Take it books at the broker's last offer", booked?.stage === "rate_confirmed" && booked.bookedRate === 1777, booked && { stage: booked.stage, rate: booked.bookedRate });
ok("…with the rate con on it and the profit worked out", !!booked?.documents.some((d) => d.type === "rate_confirmation") && booked?.netProfit !== null);
const walked = takeOrWalk(state, esc.id, false);
const gone = walked?.loads.find((l) => l.id === load.id);
ok("Walk away stops negotiating, with the reason", gone?.stage === "declined" && /walked away/i.test(gone.cancellationReason ?? ""), gone?.stage);
ok("…and the truck stops waiting on it", !walked?.trucks.some((t) => t.nextLoadId === load.id));
ok("an escalation without answers isn't a take-or-walk", takeOrWalk({ ...state, escalations: [{ ...esc, answers: undefined }] } as StoreState, esc.id, true) === null);
ok("nor one whose load isn't being negotiated any more", takeOrWalk({ ...state, loads: state.loads.map((l) => (l.id === load.id ? { ...l, stage: "booked" as const } : l)) } as StoreState, esc.id, true) === null);

// A plan of several loads is one choice, not several.
const offered = world.loads.filter((l) => l.stage === "offered" && l.offerGroupId);
const groups = new Map<string, Load[]>();
for (const l of offered) groups.set(l.offerGroupId!, [...(groups.get(l.offerGroupId!) ?? []), l]);
ok("choices are counted, not loads", [...groups.values()].every((g) => offerOptions(g).length <= g.length));

console.log(`\n${pass} passed, ${fail} failed`);
