"use client";

import { useMemo } from "react";
import { useStore } from "./store";
import { PRIMARY_CARRIER_ID, PRIMARY_DRIVER_ID } from "./mock-data";
import type { Load, Truck } from "./types";

export { PRIMARY_CARRIER_ID, PRIMARY_DRIVER_ID };

export function usePrimaryCarrier() {
  return useStore((s) => s.carriers.find((c) => c.id === PRIMARY_CARRIER_ID)!);
}

export function useCarrierLoads() {
  const loads = useStore((s) => s.loads);
  return useMemo(() => loads.filter((l) => l.carrierId === PRIMARY_CARRIER_ID), [loads]);
}

export function useCarrierTrucks() {
  return useStore((s) => s.trucks);
}

export function useCarrierDrivers() {
  return useStore((s) => s.drivers);
}

export function useCarrierEscalations() {
  const escalations = useStore((s) => s.escalations);
  return useMemo(() => escalations.filter((e) => e.carrierId === PRIMARY_CARRIER_ID), [escalations]);
}

export function useBrokerMap() {
  const brokers = useStore((s) => s.brokers);
  return useMemo(() => new Map(brokers.map((b) => [b.id, b])), [brokers]);
}

export function useLoad(id: string) {
  return useStore((s) => s.loads.find((l) => l.id === id));
}

export function useTruckMap() {
  const trucks = useStore((s) => s.trucks);
  return useMemo(() => new Map(trucks.map((t) => [t.id, t])), [trucks]);
}

export function useDriverMap() {
  const drivers = useStore((s) => s.drivers);
  return useMemo(() => new Map(drivers.map((d) => [d.id, d])), [drivers]);
}

export function usePrimaryDriver() {
  return useStore((s) => s.drivers.find((d) => d.id === PRIMARY_DRIVER_ID)!);
}

/**
 * truck.currentLoadId only gets set once a load actually reaches "dispatched" (see advanceLoad in engine.ts) —
 * so a load a driver just selected sits invisible for several ticks while it negotiates/books. This falls back
 * to any of the truck's own loads past "offered" so the pick shows up immediately, not just once dispatched.
 */
export function truckActiveLoads(loads: Load[], truck: Truck | undefined): { current: Load | undefined; next: Load | undefined } {
  if (!truck) return { current: undefined, next: undefined };
  const dispatched = loads.find((l) => l.id === truck.currentLoadId);
  if (dispatched) return { current: dispatched, next: loads.find((l) => l.id === truck.nextLoadId) };
  const inProgress = loads.find(
    (l) => l.truckId === truck.id && l.stage !== "offered" && l.stage !== "delivered" && l.stage !== "declined" && l.stage !== "cancelled",
  );
  return { current: inProgress, next: undefined };
}
