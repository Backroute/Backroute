import { z } from "zod";
import { admin, dbConfigured, type CarrierRow } from "@/lib/agent/db";
import { sendAppLink } from "@/lib/agent/app-link";
import { caller } from "@/lib/agent/user";
import { absoluteUrl } from "@/lib/channels/twilio";
import { toE164 } from "@/lib/cloud/phone";
import type { Driver } from "@/lib/types";

const Body = z.object({ driverIds: z.array(z.string().min(1).max(100)).min(1).max(50) });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Lets drivers into the driver app, and texts each the link once: the owner adding drivers at sign-up or with a new
 * truck, or tapping "Let them sign in". The invite is written as the owner (the access rules say only an owner can);
 * the text goes through the usual path (lib/agent/app-link), so a driver's first text from dispatch still comes first,
 * a driver who texted STOP gets nothing, and in practice mode it waits until the carrier is live. The browser saves new
 * drivers a moment after they're added, so this waits briefly.
 */
export async function POST(request: Request) {
  const who = await caller(request);
  if (!who || !dbConfigured()) return Response.json({ error: "sign_in" }, { status: 401 });
  if (who.me.role !== "owner") return Response.json({ error: "owner_only" }, { status: 403 });
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "bad_request" }, { status: 400 });
  const carrierId = who.me.carrierId;

  let drivers: Driver[] = [];
  for (let i = 0; i < 6; i++) {
    const { data } = await who.db.from("drivers").select("data").eq("carrier_id", carrierId).in("id", parsed.data.driverIds);
    drivers = (data ?? []).map((r) => r.data as Driver);
    if (drivers.length === parsed.data.driverIds.length) break;
    await sleep(1500);
  }
  const { data: carrier } = await admin().from("carriers").select("id, name, owner_phone, settings").eq("id", carrierId).maybeSingle();
  if (!carrier) return Response.json({ error: "not_found" }, { status: 404 });
  const url = absoluteUrl("/login") ?? new URL("/login", request.url).toString();

  const results: { driverId: string; invited: boolean; texted: boolean; reason?: string }[] = [];
  for (const d of drivers) {
    const phone = toE164(d.phone);
    if (!phone) {
      results.push({ driverId: d.id, invited: false, texted: false, reason: "no_phone" });
      continue;
    }
    const { error } = await who.db.from("invites").upsert({ carrier_id: carrierId, phone, role: "driver", driver_id: d.id }, { onConflict: "carrier_id,phone" });
    if (error) {
      results.push({ driverId: d.id, invited: false, texted: false, reason: "invite_failed" });
      continue;
    }
    results.push({ driverId: d.id, invited: true, ...(await sendAppLink(carrier as CarrierRow, d, url)) });
  }
  for (const id of parsed.data.driverIds) if (!drivers.some((d) => d.id === id)) results.push({ driverId: id, invited: false, texted: false, reason: "not_found" });
  return Response.json({ results });
}
