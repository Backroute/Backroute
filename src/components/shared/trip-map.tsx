"use client";

import { useEffect, useRef } from "react";
import type { GeoJSONSource, Map as MapLibreMap, Marker } from "maplibre-gl";
import { cn } from "@/lib/utils";
import type { LatLng } from "@/lib/trip-geo";

/** Extra room up top for the phase chip that floats over the map, and at the bottom for the fade. */
const PADDING = { top: 60, bottom: 44, left: 36, right: 36 };
/** A short strip (the compact card) can't afford the big card's padding — MapLibre gives up on fitting a route
 *  when the padding is taller than the map and falls back to the whole world. */
const COMPACT_PADDING = { top: 34, bottom: 14, left: 28, right: 28 };

/** OpenFreeMap: free vector tiles with no API key, no usage limits and commercial use allowed. */
const STYLE_URL = "https://tiles.openfreemap.org/styles/dark";

const routeCache = new Map<string, LatLng[]>();

/** Real road geometry from the public OSRM demo router; falls back to a straight line if it's unreachable,
 *  so the map still shows the trip offline. Failures aren't cached, so the next view retries. */
async function fetchRoute(from: LatLng, to: LatLng): Promise<LatLng[]> {
  const key = `${from.join(",")}|${to.join(",")}`;
  const cached = routeCache.get(key);
  if (cached) return cached;
  try {
    const url = `https://router.project-osrm.org/route/v1/driving/${from[1]},${from[0]};${to[1]},${to[0]}?overview=simplified&geometries=geojson`;
    const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
    const data = await res.json();
    const coords: [number, number][] | undefined = data?.routes?.[0]?.geometry?.coordinates;
    if (!coords?.length) throw new Error("no route");
    const path = coords.map(([lng, lat]) => [lat, lng] as LatLng);
    routeCache.set(key, path);
    return path;
  } catch {
    return [from, to];
  }
}

/** Freight lanes are a fixed set, so their road geometry ships with the app (pre-computed from OSRM and
 *  simplified) instead of depending on a public router at runtime; only other legs hit the network. */
async function resolveRoute(from: LatLng, to: LatLng, laneKey?: string): Promise<LatLng[]> {
  if (laneKey) {
    const lanes = (await import("@/lib/lane-routes.json")).default as unknown as Record<string, LatLng[]>;
    if (lanes[laneKey]) return lanes[laneKey];
  }
  return fetchRoute(from, to);
}

/** The point `fraction` of the way along a polyline by distance, plus the index of the segment it sits on. */
function pointAlong(path: LatLng[], fraction: number): { point: LatLng; index: number } {
  if (path.length < 2) return { point: path[0], index: 0 };
  const seg = path.slice(1).map((p, i) => Math.hypot(p[0] - path[i][0], p[1] - path[i][1]));
  const total = seg.reduce((s, d) => s + d, 0);
  let target = Math.min(1, Math.max(0, fraction)) * total;
  for (let i = 0; i < seg.length; i++) {
    if (target <= seg[i] || i === seg.length - 1) {
      const t = seg[i] ? Math.min(1, target / seg[i]) : 0;
      const [a, b] = [path[i], path[i + 1]];
      return { point: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], index: i };
    }
    target -= seg[i];
  }
  return { point: path[path.length - 1], index: path.length - 2 };
}

const lngLat = ([lat, lng]: LatLng): [number, number] => [lng, lat];
const lineFeature = (pts: LatLng[]) => ({
  type: "Feature" as const,
  properties: {},
  geometry: { type: "LineString" as const, coordinates: pts.map(lngLat) },
});

function markerElement(kind: "start" | "end" | "truck"): HTMLElement {
  const el = document.createElement("div");
  el.innerHTML =
    kind === "truck"
      ? '<span class="relative flex h-[22px] w-[22px] items-center justify-center"><span class="absolute inset-0 animate-ping rounded-full bg-emerald-400/40"></span><span class="relative h-3.5 w-3.5 rounded-full border-[3px] border-white bg-[var(--accent-live)] shadow"></span></span>'
      : `<span class="block h-3.5 w-3.5 border-[3px] border-white bg-ink-950 ${kind === "start" ? "rounded-full" : ""}"></span>`;
  return el;
}

interface MapState {
  ml?: typeof import("maplibre-gl");
  map?: MapLibreMap;
  path?: LatLng[];
  truck?: Marker;
}

