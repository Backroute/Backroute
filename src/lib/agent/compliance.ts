import "server-only";
import { claimMark, latestFiles, type CarrierContext } from "./db";
import { dueWords, paperworkDue } from "../expiry";
import { passToOwner } from "./dispatcher";

/**
 * The deadlines a small carrier's dispatcher usually keeps for the owner: each truck's plates and annual DOT
 * inspection, each driver's CDL and medical card, the insurance certificate, IFTA (the quarterly return and the yearly
 * decals), the yearly UCR registration and the heavy vehicle use tax (Form 2290). The AI reminds the owner
 * ahead of each one, once, and says what's needed. It doesn't file anything.
 */

const DAY = 86400_000;

export function deadlines(ctx: Pick<CarrierContext, "trucks" | "drivers">, now: number, insuranceExpires?: string | null): { key: string; due: string; days: number; text: string }[] {
  const out: { key: string; due: string; days: number; text: string }[] = [];
  // Plates, inspections, CDLs, medical cards, insurance and IFTA: a reminder 30, 14 and 7 days out, and once it's run
  // out (lib/expiry). Each is its own mark, so each goes once.
  for (const p of paperworkDue({ trucks: ctx.trucks, drivers: ctx.drivers, insuranceExpires, now })) {
    if (p.stage === null) continue;
    const when = p.days < 0 ? `ran out ${p.due}` : p.days === 0 ? "runs out today" : `is due ${p.due}, ${dueWords(p.days)}`;
    out.push({ key: `${p.key}:${p.stage}`, due: p.due, days: p.days, text: `${p.what} ${when}. ${p.todo}` });
  }
  const d = new Date(now);
  const add = (key: string, due: Date, warnDays: number, text: string) => {
    const days = Math.ceil((due.getTime() - now) / DAY);
    if (days <= warnDays) out.push({ key, due: due.toISOString().slice(0, 10), days, text: `${text} by ${due.toISOString().slice(0, 10)}, ${dueWords(days)}.` });
  };
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
  // The insurance date: the newest certificate on file with one, or the date the owner typed in.
  const coi = (await latestFiles(ctx.carrier.id, ["coi"]).catch(() => []))[0];
  for (const item of deadlines(ctx, now, coi?.expires_on ?? ctx.settings.insuranceExpires ?? null)) {
    if (!(await claimMark(ctx.carrier.id, "compliance", item.key))) continue;
    await passToOwner(ctx, {
      reason: item.text,
      label: "Done",
      source: "app",
      to: "owner",
    });
    done.push(item.key);
  }
  return done;
}
