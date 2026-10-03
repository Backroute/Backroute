import { dbConfigured } from "@/lib/agent/db";
import { finishConnect, quickbooksConfigured, readState } from "@/lib/agent/quickbooks";

/**
 * Intuit sends the owner back here after they let Backroute into their QuickBooks company. The signed state says
 * which carrier asked (and expires in 15 minutes); the code is traded for the company's sign-in, kept encrypted.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const back = (result: string) => Response.redirect(new URL(`/carrier/settings?tab=general&quickbooks=${result}`, process.env.PUBLIC_BASE_URL ?? url.origin), 303);
  if (!dbConfigured() || !quickbooksConfigured()) return back("off");
  const who = readState(url.searchParams.get("state") ?? "");
  const code = url.searchParams.get("code");
  const realmId = url.searchParams.get("realmId");
  if (!who) return back("expired");
  if (url.searchParams.get("error") || !code || !realmId || !/^\d{1,30}$/.test(realmId)) return back("cancelled");
  try {
    await finishConnect(who.carrierId, code, realmId);
    return back("connected");
  } catch (e) {
    console.error("[quickbooks] connect failed", e);
    return back("failed");
  }
}
