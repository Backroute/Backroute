import "server-only";
import { canText, textTo } from "../channels/out";
import { toE164 } from "../cloud/phone";
import type { Item } from "../cloud/rows";
import { textPdf, type PdfLine } from "../pdf";
import { reeferLine, reeferRecord } from "./reefer";
import { formatAtStop } from "../stop-time";
import type { CargoClaim, Driver, Load } from "../types";
import { addActivity, admin, logChannel, save, saveDriverMessage, storeFile, type CarrierContext } from "./db";
import { event, passToOwner, uid } from "./dispatcher";
import { sendOrQueue } from "./outbox";
import * as mail from "./templates";

/**
 * Cargo claims, the paperwork a dispatcher runs when freight shows up damaged or short: acknowledge the claim in
 * writing right away (the rules give 30 days) and say what the claimant still has to send, get the driver's account
 * while it's fresh, and put the claim file together (the load, the times from the driver's app, what the BOL and POD
 * say, the driver's statement, the photos) for the carrier's cargo insurer. Whether to pay it or file it with
 * insurance is the owner's call: the file goes to the insurer only when they OK it.
 */

/** An email that files or talks about a cargo claim. */
export const CLAIM_EMAIL = /\b(cargo|freight|damage|damaged|shortage|loss|os&?d|overage|product)\s+claim\b|\bclaim (for|on|against) (the )?(damage|shortage|loss|load|shipment|freight)|\bos&d\b|\bfil(e|ing) (a|an|the) claim\b|\bnotice of claim\b/i;
/** A driver's text or POD note about damaged or short freight. */
export const DAMAGE = /\b(damage[sd]?|broken|crushed|leak(ing|ed)?|wet|punctured|short(age)?|missing (cases|pallets|pieces)|refused|rejected|overage)\b/i;
const OPEN = ["in_transit", "at_delivery", "delivered"];

function kindOf(text: string): CargoClaim["kind"] {
  if (/\bshort(age)?|missing\b/i.test(text)) return "shortage";
  if (/\bloss|lost|stolen|theft\b/i.test(text)) return "loss";
  if (DAMAGE.test(text)) return "damage";
  return "other";
}

const driverFor = (ctx: CarrierContext, load: Load) => ctx.drivers.find((d) => d.id === ctx.trucks.find((t) => t.id === load.truckId)?.driverId);

async function text(ctx: CarrierContext, driver: Driver, body: string, loadId: string) {
  const to = toE164(driver.phone);
  if (!to || driver.prefs?.smsOptOut || !canText(ctx.carrier)) return false;
  const sid = await textTo(ctx.carrier, to, body);
  await saveDriverMessage(ctx.carrier.id, { id: uid("dm"), driverId: driver.id, from: "ai", content: body, timestamp: new Date().toISOString(), channel: "sms", ai: true });
  await logChannel({ carrierId: ctx.carrier.id, channel: "sms", direction: "out", providerId: sid, driverId: driver.id, counterparty: to, body, data: { kind: "claim_statement", loadId } });
  return true;
}

async function saveClaim(ctx: CarrierContext, load: Load, claim: CargoClaim): Promise<Load> {
  const current = ctx.loads.find((l) => l.id === load.id) ?? load;
  const next: Load = { ...current, claim, updatedAt: new Date().toISOString() };
  await save("loads", ctx.carrier.id, next as unknown as Item);
  ctx.loads = ctx.loads.map((l) => (l.id === load.id ? next : l));
  return next;
}

/**
 * A claim on a load: from the broker or shipper in writing (acknowledged, and told what to send), or from a POD with
 * damage or a shortage written on it (the file starts before anyone asks). Returns what happened.
 */
