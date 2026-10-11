import { z } from "zod";
import { admin, carrierById, dbConfigured } from "@/lib/agent/db";
import { readShareToken, shareToken, stopped } from "@/lib/agent/share-link";
import { save } from "@/lib/agent/db";
import type { Item } from "@/lib/cloud/rows";
import { caller } from "@/lib/agent/user";
import { clientIp, overLimit, tooMany } from "@/lib/rate-limit";
import { trackView } from "@/lib/track-view";
import type { Broker, Load, Truck } from "@/lib/types";

/**
 * A direct shipper's own page, no sign-in: their loads with the carrier (moving now and the last 60 days), where each
 * is, the proof of delivery, and their invoices. POST (the office) makes the link for one customer; GET ?t= reads it.
 */
const DAY = 86400_000;

export async function POST(request: Request) {
  if (!dbConfigured()) return Response.json({ error: "not_set_up" }, { status: 503 });
  const who = await caller(request);
  if (!who || who.me.role === "driver") return Response.json({ error: "sign_in" }, { status: 401 });
  const body = z.object({ brokerId: z.string().min(1).max(80), stop: z.boolean().optional() }).safeParse(await request.json().catch(() => null));
  if (!body.success) return Response.json({ error: "bad_request" }, { status: 400 });
  const { data } = await admin().from("records").select("id, data").eq("carrier_id", who.me.carrierId).eq("kind", "broker").eq("id", body.data.brokerId).maybeSingle();
  if (!data) return Response.json({ error: "not_found" }, { status: 404 });
  if (body.data.stop) {
    await save("records", who.me.carrierId, { ...(data.data as Broker), shareOffAt: new Date().toISOString() } as unknown as Item, "broker");
    return Response.json({ ok: true });
  }
  const base = (process.env.PUBLIC_BASE_URL ?? new URL(request.url).origin).replace(/\/$/, "");
  return Response.json({ url: `${base}/shipper/${shareToken("shipper", who.me.carrierId, body.data.brokerId, Date.now() + 180 * DAY)}` });
}

export async function GET(request: Request) {
  if (!dbConfigured()) return Response.json({ error: "not_set_up" }, { status: 503 });
  if (await overLimit(`shipper:${clientIp(request)}`, 600, 120)) return tooMany();
  const link = readShareToken(new URL(request.url).searchParams.get("t") ?? "", "shipper");
  if (!link) return Response.json({ error: "expired" }, { status: 404 });
  const db = admin();
  const broker = (await db.from("records").select("data").eq("carrier_id", link.carrierId).eq("kind", "broker").eq("id", link.id).maybeSingle()).data?.data as Broker | undefined;
  if (!broker || stopped(link, broker.shareOffAt)) return Response.json({ error: "expired" }, { status: 404 });
  const since = new Date(Date.now() - 60 * DAY).toISOString();
  const { data: rows } = await db.from("loads").select("data").eq("carrier_id", link.carrierId).filter("data->>brokerId", "eq", link.id).gte("updated_at", since).order("updated_at", { ascending: false }).limit(100);
  const loads = (rows ?? []).map((r) => r.data as Load);
  const truckIds = [...new Set(loads.map((l) => l.truckId).filter((x): x is string => !!x))];
  const { data: trucks } = truckIds.length ? await db.from("trucks").select("id, data").eq("carrier_id", link.carrierId).in("id", truckIds) : { data: [] };
  const truckOf = (id: string | null) => (trucks ?? []).find((t) => t.id === id)?.data as Truck | undefined;
  const carrier = await carrierById(link.carrierId);
  const now = Date.now();
  return Response.json(
    {
      customer: broker.company,
      carrier: carrier?.name ?? "The carrier",
      mc: carrier?.mc ?? null,
      loads: loads
        .map((l) => {
          const view = trackView(l, truckOf(l.truckId), carrier?.name ?? "", now);
          if (!view) return null;
          // Their own invoice: what they're billed and whether it's paid. The carrier's costs and the driver stay out.
          const inv = l.invoice?.sentAt ? { number: l.invoice.number, amount: l.invoice.amount, sentAt: l.invoice.sentAt, paidAt: l.invoice.paidAt ?? null } : null;
          return { ...view, invoice: inv };
        })
        .filter(Boolean),
    },
    { headers: { "cache-control": "no-store" } },
  );
}
