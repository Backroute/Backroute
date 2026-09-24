"use client";

import { useEffect, useRef, useState } from "react";
import { Phone, Send } from "lucide-react";
import { PageHeader } from "@/components/shared/portal-shell";
import { LiveDot } from "@/components/shared/live-dot";
import { TimeAgo } from "@/components/shared/time-ago";
import { VoiceCallModal } from "@/components/shared/voice-call-modal";
import { usePrimaryCarrier } from "@/lib/selectors";
import { useStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import { AiTyping, LiveAiMark } from "@/components/shared/ai-typing";
import { useAiTyping } from "@/lib/ai/client";

/** The carrier's counterpart to the driver Messages tab — a fleet-level channel to the AI dispatcher
 *  that isn't tied to any one load, for "how's my week going" instead of "push this rate." */
export default function CarrierMessagesPage() {
  const carrier = usePrimaryCarrier();
  const messages = useStore((s) => s.carrierMessages).filter((m) => m.carrierId === carrier.id);
  const sendMessage = useStore((s) => s.actions.sendCarrierMessage);
  const [value, setValue] = useState("");
  const [calling, setCalling] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  const typing = useAiTyping((s) => !!s.threads[`owner:${carrier.id}`]);
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, typing]);

  function handleSend() {
    if (!value.trim()) return;
    sendMessage(carrier.id, value.trim());
    setValue("");
  }

  return (
    <div className="flex h-[calc(100vh-73px)] flex-col">
      <PageHeader
        title="Messages"
        description="Ask your AI dispatcher about your fleet, not tied to one load"
        right={
          <>
            <LiveDot />
            <button
              onClick={() => setCalling(true)}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-ink-100 text-ink-700 hover:bg-ink-150"
              aria-label="Call AI Dispatcher"
            >
              <Phone className="h-4 w-4" />
            </button>
          </>
        }
      />

      <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col overflow-hidden px-4 sm:px-8">
        <div className="flex-1 space-y-3 overflow-y-auto py-6">
          {messages.length === 0 && (
            <p className="py-12 text-center text-sm text-ink-400">Ask about net profit, open escalations, fleet status, or anything else.</p>
          )}
          {messages.map((m) => (
            <div key={m.id} className={cn("flex", m.from === "carrier" ? "justify-end" : "justify-start")}>
              <div
                className={cn(
                  "max-w-[80%] rounded-2xl px-4 py-2.5 text-sm",
                  m.from === "carrier" ? "bg-ink-950 text-white rounded-br-sm" : "bg-ink-100 text-ink-900 rounded-bl-sm",
                )}
              >
                <p className="leading-relaxed">{m.content}</p>
                <p className={cn("mt-1 flex items-center gap-1.5 text-[10px]", m.from === "carrier" ? "text-white/50" : "text-ink-400")}>
                  <TimeAgo iso={m.timestamp} />
                  {m.ai && <LiveAiMark label="Live AI" />}
                </p>
              </div>
            </div>
          ))}
          <AiTyping thread={`owner:${carrier.id}`} />
          <div ref={endRef} />
        </div>

        <div className="flex items-center gap-2 border-t border-line py-3">
          <input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSend()}
            placeholder="Ask about net profit, escalations, fleet status…"
            className="flex-1 rounded-full border border-line bg-ink-50/60 px-4 py-2.5 text-sm outline-none focus:border-ink-400"
          />
          <button
            onClick={handleSend}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-ink-950 text-white disabled:bg-ink-300"
            disabled={!value.trim()}
          >
            <Send className="h-4 w-4" />
          </button>
        </div>
      </div>

      {calling && <VoiceCallModal spec={{ kind: "fleet", carrierId: carrier.id }} onClose={() => setCalling(false)} />}
    </div>
  );
}
