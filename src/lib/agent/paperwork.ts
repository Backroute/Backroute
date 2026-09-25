import "server-only";
import type { Item } from "../cloud/rows";
import { textPdf, type PdfLine } from "../pdf";
import { formatAtStop } from "../stop-time";
import type { DetentionClaim, Load } from "../types";
import { claimMark, latestFiles, releaseMark, save, storeFile, type CarrierContext } from "./db";
import { passToOwner } from "./dispatcher";
import { sendOrQueue } from "./outbox";
import * as mail from "./templates";

/**
 * The paperwork a dispatcher does after the driving: the broker's setup packet, the invoice with the signed POD once
 * a load delivers, and detention claims when a truck sat too long at a dock. Each goes through the outbox, so the
 * autopilot setting decides whether it goes now or waits for the owner.
 */

const HOUR = 3600_000;
const FREE_HOURS = 2;
const DEFAULT_DETENTION_PER_HOUR = 50;

const brokerOf = (ctx: CarrierContext, l: Load) => ctx.brokers.find((b) => b.id === l.brokerId);
const billTo = (ctx: CarrierContext, l: Load) => l.brokerContactEmail ?? brokerOf(ctx, l)?.email ?? null;

// ─── Setup packet ────────────────────────────────────────────────────────────

/** A broker asked for the carrier's papers: send what's on file, or tell the owner what's missing. */
export async function sendSetupPacket(ctx: CarrierContext, sender: { from: string; fromName: string; subject: string; messageId?: string; contactName?: string | null }) {
  const papers = await latestFiles(ctx.carrier.id, ["w9", "coi", "authority", "noa"]);
  const has = (k: string) => papers.find((p) => p.kind === k);
  const today = new Date().toISOString().slice(0, 10);
  const coi = has("coi");
  const missing = [!has("w9") && "W-9", !coi && "insurance certificate", coi?.expires_on && coi.expires_on < today && "a current insurance certificate (the one on file expired)"].filter(Boolean);
  if (missing.length) {
    await passToOwner(ctx, {
      reason: `${sender.fromName} asked for your setup papers. Upload ${missing.join(" and ")} in Settings → General → Your papers, and the AI will send them next time. Or send them yourself.`,
      label: "I'll send them",
      source: "email",
      to: "owner",
    });
    return;
  }
  const order = ["w9", "coi", "authority", "noa"];
  const attach = papers.filter((p) => p.kind !== "noa" || ctx.settings.factoringEmail).sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));
  const label: Record<string, string> = { w9: "W-9", coi: "certificate of insurance", authority: "operating authority", noa: "notice of assignment" };
  await sendOrQueue(ctx, {
    purpose: "setup_packet",
    to: sender.from,
    toName: sender.contactName ?? undefined,
    subject: /^re:/i.test(sender.subject) ? sender.subject : `Re: ${sender.subject}`,
    body: mail.setupPacket(ctx.carrier, ctx.settings, attach.map((p) => label[p.kind]), sender.contactName ?? undefined),
    inReplyTo: sender.messageId,
    attachments: attach.map((p) => ({ fileId: p.id, name: p.name })),
    withinRules: true,
    why: `${sender.fromName} asked for your setup papers. Send your ${attach.map((p) => label[p.kind]).join(", ")}?`,
  });
}

/** Booked on the phone with a broker we had no email for: confirm in writing, with the packet, so the rate con comes back here. */
export async function confirmPhoneBooking(ctx: CarrierContext, load: Load, to: string, amount: number, contactName?: string) {
  const papers = await latestFiles(ctx.carrier.id, ["w9", "coi", "authority", "noa"]);
  const today = new Date().toISOString().slice(0, 10);
  const order = ["w9", "coi", "authority", "noa"];
  const attach = papers
    .filter((p) => (p.kind !== "noa" || ctx.settings.factoringEmail) && !(p.kind === "coi" && p.expires_on && p.expires_on < today))
    .sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));
  const label: Record<string, string> = { w9: "W-9", coi: "certificate of insurance", authority: "operating authority", noa: "notice of assignment" };
  return sendOrQueue(ctx, {
    purpose: "accept",
    to,
    toName: contactName,
    subject: mail.subjectFor(load, "Booked"),
    body: mail.phoneBooked(ctx.carrier, ctx.settings, load, amount, attach.map((p) => label[p.kind]), contactName),
    loadId: load.id,
    amount,
    attachments: attach.map((p) => ({ fileId: p.id, name: p.name })),
    withinRules: true,
    // Already agreed on a call the rules or the owner started: this is the paperwork for it.
    ownerAsked: true,
    why: `Confirm ${load.referenceNumber} in writing to ${to}.`,
  });
}

