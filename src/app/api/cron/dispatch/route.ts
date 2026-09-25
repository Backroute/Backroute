import { admin, dbConfigured, loadContext, marksFor } from "@/lib/agent/db";
import { runCheckins } from "@/lib/agent/checkins";
import { expireOffers, sendDetentionClaims, sendInvoices, warnCoiExpiring } from "@/lib/agent/paperwork";
import { emailConfigured } from "@/lib/channels/email";
import { chasePayments } from "@/lib/agent/money";
import { followUpByPhone } from "@/lib/agent/broker-call";
import { applyEld, lateNotices, readEld } from "@/lib/agent/eld";
import { pullFeed, readFeed } from "@/lib/agent/feeds";
import { integrationsFor, setStatus, type EldConfig, type FeedConfig } from "@/lib/agent/integrations";
import { publicUrl, twilioConfigured } from "@/lib/channels/twilio";

export const maxDuration = 300;

/**
 * The AI dispatcher's rounds, every few minutes: check-ins with drivers and following up when they go quiet,
 * invoices once the POD is in, detention claims, payment reminders, calling brokers who didn't answer, reading the
 * ELD and load feeds, telling brokers early when a truck will be late, and clearing old offers off the board.
 * Needs a scheduler that runs more than once a day (see DEPLOY.md). It sends CRON_SECRET as a bearer token.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) return new Response("Unauthorized", { status: 401 });
  if (!dbConfigured()) return Response.json({ done: [], reason: "not_set_up" });

  const { data: carriers, error } = await admin().from("carriers").select("id");
  if (error) return Response.json({ error: error.message }, { status: 500 });
  const now = Date.now();
  const callUrl = (loadId: string, kind: string) => publicUrl(request, `/api/channels/voice/checkin?load=${encodeURIComponent(loadId)}&kind=${kind}`);
  const done: string[] = [];
  for (const { id } of carriers ?? []) {
    try {
      const ctx = await loadContext(id);
      if (!ctx) continue;
      if (twilioConfigured()) {
        done.push(...(await runCheckins(ctx, await marksFor(id), now, callUrl)));
        done.push(...(await followUpByPhone(ctx, now, (loadId) => publicUrl(request, `/api/channels/voice/broker?carrier=${encodeURIComponent(id)}&load=${encodeURIComponent(loadId)}`))));
      }
      if (emailConfigured()) {
        done.push(...(await sendInvoices(ctx)));
        done.push(...(await sendDetentionClaims(ctx, now)));
        done.push(...(await chasePayments(ctx, now)));
      }
      // Connections: the ELD (where trucks are, drivers' hours) and load feeds.
      for (const link of await integrationsFor(id)) {
        try {
          if (link.kind === "load_feed") {
            const cfg = link.config as FeedConfig;
            const added = await pullFeed(ctx, await readFeed(cfg), cfg.name ?? "Load feed");
            if (added) done.push(`${added} load${added === 1 ? "" : "s"} from ${cfg.name ?? "the load feed"}`);
            await setStatus(id, "load_feed", `Connected · last read ${new Date(now).toISOString().slice(11, 16)} UTC`);
          } else {
            const applied = await applyEld(ctx, link.kind, await readEld(link.kind, (link.config as EldConfig).apiKey));
            await setStatus(id, link.kind, `Connected · ${applied.trucks} trucks, ${applied.drivers} drivers updated`);
          }
        } catch (e) {
          await setStatus(id, link.kind, `Not working: ${e instanceof Error ? e.message : "error"}`);
        }
      }
      if (emailConfigured()) done.push(...(await lateNotices(ctx, now)));
      const expired = await expireOffers(ctx, now);
      if (expired) done.push(`${expired} old offer${expired === 1 ? "" : "s"} taken off the board`);
      await warnCoiExpiring(ctx, now);
    } catch (e) {
      console.error("[cron] dispatch rounds failed for", id, e);
    }
  }
  return Response.json({ done });
}
