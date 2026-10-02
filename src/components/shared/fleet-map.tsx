"use client";

import { useEffect, useMemo, useRef } from "react";
import type { Map as MapLibreMap, Marker } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useIsDark } from "@/lib/theme";
import { isTransitStage, transitProgress } from "@/lib/load-status";
import { placeCoords, roughCoords, type LatLng } from "@/lib/trip-geo";
import type { Driver, Load, Truck } from "@/lib/types";
import { cn } from "@/lib/utils";

/** What each dot's color means, the same words as everywhere else. */
export type TruckSpot = "moving" | "stop" | "late" | "empty";

const SPOT_LABEL: Record<TruckSpot, string> = { moving: "Moving", stop: "At a stop", late: "Running late", empty: "Empty" };
const SPOT_COLOR: Record<TruckSpot, string> = {
  moving: "var(--accent-info)",
  stop: "var(--accent-warn)",
  late: "var(--accent-danger)",
  empty: "var(--ink-400)",
};

const STYLE = { light: "https://tiles.openfreemap.org/styles/positron", dark: "https://tiles.openfreemap.org/styles/dark" };

export interface FleetDot {
  truck: Truck;
  driver?: Driver;
  current?: Load;
}

function spotOf({ current }: FleetDot): TruckSpot {
  if (!current) return "empty";
  if (current.late) return "late";
  if (current.stage === "at_pickup" || current.stage === "at_delivery") return "stop";
  return isTransitStage(current.stage) ? "moving" : "empty";
}

/** Where to put the truck: the ELD's reading, else along its trip, else its city. */
function whereIs({ truck, current }: FleetDot): LatLng | undefined {
  if (truck.position) return [truck.position.lat, truck.position.lon];
  if (current && isTransitStage(current.stage)) {
    const a = roughCoords(current.lane.origin.split(",")[0] ?? "", current.lane.originState)?.at;
    const b = roughCoords(current.lane.destination.split(",")[0] ?? "", current.lane.destState)?.at;
    const f = Math.min(1, transitProgress(current.stage) / 100);
    if (a && b) return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
  }
  return placeCoords(truck.currentCity, truck.currentState) ?? roughCoords(truck.currentCity, truck.currentState)?.at;
}

function dotElement(dot: FleetDot, spot: TruckSpot, onSelect: (truckId: string) => void): HTMLElement {
  const el = document.createElement("button");
  el.type = "button";
  el.setAttribute("aria-label", `${dot.truck.unitNumber}${dot.driver ? `, ${dot.driver.name}` : ""}: ${SPOT_LABEL[spot]}`);
  el.className = "group flex flex-col items-center";
  el.innerHTML = `<span class="rounded-full bg-[var(--color-white)] px-1.5 py-0.5 text-[10px] font-semibold text-ink-950 shadow ring-1 ring-black/5">${dot.truck.unitNumber.replace(/[<>&]/g, "")}</span><span class="mt-1 block h-3.5 w-3.5 rounded-full border-2 border-[var(--color-white)] shadow" style="background:${SPOT_COLOR[spot]}"></span>`;
  el.addEventListener("click", (e) => {
    e.stopPropagation();
    onSelect(dot.truck.id);
  });
  return el;
}

/**
 * The whole fleet at a glance: a dot per truck, colored by what it's doing. Tap a dot for that truck's trip. The map
 * is the same light or dark as the app; two fingers (or Ctrl and scroll) move it, so the page still scrolls.
 */
