import { z } from "zod";
import { dbConfigured, loadContext } from "@/lib/agent/db";
import { textNewLoad } from "@/lib/agent/booking";
import { asUser } from "@/lib/agent/user";
import { canText } from "@/lib/channels/out";
import { toE164 } from "@/lib/cloud/phone";

const Body = z.object({ loadId: z.string().min(1) });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * The owner just added a load: text the driver the essentials in their language (lib/agent/booking textNewLoad). The
 * browser saves the load a moment after it's added, so this waits briefly for it to arrive.
 */
export async function POST(request: Request) {
  const user = asUser(request);
  if (!user || !dbConfigured()) return Response.json({ sent: false, reason: "sign_in" }, { status: 401 });
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ sent: false, reason: "bad_request" }, { status: 400 });

  // Read as the owner: the access rules only show loads to their own carrier's office.
  let carrierId: string | null = null;
  for (let i = 0; i < 6 && !carrierId; i++) {
    const { data } = await user.from("loads").select("carrier_id").eq("id", parsed.data.loadId).maybeSingle();
    carrierId = (data?.carrier_id as string | undefined) ?? null;
    if (!carrierId) await sleep(1500);
  }
  if (!carrierId) return Response.json({ sent: false, reason: "not_found" }, { status: 404 });

  const ctx = await loadContext(carrierId);
  const load = ctx?.loads.find((l) => l.id === parsed.data.loadId);
  const truck = ctx?.trucks.find((t) => t.id === load?.truckId);
  const driver = ctx?.drivers.find((d) => d.id === truck?.driverId);
  const to = driver ? toE164(driver.phone) : null;
  if (!ctx || !load || !driver || !to) return Response.json({ sent: false, reason: "no_driver" });
  if (!canText(ctx.carrier)) return Response.json({ sent: false, reason: "sms_off" });
  if (driver.prefs?.smsOptOut) return Response.json({ sent: false, reason: "opted_out" });

  // The same text the AI sends when it books a load: the essentials, slow docks, the reefer setting and dock tips.
  const sent = await textNewLoad(ctx, load);
  if (!sent) return Response.json({ sent: false, reason: "not_sent" });
  return Response.json({ sent: true });
}
