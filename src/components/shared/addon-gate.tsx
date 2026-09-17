"use client";

import { Lock } from "lucide-react";
import { useStore } from "@/lib/store";
import { addonById } from "@/lib/addons";
import { Button } from "@/components/ui/button";

/** Wraps a feature behind an AI add-on — shows the upsell if it isn't enabled yet, the feature itself if it is. */
export function AddonGate({ addonId, children }: { addonId: string; children: React.ReactNode }) {
  const enabled = useStore((s) => s.settings.enabledAddons.includes(addonId));
  const toggleAddon = useStore((s) => s.actions.toggleAddon);
  const addon = addonById(addonId);

  if (enabled) return <>{children}</>;

  return (
    <div className="rounded-2xl border border-dashed border-line-strong bg-ink-50/50 p-8 text-center">
      <Lock className="mx-auto h-5 w-5 text-ink-400" />
      <p className="mt-3 text-sm font-semibold text-ink-950">{addon?.name ?? "This AI agent"} isn&apos;t enabled</p>
      <p className="mx-auto mt-1 max-w-sm text-xs text-ink-500">{addon?.tagline}</p>
      <Button size="sm" className="mt-4" onClick={() => toggleAddon(addonId)}>
        Enable for ${addon?.price}/mo
      </Button>
    </div>
  );
}
