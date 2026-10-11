"use client";

import { useEffect, useState } from "react";
import { Type } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { usePagesText } from "@/lib/lang/pages-ui";
import { CONTRAST_KEY, TEXT_KEY } from "@/lib/theme-script";
import { cn } from "@/lib/utils";

type Size = "normal" | "large" | "xl";

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function write(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Storage blocked: it still applies until the app closes.
  }
}

/**
 * Bigger text and higher contrast for this phone: older eyes, a cab in full sun. Applied to the whole app at once (the
 * root font size and the grey tones), kept on this device, and set before the first paint on the next open.
 */
export function ReadingCard() {
  const p = usePagesText();
  const [size, setSize] = useState<Size>("normal");
  const [high, setHigh] = useState(false);
  useEffect(() => {
    const t = read(TEXT_KEY);
    // Read once after mount: the server render can't know this device's choice.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSize(t === "large" || t === "xl" ? t : "normal");
    setHigh(read(CONTRAST_KEY) === "high");
  }, []);

  function pickSize(next: Size) {
    setSize(next);
    write(TEXT_KEY, next === "normal" ? null : next);
    if (next === "normal") document.documentElement.removeAttribute("data-text");
    else document.documentElement.setAttribute("data-text", next);
  }
  function pickContrast(on: boolean) {
    setHigh(on);
    write(CONTRAST_KEY, on ? "high" : null);
    if (on) document.documentElement.setAttribute("data-contrast", "high");
    else document.documentElement.removeAttribute("data-contrast");
  }

  return (
    <section className="rounded-2xl border border-line p-4">
      <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-ink-400">
        <Type className="h-3.5 w-3.5" /> {p.reading.title}
      </p>
      <p className="mt-3 text-xs font-medium text-ink-700">{p.reading.size}</p>
      <div className="mt-2 grid grid-cols-3 gap-2" role="radiogroup" aria-label={p.reading.size}>
        {(["normal", "large", "xl"] as const).map((s, i) => (
          <button
            key={s}
            type="button"
            role="radio"
            aria-checked={size === s}
            onClick={() => pickSize(s)}
            className={cn("min-h-11 rounded-xl px-2 font-semibold", ["text-xs", "text-sm", "text-base"][i], size === s ? "bg-ink-950 text-white" : "bg-ink-100 text-ink-700")}
          >
            {p.reading[s]}
          </button>
        ))}
      </div>
      <div className="mt-4 flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-ink-950">{p.reading.contrast}</p>
          <p className="text-xs text-ink-500">{p.reading.contrastNote}</p>
        </div>
        <Switch checked={high} onChange={pickContrast} label={p.reading.contrast} />
      </div>
    </section>
  );
}
