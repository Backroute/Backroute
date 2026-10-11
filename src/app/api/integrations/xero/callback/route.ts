import { dbConfigured } from "@/lib/agent/db";
import { finishXero, readXeroState, xeroConfigured } from "@/lib/agent/xero";

/** Xero sends the owner back here; the signed state says which carrier asked and which account codes to use. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const back = (result: string) => Response.redirect(new URL(`/carrier/settings?tab=integrations&open=xero&xero=${result}`, process.env.PUBLIC_BASE_URL ?? url.origin), 303);
  if (!dbConfigured() || !xeroConfigured()) return back("off");
  const who = readXeroState(url.searchParams.get("state") ?? "");
  const code = url.searchParams.get("code");
  if (!who) return back("expired");
  if (url.searchParams.get("error") || !code) return back("cancelled");
  try {
    await finishXero(who.carrierId, code, { sales: who.sales, bank: who.bank });
    return back("connected");
  } catch (e) {
    console.error("[xero] connect failed", e);
    return back("failed");
  }
}
