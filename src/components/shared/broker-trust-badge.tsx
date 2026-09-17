"use client";

import { ShieldAlert, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Broker } from "@/lib/types";

/** Broker Shield AI: screens every broker for FMCSA authority + fraud risk before the AI will negotiate with them. Included free with every plan. */
export function BrokerTrustBadge({ broker, className }: { broker: Broker; className?: string }) {
  if (!broker.authorityVerified) {
    return (
      <span className={cn("inline-flex items-center gap-1 text-[10px] font-medium text-[var(--accent-danger)]", className)}>
        <ShieldAlert className="h-3 w-3" /> Authority unverified
      </span>
    );
  }
  if (broker.fraudRisk !== "low") {
    return (
      <span className={cn("inline-flex items-center gap-1 text-[10px] font-medium text-[var(--accent-warn)]", className)}>
        <ShieldAlert className="h-3 w-3" /> {broker.fraudRisk === "high" ? "High" : "Elevated"} fraud risk
      </span>
    );
  }
  return (
    <span className={cn("inline-flex items-center gap-1 text-[10px] font-medium text-[var(--accent-live)]", className)}>
      <ShieldCheck className="h-3 w-3" /> Verified by Broker Shield
    </span>
  );
}
