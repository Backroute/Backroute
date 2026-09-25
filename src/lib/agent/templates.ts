import type { CarrierRow } from "./db";
import type { AgentSettings } from "../store";
import type { Load } from "../types";

/**
 * The dispatcher's standard emails. They're written from templates, not by the AI, so the price in each one is
 * exactly the number the rules picked (lib/agent/pricing) and nothing else.
 */

const money = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
const lane = (l: Load) => `${l.lane.origin}, ${l.lane.originState} to ${l.lane.destination}, ${l.lane.destState}`;
const hello = (name?: string) => `Hi${name ? ` ${name.split(/[\s@]/)[0]}` : ""},`;

function signature(carrier: CarrierRow, settings: Pick<AgentSettings, "remitEmail">) {
  return [`${carrier.name}`, carrier.mc ? `MC ${carrier.mc}` : null, settings.remitEmail ?? null, "Sent by our AI dispatcher"].filter(Boolean).join("\n");
}

export const subjectFor = (l: Load, what?: string) => `${what ? `${what}: ` : ""}Load ${l.referenceNumber} · ${l.lane.origin}, ${l.lane.originState} → ${l.lane.destination}, ${l.lane.destState}`;

export function bookRequest(carrier: CarrierRow, settings: AgentSettings, load: Load, ask: number, toName?: string) {
  return `${hello(toName)}

We'd like to book load ${load.referenceNumber}, ${lane(load)}, picking up ${load.pickupWindow}. We have a ${load.equipmentType.toLowerCase()} ready for it.

Our rate is ${money(ask)} all in. If that works, please send the rate confirmation to this address and we'll dispatch.

Thanks,
${signature(carrier, settings)}`;
}

export function counter(carrier: CarrierRow, settings: AgentSettings, load: Load, amount: number, toName?: string) {
  return `${hello(toName)}

Thanks for getting back to us. The best we can do on ${load.referenceNumber} (${lane(load)}) is ${money(amount)} all in. If that works, send the rate confirmation and we'll dispatch right away.

Thanks,
${signature(carrier, settings)}`;
}

export function accept(carrier: CarrierRow, settings: AgentSettings, load: Load, amount: number, toName?: string) {
  return `${hello(toName)}

${money(amount)} all in works for us on ${load.referenceNumber} (${lane(load)}). Please send the rate confirmation to this address and we'll dispatch the truck.

Thanks,
${signature(carrier, settings)}`;
}

export function setupPacket(carrier: CarrierRow, settings: AgentSettings, papers: string[], toName?: string) {
  return `${hello(toName)}

Attached for your carrier setup: ${papers.join(", ")}.${settings.businessAddress ? `\n\nOur address: ${settings.businessAddress}` : ""}${settings.remitEmail ? `\nBilling and remittance: ${settings.remitEmail}` : ""}

Let us know if you need anything else to get us set up.

Thanks,
${signature(carrier, settings)}`;
}

export function invoiceEmail(carrier: CarrierRow, settings: AgentSettings, load: Load, number: string, amount: number, factoring: boolean, toName?: string) {
  return `${hello(toName)}

Attached are invoice ${number} and the signed proof of delivery for load ${load.referenceNumber}, ${lane(load)}.

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
