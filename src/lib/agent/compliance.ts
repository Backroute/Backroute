import "server-only";
import { claimMark, type CarrierContext } from "./db";
import { passToOwner } from "./dispatcher";

/**
 * The deadlines a small carrier's dispatcher usually keeps for the owner: each truck's annual DOT inspection, the
 * quarterly IFTA return, the yearly UCR registration and the heavy vehicle use tax (Form 2290). The AI reminds the owner
 * ahead of each one, once, and says what's needed. It doesn't file anything.
 */

const DAY = 86400_000;

/** IFTA returns are due the last day of the month after each quarter. */
function iftaDue(now: Date): { due: Date; quarter: string } {
  const y = now.getUTCFullYear();
  const dues = [
    { due: new Date(Date.UTC(y, 0, 31)), quarter: `Q4 ${y - 1}` },
    { due: new Date(Date.UTC(y, 3, 30)), quarter: `Q1 ${y}` },
    { due: new Date(Date.UTC(y, 6, 31)), quarter: `Q2 ${y}` },
    { due: new Date(Date.UTC(y, 9, 31)), quarter: `Q3 ${y}` },
    { due: new Date(Date.UTC(y + 1, 0, 31)), quarter: `Q4 ${y}` },
  ];
  return dues.find((d) => d.due.getTime() >= now.getTime() - DAY)!;
}

export function deadlines(ctx: Pick<CarrierContext, "trucks">, now: number): { key: string; due: string; days: number; text: string }[] {
  const out: { key: string; due: string; days: number; text: string }[] = [];
  const d = new Date(now);
  const add = (key: string, due: Date, warnDays: number, text: string) => {
    const days = Math.ceil((due.getTime() - now) / DAY);
    if (days <= warnDays) out.push({ key, due: due.toISOString().slice(0, 10), days, text });
  };
  for (const t of ctx.trucks) {
    const due = Date.parse(t.nextInspectionDue ?? "");
    if (Number.isFinite(due)) add(`inspection:${t.id}:${t.nextInspectionDue}`, new Date(due), 30, `Truck ${t.unitNumber}'s annual DOT inspection is due`);
  }
  const ifta = iftaDue(d);
  add(`ifta:${ifta.quarter}`, ifta.due, 21, `The IFTA return for ${ifta.quarter} is due. Miles by state come from the ELD or the drivers' trip logs, and fuel from the fuel card report`);
  // Yearly deadlines: the next one that hasn't passed by more than a week.
  const next = (month: number, day: number) => {
    const y = d.getUTCFullYear();
    const due = new Date(Date.UTC(y, month, day));
    return due.getTime() < now - 7 * DAY ? new Date(Date.UTC(y + 1, month, day)) : due;
  };
  const ucr = next(11, 31);
  add(`ucr:${ucr.getUTCFullYear() + 1}`, ucr, 45, `UCR registration for ${ucr.getUTCFullYear() + 1} is due (ucr.gov). Brokers and inspectors check it`);
  const hvut = next(7, 31);
  add(`2290:${hvut.getUTCFullYear()}`, hvut, 30, `Form 2290 (heavy vehicle use tax) for the year starting July ${hvut.getUTCFullYear()} is due. Keep the stamped Schedule 1 for plates and permits`);
  return out;
}

export async function complianceReminders(ctx: CarrierContext, now: number): Promise<string[]> {
  const done: string[] = [];
  for (const item of deadlines(ctx, now)) {
    if (!(await claimMark(ctx.carrier.id, "compliance", item.key))) continue;
    await passToOwner(ctx, {
      reason: `${item.text} ${item.days < 0 ? `(it was due ${item.due})` : item.days === 0 ? "today" : `by ${item.due}, in ${item.days} day${item.days === 1 ? "" : "s"}`}.`,
      label: "Done",
      source: "app",
      to: "owner",
    });
    done.push(item.key);
  }
  return done;
}
