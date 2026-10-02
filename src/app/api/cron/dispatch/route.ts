import { admin, dbConfigured, loadContext } from "@/lib/agent/db";
import { releaseDue } from "@/lib/agent/held";
import { runRounds } from "@/lib/agent/rounds";
import { flagStuck } from "@/lib/agent/stuck";
import { retryOutbound } from "@/lib/channels/out";
import { publicUrl } from "@/lib/channels/twilio";
import { alertOnHealth, beat } from "@/lib/health";

export const maxDuration = 300;

/**
 * The AI dispatcher's rounds, every few minutes, for every carrier (lib/agent/rounds), after sending again anything
 * a provider outage held up. Needs a scheduler that runs more than once a day (see DEPLOY.md). It sends CRON_SECRET
 * as a bearer token.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) return new Response("Unauthorized", { status: 401 });
  if (!dbConfigured()) return Response.json({ done: [], reason: "not_set_up" });

  const now = Date.now();
  const done: string[] = [];
  await beat("cron_dispatch");
  try {
    const retried = await retryOutbound(now);
    if (retried.sent) done.push(`${retried.sent} held-up message${retried.sent === 1 ? "" : "s"} sent`);
    if (retried.gaveUp.length) done.push(`${retried.gaveUp.length} message${retried.gaveUp.length === 1 ? "" : "s"} too old to send`);
    done.push(...(await flagStuck(retried.gaveUp, now)));
    // Emails the AI held for the owner's Undo whose short wait was cut off.
    const released = await releaseDue(now);
    if (released) done.push(`${released} held email${released === 1 ? "" : "s"} sent`);
  } catch (e) {
    console.error("[cron] retrying messages failed", e);
  }

  const { data: carriers, error } = await admin().from("carriers").select("id");
  if (error) return Response.json({ error: error.message, done }, { status: 500 });
  const base = publicUrl(request, "");
  for (const { id } of carriers ?? []) {
    try {
      const ctx = await loadContext(id);
      if (ctx) done.push(...(await runRounds(ctx, now, ctx.settings.sandbox ? null : base)));
    } catch (e) {
      console.error("[cron] dispatch rounds failed for", id, e);
    }
  }
  // Anything down (or AI spending running away) goes to support's phones.
  done.push(...(await alertOnHealth(now).catch((e) => (console.error("[cron] health check failed", e), []))));
  return Response.json({ done });
}
