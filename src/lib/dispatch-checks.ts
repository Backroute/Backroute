import type { Driver, Endorsement, Load } from "./types";

/** One thing checked before a load goes on a driver: fine, a heads-up, or a stop (hard). */
export interface DispatchCheck {
  key: "hours" | "cycle" | "cdl" | "medical" | Endorsement;
  ok: boolean;
  /** Can't legally run it: the AI won't put this load on this driver on its own. */
  hard: boolean;
  label: string;
  detail: string;
}

const DAY = 86400_000;
/** Average truck speed over a run, stops included: what "hours of driving" is estimated from. */
const AVG_MPH = 50;

const ENDORSEMENT_LABEL: Record<Endorsement, string> = { H: "Hazmat (H)", N: "Tanker (N)", T: "Doubles/triples (T)", X: "Hazmat + tanker (X)", TWIC: "TWIC card" };

/** What the load needs on the driver's CDL, from the load and what the rate con says. */
export function endorsementsNeeded(load: Load): Endorsement[] {
  const r = load.rateConReading;
  const text = [load.commodity, r?.commodity, ...(r?.specialInstructions ?? []), load.equipmentType, r?.equipment].filter(Boolean).join(" ").toLowerCase();
  const out: Endorsement[] = [];
  if (load.hazmat || /\bhaz ?mat\b|hazardous|un ?\d{4}\b|placard/.test(text)) out.push("H");
  if (/\btank(er)?\b/.test(text)) out.push("N");
  if (/\b(doubles|triples|double trailers?|pups?)\b/.test(text)) out.push("T");
  if (/\btwic\b|\bport of\b|\bterminal\b.*\bport\b|\bmarine terminal\b/.test(text)) out.push("TWIC");
  return out;
}

const has = (driver: Driver, e: Endorsement) => !!driver.endorsements?.includes(e) || ((e === "H" || e === "N") && !!driver.endorsements?.includes("X"));

/**
 * What a dispatcher checks before giving a driver a load: enough hours to run it, a CDL and medical card good past
 * delivery, and the endorsements it needs. Dates or endorsements not on file are a heads-up, not a stop.
 */
export function dispatchChecks(load: Load, driver: Driver, now: number): DispatchCheck[] {
  const checks: DispatchCheck[] = [];
  const driveHours = Math.round((load.lane.miles / AVG_MPH) * 10) / 10;
  const today = driver.hos ? Math.min(driver.hos.drive, driver.hos.shift) : driver.hoursRemaining;
  const legalToday = today >= Math.min(driveHours, 1);
  checks.push({
    key: "hours",
    ok: legalToday,
    hard: false,
    label: "Hours today",
    detail: `${today.toFixed(1)} h of driving left today; the run is about ${driveHours} h${driveHours > today ? ", so it takes a 10-hour break on the way" : ""}.`,
  });
  if (driver.hos) {
    const enough = driver.hos.cycle >= Math.min(driveHours, 11);
    checks.push({ key: "cycle", ok: enough, hard: !enough, label: "Hours this week", detail: enough ? `${driver.hos.cycle.toFixed(1)} h left on the 70-hour clock.` : `Only ${driver.hos.cycle.toFixed(1)} h left on the 70-hour clock: a 34-hour restart first.` });
  }
  const until = Date.parse(load.deliveryAt ?? load.pickupAt ?? "") || now + 3 * DAY;
  for (const [key, label, date] of [["cdl", "CDL", driver.cdlExpires], ["medical", "Medical card", driver.medCardExpires]] as const) {
    if (!date) {
      checks.push({ key, ok: false, hard: false, label, detail: "Expiry date not on file (Settings → paperwork)." });
      continue;
    }
    const runsOut = Date.parse(`${date.slice(0, 10)}T23:59:59Z`);
    const ok = runsOut >= until;
    checks.push({ key, ok, hard: !ok, label, detail: ok ? `Good through ${date.slice(0, 10)}.` : runsOut < now ? `Expired ${date.slice(0, 10)}.` : `Runs out ${date.slice(0, 10)}, before delivery.` });
  }
  for (const e of endorsementsNeeded(load)) {
    const known = !!driver.endorsements;
    const ok = has(driver, e);
    checks.push({ key: e, ok, hard: known && !ok, label: ENDORSEMENT_LABEL[e], detail: ok ? "On their CDL." : known ? "The load needs it and it's not on their CDL." : "The load needs it. Not on file whether they have it." });
  }
  return checks;
}

/** A load this driver can't legally run (an expired card, a missing endorsement, no hours this week). */
export const dispatchStops = (load: Load, driver: Driver, now: number) => dispatchChecks(load, driver, now).filter((c) => c.hard);
