"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cloudEnabled } from "@/lib/cloud/client";
import { useSyncExternalStore } from "react";
import { exitDemo, inSample } from "@/lib/cloud/demo";
import { cn } from "@/lib/utils";

/** A thin strip on every demo screen: says it's sample data, and switches between the owner's and driver's side. */
export function DemoBanner() {
  const pathname = usePathname();
  const sample = useSyncExternalStore(
    () => () => {},
    inSample,
    () => false,
  );
  if (sample)
    return (
      <div role="note" aria-label="Sample fleet" className="flex w-full flex-wrap items-center justify-center gap-x-3 gap-y-1 border-b border-line bg-ink-50 px-4 py-1.5 text-xs text-ink-600">
        <span>
          <span className="font-semibold text-ink-950">Sample fleet.</span> Made-up trucks and loads. Nothing is saved or sent.
        </span>
        <button type="button" onClick={() => exitDemo("/carrier")} className="font-medium text-[var(--action)] hover:underline">
          Back to my fleet
        </button>
      </div>
    );
  const views = [
    { href: "/carrier", label: "Owner" },
    { href: "/driver", label: "Driver" },
  ];
  return (
    <div role="note" aria-label="Demo" className="flex w-full flex-wrap items-center justify-center gap-x-3 gap-y-1 border-b border-line bg-ink-50 px-4 py-1.5 text-xs text-ink-600">
      <span>
        <span className="font-semibold text-ink-950">Demo.</span> A sample fleet. Nothing is saved or sent.
      </span>
      <span className="flex items-center rounded-full bg-ink-150 p-0.5">
        {views.map((v) => (
          <Link
            key={v.href}
            href={v.href}
            aria-current={pathname.startsWith(v.href) ? "page" : undefined}
            className={cn("rounded-full px-2.5 py-0.5 font-medium", pathname.startsWith(v.href) ? "bg-white text-ink-950 shadow-sm" : "text-ink-600 hover:text-ink-950")}
          >
            {v.label}
          </Link>
        ))}
      </span>
      {cloudEnabled && (
        <button type="button" onClick={() => exitDemo()} className="font-medium text-[var(--action)] hover:underline">
          Exit demo
        </button>
      )}
    </div>
  );
}
