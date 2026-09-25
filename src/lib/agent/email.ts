import "server-only";
import { aiConfigured } from "../ai/server";
import { readRateConPdf } from "../ai/rate-con-reader";
import { emailConfigured, messageIdHeader, plainText, sendEmail, type InboundEmail } from "../channels/email";
import { agreedTerms } from "../rate-con-terms";
import type { Item } from "../cloud/rows";
import type { Load, RateConPdfReading } from "../types";
import { addActivity, loadContext, logChannel, save, threadWith } from "./db";
import { brokerEmailDraft, event, passToOwner, queueDraft } from "./dispatcher";

const ACTIVE = new Set(["negotiating", "rate_confirmed", "booked", "dispatched", "at_pickup", "in_transit", "at_delivery"]);

/**
 * A broker's email to the carrier's Backroute address. The AI reads any rate con attached (checking it against the
 * load it belongs to), then writes the reply. The reply waits for the owner unless autopilot is on full.
 */
export async function handleInboundEmail(carrierId: string, email: InboundEmail) {
  const ctx = await loadContext(carrierId);
  if (!ctx) return;
  const from = (email.FromFull?.Email ?? email.From).toLowerCase();
  const fromName = email.FromFull?.Name || email.FromName || from;
  const text = plainText(email);
  const haystack = `${email.Subject}\n${text}`.toLowerCase();

  const broker = ctx.brokers.find((b) => b.email?.toLowerCase() === from);
  const byRef = (ref?: string | null) => (ref ? ctx.loads.find((l) => l.referenceNumber.toLowerCase() === ref.toLowerCase()) : undefined);
  let load: Load | undefined =
    ctx.loads.find((l) => haystack.includes(l.referenceNumber.toLowerCase())) ??
    (broker ? ctx.loads.filter((l) => l.brokerId === broker.id && ACTIVE.has(l.stage)).sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))[0] : undefined);

  const notes: string[] = [];
  const pdfs = (email.Attachments ?? []).filter((a) => (a.ContentType === "application/pdf" || /\.pdf$/i.test(a.Name)) && a.ContentLength <= 10 * 1024 * 1024);
  for (const pdf of pdfs) {
    if (!aiConfigured()) {
      notes.push(`${pdf.Name}: not read (the AI isn't switched on)`);
      continue;
    }
    try {
      const firstPass = await readRateConPdf(Buffer.from(pdf.Content, "base64"), load ? agreedTerms(load, ctx.brokers.find((b) => b.id === load!.brokerId)) : null);
      if (!firstPass.isRateCon) {
        notes.push(`${pdf.Name}: not a rate con`);
        continue;
      }
      // A rate con names its own load number: use it to find the load, then check the terms against that load.
      let reading = firstPass;
      if (!load && byRef(firstPass.loadNumber)) {
        load = byRef(firstPass.loadNumber)!;
        reading = await readRateConPdf(Buffer.from(pdf.Content, "base64"), agreedTerms(load, ctx.brokers.find((b) => b.id === load!.brokerId)));
      }
      if (load) {
        const saved: RateConPdfReading = { ...reading, fileName: pdf.Name, readAt: new Date().toISOString() };
        const updated: Load = { ...load, rateConReading: saved, updatedAt: saved.readAt };
        await save("loads", carrierId, updated as unknown as Item);
        const serious = reading.mismatches.filter((m) => m.serious).length;
        await addActivity(
          carrierId,
          event({
            type: "document_captured",
            loadId: load.id,
            message: serious ? `Rate con from ${fromName} doesn't match: ${serious} thing${serious === 1 ? "" : "s"} to fix` : `Rate con from ${fromName} matches what was agreed`,
            detail: `${pdf.Name} · read by AI from email`,
            severity: serious ? "warning" : "success",
          }),
        );
        notes.push(`${pdf.Name} (rate con for ${load.referenceNumber}): ${reading.summary}`);
      } else {
        await passToOwner(ctx, {
          reason: `Rate con from ${fromName}${reading.loadNumber ? ` for load #${reading.loadNumber}` : ""}${reading.totalRate ? `, $${reading.totalRate.toLocaleString()}` : ""} doesn't match any load. Add the load on the Loads page to track it.`,
          label: "Got it",
          source: "email",
        });
        notes.push(`${pdf.Name}: a rate con for a load we don't have (${reading.summary})`);
      }
    } catch (error) {
      console.error("[email] couldn't read attachment", error);
      notes.push(`${pdf.Name}: couldn't be read`);
    }
  }

  if (!aiConfigured()) {
    await passToOwner(ctx, { reason: `New email from ${fromName}: "${email.Subject}"`, loadId: load?.id, label: "I'll answer", source: "email" });
    return;
  }

  const thread = (await threadWith(carrierId, "email", from, 8)).filter((m) => !(m.direction === "in" && m.body === text));
  const draft = await brokerEmailDraft(ctx, { from, fromName, subject: email.Subject, text, attachmentNotes: notes, thread, load });
  if (draft.effects.failed) {
    await passToOwner(ctx, { reason: `New email from ${fromName}: "${email.Subject}". The AI couldn't write a reply.`, loadId: load?.id, label: "I'll answer", source: "email" });
    return;
  }
  if (!draft.body) return;

  const subject = /^re:/i.test(email.Subject) ? email.Subject : `Re: ${email.Subject}`;
  const inReplyTo = messageIdHeader(email);
  if (ctx.settings.autonomy === "full" && emailConfigured()) {
    const id = await sendEmail({ to: from, subject, text: draft.body, fromName: ctx.carrier.name, inReplyTo });
    await logChannel({ carrierId, channel: "email", direction: "out", providerId: id ?? null, counterparty: from, body: draft.body, data: { subject, auto: true } });
    await addActivity(carrierId, event({ type: "negotiation_email", loadId: load?.id, message: `AI replied to ${fromName}`, detail: subject, severity: "info" }));
    return;
  }
  await queueDraft(ctx, {
    to: from,
    toName: fromName,
    subject,
    body: draft.body,
    inReplyTo,
    loadId: load?.id,
    why: `${fromName} emailed about ${load ? load.referenceNumber : `"${email.Subject}"`}. The AI wrote a reply for you to check.`,
  });
}
