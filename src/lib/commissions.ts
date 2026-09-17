import { FACTORING_FEE_PCT } from "./settlements";

/** Backroute's cut of the factoring partner's fee when a carrier funds an invoice through Factoring AI — never billed to the carrier. */
export const FACTORING_REFERRAL_PCT = 0.2;

/** Flat referral fee Backroute earns from the insurer when a carrier binds coverage through Insurance AI. */
export const INSURANCE_REFERRAL_FEE = 150;

/** Flat fee charged only when a carrier files this quarter's IFTA return — the estimate itself is free. */
export const IFTA_FILING_FEE = 49;

export function computeFactoringCommission(invoiceAmount: number): number {
  return Math.round(invoiceAmount * FACTORING_FEE_PCT * FACTORING_REFERRAL_PCT);
}
