"use client";

import { useState } from "react";
import { GraduationCap } from "lucide-react";
import { laneKey } from "@/lib/agent/pricing";
import { useStore } from "@/lib/store";
import type { Load } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * "Teach the AI" on a load: one tap turns what the owner thinks about it into a rule the AI follows from now on:
 * never this broker, never below a rate on this lane, get this driver home first. Each is undone the same way it
 * was set (Brokers, Settings, the driver's page).
 */
export function TeachAi({ load, className }: { load: Load; className?: string }) {
  const real = useStore((s) => s.session.mode !== "demo");
  const settings = useStore((s) => s.settings);
  const broker = useStore((s) => s.brokers.find((b) => b.id === load.brokerId));
  const truck = useStore((s) => s.trucks.find((t) => t.id === load.truckId));
  const driver = useStore((s) => s.drivers.find((d) => d.id === truck?.driverId));
  const updateSettings = useStore((s) => s.actions.updateSettings);
  const setBrokerPolicy = useStore((s) => s.actions.setBrokerPolicy);
  const setHomePriority = useStore((s) => s.actions.setHomePriority);
  const key = laneKey(load.lane);
  const current = settings.laneFloors?.[key];
  const rpm = load.lane.miles ? (load.bookedRate ?? load.targetRate) / load.lane.miles : 0;
  const [open, setOpen] = useState<null | "lane">(null);
  const [floor, setFloor] = useState((current ?? Math.max(settings.minRpm ?? 0, Math.round(rpm * 20) / 20 || 2)).toFixed(2));
  const [done, setDone] = useState<string | null>(null);
  if (!real) return null;

  const blocked = broker && settings.brokerOverrides?.[broker.id] === "block";
  const chip = "min-h-11 rounded-full border border-line px-3 py-1.5 text-xs font-medium text-ink-800 hover:bg-ink-50 disabled:opacity-50 sm:min-h-0";

  function saveFloor() {
    const n = Number(floor);
    if (!(n >= 0.5 && n <= 15)) return;
    updateSettings({ laneFloors: { ...settings.laneFloors, [key]: Math.round(n * 100) / 100 } });
    setOpen(null);
    setDone(`Done: the AI won't take less than $${n.toFixed(2)}/mi from ${load.lane.originState} to ${load.lane.destState}.`);
  }

  return (
    <div className={cn("rounded-2xl border border-dashed border-line-strong p-3", className)}>
      <p className="flex items-center gap-1.5 text-xs font-semibold text-ink-700">
        <GraduationCap className="h-3.5 w-3.5" /> Teach the AI
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        {broker && (
          <button
            type="button"
            className={chip}
            disabled={!!blocked}
            onClick={() => {
              setBrokerPolicy(broker.id, "block");
              setDone(`Done: no more loads from ${broker.company}. Undo it on the Brokers page.`);
            }}
          >
            {blocked ? `${broker.company}: never` : `Never ${broker.company}`}
          </button>
        )}
        <button type="button" className={chip} onClick={() => setOpen(open === "lane" ? null : "lane")}>
          {current ? `${load.lane.originState} → ${load.lane.destState}: at least $${current.toFixed(2)}/mi` : `Lowest rate on ${load.lane.originState} → ${load.lane.destState}`}
        </button>
        {driver && (
          <button
            type="button"
            className={chip}
            disabled={!!driver.homePriority}
            onClick={() => {
              setHomePriority(driver.id, true);
              setDone(`Done: the AI picks loads that get ${driver.name.split(" ")[0]} home first.`);
            }}
          >
            {driver.homePriority ? `${driver.name.split(" ")[0]}: home first` : `Get ${driver.name.split(" ")[0]} home first`}
          </button>
        )}
      </div>
      {open === "lane" && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1.5 text-sm text-ink-800">
            Never below $
            <input aria-label="Lowest rate per mile on this lane" inputMode="decimal" className="w-20 rounded-lg border border-line px-2 py-1.5 text-sm tabular outline-none focus:border-ink-400" value={floor} onChange={(e) => setFloor(e.target.value.replace(/[^\d.]/g, ""))} />
            /mi on this lane
          </label>
          <button type="button" className="min-h-11 rounded-full bg-ink-950 px-3 py-1.5 text-xs font-medium text-white sm:min-h-0" onClick={saveFloor}>
            Save
          </button>
        </div>
      )}
      {done && (
        <p className="mt-2 text-xs text-ink-700" role="status">
          {done}
        </p>
      )}
    </div>
  );
}
