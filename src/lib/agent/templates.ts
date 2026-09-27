import type { CarrierRow } from "./db";
import type { AgentSettings } from "../store";
import type { Load } from "../types";
import { termsLine } from "./negotiation";

/**
 * The dispatcher's standard emails. They're written from templates, not by the AI, so the price in each one is
 * exactly the number the rules picked (lib/agent/pricing) and nothing else.
 */

const money = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
const lane = (l: Load) => `${l.lane.origin}, ${l.lane.originState} to ${l.lane.destination}, ${l.lane.destState}`;
/** A pickup or delivery time as it reads mid-sentence: "Tomorrow 8:00 AM" → "tomorrow 8:00 AM" (day names stay). */
export const when = (window: string) => window.replace(/^(Today|Tomorrow|Tonight|Next|This)\b/, (w) => w.toLowerCase());
const hello = (name?: string) => `Hi${name ? ` ${name.split(/[\s@]/)[0]}` : ""},`;

function signature(carrier: CarrierRow, settings: Pick<AgentSettings, "remitEmail">) {
  return [`${carrier.name}`, carrier.mc ? `MC ${carrier.mc}` : null, settings.remitEmail ?? null, "Sent by our AI dispatcher"].filter(Boolean).join("\n");
}

export const subjectFor = (l: Load, what?: string) => `${what ? `${what}: ` : ""}Load ${l.referenceNumber} · ${l.lane.origin}, ${l.lane.originState} → ${l.lane.destination}, ${l.lane.destState}`;

/** Asking to book a load. `truckAt` is where the truck is, as a dispatcher would say it ("empty in Dallas, TX"). */
export function bookRequest(carrier: CarrierRow, settings: AgentSettings, load: Load, ask: number, toName?: string, truckAt?: string) {
  const equipment = load.equipmentType.toLowerCase();
  return `${hello(toName)}

Can we get ${load.referenceNumber}, ${lane(load)}, picking up ${when(load.pickupWindow)}? ${truckAt ? `Our ${equipment} is ${truckAt} and ready for it.` : `We have a ${equipment} ready for it.`}

Our rate is ${money(ask)} all in. ${termsLine(settings)}

Send the rate con here and we'll dispatch.

Thanks,
${signature(carrier, settings)}`;
}

/** Our counter, worded for where the haggling is: coming down, meeting in the middle, holding, or our last number. */
export function counter(carrier: CarrierRow, settings: AgentSettings, load: Load, amount: number, toName?: string, how: { final?: boolean; held?: boolean; split?: boolean; reason?: string; answer?: string } = { final: true }) {
  const where = `on ${load.referenceNumber} (${lane(load)})`;
  const line = how.split
    ? `We're close. Let's meet in the middle at ${money(amount)} all in ${where}.`
    : how.held
      ? `I hear you, but we're staying at ${money(amount)} all in ${where}.`
      : how.final
        ? `The best we can do ${where} is ${money(amount)} all in.`
        : `Thanks for coming back to us. We can come down to ${money(amount)} all in ${where}.`;
  const close = how.final || how.split ? `If you can do ${money(amount)}, send the rate con and we'll book it right now.` : "If that works, send the rate con and we'll dispatch right away.";
  return `${hello(toName)}

${line}${how.reason ? ` ${how.reason}` : ""}
${how.answer ? `\n${how.answer}\n` : ""}
${close}

Thanks,
${signature(carrier, settings)}`;
}

export function accept(carrier: CarrierRow, settings: AgentSettings, load: Load, amount: number, toName?: string, answer?: string) {
  return `${hello(toName)}

${money(amount)} all in works for us on ${load.referenceNumber} (${lane(load)}). ${termsLine(settings)}
${answer ? `\n${answer}\n` : ""}
Send the rate con here and we'll dispatch the truck.

Thanks,
${signature(carrier, settings)}`;
}

/** The broker agreed to our number: thanks, and send the rate con. */
export function agreed(carrier: CarrierRow, settings: AgentSettings, load: Load, amount: number, toName?: string) {
  return `${hello(toName)}

Sounds good, thanks: ${money(amount)} all in on ${load.referenceNumber} (${lane(load)}). ${termsLine(settings)}

Send the rate con here and we'll get the truck rolling.

Thanks,
${signature(carrier, settings)}`;
}

/** The broker cancelled before the truck was on its way: no charge, no hard feelings. */
export function cancelledAck(carrier: CarrierRow, settings: AgentSettings, load: Load, toName?: string) {
  return `${hello(toName)}

Got it, thanks for letting us know. We've taken ${load.referenceNumber} (${lane(load)}) off our truck.

Keep us in mind for the next one.

Thanks,
${signature(carrier, settings)}`;
}

