import type { LatLng } from "./trip-geo";
import type { NavApp, TruckProfile } from "./types";

/**
 * Directions in the driver's own GPS app. Truck apps (Sygic Truck, CoPilot) route with the truck's
 * height, weight and hazmat, so they keep it off low bridges and restricted roads; car apps (Google, Apple, Waze)
 * don't, and the driver is told so. The truck's numbers are set once in those apps; the screen shows them to check.
 */

export interface NavAppInfo {
  id: NavApp;
  name: string;
  truckSafe: boolean;
  /** The link that opens the app with directions to the stop. */
  link: (to: { at?: LatLng; label: string }) => string;
}

const q = encodeURIComponent;

export const NAV_APPS: NavAppInfo[] = [
  {
    id: "sygic",
    name: "Sygic Truck",
    truckSafe: true,
    // Sygic takes longitude first.
    link: ({ at, label }) => (at ? `com.sygic.aura://coordinate|${at[1]}|${at[0]}|drive` : `com.sygic.aura://search|${q(label)}`),
  },
  {
    id: "copilot",
    name: "CoPilot Truck",
    truckSafe: true,
    link: ({ at, label }) => (at ? `copilot://mydestination?type=LOCATION&action=GOTO&name=${q(label)}&lat=${at[0]}&long=${at[1]}` : `copilot://mydestination?type=ADDRESS&action=GOTO&name=${q(label)}`),
  },
  {
    id: "google",
    name: "Google Maps",
    truckSafe: false,
    link: ({ at, label }) => `https://www.google.com/maps/dir/?api=1&destination=${at ? `${at[0]},${at[1]}` : q(label)}&travelmode=driving`,
  },
  {
    id: "apple",
    name: "Apple Maps",
    truckSafe: false,
    link: ({ at, label }) => `https://maps.apple.com/?daddr=${at ? `${at[0]},${at[1]}` : q(label)}&dirflg=d`,
  },
  {
    id: "waze",
    name: "Waze",
    truckSafe: false,
    link: ({ at, label }) => (at ? `https://waze.com/ul?ll=${at[0]},${at[1]}&navigate=yes` : `https://waze.com/ul?q=${q(label)}&navigate=yes`),
  },
];

export const navApp = (id: NavApp | undefined) => NAV_APPS.find((a) => a.id === id) ?? NAV_APPS[0];

/** A full trailer behind a typical tractor: what the truck apps assume unless told otherwise. */
export const DEFAULT_PROFILE: TruckProfile = { heightIn: 162, weightLbs: 80000, lengthFt: 70, hazmat: false };

export const heightWords = (inches: number) => `${Math.floor(inches / 12)}'${inches % 12}"`;

export function profileWords(p: TruckProfile): string {
  return `${heightWords(p.heightIn)} tall · ${p.weightLbs.toLocaleString()} lbs · ${p.lengthFt} ft${p.hazmat ? " · hazmat" : ""}`;
}
