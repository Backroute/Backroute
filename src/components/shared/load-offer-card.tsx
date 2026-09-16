"use client";

import { useState } from "react";
import { Handshake, Home, Sparkles, Zap } from "lucide-react";
import { cn, formatCurrency } from "@/lib/utils";
import { loadHighlight } from "@/lib/scoring";
import type { Broker, Load } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { LoadScoreBadge } from "./load-score";
import { TimeAgo } from "./time-ago";

const TIER_TONE = { preferred: "success", standard: "neutral", watch: "warning" } as const;

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

  const highlight = loadHighlight({
    rpm: load.rpm ?? 0,
    marketRpm: load.lane.marketRpm,
    deadheadMiles: load.deadheadMiles,
    miles: load.lane.miles,
    brokerReliability: broker?.reliability ?? 70,
    brokerTier: broker?.tier ?? "standard",
  });

  return (
    <div
      className={cn(
        "flex flex-col gap-3.5 rounded-2xl border p-4",
        load.recommended ? "border-ink-950 bg-ink-950 text-white" : "border-line bg-white",
      )}
    >
      <div className="flex items-start gap-3">
        <LoadScoreBadge score={load.score} size="xl" invert={load.recommended} />
        <div className="min-w-0 flex-1">
          <p className={cn("text-sm font-semibold", load.recommended ? "text-white" : "text-ink-950")}>
            {load.lane.origin}, {load.lane.originState}
            <span className={load.recommended ? "text-white/40" : "text-ink-300"}> → </span>
            {load.lane.destination}, {load.lane.destState}
          </p>
          <p className={cn("mt-0.5 flex flex-wrap items-center gap-1 text-xs", load.recommended ? "text-white/60" : "text-ink-500")}>
            {broker?.company ?? "Broker"}
            {broker && (
              <Badge tone={load.recommended ? "dark" : TIER_TONE[broker.tier]} className={cn("!text-[10px] !px-1.5 !py-0", load.recommended && "!bg-white/15 !text-white")}>
                {broker.tier}
              </Badge>
            )}
            <span>· {load.equipmentType} · {load.lane.miles} mi</span>
          </p>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
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
      </div>

      <p className={cn("flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium", load.recommended ? "bg-white/10 text-white/80" : "bg-ink-50 text-ink-600")}>
        <Zap className="h-3 w-3 shrink-0" /> {highlight}
      </p>

      <div className="grid grid-cols-2 gap-2">
        <Stat label="Est. net (after our 2%)" value={formatCurrency(load.netProfit ?? 0)} dark={load.recommended} pulse={asking} emphasize />
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
          size={compact ? "md" : "lg"}
          variant={load.recommended ? "secondary" : "primary"}
          className={cn(load.recommended ? "!bg-white !text-ink-950 hover:!bg-white/90" : "", "flex-1 !font-semibold")}
          onClick={onSelect}
        >
          Select this load
        </Button>
      </div>

      <p className={cn("text-center text-[10px]", load.recommended ? "text-white/35" : "text-ink-300")}>
        Sourced from {load.source} · <TimeAgo iso={load.createdAt} />
      </p>
    </div>
  );
}

function Stat({ label, value, dark, pulse, emphasize }: { label: string; value: string; dark?: boolean; pulse?: boolean; emphasize?: boolean }) {
  return (
    <div className={cn("rounded-xl px-2.5 py-2", dark ? "bg-white/10" : "bg-ink-50", pulse && "animate-pulse")}>
      <p className={cn("text-[10px] uppercase tracking-wide", dark ? "text-white/50" : "text-ink-400")}>{label}</p>
      <p className={cn("mt-0.5 tabular font-semibold", emphasize ? "text-base" : "text-xs", dark ? "text-white" : "text-ink-950")}>{value}</p>
    </div>
  );
}
