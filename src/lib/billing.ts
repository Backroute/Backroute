import "server-only";
import crypto from "node:crypto";
import { admin, claimMark, loadContext, type CarrierContext } from "./agent/db";
import { tellOwner } from "./agent/dispatcher";

/**
 * What carriers pay Backroute: a monthly subscription per truck, through Stripe. The owner starts it (with a free
 * trial) from Settings → Billing and manages the card and invoices in Stripe's own billing page. Stripe tells the app
 * how it stands through signed webhooks, which are the only thing that writes a carrier's billing status. The
 * number of trucks is kept in step every day.
 *
 * With BILLING_REQUIRED on, a carrier whose trial ended with no subscription, whose card has failed for longer than
 * the grace period, or who cancelled, gets no new loads booked by the AI (loads already booked still run, and the
 * owner is told once). Without it, billing is only shown.
 */

export const billingConfigured = () => Boolean(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_PRICE_PER_TRUCK);
const base = () => (process.env.STRIPE_API_BASE ?? "https://api.stripe.com").replace(/\/$/, "");
const trialDays = () => Math.max(0, Number(process.env.BILLING_TRIAL_DAYS ?? 14) || 0);
const graceDays = () => Math.max(0, Number(process.env.BILLING_GRACE_DAYS ?? 7) || 0);

/** Stripe's form encoding: nested objects and arrays as a[b][0]=c. */
function encode(params: Record<string, unknown>, prefix = ""): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (Array.isArray(v)) v.forEach((item, i) => (typeof item === "object" ? out.push(...encode(item as Record<string, unknown>, `${key}[${i}]`)) : out.push(`${encodeURIComponent(`${key}[${i}]`)}=${encodeURIComponent(String(item))}`)));
    else if (typeof v === "object") out.push(...encode(v as Record<string, unknown>, key));
    else out.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(v))}`);
  }
  return out;
}

async function stripe<T = Record<string, unknown>>(method: "GET" | "POST" | "DELETE", path: string, params: Record<string, unknown> = {}, idempotencyKey?: string): Promise<T> {
  const body = encode(params).join("&");
  const url = `${base()}/v1/${path}${method === "GET" && body ? `?${body}` : ""}`;
  const res = await fetch(url, {
    method,
    headers: {
      authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
      "content-type": "application/x-www-form-urlencoded",
      "stripe-version": "2024-06-20",
      ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}),
    },
    body: method === "GET" ? undefined : body,
    signal: AbortSignal.timeout(20_000),
  });
  const json = (await res.json().catch(() => ({}))) as T & { error?: { message?: string } };
  if (!res.ok) throw new Error(`Stripe ${res.status}: ${json.error?.message ?? "error"}`);
  return json;
}

/** Stripe's signature on a webhook (the Stripe-Signature header), checked against the raw body. */
export function verifyWebhook(raw: string, header: string | null, secret: string, now = Date.now(), toleranceSec = 300): boolean {
  if (!header) return false;
  const parts = Object.fromEntries(header.split(",").map((p) => p.split("=") as [string, string]));
  const t = Number(parts.t);
  const sigs = header
    .split(",")
    .filter((p) => p.startsWith("v1="))
    .map((p) => p.slice(3));
  if (!t || !sigs.length || Math.abs(now / 1000 - t) > toleranceSec) return false;
  const expected = crypto.createHmac("sha256", secret).update(`${t}.${raw}`).digest("hex");
  return sigs.some((s) => s.length === expected.length && crypto.timingSafeEqual(Buffer.from(s), Buffer.from(expected)));
}

// ─── A carrier's billing ─────────────────────────────────────────────────────

type BillingStatus = "none" | "trialing" | "active" | "past_due" | "unpaid" | "canceled" | "incomplete";
interface Billing {
  carrier_id: string;
  customer_id: string | null;
  subscription_id: string | null;
  status: BillingStatus;
  trucks: number;
  current_period_end: string | null;
  trial_end: string | null;
  past_due_since: string | null;
  data: { itemId?: string; cancelAt?: string | null; lastInvoice?: string; lastEvent?: string };
}

export async function billingFor(carrierId: string): Promise<Billing | null> {
  const { data } = await admin().from("carrier_billing").select("*").eq("carrier_id", carrierId).maybeSingle();
  return (data as Billing | null) ?? null;
}

async function saveBilling(carrierId: string, patch: Partial<Billing>) {
  const { error } = await admin()
    .from("carrier_billing")
    .upsert({ carrier_id: carrierId, ...patch, updated_at: new Date().toISOString() }, { onConflict: "carrier_id" });
  if (error) throw error;
}

/** Trucks billed: every truck the carrier has on Backroute (at least one). */
export async function truckCount(carrierId: string): Promise<number> {
  const { count } = await admin().from("trucks").select("id", { head: true, count: "exact" }).eq("carrier_id", carrierId);
  return Math.max(1, count ?? 0);
}

/**
 * Why this carrier's AI shouldn't take new loads right now, or null. Only with BILLING_REQUIRED on (and Stripe set
 * up): a trial over with no subscription, a failed card past the grace days, or a cancelled subscription.
 */
export async function billingHold(carrierId: string, now = Date.now()): Promise<string | null> {
  if (process.env.BILLING_REQUIRED !== "1" || !billingConfigured()) return null;
  const b = await billingFor(carrierId);
  const status = b?.status ?? "none";
  if (status === "active" || status === "trialing") return null;
  if (status === "past_due" && b?.past_due_since && now - Date.parse(b.past_due_since) < graceDays() * 86400_000) return null;
  if (status === "none" || status === "incomplete") {
    const { data } = await admin().from("carriers").select("created_at").eq("id", carrierId).maybeSingle();
    const since = data?.created_at ? Date.parse(data.created_at as string) : now;
    if (now - since < trialDays() * 86400_000) return null;
    return "the free trial is over and there's no subscription yet";
  }
  if (status === "past_due") return "the card on file has been failing for over a week";
  return status === "canceled" ? "the subscription was cancelled" : "the last invoices weren't paid";
}

/**
 * Before the AI asks to book a load: held when billing says so. The owner hears once a day, with how to fix it.
 * Loads already booked are never touched.
 */
export async function holdForBilling(ctx: CarrierContext, loadId: string, now = Date.now()): Promise<boolean> {
  const why = await billingHold(ctx.carrier.id, now).catch(() => null);
  if (!why) return false;
  if (await claimMark(ctx.carrier.id, `carrier:${ctx.carrier.id}`, `billing_hold:${new Date(now).toISOString().slice(0, 10)}`))
    await tellOwner(ctx, { reason: `Backroute isn't booking new loads because ${why}. Loads already booked keep running. Open Settings → Billing & Team to start or fix the subscription.`, loadId, label: "Got it", source: "app", severity: "warning" });
  return true;
}

