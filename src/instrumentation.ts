import type { Instrumentation } from "next";

/**
 * Server errors (pages, API routes, server actions) are counted in app_errors, for the System tab and the alerts
 * (lib/error-log). They're still logged as before.
 */
export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { recordError } = await import("./lib/error-log");
  const e = err instanceof Error ? err : new Error(String(err));
  await recordError({
    source: "server",
    message: `${e.message}${context.routeType ? ` (${context.routeType})` : ""}`,
    path: request.path,
    digest: typeof err === "object" && err && "digest" in err ? String((err as { digest: unknown }).digest) : null,
    stack: e.stack ?? null,
  });
};
