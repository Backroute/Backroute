import type { Load } from "./types";

/** What a truck-ordered-not-used costs the broker when the carrier hasn't set its own (Settings → Rates, billing). */
export const DEFAULT_TONU = 150;

/** "TONU $250" on the rate con → 250. */
export function tonuOnRateCon(load: Load): number | null {
  const text = [...(load.rateConReading?.finesAndFees ?? []), ...(load.rateConReading?.otherConcerns ?? []), load.rateConReading?.summary ?? ""].join(" ");
  const m = text.match(/(?:tonu|truck ordered not used)[^$]{0,30}\$\s?(\d{2,4})/i);
  return m ? Number(m[1]) : null;
}

/**
 * The TONU on this load, one number everywhere (the cancel form, the invoice, the signed rate con): what the rate con
 * says, else the carrier's own fee, else the default.
 */
export const tonuFor = (load: Load, carrierFee?: number) => tonuOnRateCon(load) ?? carrierFee ?? DEFAULT_TONU;
