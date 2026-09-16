"use client";

import { useState } from "react";
import { Handshake, Home, Sparkles } from "lucide-react";
import { cn, formatCurrency } from "@/lib/utils";
import type { Broker, Load } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { LoadScoreBadge } from "./load-score";

export function LoadOfferCard({
  load,
  broker,
  onSelect,
  onNegotiate,
  compact,
}: {
  load: Load;
  broker: Broker | undefined;
  onSelect: () => void;
  /** Ask the AI to go back to the broker for a better number before committing — updates the card's numbers live. */
  onNegotiate?: () => void;
  compact?: boolean;
}) {
  const [asking, setAsking] = useState(false);

  function handleNegotiate() {
    if (!onNegotiate || asking) return;
    setAsking(true);
    setTimeout(() => {
      onNegotiate();
      setAsking(false);
    }, 900);
  }

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
          <LoadScoreBadge score={load.score} invert={load.recommended} />
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

      <div className="grid grid-cols-2 gap-2">
        <Stat label="Est. net (after our 2%)" value={formatCurrency(load.netProfit ?? 0)} dark={load.recommended} pulse={asking} />
        <Stat label="Rate / mi" value={`$${(load.rpm ?? 0).toFixed(2)}`} dark={load.recommended} pulse={asking} />
        <Stat label="Pickup" value={load.pickupWindow.split(",")[0]} dark={load.recommended} />
        <Stat label="Our commission" value={formatCurrency(load.commission)} dark={load.recommended} />
      </div>

      <div className="flex gap-2">
        {onNegotiate && (
          <Button
            size={compact ? "sm" : "md"}
            variant={load.recommended ? "secondary" : "outline"}
            className={load.recommended ? "!bg-white/15 !text-white hover:!bg-white/25" : ""}
            onClick={handleNegotiate}
            disabled={asking}
          >
            <Handshake className="h-3.5 w-3.5" /> {asking ? "Asking broker…" : "Ask for better price"}
          </Button>
        )}
        <Button
          size={compact ? "sm" : "md"}
          variant={load.recommended ? "secondary" : "primary"}
          className={cn(load.recommended ? "!bg-white !text-ink-950 hover:!bg-white/90" : "", "flex-1")}
          onClick={onSelect}
        >
          Select this load
        </Button>
      </div>
    </div>
  );
}

function Stat({ label, value, dark, pulse }: { label: string; value: string; dark?: boolean; pulse?: boolean }) {
  return (
    <div className={cn("rounded-xl px-2.5 py-2", dark ? "bg-white/10" : "bg-ink-50", pulse && "animate-pulse")}>
      <p className={cn("text-[10px] uppercase tracking-wide", dark ? "text-white/50" : "text-ink-400")}>{label}</p>
      <p className={cn("mt-0.5 text-xs font-semibold tabular", dark ? "text-white" : "text-ink-950")}>{value}</p>
    </div>
  );
}
