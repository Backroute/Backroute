import type { LatLng } from "./trip-geo";
import type { NavApp, TruckProfile } from "./types";

/**
 * Directions in the driver's truck GPS app. Only truck apps: Sygic Truck and CoPilot Truck route with the truck's
 * height, weight and length, so they keep it off low bridges, parkways and roads closed to trucks. Car apps (Google
 * Maps, Apple Maps, Waze) are left out on purpose: they send a truck down car-only roads. The truck's numbers are set
 * once in the app; the screen shows them to check.
 */

export interface NavAppInfo {
  id: NavApp;
  name: string;
  /** The link that opens the app with directions to the stop. */
  link: (to: { at?: LatLng; label: string }) => string;
  /** Where to get it when it isn't on the phone. */
  store: { ios: string; android: string };
}

const q = encodeURIComponent;
const storeSearch = (name: string) => ({
  ios: `itms-apps://search.itunes.apple.com/WebObjects/MZSearch.woa/wa/search?media=software&term=${q(name)}`,
  android: `https://play.google.com/store/search?q=${q(name)}&c=apps`,
});

export const NAV_APPS: NavAppInfo[] = [
  {
    id: "sygic",
    name: "Sygic Truck",
    // Sygic takes longitude first.
    link: ({ at, label }) => (at ? `com.sygic.aura://coordinate|${at[1]}|${at[0]}|drive` : `com.sygic.aura://search|${q(label)}`),
    store: storeSearch("Sygic Truck GPS Navigation"),
  },
  {
    id: "copilot",
    name: "CoPilot Truck",
    link: ({ at, label }) => (at ? `copilot://mydestination?type=LOCATION&action=GOTO&name=${q(label)}&lat=${at[0]}&long=${at[1]}` : `copilot://mydestination?type=ADDRESS&action=GOTO&name=${q(label)}`),
    store: storeSearch("CoPilot Truck GPS"),
  },
];

export const navApp = (id: NavApp | undefined) => NAV_APPS.find((a) => a.id === id) ?? NAV_APPS[0];

/** A full trailer behind a typical tractor: what the truck apps assume unless told otherwise. */
export const DEFAULT_PROFILE: TruckProfile = { heightIn: 162, weightLbs: 80000, lengthFt: 70, hazmat: false };

export const heightWords = (inches: number) => `${Math.floor(inches / 12)}'${inches % 12}"`;

export function profileWords(p: TruckProfile): string {
  return `${heightWords(p.heightIn)} tall · ${p.weightLbs.toLocaleString()} lbs · ${p.lengthFt} ft${p.hazmat ? " · hazmat" : ""}`;
}
