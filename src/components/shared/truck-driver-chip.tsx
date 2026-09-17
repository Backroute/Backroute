"use client";

import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { Driver, HosStatus, Truck } from "@/lib/types";

const HOS_TONE: Record<HosStatus, "success" | "neutral" | "info" | "warning"> = {
  driving: "success",
  on_duty: "info",
  off_duty: "neutral",
  sleeper: "warning",
};

/** Shows which truck/driver something belongs to — used wherever a load, offer, negotiation, or escalation needs that context at a glance. */
export function TruckDriverChip({
  truck,
  driver,
  trailing,
  className,
}: {
  truck?: Truck;
  driver?: Driver;
  trailing?: React.ReactNode;
  className?: string;
}) {
  if (!truck && !driver) return null;

  return (
    <div className={cn("flex items-center gap-2.5 rounded-xl bg-ink-50 px-3 py-2", className)}>
      <Avatar name={driver?.name ?? truck?.unitNumber ?? "?"} size="sm" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-semibold text-ink-900">
          {truck?.unitNumber ?? "Unassigned truck"}
          {driver && ` · ${driver.name}`}
        </p>
        <p className="truncate text-[11px] text-ink-500">
          {truck ? `${truck.equipmentType} · ${truck.currentCity}, ${truck.currentState}` : "No driver assigned"}
        </p>
      </div>
      {driver && (
        <Badge tone={HOS_TONE[driver.hosStatus]} className="shrink-0">
          {driver.hosStatus.replace("_", " ")}
        </Badge>
      )}
      {trailing}
    </div>
  );
}
