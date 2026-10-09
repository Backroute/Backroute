import type { Load, Truck } from "./types";

/** Maintenance AI: how many miles until the truck's next scheduled service, from live odometer data. */
export function milesUntilService(truck: Truck): number {
  return truck.lastServiceMiles + truck.serviceIntervalMiles - truck.odometer;
}

export type ServiceStatus = "ok" | "due-soon" | "overdue";

export function serviceStatus(truck: Truck): ServiceStatus {
  const remaining = milesUntilService(truck);
  if (remaining < 0) return "overdue";
  if (remaining < 3000) return "due-soon";
  return "ok";
}

export function inspectionStatus(truck: Truck, now: number): ServiceStatus {
  const dueMs = new Date(truck.nextInspectionDue).getTime();
  const daysLeft = (dueMs - now) / (24 * 60 * 60 * 1000);
  if (daysLeft < 0) return "overdue";
  if (daysLeft < 14) return "due-soon";
  return "ok";
}

// ─── From the ELD: miles and engine faults ───────────────────────────────────

const DAY = 86400_000;

/** How many miles a day the truck has been running lately, from its loads (loaded and empty miles). */
function milesPerDay(truck: Truck, loads: Load[], now: number, days = 30): number {
  const since = now - days * DAY;
  const miles = loads
    .filter((l) => l.truckId === truck.id && l.stage === "delivered" && Date.parse(l.updatedAt) >= since)
    .reduce((s, l) => s + l.lane.miles + (l.deadheadMiles ?? 0), 0);
  return miles / days;
}

/** When the next service comes due at the truck's pace: "in about 9 days", or null if it hasn't run lately. */
export function serviceEtaDays(truck: Truck, loads: Load[], now: number): number | null {
  const left = milesUntilService(truck);
  if (left <= 0) return 0;
  const pace = milesPerDay(truck, loads, now);
  return pace > 20 ? Math.round(left / pace) : null;
}

// J1939 parameters that mean "stop soon": oil pressure, coolant temperature and level, and the emissions faults that
// lead to an engine derate (aftertreatment, DEF, SCR inducement).
const CRITICAL_SPN = new Set([100, 110, 111, 190, 3216, 3226, 3251, 3364, 4364, 5246, 1569, 520260]);
const CRITICAL_WORDS = /derate|shut ?down|stop engine|oil pressure|coolant (temp|level)|overheat|brake|inducement|limp/i;
const WARN_WORDS = /def|dpf|regen|aftertreatment|nox|scr|egr|turbo|injector|sensor|voltage|battery|abs/i;

/**
 * How bad an engine fault is, from what the ELD reports: the lamp the dash lit (red or "protect" means stop; amber
 * means book it in), the J1939 code (SPN), and the words in its description.
 */
export function faultSeverity(f: { code: string; description: string; lamp?: "red" | "amber" | "protect" | "mil" | null }): "info" | "warn" | "critical" {
  const spn = Number(f.code.match(/SPN\s*(\d+)/i)?.[1] ?? f.code.match(/^(\d+)/)?.[1]);
  if (f.lamp === "red" || f.lamp === "protect" || CRITICAL_SPN.has(spn) || CRITICAL_WORDS.test(f.description)) return "critical";
  if (f.lamp === "amber" || f.lamp === "mil" || WARN_WORDS.test(f.description)) return "warn";
  return "info";
}

/** What the owner sees about a fault, in plain words. */
export function faultAdvice(severity: "info" | "warn" | "critical"): string {
  if (severity === "critical") return "Have the driver pull over somewhere safe and call it in. Backroute won't book the truck until it's checked.";
  if (severity === "warn") return "Book it in at the next stop near a shop. It can run meanwhile.";
  return "Nothing to do now; it's watched.";
}