/** None of the loads they sent fit a truck: say so, and what we do run. */
export function noFit(carrier: CarrierRow, settings: AgentSettings, run: { equipment: string[]; around: string[] }, toName?: string) {
  const list = (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}` : (xs[0] ?? ""));
  return `${hello(toName)}

Thanks for these. None of them fit our trucks today.${run.equipment.length ? ` We run ${list(run.equipment)}${run.around.length ? ` around ${list(run.around)}` : ""}.` : ""}

Keep them coming.

Thanks,
${signature(carrier, settings)}`;
}

/** A quick "got it" while someone looks at an email the AI can't answer itself. */
export function holding(carrier: CarrierRow, settings: AgentSettings, about: string | null, toName?: string) {
  return `${hello(toName)}

Thanks, got your email${about ? ` about ${about}` : ""}. We'll get back to you shortly.

Thanks,
${signature(carrier, settings)}`;
}

/** Their rate con matched and the load is booked: who's coming and when. */
export function rateConThanks(carrier: CarrierRow, settings: AgentSettings, load: Load, who: { unit?: string; driver?: string }, toName?: string, signed = false) {
  return `${hello(toName)}

Got the rate con for ${load.referenceNumber}, thanks. It matches${signed ? ", and the signed copy is attached" : ""}.${who.unit ? ` Truck ${who.unit}${who.driver ? ` with ${who.driver}` : ""} is set for pickup ${when(load.pickupWindow)}.` : ""}

Thanks,
${signature(carrier, settings)}`;
}

/** Their rate con doesn't match what was agreed: what's off, and ask for a corrected one. */
export function rateConFix(carrier: CarrierRow, settings: AgentSettings, load: Load, problems: string[], toName?: string) {
  return `${hello(toName)}

Thanks for the rate con on ${load.referenceNumber}. A few things don't match what we agreed:
${problems.map((p) => `- ${p}`).join("\n")}

Can you send a corrected one? We'll dispatch as soon as it's fixed.

Thanks,
${signature(carrier, settings)}`;
}

/** Walking away, politely, with the door left open. */
export function pass(carrier: CarrierRow, settings: AgentSettings, load: Load, ours: number, theirs: number, toName?: string) {
  return `${hello(toName)}

Thanks for working with us on ${load.referenceNumber}. We can't make ${money(theirs)} work; ${money(ours)} all in is as low as we can go on ${lane(load)}.

If anything changes, reply here and we'll jump on it.

Thanks,
${signature(carrier, settings)}`;
}

export function phoneBooked(carrier: CarrierRow, settings: AgentSettings, load: Load, amount: number, papers: string[], toName?: string) {
  return `${hello(toName)}

Confirming what we agreed on the phone: load ${load.referenceNumber}, ${lane(load)}, picking up ${when(load.pickupWindow)}, at ${money(amount)} all in. ${termsLine(settings)}

Please send the rate confirmation to this address and we'll dispatch.${papers.length ? ` Our carrier packet is attached: ${papers.join(", ")}.` : ""}

Thanks,
${signature(carrier, settings)}`;
}

export function setupPacket(carrier: CarrierRow, settings: AgentSettings, papers: string[], toName?: string) {
  return `${hello(toName)}

Attached for your carrier setup: ${papers.join(", ")}.${settings.setupProfiles?.length ? `\n\nOur setup profiles:\n${settings.setupProfiles.map((p) => `${p.name}: ${p.url}`).join("\n")}` : ""}${settings.businessAddress ? `\n\nOur address: ${settings.businessAddress}` : ""}${settings.remitEmail ? `\nBilling and remittance: ${settings.remitEmail}` : ""}

Let us know if you need anything else to get us set up.

Thanks,
${signature(carrier, settings)}`;
}

export function invoiceEmail(carrier: CarrierRow, settings: AgentSettings, load: Load, number: string, amount: number, factoring: boolean, lines: { label: string; amount: number }[] = [], toName?: string) {
  const tonu = load.stage === "cancelled";
  return `${hello(toName)}

Attached ${tonu ? `is invoice ${number} for the truck ordered, not used on load ${load.referenceNumber}` : `are invoice ${number} and the signed proof of delivery for load ${load.referenceNumber}`}, ${lane(load)}.
${lines.length > 1 ? `
${lines.map((l) => `${l.label}: ${money(l.amount)}`).join("\n")}
` : ""}
Amount due: ${money(amount)}.${factoring ? "\n\nThis invoice is assigned to our factoring company. Please pay according to the notice of assignment on file." : settings.remitEmail ? `\n\nQuestions about payment: ${settings.remitEmail}` : ""}

Thanks,
${signature(carrier, settings)}`;
}

export interface DetentionFacts {
  stop: "pickup" | "delivery";
  arrived: string;
  left: string;
  minutes: number;
  freeHours: number;
  perHour: number;
  amount: number;
}

export function detentionEmail(carrier: CarrierRow, settings: AgentSettings, load: Load, f: DetentionFacts, toName?: string) {
  const place = f.stop === "pickup" ? `${load.lane.origin}, ${load.lane.originState}` : `${load.lane.destination}, ${load.lane.destState}`;
  const hours = (m: number) => `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
  const billable = f.minutes - f.freeHours * 60;
  return `${hello(toName)}

Our truck had detention at ${f.stop} on load ${load.referenceNumber} (${place}):

Arrived: ${f.arrived}
${f.stop === "pickup" ? "Loaded and out" : "Unloaded and out"}: ${f.left}
On site: ${hours(f.minutes)}, with ${f.freeHours} hours free, so ${hours(billable)} billable at ${money(f.perHour)}/hour: ${money(f.amount)}.

The times are from our driver's app. Please approve ${money(f.amount)} in detention for this load, and add it to the rate confirmation or tell us how you'd like it billed.

Thanks,
${signature(carrier, settings)}`;
}

