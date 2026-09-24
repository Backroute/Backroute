import { DETENTION_FREE_MIN, DETENTION_RATE_HR } from "./detention";
import type { Broker, Load, RateConIssue, RateConReview } from "./types";

/**
 * The rate confirmation is the contract, and it often doesn't say what was agreed on the phone: a lower rate,
 * worse detention terms, fines nobody mentioned, longer payment terms, a different pickup day. Every one of those
 * costs the carrier money later if nobody reads it before signing. The AI reads each rate con against what was
 * negotiated, asks the broker for a corrected one, and only brings the owner in when the broker won't fix it — or
 * when the MC on the paper isn't the broker they negotiated with (a double-brokering red flag).
 */

/** How long the AI takes to read a rate con, and how long a broker takes to send a corrected one (demo time). */
export const RATE_CON_READ_MS = 2500;
export const RATE_CON_FIX_MS = 9000;

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

const money = (n: number) => `$${n.toLocaleString()}`;
const freeHours = DETENTION_FREE_MIN / 60;

/** What the paper says versus what was agreed. Decided per load, so the same load always has the same rate con. */
export function reviewRateCon(load: Load, broker: Broker | undefined): RateConReview {
  const h = hash(load.id + "ratecon");
  const agreedRate = load.bookedRate ?? load.targetRate;
  const issues: RateConIssue[] = [];
  const add = (issue: Omit<RateConIssue, "id" | "status">) => issues.push({ ...issue, id: `${load.id}-${issue.field}`, status: "open" });

  // About 1 in 25: the MC on the rate con isn't the broker the AI negotiated with.
  if (h % 25 === 0) {
    const onDoc = `MC ${800000 + (h % 199999)}`;
    add({
      field: "mc",
      label: "Broker MC",
      agreed: `${broker?.company ?? "The broker"}'s own MC`,
      onDoc: `${onDoc}, a different company`,
      cost: 0,
      block: true,
    });
  } else if (h % 100 < 35) {
    // About a third of rate cons have something wrong on them; some have two things.
    const kinds = ["rate", "detention", "fines", "payment", "pickup"] as const;
    const first = kinds[(h >>> 4) % kinds.length];
    const second = (h >>> 9) % 3 === 0 ? kinds[((h >>> 4) + 1 + ((h >>> 12) % 4)) % kinds.length] : null;
    for (const kind of [first, second]) {
      if (!kind || issues.some((i) => i.field === kind)) continue;
      if (kind === "rate") {
        const short = 50 + ((h >>> 6) % 7) * 25;
        add({ field: "rate", label: "Rate", agreed: money(agreedRate), onDoc: money(agreedRate - short), cost: short, block: true });
      } else if (kind === "detention") {
        add({
          field: "detention",
          label: "Detention",
          agreed: `${freeHours} hrs free, then ${money(DETENTION_RATE_HR)}/hr`,
          onDoc: "3 hrs free, then $40/hr, max $200",
          cost: 105,
          block: false,
        });
      } else if (kind === "fines") {
        add({ field: "fines", label: "Fines", agreed: "None discussed", onDoc: "$250/hr late fee, $150 if tracking drops", cost: 150, block: false });
      } else if (kind === "payment") {
        add({ field: "payment", label: "Payment terms", agreed: "Net 30", onDoc: "Net 45", cost: 0, block: false });
      } else {
        add({ field: "pickup", label: "Pickup", agreed: load.pickupWindow, onDoc: "A day later than agreed", cost: 0, block: true });
      }
    }
  }

  return { status: "checking", startedAt: new Date().toISOString(), issues };
}

/** How likely a broker is to fix each kind of mistake when asked. Typos and rates get fixed; terms get pushback. */
const FIX_CHANCE: Record<RateConIssue["field"], number> = { rate: 0.9, pickup: 0.95, detention: 0.55, fines: 0.6, payment: 0.5, mc: 0 };

/** The broker's answer to the AI's request for a corrected rate con: each open problem fixed, or refused. */
export function brokerCorrects(review: RateConReview, loadId: string): RateConReview {
  const issues = review.issues.map((i, n) =>
    i.status !== "open" ? i : { ...i, status: (hash(loadId + i.field + n) % 100) / 100 < FIX_CHANCE[i.field] ? ("fixed" as const) : ("refused" as const) },
  );
  return { ...review, issues };
}

/** Money the check kept in the carrier's pocket: short rates and fines the broker took off. */
export function savedBy(review: RateConReview): number {
  return review.issues.filter((i) => i.status === "fixed").reduce((s, i) => s + i.cost, 0);
}

/** One line for the log and the owner: what the broker wouldn't change. */
export function refusedSummary(review: RateConReview): string {
  return review.issues
    .filter((i) => i.status === "refused" || (i.field === "mc" && i.status === "open"))
    .map((i) => `${i.label}: rate con says ${i.onDoc}, agreed ${i.agreed}`)
    .join("; ");
}
