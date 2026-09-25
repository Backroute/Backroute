import "server-only";
import { aiConfigured } from "../ai/server";
import { readRateConPdf } from "../ai/rate-con-reader";
import { messageIdHeader, plainText, type InboundEmail } from "../channels/email";
import { agreedTerms } from "../rate-con-terms";
import type { Item } from "../cloud/rows";
import type { Load, RateConPdfReading } from "../types";
import { addActivity, loadContext, save, threadWith } from "./db";
import { brokerEmailDraft, event, passToOwner } from "./dispatcher";
import { readBrokerEmail } from "./broker-mail";
import { answerRateReply, bookIt, offersFromEmail, type Sender } from "./booking";
import { sendOrQueue } from "./outbox";
import { sendSetupPacket } from "./paperwork";
import { dollarAmounts, onlyKnownPrices } from "./pricing";

const ACTIVE = new Set(["negotiating", "rate_confirmed", "booked", "dispatched", "at_pickup", "in_transit", "at_delivery"]);

/**
 * A broker's email to the carrier's Backroute address, handled the way a dispatcher would:
 *
 * - A rate con attached is read and checked against its load. When it confirms a load the AI asked for and matches,
 *   the load is booked onto its truck (on "Within my rules" or full autopilot; on "Ask me first" the owner taps Book it).
 * - Loads offered: each that fits a truck goes on the owner's board, and within the rules the AI asks to book the best.
 * - An answer to our price: taken, countered once at the owner's lowest, or passed to the owner (lib/agent/pricing).
 * - A request for setup papers: the packet goes out with the carrier's W-9, insurance certificate and authority.
 * - Anything else: the AI writes a reply, which waits for the owner unless autopilot is on full.
 */
export async function handleInboundEmail(carrierId: string, email: InboundEmail) {
  const ctx = await loadContext(carrierId);
  if (!ctx) return;
  const from = (email.FromFull?.Email ?? email.From).toLowerCase();
  const fromName = email.FromFull?.Name || email.FromName || from;
  const text = plainText(email);
  const sender: Sender = { from, fromName, subject: email.Subject, messageId: messageIdHeader(email) };
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
        load = updated;
        // The broker's rate con for a load the AI asked for: it confirms the booking when it matches.
        if (load.stage === "negotiating" || load.stage === "offered") {
          if (serious) await passToOwner(ctx, { reason: `${fromName}'s rate con for ${load.referenceNumber} doesn't match what was agreed: ${reading.summary}`, loadId: load.id, label: "I'll sort it", source: "email" });
          else if (ctx.settings.autonomy !== "ask") {
            load = (await bookIt(ctx, load, reading.totalRate ?? undefined)).load;
            notes.push(`The rate con matched, so ${load.referenceNumber} is now booked and the driver has been told.`);
          } else await passToOwner(ctx, { reason: `${fromName} sent the rate con for ${load.referenceNumber} and it matches. Open the load and tap Book it to put it on the truck.`, loadId: load.id, label: "Got it", source: "email" });
        }
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

  const reading = await readBrokerEmail(email.Subject, text);
  if (reading?.kind === "setup_request") return sendSetupPacket(ctx, { ...sender, contactName: reading.contactName });
  if (reading?.kind === "load_offers" && reading.offers.length && !pdfs.length) {
    const { added } = await offersFromEmail(ctx, reading.offers, sender);
    if (!added.length)
      await addActivity(carrierId, event({ type: "load_offered", message: `${fromName} sent ${reading.offers.length} load${reading.offers.length === 1 ? "" : "s"}; none fit a free truck`, detail: email.Subject, severity: "info" }));
    return;
  }
  if (reading?.kind === "rate_reply" && load?.stage === "negotiating") {
    const handled = await answerRateReply(ctx, load, { brokerRate: reading.brokerRate, agreed: reading.agreedToOurRate, contactName: reading.contactName }, sender);
    if (handled !== false) return;
  }

  const thread = (await threadWith(carrierId, "email", from, 8)).filter((m) => !(m.direction === "in" && m.body === text));
  const draft = await brokerEmailDraft(ctx, { from, fromName, subject: email.Subject, text, attachmentNotes: notes, thread, load });
  if (draft.effects.failed) {
    await passToOwner(ctx, { reason: `New email from ${fromName}: "${email.Subject}". The AI couldn't write a reply.`, loadId: load?.id, label: "I'll answer", source: "email" });
    return;
  }
  if (!draft.body) return;

  // A reply the AI wrote may only repeat prices already in the conversation or on the load.
  const known = [
    ...dollarAmounts(`${email.Subject}\n${text}\n${thread.map((t) => t.body ?? "").join("\n")}`),
    ...(load ? [load.listedRate, load.targetRate, load.bookedRate ?? 0, load.bookRequest?.ask ?? 0] : []),
  ];
  await sendOrQueue(ctx, {
    purpose: "reply",
    to: from,
    toName: fromName,
    subject: /^re:/i.test(email.Subject) ? email.Subject : `Re: ${email.Subject}`,
    body: draft.body,
    inReplyTo: sender.messageId,
    loadId: load?.id,
    withinRules: onlyKnownPrices(draft.body, known),
    why: `${fromName} emailed about ${load ? load.referenceNumber : `"${email.Subject}"`}. The AI wrote a reply for you to check.`,
  });
}
