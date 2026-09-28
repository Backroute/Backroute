import { admin, dbConfigured, loadContext, logChannel } from "@/lib/agent/db";
import { canText, textTo } from "@/lib/channels/out";
import { pack } from "@/lib/lang";
import { formatCurrency } from "@/lib/utils";
import { syncTruckCounts } from "@/lib/billing";

export const maxDuration = 300;

/**
 * Every evening: the owner's end-of-day text. What got delivered today, what it made, how many trucks are still
 * rolling, and how many things need them. Run by Vercel Cron, which sends the CRON_SECRET as a bearer token.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) return new Response("Unauthorized", { status: 401 });
  if (!dbConfigured()) return Response.json({ sent: 0, reason: "not_set_up" });

  const { data: carriers, error } = await admin().from("carriers").select("id").not("owner_phone", "is", null);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  let sent = 0;
  for (const { id } of carriers ?? []) {
    try {
      const ctx = await loadContext(id);
      if (!ctx?.carrier.owner_phone || ctx.settings.dailyText === false || !canText(ctx.carrier)) continue;
      const today = new Date().toDateString();
      const delivered = ctx.loads.filter((l) => l.stage === "delivered" && new Date(l.updatedAt).toDateString() === today);
      const rolling = ctx.trucks.filter((t) => ctx.loads.some((l) => l.id === t.currentLoadId && (l.stage === "in_transit" || l.stage === "dispatched"))).length;
      const asks = ctx.escalations.filter((e) => e.status === "open").map((e) => e.reason.split(". ")[0]);
      const text = pack(ctx.settings.ownerLanguage ?? "en").daily({
        carrier: ctx.carrier.name,
        weekday: new Date().getDay(),
        delivered: delivered.length,
        profit: formatCurrency(delivered.reduce((s, l) => s + (l.netProfit ?? 0), 0)),
        rolling,
        asks: asks.length,
        firstAsk: asks[0],
      });
      const sid = await textTo(ctx.carrier, ctx.carrier.owner_phone.startsWith("+") ? ctx.carrier.owner_phone : `+${ctx.carrier.owner_phone}`, text);
      await logChannel({ carrierId: id, channel: "sms", direction: "out", providerId: sid ?? null, counterparty: ctx.carrier.owner_phone, body: text, data: { kind: "daily" } });
      sent++;
    } catch (e) {
      console.error("[cron] daily text failed for", id, e);
    }
  }
  // Each subscription bills the trucks the carrier has now.
  const billing = await syncTruckCounts().catch((e) => (console.error("[cron] billing sync failed", e), [] as string[]));
  // Old rate-limit counters are no use after a day.
  await admin().from("rate_limits").delete().lt("window_start", new Date(Date.now() - 86400_000).toISOString());
  return Response.json({ sent, billing });
}
