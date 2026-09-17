import type { Driver, Load } from "./types";

/** Factoring AI: sells the invoice the moment a load delivers instead of waiting the broker's 30-45 day terms. */
export const FACTORING_FEE_PCT = 0.025;
const FUNDING_WINDOW_MS = 24 * 60 * 60 * 1000;

export interface FactoringSettlement {
  loadId: string;
  referenceNumber: string;
  lane: string;
  invoiceAmount: number;
  factoringFee: number;
  netPayout: number;
  status: "funded" | "submitted";
  submittedAt: string;
  fundedAt: string | null;
}

export function deriveFactoringSettlement(load: Load, now: number): FactoringSettlement {
  const invoiceAmount = load.bookedRate ?? load.targetRate;
  const factoringFee = Math.round(invoiceAmount * FACTORING_FEE_PCT);
  const submittedMs = new Date(load.updatedAt).getTime();
  const funded = now - submittedMs >= FUNDING_WINDOW_MS;
  return {
    loadId: load.id,
    referenceNumber: load.referenceNumber,
    lane: `${load.lane.origin} → ${load.lane.destination}`,
    invoiceAmount,
    factoringFee,
    netPayout: invoiceAmount - factoringFee,
    status: funded ? "funded" : "submitted",
    submittedAt: load.updatedAt,
    fundedAt: funded ? new Date(submittedMs + FUNDING_WINDOW_MS).toISOString() : null,
  };
}

/** Driver Settlement AI: what a driver is actually owed for a load, computed from their pay structure. */
export function computeDriverPay(load: Load, driver: Driver): number {
  const rate = load.bookedRate ?? load.targetRate;
  return Math.round(driver.payType === "percentage" ? rate * driver.payRate : load.lane.miles * driver.payRate);
}
