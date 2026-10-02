"use client";

import { useRef } from "react";
import { useLargeTitle } from "@/lib/large-title";

/** A page's big name; it hands over to the small one in the top bar once it scrolls away. */
export function LargeTitle({ children, title, className, offset }: { children: React.ReactNode; title?: string; className?: string; offset?: number }) {
  const ref = useRef<HTMLHeadingElement>(null);
  useLargeTitle(ref, title ?? (typeof children === "string" ? children : ""), offset);
  return (
    <h1 ref={ref} className={className ?? "t-page text-ink-950"}>
      {children}
    </h1>
  );
}