export async function openClaim(ctx: CarrierContext, load: Load, o: { source: CargoClaim["source"]; details: string; amount?: number | null; claimant?: string; claimantName?: string; subject?: string; inReplyTo?: string }): Promise<string> {
  const current = ctx.loads.find((l) => l.id === load.id) ?? load;
  const had = current.claim;
  const now = new Date().toISOString();
  let claim: CargoClaim = had
    ? { ...had, ...(o.amount ? { amount: o.amount } : {}), ...(o.claimant && !had.claimant ? { claimant: o.claimant } : {}), ...(o.source === "broker" ? { source: "broker" as const, details: o.details.slice(0, 500) } : {}) }
    : { openedAt: now, source: o.source, kind: kindOf(o.details), details: o.details.slice(0, 500), ...(o.amount ? { amount: o.amount } : {}), ...(o.claimant ? { claimant: o.claimant } : {}) };
  const done: string[] = [];

  // The driver's account, while they still remember the dock.
  const driver = driverFor(ctx, current);
  if (!claim.statementAskedAt && driver) {
    const first = driver.name.split(" ")[0];
    const asked = await text(ctx, driver, `${first}, there's a ${claim.kind === "shortage" ? "shortage" : claim.kind === "loss" ? "loss" : "damage"} claim on ${current.referenceNumber}: ${claim.details.slice(0, 140)}. Text me what happened: was it sealed, did you see it loaded and counted, anything written on the BOL or POD? Send any photos you took.`, current.id);
    if (asked) {
      claim = { ...claim, statementAskedAt: now };
      done.push("asked the driver for a statement");
    }
  }

  // The claimant hears back in writing, with what they still need to send.
  if (o.source === "broker" && o.claimant && !claim.ackSentAt) {
    await sendOrQueue(ctx, {
      purpose: "ack",
      to: o.claimant,
      toName: o.claimantName,
      subject: o.subject ? (/^re:/i.test(o.subject) ? o.subject : `Re: ${o.subject}`) : mail.subjectFor(current, "Claim"),
      body: `Hi${o.claimantName ? ` ${o.claimantName}` : ""},\n\nWe received your claim on ${current.referenceNumber}${claim.amount ? ` for $${claim.amount.toLocaleString("en-US")}` : ""} and opened a claim file. To process it, please send:\n\n- The claim in writing with the amount you're claiming\n- The commercial invoice for the goods\n- The delivery receipt or POD with the exceptions noted\n- Photos of the damage, and whether the product was refused, salvaged or can be returned\n\nWe'll get back to you with our answer within 30 days of your claim.\n\nThanks,\n${ctx.carrier.name}`,
      inReplyTo: o.inReplyTo,
      loadId: current.id,
      withinRules: true,
      why: `Acknowledge the claim on ${current.referenceNumber} and ask for the claim documents?`,
    });
    claim = { ...claim, ackSentAt: now };
    done.push("acknowledged it in writing");
  }
  const saved = await saveClaim(ctx, current, claim);

  if (!had) {
    await addActivity(ctx.carrier.id, event({ type: "incident", loadId: saved.id, message: `Cargo claim opened on ${saved.referenceNumber}`, detail: `${claim.kind}${claim.amount ? ` · $${claim.amount.toLocaleString("en-US")}` : ""} · ${claim.source === "broker" ? "filed by the broker" : "from the POD"}`, severity: "warning" }));
    await passToOwner(ctx, {
      reason: `Cargo claim on ${saved.referenceNumber} (${claim.kind}${claim.amount ? `, $${claim.amount.toLocaleString("en-US")}` : ""}): ${claim.details.slice(0, 200)}. The AI ${done.length ? done.join(" and ") : "opened a file"} and is putting the claim file together for your insurer. You decide whether to pay it yourself or file it with insurance.`,
      loadId: saved.id,
      label: "Got it",
      source: o.source === "broker" ? "email" : "sms",
      to: "owner",
    });
  }
  return done.length ? done.join(", ") : "claim updated";
}

