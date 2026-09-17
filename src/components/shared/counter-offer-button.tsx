"use client";

import { useState } from "react";
import { Check, Handshake, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { isAwaitingBrokerReply, suggestedCounter } from "@/lib/engine";
import { cn } from "@/lib/utils";
import type { Load } from "@/lib/types";

type Variant = "outline" | "ghost" | "dark" | "text";

/** Lets a driver or carrier type the exact rate they want, like relaying a number to a dispatcher — the AI takes it back to the broker as a counter. */
export function CounterOfferButton({
  load,
  onSubmit,
  variant = "outline",
  label = "Ask AI to push for more",
}: {
  load: Load;
  onSubmit: (amount: number) => void;
  variant?: Variant;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const dark = variant === "dark";
  // The AI just sent the broker a number and hasn't heard back — asking for even more right now would mean
  // reversing course before they've had a chance to reply, which reads as the carrier not standing behind
  // its own ask.
  const waitingOnBroker = isAwaitingBrokerReply(load);

  function start() {
    if (waitingOnBroker) return;
    setValue(String(suggestedCounter(load)));
    setOpen(true);
  }

  function submit() {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) return;
    onSubmit(Math.round(n));
    setOpen(false);
  }

  if (open) {
    return (
      <div className="flex items-center gap-1.5">
        <div className="relative">
          <span className={cn("pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-xs", dark ? "text-white/50" : "text-ink-400")}>$</span>
          <input
            autoFocus
            type="number"
            inputMode="numeric"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            className={cn(
              "w-24 rounded-full border py-1.5 pl-6 pr-2 text-xs tabular outline-none",
              dark ? "border-white/25 bg-white/10 text-white placeholder:text-white/40" : "border-line bg-white text-ink-950 focus:border-ink-400",
            )}
          />
        </div>
        <button
          onClick={submit}
          className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-full", dark ? "bg-white text-ink-950" : "bg-ink-950 text-white")}
        >
          <Check className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={() => setOpen(false)}
          className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-full", dark ? "text-white/60 hover:bg-white/10" : "text-ink-400 hover:bg-ink-100")}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  }

  const waitTitle = "Waiting on the broker's reply before asking for more";

  if (variant === "dark") {
    return (
      <button
        onClick={start}
        disabled={waitingOnBroker}
        title={waitingOnBroker ? waitTitle : undefined}
        className={cn(
          "flex w-full items-center justify-center gap-2 rounded-full bg-white/15 py-3 text-sm font-medium text-white",
          waitingOnBroker && "opacity-40",
        )}
      >
        <Handshake className="h-4 w-4" /> {waitingOnBroker ? "Waiting on broker's reply" : label}
      </button>
    );
  }

  if (variant === "text") {
    return (
      <button
        onClick={start}
        disabled={waitingOnBroker}
        title={waitingOnBroker ? waitTitle : undefined}
        className={cn("flex items-center gap-1.5 text-xs font-medium text-ink-950", waitingOnBroker ? "opacity-40" : "hover:underline")}
      >
        <Handshake className="h-3.5 w-3.5" /> {waitingOnBroker ? "Waiting on broker's reply" : label}
      </button>
    );
  }

  return (
    <Button size="sm" variant={variant} onClick={start} disabled={waitingOnBroker} title={waitingOnBroker ? waitTitle : undefined}>
      <Handshake className="h-3.5 w-3.5" /> {waitingOnBroker ? "Waiting on broker's reply" : label}
    </Button>
  );
}
