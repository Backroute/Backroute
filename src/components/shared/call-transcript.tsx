"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp, Phone, PhoneCall } from "lucide-react";
import { cn, formatDuration } from "@/lib/utils";
import type { CallTranscriptLine, VoiceCall } from "@/lib/types";

const SPEAKER_LABEL: Record<CallTranscriptLine["speaker"], string> = {
  ai: "AI",
  broker: "Broker",
  driver: "Driver",
  carrier: "You",
};

export function CallTranscript({ call, title = "Voice Agent Call", defaultCollapsed = false }: { call: VoiceCall; title?: string; defaultCollapsed?: boolean }) {
  const [expanded, setExpanded] = useState(!defaultCollapsed);

  return (
    <div className="rounded-2xl border border-line bg-ink-50/60 p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs font-medium text-ink-700">
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-ink-950 text-white">
            {call.status === "completed" ? <PhoneCall className="h-3.5 w-3.5" /> : <Phone className="h-3.5 w-3.5" />}
          </span>
          {title}
        </div>
        <span className="text-[11px] tabular text-ink-500">{formatDuration(call.durationSec)}</span>
      </div>
      <div className="mt-3 flex items-end gap-[3px] h-8">
        {Array.from({ length: 36 }).map((_, i) => (
          <span
            key={i}
            className="w-[3px] rounded-full bg-ink-300"
            style={{ height: `${18 + ((i * 37) % 60)}%` }}
          />
        ))}
      </div>
      {expanded && (
        <div className="mt-4 flex flex-col gap-2.5">
          {call.transcript.map((line, i) => (
            <div key={i} className={cn("flex", line.speaker === "ai" ? "justify-end" : "justify-start")}>
              <div
                className={cn(
                  "max-w-[85%] rounded-xl px-3 py-2 text-[12.5px] leading-relaxed",
                  line.speaker === "ai" ? "bg-ink-950 text-white rounded-br-sm" : "bg-white border border-line text-ink-800 rounded-bl-sm",
                )}
              >
                <span className={cn("mr-1.5 text-[10px] font-semibold uppercase tracking-wide", line.speaker === "ai" ? "text-white/60" : "text-ink-400")}>
                  {SPEAKER_LABEL[line.speaker]}
                </span>
                {line.text}
              </div>
            </div>
          ))}
        </div>
      )}
      <div className="mt-3 flex items-center justify-between gap-3 border-t border-line pt-2.5">
        {call.outcome && <p className="text-xs font-medium text-ink-700">Outcome: {call.outcome}</p>}
        {defaultCollapsed && (
          <button
            onClick={() => setExpanded((v) => !v)}
            className="ml-auto flex shrink-0 items-center gap-1 text-xs font-medium text-ink-500 hover:text-ink-950"
          >
            {expanded ? <>Hide transcript <ChevronUp className="h-3 w-3" /></> : <>Show transcript <ChevronDown className="h-3 w-3" /></>}
          </button>
        )}
      </div>
    </div>
  );
}
