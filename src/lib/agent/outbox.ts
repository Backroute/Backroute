import "server-only";
import { emailConfigured, sendEmail } from "../channels/email";
import type { Item } from "../cloud/rows";
import type { DraftMessage, DraftPurpose, Escalation, Load, OwnerRule } from "../types";
import { addActivity, filesById, logChannel, save, type CarrierContext } from "./db";
import { event, passToOwner } from "./dispatcher";

/**
 * Every email the AI sends for a carrier goes through here, and the autopilot setting decides whether it goes now or
 * waits in Needs you for the owner to send:
 *
 * - Ask me first: everything waits.
 * - Within my rules: the dispatcher's standard emails go when they're inside the owner's numbers (a book request or
 *   counter at or over the lowest rate, an invoice, a detention claim, a setup packet). Replies the AI wrote itself wait.
 * - Full autopilot: those, plus the AI's own replies, as long as a reply doesn't name a price that isn't already in
 *   the conversation.
 *
 * Anything outside the rules waits, whatever the setting.
 */

export interface Outgoing {
  purpose: DraftPurpose;
  to: string;
  toName?: string;
  subject: string;
  body: string;
  inReplyTo?: string;
  loadId?: string;
  amount?: number;
  attachments?: { fileId: string; name: string }[];
  /** Inside the owner's numbers (the caller checked). */
  withinRules: boolean;
  /** When it isn't: the owner rule that, if they've turned it on, covers it anyway. */
  rule?: OwnerRule;
  /** The owner asked for exactly this (e.g. tapped Ask to book it): it goes now, whatever the autopilot setting. */
  ownerAsked?: boolean;
  /** For Needs you, when it waits: what it is and why it's waiting. */
  why: string;
}

export function goesNow(settings: Pick<CarrierContext["settings"], "autonomy" | "ownerRules">, o: Pick<Outgoing, "purpose" | "withinRules" | "rule">): boolean {
  const on = (r?: OwnerRule) => !!r && !!settings.ownerRules?.[r];
  if (!o.withinRules && !on(o.rule)) return false;
  if (settings.autonomy === "full") return true;
  // A reply the AI wrote itself goes on "Within my rules" only when the owner said replies can.
  return settings.autonomy === "rules" && (o.purpose !== "reply" || on("replies"));
}

/** Sends it, or leaves it for the owner. */
export async function sendOrQueue(ctx: CarrierContext, o: Outgoing): Promise<"sent" | "queued"> {
  if (emailConfigured() && (o.ownerAsked || goesNow(ctx.settings, o))) {
    await deliver(ctx, { channel: "email", to: o.to, toName: o.toName, subject: o.subject, body: o.body, inReplyTo: o.inReplyTo, purpose: o.purpose, amount: o.amount, attachments: o.attachments }, o.loadId, { auto: true });
    return "sent";
  }
  await queue(ctx, o);
  return "queued";
}

async function queue(ctx: CarrierContext, o: Outgoing) {
  const e = await passToOwner(ctx, { reason: o.why, loadId: o.loadId, label: LABEL[o.purpose], source: "email", to: "decider" });
  const withDraft: Escalation = {
    ...e,
    draft: { channel: "email", to: o.to, toName: o.toName, subject: o.subject, body: o.body, inReplyTo: o.inReplyTo, purpose: o.purpose, amount: o.amount, attachments: o.attachments, rule: o.rule ?? (o.purpose === "reply" ? "replies" : undefined) },
  };
  await save("escalations", ctx.carrier.id, withDraft as unknown as Item);
  const i = ctx.escalations.findIndex((x) => x.id === e.id);
  if (i >= 0) ctx.escalations[i] = withDraft;
}

