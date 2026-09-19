"use client";

import { Lock } from "lucide-react";
import { useStore } from "@/lib/store";
import { addonById } from "@/lib/addons";
import { Button } from "@/components/ui/button";

/** Wraps a free, opt-in AI agent that earns Backroute a partner referral commission instead of charging the carrier. */
export function AddonGate({ addonId, children }: { addonId: string; children: React.ReactNode }) {
  const enabled = useStore((s) => s.settings.enabledAddons.includes(addonId));
  const toggleAddon = useStore((s) => s.actions.toggleAddon);
  const addon = addonById(addonId);

  if (enabled) return <>{children}</>;

  return (
    <div className="rounded-2xl border border-dashed border-line-strong bg-ink-50/50 p-8 text-center">
      <Lock className="mx-auto h-5 w-5 text-ink-400" />
      <p className="mt-3 text-sm font-semibold text-ink-950">{addon?.name ?? "This AI agent"} isn&apos;t turned on</p>
      <p className="mx-auto mt-1 max-w-sm text-xs text-ink-500">{addon?.tagline}</p>
      <Button size="sm" className="mt-4" onClick={() => toggleAddon(addonId)}>
        Turn on, free
      </Button>
      {addon?.commissionNote && <p className="mx-auto mt-2 max-w-sm text-[11px] text-ink-400">{addon.commissionNote}</p>}
    </div>
  );
}
