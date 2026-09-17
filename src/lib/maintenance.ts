import type { Truck } from "./types";

/** Maintenance AI: how many miles until the truck's next scheduled service, from live odometer data. */
export function milesUntilService(truck: Truck): number {
  return truck.lastServiceMiles + truck.serviceIntervalMiles - truck.odometer;
}

export type ServiceStatus = "ok" | "due-soon" | "overdue";

export function serviceStatus(truck: Truck): ServiceStatus {
  const remaining = milesUntilService(truck);
  if (remaining < 0) return "overdue";
  if (remaining < 3000) return "due-soon";
  return "ok";
}

export function inspectionStatus(truck: Truck, now: number): ServiceStatus {
  const dueMs = new Date(truck.nextInspectionDue).getTime();
  const daysLeft = (dueMs - now) / (24 * 60 * 60 * 1000);
  if (daysLeft < 0) return "overdue";
  if (daysLeft < 14) return "due-soon";
  return "ok";
}
