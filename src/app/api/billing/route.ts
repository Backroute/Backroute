import { z } from "zod";
import { admin, dbConfigured } from "@/lib/agent/db";
import { caller } from "@/lib/agent/user";
import { billingConfigured, billingFor, billingHold, billingPortal, invoicesFor, startCheckout, truckCount } from "@/lib/billing";
import { publicUrl } from "@/lib/channels/twilio";

const Body = z.object({ op: z.enum(["checkout", "portal"]) });

/** The carrier's subscription as the office sees it: status, trucks billed, invoices. */
export async function GET(request: Request) {
  if (!dbConfigured()) return Response.json({ error: "not_set_up" }, { status: 503 });
  const who = await caller(request);
  if (!who || who.me.role === "driver") return Response.json({ error: "sign_in" }, { status: 401 });
  if (!billingConfigured()) return Response.json({ configured: false });
  const id = who.me.carrierId;
  const [b, trucks, hold, invoices] = await Promise.all([billingFor(id), truckCount(id), billingHold(id), invoicesFor(id).catch(() => [])]);
  return Response.json({
    configured: true,
    status: b?.status ?? "none",
    trucks,
    billedTrucks: b?.trucks ?? 0,
    trialEnd: b?.trial_end ?? null,
    periodEnd: b?.current_period_end ?? null,
    cancelAt: b?.data?.cancelAt ?? null,
    pastDueSince: b?.past_due_since ?? null,
    hold,
    trialDays: Number(process.env.BILLING_TRIAL_DAYS ?? 14) || 0,
    pricePerTruck: Number(process.env.BILLING_PRICE_LABEL ?? 0) || null,
    invoices,
  });
}

/** Start the subscription (Stripe's checkout page) or manage it (Stripe's billing page). The owner only. */
export async function POST(request: Request) {
  if (!dbConfigured()) return Response.json({ error: "not_set_up" }, { status: 503 });
  const who = await caller(request);
  if (!who || who.me.role !== "owner") return Response.json({ error: "owner_only" }, { status: 403 });
  if (!billingConfigured()) return Response.json({ error: "billing_off" }, { status: 503 });
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "bad_request" }, { status: 400 });
  const back = publicUrl(request, "/carrier/settings");
  if (parsed.data.op === "portal") {
    const url = await billingPortal(who.me.carrierId, back);
    return url ? Response.json({ url }) : Response.json({ error: "no_subscription" }, { status: 409 });
  }
  const b = await billingFor(who.me.carrierId);
  if (b && ["active", "trialing", "past_due"].includes(b.status)) return Response.json({ error: "already_subscribed" }, { status: 409 });
  const { data: c } = await admin().from("carriers").select("id, name, settings").eq("id", who.me.carrierId).single();
  const email = (c?.settings as { remitEmail?: string } | null)?.remitEmail ?? null;
  return Response.json({ url: await startCheckout({ id: who.me.carrierId, name: c?.name ?? "Carrier", email }, back) });
}
