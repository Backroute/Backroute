/**
 * Carrier authority lookup for sign-up, against FMCSA's QCMobile API (see lib/fmcsa-lookup). Without FMCSA_WEB_KEY it
 * says so plainly (`source: "demo"`) and the app falls back to the demo fleet, rather than pretending a lookup happened.
 */

import type { FmcsaResult } from "@/lib/fmcsa";
import { lookupMc } from "@/lib/fmcsa-lookup";

export async function GET(_request: Request, { params }: { params: Promise<{ mc: string }> }) {
  const { mc } = await params;
  const docket = mc.replace(/^MC-?/i, "");
  const r = await lookupMc(docket);
  if (!r.ok) {
    if (r.reason === "bad_number") return Response.json({ source: "error", message: "An MC number is up to 8 digits." } satisfies FmcsaResult, { status: 400 });
    if (r.reason === "no_key") return Response.json({ source: "demo", message: "No FMCSA web key configured, so this is the demo fleet." } satisfies FmcsaResult);
    return Response.json({ source: "error", message: "Couldn't reach FMCSA. Try again in a minute." } satisfies FmcsaResult, { status: 502 });
  }
  if (!r.record) return Response.json({ source: "fmcsa", found: false, message: `FMCSA has no carrier with MC ${docket}.` } satisfies FmcsaResult);
  const c = r.record;
  return Response.json({
    source: "fmcsa",
    found: true,
    legalName: c.legalName,
    dbaName: c.dbaName,
    dotNumber: c.dotNumber,
    allowedToOperate: c.allowedToOperate,
    city: c.city,
    state: c.state,
    liabilityOnFile: c.liabilityOnFile,
  } satisfies FmcsaResult);
}
