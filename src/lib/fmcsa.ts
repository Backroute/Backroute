/** What sign-up gets back from the FMCSA lookup route (src/app/api/fmcsa/[mc]/route.ts). */
export interface FmcsaResult {
  source: "fmcsa" | "demo" | "error";
  found?: boolean;
  legalName?: string;
  dbaName?: string;
  dotNumber?: string;
  allowedToOperate?: boolean;
  city?: string;
  state?: string;
  /** Liability insurance on file, in dollars. */
  liabilityOnFile?: number;
  message?: string;
}
