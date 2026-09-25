import { z } from "zod";
import { dbConfigured, loadContext, logChannel, saveDriverMessage } from "@/lib/agent/db";
import { uid } from "@/lib/agent/dispatcher";
import { asUser } from "@/lib/agent/user";
import { NEW_LOAD } from "@/lib/channels/phrases";
import { sendSms, twilioConfigured } from "@/lib/channels/twilio";
import { toE164 } from "@/lib/cloud/phone";

const Body = z.object({ loadId: z.string().min(1) });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * The owner just added a load: text the driver the essentials in their language. The browser saves the load a
 * moment after it's added, so this waits briefly for it to arrive.
 */
export async function POST(request: Request) {
  const user = asUser(request);
  if (!user || !dbConfigured()) return Response.json({ sent: false, reason: "sign_in" }, { status: 401 });
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ sent: false, reason: "bad_request" }, { status: 400 });
  if (!twilioConfigured()) return Response.json({ sent: false, reason: "sms_off" });

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
  if (driver.prefs?.smsOptOut) return Response.json({ sent: false, reason: "opted_out" });

  const text = NEW_LOAD[driver.prefs?.language ?? "en"]({
    ref: load.referenceNumber,
    from: `${load.lane.origin}, ${load.lane.originState}`,
    to: `${load.lane.destination}, ${load.lane.destState}`,
    pickup: load.pickupWindow,
    delivery: load.deliveryWindow,
  });
  const sid = await sendSms(to, text);
  await saveDriverMessage(carrierId, { id: uid("dm"), driverId: driver.id, from: "ai", content: text, timestamp: new Date().toISOString(), channel: "sms" });
  await logChannel({ carrierId, channel: "sms", direction: "out", providerId: sid ?? null, driverId: driver.id, counterparty: to, body: text, data: { kind: "new_load", loadId: load.id } });
  return Response.json({ sent: true });
}
