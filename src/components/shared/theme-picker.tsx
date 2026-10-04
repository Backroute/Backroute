"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { setTheme, useThemeChoice, type ThemeChoice } from "@/lib/theme";
import { cn } from "@/lib/utils";

const OPTIONS: { value: ThemeChoice; label: string; icon: typeof Sun }[] = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "Auto", icon: Monitor },
];

/** Light, dark, or follow the phone. Saved on this device only. */
export function ThemePicker({ className, compact }: { className?: string; compact?: boolean }) {
  const choice = useThemeChoice();
  return (
    <div role="radiogroup" aria-label="Appearance" className={cn("grid grid-cols-3 gap-1 rounded-full bg-ink-100 p-1", className)}>
      {OPTIONS.map(({ value, label, icon: Icon }) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={choice === value}
          onClick={() => setTheme(value)}
          className={cn(
            "flex items-center justify-center gap-1.5 rounded-full font-medium transition-colors",
            compact ? "px-2 py-1 text-xs" : "px-3 py-2 text-xs",
            choice === value ? "bg-white text-ink-950 shadow-sm" : "text-ink-500 hover:text-ink-950",
          )}
        >
          <Icon className={compact ? "h-3 w-3" : "h-3.5 w-3.5"} /> {label}
        </button>
      ))}
    </div>
  );
}
