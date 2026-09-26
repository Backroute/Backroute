import { dbConfigured, loadContext } from "@/lib/agent/db";
import { caller } from "@/lib/agent/user";
import { termsDays } from "@/lib/agent/money";

/**
 * Downloads for the office, as CSV:
 * - kind=invoices: every invoice in the period, in the columns QuickBooks Online's invoice import expects, one row
 *   per charge (line haul, detention, lumper, TONU).
 * - kind=settlements: what each driver earned per load in the period (by their pay type), before deductions.
 * ?from=YYYY-MM-DD&to=YYYY-MM-DD (default: the last 7 days).
 */

const cell = (v: string | number | null | undefined) => {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const csv = (rows: (string | number | null | undefined)[][]) => rows.map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";

export async function GET(request: Request) {
  if (!dbConfigured()) return Response.json({ error: "not_set_up" }, { status: 503 });
  const who = await caller(request);
  if (!who || who.me.role === "driver") return Response.json({ error: "sign_in" }, { status: 401 });
  const url = new URL(request.url);
  const kind = url.searchParams.get("kind");
  const to = url.searchParams.get("to") ?? new Date().toISOString().slice(0, 10);
  const from = url.searchParams.get("from") ?? new Date(Date.parse(to) - 7 * 86400_000).toISOString().slice(0, 10);
  const inRange = (iso?: string) => !!iso && iso.slice(0, 10) >= from && iso.slice(0, 10) <= to;
  const ctx = await loadContext(who.me.carrierId);
  if (!ctx) return Response.json({ error: "not_found" }, { status: 404 });
  const broker = (id: string) => ctx.brokers.find((b) => b.id === id);

  let body: string;
  if (kind === "invoices") {
    const rows: (string | number | null)[][] = [["InvoiceNo", "Customer", "InvoiceDate", "DueDate", "Terms", "ItemDescription", "ItemAmount", "LoadNumber", "Paid"]];
    for (const l of ctx.loads) {
      const inv = l.invoice;
      if (!inv || !inRange(inv.sentAt ?? inv.draftedAt)) continue;
      const date = (inv.sentAt ?? inv.draftedAt).slice(0, 10);
      const days = termsDays(l.rateConReading?.paymentTerms);
      const due = new Date(Date.parse(date) + days * 86400_000).toISOString().slice(0, 10);
      for (const line of inv.lines ?? [{ label: "Line haul, all in", amount: inv.amount }])
        rows.push([inv.number, broker(l.brokerId)?.company ?? "Broker", date, due, `Net ${days}`, `${line.label} · ${l.lane.origin}, ${l.lane.originState} to ${l.lane.destination}, ${l.lane.destState}`, line.amount.toFixed(2), l.referenceNumber, inv.paidAt ? "yes" : "no"]);
    }
    body = csv(rows);
  } else if (kind === "settlements") {
    const rows: (string | number | null)[][] = [["Driver", "PayType", "Rate", "LoadNumber", "Delivered", "Lane", "Miles", "LoadRevenue", "DriverPay"]];
    for (const l of ctx.loads) {
      if (l.stage !== "delivered" || !inRange(l.updatedAt)) continue;
      const truck = ctx.trucks.find((t) => t.id === l.truckId);
      const d = ctx.drivers.find((x) => x.id === truck?.driverId);
      if (!d) continue;
      const revenue = l.bookedRate ?? l.targetRate;
      const pay = d.payType === "per_mile" ? l.lane.miles * d.payRate : d.payType === "percentage" ? (revenue * d.payRate) / 100 : d.payType === "per_move" ? d.payRate : null;
      rows.push([d.name, d.payType, d.payRate, l.referenceNumber, l.updatedAt.slice(0, 10), `${l.lane.origin}, ${l.lane.originState} to ${l.lane.destination}, ${l.lane.destState}`, l.lane.miles, revenue.toFixed(2), pay === null ? "hours needed" : pay.toFixed(2)]);
    }
    body = csv(rows);
  } else return Response.json({ error: "bad_request" }, { status: 400 });

  return new Response(body, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${kind}-${from}-to-${to}.csv"` } });
}
