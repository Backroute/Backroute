"use client";

import { useEffect, useState } from "react";
import { authHeader } from "./ai/client";
import { cloudEnabled } from "./cloud/client";
import type { LatLng } from "./trip-geo";
import type { Load } from "./types";

/**
 * Where the driver is really going: the dock's street address (rate con or office), and its exact spot when the
 * server can look it up (truck routing on). Never the middle of the city: a truck sent to downtown Memphis instead of
 * the warehouse on the edge of town ends up on streets it can't use.
 */
export interface DockTarget {
  /** The facility's name, when the rate con has it. */
  name: string | null;
  address: string | null;
  city: string;
  state: string;
}

export function dockOf(load: Load, stop: "pickup" | "delivery"): DockTarget {
  const r = load.rateConReading;
  return stop === "pickup"
    ? { name: r?.shipper ?? null, address: load.pickupAddress ?? r?.shipperAddress ?? null, city: load.lane.origin, state: load.lane.originState }
    : { name: r?.receiver ?? null, address: load.deliveryAddress ?? r?.receiverAddress ?? null, city: load.lane.destination, state: load.lane.destState };
}

/** What to type into the truck app when there's no exact spot: the address, else the facility and its city. */
export const dockSearchText = (d: DockTarget) => d.address ?? [d.name, `${d.city}, ${d.state}`].filter(Boolean).join(", ");

const spots = new Map<string, LatLng | null>();

/** The dock's exact spot from its address, or null (no address, routing not set up, or not found at street level). */
export function useDockSpot(address: string | null): { spot: LatLng | null; looking: boolean } {
  const key = address?.trim().toLowerCase() ?? "";
  const [, setDone] = useState(0);
  useEffect(() => {
    if (!key || !cloudEnabled || spots.has(key)) return;
    let off = false;
    void (async () => {
      let at: LatLng | null = null;
      try {
        const res = await fetch(`/api/directions?address=${encodeURIComponent(address!)}`, { headers: await authHeader() });
        if (res.ok) at = ((await res.json()) as { at: LatLng | null }).at;
      } catch {
        // No signal: the address is still there to copy.
      }
      spots.set(key, at);
      if (!off) setDone((n) => n + 1);
    })();
    return () => {
      off = true;
    };
  }, [key, address]);
  return { spot: spots.get(key) ?? null, looking: !!key && cloudEnabled && !spots.has(key) };
}
