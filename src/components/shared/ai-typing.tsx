"use client";

import { Sparkles } from "lucide-react";
import { useAiTyping } from "@/lib/ai/client";

/** Three dots while the AI dispatcher is writing back, in the same bubble style as its replies. */
export function AiTyping({ thread }: { thread: string }) {
  const typing = useAiTyping((s) => !!s.threads[thread]);
  if (!typing) return null;
  return (
    <div className="flex justify-start" role="status" aria-label="AI dispatcher is typing">
      <div className="flex items-center gap-1 rounded-2xl rounded-bl-sm bg-ink-100 px-4 py-3.5">
        {[0, 150, 300].map((d) => (
          <span key={d} className="h-1.5 w-1.5 animate-bounce rounded-full bg-ink-400" style={{ animationDelay: `${d}ms` }} />
        ))}
      </div>
    </div>
  );
}

/** Marks a reply the real AI wrote, so it's clear which answers came from it. */
export function LiveAiMark({ label }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-0.5" title="Answered by the live AI">
      <Sparkles className="h-2.5 w-2.5" aria-hidden />
      {label ?? <span className="sr-only">Live AI</span>}
    </span>
  );
}
