import type { Broker } from "./types";

/** How the AI deals with a broker: book as usual, price in the risk, or don't book at all. */
export type BrokerPolicy = "normal" | "surcharge" | "block";

/** Standard broker payment terms the AI measures against. */
export const STANDARD_TERMS_DAYS = 30;
/** What the AI adds to its ask for a slow-paying broker: roughly the cost of waiting a few extra weeks for the
 *  money, or of factoring it. Some brokers will say no, and the load goes to someone else. */
export const SLOW_PAY_SURCHARGE_PCT = 4;

export interface BrokerAssessment {
  policy: BrokerPolicy;
  /** What the AI would do on its own, before any override from the carrier. */
  auto: BrokerPolicy;
  overridden: boolean;
  /** Why, in plain words; empty for a broker with a clean record. */
  reasons: string[];
}

function autoAssess(b: Broker): { policy: BrokerPolicy; reasons: string[] } {
  const block: string[] = [];
  if (!b.authorityVerified) block.push("Operating authority couldn't be verified with FMCSA");
  if (b.fraudRisk === "high") block.push("High fraud risk: identity or double-brokering flags");
  if (b.avgDaysToPay > 60) block.push(`Takes ${b.avgDaysToPay} days on average to pay`);
  if (block.length) return { policy: "block", reasons: block };

  const surcharge: string[] = [];
  if (b.avgDaysToPay > 40) surcharge.push(`Pays in about ${b.avgDaysToPay} days, not ${STANDARD_TERMS_DAYS}`);
  if (b.detentionPaidPct < 50) surcharge.push(`Paid only ${b.detentionPaidPct}% of detention claims`);
  if (b.cancellations90d >= 3) surcharge.push(`Cancelled ${b.cancellations90d} booked loads in the last 90 days`);
  const notes = b.fraudRisk === "medium" ? ["Elevated fraud risk: the AI confirms the contact and rate con before booking"] : [];
  return { policy: surcharge.length ? "surcharge" : "normal", reasons: [...surcharge, ...notes] };
}

export function assessBroker(b: Broker, overrides: Record<string, BrokerPolicy> = {}): BrokerAssessment {
  const auto = autoAssess(b);
  const override = overrides[b.id];
  return { policy: override ?? auto.policy, auto: auto.policy, overridden: override !== undefined && override !== auto.policy, reasons: auto.reasons };
}

/** The brokers the AI may source from, and the extra percentage to ask each surcharged one for. */
export function bookableBrokers(brokers: Broker[], overrides: Record<string, BrokerPolicy>): { brokers: Broker[]; surcharges: Record<string, number> } {
  const surcharges: Record<string, number> = {};
  const bookable = brokers.filter((b) => {
    const { policy } = assessBroker(b, overrides);
    if (policy === "surcharge") surcharges[b.id] = SLOW_PAY_SURCHARGE_PCT;
    return policy !== "block";
  });
  // Never leave the AI with nobody to call — a carrier who blocks everyone still gets offers from the best of them.
  return { brokers: bookable.length ? bookable : brokers, surcharges };
}

export const POLICY_LABEL: Record<BrokerPolicy, string> = {
  normal: "Book normally",
  surcharge: `Ask ${SLOW_PAY_SURCHARGE_PCT}% more`,
  block: "Don't book",
};
