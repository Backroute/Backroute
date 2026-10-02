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

/** Closer than this on screen, trucks share one dot. */
const CLUSTER_PX = 44;

/** A dot for several trucks: how many, colored by the most urgent among them. */
function clusterElement(members: { unit: string; spot: TruckSpot }[], onTap: () => void): HTMLElement {
  const order: TruckSpot[] = ["late", "stop", "moving", "empty"];
  const worst = order.find((o) => members.some((m) => m.spot === o)) ?? "empty";
  const el = document.createElement("button");
  el.type = "button";
  el.setAttribute("aria-label", `${members.length} trucks here: ${members.map((m) => m.unit).join(", ")}. Zoom in`);
  el.className = "flex h-9 min-w-9 items-center justify-center rounded-full border-2 border-[var(--color-white)] px-2 text-xs font-semibold text-white shadow-lg";
  el.style.background = SPOT_COLOR[worst];
  el.textContent = String(members.length);
  el.addEventListener("click", (e) => {
    e.stopPropagation();
    onTap();
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

  // The dots: redrawn when a truck moves or changes what it's doing, and regrouped when the map zooms. Trucks within
  // a thumb's width of each other become one numbered dot; tap it to zoom in on them.
  useEffect(() => {
    let alive = true;
    let fitted = false;
    const draw = () => {
      const lib = ml.current;
      const m = map.current;
      if (!alive || !lib || !m) return;
      if (!fitted && placed.length) {
        // Marked first: fitting fires "zoomend" right away, which calls draw again.
        fitted = true;
        const bounds = placed.reduce((b, p) => b.extend([p.at[1], p.at[0]]), new lib.LngLatBounds([placed[0].at[1], placed[0].at[0]], [placed[0].at[1], placed[0].at[0]]));
        m.fitBounds(bounds, { padding: 56, maxZoom: 7, duration: 0 });
      }
      markers.current.forEach((mk) => mk.remove());
      const groups: { members: typeof placed; x: number; y: number }[] = [];
      for (const p of placed) {
        const pt = m.project([p.at[1], p.at[0]]);
        const near = groups.find((g) => Math.hypot(g.x - pt.x, g.y - pt.y) < CLUSTER_PX);
        if (near) near.members.push(p);
        else groups.push({ members: [p], x: pt.x, y: pt.y });
      }
      markers.current = groups.map(({ members }) => {
        if (members.length === 1) {
          const { d, at, spot } = members[0];
          return new lib.Marker({ element: dotElement(d, spot, (id) => select.current(id)), anchor: "bottom" }).setLngLat([at[1], at[0]]).addTo(m);
        }
        const lng = members.reduce((s, p) => s + p.at[1], 0) / members.length;
        const lat = members.reduce((s, p) => s + p.at[0], 0) / members.length;
        const zoomIn = () => {
          const b = members.reduce((acc, p) => acc.extend([p.at[1], p.at[0]]), new lib.LngLatBounds([members[0].at[1], members[0].at[0]], [members[0].at[1], members[0].at[0]]));
          m.fitBounds(b, { padding: 80, maxZoom: Math.max(m.getZoom() + 2.5, 9), duration: 400 });
        };
        return new lib.Marker({ element: clusterElement(members.map((p) => ({ unit: p.d.truck.unitNumber, spot: p.spot })), zoomIn) }).setLngLat([lng, lat]).addTo(m);
      });
    };
    // The map is made asynchronously: hook onto it now if it's there, or the moment it's ready.
    let hooked: MapLibreMap | null = null;
    const hook = () => {
      if (!map.current || hooked === map.current) return;
      hooked = map.current;
      hooked.on("zoomend", draw);
      draw();
    };
    hook();
    window.addEventListener("backroute:fleet-map-ready", hook);
    return () => {
      alive = false;
      window.removeEventListener("backroute:fleet-map-ready", hook);
      hooked?.off("zoomend", draw);
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
