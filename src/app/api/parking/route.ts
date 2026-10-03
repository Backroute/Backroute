import { z } from "zod";
import { dbConfigured, loadContext } from "@/lib/agent/db";
import { caller } from "@/lib/agent/user";
import { cancelParking, parkingConfigured, parkingSpots, reserveParking, whereToPark } from "@/lib/agent/parking";
import { overLimit, tooMany } from "@/lib/rate-limit";

/**
 * Truck parking the driver (or the owner) reserves from the app: spots near where the truck stops for the night, and
 * booking one they tapped. Nothing here runs unless a person asks; the AI never books on its own.
 */

async function who(request: Request, truckId: string | null) {
  const c = await caller(request);
  if (!c) return { error: Response.json({ error: "sign_in" }, { status: 401 }) };
  if (c.me.role === "bookkeeper") return { error: Response.json({ error: "not_allowed" }, { status: 403 }) };
  const ctx = await loadContext(c.me.carrierId);
  if (!ctx) return { error: Response.json({ error: "not_found" }, { status: 404 }) };
  // A driver books for their own truck only; the owner (or their dispatcher) for any truck in the fleet.
  const truck = c.me.role === "driver" ? ctx.trucks.find((t) => t.driverId === c.me.driverId || t.secondDriverId === c.me.driverId) : ctx.trucks.find((t) => t.id === truckId);
  if (!truck) return { error: Response.json({ error: "no_truck" }, { status: 404 }) };
  return { c, ctx, truck };
}

export async function GET(request: Request) {
  if (!dbConfigured()) return Response.json({ error: "not_set_up" }, { status: 503 });
  if (!parkingConfigured()) return Response.json({ error: "parking_off" }, { status: 503 });
  const w = await who(request, new URL(request.url).searchParams.get("truck"));
  if ("error" in w) return w.error;
  if (await overLimit(`parking:${w.c.me.userId}`, 30, 60)) return tooMany();
  const driver = w.ctx.drivers.find((d) => d.id === w.truck.driverId);
  const where = whereToPark(w.truck, driver, w.ctx.loads);
  if (!where) return Response.json({ spots: [], where: null, booked: w.truck.parking ?? null });
  const spots = await parkingSpots(where.at, where.arrive).catch(() => null);
  if (!spots) return Response.json({ error: "parking_down" }, { status: 502 });
  return Response.json({ spots, where: where.note, arrive: new Date(where.arrive).toISOString(), booked: w.truck.parking?.status === "booked" ? w.truck.parking : null });
}

const Body = z.object({ spotId: z.string().min(1).max(100), truck: z.string().max(100).optional() });

export async function POST(request: Request) {
  if (!dbConfigured()) return Response.json({ error: "not_set_up" }, { status: 503 });
  if (!parkingConfigured()) return Response.json({ error: "parking_off" }, { status: 503 });
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "bad_request" }, { status: 400 });
  const w = await who(request, parsed.data.truck ?? null);
  if ("error" in w) return w.error;
  if (await overLimit(`parking-book:${w.c.me.userId}`, 5, 3600)) return tooMany();
  if (w.truck.parking?.status === "booked" && Date.parse(w.truck.parking.arriveAt) > Date.now() - 12 * 3600_000) return Response.json({ error: "already_booked", booked: w.truck.parking }, { status: 409 });
  const driver = w.ctx.drivers.find((d) => d.id === w.truck.driverId);
  const where = whereToPark(w.truck, driver, w.ctx.loads);
  if (!where) return Response.json({ error: "no_location" }, { status: 409 });
  // The spot must still be one the service offers there: the price and place come from it, not from the phone.
  const spot = (await parkingSpots(where.at, where.arrive).catch(() => [])).find((s) => s.id === parsed.data.spotId);
  if (!spot) return Response.json({ error: "gone" }, { status: 409 });
  const byOwner = w.c.me.role !== "driver";
  try {
    const booked = await reserveParking(w.ctx, w.truck, spot, where.arrive, byOwner ? "owner" : "driver", byOwner);
    return Response.json({ booked });
  } catch (e) {
    console.error("[parking] reserve failed", e);
    return Response.json({ error: "parking_down" }, { status: 502 });
  }
}

export async function DELETE(request: Request) {
  if (!dbConfigured()) return Response.json({ error: "not_set_up" }, { status: 503 });
  const w = await who(request, new URL(request.url).searchParams.get("truck"));
  if ("error" in w) return w.error;
  const ok = await cancelParking(w.ctx, w.truck, w.c.me.role === "driver" ? "driver" : "owner").catch(() => false);
  return ok ? Response.json({ ok: true }) : Response.json({ error: "nothing_booked" }, { status: 409 });
}
