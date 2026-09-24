/**
 * Carrier authority lookup against FMCSA's QCMobile API — the first integration that talks to a real system.
 *
 * Set FMCSA_WEB_KEY (free: register at mobile.fmcsa.dot.gov/QCDevsite) and sign-up checks the real MC number:
 * legal name, DOT number, whether the carrier is allowed to operate, and insurance on file. Without a key it says
 * so plainly (`source: "demo"`) and the app falls back to the demo fleet, rather than pretending a lookup happened.
 */

import type { FmcsaResult } from "@/lib/fmcsa";

const QC_BASE = "https://mobile.fmcsa.dot.gov/qc/services/carriers/docket-number";

/** FMCSA reports insurance amounts in thousands of dollars, as strings. */
const thousands = (v: unknown) => (typeof v === "string" || typeof v === "number") && Number(v) > 0 ? Number(v) * 1000 : undefined;

export async function GET(_request: Request, { params }: { params: Promise<{ mc: string }> }) {
  const { mc } = await params;
  const docket = mc.replace(/^MC-?/i, "");
  if (!/^\d{1,8}$/.test(docket)) {
    return Response.json({ source: "error", message: "An MC number is up to 8 digits." } satisfies FmcsaResult, { status: 400 });
  }

  const key = process.env.FMCSA_WEB_KEY;
  if (!key) {
    return Response.json({ source: "demo", message: "No FMCSA web key configured, so this is the demo fleet." } satisfies FmcsaResult);
  }

  try {
    const res = await fetch(`${QC_BASE}/${docket}?webKey=${encodeURIComponent(key)}`, { signal: AbortSignal.timeout(8000), cache: "no-store" });
    if (!res.ok) return Response.json({ source: "error", message: `FMCSA answered ${res.status}. Try again in a minute.` } satisfies FmcsaResult, { status: 502 });
    const body = (await res.json()) as { content?: { carrier?: Record<string, unknown> }[] | { carrier?: Record<string, unknown> } | null };
    const first = Array.isArray(body.content) ? body.content[0] : body.content;
    const c = first?.carrier;
    if (!c) return Response.json({ source: "fmcsa", found: false, message: `FMCSA has no carrier with MC ${docket}.` } satisfies FmcsaResult);
    return Response.json({
      source: "fmcsa",
      found: true,
      legalName: String(c.legalName ?? ""),
      dbaName: c.dbaName ? String(c.dbaName) : undefined,
      dotNumber: c.dotNumber != null ? String(c.dotNumber) : undefined,
      allowedToOperate: c.allowedToOperate === "Y",
      city: c.phyCity ? String(c.phyCity) : undefined,
      state: c.phyState ? String(c.phyState) : undefined,
      liabilityOnFile: thousands(c.bipdInsuranceOnFile),
    } satisfies FmcsaResult);
  } catch {
    return Response.json({ source: "error", message: "Couldn't reach FMCSA. Try again in a minute." } satisfies FmcsaResult, { status: 502 });
  }
}