/** A driver's text while their statement is wanted: it goes in the claim file. Null when it's about something else. */
export async function claimStatementReply(ctx: CarrierContext, driver: Driver, said: string): Promise<string | null> {
  const words = said.trim();
  if (words.length < 15 || /^\s*(ok(ay)?|yes|no|thanks?|got it)\b[.!]?\s*$/i.test(words)) return null;
  const trucks = new Set(ctx.trucks.filter((t) => t.driverId === driver.id || t.secondDriverId === driver.id).map((t) => t.id));
  const load = ctx.loads.find((l) => l.truckId && trucks.has(l.truckId) && l.claim?.statementAskedAt && !l.claim.statement && Date.now() - Date.parse(l.claim.statementAskedAt) < 72 * 3600_000);
  if (!load) return null;
  await saveClaim(ctx, load, { ...load.claim!, statement: words.slice(0, 1500) });
  return `Thanks, that's in the claim file for ${load.referenceNumber}. Send any photos you have too.`;
}

async function loadFiles(carrierId: string, loadId: string, kinds: string[]) {
  const { data, error } = await admin().from("carrier_files").select("id, kind, name").eq("carrier_id", carrierId).eq("load_id", loadId).in("kind", kinds).order("created_at", { ascending: true }).limit(20);
  if (error) throw error;
  return (data ?? []) as { id: string; kind: string; name: string }[];
}

/** Lines of about `n` characters, for the one-page PDF. */
const wrap = (s: string, n = 95) => s.replace(/\s+/g, " ").match(new RegExp(`.{1,${n}}(\\s|$)`, "g"))?.map((l) => l.trim()) ?? [];

function claimPdf(ctx: CarrierContext, load: Load): Buffer {
  const c = load.claim!;
  const broker = ctx.brokers.find((b) => b.id === load.brokerId);
  const t = load.tripChecklist;
  const at = (iso: string | undefined, state: string) => (iso ? formatAtStop(iso, state) : "not recorded");
  const driver = driverFor(ctx, load);
  const docs = load.documents.filter((d) => d.aiNote && (d.type === "bol" || d.type === "pod"));
  const lines: PdfLine[] = [
    { text: `Cargo claim file: load ${load.referenceNumber}`, size: 16, bold: true },
    { text: `${ctx.carrier.name}${ctx.carrier.mc ? `, MC ${String(ctx.carrier.mc).replace(/^mc\s*/i, "")}` : ""} · prepared ${new Date().toISOString().slice(0, 10)}` },
    { text: "The claim", bold: true, gap: 12 },
    { text: `${c.kind[0].toUpperCase()}${c.kind.slice(1)}${c.amount ? `, $${c.amount.toLocaleString("en-US")} claimed` : ", amount not stated yet"} · ${c.source === "broker" ? `filed by ${broker?.company ?? "the broker"}${c.claimant ? ` (${c.claimant})` : ""}` : "noted on the POD"} · opened ${c.openedAt.slice(0, 10)}` },
    ...wrap(c.details).slice(0, 5).map((l) => ({ text: l, size: 10 })),
    { text: "The load", bold: true, gap: 12 },
    { text: `${broker?.company ?? "Broker"} · ${load.lane.origin}, ${load.lane.originState} to ${load.lane.destination}, ${load.lane.destState} · ${load.equipmentType}${load.commodity ? ` · ${load.commodity}` : ""}${load.weight ? ` · ${load.weight.toLocaleString("en-US")} lb` : ""}` },
    { text: `Driver: ${driver?.name ?? "not on file"}` },
    { text: "Times (from the driver's app)", bold: true, gap: 12 },
    { text: `Arrived pickup: ${at(t?.arrivedPickupAt, load.lane.originState)} · loaded: ${at(t?.loadedAt, load.lane.originState)}` },
    { text: `Arrived delivery: ${at(t?.arrivedDeliveryAt, load.lane.destState)} · unloaded: ${at(t?.unloadedAt, load.lane.destState)}` },
    { text: "What the paperwork says", bold: true, gap: 12 },
    ...(docs.length ? docs.flatMap((d) => wrap(`${d.type.toUpperCase()}: ${d.aiNote}`).slice(0, 3).map((l) => ({ text: l, size: 10 }))) : [{ text: "No notes read off the BOL or POD.", size: 10 }]),
    ...(load.reeferLog?.length || reeferLine(load)
      ? [
          { text: "Temperature record", bold: true, gap: 12 },
          ...(reeferLine(load) ? [{ text: `Required: ${reeferLine(load)!.replace(/^Reefer: /, "").split(".")[0]}`, size: 10 }] : []),
          ...(reeferRecord(load).length ? reeferRecord(load).slice(-20).map((l) => ({ text: l, size: 10 })) : [{ text: "No readings recorded.", size: 10 }]),
        ]
      : []),
    { text: "Driver's statement", bold: true, gap: 12 },
    ...(c.statement ? wrap(`"${c.statement}"`).slice(0, 12).map((l) => ({ text: l, size: 10 })) : [{ text: "Asked for; not received yet.", size: 10 }]),
    { text: "Attached: this summary, the rate confirmation, the BOL, the POD and the driver's photos on file.", size: 9, gap: 16 },
  ];
  return textPdf(lines);
}

