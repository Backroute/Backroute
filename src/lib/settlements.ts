import { legHours } from "./trip-geo";
import type { Driver, Load } from "./types";

/** Factoring AI: the factoring partner's fee for advancing an invoice instead of waiting the broker's 30-45 day terms. */
export const FACTORING_FEE_PCT = 0.025;

/** Driver Settlement AI: what a driver is actually owed for a load, computed from their pay structure.
 *  A team truck splits one driver-pay budget between its two drivers rather than paying each in full. */
export function computeDriverPay(load: Load, driver: Driver, teamSplit = false): number {
  const rate = load.bookedRate ?? load.targetRate;
  const full =
    driver.payType === "percentage"
      ? rate * driver.payRate
      : driver.payType === "hourly"
        ? legHours(load.lane.miles, load.deadheadMiles) * driver.payRate
        : load.lane.miles * driver.payRate;
  return Math.round(teamSplit ? full / 2 : full);
}

/** "27% of the load", "$0.62 per loaded mile", "$28.50 an hour". */
export function payLabel(driver: Driver): string {
  if (driver.payType === "percentage") return `${Math.round(driver.payRate * 100)}% of the load`;
  if (driver.payType === "hourly") return `$${driver.payRate.toFixed(2)} an hour`;
  return `$${driver.payRate.toFixed(2)} per loaded mile`;
}
