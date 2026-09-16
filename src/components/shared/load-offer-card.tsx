import { Home, Sparkles } from "lucide-react";
import { cn, formatCurrency } from "@/lib/utils";
import type { Broker, Load } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export function LoadOfferCard({
  load,
  broker,
  onSelect,
  compact,
}: {
  load: Load;
  broker: Broker | undefined;
  onSelect: () => void;
  compact?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-3 rounded-2xl border p-4",
        load.recommended ? "border-ink-950 bg-ink-950 text-white" : "border-line bg-white",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className={cn("text-sm font-medium", load.recommended ? "text-white" : "text-ink-950")}>
            {load.lane.origin}, {load.lane.originState}
            <span className={load.recommended ? "text-white/40" : "text-ink-300"}> → </span>
            {load.lane.destination}, {load.lane.destState}
          </p>
          <p className={cn("mt-0.5 text-xs", load.recommended ? "text-white/60" : "text-ink-500")}>
            {broker?.company ?? "Broker"} · {load.equipmentType} · {load.lane.miles} mi
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          {load.recommended && (
            <Badge tone="dark" className="!bg-white/15 !text-white gap-1">
              <Sparkles className="h-3 w-3" /> AI pick
            </Badge>
          )}
          {load.homeTimeFit && (
            <Badge tone={load.recommended ? "dark" : "info"} className={load.recommended ? "!bg-white/15 !text-white gap-1" : "gap-1"}>
              <Home className="h-3 w-3" /> Home-time fit
            </Badge>
          )}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <Stat label="Est. net" value={formatCurrency(load.netProfit ?? 0)} dark={load.recommended} />
        <Stat label="Rate / mi" value={`$${(load.rpm ?? 0).toFixed(2)}`} dark={load.recommended} />
        <Stat label="Pickup" value={load.pickupWindow.split(",")[0]} dark={load.recommended} />
      </div>

      <Button
        size={compact ? "sm" : "md"}
        variant={load.recommended ? "secondary" : "primary"}
        className={load.recommended ? "!bg-white !text-ink-950 hover:!bg-white/90 w-full" : "w-full"}
        onClick={onSelect}
      >
        Select this load
      </Button>
    </div>
  );
}

function Stat({ label, value, dark }: { label: string; value: string; dark?: boolean }) {
  return (
    <div className={cn("rounded-xl px-2.5 py-2", dark ? "bg-white/10" : "bg-ink-50")}>
      <p className={cn("text-[10px] uppercase tracking-wide", dark ? "text-white/50" : "text-ink-400")}>{label}</p>
      <p className={cn("mt-0.5 text-xs font-semibold tabular", dark ? "text-white" : "text-ink-950")}>{value}</p>
    </div>
  );
}