const LABEL: Record<DraftPurpose, string> = {
  reply: "Send this reply",
  book_request: "Send the book request",
  counter: "Send the counter",
  accept: "Accept this rate",
  setup_packet: "Send the setup packet",
  invoice: "Send the invoice",
  detention: "Send the detention claim",
  payment_reminder: "Send the payment reminder",
  tonu: "Send the TONU claim",
  eta_update: "Send the late notice",
  capacity: "Tell them the truck is free",
};

const WHAT: Record<DraftPurpose, string> = {
  reply: "AI replied to",
  book_request: "Asked to book a load with",
  counter: "Countered",
  accept: "Accepted the rate from",
  setup_packet: "Sent the setup packet to",
  invoice: "Sent the invoice to",
  detention: "Sent a detention claim to",
  payment_reminder: "Reminded about payment:",
  tonu: "Claimed truck-ordered-not-used from",
  eta_update: "Told the broker the truck is running late:",
  capacity: "Told a broker about a free truck:",
};

/** Sends a draft (now, or when the owner approves it) and records what it means for the load. */
export async function deliver(ctx: CarrierContext, draft: DraftMessage, loadId: string | undefined, how: { auto?: boolean; approved?: boolean }) {
  const ids = (draft.attachments ?? []).map((a) => a.fileId);
  const files = (await filesById(ctx.carrier.id, ids)).sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
  const id = await sendEmail({
    to: draft.to,
    subject: draft.subject ?? "",
    text: draft.body,
    fromName: ctx.carrier.name,
    inReplyTo: draft.inReplyTo,
    replyTo: ctx.settings.remitEmail && (draft.purpose === "invoice" || draft.purpose === "detention") ? ctx.settings.remitEmail : undefined,
    attachments: files.map((f) => ({ name: f.name, contentType: f.content_type, content: f.data })),
  });
  await logChannel({
    carrierId: ctx.carrier.id,
    channel: "email",
    direction: "out",
    providerId: id ?? null,
    counterparty: draft.to.toLowerCase(),
    body: draft.body,
    data: { subject: draft.subject, purpose: draft.purpose ?? "reply", attachments: files.map((f) => f.name), ...how },
  });
  const purpose = draft.purpose ?? "reply";
  await addActivity(ctx.carrier.id, event({ type: "negotiation_email", loadId, message: `${WHAT[purpose]} ${draft.toName ?? draft.to}`, detail: `${draft.subject ?? ""}${files.length ? ` · ${files.map((f) => f.name).join(", ")}` : ""}`, severity: "success" }));
  if (loadId) await afterSent(ctx, loadId, draft);
}

/** What a sent email changes on the load: the ask on record, the invoice sent, the claim sent. */
async function afterSent(ctx: CarrierContext, loadId: string, draft: DraftMessage) {
  const load = ctx.loads.find((l) => l.id === loadId);
  if (!load) return;
  const at = new Date().toISOString();
  let next: Load | null = null;
  const p = draft.purpose;
  if ((p === "book_request" || p === "counter" || p === "accept") && draft.amount) {
    next = {
      ...load,
      stage: load.stage === "offered" ? "negotiating" : load.stage,
      targetRate: draft.amount,
      bookRequest: { ...load.bookRequest, ask: draft.amount, askedAt: at, status: p === "accept" ? "accepted" : "sent", countered: load.bookRequest?.countered || p === "counter" },
    };
  } else if (p === "invoice" && load.invoice) next = { ...load, invoice: { ...load.invoice, sentAt: at, sentTo: draft.to } };
  else if (p === "detention") next = { ...load, detentionClaims: (load.detentionClaims ?? []).map((c) => (c.sentAt ? c : { ...c, sentAt: at })) };
  else if (p === "payment_reminder" && load.invoice) next = { ...load, invoice: { ...load.invoice, remindedAt: [...(load.invoice.remindedAt ?? []), at] } };
  if (!next) return;
  next = { ...next, updatedAt: at };
  await save("loads", ctx.carrier.id, next as unknown as Item);
  ctx.loads = ctx.loads.map((l) => (l.id === loadId ? next! : l));
}
