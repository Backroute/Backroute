import { PLAN_MPH, simulateRun, windowAround, windowOpens } from "../../src/lib/hos-plan";
import { planTotals } from "../../src/lib/plans";
import { generateWorld } from "../../src/lib/mock-data";
import type { Load } from "../../src/lib/types";

let pass = 0;
let fail = 0;
const ok = (label: string, c: boolean, x?: unknown) => {
  if (c) pass++;
  else fail++;
  console.log(c ? "PASS" : "FAIL", label, c ? "" : JSON.stringify(x)?.slice(0, 300));
};
const H = 3_600_000;
const hours = (ms: number) => ms / H;

// Solo: 8 hours, a 30-minute break, 3 more hours (the 11 is used up), then 10 off.
const solo = simulateRun([{ kind: "drive", miles: 2000 }], 0);
ok("plan speed is 50 mph", PLAN_MPH === 50);
ok("solo: the first rest comes after 11 hours of driving (550 mi)", Math.abs(solo.rests[0]?.mile - 550) < 1, solo.rests);
ok("…at 11.5 hours on duty (8 driving, the 30-minute break, 3 more)", Math.abs(hours(solo.rests[0]?.at) - 11.5) < 0.01, solo.rests);
ok("…and every 550 miles after", solo.rests.map((r) => Math.round(r.mile)).join() === "550,1100,1650", solo.rests);
ok("…a solo day is 22.5 hours: 10 off, an hour for the pre-trip and fuel, 11 driving and the break", Math.abs(hours(solo.rests[1].at - solo.rests[0].at) - 22.5) < 0.01, solo.rests);
ok("drive hours are the miles at plan speed", Math.abs(solo.driveHours - 40) < 0.01, solo.driveHours);

// Team: no nights, a stop every 8 hours.
const team = simulateRun([{ kind: "drive", miles: 2000 }], 0, { team: true });
ok("team: never stops for the night", team.rests.length === 0, team.rests);
const teamPerDay = (2000 / hours(team.end)) * 24;
ok("team covers 1,000–1,100 mi a day", teamPerDay >= 1000 && teamPerDay <= 1100, teamPerDay);
ok("team gets there more than a day sooner on 2,000 mi", solo.end - team.end > 24 * H, { solo: hours(solo.end), team: hours(team.end) });

// The 14-hour window: dock time uses it up, not the 11.
const dock = simulateRun([{ kind: "dock", hours: 4 }, { kind: "drive", miles: 1000 }], 0);
ok("4 hours at the dock: only 9.5 hours of driving fit in the 14 (475 mi)", Math.abs(dock.rests[0]?.mile - 475) < 1, dock.rests);

// The driver's own clock: hours already driven today count.
const tired = simulateRun([{ kind: "drive", miles: 500 }], 0, { driveLeft: 3 });
ok("3 hours left on the clock: rests after 150 mi", Math.abs(tired.rests[0]?.mile - 150) < 1, tired.rests);
ok("…and the run takes 11 hours longer (3 driving, 10 off, the pre-trip, 7 driving)", Math.abs(hours(tired.end) - 21) < 0.01, hours(tired.end));

// Waiting for an appointment: 10 hours or more is a full rest.
const waited = simulateRun([{ kind: "until", at: 12 * H }, { kind: "drive", miles: 500 }], 0, { driveLeft: 0 });
ok("waiting 12 hours for the dock resets the clocks: no rest after", waited.rests.length === 0, waited.rests);
const short = simulateRun([{ kind: "until", at: 5 * H }, { kind: "drive", miles: 500 }], 0);
ok("waiting 5 hours at the dock, in the sleeper, doesn't use the 14: 500 mi with no rest", short.rests.length === 0, short.rests);
const hour = simulateRun([{ kind: "dock", hours: 4 }, { kind: "until", at: 5 * H }, { kind: "drive", miles: 1000 }], 0);
ok("an hour's wait does use the 14 (too short to split): rests after 425 mi", Math.abs(hour.rests[0]?.mile - 425) < 1, hour.rests);
const split = simulateRun([{ kind: "dock", hours: 4 }, { kind: "until", at: 7 * H }, { kind: "drive", miles: 1000 }], 0);
ok("a 3-hour wait splits the 10: 475 mi before the rest (9.5 hours fit)", Math.abs(split.rests[0]?.mile - 475) < 1, split.rests);
ok("…and that night's rest is 7 hours (7 + 3)", split.rests[0]?.hours === 7, split.rests);
ok("a normal night is 10 hours", solo.rests[0].hours === 10);

