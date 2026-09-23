"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronsRight, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

const KNOB = 52;
const PAD = 4;

/** Uber-style "swipe to confirm" bar: drag the knob to the end to fire `onConfirm`, so a pocket tap can't mark
 *  a load delivered by accident. Keyboard and screen-reader activation (click events with detail 0) confirm
 *  directly; a plain mouse click does nothing. */
export function SwipeToConfirm({
  label,
  busyLabel,
  delayMs = 0,
  onConfirm,
}: {
  label: string;
  /** Shown while the confirmation "works" (e.g. capturing a document photo) before `onConfirm` fires. */
  busyLabel?: string;
  delayMs?: number;
  onConfirm: () => void;
}) {
  const track = useRef<HTMLDivElement>(null);
  const grab = useRef<number | null>(null);
  const [x, setX] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const node = track.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const max = Math.max(0, width - KNOB - PAD * 2);

  async function complete() {
    if (busy) return;
    setX(max);
    setBusy(true);
    if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
    onConfirm();
    setBusy(false);
    setX(0);
  }

  function release() {
    if (grab.current === null) return;
    grab.current = null;
    setDragging(false);
    if (max && x >= max * 0.85) void complete();
    else setX(0);
  }

  const fill = max ? x / max : 0;

  return (
    <div ref={track} className="relative h-[60px] select-none overflow-hidden rounded-full bg-white">
      <div
        className={cn("absolute inset-y-0 left-0 rounded-full bg-emerald-100", !dragging && "transition-[width] duration-300")}
        style={{ width: x + KNOB + PAD * 2 }}
      />
      <span
        className="pointer-events-none absolute inset-0 flex items-center justify-center gap-2 pl-12 pr-4 text-sm font-semibold text-ink-950"
        style={{ opacity: busy ? 1 : 1 - fill * 1.4 }}
      >
        {busy ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" /> {busyLabel ?? "Confirming…"}
          </>
        ) : (
          label
        )}
      </span>
      <button
        type="button"
        aria-label={`${label}. Swipe right, or press Enter, to confirm.`}
        disabled={busy}
        onPointerDown={(e) => {
          if (busy) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          grab.current = e.clientX - x;
          setDragging(true);
        }}
        onPointerMove={(e) => {
          if (grab.current === null) return;
          setX(Math.min(max, Math.max(0, e.clientX - grab.current)));
        }}
        onPointerUp={release}
        onPointerCancel={release}
        onClick={(e) => {
          if (e.detail === 0) void complete();
        }}
        className={cn(
          "absolute top-1 flex touch-none items-center justify-center rounded-full bg-ink-950 text-white shadow-md outline-offset-2",
          dragging ? "cursor-grabbing" : "cursor-grab transition-transform duration-300",
        )}
        style={{ left: PAD, width: KNOB, height: KNOB, transform: `translateX(${x}px)` }}
      >
        {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <ChevronsRight className="h-6 w-6" />}
      </button>
    </div>
  );
}
