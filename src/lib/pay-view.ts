"use client";

import { computeDriverPay } from "./settlements";
import { usePrimaryDriver, useCarrierTrucks } from "./selectors";
import { useStore } from "./store";
import type { Driver, Load } from "./types";

/**
 * Whether a driver sees what a load pays the company. An owner-operator always does (it's their business); a driver
 * paid a percentage does by default (their pay is worked from it); everyone else sees their own pay instead, unless
 * the owner says otherwise (Fleet → the driver). It's what the screens show: the load's numbers still come down with
 * the load.
 */
export function driverSeesLoadPay(driver: Driver, ownerOperator: boolean): boolean {
  return ownerOperator || (driver.seesLoadPay ?? driver.payType === "percentage");
}

/** For the driver app's screens: whether to show the load's pay, and the driver's own pay on a load. */
export function usePayView(viewer: "driver" | "carrier" = "driver") {
  const driver = usePrimaryDriver();
  const trucks = useCarrierTrucks();
  const solo = useStore((s) => !!s.settings.ownerOperator);
  const team = !!trucks.find((t) => t.id === driver.truckId)?.secondDriverId;
  return {
    sees: viewer === "carrier" || driverSeesLoadPay(driver, solo),
    yourPay: (load: Load) => computeDriverPay(load, driver, team),
  };
}
