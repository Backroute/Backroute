import { stopLocalToIso, zoneFor } from "./stop-time";

/**
 * How a truck really covers ground, clock by clock, under the federal hours-of-service rules for property carriers
 * (49 CFR 395.3): up to 11 hours of driving after 10 hours off, none of it past the 14th hour after coming on duty, and a
 * 30-minute break once 8 hours of driving have built up. Loading and unloading are on duty: they use up the 14 hours
 * but not the 11, and so does the hour each morning for the pre-trip inspection and fuel (as `agent/schedule.ts` counts
 * it). Waiting 10 hours or more for an appointment counts as the 10 off.
 *
 * The week: no driving after 70 hours on duty in 8 days, until a 34-hour restart (on duty without driving is still
 * allowed). Hours coming back as old days roll off aren't counted, so a long plan is planned on the safe side.
 *
 * The split sleeper: a wait of 2 hours or more at a dock, logged in the sleeper, doesn't use up the 14 (the 7/3 and
 * 8/2 splits, 49 CFR 395.1(g)); the night's rest after it is then the rest of the 10, at least 7 hours.
 *
 * A team truck (two drivers, one sleeping in the berth while the other drives) only stops to swap seats, fuel and eat:
 * it rolls about 1,000 to 1,100 miles a day against a solo driver's 450 to 550, and never parks for the night.
 *
 * Miles are planned at 50 mph, the speed dispatchers use for trip planning: highway speed less traffic, construction,
 * fuel and scale stops.
 */
export const PLAN_MPH = 50;
/** A live load or unload: about the two hours of free time brokers give before detention starts. */
export const DOCK_HOURS = 2;
/** An extra drop on a multi-stop load, or a second pickup at the same dock. */
export const STOP_HOURS = 1;

const DRIVE_MAX = 11;
const WINDOW = 14;
const BREAK_AFTER = 8;
const BREAK = 0.5;
const REST = 10;
const WEEK = 70;
const RESTART = 34;
/** The shortest piece of a split: 2 hours off (or in the sleeper) paired with at least 7 in the sleeper. */
const SPLIT_SHORT = 2;
const SPLIT_LONG = 7;
/** On duty, not driving, at the start of each day after a rest: the pre-trip inspection, fuel, a scale. */
const DAY_START = 1;
/** A team's stop every 8 hours of driving: swap seats, fuel, eat. Two a day leaves 22 hours rolling, about 1,100 miles. */
const TEAM_STOP = 1;
const H = 3_600_000;

export interface Crew {
  /** Two drivers on the truck. */
  team?: boolean;
  /** Hours of driving the driver has left right now (their ELD clock); a full 11 when not known. */
  driveLeft?: number;
  /** Hours left on the 70-hour, 8-day clock (their "recap"); a full 70 when not known. */
  cycleLeft?: number;
}

/** The crew a truck has: its drivers, and the first driver's clocks. */
export function crewOf(truck: { secondDriverId?: string | null } | undefined, driver: { hoursRemaining?: number; cycleHoursLeft?: number; hos?: { cycle: number } } | undefined): Crew {
  return { team: !!truck?.secondDriverId, driveLeft: driver?.hoursRemaining, cycleLeft: driver?.hos?.cycle ?? driver?.cycleHoursLeft };
}

export type RunStep = { kind: "drive"; miles: number } | { kind: "dock"; hours: number } | { kind: "until"; at: number };

export interface RunResult {
  /** When each step is done, in step order. */
  doneAt: number[];
  end: number;
  /** Where (miles driven so far) and when each rest starts, and how long: 10 hours, 7 after a split, or a 34-hour
   *  restart when the week's 70 run out. A team only stops for a restart. */
  rests: { mile: number; at: number; hours: number }[];
  driveHours: number;
}