// ─── Starting and managing it ────────────────────────────────────────────────

/** A Stripe customer for the carrier, made once. */
async function customerFor(ctx: { id: string; name: string; email?: string | null }): Promise<string> {
  const b = await billingFor(ctx.id);
  if (b?.customer_id) return b.customer_id;
  const c = await stripe<{ id: string }>("POST", "customers", { name: ctx.name, email: ctx.email ?? undefined, metadata: { carrier_id: ctx.id } }, `customer-${ctx.id}`);
  await saveBilling(ctx.id, { customer_id: c.id });
  return c.id;
}

/** Stripe's checkout page for the subscription: one line, a truck each, with the trial. Returns its address. */
export async function startCheckout(carrier: { id: string; name: string; email?: string | null }, returnUrl: string): Promise<string> {
  const customer = await customerFor(carrier);
  const trucks = await truckCount(carrier.id);
  const trial = trialDays();
  // Days of trial already used since sign-up count against it.
  const { data } = await admin().from("carriers").select("created_at").eq("id", carrier.id).maybeSingle();
  const used = data?.created_at ? Math.floor((Date.now() - Date.parse(data.created_at as string)) / 86400_000) : 0;
  const left = Math.max(0, trial - used);
  const session = await stripe<{ url: string }>("POST", "checkout/sessions", {
    mode: "subscription",
    customer,
    line_items: [{ price: process.env.STRIPE_PRICE_PER_TRUCK, quantity: trucks }],
    subscription_data: { ...(left > 0 ? { trial_period_days: left } : {}), metadata: { carrier_id: carrier.id } },
    client_reference_id: carrier.id,
    allow_promotion_codes: true,
    success_url: `${returnUrl}?billing=started`,
    cancel_url: `${returnUrl}?billing=cancelled`,
  });
  return session.url;
}

/** Ends the subscription now, for an account being deleted. Nothing to do without one, or once it's cancelled. */
export async function cancelSubscription(carrierId: string) {
  const b = await billingFor(carrierId);
  if (!b?.subscription_id || b.status === "canceled") return;
  if (!process.env.STRIPE_SECRET_KEY) throw new Error("Stripe isn't set up, so the subscription can't be cancelled");
  try {
    await stripe("DELETE", `subscriptions/${b.subscription_id}`);
  } catch (e) {
    // Already gone at Stripe: nothing left to cancel.
    if (!/Stripe 404/.test(String(e))) throw e;
  }
}

/** Stripe's billing page, where the owner changes the card, sees invoices, or cancels. */
export async function billingPortal(carrierId: string, returnUrl: string): Promise<string | null> {
  const b = await billingFor(carrierId);
  if (!b?.customer_id) return null;
  const s = await stripe<{ url: string }>("POST", "billing_portal/sessions", { customer: b.customer_id, return_url: returnUrl });
  return s.url;
}

interface InvoiceLine {
  id: string;
  number: string | null;
  amount: number;
  status: string;
  created: string;
  url: string | null;
  pdf: string | null;
}

export async function invoicesFor(carrierId: string): Promise<InvoiceLine[]> {
  const b = await billingFor(carrierId);
  if (!b?.customer_id) return [];
  const list = await stripe<{ data: { id: string; number: string | null; amount_due: number; status: string; created: number; hosted_invoice_url: string | null; invoice_pdf: string | null }[] }>("GET", "invoices", { customer: b.customer_id, limit: 12 });
  return list.data.map((i) => ({ id: i.id, number: i.number, amount: i.amount_due / 100, status: i.status, created: new Date(i.created * 1000).toISOString(), url: i.hosted_invoice_url, pdf: i.invoice_pdf }));
}

