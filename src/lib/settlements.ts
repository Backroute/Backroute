import type { Driver, Load } from "./types";

/** Factoring AI: the factoring partner's fee for advancing an invoice instead of waiting the broker's 30-45 day terms. */
export const FACTORING_FEE_PCT = 0.025;

/** Driver Settlement AI: what a driver is actually owed for a load, computed from their pay structure.
 *  A team truck splits one driver-pay budget between its two drivers rather than paying each in full. */
export function computeDriverPay(load: Load, driver: Driver, teamSplit = false): number {
  const rate = load.bookedRate ?? load.targetRate;
  const full = driver.payType === "percentage" ? rate * driver.payRate : load.lane.miles * driver.payRate;
  return Math.round(teamSplit ? full / 2 : full);
}
