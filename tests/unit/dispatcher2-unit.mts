// More of the dispatcher's judgment: lane trends and weekdays from the carrier's own loads, pricing from the situation,
// lanes and days the owner keeps the truck off, a driver's earliest start, mountain grades, "call me back in ten",
// and when a truck is free for the shop.
import { beforeStart, dayBlocked, laneAvoided, situationPremiums } from "../../src/lib/agent/judgment.ts";
import { laneTrend, weekdayEdge } from "../../src/lib/agent/memory.ts";
import { gradeNote, gradesOnLane } from "../../src/lib/grades.ts";
import { callBackIn } from "../../src/lib/agent/broker-call.ts";
import { freeDay } from "../../src/lib/agent/compliance.ts";

let pass = 0, fail = 0;
const ok = (label: string, c: boolean, x?: unknown) => { if (c) { pass++; console.log("PASS", label); } else { fail++; console.log("FAIL", label, x === undefined ? "" : JSON.stringify(x)); } };

const now = Date.parse("2026-10-14T15:00:00Z");
const DAY = 86400_000;
const hauled = (daysAgo: number, rate: number, extra: object = {}) =>
  ({ id: `l${daysAgo}-${rate}`, stage: "delivered", bookedRate: rate, lane: { originState: "TX", destState: "TN", miles: 500 }, pickupAt: new Date(now - daysAgo * DAY).toISOString(), updatedAt: new Date(now - daysAgo * DAY).toISOString(), ...extra }) as never;

// ── Lane trend ──
const rising = [hauled(5, 1300), hauled(10, 1250), hauled(40, 1100), hauled(60, 1050)];
const t = laneTrend(rising, { originState: "TX", destState: "TN" }, now);
ok("a lane paying more lately: the last three weeks against the months before", t !== null && t.pct === 19 && t.recent === 2.55 && t.before === 2.15, t);
ok("not enough loads: nothing to say", laneTrend(rising.slice(0, 3), { originState: "TX", destState: "TN" }, now) === null);

// ── A weekday that pays more ──
const fri = (n: number) => new Date(Date.parse("2026-10-09T15:00:00Z") - n * 7 * DAY).toISOString(); // Fridays
const mon = (n: number) => new Date(Date.parse("2026-10-12T15:00:00Z") - n * 7 * DAY).toISOString(); // Mondays
const days = [0, 1, 2].map((n) => hauled(0, 1500, { pickupAt: fri(n), id: `f${n}` })).concat([0, 1, 2].map((n) => hauled(0, 1200, { pickupAt: mon(n), id: `m${n}` })));
const w = weekdayEdge(days, { originState: "TX", destState: "TN" }, 5, now);
ok("Friday pickups paid more on this lane", w?.day === "Friday" && w.pct === 11, w);
ok("a day with fewer than three loads says nothing", weekdayEdge(days, { originState: "TX", destState: "TN" }, 3, now) === null);

// ── Situation premiums ──
const s1 = situationPremiums({ trend: { pct: 12 }, weekday: { pct: 11, day: "Friday" }, detentionPaidPct: 30, slowDockHours: 4.5 });
ok("a rising lane, a better day, a broker who doesn't pay detention and a slow dock add up", Math.abs(s1.factor - 1.14) < 1e-9 && s1.reasons.length === 4 && s1.deadheadDollars === 0, s1);
ok("small moves don't count", situationPremiums({ trend: { pct: 3 }, weekday: { pct: 5, day: "Monday" }, detentionPaidPct: 70, slowDockHours: 2 }).factor === 1);
const dh = situationPremiums({ deadheadMiles: 220, loadedMiles: 400 });
ok("220 empty miles to a 400-mile load: deadhead asked as dollars", dh.deadheadDollars === 175 && dh.reasons[0] === "220 empty miles to the pickup", dh);
ok("a short run to the pickup isn't", situationPremiums({ deadheadMiles: 120, loadedMiles: 200 }).deadheadDollars === 0);

// ── Lanes, days and start times ──
ok("a lane the owner won't run", laneAvoided(["TX>CA"], { originState: "TX", destinationState: "CA" }) === "TX>CA" && !laneAvoided(["TX>CA"], { originState: "OK", destinationState: "CA" }));
ok("into a state from anywhere, out of a state to anywhere", laneAvoided([">ca"], { originState: "AZ", destinationState: "CA" }) === ">ca" && laneAvoided(["NY>"], { originState: "NY", destinationState: "PA" }) === "NY>");
ok("nothing set, nothing avoided", laneAvoided(undefined, { originState: "TX", destinationState: "CA" }) === null && laneAvoided([">"], { originState: "TX", destinationState: "CA" }) === null);
const pick = Date.parse("2026-10-16T14:00:00Z");
ok("a 900-mile load picking up the day before a blocked day runs into it", dayBlocked(["2026-10-17"], pick, 900) === "2026-10-17");
ok("a short one doesn't", dayBlocked(["2026-10-17"], pick, 300) === null);
ok("before the driver's start: 5 AM Central when they start at 6", beforeStart(6, Date.parse("2026-10-16T10:00:00Z"), "TX") && !beforeStart(6, Date.parse("2026-10-16T12:00:00Z"), "TX") && !beforeStart(undefined, pick, "TX"));

// ── Grades ──
const denverSlc = gradesOnLane({ origin: "Denver", originState: "CO", destination: "Salt Lake City", destState: "UT" });
ok("Denver to Salt Lake: the I-70 passes, in order", denverSlc.map((g) => g.name).slice(0, 2).join() === "Eisenhower Tunnel,Vail Pass", denverSlc.map((g) => g.name));
ok("Dallas to Memphis: none", gradesOnLane({ origin: "Dallas", originState: "TX", destination: "Memphis", destState: "TN" }).length === 0);
const note = gradeNote({ origin: "Denver", originState: "CO", destination: "Salt Lake City", destState: "UT" }, now);
ok("the driver's note names them and, in October, chain laws", !!note && /Vail Pass \(I-70, CO\)/.test(note) && /Chain laws/.test(note), note);
ok("in July, no chain-law line", !/Chain laws/.test(gradeNote({ origin: "Denver", originState: "CO", destination: "Salt Lake City", destState: "UT" }, Date.parse("2026-07-10T12:00:00Z")) ?? ""));

// ── "Call me back" ──
ok("call me back in ten", callBackIn("yeah I'm on another line, call me back in ten") === 10);
ok("give me 20 minutes", callBackIn("give me 20 minutes and I'll have it") === 20);
ok("try me in half an hour", callBackIn("try me in half an hour") === 30);
ok("call back later", callBackIn("can you call back later") === 15);
ok("call me back in an hour", callBackIn("call me back in an hour") === 60);
ok("not a call-back", callBackIn("it pays 1800 all in") === null);

// ── A truck's next free day ──
const truck = { id: "t1", blockedDays: ["2026-10-20"] } as never;
ok("a blocked day comes first", freeDay(truck, [], now).date === "2026-10-20");
const lined = [{ id: "a", truckId: "t1", stage: "booked", referenceNumber: "A-1", lane: { destination: "Memphis", destState: "TN" }, deliveryAt: "2026-10-16T18:00:00Z", pickupAt: "2026-10-15T14:00:00Z" }] as never;
const fd = freeDay({ id: "t1" } as never, lined, now);
ok("else the day after its last load delivers", fd.date === "2026-10-17" && /after A-1 delivers in Memphis, TN/.test(fd.text), fd);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
