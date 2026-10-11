import { z } from "zod";
import { admin, carrierById, dbConfigured } from "@/lib/agent/db";
import { readShareToken, shareToken } from "@/lib/agent/share-link";
import { caller } from "@/lib/agent/user";
import { clientIp, overLimit, tooMany } from "@/lib/rate-limit";
import { trackView } from "@/lib/track-view";
import type { Load, Truck } from "@/lib/types";

/**
 * A load's tracking page for its broker or shipper, no sign-in: POST (the office) makes the link, GET ?t= reads it.
 * The page shows the town the truck is near and when it should arrive, never the exact spot, the driver or money.
 */
const DAY = 86400_000;

export async function POST(request: Request) {
  if (!dbConfigured()) return Response.json({ error: "not_set_up" }, { status: 503 });
  const who = await caller(request);
  if (!who || who.me.role === "driver") return Response.json({ error: "sign_in" }, { status: 401 });
  const body = z.object({ loadId: z.string().min(1).max(80) }).safeParse(await request.json().catch(() => null));
  if (!body.success) return Response.json({ error: "bad_request" }, { status: 400 });
  const { data } = await admin().from("loads").select("id").eq("carrier_id", who.me.carrierId).eq("id", body.data.loadId).maybeSingle();
  if (!data) return Response.json({ error: "not_found" }, { status: 404 });
  const base = (process.env.PUBLIC_BASE_URL ?? new URL(request.url).origin).replace(/\/$/, "");
  return Response.json({ url: `${base}/track/${shareToken("track", who.me.carrierId, body.data.loadId, Date.now() + 21 * DAY)}` });
}

export async function GET(request: Request) {
  if (!dbConfigured()) return Response.json({ error: "not_set_up" }, { status: 503 });
  if (await overLimit(`track:${clientIp(request)}`, 600, 120)) return tooMany();
  const link = readShareToken(new URL(request.url).searchParams.get("t") ?? "", "track");
  if (!link) return Response.json({ error: "expired" }, { status: 404 });
  const { data } = await admin().from("loads").select("data").eq("carrier_id", link.carrierId).eq("id", link.id).maybeSingle();
  const load = data?.data as Load | undefined;
  if (!load) return Response.json({ error: "expired" }, { status: 404 });
  const truck = load.truckId ? ((await admin().from("trucks").select("data").eq("carrier_id", link.carrierId).eq("id", load.truckId).maybeSingle()).data?.data as Truck | undefined) : undefined;
  const carrier = await carrierById(link.carrierId);
  const view = trackView(load, truck, carrier?.name ?? "The carrier", Date.now());
  if (!view) return Response.json({ error: "expired" }, { status: 404 });
  return Response.json(view, { headers: { "cache-control": "no-store" } });
}
