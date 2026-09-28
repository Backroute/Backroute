import "server-only";
import { translateForDriver } from "../ai/translate";
import { canText, textTo } from "../channels/out";
import { toE164 } from "../cloud/phone";
import { pushToOffice } from "../push";
import { hourAtStop, zoneFor } from "../stop-time";
import type { Load } from "../types";
import { admin, claimMark, logChannel, type CarrierContext } from "./db";

/**
 * The owner's one-minute review of the week, Monday morning: what the trucks made, how much was driven empty, the
 * best and worst broker, and the one thing worth changing, the way a dispatcher sits down with the owner once a week.
 * Kept for the app (Home shows the latest), texted to the owner, and on their phone as a notification.
 */

const DAY = 86400_000;

export interface WeeklyReview {
  week: string;
  from: string;
  to: string;
  loads: number;
  gross: number;
  net: number;
  loadedMiles: number;
  emptyMiles: number;
  emptyPct: number;
  rpm: number | null;
  lastWeekGross: number;
  best: { broker: string; rpm: number; loads: number } | null;
  worst: { broker: string; why: string } | null;
  change: string;
  byTruck: { unit: string; gross: number; loads: number }[];
}

/** "2026-W40" for the week an instant is in (ISO weeks, Monday first). */
export function isoWeek(at: number): string {
  const d = new Date(at);
  const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day + 3);
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  return `${d.getUTCFullYear()}-W${String(1 + Math.round((d.getTime() - firstThursday.getTime()) / (7 * DAY))).padStart(2, "0")}`;
}

const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const deliveredIn = (loads: Load[], from: number, to: number) => loads.filter((l) => !l.imported && l.stage === "delivered" && Date.parse(l.updatedAt) >= from && Date.parse(l.updatedAt) < to);
const pay = (l: Load) => l.invoice?.amount ?? l.bookedRate ?? 0;

/** The review of the 7 days before `now`. */
export function reviewFor(ctx: CarrierContext, now: number): WeeklyReview {
  const from = now - 7 * DAY;
  const week = deliveredIn(ctx.loads, from, now);
  const last = deliveredIn(ctx.loads, from - 7 * DAY, from);
  const gross = week.reduce((s, l) => s + pay(l), 0);
  const net = week.reduce((s, l) => s + (l.netProfit ?? 0), 0);
  const loadedMiles = week.reduce((s, l) => s + (l.lane.miles || 0), 0);
  const emptyMiles = week.reduce((s, l) => s + (l.deadheadMiles || 0), 0);
  const emptyPct = loadedMiles + emptyMiles ? Math.round((emptyMiles / (loadedMiles + emptyMiles)) * 100) : 0;
  const nameOf = (id: string) => ctx.brokers.find((b) => b.id === id)?.company ?? "A broker";

  // Best broker: the most per mile this week.
  const byBroker = new Map<string, { gross: number; miles: number; loads: number }>();
  for (const l of week) {
    const b = byBroker.get(l.brokerId) ?? { gross: 0, miles: 0, loads: 0 };
    byBroker.set(l.brokerId, { gross: b.gross + pay(l), miles: b.miles + (l.lane.miles || 0), loads: b.loads + 1 });
  }
  const ranked = [...byBroker.entries()].filter(([, v]) => v.miles > 0).map(([id, v]) => ({ id, rpm: v.gross / v.miles, loads: v.loads })).sort((a, b) => b.rpm - a.rpm);
  const best = ranked[0] ? { broker: nameOf(ranked[0].id), rpm: Math.round(ranked[0].rpm * 100) / 100, loads: ranked[0].loads } : null;

  // Worst broker: the slowest payer over the last 90 days (two or more invoices over 35 days), else the lowest per mile.
  const paidLate = new Map<string, number[]>();
  for (const l of ctx.loads) {
    const inv = l.invoice;
    if (!inv?.sentAt || Date.parse(inv.sentAt) < now - 90 * DAY) continue;
    const days = Math.round(((inv.paidAt ? Date.parse(inv.paidAt) : now) - Date.parse(inv.sentAt)) / DAY);
    if (days > 35) paidLate.set(l.brokerId, [...(paidLate.get(l.brokerId) ?? []), days]);
  }
  const slow = [...paidLate.entries()].filter(([, d]) => d.length >= 2).sort((a, b) => Math.max(...b[1]) - Math.max(...a[1]))[0];
  const low = ranked.length > 1 ? ranked[ranked.length - 1] : null;
  const worst = slow
    ? { broker: nameOf(slow[0]), why: `${slow[1].length} invoices took ${slow[1].sort((a, b) => a - b).join(" and ")} days to pay (or still aren't paid)` }
    : low
      ? { broker: nameOf(low.id), why: `paid the least per mile, $${low.rpm.toFixed(2)}` }
      : null;

  const byTruck = ctx.trucks.map((t) => {
    const mine = week.filter((l) => l.truckId === t.id);
    return { unit: t.unitNumber, gross: mine.reduce((s, l) => s + pay(l), 0), loads: mine.length };
  });

  // The one thing to change, most costly first.
  const away = ctx.drivers.map((d) => ({ d, days: d.lastHomeAt ? Math.floor((now - Date.parse(d.lastHomeAt)) / DAY) : null })).filter((x) => x.days !== null && x.days >= 21).sort((a, b) => b.days! - a.days!)[0];
  const idle = byTruck.find((t) => t.loads === 0 && ctx.trucks.find((x) => x.unitNumber === t.unit)?.status !== "maintenance");
  // Detention claimed in the last month on loads whose invoice isn't paid yet.
  const unpaidDetention = ctx.loads.filter((l) => !l.invoice?.paidAt && (l.detentionClaims ?? []).some((c) => c.sentAt && Date.parse(c.sentAt) > now - 30 * DAY));
  const change = slow
    ? `Stop taking ${nameOf(slow[0])}'s loads unless they'll quick-pay: ${slow[1].length} invoices took over 35 days. The AI can pass on them for you (Brokers page, set them to avoid).`
    : emptyPct >= 20
      ? `${emptyPct}% of the miles were driven empty. Lower the most empty miles the AI will take (Settings, now ${ctx.settings.maxDeadhead ?? 300}), or let it move trucks toward busier freight.`
      : away
        ? `${away.d.name} hasn't been home in ${away.days} days. Tell the AI to get them home next (their profile, home time), before it costs you a driver.`
        : idle && week.length
          ? `Truck ${idle.unit} didn't haul a load this week. Connect a load board in Settings or lower the lowest rate you'll take so the AI can find it work.`
          : unpaidDetention.length >= 2
            ? `${unpaidDetention.length} detention claims from the last month aren't paid yet. The AI keeps asking; add detention terms to your setup packet so brokers agree to them up front.`
            : week.length
              ? "Nothing to change: it was a clean week. Keep it going."
              : "No loads delivered this week. If the trucks were running, check that broker emails reach your Backroute address.";

  return {
    week: isoWeek(now - DAY),
    from: new Date(from).toISOString(),
    to: new Date(now).toISOString(),
    loads: week.length,
    gross: Math.round(gross),
    net: Math.round(net),
    loadedMiles: Math.round(loadedMiles),
    emptyMiles: Math.round(emptyMiles),
    emptyPct,
    rpm: loadedMiles ? Math.round((gross / loadedMiles) * 100) / 100 : null,
    lastWeekGross: Math.round(last.reduce((s, l) => s + pay(l), 0)),
    best,
    worst,
    change,
    byTruck,
  };
}