/** Plays a run forward step by step, the way the driver's clocks would run. */
export function simulateRun(steps: RunStep[], start: number, crew: Crew = {}): RunResult {
  const team = !!crew.team;
  let t = start;
  let drive = Math.max(0, Math.min(DRIVE_MAX, crew.driveLeft ?? DRIVE_MAX));
  let shift = WINDOW;
  let sinceBreak = 0;
  let week = Math.max(0, Math.min(WEEK, crew.cycleLeft ?? WEEK));
  // A qualifying short piece already taken (in hours): the night's rest only needs to make up the 10.
  let splitShort = 0;
  let mile = 0;
  let driveHours = 0;
  const rests: RunResult["rests"] = [];
  const doneAt: number[] = [];
  const newDay = () => {
    drive = DRIVE_MAX;
    shift = WINDOW;
    sinceBreak = 0;
    splitShort = 0;
  };
  // On duty, not driving: uses the 14 and the week. Two drivers share a team's week.
  const onDuty = (h: number) => {
    if (!team) shift -= h;
    week -= team ? h / 2 : h;
  };
  const rest = (hours: number) => {
    rests.push({ mile, at: t, hours });
    t += (hours + DAY_START) * H;
    if (hours >= RESTART) week = WEEK;
    newDay();
    onDuty(DAY_START);
  };

  for (const step of steps) {
    if (step.kind === "drive") {
      let left = step.miles;
      // Guard against a stuck loop on bad input: no run is longer than a few thousand miles.
      for (let guard = 0; left > 0.01 && guard < 500; guard++) {
        if (week <= 0.01) {
          rest(RESTART);
          continue;
        }
        if (!team && (drive <= 0.01 || shift <= 0.01)) {
          rest(splitShort >= SPLIT_SHORT ? Math.max(SPLIT_LONG, REST - splitShort) : REST);
          continue;
        }
        if (sinceBreak >= BREAK_AFTER - 1e-6) {
          t += (team ? TEAM_STOP : BREAK) * H;
          if (!team) shift -= BREAK;
          sinceBreak = 0;
          continue;
        }
        const weekDrive = team ? week * 2 : week;
        const h = Math.min(left / PLAN_MPH, BREAK_AFTER - sinceBreak, weekDrive, team ? Infinity : Math.min(drive, shift));
        t += h * H;
        if (!team) {
          drive -= h;
          shift -= h;
        }
        week -= team ? h / 2 : h;
        sinceBreak += h;
        left -= h * PLAN_MPH;
        mile += h * PLAN_MPH;
        driveHours += h;
      }
    } else if (step.kind === "dock") {
      t += step.hours * H;
      onDuty(step.hours);
      if (step.hours >= BREAK) sinceBreak = 0;
    } else if (step.at > t) {
      const gap = (step.at - t) / H;
      if (gap >= RESTART) {
        week = WEEK;
        newDay();
      } else if (gap >= REST) newDay();
      else if (!team && gap >= SPLIT_SHORT) splitShort = Math.max(splitShort, gap); // In the sleeper: the 14 waits.
      else if (!team) shift -= gap;
      if (gap >= BREAK) sinceBreak = 0;
      t = step.at;
    }
    doneAt.push(t);
  }
  return { doneAt, end: t, rests, driveHours };
}

/** Today's date at a stop, in its own zone, as YYYY-MM-DD, some days from now. */
export function stopDay(state: string, now: number, plusDays = 0): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: zoneFor(state), year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(now + plusDays * 86_400_000));
}

/** The hour of the day (0–23) a moment falls on at a stop, and that day as YYYY-MM-DD. */
export function atStop(ms: number, state: string): { day: string; hour: number } {
  const zone = zoneFor(state);
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms));
  const hour = Number(new Intl.DateTimeFormat("en-US", { timeZone: zone, hour: "numeric", hourCycle: "h23" }).format(new Date(ms)));
  return { day, hour };
}

/** A stop's local clock time on a day as a moment. */
export function stopMoment(day: string, hour: number, state: string): number {
  const iso = stopLocalToIso(`${day}T${String(Math.max(0, Math.min(23, Math.floor(hour)))).padStart(2, "0")}:00`, state);
  return iso ? Date.parse(iso) : Date.parse(`${day}T12:00:00Z`);
}

/** When a window like "today, 8:00–15:00" or "tomorrow, appointment 9:00 AM–10:00 AM" opens, at the stop. */
export function windowOpens(window: string, state: string, now: number): number | null {
  const w = window.trim();
  const iso = /^(\d{4}-\d{2}-\d{2})/.exec(w)?.[1];
  const rel = /^(today|tomorrow)\b/i.exec(w)?.[1]?.toLowerCase();
  const day = iso ?? (rel ? stopDay(state, now, rel === "tomorrow" ? 1 : 0) : null);
  if (!day) return null;
  const m = /(\d{1,2}):(\d{2})\s*([AaPp][Mm])?/.exec(w.slice(iso ? 10 : 0));
  let hour = m ? Number(m[1]) : 8;
  if (m?.[3]) hour = (hour % 12) + (/p/i.test(m[3]) ? 12 : 0);
  return stopMoment(day, hour, state);
}

/**
 * An appointment window around when a truck gets somewhere: from the hour it arrives, three hours wide. Docks that
 * aren't open at night get it the next morning.
 */
export function windowAround(ms: number, state: string): string {
  let { day, hour } = atStop(ms, state);
  if (hour >= 21 || hour < 5) {
    if (hour >= 21) day = atStop(ms + 12 * H, state).day;
    hour = 6;
  }
  return `${day}, ${hour}:00–${Math.min(23, hour + 3)}:00`;
}