function drawProgress(s: MapState, progress: number, showTruck: boolean) {
  const { ml, map, path } = s;
  if (!ml || !map || !path) return;
  const { point, index } = pointAlong(path, progress);
  (map.getSource("route-done") as GeoJSONSource | undefined)?.setData(lineFeature([...path.slice(0, index + 1), point]));
  (map.getSource("route-ahead") as GeoJSONSource | undefined)?.setData(lineFeature([point, ...path.slice(index + 1)]));
  if (showTruck) {
    if (s.truck) s.truck.setLngLat(lngLat(point));
    else s.truck = new ml.Marker({ element: markerElement("truck") }).setLngLat(lngLat(point)).addTo(map);
  } else if (s.truck) {
    s.truck.remove();
    s.truck = undefined;
  }
}

/** Uber-style trip map: dark basemap, the road route, a dot at the start, a square at the end, and a live
 *  truck marker that slides along as `progress` (0–1) moves. Non-interactive so it never fights the page
 *  scroll on a phone. */
export function TripMap({
  from,
  to,
  laneKey,
  progress,
  showTruck,
  compact,
  className,
}: {
  from: LatLng;
  to: LatLng;
  /** "City, ST|City, ST" of a known freight lane, for its pre-computed road route. */
  laneKey?: string;
  progress: number;
  showTruck: boolean;
  compact?: boolean;
  className?: string;
}) {
  const el = useRef<HTMLDivElement>(null);
  const state = useRef<MapState>({});
  const latest = useRef({ progress, showTruck });
  const fromKey = from.join(",");
  const toKey = to.join(",");

  useEffect(() => {
    latest.current = { progress, showTruck };
    drawProgress(state.current, progress, showTruck);
  }, [progress, showTruck]);

  useEffect(() => {
    let cancelled = false;
    const a = fromKey.split(",").map(Number) as LatLng;
    const b = toKey.split(",").map(Number) as LatLng;
    (async () => {
      const ml = await import("maplibre-gl");
      if (cancelled || !el.current) return;
      // Bundling breaks MapLibre's own worker lookup; load the worker matching this exact library version.
      ml.setWorkerUrl(`https://cdn.jsdelivr.net/npm/maplibre-gl@${ml.getVersion()}/dist/maplibre-gl-worker.mjs`);
      const padding = compact ? COMPACT_PADDING : PADDING;
      let map: MapLibreMap;
      try {
        map = new ml.Map({
          container: el.current,
          style: STYLE_URL,
          bounds: new ml.LngLatBounds(lngLat(a), lngLat(a)).extend(lngLat(b)),
          fitBoundsOptions: { padding },
          interactive: false,
          attributionControl: false,
          fadeDuration: 0,
        });
      } catch {
        return; // No WebGL: the card still works; the map area stays a plain dark panel.
      }
      map.addControl(new ml.AttributionControl({ compact: true }), "top-right");
      state.current = { ml, map };
      new ml.Marker({ element: markerElement("start") }).setLngLat(lngLat(a)).addTo(map);
      new ml.Marker({ element: markerElement("end") }).setLngLat(lngLat(b)).addTo(map);

      const [path] = await Promise.all([resolveRoute(a, b, laneKey), map.once("load")]);
      if (cancelled) return;
      // Compact attribution starts expanded; on a card this small it would cover the map, so start it
      // collapsed behind its (i) button, which still opens the full credit on tap.
      el.current?.querySelector(".maplibregl-ctrl-attrib")?.classList.remove("maplibregl-compact-show");
      for (const [id, opacity] of [["route-done", 0.3], ["route-ahead", 0.95]] as const) {
        map.addSource(id, { type: "geojson", data: lineFeature(path) });
        map.addLayer({
          id,
          type: "line",
          source: id,
          layout: { "line-cap": "round", "line-join": "round" },
          paint: { "line-color": "#ffffff", "line-width": 4, "line-opacity": opacity },
        });
      }
      const bounds = path.reduce((acc, p) => acc.extend(lngLat(p)), new ml.LngLatBounds(lngLat(path[0]), lngLat(path[0])));
      map.fitBounds(bounds, { padding, duration: 0 });
      state.current.path = path;
      drawProgress(state.current, latest.current.progress, latest.current.showTruck);
    })();
    return () => {
      cancelled = true;
      state.current.map?.remove();
      state.current = {};
    };
  }, [fromKey, toKey, laneKey, compact]);

  // MapLibre's own (unlayered) CSS forces `position: relative` on the element it mounts into, so that element
  // fills an absolutely positioned wrapper rather than being positioned itself.
  return (
    <div aria-hidden className={cn("absolute inset-0 z-0", className)} style={{ background: "#141414" }}>
      <div ref={el} className="h-full w-full" />
    </div>
  );
}
