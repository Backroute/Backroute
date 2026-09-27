import type { Broker } from "../types";

/**
 * The scams small carriers actually lose money to, checked in code before the AI acts:
 * - double brokering: the rate con comes from a different company (MC) than the broker the load was booked with.
 * - lookalike email domains: "acmefreigth.com" or "acme-freight.co" writing as if they were Acme Freight.
 * - payment redirection: an email asking to change where money goes, or to "verify" bank or login details.
 */

const FREE = /^(gmail|yahoo|outlook|hotmail|icloud|aol|proton(mail)?|live|msn)\./i;
const digits = (s?: string | null) => (s ?? "").replace(/\D/g, "");

function distance(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}

/** The name part of a domain: "dispatch.acme-freight.co" → "acmefreight". */
const core = (domain: string) => (domain.toLowerCase().split(".").slice(-2, -1)[0] ?? "").replace(/[^a-z0-9]/g, "");

/**
 * A known broker whose email domain this one imitates, if any. Same domain, or a free mail address, isn't a lookalike.
 * Only brokers we'd trust count as the real one: an impostor already on file (high risk) doesn't make the broker it
 * imitated look like a lookalike of the impostor.
 */
export function lookalikeOf(email: string, brokers: Broker[]): Broker | null {
  const domain = email.split("@")[1]?.toLowerCase();
  if (!domain || FREE.test(domain)) return null;
  const mine = core(domain);
  if (mine.length < 5) return null;
  for (const b of brokers) {
    if (b.fraudRisk === "high") continue;
    const theirs = b.email?.split("@")[1]?.toLowerCase();
    if (!theirs || theirs === domain || FREE.test(theirs)) continue;
    const other = core(theirs);
    if (other === mine ? theirs !== domain : distance(mine, other) <= 2) return b;
  }
  return null;
}

/** The rate con names a different MC than the broker the load was booked with. */
export function doubleBrokered(mcOnRateCon: string | null | undefined, broker: Broker | undefined): string | null {
  const onDoc = digits(mcOnRateCon);
  const booked = digits(broker?.mc);
  if (!onDoc || !booked || onDoc === booked) return null;
  return `The rate con is from MC ${onDoc}, but the load was booked with ${broker!.company} (MC ${booked}). That's how double brokering looks: the freight may not be theirs to give.`;
}

/** Someone asking to change where money goes, or to confirm bank or login details. */
export function paymentScam(text: string): boolean {
  return (
    /\b(change|update|new|changed)\b[^.\n]{0,40}\b(bank|banking|ach|routing|account number|remit(tance)?|payment) (details|info|information|instructions|account)\b/i.test(text) ||
    /\b(verify|confirm|re-?enter)\b[^.\n]{0,30}\b(bank|account|password|login|credentials)\b/i.test(text) ||
    // Asking a carrier to email its bank account: real brokers take that through their setup portal, not a reply.
    /\b(send|reply with|email|provide|give|need)\b[^.\n]{0,60}\b(bank account|routing number|account and routing|banking (details|info(rmation)?)|voided check)\b/i.test(text)
  );
}
