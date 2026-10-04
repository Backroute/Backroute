import "server-only";
import type { Item } from "../cloud/rows";
import { textPdf, type PdfLine } from "../pdf";
import { formatAtStop } from "../stop-time";
import type { DetentionClaim, Load } from "../types";
import { claimMark, latestFiles, releaseMark, save, storeFile, type CarrierContext } from "./db";
import { passToOwner } from "./dispatcher";
import { sendOrQueue } from "./outbox";
import * as mail from "./templates";
import { carrierRecord, recordLine } from "./record";
import { portalOn, queuePortalTask } from "../portal/tasks";

/**
 * The paperwork a dispatcher does after the driving: the broker's setup packet, the invoice with the signed POD once
 * a load delivers, and detention claims when a truck sat too long at a dock. Each goes through the outbox, so the
 * autopilot setting decides whether it goes now or waits for the owner.
 */

const HOUR = 3600_000;
const FREE_HOURS = 2;
const DEFAULT_DETENTION_PER_HOUR = 50;

const brokerOf = (ctx: CarrierContext, l: Load) => ctx.brokers.find((b) => b.id === l.brokerId);
// Where the broker gets paperwork: the contact on the load, the broker on file, or the address on their rate con.
export const billTo = (ctx: CarrierContext, l: Load) => l.brokerContactEmail || brokerOf(ctx, l)?.email || l.rateConReading?.brokerEmail || null;

// ─── Setup packet ────────────────────────────────────────────────────────────

/** A broker asked for the carrier's papers: send what's on file, or tell the owner what's missing. */
const SETUP_NETWORKS = /https?:\/\/[^\s>"]*(mycarrierpackets|rmis|registrymonitoring|highway\.com|carrierassure|carrier411|carrierok|trucker ?tools|assure)[^\s>"]*/i;