export function FleetMap({ dots, onSelect, className }: { dots: FleetDot[]; onSelect: (truckId: string) => void; className?: string }) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibreMap | null>(null);
  const markers = useRef<Marker[]>([]);
  const ml = useRef<typeof import("maplibre-gl") | null>(null);
  const dark = useIsDark();
  const select = useRef(onSelect);
  useEffect(() => {
    select.current = onSelect;
  }, [onSelect]);

  const placed = useMemo(
    () =>
      dots
        .map((d) => ({ d, at: whereIs(d), spot: spotOf(d) }))
        .filter((p): p is { d: FleetDot; at: LatLng; spot: TruckSpot } => !!p.at),
    [dots],
  );
  const key = placed.map((p) => `${p.d.truck.id}:${p.at.map((n) => n.toFixed(3)).join(",")}:${p.spot}`).join("|");
  const counts = useMemo(() => {
    const c: Record<TruckSpot, number> = { moving: 0, stop: 0, late: 0, empty: 0 };
    for (const d of dots) c[spotOf(d)]++;
    return c;
  }, [dots]);

  // The map itself: made once per theme.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const lib = await import("maplibre-gl");
      if (cancelled || !el.current) return;
      lib.setWorkerUrl(`https://cdn.jsdelivr.net/npm/maplibre-gl@${lib.getVersion()}/dist/maplibre-gl-worker.mjs`);
      ml.current = lib;
      try {
        map.current = new lib.Map({
          container: el.current,
          style: dark ? STYLE.dark : STYLE.light,
          center: [-95.5, 37.5],
          zoom: 3,
          attributionControl: false,
          cooperativeGestures: true,
          fadeDuration: 0,
        });
      } catch {
        return; // No WebGL: the legend below still lists every truck.
      }
      map.current.addControl(new lib.AttributionControl({ compact: true }), "bottom-right");
      // Compact attribution starts open; collapsed behind its (i) it stays one tap away without covering trucks.
      map.current.once("load", () => el.current?.querySelector(".maplibregl-ctrl-attrib")?.classList.remove("maplibregl-compact-show"));
      map.current.addControl(new lib.NavigationControl({ showCompass: false }), "top-right");
      window.dispatchEvent(new Event("backroute:fleet-map-ready"));
    })();
    return () => {
      cancelled = true;
      markers.current.forEach((m) => m.remove());
      markers.current = [];
      map.current?.remove();
      map.current = null;
    };
  }, [dark]);

  // The dots: redrawn when a truck moves or changes what it's doing.
  useEffect(() => {
    let alive = true;
    const draw = () => {
      const lib = ml.current;
      const m = map.current;
      if (!alive || !lib || !m) return;
      markers.current.forEach((mk) => mk.remove());
      markers.current = placed.map(({ d, at, spot }) =>
        new lib.Marker({ element: dotElement(d, spot, (id) => select.current(id)), anchor: "bottom" }).setLngLat([at[1], at[0]]).addTo(m),
      );
      if (placed.length) {
        const bounds = placed.reduce((b, p) => b.extend([p.at[1], p.at[0]]), new lib.LngLatBounds([placed[0].at[1], placed[0].at[0]], [placed[0].at[1], placed[0].at[0]]));
        m.fitBounds(bounds, { padding: 56, maxZoom: 7, duration: 0 });
      }
    };
    if (map.current) draw();
    window.addEventListener("backroute:fleet-map-ready", draw);
    return () => {
      alive = false;
      window.removeEventListener("backroute:fleet-map-ready", draw);
    };
    // `key` changes exactly when a dot would move or change color.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, dark]);

  return (
    <section aria-labelledby="fleet-map-title" className={cn("overflow-hidden rounded-3xl border border-line bg-white", className)}>
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 pb-2 pt-4 sm:px-5">
        <h2 id="fleet-map-title" className="t-section text-ink-950">
          Where the trucks are
        </h2>
        <ul className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-ink-600" aria-label="What the colors mean">
          {(Object.keys(SPOT_LABEL) as TruckSpot[]).map((s) => (
            <li key={s} className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: SPOT_COLOR[s] }} />
              {SPOT_LABEL[s]} <span className="tabular text-ink-400">{counts[s]}</span>
            </li>
          ))}
        </ul>
      </div>
      <div className="relative h-72 sm:h-80" style={{ background: "var(--ink-100)" }}>
        {/* MapLibre's CSS forces position: relative on the element it mounts into, so that element fills an
            absolutely positioned wrapper instead of being positioned itself. */}
        <div className="absolute inset-0">
          <div ref={el} className="h-full w-full" />
        </div>
      </div>
    </section>
  );
}
