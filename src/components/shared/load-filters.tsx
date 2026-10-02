"use client";

import { useEffect, useState } from "react";
import { Bookmark, Search, X } from "lucide-react";
import type { Broker, Load, Truck } from "@/lib/types";
import { cn } from "@/lib/utils";

const DAY = 86400_000;

export interface LoadFilter {
  text: string;
  truckId: string;
  brokerId: string;
  days: number;
  /** A ready-made or saved view's own rule, by name. */
  view: string;
}

const EMPTY: LoadFilter = { text: "", truckId: "", brokerId: "", days: 0, view: "" };

/** Views anyone running trucks asks for, built in. */
const BUILT_IN: { key: string; label: string; test: (l: Load, now: number) => boolean }[] = [
  {
    key: "unpaid30",
    label: "Unpaid over 30 days",
    test: (l, now) => !!l.invoice?.sentAt && !l.invoice.paidAt && now - Date.parse(l.invoice.sentAt) > 30 * DAY,
  },
  { key: "late", label: "Running late", test: (l) => !!l.late && l.stage !== "delivered" },
  {
    key: "noratecon",
    label: "No rate con yet",
    test: (l) => ["rate_confirmed", "booked", "dispatched", "at_pickup"].includes(l.stage) && !l.documents.some((d) => d.type === "rate_confirmation"),
  },
  { key: "nopod", label: "Delivered, no POD", test: (l) => l.stage === "delivered" && !l.documents.some((d) => d.type === "pod") },
];

interface SavedView {
  name: string;
  filter: LoadFilter;
}

const keyFor = (carrierId: string, what: "now" | "views") => `backroute.loads.${what}.${carrierId}`;

