import { createRng } from "./utils";
import type { Driver, Expense, Load, TimeOffRequest } from "./types";
import { computeDriverPay } from "./settlements";

/** What drivers say makes them quit: missed home time, pay that drops, unpaid waiting at docks, money owed to them,
 *  long days, and nobody at the company talking to them. These are warning signs to act on, not a prediction. */
export type SignalKind = "home" | "pay" | "dock" | "owed" | "time_off" | "hours" | "contact";

export interface RetentionSignal {
  kind: SignalKind;
  text: string;
  weight: number;
}

export interface RetentionView {
  level: "good" | "watch" | "at_risk";
  signals: RetentionSignal[];
  pendingExpenses: Expense[];
  pendingTimeOff?: TimeOffRequest;
  /** Null for a real driver with no check-in on record yet. */
  daysSinceCheckIn: number | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;
/** The last few weeks for the demo, steady per driver; live it comes from ELD logs, settlements and home-time records. */
function history(driver: Driver) {
  let seed = 0;
  for (let i = 0; i < driver.id.length; i++) seed = (seed * 31 + driver.id.charCodeAt(i)) >>> 0;
  const r = createRng(seed);
  return {
    missedHomeTimes: r.bool(0.3) ? r.int(1, 2) : 0,
    /** Last two weeks' settlements against their 8-week average, in percent. */
    payTrendPct: r.int(-24, 12),
    unpaidDockHours: r.int(0, 6),
    longDays: r.int(0, 4),
    daysSinceCheckIn: r.int(1, 16),
  };
}

/**
 * What a real account knows, instead of the demo's made-up history: when the driver was last home (ELD), their pay
 * from the loads they ran, how long docks kept them, and the last weekly check-in and how they said they were.
 */
export interface RealHistory {
  loads: Load[];
  truckId: string | null;
}

/** The driver's real pay trend and dock waits, from the loads on their truck. */
function realPast(driver: Driver, real: RealHistory, now: number) {
  const mine = real.loads.filter((l) => !l.imported && l.truckId && l.truckId === real.truckId && l.stage === "delivered");
  const at = (l: Load) => Date.parse(l.tripChecklist?.unloadedAt ?? l.updatedAt);
  const sum = (from: number, to: number) => mine.filter((l) => at(l) >= from && at(l) < to).reduce((s, l) => s + computeDriverPay(l, driver), 0);
  const recent = sum(now - 14 * DAY_MS, now);
  const before = sum(now - 70 * DAY_MS, now - 14 * DAY_MS) / 4; // the 8 weeks before, per 2 weeks
  const payTrendPct = before > 0 ? Math.round(((recent - before) / before) * 100) : null;
  // Hours past 2 free at each stop this week (arrived to loaded / unloaded).
  let dock = 0;
  for (const l of mine.concat(real.loads.filter((l) => l.truckId === real.truckId && ["in_transit", "at_delivery"].includes(l.stage)))) {
    const c = l.tripChecklist;
    for (const [a, b] of [[c?.arrivedPickupAt, c?.loadedAt], [c?.arrivedDeliveryAt, c?.unloadedAt]] as const) {
      if (!a || !b || Date.parse(b) < now - 7 * DAY_MS) continue;
      dock += Math.max(0, (Date.parse(b) - Date.parse(a)) / 3600_000 - 2);
    }
  }
  const awayDays = driver.lastHomeAt ? Math.floor((now - Date.parse(driver.lastHomeAt)) / DAY_MS) : null;
  return { payTrendPct, unpaidDockHours: Math.round(dock), awayDays };
}

export function retentionFor(
  driver: Driver,
  expenses: Expense[],
  timeOff: TimeOffRequest[],
  homeLate: boolean,
  now: number,
  real?: RealHistory,
): RetentionView {
  const signals: RetentionSignal[] = [];

  if (homeLate) signals.push({ kind: "home", text: `Won't make their target (${driver.homeTimeTarget.replace(/^Home/, "home")}) from where the truck empties next`, weight: 2 });
  if (real) {
    // Only what's on record: nothing is guessed for a real driver.
    const p = realPast(driver, real, now);
    const limit = driver.runType === "otr" ? 21 : driver.runType === "regional" ? 10 : 3;
    if (p.awayDays !== null && p.awayDays > limit) signals.push({ kind: "home", text: `Hasn't been home in ${p.awayDays} days (from the ELD)`, weight: p.awayDays > limit * 1.5 ? 3 : 1.5 });
    if (p.payTrendPct !== null && p.payTrendPct <= -15) signals.push({ kind: "pay", text: `Pay is down ${-p.payTrendPct}% over the last two weeks against the 8 weeks before`, weight: 1.5 });
    if (p.unpaidDockHours >= 3) signals.push({ kind: "dock", text: `Waited ${p.unpaidDockHours} hours past free time at docks this week`, weight: 1 });
    if (driver.care?.mood === "bad" && Date.parse(driver.care.at) > now - 14 * DAY_MS) signals.push({ kind: "contact", text: `Said things aren't good at the last check-in${driver.care.note ? `: "${driver.care.note}"` : ""}`, weight: 3 });
  } else {
    const past = history(driver);
    if (past.missedHomeTimes > 0) {
      signals.push({ kind: "home", text: `Missed home time ${past.missedHomeTimes === 1 ? "once" : "twice"} in the last four weeks`, weight: past.missedHomeTimes * 1.5 });
    }
    if (past.payTrendPct <= -15) signals.push({ kind: "pay", text: `Pay is down ${-past.payTrendPct}% over the last two weeks against their 8-week average`, weight: 1.5 });
    if (past.unpaidDockHours >= 3) signals.push({ kind: "dock", text: `Sat ${past.unpaidDockHours} unpaid hours at docks this week, inside brokers' free time`, weight: 1 });
    if (past.longDays >= 3) signals.push({ kind: "hours", text: `${past.longDays} days of 10+ hours driving in the last week`, weight: 1 });
  }

  const pendingExpenses = expenses.filter((e) => e.driverId === driver.id && e.status === "pending");
  const owed = pendingExpenses.reduce((s, e) => s + e.amount, 0);
  if (owed > 0) signals.push({ kind: "owed", text: `$${owed.toLocaleString()} of their own money is waiting on your approval`, weight: 2 });

  const pendingTimeOff = timeOff.find((r) => r.driverId === driver.id && r.status === "pending");
  if (pendingTimeOff) signals.push({ kind: "time_off", text: "Asked for time off and hasn't heard back", weight: 2 });

  // A real driver with no check-in on record yet isn't counted as neglected.
  const lastTalk = driver.lastCheckInAt ?? (real ? driver.care?.at : undefined);
  const daysSinceCheckIn = lastTalk ? Math.floor((now - Date.parse(lastTalk)) / DAY_MS) : real ? null : history(driver).daysSinceCheckIn;
  if (daysSinceCheckIn !== null && daysSinceCheckIn >= 10) signals.push({ kind: "contact", text: `No check-in from you in ${daysSinceCheckIn} days`, weight: 1.5 });

  const score = signals.reduce((s, x) => s + x.weight, 0);
  return {
    level: score >= 5 ? "at_risk" : score >= 2.5 ? "watch" : "good",
    signals: signals.sort((a, b) => b.weight - a.weight),
    pendingExpenses,
    pendingTimeOff,
    daysSinceCheckIn,
  };
}