// The week: 70 hours on duty in 8 days, then a 34-hour restart.
const recap = simulateRun([{ kind: "drive", miles: 500 }], 0, { cycleLeft: 5 });
ok("5 hours left on the 70: a 34-hour restart after 250 mi", recap.rests[0]?.hours === 34 && Math.abs(recap.rests[0].mile - 250) < 1, recap.rests);
ok("…which takes the run past a day and a half", hours(recap.end) > 34 + 10, hours(recap.end));
const teamRecap = simulateRun([{ kind: "drive", miles: 800 }], 0, { team: true, cycleLeft: 5 });
ok("a team shares the week: 5 hours left goes twice as far (500 mi) before a restart", Math.abs(teamRecap.rests[0]?.mile - 500) < 1 && teamRecap.rests[0].hours === 34, teamRecap.rests);
const longWait = simulateRun([{ kind: "until", at: 36 * H }, { kind: "drive", miles: 500 }], 0, { cycleLeft: 0 });
ok("a 36-hour wait is a restart: the week is full again", longWait.rests.length === 0, longWait.rests);
const docks = simulateRun([{ kind: "dock", hours: 3 }, { kind: "drive", miles: 300 }], 0, { cycleLeft: 4 });
ok("dock time counts toward the 70 too: 3 hours at the dock, then only 1 hour to drive", docks.rests[0]?.hours === 34 && Math.abs(docks.rests[0].mile - 50) < 1, docks.rests);
ok("each step's time is kept in order", waited.doneAt.length === 2 && waited.doneAt[0] === 12 * H && waited.doneAt[1] > waited.doneAt[0]);

// Plans: the same load, solo against a team.
const world = generateWorld();
const base = world.loads[0];
const long: Load = { ...base, plan: undefined, stops: undefined, deadheadMiles: 0, lane: { origin: "Chicago", originState: "IL", destination: "Los Angeles", destState: "CA", miles: 2015, marketRpm: 2.08 } };
const s = planTotals([long]);
const t = planTotals([long], { team: true });
ok("Chicago to LA solo: 4 days, 3 nights", s.days === 4 && s.rests.length === 3, s);
ok("…as a team: 2 days, no nights", t.days === 2 && t.rests.length === 0 && t.driveHours === s.driveHours, t);

// Appointment windows at the stop, in its own time.
const now = Date.parse("2026-10-05T12:00:00Z");
const opens = windowOpens("tomorrow, 8:00–15:00", "IL", now)!;
ok("'tomorrow, 8:00' in Illinois is 13:00 UTC the next day", new Date(opens).toISOString() === "2026-10-06T13:00:00.000Z", new Date(opens).toISOString());
ok("an AM/PM window reads right", new Date(windowOpens("2026-10-07, appointment 2:00 PM–3:00 PM", "CA", now)!).toISOString() === "2026-10-07T21:00:00.000Z");
ok("arriving at 2 pm: the window opens then, 3 hours wide", windowAround(Date.parse("2026-10-07T19:00:00Z"), "IL") === "2026-10-07, 14:00–17:00", windowAround(Date.parse("2026-10-07T19:00:00Z"), "IL"));
ok("arriving at 11 pm: the dock sees it the next morning", windowAround(Date.parse("2026-10-08T04:00:00Z"), "IL") === "2026-10-08, 6:00–9:00", windowAround(Date.parse("2026-10-08T04:00:00Z"), "IL"));
ok("arriving at 3 am: that morning at 6", windowAround(Date.parse("2026-10-08T08:00:00Z"), "IL") === "2026-10-08, 6:00–9:00");

console.log(`${pass} passed, ${fail} failed`);
