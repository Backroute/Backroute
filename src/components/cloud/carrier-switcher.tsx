"use client";

import { Building2, Plus } from "lucide-react";
import { chooseCarrier, chosenCarrier, useMemberships } from "@/lib/cloud/account";
import { useStore } from "@/lib/store";

/**
 * For someone in more than one carrier (a dispatch service, an owner with two companies): which one they're working
 * in, and a way to add another. Switching reloads the app so nothing from one carrier is left in the other's screens.
 */
export function CarrierSwitcher() {
  const list = useMemberships((s) => s.list);
  const signedIn = useStore((s) => s.session.mode !== "demo");
  if (!signedIn) return null;
  const office = list.filter((m) => m.role !== "driver");
  const current = chosenCarrier() ?? list[0]?.carrierId;
  const owner = office.some((m) => m.role === "owner");
  if (office.length < 2 && !owner) return null;
  return (
    <div className="mb-2 flex flex-col gap-1.5">
      {office.length > 1 && (
        <label className="flex items-center gap-2 rounded-xl border border-line px-3 py-2 text-xs text-ink-600">
          <Building2 className="h-3.5 w-3.5 shrink-0" />
          <span className="sr-only">Company</span>
          <select
            className="min-w-0 flex-1 bg-transparent text-xs font-medium text-ink-900 outline-none"
            value={current}
            onChange={(e) => {
              chooseCarrier(e.target.value);
              // eslint-disable-next-line @next/next/no-location-assign-relative-destination
              window.location.assign("/carrier");
            }}
          >
            {office.map((m) => (
              <option key={m.carrierId} value={m.carrierId}>
                {m.carrierName || "Carrier"}
              </option>
            ))}
          </select>
        </label>
      )}
      {owner && (
        <a href="/signup?another=1" className="flex items-center gap-1.5 px-1 text-xs font-medium text-ink-500 hover:text-ink-950">
          <Plus className="h-3 w-3" /> Add another company
        </a>
      )}
    </div>
  );
}
