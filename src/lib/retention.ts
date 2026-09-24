import { createRng } from "./utils";
import type { Driver, Expense, TimeOffRequest } from "./types";

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
  daysSinceCheckIn: number;
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

export function retentionFor(
  driver: Driver,
  expenses: Expense[],
  timeOff: TimeOffRequest[],
  homeLate: boolean,
  now: number,
): RetentionView {
  const past = history(driver);
  const signals: RetentionSignal[] = [];

  if (homeLate) signals.push({ kind: "home", text: `Won't make their target (${driver.homeTimeTarget.replace(/^Home/, "home")}) from where the truck empties next`, weight: 2 });
  if (past.missedHomeTimes > 0) {
    signals.push({ kind: "home", text: `Missed home time ${past.missedHomeTimes === 1 ? "once" : "twice"} in the last four weeks`, weight: past.missedHomeTimes * 1.5 });
  }

  if (past.payTrendPct <= -15) signals.push({ kind: "pay", text: `Pay is down ${-past.payTrendPct}% over the last two weeks against their 8-week average`, weight: 1.5 });

  if (past.unpaidDockHours >= 3) signals.push({ kind: "dock", text: `Sat ${past.unpaidDockHours} unpaid hours at docks this week, inside brokers' free time`, weight: 1 });

  const pendingExpenses = expenses.filter((e) => e.driverId === driver.id && e.status === "pending");
  const owed = pendingExpenses.reduce((s, e) => s + e.amount, 0);
  if (owed > 0) signals.push({ kind: "owed", text: `$${owed.toLocaleString()} of their own money is waiting on your approval`, weight: 2 });

  const pendingTimeOff = timeOff.find((r) => r.driverId === driver.id && r.status === "pending");
  if (pendingTimeOff) signals.push({ kind: "time_off", text: "Asked for time off and hasn't heard back", weight: 2 });

  if (past.longDays >= 3) signals.push({ kind: "hours", text: `${past.longDays} days of 10+ hours driving in the last week`, weight: 1 });

  const daysSinceCheckIn = driver.lastCheckInAt ? Math.floor((now - Date.parse(driver.lastCheckInAt)) / DAY_MS) : past.daysSinceCheckIn;
  if (daysSinceCheckIn >= 10) signals.push({ kind: "contact", text: `No check-in from you in ${daysSinceCheckIn} days`, weight: 1.5 });

  const score = signals.reduce((s, x) => s + x.weight, 0);
  return {
    level: score >= 5 ? "at_risk" : score >= 2.5 ? "watch" : "good",
    signals: signals.sort((a, b) => b.weight - a.weight),
    pendingExpenses,
    pendingTimeOff,
    daysSinceCheckIn,
  };
}
