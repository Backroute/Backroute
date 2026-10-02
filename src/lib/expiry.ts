import type { Driver, Truck } from "./types";

/**
 * Paperwork with an end date, the way a dispatcher keeps the calendar for the owner: each truck's plates
 * (registration) and annual DOT inspection, each driver's CDL and medical card, the carrier's insurance, and IFTA (the
 * quarterly return and the yearly decals). Reminders go out 30, 14 and 7 days ahead, and again once it's run out.
 */

const DAY = 86400_000;

export const REMIND_AT = [30, 14, 7] as const;
export type Stage = 30 | 14 | 7 | 0;

export interface PaperworkItem {
  /** Stable for this item and this due date: a renewed date is a new reminder cycle. */
  key: string;
  kind: "registration" | "inspection" | "cdl" | "med_card" | "insurance" | "ifta_return" | "ifta_decals";
  /** "Registration for T-104", "Marcus Bell's medical card". */
  what: string;
  /** yyyy-mm-dd */
  due: string;
  /** Days from today; negative once it's run out. */
  days: number;
  stage: Stage | null;
  /** What to do about it, in one line. */
  todo: string;
  truckId?: string;
  driverId?: string;
}

/** Which reminder a date is at: 30, 14 or 7 days out, 0 when it's today or past, null when it's further off. */
export function stageFor(days: number): Stage | null {
  if (days <= 0) return 0;
  for (const s of [7, 14, 30] as const) if (days <= s) return s;
  return null;
}

const dayOf = (iso: string) => iso.slice(0, 10);
/** Whole days from today to the due day (calendar days, so yesterday is -1 whatever the hour). */
const daysUntil = (due: string, now: number) => Math.round((Date.parse(`${dayOf(due)}T00:00:00Z`) - Date.parse(`${new Date(now).toISOString().slice(0, 10)}T00:00:00Z`)) / DAY);

/** The next IFTA quarterly return: due the last day of the month after each quarter. */
export function iftaReturnDue(now: number): { due: string; quarter: string } {
  const y = new Date(now).getUTCFullYear();
  const dues = [
    { due: `${y}-01-31`, quarter: `Q4 ${y - 1}` },
    { due: `${y}-04-30`, quarter: `Q1 ${y}` },
    { due: `${y}-07-31`, quarter: `Q2 ${y}` },
    { due: `${y}-10-31`, quarter: `Q3 ${y}` },
    { due: `${y + 1}-01-31`, quarter: `Q4 ${y}` },
  ];
  return dues.find((d) => daysUntil(d.due, now) >= -1)!;
}

export function paperworkDue(input: { trucks: Truck[]; drivers: Driver[]; insuranceExpires?: string | null; now: number; horizon?: number }): PaperworkItem[] {
  const { now } = input;
  const horizon = input.horizon ?? 30;
  const out: PaperworkItem[] = [];
  const add = (item: Omit<PaperworkItem, "days" | "stage" | "due"> & { due: string }) => {
    const days = daysUntil(item.due, now);
    if (days > horizon) return;
    out.push({ ...item, due: dayOf(item.due), days, stage: stageFor(days) });
  };
  for (const t of input.trucks) {
    if (t.registrationExpires)
      add({ key: `registration:${t.id}:${dayOf(t.registrationExpires)}`, kind: "registration", what: `Registration for ${t.unitNumber}`, due: t.registrationExpires, truckId: t.id, todo: "Renew the plates (IRP) and put the new cab card in the truck." });
    if (t.nextInspectionDue)
      add({ key: `inspection:${t.id}:${dayOf(t.nextInspectionDue)}`, kind: "inspection", what: `Annual DOT inspection for ${t.unitNumber}`, due: t.nextInspectionDue, truckId: t.id, todo: "Book it at a shop. The AI stops booking the truck once it lapses." });
  }
  for (const d of input.drivers) {
    if (d.cdlExpires)
      add({ key: `cdl:${d.id}:${dayOf(d.cdlExpires)}`, kind: "cdl", what: `${d.name}'s CDL`, due: d.cdlExpires, driverId: d.id, todo: "They renew it at the DMV. No loads go to them once it runs out." });
    if (d.medCardExpires)
      add({ key: `med:${d.id}:${dayOf(d.medCardExpires)}`, kind: "med_card", what: `${d.name}'s medical card`, due: d.medCardExpires, driverId: d.id, todo: "Book a DOT physical with a registry examiner, then send the new card to the state." });
  }
  if (input.insuranceExpires)
    add({ key: `insurance:${dayOf(input.insuranceExpires)}`, kind: "insurance", what: "Your insurance certificate", due: input.insuranceExpires, todo: "Ask your agent for the renewed certificate (COI). Brokers check it before every load." });
  const ifta = iftaReturnDue(now);
  add({ key: `ifta:${ifta.quarter}`, kind: "ifta_return", what: `IFTA return for ${ifta.quarter}`, due: ifta.due, todo: "Miles by state come from the trips, fuel from the fuel card imports (Money → Fuel & tolls)." });
  const y = new Date(now).getUTCFullYear();
  add({ key: `ifta-decals:${y + 1}`, kind: "ifta_decals", what: `IFTA decals for ${y + 1}`, due: `${y}-12-31`, todo: "Renew the IFTA license with your base state and put the new decals on each truck." });
  return out.sort((a, b) => a.days - b.days);
}

/** Why a truck can't legally take a load right now, if it can't: what the AI checks before it books one. */
export function cantRun(truck: Truck, driver: Driver | undefined, now: number): string | null {
  const gone = (iso?: string) => !!iso && daysUntil(iso, now) < 0;
  if (gone(truck.nextInspectionDue)) return `${truck.unitNumber}'s annual inspection is past due`;
  if (gone(truck.registrationExpires)) return `${truck.unitNumber}'s registration ran out`;
  if (truck.faults?.some((f) => f.severity === "critical")) return `${truck.unitNumber} has an engine fault to look at first`;
  if (driver && gone(driver.cdlExpires)) return `${driver.name}'s CDL ran out`;
  if (driver && gone(driver.medCardExpires)) return `${driver.name}'s medical card ran out`;
  return null;
}

/** "in 12 days", "today", "3 days ago". */
export function dueWords(days: number): string {
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days > 0) return `in ${days} days`;
  return days === -1 ? "yesterday" : `${-days} days ago`;
}