/** The review as a text: the numbers in two lines, then the one change. */
export function reviewText(r: WeeklyReview, carrier: string): string {
  const delta = r.lastWeekGross ? Math.round(((r.gross - r.lastWeekGross) / r.lastWeekGross) * 100) : null;
  return [
    `${carrier}, your week: ${r.loads} load${r.loads === 1 ? "" : "s"}, ${money(r.gross)}${delta !== null ? ` (${delta >= 0 ? "+" : ""}${delta}% on last week)` : ""}, ${money(r.net)} after costs.`,
    `${r.rpm ? `$${r.rpm.toFixed(2)} a loaded mile, ` : ""}${r.emptyPct}% empty miles.${r.best ? ` Best: ${r.best.broker} ($${r.best.rpm.toFixed(2)}/mi).` : ""}${r.worst ? ` Worst: ${r.worst.broker}, ${r.worst.why}.` : ""}`,
    `One thing: ${r.change}`,
  ].join("\n");
}

function reviewTime(now: number, state: string): boolean {
  const day = process.env.REVIEW_DAY ?? "1";
  const [a, b] = (process.env.REVIEW_HOURS ?? "7-11").split("-").map(Number);
  const weekday = new Intl.DateTimeFormat("en-US", { timeZone: zoneFor(state), weekday: "short" }).format(new Date(now));
  const dayOk = day === "any" || ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(weekday) === Number(day);
  const hour = hourAtStop(state, now);
  return dayOk && hour >= a && hour < b;
}

/** Monday morning, once a week: the review is kept, texted to the owner, and pushed to the office's phones. */
export async function weeklyReview(ctx: CarrierContext, now: number): Promise<string[]> {
  if (ctx.settings.weeklyReview === false) return [];
  // Owner's time zone: where the business is, else where the trucks are based.
  const state = ctx.settings.businessAddress?.match(/,\s*([A-Z]{2})\b/)?.[1] ?? ctx.trucks[0]?.homeBase?.split(",")[1]?.trim() ?? "TX";
  if (!reviewTime(now, state)) return [];
  const r = reviewFor(ctx, now);
  if (!(await claimMark(ctx.carrier.id, `review:${r.week}`, "weekly_review"))) return [];
  await admin().from("weekly_reviews").upsert({ carrier_id: ctx.carrier.id, week: r.week, data: r }, { onConflict: "carrier_id,week" });
  const text = reviewText(r, ctx.carrier.name);
  const owner = ctx.carrier.owner_phone ? toE164(ctx.carrier.owner_phone) : null;
  if (owner && canText(ctx.carrier)) {
    const body = await translateForDriver(text, ctx.settings.ownerLanguage ?? "en");
    const sid = await textTo(ctx.carrier, owner, body);
    await logChannel({ carrierId: ctx.carrier.id, channel: "sms", direction: "out", providerId: sid ?? null, counterparty: owner, body, data: { kind: "weekly_review", week: r.week } });
  }
  await pushToOffice(ctx.carrier.id, { title: "Your week", body: `${r.loads} loads, ${money(r.gross)}. ${r.change}`, url: "/carrier", tag: `review-${r.week}` }).catch(() => 0);
  return [`Weekly review ${r.week} to the owner`];
}

export async function latestReview(carrierId: string): Promise<WeeklyReview | null> {
  const { data } = await admin().from("weekly_reviews").select("data").eq("carrier_id", carrierId).order("week", { ascending: false }).limit(1);
  return (data?.[0]?.data as WeeklyReview | undefined) ?? null;
}
