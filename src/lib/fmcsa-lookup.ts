import "server-only";

/**
 * FMCSA's QCMobile API, looked up by MC (docket) number. Used at sign-up for the carrier itself, and by the AI to
 * check a broker's authority before booking with them. Needs FMCSA_WEB_KEY (free, mobile.fmcsa.dot.gov/QCDevsite).
 */

export interface McRecord {
  legalName: string;
  dbaName?: string;
  dotNumber?: string;
  allowedToOperate: boolean;
  /** FMCSA's broker authority status: "A" active, "I" inactive, "N" none. */
  brokerAuthority?: string;
  city?: string;
  state?: string;
  /** Liability insurance on file, in dollars. */
  liabilityOnFile?: number;
}

export type McLookup = { ok: true; record: McRecord | null } | { ok: false; reason: "no_key" | "bad_number" | "unreachable" };

const base = () => process.env.FMCSA_API_BASE?.replace(/\/$/, "") ?? "https://mobile.fmcsa.dot.gov/qc/services";
const thousands = (v: unknown) => ((typeof v === "string" || typeof v === "number") && Number(v) > 0 ? Number(v) * 1000 : undefined);

export const fmcsaConfigured = () => Boolean(process.env.FMCSA_WEB_KEY);

export async function lookupMc(mc: string): Promise<McLookup> {
  const docket = mc.replace(/^\s*MC[-\s#]*/i, "").trim();
  if (!/^\d{1,8}$/.test(docket)) return { ok: false, reason: "bad_number" };
  const key = process.env.FMCSA_WEB_KEY;
  if (!key) return { ok: false, reason: "no_key" };
  try {
    const res = await fetch(`${base()}/carriers/docket-number/${docket}?webKey=${encodeURIComponent(key)}`, { signal: AbortSignal.timeout(8000), cache: "no-store" });
    if (!res.ok) return { ok: false, reason: "unreachable" };
    const body = (await res.json()) as { content?: { carrier?: Record<string, unknown> }[] | { carrier?: Record<string, unknown> } | null };
    const first = Array.isArray(body.content) ? body.content[0] : body.content;
    const c = first?.carrier;
    if (!c) return { ok: true, record: null };
    return {
      ok: true,
      record: {
        legalName: String(c.legalName ?? ""),
        dbaName: c.dbaName ? String(c.dbaName) : undefined,
        dotNumber: c.dotNumber != null ? String(c.dotNumber) : undefined,
        allowedToOperate: c.allowedToOperate === "Y",
        brokerAuthority: c.brokerAuthorityStatus ? String(c.brokerAuthorityStatus) : undefined,
        city: c.phyCity ? String(c.phyCity) : undefined,
        state: c.phyState ? String(c.phyState) : undefined,
        liabilityOnFile: thousands(c.bipdInsuranceOnFile),
      },
    };
  } catch {
    return { ok: false, reason: "unreachable" };
  }
}
