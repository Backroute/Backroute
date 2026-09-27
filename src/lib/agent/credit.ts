import "server-only";
import type { Item } from "../cloud/rows";
import type { Broker, Load } from "../types";
import { addActivity, save, type CarrierContext } from "./db";
import { event } from "./dispatcher";

/**
 * A broker's credit, checked the way a dispatcher does before booking with someone new: a credit service's score
 * and days-to-pay (any service that answers by MC number: the factoring company's broker check, a credit bureau),
 * and what the carrier's own invoices show once the broker has paid a couple. Below the owner's lowest score the AI
 * doesn't ask to book on its own; a slow payer is asked a little more, the way a dispatcher prices the wait.
 *
 * CREDIT_API_URL with {{mc}}, CREDIT_API_HEADER ("Name: value"), CREDIT_SCORE_PATH and CREDIT_DAYS_PATH (where the
 * numbers are in the answer, default "score" and "daysToPay"), CREDIT_SCORE_MAX (the service's top score, default 100),
 * CREDIT_API_NAME.
 */

export const creditConfigured = () => Boolean(process.env.CREDIT_API_URL);
export const DEFAULT_MIN_CREDIT = 70;
/** Days to pay past which the AI asks for more, and the extra. */
export const SLOW_DAYS = 40;
export const SLOW_PAY_PCT = 4;
const FRESH = 7 * 86400_000;
const DAY = 86400_000;

function at(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined), obj);
}
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() && Number.isFinite(Number(v)) ? Number(v) : null);

/** The credit service's answer for an MC number: a score out of 100 and days to pay, either null when it has none. */
export async function creditLookup(mc: string): Promise<{ score: number | null; daysToPay: number | null } | null> {
  if (!creditConfigured()) return null;
  try {
    const url = process.env.CREDIT_API_URL!.replace(/\{\{mc\}\}/g, encodeURIComponent(mc));
    const [name, ...rest] = (process.env.CREDIT_API_HEADER ?? "").split(":");
    const res = await fetch(url, { headers: { accept: "application/json", ...(name && rest.length ? { [name.trim()]: rest.join(":").trim() } : {}) }, signal: AbortSignal.timeout(10000), cache: "no-store" });
    if (!res.ok) throw new Error(`credit ${res.status}`);
    const body = await res.json();
    const raw = num(at(body, process.env.CREDIT_SCORE_PATH ?? "score"));
    const max = Number(process.env.CREDIT_SCORE_MAX) || 100;
    return { score: raw === null ? null : Math.round((raw / max) * 100), daysToPay: num(at(body, process.env.CREDIT_DAYS_PATH ?? "daysToPay")) };
  } catch (e) {
    console.error("[credit] lookup failed", e);
    return null;
  }
}

/** Average days from invoice to payment on this broker's loads the carrier was paid for; null under two. */
export function ownDaysToPay(loads: Load[], brokerId: string): number | null {
  const paid = loads.filter((l) => l.brokerId === brokerId && l.invoice?.sentAt && l.invoice.paidAt).map((l) => (Date.parse(l.invoice!.paidAt!) - Date.parse(l.invoice!.sentAt!)) / DAY);
  return paid.length >= 2 ? Math.round(paid.reduce((a, b) => a + b, 0) / paid.length) : null;
}

export interface CreditVerdict {
  broker: Broker;
  /** Under the owner's lowest score: don't book on the AI's own. */
  blocked: boolean;
  /** Pays slowly: ask this much more (percent). */
  surchargePct: number;
  why: string | null;
}

/** Checks (at most weekly) and records the broker's credit. Never throws. */
export async function checkCredit(ctx: CarrierContext, broker: Broker, now = Date.now()): Promise<CreditVerdict> {
  let b = broker;
  const own = ownDaysToPay(ctx.loads, b.id);
  const stale = !b.credit || now - Date.parse(b.credit.at) > FRESH;
  if (stale && ((creditConfigured() && b.mc) || own !== null)) {
    const found = b.mc ? await creditLookup(b.mc) : null;
    // What the carrier's own invoices show beats the service's average once there are a couple.
    const daysToPay = own ?? found?.daysToPay ?? null;
    b = {
      ...b,
      credit: { score: found?.score ?? null, daysToPay, source: [found ? (process.env.CREDIT_API_NAME ?? "Credit service") : null, own !== null ? "your invoices" : null].filter(Boolean).join(" + "), at: new Date(now).toISOString() },
      ...(daysToPay !== null ? { avgDaysToPay: daysToPay } : {}),
    };
    await save("records", ctx.carrier.id, b as unknown as Item, "broker");
    ctx.brokers = ctx.brokers.map((x) => (x.id === b.id ? b : x));
    if (found || own !== null)
      await addActivity(ctx.carrier.id, event({ type: "escalation", message: `Credit checked: ${b.company}`, detail: [b.credit!.score !== null ? `score ${b.credit!.score}/100` : null, daysToPay !== null ? `pays in about ${daysToPay} days` : null, b.credit!.source].filter(Boolean).join(" · "), severity: "info" }));
  }
  const min = ctx.settings.minBrokerCredit ?? DEFAULT_MIN_CREDIT;
  const score = b.credit?.score ?? null;
  const days = b.credit?.daysToPay ?? null;
  if (score !== null && score < min) return { broker: b, blocked: true, surchargePct: 0, why: `${b.company}'s credit score is ${score}/100, under your lowest (${min})` };
  if (days !== null && days > 60) return { broker: b, blocked: true, surchargePct: 0, why: `${b.company} takes about ${days} days to pay` };
  if (days !== null && days > SLOW_DAYS) return { broker: b, blocked: false, surchargePct: SLOW_PAY_PCT, why: `${b.company} takes about ${days} days to pay` };
  return { broker: b, blocked: false, surchargePct: 0, why: null };
}