/**
 * Each round: a claim whose statement is in (or a day after asking) gets its file put together, and sent to the
 * cargo insurer once the owner OKs it (or handed to the owner when there's no insurer email in Settings).
 */
export async function claimRounds(ctx: CarrierContext, now: number): Promise<string[]> {
  const done: string[] = [];
  for (const load of [...ctx.loads]) {
    const c = load.claim;
    if (!c || c.packetAt) continue;
    const waited = !c.statementAskedAt || now - Date.parse(c.statementAskedAt) > 24 * 3600_000;
    if (!c.statement && !waited) continue;
    const fileId = await storeFile(ctx.carrier.id, { kind: "claim_file", name: `${load.referenceNumber}-claim.pdf`.replace(/[^\w.-]+/g, "-"), contentType: "application/pdf", bytes: claimPdf(ctx, load), loadId: load.id });
    const saved = await saveClaim(ctx, load, { ...c, packetFileId: fileId, packetAt: new Date(now).toISOString() });
    const files = await loadFiles(ctx.carrier.id, load.id, ["rate_con_signed", "rate_con", "bol", "pod", "damage_photo"]);
    const insurer = ctx.settings.cargoInsurerEmail;
    if (insurer) {
      await sendOrQueue(ctx, {
        purpose: "claim",
        to: insurer,
        subject: `Cargo claim: ${ctx.carrier.name}, load ${load.referenceNumber}`,
        body: `Hello,\n\nWe're reporting a cargo claim (${c.kind}${c.amount ? `, $${c.amount.toLocaleString("en-US")} claimed` : ""}) on load ${load.referenceNumber}, ${load.lane.origin}, ${load.lane.originState} to ${load.lane.destination}, ${load.lane.destState}. The claim file is attached with the rate confirmation, BOL, POD and the driver's photos.\n\nPlease let us know the claim number and what else you need.\n\nThanks,\n${ctx.carrier.name}`,
        loadId: load.id,
        attachments: [{ fileId, name: `${load.referenceNumber}-claim.pdf` }, ...files.map((f) => ({ fileId: f.id, name: f.name }))],
        // Filing with insurance is the owner's call (it can raise the premium): it waits for their OK.
        withinRules: false,
        why: `The claim file for ${load.referenceNumber} is ready. Send it to your cargo insurer (${insurer}), or tap no to handle the claim yourself?`,
      });
      done.push(`${saved.referenceNumber}: claim file ready for the insurer`);
    } else {
      await passToOwner(ctx, { reason: `The cargo claim file for ${saved.referenceNumber} is ready (in Files, with the BOL, POD and photos). Add your cargo insurer's claims email in Settings and the AI will send it, or send it yourself.`, loadId: saved.id, label: "Got it", source: "email", to: "owner" });
      done.push(`${saved.referenceNumber}: claim file ready, owner told`);
    }
  }
  return done;
}

/** The load a claim is about, when it is far enough along to have one. */
export const claimLoad = (load: Load | undefined) => (load && OPEN.includes(load.stage) ? load : undefined);
