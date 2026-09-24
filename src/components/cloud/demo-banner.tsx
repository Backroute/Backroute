"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cloudEnabled } from "@/lib/cloud/client";
import { exitDemo } from "@/lib/cloud/demo";
import { cn } from "@/lib/utils";

/** A thin strip on every demo screen: says it's sample data, and switches between the owner's and driver's side. */
export function DemoBanner() {
  const pathname = usePathname();
  const views = [
    { href: "/carrier", label: "Owner dashboard" },
    { href: "/driver", label: "Driver app" },
  ];
  return (
    <div role="note" aria-label="Demo" className="flex w-full flex-wrap items-center justify-center gap-x-3 gap-y-1 bg-amber-100 px-4 py-1.5 text-xs text-amber-950">
      <span>
        <span className="font-semibold">Demo</span> · sample fleet, nothing is saved or sent
      </span>
      <span className="flex items-center gap-1">
        {views.map((v) => (
          <Link
            key={v.href}
            href={v.href}
            className={cn("rounded-full px-2 py-0.5 font-medium", pathname.startsWith(v.href) ? "bg-amber-950 text-amber-50" : "underline")}
          >
            {v.label}
          </Link>
        ))}
        {cloudEnabled && (
          <button type="button" onClick={() => exitDemo()} className="ml-1 rounded-full px-2 py-0.5 font-medium underline">
            Exit demo
          </button>
        )}
      </span>
    </div>
  );
}
