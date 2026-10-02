"use client";

import { Button } from "@/components/ui/button";
import { useCarrierLoads } from "@/lib/selectors";
import { useStore } from "@/lib/store";

/**
 * An empty screen that says why it's empty and what one thing to do: in a real account, while no broker emails or
 * load board offers have come in, the way to get them coming.
 */
export function EmptyNextStep({ what, fallback }: { what: string; fallback: string }) {
  const real = useStore((s) => s.session.mode !== "demo");
  const loads = useCarrierLoads();
  const trucks = useStore((s) => s.trucks);
  const offersEver = loads.some((l) => !l.imported && (l.offerEmail || l.source?.startsWith("Email from") || l.source?.includes("·")));
  if (!real) return <p className="py-12 text-center text-sm text-ink-500">{fallback}</p>;
  const step = !trucks.length
    ? { why: `No ${what} yet: the AI needs a truck to find loads for.`, label: "Add a truck", href: "/carrier/fleet" }
    : !offersEver
      ? { why: `No ${what} yet: no load offers have reached the AI. Forward a broker's email to your Backroute address, or connect a load board.`, label: "Get loads coming in", href: "/carrier/settings?tab=general" }
      : { why: fallback, label: "See all loads", href: "/carrier/loads" };
  return (
    <div className="flex flex-col items-center gap-3 px-4 py-12 text-center">
      <p className="max-w-md text-sm text-ink-700">{step.why}</p>
      <Button href={step.href} size="sm" variant="primary">
        {step.label}
      </Button>
    </div>
  );
}
