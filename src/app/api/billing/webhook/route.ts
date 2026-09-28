import { dbConfigured } from "@/lib/agent/db";
import { applyStripeEvent, verifyWebhook } from "@/lib/billing";

/**
 * Stripe's messages about subscriptions and invoices. Only messages signed with STRIPE_WEBHOOK_SECRET are taken:
 * this is the one place a carrier's billing status is written.
 */
export async function POST(request: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!dbConfigured() || !secret) return Response.json({ error: "not_set_up" }, { status: 503 });
  const raw = await request.text();
  if (!verifyWebhook(raw, request.headers.get("stripe-signature"), secret)) return Response.json({ error: "bad_signature" }, { status: 400 });
  let event: { id: string; type: string; data: { object: Record<string, unknown> } };
  try {
    event = JSON.parse(raw);
  } catch {
    return Response.json({ error: "bad_request" }, { status: 400 });
  }
  try {
    return Response.json({ ok: true, result: await applyStripeEvent(event) });
  } catch (e) {
    console.error("[billing] webhook failed", event.type, e);
    // Stripe tries again.
    return Response.json({ error: "failed" }, { status: 500 });
  }
}
