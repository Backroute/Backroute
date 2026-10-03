import { z } from "zod";
import { alertsAt } from "@/lib/weather";
import { clientIp, overLimit, tooMany } from "@/lib/rate-limit";

/**
 * Weather along a driver's route, from the National Weather Service (US) and Environment Canada: active warnings and advisories at points every
 * ~100 miles of the leg ahead. The app sends the points (no load or driver details); a few lookups per minute per phone.
 */
const Points = z.array(z.tuple([z.number().min(15).max(72), z.number().min(-170).max(-50)])).min(1).max(6);

export async function GET(request: Request) {
  if (await overLimit(`weather:${clientIp(request)}`, 60, 10)) return tooMany();
  const raw = new URL(request.url).searchParams.get("pts") ?? "";
  const parsed = Points.safeParse(raw.split(";").filter(Boolean).map((p) => p.split(",").map(Number)));
  if (!parsed.success) return Response.json({ error: "bad_request" }, { status: 400 });
  const results = await Promise.all(parsed.data.map(async ([lat, lon], i) => ({ i, lat, lon, alerts: await alertsAt(lat, lon) })));
  return Response.json({ points: results }, { headers: { "cache-control": "private, max-age=600" } });
}
