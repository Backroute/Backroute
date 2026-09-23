"use client";

import { cn } from "@/lib/utils";

export function Switch({ checked, onChange, label, dark }: { checked: boolean; onChange: (v: boolean) => void; label?: string; dark?: boolean }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative h-6 w-11 shrink-0 rounded-full transition-colors duration-200",
        dark ? (checked ? "bg-[var(--accent-live)]" : "bg-white/20") : checked ? "bg-ink-950" : "bg-ink-200",
      )}
    >
      <span
        className={cn(
          "absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform duration-200",
          checked && "translate-x-5",
        )}
      />
    </button>
  );
}
