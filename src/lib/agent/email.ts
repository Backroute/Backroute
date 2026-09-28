import "server-only";
import { forCarrier } from "./scope";
import { aiConfigured } from "../ai/server";
import { readRateConPdf } from "../ai/rate-con-reader";
import { messageIdHeader, plainText, type InboundEmail } from "../channels/email";
import { agreedTerms } from "../rate-con-terms";
import type { Item } from "../cloud/rows";
import type { Load, RateConPdfReading } from "../types";
import { addActivity, claimMark, loadContext, save, storeFile, threadWith } from "./db";
import { brokerEmailDraft, event, passToOwner, tellOwner } from "./dispatcher";
import { readBrokerEmail } from "./broker-mail";
import { answerRateReply, bookIt, offersFromEmail, requestBooking, type Sender } from "./booking";
import { sendOrQueue } from "./outbox";
import * as mail from "./templates";
import { sendSetupPacket } from "./paperwork";
import { doubleBrokered, lookalikeOf, paymentScam } from "./fraud";
import { checkBroker } from "./brokers";
import { cancelLoad } from "./cancel";
import { recordPayments } from "./money";
import { PORTAL_SIGNING, signRateCon } from "./sign";
import { askDriverToTrack, trackingNeed } from "./tracking";
import { dollarAmounts, floorFor, onlyKnownPrices } from "./pricing";
import { answerChange, changeReply } from "./changes";
import { CLAIM_EMAIL, claimLoad, openClaim } from "./claims";
import { setAppointment } from "./appointments";
import { stopLocalToIso } from "../stop-time";
import { dockLink, portalOn, queuePortalTask, signingLink } from "../portal/tasks";
import { takeEmailedCode } from "../portal/step";

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
export function handleInboundEmail(carrierId: string, email: InboundEmail) {
  return forCarrier(carrierId, () => handle(carrierId, email));
}