// ─── Invoices ────────────────────────────────────────────────────────────────

function invoicePdf(ctx: CarrierContext, load: Load, number: string, amount: number): Buffer {
  const broker = brokerOf(ctx, load);
  const s = ctx.settings;
  const lines: PdfLine[] = [
    { text: ctx.carrier.name, size: 18, bold: true },
    ...(s.businessAddress ? [{ text: s.businessAddress }] : []),
    ...(ctx.carrier.mc ? [{ text: `MC ${ctx.carrier.mc}` }] : []),
    ...(s.remitEmail ? [{ text: s.remitEmail }] : []),
    { text: "INVOICE", size: 16, bold: true, gap: 18 },
    { text: `Invoice number: ${number}` },
    { text: `Date: ${new Date().toISOString().slice(0, 10)}` },
    { text: `Terms: ${load.rateConReading?.paymentTerms ?? "Net 30"}` },
    { text: "Bill to", bold: true, gap: 14 },
    { text: broker?.company ?? "Broker" },
    ...(billTo(ctx, load) ? [{ text: billTo(ctx, load)! }] : []),
    { text: "Load", bold: true, gap: 14 },
    { text: `Broker load number: ${load.referenceNumber}` },
    { text: `Pickup: ${load.lane.origin}, ${load.lane.originState} · ${load.pickupAt ? formatAtStop(load.pickupAt, load.lane.originState) : load.pickupWindow}` },
    { text: `Delivery: ${load.lane.destination}, ${load.lane.destState} · ${load.deliveryAt ? formatAtStop(load.deliveryAt, load.lane.destState) : load.deliveryWindow}` },
    { text: `Equipment: ${load.equipmentType}` },
    { text: "Charges", bold: true, gap: 14 },
    { text: `Line haul, all in` },
    { text: `$${amount.toLocaleString("en-US", { minimumFractionDigits: 2 })}`, x: 460, gap: -14.85 },
    { text: "Total due", bold: true, gap: 8 },
    { text: `$${amount.toLocaleString("en-US", { minimumFractionDigits: 2 })}`, bold: true, x: 460, gap: -14.85 },
    ...(s.factoringEmail ? [{ text: "This invoice is assigned to our factoring company. Pay according to the notice of assignment on file.", size: 9, gap: 18 }] : []),
    { text: "Signed proof of delivery attached.", size: 9, gap: s.factoringEmail ? 2 : 18 },
  ];
  return textPdf(lines);
}

