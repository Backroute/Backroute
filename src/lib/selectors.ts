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

/** The driver using the driver app: the signed-in driver, or the demo's driver. */
export function usePrimaryDriver() {
  return useStore((s) => {
    const id = s.session.driverId ?? PRIMARY_DRIVER_ID;
    return (s.drivers.find((d) => d.id === id) ?? s.drivers[0])!;
  });
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

/**
 * Everything booked on the truck after its current load, in order: the next one first, then the rest by pickup time
 * (the AI books up to three ahead, lib/agent/chain). A booked load whose pickup is more than a day gone is left out.
 */
export function truckLineup(loads: Load[], truck: Truck | undefined, now = Date.now()): Load[] {
  if (!truck) return [];
  // A plan's loads are on the truck's lineup from the moment it's booked, while their brokers are still being asked.
  const asking = (l: Load) => !!l.plan && (l.stage === "sourced" || l.stage === "scoring" || l.stage === "negotiating");
  const waiting = loads.filter(
    (l) => l.truckId === truck.id && l.id !== truck.currentLoadId && (l.stage === "booked" || l.stage === "rate_confirmed" || asking(l)) && !(l.pickupAt && Date.parse(l.pickupAt) < now - 86400_000),
  );
  const next = waiting.find((l) => l.id === truck.nextLoadId);
  const at = (l: Load) => Date.parse(l.pickupAt ?? "") || Number.MAX_SAFE_INTEGER;
  // The rest of the next load's plan follows it in order, then anything else by pickup.
  const sameTrip = (l: Load) => !!next?.plan && l.plan?.id === next.plan.id;
  const planned = waiting.filter((l) => l !== next && sameTrip(l)).sort((a, b) => (a.plan?.leg ?? 0) - (b.plan?.leg ?? 0));
  return [...(next ? [next] : []), ...planned, ...waiting.filter((l) => l !== next && !sameTrip(l)).sort((a, b) => at(a) - at(b))];
}
