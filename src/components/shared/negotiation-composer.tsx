"use client";

import { useState } from "react";
import { Send } from "lucide-react";
import { cn } from "@/lib/utils";

/** Free-text ask the AI relays to the broker — a rate, detention terms, pickup timing, payment terms, or anything else. */
export function NegotiationComposer({
  onSend,
  compact,
}: {
  onSend: (text: string) => void;
  compact?: boolean;
}) {
  const [value, setValue] = useState("");

  function submit() {
    const v = value.trim();
    if (!v) return;
    onSend(v);
    setValue("");
  }

  return (
    <div className={cn("flex items-center gap-2", !compact && "border-t border-line pt-3")}>
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && submit()}
        placeholder="Ask about rate, detention terms, or scheduling…"
        className={cn(
          "flex-1 rounded-full border border-line bg-ink-50/60 outline-none focus:border-ink-400",
          compact ? "px-3 py-1.5 text-xs" : "px-4 py-2 text-sm",
        )}
      />
      <button
        onClick={submit}
        disabled={!value.trim()}
        className={cn(
          "flex shrink-0 items-center justify-center rounded-full bg-ink-950 text-white disabled:bg-ink-300",
          compact ? "h-7 w-7" : "h-9 w-9",
        )}
      >
        <Send className={compact ? "h-3 w-3" : "h-3.5 w-3.5"} />
      </button>
    </div>
  );
}
