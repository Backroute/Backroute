import { admin, dbConfigured, loadContext, marksFor } from "@/lib/agent/db";
import { runCheckins } from "@/lib/agent/checkins";
import { expireOffers, sendDetentionClaims, sendInvoices, warnCoiExpiring } from "@/lib/agent/paperwork";
import { emailConfigured } from "@/lib/channels/email";
import { publicUrl, twilioConfigured } from "@/lib/channels/twilio";

export const maxDuration = 300;

/**
 * The AI dispatcher's rounds, every few minutes: check-ins with drivers and following up when they go quiet,
 * invoices once the POD is in, detention claims, and clearing old offers off the board.
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
      if (twilioConfigured()) done.push(...(await runCheckins(ctx, await marksFor(id), now, callUrl)));
      if (emailConfigured()) {
        done.push(...(await sendInvoices(ctx)));
        done.push(...(await sendDetentionClaims(ctx, now)));
      }
      const expired = await expireOffers(ctx, now);
      if (expired) done.push(`${expired} old offer${expired === 1 ? "" : "s"} taken off the board`);
      await warnCoiExpiring(ctx, now);
    } catch (e) {
      console.error("[cron] dispatch rounds failed for", id, e);
    }
  }
  return Response.json({ done });
}