export function paymentReminder(carrier: CarrierRow, settings: AgentSettings, load: Load, invoice: { number: string; amount: number; sentAt?: string }, daysLate: number, second: boolean) {
  return `Hi,

${second ? "Following up again on" : "A friendly reminder about"} invoice ${invoice.number} for load ${load.referenceNumber} (${lane(load)}), ${money(invoice.amount)}${invoice.sentAt ? `, sent ${invoice.sentAt.slice(0, 10)}` : ""}. It's ${daysLate} day${daysLate === 1 ? "" : "s"} past the payment terms.

Could you let us know when it's scheduled to pay? If anything is missing on your side, reply and we'll send it right away.${settings.remitEmail ? `\n\nRemittance: ${settings.remitEmail}` : ""}

Thanks,
${signature(carrier, settings)}`;
}

export function tonuClaim(carrier: CarrierRow, settings: AgentSettings, load: Load, amount: number) {
  return `Hi,

Load ${load.referenceNumber} (${lane(load)}) was cancelled after our truck was dispatched to it. We're requesting truck ordered not used (TONU) of ${money(amount)}.

Please confirm, and add it to a rate confirmation or tell us how you'd like it invoiced.

Thanks,
${signature(carrier, settings)}`;
}

export function etaUpdate(carrier: CarrierRow, settings: AgentSettings, load: Load, stop: "pickup" | "delivery", place: string, eta: string) {
  return `Hi,

Heads up on load ${load.referenceNumber}: our truck is running behind for the ${stop} in ${place}. Its current ETA is ${eta}, from its live location and the driver's hours.

We'll keep you posted if that changes. Let us know if the ${stop === "pickup" ? "shipper" : "receiver"} needs a new appointment.

Thanks,
${signature(carrier, settings)}`;
}

export function capacity(carrier: CarrierRow, settings: AgentSettings, t: { equipment: string; city: string; state: string; when: string; toward?: string }, toName?: string) {
  return `${hello(toName)}

We'll have a ${t.equipment.toLowerCase()} empty in ${t.city}, ${t.state} ${t.when}${t.toward ? `, and we'd like to head toward ${t.toward}` : ""}. If you have anything out of that area, send it over with the rate and we'll answer quickly.

Thanks,
${signature(carrier, settings)}`;
}

export function breakdownNotice(carrier: CarrierRow, settings: AgentSettings, load: Load, where: string) {
  return `Hi,

Our truck on load ${load.referenceNumber} (${lane(load)}) broke down near ${where}. We're getting it repaired now and will send a new ETA as soon as the shop gives us one.

If the appointment needs to move, or you'd rather recover the load, let us know here.

Thanks,
${signature(carrier, settings)}`;
}

export function checkCall(carrier: CarrierRow, settings: AgentSettings, load: Load, u: { status: string; where: string; at: string; eta: string | null }) {
  return `Check call for load ${load.referenceNumber} (${lane(load)}):

${u.status}. Truck location: ${u.where} (GPS, ${u.at}).${u.eta ? `\nETA: ${u.eta}.` : ""}

We'll send the next update in about 4 hours, or right away if anything changes.

${signature(carrier, settings)}`;
}