function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function keep(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

/** The Loads filters, remembered on this device: the page opens the way it was left. */
export function useLoadFilters(carrierId: string) {
  const [filter, setFilterState] = useState<LoadFilter>(EMPTY);
  const [views, setViews] = useState<SavedView[]>([]);
  useEffect(() => {
    // Read after mount: the server can't see this device's storage.
    const id = setTimeout(() => {
      setFilterState({ ...EMPTY, ...load<Partial<LoadFilter>>(keyFor(carrierId, "now"), {}) });
      setViews(load<SavedView[]>(keyFor(carrierId, "views"), []));
    }, 0);
    return () => clearTimeout(id);
  }, [carrierId]);
  const setFilter = (next: LoadFilter) => {
    setFilterState(next);
    keep(keyFor(carrierId, "now"), next);
  };
  const saveView = (name: string) => {
    const next = [...views.filter((v) => v.name !== name), { name, filter: { ...filter, view: "" } }].slice(-8);
    setViews(next);
    keep(keyFor(carrierId, "views"), next);
  };
  const removeView = (name: string) => {
    const next = views.filter((v) => v.name !== name);
    setViews(next);
    keep(keyFor(carrierId, "views"), next);
  };
  return { filter, setFilter, views, saveView, removeView };
}

export function filterLoads(loads: Load[], f: LoadFilter, brokers: Map<string, Broker>, trucks: Map<string, Truck>, now: number): Load[] {
  const text = f.text.trim().toLowerCase();
  const view = BUILT_IN.find((v) => v.key === f.view);
  return loads.filter((l) => {
    if (view && !view.test(l, now)) return false;
    if (f.truckId && l.truckId !== f.truckId) return false;
    if (f.brokerId && l.brokerId !== f.brokerId) return false;
    if (f.days && now - Date.parse(l.updatedAt) > f.days * DAY) return false;
    if (text) {
      const hay = [l.referenceNumber, l.lane.origin, l.lane.originState, l.lane.destination, l.lane.destState, brokers.get(l.brokerId)?.company, l.truckId ? trucks.get(l.truckId)?.unitNumber : ""].join(" ").toLowerCase();
      if (!text.split(/\s+/).every((w) => hay.includes(w))) return false;
    }
    return true;
  });
}

export const isFiltered = (f: LoadFilter) => !!(f.text || f.truckId || f.brokerId || f.days || f.view);

const control = "h-9 rounded-full border border-line bg-white px-3 text-sm text-ink-900 outline-none focus:border-ink-400";

export function LoadFilterBar({
  filter,
  setFilter,
  views,
  saveView,
  removeView,
  brokers,
  trucks,
  shown,
  total,
}: ReturnType<typeof useLoadFilters> & { brokers: Broker[]; trucks: Truck[]; shown: number; total: number }) {
  const [naming, setNaming] = useState<string | null>(null);
  const set = (patch: Partial<LoadFilter>) => setFilter({ ...filter, ...patch });
  return (
    <div className="mt-4 flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative min-w-[12rem] flex-1 sm:max-w-xs">
          <span className="sr-only">Search loads</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-400" />
          <input value={filter.text} onChange={(e) => set({ text: e.target.value })} placeholder="Load #, city or broker" className={cn(control, "w-full pl-8")} />
        </label>
        <select aria-label="Truck" value={filter.truckId} onChange={(e) => set({ truckId: e.target.value })} className={control}>
          <option value="">All trucks</option>
          {trucks.map((t) => (
            <option key={t.id} value={t.id}>
              {t.unitNumber}
            </option>
          ))}
        </select>
        <select aria-label="Broker" value={filter.brokerId} onChange={(e) => set({ brokerId: e.target.value })} className={cn(control, "max-w-[12rem]")}>
          <option value="">All brokers</option>
          {brokers.map((b) => (
            <option key={b.id} value={b.id}>
              {b.company}
            </option>
          ))}
        </select>
        <select aria-label="When" value={filter.days} onChange={(e) => set({ days: Number(e.target.value) })} className={control}>
          <option value={0}>Any time</option>
          <option value={7}>Last 7 days</option>
          <option value={30}>Last 30 days</option>
          <option value={90}>Last 90 days</option>
        </select>
        {isFiltered(filter) && (
          <button type="button" onClick={() => setFilter(EMPTY)} className="flex h-9 items-center gap-1 rounded-full px-3 text-xs font-medium text-ink-500 hover:text-ink-950">
            <X className="h-3.5 w-3.5" /> Clear
          </button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Views">
        {BUILT_IN.map((v) => (
          <button
            key={v.key}
            type="button"
            aria-pressed={filter.view === v.key}
            onClick={() => set({ view: filter.view === v.key ? "" : v.key })}
            className={cn("rounded-full border px-3 py-1 text-xs font-medium", filter.view === v.key ? "border-ink-950 bg-ink-950 text-white" : "border-line text-ink-700 hover:border-ink-400")}
          >
            {v.label}
          </button>
        ))}
        {views.map((v) => (
          <span key={v.name} className="flex items-center rounded-full border border-line text-xs font-medium text-ink-700">
            <button type="button" onClick={() => setFilter(v.filter)} className="flex items-center gap-1 py-1 pl-3 pr-1 hover:text-ink-950">
              <Bookmark className="h-3 w-3" /> {v.name}
            </button>
            <button type="button" aria-label={`Remove the ${v.name} view`} onClick={() => removeView(v.name)} className="rounded-full p-1 pr-2 text-ink-400 hover:text-ink-950">
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
        {isFiltered(filter) &&
          (naming === null ? (
            <button type="button" onClick={() => setNaming("")} className="rounded-full px-2 py-1 text-xs font-medium text-ink-500 hover:text-ink-950">
              + Save this view
            </button>
          ) : (
            <form
              className="flex items-center gap-1"
              onSubmit={(e) => {
                e.preventDefault();
                if (naming.trim()) saveView(naming.trim().slice(0, 30));
                setNaming(null);
              }}
            >
              <input autoFocus aria-label="View name" value={naming} onChange={(e) => setNaming(e.target.value)} placeholder="Name it" className="h-7 w-32 rounded-full border border-line bg-white px-2.5 text-xs outline-none focus:border-ink-400" />
              <button type="submit" className="rounded-full bg-ink-950 px-2.5 py-1 text-xs font-medium text-white">
                Save
              </button>
            </form>
          ))}
        {isFiltered(filter) && (
          <span className="ml-auto text-xs text-ink-500">
            {shown} of {total}
          </span>
        )}
      </div>
    </div>
  );
}
