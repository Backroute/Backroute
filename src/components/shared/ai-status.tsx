"use client";

import { useEffect, useRef, useState } from "react";
import { Pause, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AUTONOMY_LABEL, useStore } from "@/lib/store";
import { useEscapeKey } from "@/lib/hooks";
import { cn } from "@/lib/utils";

type State = "paused" | "practice" | "running";

const DOT: Record<State, string> = {
  paused: "bg-[var(--dot-danger)]",
  practice: "bg-ink-400",
  running: "bg-ink-950",
};

const SHORT: Record<State, string> = {
  paused: "Paused",
  practice: "Practice",
  running: "Running",
};

/**
 * Always in the top bar: is Backroute working or stopped. A tap opens what that means and the one big switch: pause
 * everything (an emergency stop) or resume. What's waiting on the owner is counted once, on Home, not here too.
 */
export function AiStatus({ needsYou }: { needsYou: number }) {
  const paused = useStore((s) => !!s.settings.paused);
  const pausedAt = useStore((s) => s.settings.pausedAt);
  const practice = useStore((s) => !!s.settings.sandbox && s.session.mode === "office");
  const autonomy = useStore((s) => s.settings.autonomy);
  const updateSettings = useStore((s) => s.actions.updateSettings);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEscapeKey(() => setOpen(false), open);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const state: State = paused ? "paused" : practice ? "practice" : "running";
  const since = pausedAt ? new Date(pausedAt).toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit" }) : null;

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label={`${SHORT[state]}. Autopilot status and pause`}
        className={cn(
          "flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
          paused ? "border-line bg-ink-100 text-[var(--accent-danger)]" : "border-line text-ink-600 hover:border-ink-300",
        )}
      >
        <span className="relative flex h-2 w-2">
          <span className={cn("relative h-2 w-2 rounded-full", DOT[state])} />
        </span>
        <span className="hidden sm:inline">{SHORT[state]}</span>
      </button>
      {open && (
        <div role="dialog" aria-label="Autopilot status" className="absolute right-0 z-40 mt-2 w-80 rounded-2xl border border-line bg-white p-4 shadow-xl">
          <p className="t-section text-ink-950">{paused ? "Backroute is paused" : practice ? "Practice mode: nothing leaves" : "Backroute is dispatching"}</p>
          <p className="mt-1 text-xs leading-relaxed text-ink-600">
            {paused
              ? `Since ${since ?? "now"}. It keeps reading email and answering drivers, but books nothing, sends nothing to brokers and calls no broker or dock. What it would send waits in Needs you.`
              : practice
                ? "It reads and decides as usual, but no text, email or call goes out. See what it would have sent in Settings."
                : `Autopilot: ${AUTONOMY_LABEL[autonomy]}. ${needsYou ? `${needsYou} thing${needsYou === 1 ? "" : "s"} wait${needsYou === 1 ? "s" : ""} for you on Home.` : "Nothing is waiting for you."}`}
          </p>
          <div className="mt-3">
            {paused ? (
              <Button size="sm" onClick={() => (updateSettings({ paused: false, pausedAt: undefined }), setOpen(false))}>
                <Play className="h-3.5 w-3.5" /> Resume Backroute
              </Button>
            ) : (
              <Button size="sm" variant="danger" onClick={() => (updateSettings({ paused: true, pausedAt: new Date().toISOString() }), setOpen(false))}>
                <Pause className="h-3.5 w-3.5" /> Pause everything
              </Button>
            )}
          </div>
          {!paused && <p className="mt-2 text-xs text-ink-500">For an emergency, or when you want to take over for a while. Nothing is lost; resume any time.</p>}
        </div>
      )}
    </div>
  );
}

/** On Home while paused: hard to miss, one tap to resume. */
export function PausedBanner() {
  const paused = useStore((s) => !!s.settings.paused);
  const pausedAt = useStore((s) => s.settings.pausedAt);
  const updateSettings = useStore((s) => s.actions.updateSettings);
  if (!paused) return null;
  return (
    <div role="status" className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-danger-soft px-4 py-3">
      <p className="flex items-center gap-2 text-sm font-medium text-ink-900">
        <Pause className="h-4 w-4 text-[var(--accent-danger)]" />
        Backroute is paused{pausedAt ? ` since ${new Date(pausedAt).toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit" })}` : ""}. It books and sends nothing until you resume.
      </p>
      <Button size="sm" onClick={() => updateSettings({ paused: false, pausedAt: undefined })}>
        <Play className="h-3.5 w-3.5" /> Resume
      </Button>
    </div>
  );
}
