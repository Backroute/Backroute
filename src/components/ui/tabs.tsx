"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

export function Tabs({
  tabs,
  active,
  onChange,
  className,
}: {
  tabs: { key: string; label: string; count?: number }[];
  active: string;
  onChange: (key: string) => void;
  className?: string;
}) {
  const row = useRef<HTMLDivElement>(null);
  // On a phone the row can run past the edge: a fade on the side with more tabs says so, and the picked tab scrolls in.
  const [more, setMore] = useState({ left: false, right: false });
  useEffect(() => {
    const el = row.current;
    if (!el) return;
    const look = () => setMore({ left: el.scrollLeft > 4, right: el.scrollLeft + el.clientWidth < el.scrollWidth - 4 });
    look();
    el.querySelector<HTMLElement>('[aria-pressed="true"]')?.scrollIntoView({ block: "nearest", inline: "nearest" });
    el.addEventListener("scroll", look, { passive: true });
    window.addEventListener("resize", look);
    return () => {
      el.removeEventListener("scroll", look);
      window.removeEventListener("resize", look);
    };
  }, [active, tabs.length]);

  return (
    <div className={cn("relative", className)}>
    <div ref={row} className="flex items-center gap-1 overflow-x-auto no-scrollbar">
      {tabs.map((tab) => (
        <button
          key={tab.key}
          type="button"
          aria-pressed={active === tab.key}
          onClick={() => onChange(tab.key)}
          className={cn(
            "flex items-center gap-1.5 whitespace-nowrap rounded-full px-3.5 py-2 text-sm font-medium transition-colors",
            active === tab.key ? "bg-ink-950 text-white" : "text-ink-600 hover:bg-ink-100",
          )}
        >
          {tab.label}
          {typeof tab.count === "number" && (
            <span
              className={cn(
                "rounded-full px-1.5 text-xs tabular",
                active === tab.key ? "bg-white/20 text-white" : "bg-ink-150 text-ink-600",
              )}
            >
              {tab.count}
            </span>
          )}
        </button>
      ))}
    </div>
      {more.left && <span aria-hidden className="pointer-events-none absolute inset-y-0 left-0 w-8 bg-gradient-to-r from-[var(--background)] to-transparent" />}
      {more.right && <span aria-hidden className="pointer-events-none absolute inset-y-0 right-0 w-10 bg-gradient-to-l from-[var(--background)] to-transparent" />}
    </div>
  );
}