export async function sendSetupPacket(ctx: CarrierContext, sender: { from: string; fromName: string; subject: string; messageId?: string; contactName?: string | null }, text = "") {
  // An invite to the broker's onboarding portal. With the browser worker, the AI fills it in there itself (signing in
  // with the carrier's login, or opening the account), and the owner sees it before it's submitted unless they said
  // not to. Without it: when the carrier already has a profile on that network (Settings), the packet email points
  // them to it; otherwise someone has to sign in and fill it out: support.
  const invite = text.match(SETUP_NETWORKS)?.[0];
  const network = invite?.match(SETUP_NETWORKS)?.[1]?.toLowerCase().replace(/\s+/g, "");
  const onFile = network && ctx.settings.setupProfiles?.some((p) => `${p.name} ${p.url}`.toLowerCase().replace(/\s+/g, "").includes(network.replace(/\.com$/, "")));
  const byAi = invite && portalOn(ctx) ? await queuePortalTask(ctx, { kind: "carrier_setup", url: invite, data: { from: sender.from, fromName: sender.fromName, subject: sender.subject } }).catch(() => null) : null;
  if (invite && !onFile && !byAi)
    await passToOwner(ctx, {
      reason: `${sender.fromName} wants ${ctx.carrier.name} set up through their onboarding portal: ${invite}. Complete it with the details and papers in Settings; the AI sent the papers by email too.`,
      label: "Set up",
      source: "email",
      to: "support",
    });
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
    // Meanwhile the broker hears it's coming, the way a dispatcher would say it.
    await sendOrQueue(ctx, { purpose: "ack", to: sender.from, toName: sender.contactName ?? sender.fromName, subject: /^re:/i.test(sender.subject) ? sender.subject : `Re: ${sender.subject}`, body: mail.holding(ctx.carrier, ctx.settings, "our carrier packet", sender.contactName ?? sender.fromName), inReplyTo: sender.messageId, withinRules: true, why: `Tell ${sender.fromName} the packet is coming?` });
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
    body: mail.setupPacket(ctx.carrier, ctx.settings, attach.map((p) => label[p.kind]), sender.contactName ?? undefined, recordLine(carrierRecord(ctx.loads))),
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

/**
 * What goes on the invoice: the line haul, detention the broker was already sent a claim for, and a lumper the driver
 * paid (read off the receipt). A cancelled load that was claimed as TONU is billed for that alone.
 */
function invoiceLines(load: Load): { label: string; amount: number }[] {
  if (load.stage === "cancelled") return load.tonuFee ? [{ label: "Truck ordered, not used (TONU)", amount: load.tonuFee }] : [];
  const lines = [{ label: "Line haul, all in", amount: load.bookedRate ?? 0 }];
  for (const c of load.detentionClaims ?? []) if (c.sentAt && c.amount > 0) lines.push({ label: `Detention at ${c.stop} (${Math.round(c.minutes / 6) / 10} hours, claimed ${c.sentAt.slice(0, 10)})`, amount: c.amount });
  for (const c of load.layoverClaims ?? []) if (c.sentAt && c.amount > 0) lines.push({ label: `Layover at ${c.stop} (${c.days} day${c.days === 1 ? "" : "s"}, claimed ${c.sentAt.slice(0, 10)})`, amount: c.amount });
  if (load.change?.status === "agreed" && load.change.extra > 0) lines.push({ label: load.change.kind === "reroute" ? `Reroute (${load.change.extraMiles} extra miles)` : `Extra stop${load.change.places.length === 1 ? "" : "s"} (${load.change.places.map((p) => `${p.city}, ${p.state}`).join("; ")})`, amount: load.change.extra });
  for (const d of load.documents) if (d.type === "lumper_receipt" && d.amount && d.fileId) lines.push({ label: "Lumper (receipt attached)", amount: d.amount });
  return lines;
}

function invoicePdf(ctx: CarrierContext, load: Load, number: string, charges: { label: string; amount: number }[]): Buffer {
  const amount = charges.reduce((s, l) => s + l.amount, 0);
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
    ...charges.flatMap((l) => [{ text: l.label }, { text: `$${l.amount.toLocaleString("en-US", { minimumFractionDigits: 2 })}`, x: 460, gap: -14.85 }]),
    { text: "Total due", bold: true, gap: 8 },
    { text: `$${amount.toLocaleString("en-US", { minimumFractionDigits: 2 })}`, bold: true, x: 460, gap: -14.85 },
    ...(s.factoringEmail ? [{ text: "This invoice is assigned to our factoring company. Pay according to the notice of assignment on file.", size: 9, gap: 18 }] : []),
    ...(load.stage === "cancelled" ? [] : [{ text: "Signed proof of delivery attached.", size: 9, gap: s.factoringEmail ? 2 : 18 }]),
  ];
  return textPdf(lines);
}

/** The factoring company's cover sheet: who owes what, for which load, and what's attached. */
function schedulePdf(ctx: CarrierContext, load: Load, number: string, amount: number): Buffer {
  const broker = brokerOf(ctx, load);
  const money = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
  return textPdf([
    { text: "Schedule of accounts", size: 16, bold: true },
    { text: `${ctx.carrier.name}${ctx.carrier.mc ? `, MC ${String(ctx.carrier.mc).replace(/^mc\s*/i, "")}` : ""}` },
    { text: `Submitted ${new Date().toISOString().slice(0, 10)}` },
    { text: "Debtor (broker)", bold: true, gap: 14 },
    { text: broker?.legalName ?? broker?.company ?? "Broker" },
    ...(broker?.mc ? [{ text: `MC ${broker.mc}` }] : []),
    ...(billTo(ctx, load) ? [{ text: billTo(ctx, load)! }] : []),
    { text: "Invoice", bold: true, gap: 14 },
    { text: `Invoice ${number} · load ${load.referenceNumber}` },
    { text: `${load.lane.origin}, ${load.lane.originState} to ${load.lane.destination}, ${load.lane.destState}` },
    { text: `Delivered ${load.tripChecklist?.unloadedAt?.slice(0, 10) ?? load.updatedAt.slice(0, 10)}` },
    { text: `Amount: ${money(amount)}`, bold: true },
    { text: "Attached: invoice, rate confirmation, signed proof of delivery, bill of lading, and receipts billed.", size: 9, gap: 18 },
    { text: "The carrier certifies the load was delivered and the invoice is due and unpaid.", size: 9 },
  ]);
}

