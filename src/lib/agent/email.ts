import "server-only";
import { aiConfigured } from "../ai/server";
import { readRateConPdf } from "../ai/rate-con-reader";
import { messageIdHeader, plainText, type InboundEmail } from "../channels/email";
import { agreedTerms } from "../rate-con-terms";
import type { Item } from "../cloud/rows";
import type { Load, RateConPdfReading } from "../types";
import { addActivity, claimMark, loadContext, save, threadWith } from "./db";
import { brokerEmailDraft, event, passToOwner } from "./dispatcher";
import { readBrokerEmail } from "./broker-mail";
import { answerRateReply, bookIt, offersFromEmail, type Sender } from "./booking";
import { sendOrQueue } from "./outbox";
import * as mail from "./templates";
import { sendSetupPacket } from "./paperwork";
import { doubleBrokered, lookalikeOf, paymentScam } from "./fraud";
import { checkBroker } from "./brokers";
import { cancelLoad } from "./cancel";
import { recordPayments } from "./money";
import { dollarAmounts, onlyKnownPrices } from "./pricing";

const ACTIVE = new Set(["negotiating", "rate_confirmed", "booked", "dispatched", "at_pickup", "in_transit", "at_delivery"]);

/**
 * A broker's email to the carrier's Backroute address, handled the way a dispatcher would:
 *
 * - A rate con attached is read and checked against its load. When it confirms a load the AI asked for and matches,
 *   the load is booked onto its truck (on "Within my rules" or full autopilot; on "Ask me first" the owner taps Book it).
 * - Loads offered: each that fits a truck goes on the owner's board, and within the rules the AI asks to book the best.
 * - An answer to our price: taken, countered (up to three times), passed on politely, or passed to the owner
 *   (lib/agent/negotiation).
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
  // Someone posing as a broker (a lookalike address, or already marked high risk) gets no automatic note: support
  // deals with them.
  const suspect = () => !!lookalikeOf(from, ctx.brokers.filter((b) => b.email?.toLowerCase() !== from)) || ctx.brokers.some((b) => b.email?.toLowerCase() === from && b.fraudRisk === "high");
  // Set when the email has had its answer from a template (a rate con thanks or fix), so the AI doesn't write another.
  let replied = false;
  // PDFs, and photos big enough to be a document (not a logo in someone's signature).
  const isPhoto = (a: { ContentType: string; ContentLength: number }) => /^image\/(jpeg|png|webp|gif)$/.test(a.ContentType) && a.ContentLength >= 60 * 1024;
  const pdfs = (email.Attachments ?? []).filter((a) => (a.ContentType === "application/pdf" || /\.pdf$/i.test(a.Name) || isPhoto(a)) && a.ContentLength <= 10 * 1024 * 1024);
  for (const pdf of pdfs) {
    if (!aiConfigured()) {
      notes.push(`${pdf.Name}: not read (the AI isn't switched on)`);
      continue;
    }
    try {
      const firstPass = await readRateConPdf(Buffer.from(pdf.Content, "base64"), load ? agreedTerms(load, ctx.brokers.find((b) => b.id === load!.brokerId)) : null, isPhoto(pdf) ? pdf.ContentType : "application/pdf");
      if (!firstPass.isRateCon) {
        notes.push(`${pdf.Name}: not a rate con`);
        continue;
      }
      // A rate con names its own load number: use it to find the load, then check the terms against that load.
      let reading = firstPass;
      if (!load && byRef(firstPass.loadNumber)) {
        load = byRef(firstPass.loadNumber)!;
        reading = await readRateConPdf(Buffer.from(pdf.Content, "base64"), agreedTerms(load, ctx.brokers.find((b) => b.id === load!.brokerId)), isPhoto(pdf) ? pdf.ContentType : "application/pdf");
      }
      if (load) {
        const saved: RateConPdfReading = { ...reading, fileName: pdf.Name, readAt: new Date().toISOString() };
        const updated: Load = { ...load, rateConReading: saved, updatedAt: saved.readAt };
        await save("loads", carrierId, updated as unknown as Item);
        load = updated;
        // The rate con names the broker's MC: check it against FMCSA (and it's how a new broker gets verified). A
        // different MC than the broker we booked with is how double brokering shows up: nothing moves until it's checked.
        const onLoad = ctx.brokers.find((b) => b.id === load!.brokerId);
        const double = doubleBrokered(reading.brokerMc, onLoad);
        if (double) await passToOwner(ctx, { reason: `Possible double brokering on ${load.referenceNumber}. ${double} Call ${onLoad!.company} on the number from FMCSA, not the one on the rate con, before the truck goes.`, loadId: load.id, critical: true, label: "Checked", source: "email", to: "support", brokerId: onLoad!.id });
        else if (onLoad && reading.brokerMc) await checkBroker(ctx, onLoad, reading.brokerMc);
        const serious = reading.mismatches.filter((m) => m.serious).length + (double ? 1 : 0);
        // The broker's rate con for a load the AI asked for: it confirms the booking when it matches.
        if (load.stage === "negotiating" || load.stage === "offered") {
          if (double) notes.push(`Not booked: ${double}`);
          else if (serious) {
            // A dispatcher sends it straight back: what's off, and a corrected one please.
            const problems = reading.mismatches.filter((m) => m.serious).map((m) => `${m.item}: we agreed ${m.agreed}, the rate con says ${m.onDoc}`);
            await sendOrQueue(ctx, { purpose: "ack", to: from, toName: fromName, subject: /^re:/i.test(email.Subject) ? email.Subject : `Re: ${email.Subject}`, body: mail.rateConFix(ctx.carrier, ctx.settings, load, problems, fromName), inReplyTo: sender.messageId, loadId: load.id, withinRules: true, why: `Ask ${fromName} to fix the rate con for ${load.referenceNumber}?` });
            replied = true;
            await passToOwner(ctx, { reason: `${fromName}'s rate con for ${load.referenceNumber} doesn't match what was agreed: ${reading.summary} The AI asked them for a corrected one.`, loadId: load.id, label: "I'll sort it", source: "email", to: "decider" });
          } else {
            if (ctx.settings.autonomy !== "ask") {
              load = (await bookIt(ctx, load, reading.totalRate ?? undefined)).load;
              notes.push(`The rate con matched, so ${load.referenceNumber} is now booked and the driver has been told.`);
            } else await passToOwner(ctx, { reason: `${fromName} sent the rate con for ${load.referenceNumber} and it matches. Open the load and tap Book it to put it on the truck.`, loadId: load.id, label: "Got it", source: "email", to: "owner" });
            const truck = ctx.trucks.find((t) => t.id === load!.truckId);
            const booked = load.stage !== "negotiating" && load.stage !== "offered";
            const who = booked && truck ? { unit: truck.unitNumber, driver: ctx.drivers.find((d) => d.id === truck.driverId)?.name.split(" ")[0] } : {};
            await sendOrQueue(ctx, { purpose: "ack", to: from, toName: fromName, subject: /^re:/i.test(email.Subject) ? email.Subject : `Re: ${email.Subject}`, body: mail.rateConThanks(ctx.carrier, ctx.settings, load, who, fromName), inReplyTo: sender.messageId, loadId: load.id, withinRules: true, why: `Thank ${fromName} for the rate con on ${load.referenceNumber}?` });
            replied = true;
          }
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
          to: "decider",
        });
        notes.push(`${pdf.Name}: a rate con for a load we don't have (${reading.summary})`);
      }
    } catch (error) {
      console.error("[email] couldn't read attachment", error);
      notes.push(`${pdf.Name}: couldn't be read`);
    }
  }

  // The rate con was the whole email: it's been answered.
  if (replied && !text.includes("?")) return;

  const holdingReply = async () =>
    !suspect() &&
    sendOrQueue(ctx, { purpose: "ack", to: from, toName: fromName, subject: /^re:/i.test(email.Subject) ? email.Subject : `Re: ${email.Subject}`, body: mail.holding(ctx.carrier, ctx.settings, load?.referenceNumber ?? null, fromName), inReplyTo: sender.messageId, loadId: load?.id, withinRules: true, why: `Tell ${fromName} you'll get back to them?` });

  if (!aiConfigured()) {
    await passToOwner(ctx, { reason: `New email from ${fromName}: "${email.Subject}"`, loadId: load?.id, label: "I'll answer", source: "email" });
    await holdingReply();
    return;
  }

  // Someone asking to change where money goes, or to confirm bank details: the AI doesn't answer, support checks.
  if (paymentScam(`${email.Subject}\n${text}`)) {
    await passToOwner(ctx, {
      reason: `${fromName} <${from}> asked about bank or payment details ("${email.Subject}"). That's the most common way carriers get robbed. The AI didn't reply. Confirm by phone, using a number you already had, before changing anything.`,
      label: "Checked",
      source: "email",
      to: "support",
      critical: true,
    });
    return;
  }

  const reading = await readBrokerEmail(email.Subject, text);
  // Remember the language the broker writes in, so what we send goes in it (lib/agent/outbox).
  const writer = ctx.brokers.find((b) => b.email?.toLowerCase() === from);
  const lang = reading?.language?.toLowerCase().slice(0, 2);
  if (writer && lang && /^[a-z]{2}$/.test(lang) && (writer.language ?? "en") !== lang) {
    const next = { ...writer, language: lang };
    await save("records", carrierId, next as unknown as Item, "broker");
    ctx.brokers = ctx.brokers.map((b) => (b.id === next.id ? next : b));
  }
  if (reading?.kind === "setup_request") return sendSetupPacket(ctx, { ...sender, contactName: reading.contactName }, text);
  if (reading?.kind === "payment" && reading.payments.length) {
    await recordPayments(ctx, reading.payments, fromName);
    return;
  }
  if (reading?.kind === "cancellation") {
    const target = byRef(reading.loadNumber) ?? load;
    if (target) return cancelLoad(ctx, target, reading.cancelReason ?? "no reason given", from);
  }
  if (reading?.kind === "load_offers" && reading.offers.length && !pdfs.length) {
    const { added } = await offersFromEmail(ctx, reading.offers, sender, { company: reading.brokerCompany, mc: reading.brokerMc, phone: reading.brokerPhone, contact: reading.contactName });
    if (!added.length) {
      await addActivity(carrierId, event({ type: "load_offered", message: `${fromName} sent ${reading.offers.length} load${reading.offers.length === 1 ? "" : "s"}; none fit a free truck`, detail: email.Subject, severity: "info" }));
      // A quick "not today, here's what we run", once a day per broker, so they keep sending the right freight.
      if (!suspect() && (await claimMark(carrierId, `broker:${from}`, `nofit:${new Date().toISOString().slice(0, 10)}`))) {
        const plural: Record<string, string> = { "Dry Van": "dry vans", Reefer: "reefers", Flatbed: "flatbeds", Container: "container chassis" };
        const equipment = [...new Set(ctx.trucks.map((t) => plural[t.equipmentType] ?? t.equipmentType.toLowerCase()))];
        const around = [...new Set(ctx.trucks.map((t) => `${t.currentCity}, ${t.currentState}`))].slice(0, 3);
        await sendOrQueue(ctx, { purpose: "ack", to: from, toName: reading.contactName ?? fromName, subject: /^re:/i.test(email.Subject) ? email.Subject : `Re: ${email.Subject}`, body: mail.noFit(ctx.carrier, ctx.settings, { equipment, around }, reading.contactName ?? fromName), inReplyTo: sender.messageId, withinRules: true, why: `Tell ${fromName} none of their loads fit today?` });
      }
    }
    return;
  }
  if (reading?.kind === "rate_reply" && (load?.stage === "negotiating" || (load?.stage === "declined" && load.bookRequest?.passedAt))) {
    // "2.80 a mile" without the miles: the load's miles make it a total.
    const brokerRate = reading.brokerRate ?? (reading.brokerRpm ? Math.round(reading.brokerRpm * load.lane.miles) : null);
    const handled = await answerRateReply(ctx, load, { brokerRate, agreed: reading.agreedToOurRate, contactName: reading.contactName, question: reading.question }, sender);
    if (handled !== false) return;
  }

  const thread = (await threadWith(carrierId, "email", from, 8)).filter((m) => !(m.direction === "in" && m.body === text));
  const draft = await brokerEmailDraft(ctx, { from, fromName, subject: email.Subject, text, attachmentNotes: notes, thread, load });
  if (draft.effects.failed) {
    await passToOwner(ctx, { reason: `New email from ${fromName}: "${email.Subject}". The AI couldn't write a reply, so it told them someone will get back to them.`, loadId: load?.id, label: "I'll answer", source: "email" });
    await holdingReply();
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
