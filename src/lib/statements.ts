import type { PdfLine } from "./pdf";
import type { FuelTx, Load, PayRun, TollTx } from "./types";

/**
 * The papers made from what's already in the app, as PDF lines (lib/pdf): a driver's weekly pay statement, and a trip
 * report for a delivered load. English, since they're business records (and the PDF fonts are Latin-only).
 */

const money = (n: number) => `${n < 0 ? "-" : ""}$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const day = (iso: string) => new Date(`${iso.slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const when = (iso?: string) => (iso ? new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "-");
/** Text on the left, amount at the right margin (Helvetica 10pt is about 5.6pt a character). */
const row = (left: string, right: string, opts: { bold?: boolean; gap?: number } = {}): PdfLine[] => [
  { text: left, size: 10, bold: opts.bold, gap: opts.gap },
  { text: right, size: 10, bold: opts.bold, x: 556 - right.length * 5.6, gap: -13.5 },
];

export function payStatementLines(run: PayRun, driverName: string, company: { name: string; mc?: string }): PdfLine[] {
  const deductions = run.deductions.reduce((s, d) => s + d.amount, 0) + run.advances.reduce((s, a) => s + a.amount, 0) + run.escrow;
  return [
    { text: company.name, size: 16, bold: true },
    ...(company.mc ? [{ text: `MC ${company.mc}`, size: 9 }] : []),
    { text: "Driver pay statement", size: 13, bold: true, gap: 14 },
    { text: `${driverName} · week of ${day(run.period)} to ${day(run.periodEnd)}`, size: 10 },
    { text: run.status === "paid" ? `Paid${run.paidAt ? ` ${when(run.paidAt)}` : ""}` : "Not paid yet", size: 10 },
    { text: "Loads", size: 11, bold: true, gap: 12 },
    ...run.lines.flatMap((l) => row(`${l.ref} · ${l.lane}`, money(l.pay))),
    ...(run.extras.length ? [{ text: "Added", size: 11, bold: true, gap: 8 }, ...run.extras.flatMap((x) => row(x.label, money(x.amount)))] : []),
    ...row("Gross pay", money(run.gross), { bold: true, gap: 8 }),
    ...(deductions
      ? [
          { text: "Taken out", size: 11, bold: true, gap: 8 },
          ...run.deductions.flatMap((d) => row(d.label, money(-d.amount))),
          ...(run.advances.length ? row("Advances paid back", money(-run.advances.reduce((s, a) => s + a.amount, 0))) : []),
          ...(run.escrow ? row("Escrow held", money(-run.escrow)) : []),
        ]
      : []),
    ...row("Net pay", money(run.net), { bold: true, gap: 10 }),
    { text: "Questions about this statement? Message the office in the app.", size: 8, gap: 20 },
  ];
}

export interface TripReport {
  rows: { section: string; label: string; value: string }[];
  revenue: number;
  costs: number;
}

/** What happened on a delivered load, from its own record: times at each dock, papers, weights, and what it made. */
export function tripReport(load: Load, ctx: { truck?: string; driver?: string; broker?: string; fuel: FuelTx[]; tolls: TollTx[]; lumpers: number }): TripReport {
  const t = load.tripChecklist ?? {};
  const mins = (a?: string, b?: string) => (a && b ? Math.max(0, Math.round((Date.parse(b) - Date.parse(a)) / 60000)) : null);
  const dwell = (m: number | null) => (m === null ? "-" : `${Math.floor(m / 60)} h ${m % 60} min`);
  const rate = load.invoice?.amount ?? load.bookedRate ?? load.targetRate;
  const fuel = ctx.fuel.filter((f) => f.loadId === load.id);
  const tolls = ctx.tolls.filter((x) => x.loadId === load.id);
  const fuelCost = fuel.length ? fuel.reduce((s, f) => s + f.amount, 0) : load.fuelCost;
  const tollCost = tolls.length ? tolls.reduce((s, x) => s + x.amount, 0) : load.tollCost;
  const costs = fuelCost + tollCost + ctx.lumpers;
  const has = (type: string) => load.documents.some((d) => d.type === type && d.status !== "failed");
  const rows: TripReport["rows"] = [
    { section: "Load", label: "Load", value: `${load.referenceNumber} · ${load.lane.origin}, ${load.lane.originState} to ${load.lane.destination}, ${load.lane.destState}` },
    { section: "Load", label: "Broker", value: ctx.broker ?? "-" },
    { section: "Load", label: "Truck and driver", value: [ctx.truck, ctx.driver].filter(Boolean).join(" · ") || "-" },
    { section: "Load", label: "Miles", value: `${load.lane.miles} loaded${load.deadheadMiles ? `, ${load.deadheadMiles} empty` : ""}` },
    { section: "Load", label: "Trailer", value: [t.trailerNumber, t.droppedTrailer ? `left ${t.droppedTrailer}` : ""].filter(Boolean).join(" · ") || "-" },
    { section: "Load", label: "Seal", value: t.sealNumber ?? "-" },
    { section: "Pickup", label: "Appointment", value: when(load.pickupAt) },
    { section: "Pickup", label: "Arrived", value: when(t.arrivedPickupAt) },
    { section: "Pickup", label: "Loaded", value: when(t.loadedAt) },
    { section: "Pickup", label: "Left", value: when(t.leftPickupAt) },
    { section: "Pickup", label: "At the dock", value: dwell(mins(t.arrivedPickupAt, t.leftPickupAt ?? t.loadedAt)) },
    { section: "Delivery", label: "Appointment", value: when(load.deliveryAt) },
    { section: "Delivery", label: "Arrived", value: when(t.arrivedDeliveryAt) },
    { section: "Delivery", label: "Unloaded", value: when(t.unloadedAt) },
    { section: "Delivery", label: "At the dock", value: dwell(mins(t.arrivedDeliveryAt, t.leftDeliveryAt ?? t.unloadedAt)) },
    { section: "Papers", label: "Rate con, BOL, POD", value: [has("rate_confirmation") || load.rateConReading ? "rate con" : "", has("bol") ? "BOL" : "", has("pod") ? "POD" : ""].filter(Boolean).join(", ") || "none yet" },
    { section: "Papers", label: "Load photo, scale", value: [has("pickup_photo") ? "photo" : "", t.scale ? `${t.scale.gross.toLocaleString()} lbs gross` : ""].filter(Boolean).join(", ") || "-" },
    ...(load.detentionClaims ?? []).map((d) => ({ section: "Money", label: `Detention at ${d.stop}`, value: `${Math.round(d.minutes / 60 * 10) / 10} h · ${money(d.amount)}` })),
    { section: "Money", label: load.invoice ? `Invoice ${load.invoice.number}` : "Rate", value: money(rate) },
    { section: "Money", label: fuel.length ? `Fuel (${fuel.length} purchase${fuel.length === 1 ? "" : "s"})` : "Fuel (estimate)", value: money(-fuelCost) },
    { section: "Money", label: tolls.length ? "Tolls" : "Tolls (estimate)", value: money(-tollCost) },
    ...(ctx.lumpers ? [{ section: "Money", label: "Lumpers paid", value: money(-ctx.lumpers) }] : []),
    { section: "Money", label: "Left before driver pay and fixed costs", value: money(rate - costs) },
  ];
  return { rows, revenue: rate, costs };
}

export function tripReportLines(load: Load, report: TripReport, company: string): PdfLine[] {
  const out: PdfLine[] = [
    { text: company, size: 16, bold: true },
    { text: `Trip report · ${load.referenceNumber}`, size: 13, bold: true, gap: 10 },
  ];
  let section = "";
  for (const r of report.rows) {
    if (r.section !== section) {
      section = r.section;
      out.push({ text: section, size: 11, bold: true, gap: 10 });
    }
    out.push(...row(r.label, r.value));
  }
  return out;
}

/** Saves PDF lines as a file on the device. */
export async function downloadPdf(name: string, lines: PdfLine[]) {
  const { pdfBytes } = await import("./pdf");
  const blob = new Blob([pdfBytes(lines) as BlobPart], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