/** Delivered with a POD photo on file and not billed yet: make the invoice and send it with the POD. */
export async function sendInvoices(ctx: CarrierContext): Promise<string[]> {
  const done: string[] = [];
  for (const load of ctx.loads) {
    if (load.invoice) continue;
    // A cancellation claimed as TONU is billed once the claim has gone out (no POD for a load that never moved).
    if (load.stage === "cancelled" ? !load.tonuFee || !load.tonuClaimedAt : load.stage !== "delivered" || !load.bookedRate) continue;
    const pod = load.documents.find((d) => d.type === "pod" && d.fileId && d.status === "verified");
    if (!pod && load.stage !== "cancelled") continue; // The check-ins ask the driver for it.
    if (!(await claimMark(ctx.carrier.id, load.id, "invoice"))) continue;
    try {
      const to = ctx.settings.factoringEmail ?? billTo(ctx, load);
      const broker = brokerOf(ctx, load);
      if (!to) {
        await passToOwner(ctx, { reason: `${load.referenceNumber} delivered and the POD is in, but there's no email anywhere to bill ${broker?.company ?? "the broker"}. Add their email on the load and the AI sends it.`, loadId: load.id, label: "Added", source: "email", to: "owner" });
        continue;
      }
      const number = `INV-${load.referenceNumber}`.replace(/[^\w-]/g, "");
      const lines = invoiceLines(load);
      const amount = lines.reduce((s, l) => s + l.amount, 0);
      const fileId = await storeFile(ctx.carrier.id, { kind: "invoice", name: `${number}.pdf`, contentType: "application/pdf", bytes: invoicePdf(ctx, load, number, lines), loadId: load.id });
      const bol = load.documents.find((d) => d.type === "bol" && d.fileId);
      const lumper = load.documents.find((d) => d.type === "lumper_receipt" && d.amount && d.fileId);
      // Factoring: the whole submission packet the factor asks for, the way a dispatcher sends it: a schedule of
      // accounts on top, the invoice, the (signed) rate con, the signed POD and BOL, and any receipts billed.
      const factoring = !!ctx.settings.factoringEmail;
      const rateCon = factoring ? (await latestFiles(ctx.carrier.id, ["rate_con_signed", "rate_con"], load.id)).sort((a, b) => (a.kind === "rate_con_signed" ? -1 : b.kind === "rate_con_signed" ? 1 : 0))[0] : undefined;
      const schedule = factoring ? await storeFile(ctx.carrier.id, { kind: "factoring_schedule", name: `${number}-schedule.pdf`, contentType: "application/pdf", bytes: schedulePdf(ctx, load, number, amount), loadId: load.id }) : null;
      if (factoring && !rateCon)
        await passToOwner(ctx, { reason: `${load.referenceNumber}'s invoice packet went to your factoring company without the rate con (there's none on file). Send it to them, or upload it on the load, so they don't hold the advance.`, loadId: load.id, label: "Sent it", source: "email", to: "owner" });
      const withInvoice: Load = { ...load, invoice: { number, amount, lines, draftedAt: new Date().toISOString() }, updatedAt: new Date().toISOString() };
      await save("loads", ctx.carrier.id, withInvoice as unknown as Item);
      ctx.loads = ctx.loads.map((l) => (l.id === load.id ? withInvoice : l));
      const result = await sendOrQueue(ctx, {
        purpose: factoring ? "factoring" : "invoice",
        to,
        subject: factoring ? `Invoice packet ${number}: ${brokerOf(ctx, load)?.company ?? "broker"}, load ${load.referenceNumber}` : mail.subjectFor(load, `Invoice ${number}`),
        body: factoring ? mail.factoringEmail(ctx.carrier, ctx.settings, load, number, amount, brokerOf(ctx, load), !!rateCon) : mail.invoiceEmail(ctx.carrier, ctx.settings, load, number, amount, false, lines),
        loadId: load.id,
        amount,
        attachments: [
          ...(schedule ? [{ fileId: schedule, name: `${number}-schedule.pdf` }] : []),
          { fileId, name: `${number}.pdf` },
          ...(rateCon ? [{ fileId: rateCon.id, name: rateCon.name }] : []),
          ...(pod ? [{ fileId: pod.fileId!, name: pod.name }] : []),
          ...(bol ? [{ fileId: bol.fileId!, name: bol.name }] : []),
          ...(lumper ? [{ fileId: lumper.fileId!, name: lumper.name }] : []),
        ],
        // A POD with something written on it (a shortage, damage, no signature) waits for the owner.
        withinRules: !pod?.flagged,
        rule: "invoice_noted_pod",
        why: pod?.flagged ? `Invoice ${number} for ${load.referenceNumber} is ready, but check the POD first: ${pod.aiNote ?? "the AI saw a problem on it"}.` : `Invoice ${number} for ${load.referenceNumber}, $${amount.toLocaleString()}, is ready to send${pod ? " with the POD" : ""}.`,
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
function detentionTerms(text: string | null | undefined): { perHour: number | null; freeHours: number | null } {
  if (!text) return { perHour: null, freeHours: null };
  const perHour = text.match(/\$\s?(\d{2,3})(?:\.\d{2})?\s*(?:\/|per)\s*(?:hr|hour)/i);
  const free = text.match(/(\d(?:\.\d)?)\s*(?:hrs?|hours?)\s*(?:free|of free)/i) ?? text.match(/after\s*(\d(?:\.\d)?)\s*(?:hrs?|hours?)/i);
  return { perHour: perHour ? Number(perHour[1]) : null, freeHours: free ? Number(free[1]) : null };
}

/** How long the truck sat at each stop, from the driver's check-in and check-out times. */
function dwell(load: Load): { stop: "pickup" | "delivery"; arrived: string; left: string; minutes: number }[] {
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
      // Held overnight: that stop is claimed as layover instead (lib/agent/layover).
      if (load.layoverClaims?.some((c) => c.stop === d.stop)) continue;
      if (!(await claimMark(ctx.carrier.id, load.id, `detention_${d.stop}`))) continue;
      try {
        const to = billTo(ctx, load);
        const perHour = terms.perHour ?? ctx.settings.detentionPerHour ?? DEFAULT_DETENTION_PER_HOUR;
        const amount = Math.round(((d.minutes - freeHours * 60) / 60) * perHour);
        const state = d.stop === "pickup" ? load.lane.originState : load.lane.destState;
        const claim: DetentionClaim = { stop: d.stop, minutes: d.minutes, amount, draftedAt: new Date(now).toISOString() };
        const withClaim: Load = { ...load, detentionClaims: [...(load.detentionClaims ?? []).filter((c) => c.stop !== d.stop), claim], updatedAt: new Date(now).toISOString() };
        await save("loads", ctx.carrier.id, withClaim as unknown as Item);
        ctx.loads = ctx.loads.map((l) => (l.id === load.id ? withClaim : l));
        if (!to) {
          await passToOwner(ctx, { reason: `${load.referenceNumber}: ${Math.round(d.minutes / 6) / 10} hours at ${d.stop}, about $${amount} in detention, but there's no broker email to claim it. Add their email on the load.`, loadId: load.id, label: "Added", source: "email", to: "owner" });
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
