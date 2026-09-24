import { assessBroker, STANDARD_TERMS_DAYS } from "./broker-policy";
import { FACTORING_FEE_PCT } from "./settlements";
import type { Broker, Load } from "./types";

/** Factoring partner's same-day cutoff: invoices approved before 11 AM on a business day fund that afternoon. */
const FUNDING_CUTOFF_HOUR = 11;
const FUNDED_BY_HOUR = 17;
/** Recourse factoring: if the broker hasn't paid the factor by then, the advance is charged back to the carrier. */
export const RECOURSE_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;

export type PaymentState = "held" | "submitted" | "funded" | "invoiced" | "overdue" | "paid";

export interface PaymentStep {
  label: string;
  detail?: string;
  state: "done" | "current" | "todo" | "problem";
}

export interface PaymentStatus {
  method: "factoring" | "direct";
  state: PaymentState;
  /** Linehaul plus approved extras (detention, lumper) that went on this invoice. */
  invoiceAmount: number;
  /** Extras still waiting on the broker's OK — billed on a follow-up invoice, not held against this one. */
  pendingExtras: number;
  fee: number;
  payout: number;
  /** One line for the list: "Funds expected Thu by 5 PM", "Paid Oct 21", "8 days overdue". */
  headline: string;
  /** Why the factor wouldn't buy this invoice, when it didn't. */
  factorDeclined?: string;
  missingDocs: string[];
  steps: PaymentStep[];
}

const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const shortDate = (d: Date) => `${MONTH[d.getMonth()]} ${d.getDate()}`;
const isWeekend = (d: Date) => d.getDay() === 0 || d.getDay() === 6;

/** When a factoring submission funds: same business day if it's in before the cutoff, otherwise the next one. */
export function fundingTime(submitted: Date): Date {
  const d = new Date(submitted);
  const sameDay = !isWeekend(d) && d.getHours() < FUNDING_CUTOFF_HOUR;
  if (!sameDay) {
    do d.setDate(d.getDate() + 1);
    while (isWeekend(d));
  }
  d.setHours(FUNDED_BY_HOUR, 0, 0, 0);
  return d;
}

function whenLabel(target: Date, now: Date): string {
  const days = Math.round((new Date(target).setHours(0, 0, 0, 0) - new Date(now).setHours(0, 0, 0, 0)) / DAY_MS);
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days > 1 && days < 7) return WEEKDAY[target.getDay()];
  return shortDate(target);
}

/** The paperwork a broker or factor needs before they'll pay: the signed rate con, the BOL and a signed POD. */
function missingDocs(load: Load): string[] {
  const has = (type: string) => load.documents.some((d) => d.type === type && d.status === "verified");
  return [
    !has("rate_confirmation") && "Rate confirmation",
    !has("bol") && "BOL",
    !has("pod") && "Signed POD",
  ].filter((x): x is string => !!x);
}

/**
 * Where the money for a delivered load is: the AI checks the invoice packet, then either submits it to the
 * factoring partner (funds on business days, and only for brokers the factor will buy) or invoices the broker
 * directly on their terms and chases it when it's late.
 */