/** Delivered with a POD photo on file and not billed yet: make the invoice and send it with the POD. */
export async function sendInvoices(ctx: CarrierContext): Promise<string[]> {
  const done: string[] = [];
  for (const load of ctx.loads) {
    if (load.stage !== "delivered" || load.invoice || !load.bookedRate) continue;
    const pod = load.documents.find((d) => d.type === "pod" && d.fileId && d.status === "verified");
    if (!pod) continue; // The check-ins ask the driver for it.
    if (!(await claimMark(ctx.carrier.id, load.id, "invoice"))) continue;
    try {
      const to = ctx.settings.factoringEmail ?? billTo(ctx, load);
      const broker = brokerOf(ctx, load);
      if (!to) {
        await passToOwner(ctx, { reason: `${load.referenceNumber} delivered and the POD is in, but there's no email to bill ${broker?.company ?? "the broker"}. Add their email on the load or send the invoice yourself.`, loadId: load.id, label: "I'll bill it", source: "email" });
        continue;
      }
      const number = `INV-${load.referenceNumber}`.replace(/[^\w-]/g, "");
      const amount = load.bookedRate;
      const fileId = await storeFile(ctx.carrier.id, { kind: "invoice", name: `${number}.pdf`, contentType: "application/pdf", bytes: invoicePdf(ctx, load, number, amount), loadId: load.id });
      const bol = load.documents.find((d) => d.type === "bol" && d.fileId);
      const withInvoice: Load = { ...load, invoice: { number, amount, draftedAt: new Date().toISOString() }, updatedAt: new Date().toISOString() };
      await save("loads", ctx.carrier.id, withInvoice as unknown as Item);
      ctx.loads = ctx.loads.map((l) => (l.id === load.id ? withInvoice : l));
      const result = await sendOrQueue(ctx, {
        purpose: "invoice",
        to,
        subject: mail.subjectFor(load, `Invoice ${number}`),
        body: mail.invoiceEmail(ctx.carrier, ctx.settings, load, number, amount, !!ctx.settings.factoringEmail),
        loadId: load.id,
        amount,
        attachments: [{ fileId, name: `${number}.pdf` }, { fileId: pod.fileId!, name: pod.name }, ...(bol ? [{ fileId: bol.fileId!, name: bol.name }] : [])],
        // A POD with something written on it (a shortage, damage, no signature) waits for the owner.
        withinRules: !pod.flagged,
        rule: "invoice_noted_pod",
        why: pod.flagged ? `Invoice ${number} for ${load.referenceNumber} is ready, but check the POD first: ${pod.aiNote ?? "the AI saw a problem on it"}.` : `Invoice ${number} for ${load.referenceNumber}, $${amount.toLocaleString()}, is ready to send with the POD.`,
      });
      done.push(`${load.referenceNumber}: invoice ${result}`);
    } catch (error) {
      console.error("[paperwork] invoice failed", load.id, error);
      await releaseMark(ctx.carrier.id, load.id, "invoice");
    }
  }
  return done;
}

// ─── Detention ───────────────────────────────────────────────────────────────

/** "$50/hr after 2 hours" on the rate con → 50 and 2. Missing parts come back null. */
export function detentionTerms(text: string | null | undefined): { perHour: number | null; freeHours: number | null } {
  if (!text) return { perHour: null, freeHours: null };
  const perHour = text.match(/\$\s?(\d{2,3})(?:\.\d{2})?\s*(?:\/|per)\s*(?:hr|hour)/i);
  const free = text.match(/(\d(?:\.\d)?)\s*(?:hrs?|hours?)\s*(?:free|of free)/i) ?? text.match(/after\s*(\d(?:\.\d)?)\s*(?:hrs?|hours?)/i);
  return { perHour: perHour ? Number(perHour[1]) : null, freeHours: free ? Number(free[1]) : null };
}

/** How long the truck sat at each stop, from the driver's check-in and check-out times. */
export function dwell(load: Load): { stop: "pickup" | "delivery"; arrived: string; left: string; minutes: number }[] {
  const c = load.tripChecklist;
  const out: { stop: "pickup" | "delivery"; arrived: string; left: string; minutes: number }[] = [];
  if (c?.arrivedPickupAt && c.loadedAt) out.push({ stop: "pickup", arrived: c.arrivedPickupAt, left: c.loadedAt, minutes: Math.round((Date.parse(c.loadedAt) - Date.parse(c.arrivedPickupAt)) / 60000) });
  if (c?.arrivedDeliveryAt && c.unloadedAt) out.push({ stop: "delivery", arrived: c.arrivedDeliveryAt, left: c.unloadedAt, minutes: Math.round((Date.parse(c.unloadedAt) - Date.parse(c.arrivedDeliveryAt)) / 60000) });
  return out;
}

