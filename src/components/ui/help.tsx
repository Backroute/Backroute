"use client";

import { useEffect, useId, useRef, useState } from "react";
import { HelpCircle } from "lucide-react";
import { HELP, type HelpKey } from "@/lib/help";
import { cn } from "@/lib/utils";

/** A small "?" next to a setting: two plain lines on what it does, and an example. Tap to open, tap away to close. */
export function Help({ topic, className }: { topic: HelpKey; className?: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const ref = useRef<HTMLSpanElement>(null);
  const h = HELP[topic];
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | TouchEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("touchstart", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("touchstart", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);
  return (
    <span ref={ref} className={cn("relative inline-flex align-middle", className)}>
      <button
        type="button"
        aria-label={`What is "${h.title}"?`}
        aria-expanded={open}
        aria-controls={id}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        className="flex h-6 w-6 items-center justify-center rounded-full text-ink-400 hover:bg-ink-100 hover:text-ink-700"
      >
        <HelpCircle className="h-4 w-4" />
      </button>
      {open && (
        <span id={id} role="note" className="absolute left-0 top-7 z-30 w-72 max-w-[calc(100vw-2rem)] rounded-xl border border-line bg-white p-3 text-left text-xs font-normal leading-relaxed text-ink-700 shadow-xl">
          <span className="block">{h.what}</span>
          <span className="mt-1.5 block text-ink-500">
            <span className="font-medium text-ink-700">Example:</span> {h.example}
          </span>
        </span>
      )}
    </span>
  );
}
