import { z } from "zod";
import { canEmail } from "@/lib/channels/out";
import { dbConfigured, loadContext } from "@/lib/agent/db";
import { recordPayments } from "@/lib/agent/money";
import { sendInvoice } from "@/lib/agent/paperwork";
import { sendOrQueue } from "@/lib/agent/outbox";
import * as mail from "@/lib/agent/templates";
import { caller } from "@/lib/agent/user";

const Body = z.discriminatedUnion("action", [
  /** Send it again: to the same address, or another one (the broker's accounts payable). */
  z.object({ action: z.literal("resend"), loadId: z.string().min(1), to: z.string().trim().email().max(200).optional() }),
  /** Send the whole packet to the factoring company instead. */
  z.object({ action: z.literal("factor"), loadId: z.string().min(1) }),
  /** The money came: in full, or short (Backroute then asks the broker what the difference is for). */
  z.object({ action: z.literal("paid"), loadId: z.string().min(1), amount: z.number().positive().max(1_000_000), paidOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }),
  /** Ask the broker for payment now, without waiting for the reminder schedule. */
  z.object({ action: z.literal("remind"), loadId: z.string().min(1) }),
]);

/**
 * What the owner (or their bookkeeper) can do with one invoice from Getting paid. What they ask for goes at once; it
 * doesn't wait for approval, since they're the one approving.
 */
export async function POST(request: Request) {
  if (!dbConfigured()) return Response.json({ error: "not_set_up" }, { status: 503 });
  const who = await caller(request);
  if (!who || who.me.role === "driver") return Response.json({ error: "sign_in" }, { status: 401 });
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "bad_request" }, { status: 400 });
  const b = parsed.data;
  const ctx = await loadContext(who.me.carrierId);
  const load = ctx?.loads.find((l) => l.id === b.loadId);
  if (!ctx || !load) return Response.json({ error: "not_found" }, { status: 404 });
  const billable = load.stage === "delivered" || (load.stage === "cancelled" && !!load.tonuFee);
  if (!billable || !load.bookedRate) return Response.json({ error: "not_billable" }, { status: 409 });
  const fresh = () => ctx.loads.filter((l) => l.id === load.id);

  if (b.action === "paid") {
    if (!load.invoice) return Response.json({ error: "no_invoice" }, { status: 409 });
    if (load.invoice.paidAt) return Response.json({ error: "already_paid" }, { status: 409 });
    const [paid] = await recordPayments(ctx, [{ reference: load.invoice.number, amount: b.amount, paidOn: b.paidOn ?? null }], "Marked paid by the office");
    return Response.json({ loads: paid ? [{ ...paid }] : fresh() });
  }

  if (!canEmail(ctx.carrier)) return Response.json({ error: "email_off" }, { status: 503 });
  if (b.action === "remind") {
    const inv = load.invoice;
    if (!inv?.sentAt || !inv.sentTo || inv.paidAt) return Response.json({ error: "not_sent" }, { status: 409 });
    const late = Math.max(0, Math.floor((Date.now() - Date.parse(inv.sentAt)) / 86400_000) - 30);
    await sendOrQueue(ctx, { purpose: "payment_reminder", to: inv.sentTo, subject: mail.subjectFor(load, `Payment for invoice ${inv.number}`), body: mail.paymentReminder(ctx.carrier, ctx.settings, load, inv, late, false), loadId: load.id, amount: inv.amount, ownerAsked: true, withinRules: true, why: "" });
    return Response.json({ loads: fresh() });
  }
  if (b.action === "factor" && !ctx.settings.factoringEmail) return Response.json({ error: "no_factor" }, { status: 409 });
  const sent = await sendInvoice(ctx, load, b.action === "factor" ? { factoring: true, ownerAsked: true } : { to: b.to, factoring: false, ownerAsked: true });
  if (!sent) return Response.json({ error: "no_address" }, { status: 409 });
  return Response.json({ loads: fresh() });
}