/** A stop that ran past free time: ask the broker for detention, with the times. */
export async function sendDetentionClaims(ctx: CarrierContext, now: number): Promise<string[]> {
  const done: string[] = [];
  for (const load of ctx.loads) {
    if (!["in_transit", "at_delivery", "delivered"].includes(load.stage) || Date.parse(load.updatedAt) < now - 7 * 24 * HOUR) continue;
    const terms = detentionTerms(load.rateConReading?.detention);
    const freeHours = terms.freeHours ?? FREE_HOURS;
    for (const d of dwell(load)) {
      if (d.minutes < freeHours * 60 + 15) continue;
      if (!(await claimMark(ctx.carrier.id, load.id, `detention_${d.stop}`))) continue;
      try {
        const to = billTo(ctx, load);
        const perHour = terms.perHour ?? DEFAULT_DETENTION_PER_HOUR;
        const amount = Math.round(((d.minutes - freeHours * 60) / 60) * perHour);
        const state = d.stop === "pickup" ? load.lane.originState : load.lane.destState;
        const claim: DetentionClaim = { stop: d.stop, minutes: d.minutes, amount, draftedAt: new Date(now).toISOString() };
        const withClaim: Load = { ...load, detentionClaims: [...(load.detentionClaims ?? []).filter((c) => c.stop !== d.stop), claim], updatedAt: new Date(now).toISOString() };
        await save("loads", ctx.carrier.id, withClaim as unknown as Item);
        ctx.loads = ctx.loads.map((l) => (l.id === load.id ? withClaim : l));
        if (!to) {
          await passToOwner(ctx, { reason: `${load.referenceNumber}: ${Math.round(d.minutes / 6) / 10} hours at ${d.stop}, about $${amount} in detention, but there's no broker email to claim it.`, loadId: load.id, label: "I'll claim it", source: "email" });
          continue;
        }
        const result = await sendOrQueue(ctx, {
          purpose: "detention",
          to,
          subject: mail.subjectFor(load, "Detention"),
          body: mail.detentionEmail(ctx.carrier, ctx.settings, load, { stop: d.stop, arrived: formatAtStop(d.arrived, state), left: formatAtStop(d.left, state), minutes: d.minutes, freeHours, perHour, amount }),
          loadId: load.id,
          amount,
          // Without the broker's own detention terms, the AI's $/hour is a guess: the owner checks it first.
          withinRules: terms.perHour !== null,
          rule: "detention_default",
          why: `${load.referenceNumber} sat ${Math.round(d.minutes / 6) / 10} hours at ${d.stop}. Claim $${amount} in detention${terms.perHour ? "" : ` (at $${perHour}/hour: the rate con didn't say, so check it)`}?`,
        });
        done.push(`${load.referenceNumber}: detention at ${d.stop} ${result}`);
      } catch (error) {
        console.error("[paperwork] detention failed", load.id, error);
        await releaseMark(ctx.carrier.id, load.id, `detention_${d.stop}`);
      }
    }
  }
  return done;
}

// ─── Upkeep ──────────────────────────────────────────────────────────────────

/** Offers a day old, or whose pickup has passed, are gone: they come off the board. */
export async function expireOffers(ctx: CarrierContext, now: number): Promise<number> {
  let n = 0;
  for (const load of ctx.loads) {
    if (load.stage !== "offered") continue;
    const stale = Date.parse(load.createdAt) < now - 24 * HOUR || (load.pickupAt && Date.parse(load.pickupAt) < now);
    if (!stale) continue;
    const gone: Load = { ...load, stage: "declined", updatedAt: new Date(now).toISOString() };
    await save("loads", ctx.carrier.id, gone as unknown as Item);
    n++;
  }
  return n;
}

/** The insurance certificate runs out within two weeks: the owner hears once, since brokers won't book without it. */
export async function warnCoiExpiring(ctx: CarrierContext, now: number) {
  const [coi] = await latestFiles(ctx.carrier.id, ["coi"]);
  if (!coi?.expires_on) return;
  const days = Math.floor((Date.parse(coi.expires_on) - now) / (24 * HOUR));
  if (days > 14) return;
  if (!(await claimMark(ctx.carrier.id, "carrier", `coi_expiring:${coi.expires_on}`))) return;
  await passToOwner(ctx, {
    reason: days < 0 ? `Your insurance certificate on file expired on ${coi.expires_on}. Brokers won't book without a current one: upload the new one in Settings.` : `Your insurance certificate expires on ${coi.expires_on}. Upload the renewed one in Settings so setup packets stay current.`,
    label: "Got it",
    source: "email",
    to: "owner",
  });
}