// ─── What Stripe tells us ────────────────────────────────────────────────────

interface Subscription {
  id: string;
  customer: string;
  status: BillingStatus | "incomplete_expired" | "paused";
  current_period_end?: number;
  trial_end?: number | null;
  cancel_at?: number | null;
  metadata?: { carrier_id?: string };
  items?: { data: { id: string; quantity?: number }[] };
}

async function carrierForCustomer(customer: string, hint?: string): Promise<string | null> {
  if (hint) return hint;
  const { data } = await admin().from("carrier_billing").select("carrier_id").eq("customer_id", customer).maybeSingle();
  return (data?.carrier_id as string | undefined) ?? null;
}

/** A webhook event from Stripe (already verified): the carrier's status follows it. */
export async function applyStripeEvent(event: { id: string; type: string; data: { object: Record<string, unknown> } }): Promise<string> {
  const o = event.data.object;
  if (event.type.startsWith("customer.subscription.")) {
    const s = o as unknown as Subscription;
    const carrierId = await carrierForCustomer(s.customer, s.metadata?.carrier_id);
    if (!carrierId) return "unknown customer";
    const before = await billingFor(carrierId);
    const status: BillingStatus = event.type === "customer.subscription.deleted" ? "canceled" : s.status === "incomplete_expired" ? "canceled" : s.status === "paused" ? "unpaid" : s.status;
    await saveBilling(carrierId, {
      customer_id: s.customer,
      subscription_id: s.id,
      status,
      trucks: s.items?.data[0]?.quantity ?? before?.trucks ?? 0,
      current_period_end: s.current_period_end ? new Date(s.current_period_end * 1000).toISOString() : null,
      trial_end: s.trial_end ? new Date(s.trial_end * 1000).toISOString() : null,
      past_due_since: status === "past_due" ? (before?.past_due_since ?? new Date().toISOString()) : null,
      data: { ...(before?.data ?? {}), itemId: s.items?.data[0]?.id ?? before?.data.itemId, cancelAt: s.cancel_at ? new Date(s.cancel_at * 1000).toISOString() : null, lastEvent: event.id },
    });
    return `${carrierId}: ${status}`;
  }
  if (event.type === "checkout.session.completed") {
    const carrierId = (o.client_reference_id as string | undefined) ?? (await carrierForCustomer(String(o.customer)));
    if (!carrierId) return "unknown customer";
    await saveBilling(carrierId, { customer_id: String(o.customer), ...(o.subscription ? { subscription_id: String(o.subscription) } : {}) });
    return `${carrierId}: checkout done`;
  }
  if (event.type === "invoice.payment_failed" || event.type === "invoice.paid") {
    const carrierId = await carrierForCustomer(String(o.customer));
    if (!carrierId) return "unknown customer";
    const before = await billingFor(carrierId);
    if (event.type === "invoice.paid") await saveBilling(carrierId, { status: before?.status === "past_due" || before?.status === "unpaid" ? "active" : (before?.status ?? "active"), past_due_since: null, data: { ...(before?.data ?? {}), lastInvoice: String(o.id) } });
    else {
      await saveBilling(carrierId, { status: "past_due", past_due_since: before?.past_due_since ?? new Date().toISOString(), data: { ...(before?.data ?? {}), lastInvoice: String(o.id) } });
      // The owner hears the card failed, the first time.
      const ctx = await loadContext(carrierId);
      if (ctx && (await claimMark(carrierId, `carrier:${carrierId}`, `card_failed:${String(o.id)}`)))
        await tellOwner(ctx, { reason: `Backroute couldn't charge your card for this month. Update it in Settings → Billing & Team; Backroute keeps working for ${graceDays()} days while you do.`, label: "Got it", source: "app", severity: "warning" });
    }
    return `${carrierId}: ${event.type}`;
  }
  return "ignored";
}

/** Every day: each subscription's truck count follows the trucks on Backroute (Stripe prorates the change). */
export async function syncTruckCounts(): Promise<string[]> {
  if (!billingConfigured()) return [];
  const done: string[] = [];
  const { data } = await admin().from("carrier_billing").select("*").in("status", ["trialing", "active", "past_due"]);
  for (const b of (data ?? []) as Billing[]) {
    if (!b.data?.itemId) continue;
    const trucks = await truckCount(b.carrier_id);
    if (trucks === b.trucks) continue;
    try {
      await stripe("POST", `subscription_items/${b.data.itemId}`, { quantity: trucks, proration_behavior: "create_prorations" });
      await saveBilling(b.carrier_id, { trucks });
      done.push(`${b.carrier_id}: ${b.trucks} → ${trucks} trucks`);
    } catch (e) {
      console.error("[billing] couldn't update trucks for", b.carrier_id, e);
    }
  }
  return done;
}
