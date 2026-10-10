"use client";

import { useEffect, useState } from "react";
import { MapPin } from "lucide-react";
import { dockOf, useDockSpot } from "@/lib/dock-spot";
import { useDriverUi } from "@/lib/lang/use-driver-ui";
import { usePrimaryDriver } from "@/lib/selectors";
import { distanceMiles } from "@/lib/trip-geo";
import type { Load } from "@/lib/types";

/** Close enough to the dock's exact spot to be in its lot. */
const AT_DOCK_MILES = 0.25;

/**
 * "You're at the shipper. Mark arrived?" when the phone is at the dock, so the driver doesn't have to remember to tap
 * it. Only with the dock's exact spot (never a city's middle), only on duty with location already allowed (it never
 * asks for permission), and it only asks: nothing is marked until the driver says yes.
 */
export function ArrivalPrompt({ load, onArrive }: { load: Load; onArrive: () => void }) {
  const driver = usePrimaryDriver();
  const { t } = useDriverUi();
  const heading = load.stage === "dispatched" ? "pickup" : load.stage === "in_transit" ? "delivery" : null;
  const dock = heading ? dockOf(load, heading) : null;
  const { spot } = useDockSpot(dock?.address ?? null);
  const onDuty = driver.hosStatus === "driving" || driver.hosStatus === "on_duty";
  const [here, setHere] = useState(false);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const key = `${load.id}:${load.stage}`;

  useEffect(() => {
    if (!spot || !onDuty || typeof navigator === "undefined" || !navigator.geolocation || !navigator.permissions) return;
    let watch: number | null = null;
    let off = false;
    navigator.permissions
      .query({ name: "geolocation" as PermissionName })
      .then((p) => {
        if (off || p.state !== "granted") return;
        watch = navigator.geolocation.watchPosition(
          (pos) => setHere(distanceMiles([pos.coords.latitude, pos.coords.longitude], spot) <= AT_DOCK_MILES),
          () => {},
          { enableHighAccuracy: true, maximumAge: 30_000 },
        );
      })
      .catch(() => {});
    return () => {
      off = true;
      if (watch !== null) navigator.geolocation.clearWatch(watch);
    };
  }, [spot, onDuty]);

  if (!heading || !dock || !here || dismissed === key) return null;
  const place = dock.name ?? `${dock.city}, ${dock.state}`;
  return (
    <div className="flex flex-col gap-3 rounded-3xl bg-ink-950 p-4 text-white" role="alert">
      <p className="flex items-center gap-2 text-sm font-semibold">
        <MapPin className="h-4 w-4" /> {t.arriveAsk(place)}
      </p>
      <div className="flex gap-2">
        <button type="button" onClick={onArrive} className="min-h-11 flex-1 rounded-full bg-white px-4 py-2 text-sm font-semibold text-ink-950">
          {t.arriveYes}
        </button>
        <button type="button" onClick={() => setDismissed(key)} className="min-h-11 rounded-full border border-white/25 px-4 py-2 text-sm font-medium text-white/85">
          {t.arriveNo}
        </button>
      </div>
    </div>
  );
}
