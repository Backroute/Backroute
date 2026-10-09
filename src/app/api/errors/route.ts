import { z } from "zod";
import { recordError } from "@/lib/error-log";
import { hasBearer } from "@/lib/bearer";
import { clientIp, overLimit, tooMany } from "@/lib/rate-limit";

/**
 * An error in someone's browser (lib/report-error). Anyone can send one, so it's capped: 30 per address per ten
 * minutes, and only the message, stack and page path are kept, trimmed.
 */

const Body = z.object({
  message: z.string().min(1).max(2000),
  stack: z.string().max(8000).nullish(),
  path: z.string().max(500).nullish(),
  digest: z.string().max(200).nullish(),
});

export async function POST(request: Request) {
  if (await overLimit(`errors:${clientIp(request)}`, 600, 30)) return tooMany();
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "bad_request" }, { status: 400 });
  const { message, stack, path, digest } = parsed.data;
  await recordError({ source: "browser", message, stack: stack ?? null, path: path?.startsWith("/") ? path : null, digest: digest ?? null });
  return new Response(null, { status: 204 });
}

/** The outage drill's test crash (docs/runbook.md): proves server errors reach the System tab. Needs CRON_SECRET. */
export async function GET(request: Request) {
  if (!hasBearer(request, process.env.CRON_SECRET)) return new Response("Not found", { status: 404 });
  throw new Error("Test crash from /api/errors (the outage drill)");
}
