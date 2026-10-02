"use client";

import { useEffect, useState } from "react";
import { usePrimaryDriver } from "./selectors";

const MOVING_MS = 4.5; // about 10 mph
const STOPPED_MS = 1;

/**
 * Whether the driver's phone is moving at road speed, from the phone's own location: two readings over about 10 mph
 * say moving, three near standstill say stopped. Only listens when there's a load on, the driver is on duty (off
 * duty, the app never looks at where they are), they haven't turned it off (prefs.handsFreeAuto), and location is
 * already allowed: it never asks for permission on its own.
 */
export function useMoving(active: boolean): boolean {
  const driver = usePrimaryDriver();
  const onDuty = driver.hosStatus === "driving" || driver.hosStatus === "on_duty";
  const on = active && onDuty && driver.prefs?.handsFreeAuto !== false;
  const [moving, setMoving] = useState(false);
  useEffect(() => {
    if (!on || typeof navigator === "undefined" || !navigator.geolocation || !navigator.permissions) return;
    let watch: number | null = null;
    let fast = 0;
    let slow = 0;
    let cancelled = false;
    navigator.permissions
      .query({ name: "geolocation" as PermissionName })
      .then((p) => {
        if (cancelled || p.state !== "granted") return;
        watch = navigator.geolocation.watchPosition(
          (pos) => {
            const speed = pos.coords.speed;
            if (speed === null || Number.isNaN(speed)) return;
            if (speed >= MOVING_MS) {
              fast++;
              slow = 0;
              if (fast >= 2) setMoving(true);
            } else if (speed <= STOPPED_MS) {
              slow++;
              fast = 0;
              if (slow >= 3) setMoving(false);
            }
          },
          () => {},
          { enableHighAccuracy: false, maximumAge: 15_000, timeout: 30_000 },
        );
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      if (watch !== null) navigator.geolocation.clearWatch(watch);
    };
  }, [on]);
  return on && moving;
}
