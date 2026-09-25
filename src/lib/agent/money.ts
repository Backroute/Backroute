import "server-only";
import type { Item } from "../cloud/rows";
import type { Load } from "../types";
import { addActivity, claimMark, save, type CarrierContext } from "./db";
import { event, passToOwner } from "./dispatcher";
import { sendOrQueue } from "./outbox";
import * as mail from "./templates";

/**
 * Getting paid, the part of dispatch that happens after the truck is empty: payment notices from brokers are matched
 * to invoices and marked paid (a short payment goes to support), and invoices past their terms get a polite reminder,
 * then a second, then support. When the carrier factors, the factoring company collects, so no reminders go out.
 */

const DAY = 86400_000;

/** "Net 30", "Quick pay 2 days", "30 days" → days. 30 when the terms don't say. */
export function termsDays(terms: string | null | undefined): number {
  const m = terms?.match(/(\d{1,3})\s*(?:day|d\b)/i) ?? terms?.match(/net\s*(\d{1,3})/i);
  return m ? Number(m[1]) : 30;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** A payment notice: each reference (load or invoice number) is matched to an invoice and marked paid. */
export async function recordPayments(ctx: CarrierContext, payments: { reference: string; amount: number | null; paidOn: string | null }[], from: string): Promise<Load[]> {
  const paid: Load[] = [];
  for (const p of payments) {
    const ref = norm(p.reference);
    if (!ref) continue;
    const load = ctx.loads.find((l) => l.invoice && (norm(l.invoice.number) === ref || norm(l.referenceNumber) === ref || norm(l.invoice.number).endsWith(ref)));
    if (!load?.invoice || load.invoice.paidAt) continue;
    const at = p.paidOn && /^\d{4}-\d{2}-\d{2}/.test(p.paidOn) ? new Date(p.paidOn).toISOString() : new Date().toISOString();
    const next: Load = { ...load, invoice: { ...load.invoice, paidAt: at, paidAmount: p.amount ?? load.invoice.amount }, updatedAt: new Date().toISOString() };
    await save("loads", ctx.carrier.id, next as unknown as Item);
    ctx.loads = ctx.loads.map((l) => (l.id === load.id ? next : l));
    paid.push(next);
    const short = p.amount !== null && p.amount < load.invoice.amount - 1;
    await addActivity(ctx.carrier.id, event({ type: "delivered", loadId: load.id, message: short ? `Short paid on ${load.referenceNumber}` : `Paid: ${load.referenceNumber}`, detail: `$${(p.amount ?? load.invoice.amount).toLocaleString()} of $${load.invoice.amount.toLocaleString()} · ${from}`, severity: short ? "warning" : "success" }));
    if (short)
      await passToOwner(ctx, {
        reason: `${from} paid $${p.amount!.toLocaleString()} on invoice ${load.invoice.number} (${load.referenceNumber}), not the $${load.invoice.amount.toLocaleString()} billed. Find out why (a deduction, a fee, a mistake) and get the rest.`,
        loadId: load.id,
        label: "Sorted out",
        source: "email",
        to: "support",
      });
  }
  return paid;
}

/** Invoices past their terms: a reminder 3 days after, another 10 days after that, then support takes it. */
export async function chasePayments(ctx: CarrierContext, now: number): Promise<string[]> {
  if (ctx.settings.factoringEmail) return [];
  const done: string[] = [];
  for (const load of ctx.loads) {
    const inv = load.invoice;
    if (!inv?.sentAt || inv.paidAt || !inv.sentTo) continue;
    const due = Date.parse(inv.sentAt) + termsDays(load.rateConReading?.paymentTerms) * DAY;
    const late = Math.floor((now - due) / DAY);
    const step = late >= 13 ? (late >= 30 ? 3 : 2) : late >= 3 ? 1 : 0;
    if (!step) continue;
    if (step === 3) {
      if (await claimMark(ctx.carrier.id, load.id, "pay_support"))
        await passToOwner(ctx, { reason: `Invoice ${inv.number} for ${load.referenceNumber} ($${inv.amount.toLocaleString()}) is ${late} days late after two reminders to ${inv.sentTo}. Call the broker's accounts payable.`, loadId: load.id, label: "Collected", source: "email", to: "support" });
      continue;
    }
    if (!(await claimMark(ctx.carrier.id, load.id, `pay_reminder_${step}`))) continue;
    const result = await sendOrQueue(ctx, {
      purpose: "payment_reminder",
      to: inv.sentTo,
      subject: mail.subjectFor(load, `Payment for invoice ${inv.number}`),
      body: mail.paymentReminder(ctx.carrier, ctx.settings, load, inv, late, step === 2),
      loadId: load.id,
      amount: inv.amount,
      withinRules: true,
      why: `Invoice ${inv.number} ($${inv.amount.toLocaleString()}) is ${late} days past terms. Send a reminder?`,
    });
    done.push(`${load.referenceNumber}: payment reminder ${step} ${result}`);
  }
  return done;
}