export function paymentStatus(load: Load, broker: Broker | undefined, factoringOn: boolean, nowMs: number): PaymentStatus {
  const now = new Date(nowMs);
  const delivered = new Date(load.updatedAt);
  const extras = load.accessorials ?? [];
  const approvedExtras = extras.filter((a) => a.status === "approved").reduce((s, a) => s + a.amount, 0);
  const pendingExtras = extras.filter((a) => a.status === "claimed").reduce((s, a) => s + a.amount, 0);
  const invoiceAmount = (load.bookedRate ?? load.targetRate) + approvedExtras;
  const missing = missingDocs(load);
  const brokerName = broker?.company ?? "the broker";
  const packetStep: PaymentStep = missing.length
    ? { label: "Invoice packet", detail: `Missing: ${missing.join(", ")}. The AI asked the driver for it.`, state: "problem" }
    : { label: "Invoice packet checked", detail: "Rate con, BOL and signed POD match; amounts agree", state: "done" };

  // The factor runs its own credit check on the broker and won't advance against one it doesn't trust.
  const declined = factoringOn && broker && assessBroker(broker).auto === "block" ? `The factor won't buy invoices from ${brokerName}` : undefined;
  const method: PaymentStatus["method"] = factoringOn && !declined ? "factoring" : "direct";
  const base = { invoiceAmount, pendingExtras, missingDocs: missing, factorDeclined: declined };

  if (missing.length) {
    return {
      ...base, method, state: "held", fee: 0, payout: invoiceAmount,
      headline: `On hold: ${missing[0]} missing`,
      steps: [packetStep, { label: method === "factoring" ? "Submit to factoring" : `Invoice ${brokerName}`, state: "todo" }, { label: "Paid", state: "todo" }],
    };
  }

  if (method === "factoring") {
    const fee = Math.round(invoiceAmount * FACTORING_FEE_PCT);
    const fundsAt = fundingTime(delivered);
    const funded = nowMs >= fundsAt.getTime();
    return {
      ...base, method, state: funded ? "funded" : "submitted", fee, payout: invoiceAmount - fee,
      headline: funded ? `Funded ${shortDate(fundsAt)}` : `Funds expected ${whenLabel(fundsAt, now)} by 5 PM`,
      steps: [
        packetStep,
        { label: "Submitted to factoring", detail: `Sent with the packet the moment the POD checked out · ${Math.round(FACTORING_FEE_PCT * 1000) / 10}% fee`, state: "done" },
        {
          label: funded ? "Funded" : "Factor funding",
          detail: funded
            ? `${shortDate(fundsAt)} · the factor now collects from ${brokerName}`
            : `Business days only, before the 11 AM cutoff pays the same day. Expected ${whenLabel(fundsAt, now)} by 5 PM.`,
          state: funded ? "done" : "current",
        },
        { label: `${brokerName} pays the factor`, detail: `Recourse: if they haven't paid in ${RECOURSE_DAYS} days, the advance comes back to you. The AI watches it.`, state: "todo" },
      ],
    };
  }

  const due = new Date(delivered.getTime() + STANDARD_TERMS_DAYS * DAY_MS);
  const expected = new Date(delivered.getTime() + (broker?.avgDaysToPay ?? STANDARD_TERMS_DAYS) * DAY_MS);
  const paid = nowMs >= expected.getTime();
  const daysLate = Math.floor((nowMs - due.getTime()) / DAY_MS);
  const followUps = [
    daysLate >= 1 && "reminder emailed",
    daysLate >= 7 && "called their payables team",
    daysLate >= 15 && "sent a statement and flagged the broker",
  ].filter(Boolean);
  const state: PaymentState = paid ? "paid" : daysLate > 0 ? "overdue" : "invoiced";
  return {
    ...base, method, state, fee: 0, payout: invoiceAmount,
    headline: paid ? `Paid ${shortDate(expected)}` : daysLate > 0 ? `${daysLate} day${daysLate === 1 ? "" : "s"} overdue` : `Due ${shortDate(due)} (Net ${STANDARD_TERMS_DAYS})`,
    steps: [
      packetStep,
      { label: `Invoiced ${brokerName}`, detail: `${shortDate(delivered)} · Net ${STANDARD_TERMS_DAYS}, due ${shortDate(due)}. They usually pay in ${broker?.avgDaysToPay ?? STANDARD_TERMS_DAYS} days.`, state: "done" },
      paid
        ? { label: "Paid", detail: shortDate(expected), state: "done" }
        : daysLate > 0
          ? { label: "Overdue", detail: `The AI ${followUps.join(", ")}.`, state: "problem" }
          : { label: "Waiting on payment", detail: "The AI sends a reminder the day after it's due.", state: "current" },
    ],
  };
}
