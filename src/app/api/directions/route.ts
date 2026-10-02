import { z } from "zod";
import { dbConfigured } from "@/lib/agent/db";
import { caller } from "@/lib/agent/user";
import { geocodeAddress, routingConfigured, truckPath } from "@/lib/agent/routing";
import { overLimit, tooMany } from "@/lib/rate-limit";

/**
 * For the driver's screen, signed in: a dock's street address to its exact spot (so the truck GPS app goes to the
 * dock, not the middle of the city), and the road a truck of this size takes there, for the map. Truck routing only
 * (HERE, truck mode); without it the app says so and draws no road.
 */
const Coord = z.tuple([z.number().min(15).max(72), z.number().min(-170).max(-50)]);
const Query = z.union([
  z.object({ address: z.string().trim().min(5).max(200) }),
  z.object({ from: Coord, to: Coord, height: z.number().int().min(96).max(180), weight: z.number().int().min(10000).max(200000), length: z.number().int().min(20).max(120) }),
]);

const pair = (v: string | null) => (v ? v.split(",").map(Number) : undefined);

export async function GET(request: Request) {
  if (!dbConfigured()) return Response.json({ error: "not_set_up" }, { status: 503 });
  const who = await caller(request);
  if (!who) return Response.json({ error: "sign_in" }, { status: 401 });
  if (!routingConfigured()) return Response.json({ error: "routing_off" }, { status: 503 });
  if (await overLimit(`directions:${who.me.userId}`, 120, 60)) return tooMany();
  const p = new URL(request.url).searchParams;
  const parsed = Query.safeParse(
    p.get("address") ? { address: p.get("address") } : { from: pair(p.get("from")), to: pair(p.get("to")), height: Number(p.get("height")), weight: Number(p.get("weight")), length: Number(p.get("length")) },
  );
  if (!parsed.success) return Response.json({ error: "bad_request" }, { status: 400 });
  const q = parsed.data;
  if ("address" in q) {
    const at = await geocodeAddress(q.address);
    return Response.json({ at: at ? [at.lat, at.lon] : null }, { headers: { "cache-control": "private, max-age=86400" } });
  }
  const path = await truckPath({ lat: q.from[0], lon: q.from[1] }, { lat: q.to[0], lon: q.to[1] }, { heightIn: q.height, weightLbs: q.weight, lengthFt: q.length });
  return Response.json({ path }, { headers: { "cache-control": "private, max-age=3600" } });
}
