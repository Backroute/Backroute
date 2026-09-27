import "server-only";
import { admin, dbConfigured } from "../agent/db";
import { currentCarrier } from "../agent/scope";

/**
 * Counts every AI call's tokens against the carrier it was for (lib/agent/scope), per month, for Backroute's own view
 * of what each carrier costs to run (/api/support/costs). Never slows or fails the call: the count is fire-and-forget.
 */
export const meteredFetch: typeof fetch = async (input, init) => {
  const res = await fetch(input, init);
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (res.ok && /\/v1\/messages(\?|$)/.test(url) && (res.headers.get("content-type") ?? "").includes("json") && dbConfigured()) {
    const carrier = currentCarrier() ?? "unattributed";
    res
      .clone()
      .json()
      .then((body: { usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number } }) => {
        const u = body.usage;
        if (!u) return;
        const input = (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
        return admin().rpc("add_usage", { p_carrier: carrier, p_month: new Date().toISOString().slice(0, 7), p_input: input, p_output: u.output_tokens ?? 0 });
      })
      .catch(() => {});
  }
  return res;
};