async function handle(carrierId: string, email: InboundEmail) {
  const ctx = await loadContext(carrierId);
  if (!ctx) return;
  const from = (email.FromFull?.Email ?? email.From).toLowerCase();
  const fromName = email.FromFull?.Name || email.FromName || from;
  const text = plainText(email);
  const sender: Sender = { from, fromName, subject: email.Subject, messageId: messageIdHeader(email) };
  const haystack = `${email.Subject}\n${text}`.toLowerCase();
  // A sign-in code a website sent for a job the AI is doing there: it's typed in, and that's all this email is.
  if (await takeEmailedCode(carrierId, from, email.Subject, text).catch(() => false)) return;

  const broker = ctx.brokers.find((b) => b.email?.toLowerCase() === from);
  const byRef = (ref?: string | null) => (ref ? ctx.loads.find((l) => l.referenceNumber.toLowerCase() === ref.toLowerCase()) : undefined);
  let load: Load | undefined =
    ctx.loads.find((l) => haystack.includes(l.referenceNumber.toLowerCase())) ??
    (broker ? ctx.loads.filter((l) => l.brokerId === broker.id && ACTIVE.has(l.stage)).sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))[0] : undefined);

  const notes: string[] = [];
  // Someone posing as a broker (a lookalike address, or already marked high risk) gets no automatic note: support
  // deals with them.
  const suspect = () => !!lookalikeOf(from, ctx.brokers.filter((b) => b.email?.toLowerCase() !== from)) || ctx.brokers.some((b) => b.email?.toLowerCase() === from && b.fraudRisk === "high");
  // Someone writing from an address that imitates a broker we know: decided once, before anything in the email is
  // acted on. Their rate con, cancellation, "works for us", setup request or payment notice changes nothing, and they
  // get no reply of any kind; only their load offers go through, to be flagged there. (A broker we deal with who only
  // failed a check is different: their news about our loads still counts, they just get no automatic notes.)
  const impostor = !!lookalikeOf(from, ctx.brokers.filter((b) => b.email?.toLowerCase() !== from));
  // Set when the email has had its answer from a template (a rate con thanks or fix), so the AI doesn't write another.
  let replied = false;
  // PDFs, and photos big enough to be a document (not a logo in someone's signature).
  const isPhoto = (a: { ContentType: string; ContentLength: number }) => /^image\/(jpeg|png|webp|gif)$/.test(a.ContentType) && a.ContentLength >= 60 * 1024;
  const pdfs = (email.Attachments ?? []).filter((a) => (a.ContentType === "application/pdf" || /\.pdf$/i.test(a.Name) || isPhoto(a)) && a.ContentLength <= 10 * 1024 * 1024);
  for (const pdf of pdfs) {
    if (impostor) {
      notes.push(`${pdf.Name}: not opened, the sender's address imitates a broker we know or is marked high risk`);
      continue;
    }
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
        // Kept on the load: it's signed from, and the factoring company wants it with the invoice.
        await storeFile(carrierId, { kind: "rate_con", name: pdf.Name, contentType: isPhoto(pdf) ? pdf.ContentType : "application/pdf", bytes: Buffer.from(pdf.Content, "base64"), loadId: load.id }).catch((e) => console.error("[email] couldn't keep the rate con", e));
        const saved: RateConPdfReading = { ...reading, fileName: pdf.Name, readAt: new Date().toISOString() };
        const updated: Load = { ...load, rateConReading: saved, updatedAt: saved.readAt };
        await save("loads", carrierId, updated as unknown as Item);
        ctx.loads = ctx.loads.map((l) => (l.id === updated.id ? updated : l));
        load = updated;
        // The rate con names the broker's MC: check it against FMCSA (and it's how a new broker gets verified). A
        // different MC than the broker we booked with is how double brokering shows up: nothing moves until it's checked.
        const onLoad = ctx.brokers.find((b) => b.id === load!.brokerId);
        const double = doubleBrokered(reading.brokerMc, onLoad);
        // Nothing is booked on it. The broker we dealt with is asked, at the address we already had, to send their own
        // rate con; the owner is told. A real mix-up gets fixed by their answer; a double broker gets nothing.
        if (double) {
          await passToOwner(ctx, { reason: `Possible double brokering on ${load.referenceNumber}. ${double} The AI didn't book it and asked ${onLoad!.company} at the address you already had to send a rate con from their own company.`, loadId: load.id, label: "Got it", source: "email", to: "owner", brokerId: onLoad!.id });
          const known = onLoad!.email && onLoad!.email.toLowerCase() !== from ? onLoad!.email : load.brokerContactEmail;
          if (known && (await claimMark(carrierId, load.id, "double_ask")))
            await sendOrQueue(ctx, { purpose: "ack", to: known, toName: onLoad!.contact || undefined, subject: mail.subjectFor(load, "Rate con"), body: `Hi${onLoad!.contact ? ` ${onLoad!.contact}` : ""},\n\nWe got a rate con for ${load.referenceNumber} from ${from} that shows a different broker (${reading.brokerMc ?? "another MC"}), not ${onLoad!.company}. We won't run it as is. If the load is yours, please send the rate con from ${onLoad!.company}.\n\nThanks,\n${ctx.carrier.name}`, loadId: load.id, withinRules: true, why: `Ask ${onLoad!.company} to confirm ${load.referenceNumber}?` });
        }
        else if (onLoad && reading.brokerMc) await checkBroker(ctx, onLoad, reading.brokerMc);
        const serious = reading.mismatches.filter((m) => m.serious).length + (double ? 1 : 0);
        // A revised rate con for a change we priced (an added stop, a reroute): its total is their answer.
        if (load.change?.status === "asked" && reading.totalRate && !double && (await changeReply(ctx, load, { agreed: reading.totalRate >= load.change.newTotal, brokerRate: reading.totalRate }, fromName))) {
          load = ctx.loads.find((l) => l.id === load!.id) ?? load;
          notes.push(`Revised rate con for the change on ${load.referenceNumber}: $${reading.totalRate.toLocaleString("en-US")}.`);
        }
        // The broker's rate con for a load the AI asked for: it confirms the booking when it matches.
        if (load.stage === "negotiating" || load.stage === "offered") {
          if (double) notes.push(`Not booked: ${double}`);
          else if (serious) {
            // A dispatcher sends it straight back: what's off, and a corrected one please.
            const problems = reading.mismatches.filter((m) => m.serious).map((m) => `${m.item}: we agreed ${m.agreed}, the rate con says ${m.onDoc}`);
            await sendOrQueue(ctx, { purpose: "ack", to: from, toName: fromName, subject: /^re:/i.test(email.Subject) ? email.Subject : `Re: ${email.Subject}`, body: mail.rateConFix(ctx.carrier, ctx.settings, load, problems, fromName), inReplyTo: sender.messageId, loadId: load.id, withinRules: true, why: `Ask ${fromName} to fix the rate con for ${load.referenceNumber}?` });
            replied = true;
            await tellOwner(ctx, { reason: `${fromName}'s rate con for ${load.referenceNumber} doesn't match what was agreed: ${reading.summary} The AI asked them for a corrected one and books it when that comes.`, loadId: load.id, label: "Got it", source: "email", severity: "warning" });
          } else {
            if (ctx.settings.autonomy !== "ask") {
              load = (await bookIt(ctx, load, reading.totalRate ?? undefined)).load;
              notes.push(`The rate con matched, so ${load.referenceNumber} is now booked and the driver has been told.`);
            } else await passToOwner(ctx, { reason: `${fromName} sent the rate con for ${load.referenceNumber} and it matches. Open the load and tap Book it to put it on the truck.`, loadId: load.id, label: "Got it", source: "email", to: "owner" });
            const truck = ctx.trucks.find((t) => t.id === load!.truckId);
            const booked = load.stage !== "negotiating" && load.stage !== "offered";
            const who = booked && truck ? { unit: truck.unitNumber, driver: ctx.drivers.find((d) => d.id === truck.driverId)?.name.split(" ")[0] } : {};
            // The rate con asks for a tracking app: the driver is told what to accept.
            const tracking = booked ? trackingNeed(`${[...reading.otherConcerns, ...reading.finesAndFees, reading.summary].join(" ")}\n${text}`) : null;
            if (tracking) {
              await askDriverToTrack(ctx, load, tracking);
              load = ctx.loads.find((l) => l.id === load!.id) ?? load;
            }
            // Booked on a matching rate con: signed and sent back, the way the broker needs it before the truck rolls.
            const portal = PORTAL_SIGNING.test(text) && /https?:\/\//.test(text);
            const signed = booked && !portal ? await signRateCon(ctx, load, Buffer.from(pdf.Content, "base64"), isPhoto(pdf) ? pdf.ContentType : "application/pdf") : null;
            if (signed) load = ctx.loads.find((l) => l.id === load!.id) ?? load;
            else if (booked && portal) {
              // Their portal: the AI signs it there itself (the browser worker), the PDF they sent having matched. Without
              // the worker: asked for it as a PDF by email first; if they insist, support signs it there.
              const link = signingLink(text);
              if (link && portalOn(ctx) && ctx.settings.rateConSigner?.name && (await queuePortalTask(ctx, { kind: "sign_rate_con", url: link, loadId: load.id, data: { from, fromName, subject: email.Subject, brokerId: load.brokerId, verified: true } })))
                notes.push(`Signing the rate con for ${load.referenceNumber} on their website.`);
              else if (await claimMark(carrierId, load.id, "portal_pdf_ask"))
                await sendOrQueue(ctx, { purpose: "ack", to: from, toName: fromName, subject: /^re:/i.test(email.Subject) ? email.Subject : `Re: ${email.Subject}`, body: `Hi${fromName ? ` ${fromName.split(" ")[0]}` : ""},\n\nCould you email the rate con for ${load.referenceNumber} as a PDF? We sign and send it straight back.\n\nThanks,\n${ctx.carrier.name}`, inReplyTo: sender.messageId, loadId: load.id, withinRules: true, why: `Ask ${fromName} for the rate con as a PDF?` });
              else if (await claimMark(carrierId, load.id, "portal_support")) await passToOwner(ctx, { reason: `${fromName} needs the rate con for ${load.referenceNumber} signed in their online portal (they didn't send a PDF when asked). Sign it from the link in their email.`, loadId: load.id, label: "Signed", source: "email", to: "support" });
            }
            else if (booked && !ctx.settings.rateConSigner?.name && (await claimMark(carrierId, `carrier:${carrierId}`, "no_signer"))) await passToOwner(ctx, { reason: `The AI booked ${load.referenceNumber} on a matching rate con but can't sign it for you yet. In Settings → Your rules, add who signs rate cons, and the AI will sign and return them.`, loadId: load.id, label: "Added", source: "email", to: "owner" });
            await sendOrQueue(ctx, { purpose: "ack", to: from, toName: fromName, subject: /^re:/i.test(email.Subject) ? email.Subject : `Re: ${email.Subject}`, body: mail.rateConThanks(ctx.carrier, ctx.settings, load, who, fromName, !!signed, booked && !!truck && !truck.nextLoadId && !ctx.loads.some((l) => l.truckId === truck.id && l.id !== load!.id && ["booked", "rate_confirmed"].includes(l.stage))), inReplyTo: sender.messageId, loadId: load.id, attachments: signed ? [signed] : undefined, withinRules: true, why: `Thank ${fromName} for the rate con on ${load.referenceNumber}?` });
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

  // The impostor gets no answer and nothing they ask is done. The real broker hears about it (at the address we
  // already had), and the owner is told.
  async function impostorEmail() {
    const real = lookalikeOf(from, ctx!.brokers.filter((b) => b.email?.toLowerCase() !== from));
    const domain = from.split("@")[1] ?? from;
    if (real?.email && (await claimMark(carrierId, `broker:${real.id}`, `impostor:${domain}`)))
      await sendOrQueue(ctx!, { purpose: "ack", to: real.email, toName: real.contact || undefined, subject: `Someone is emailing as ${real.company}`, body: `Hi${real.contact ? ` ${real.contact}` : ""},\n\nHeads up: we got an email from ${from}, which looks like your address but isn't. We didn't act on it. If it wasn't you, you may want to warn other carriers.\n\nThanks,\n${ctx!.carrier.name}`, withinRules: true, why: `Warn ${real.company} that someone is using a lookalike address?` });
    await passToOwner(ctx!, {
      reason: `${fromName} <${from}> emailed "${email.Subject}" from an address that imitates ${real?.company ?? "a broker you work with"}'s${real?.email ? ` (${real.email})` : ""}. The AI didn't answer or act on it${real?.email ? `, and warned ${real.company}` : ""}. Don't do anything it asks.`,
      loadId: load?.id,
      label: "Got it",
      source: "email",
      to: "owner",
      brokerId: real?.id,
    });
  }

  if (!aiConfigured()) {
    if (impostor) return impostorEmail();
    await passToOwner(ctx, { reason: `New email from ${fromName}: "${email.Subject}"`, loadId: load?.id, label: "I'll answer", source: "email", to: "support" });
    await holdingReply();
    return;
  }

  // Someone asking to change where money goes, or to confirm bank details: nothing is changed or shared. They get the
  // carrier's standing answer (payment details never change by email), and the owner is told.
  if (paymentScam(`${email.Subject}\n${text}`)) {
    if (!suspect() && (await claimMark(carrierId, `broker:${from}`, `bank:${new Date().toISOString().slice(0, 10)}`)))
      await sendOrQueue(ctx, { purpose: "ack", to: from, toName: fromName, subject: /^re:/i.test(email.Subject) ? email.Subject : `Re: ${email.Subject}`, body: `Hi,\n\nWe don't share, confirm or change payment or bank details by email. Our payment details are on our invoices${ctx.settings.factoringEmail ? " and our notice of assignment" : ""}. For anything about them, please call our office.\n\nThanks,\n${ctx.carrier.name}`, inReplyTo: sender.messageId, withinRules: true, why: `Tell ${fromName} payment details don't change by email?` });
    await passToOwner(ctx, {
      reason: `${fromName} <${from}> asked about bank or payment details ("${email.Subject}"). That's the most common way carriers get robbed. The AI changed nothing and told them it isn't done by email. If they call, confirm who they are on a number you already had.`,
      label: "Got it",
      source: "email",
      to: "owner",
    });
    return;
  }

  // A booked load whose rate con isn't signed yet, and the broker wants it signed in their portal: asked for a PDF by
  // email first; asked again, support signs it there (another company's website).
  if (load && !impostor && !load.rateConSignedAt && ["booked", "rate_confirmed", "dispatched"].includes(load.stage) && PORTAL_SIGNING.test(text) && /https?:\/\//.test(text)) {
    // With the browser worker, the AI signs it there, checking the rate on the page against what was agreed first.
    const link = signingLink(text);
    if (link && portalOn(ctx) && ctx.settings.rateConSigner?.name && !suspect() && (await queuePortalTask(ctx, { kind: "sign_rate_con", url: link, loadId: load.id, data: { from, fromName, subject: email.Subject, brokerId: load.brokerId } }))) return;
    if (await claimMark(carrierId, load.id, "portal_pdf_ask"))
      await sendOrQueue(ctx, { purpose: "ack", to: from, toName: fromName, subject: /^re:/i.test(email.Subject) ? email.Subject : `Re: ${email.Subject}`, body: `Hi${fromName ? ` ${fromName.split(" ")[0]}` : ""},\n\nCould you email the rate con for ${load.referenceNumber} as a PDF? We sign and send it straight back.\n\nThanks,\n${ctx.carrier.name}`, inReplyTo: sender.messageId, loadId: load.id, withinRules: true, why: `Ask ${fromName} for the rate con as a PDF?` });
    else if (await claimMark(carrierId, load.id, "portal_support"))
      await passToOwner(ctx, { reason: `${fromName} needs the rate con for ${load.referenceNumber} signed in their online portal (they didn't send a PDF when asked). Sign it from the link in their email.`, loadId: load.id, label: "Signed", source: "email", to: "support" });
    return;
  }

  // A tracking link for a load that's booked: straight to the driver, whatever else the email says.
  const trackingLink = load && ["booked", "rate_confirmed", "dispatched", "at_pickup", "in_transit"].includes(load.stage) ? trackingNeed(`${email.Subject}\n${text}`) : null;
  if (load && trackingLink?.link) await askDriverToTrack(ctx, load, trackingLink);

  // A link to the facility's scheduling website for a stop still waiting on its appointment: the AI books it there.
  const dock = load && !impostor && portalOn(ctx) ? dockLink(`${email.Subject}\n${text}`) : null;
  if (load && dock) {
    const need = (["pickup", "delivery"] as const).find((st) => {
      const a = load!.appointments?.[st];
      const asked = load!.rateConReading?.appointmentNeeded;
      return a ? a.status !== "set" : asked === st || asked === "both";
    });
    if (need) await queuePortalTask(ctx, { kind: "dock_appointment", url: dock, loadId: load.id, data: { from, fromName, subject: email.Subject, brokerId: load.brokerId, stop: need } });
  }

  const reading = await readBrokerEmail(email.Subject, text);
  if (impostor && reading?.kind !== "load_offers") return impostorEmail();
  // Remember the language the broker writes in, so what we send goes in it (lib/agent/outbox).
  const writer = ctx.brokers.find((b) => b.email?.toLowerCase() === from);
  const lang = reading?.language?.toLowerCase().slice(0, 2);
  if (writer && lang && /^[a-z]{2}$/.test(lang) && (writer.language ?? "en") !== lang) {
    const next = { ...writer, language: lang };
    await save("records", carrierId, next as unknown as Item, "broker");
    ctx.brokers = ctx.brokers.map((b) => (b.id === next.id ? next : b));
  }
  // A broker the AI couldn't book with for want of an MC number sends it: checked with FMCSA, and if it passes, the
  // AI asks to book their best load that's still open.
  const unverified = writer && !writer.authorityVerified && reading?.brokerMc && !impostor ? writer : null;
  if (unverified) {
    const checked = await checkBroker(ctx, unverified, reading!.brokerMc);
    if (checked.authorityVerified && ctx.settings.autonomy !== "ask") {
      const open = ctx.loads.filter((l) => l.brokerId === checked.id && l.stage === "offered" && l.truckId && (floorFor(l, ctx.settings) ?? Infinity) <= l.targetRate).sort((a, b) => b.targetRate - a.targetRate)[0];
      if (open) {
        await requestBooking(ctx, open, open.targetRate, { byRules: true });
        if (reading?.kind === "other") return;
      }
    }
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
  // A cargo claim (damage, a shortage): acknowledged in writing, and the claim file started.
  if (CLAIM_EMAIL.test(`${email.Subject}\n${text}`) && !suspect()) {
    const target = claimLoad(load) ?? claimLoad(byRef(reading?.loadNumber));
    if (target) {
      const amounts = dollarAmounts(text);
      await openClaim(ctx, target, { source: "broker", details: text.replace(/\s+/g, " ").trim().slice(0, 400), amount: amounts.length ? Math.max(...amounts) : null, claimant: from, claimantName: reading?.contactName ?? undefined, subject: email.Subject, inReplyTo: sender.messageId });
      return;
    }
  }
  // The broker sent an appointment time (one the AI asked them to set, or one they moved): on the load and to the driver.
  if (reading?.kind === "appointment" && reading.appointmentStop && reading.appointmentLocal && !suspect()) {
    const target = byRef(reading.loadNumber) ?? load;
    const state = target ? (reading.appointmentStop === "pickup" ? target.lane.originState : target.lane.destState) : "";
    const iso = target ? stopLocalToIso(reading.appointmentLocal, state) : null;
    if (target && iso && ["booked", "rate_confirmed", "dispatched", "at_pickup", "in_transit"].includes(target.stage)) {
      await setAppointment(ctx, target, reading.appointmentStop, iso, reading.appointmentConfirmation, "broker");
      await sendOrQueue(ctx, { purpose: "ack", to: from, toName: reading.contactName ?? undefined, subject: /^re:/i.test(email.Subject) ? email.Subject : `Re: ${email.Subject}`, body: mail.holdingThanks(ctx.carrier, ctx.settings, target, reading.contactName ?? undefined), inReplyTo: sender.messageId, loadId: target.id, withinRules: true, why: `Thank ${fromName} for the appointment on ${target.referenceNumber}?` });
      return;
    }
  }
  // A booked load changed (another stop, a new delivery): priced and answered before anyone says yes.
  if (reading?.kind === "change_request" && reading.changeKind) {
    const target = byRef(reading.loadNumber) ?? load;
    if (target && ["booked", "rate_confirmed", "dispatched", "at_pickup", "in_transit"].includes(target.stage) && !suspect()) {
      await answerChange(ctx, target, reading.changeKind, reading.changePlaces, { ...sender, contactName: reading.contactName });
      return;
    }
  }
  // Their answer to what we asked for a change.
  if (reading?.kind === "rate_reply" && load?.change?.status === "asked" && (await changeReply(ctx, load, { agreed: reading.agreedToOurRate, brokerRate: reading.brokerRate }, fromName))) return;
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

  if (impostor) return impostorEmail();
  const thread = (await threadWith(carrierId, "email", from, 8)).filter((m) => !(m.direction === "in" && m.body === text));
  const draft = await brokerEmailDraft(ctx, { from, fromName, subject: email.Subject, text, attachmentNotes: notes, thread, load });
  if (draft.effects.failed) {
    await passToOwner(ctx, { reason: `New email from ${fromName}: "${email.Subject}". The AI couldn't write a reply (twice), so it told them someone will get back to them.`, loadId: load?.id, label: "I'll answer", source: "email", to: "support" });
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
