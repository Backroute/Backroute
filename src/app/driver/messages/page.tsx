"use client";

import { useEffect, useRef, useState } from "react";
import { Phone, Send } from "lucide-react";
import { cn } from "@/lib/utils";
import { useStore } from "@/lib/store";
import { usePrimaryDriver } from "@/lib/selectors";
import { TimeAgo } from "@/components/shared/time-ago";

export default function DriverMessagesPage() {
  const driver = usePrimaryDriver();
  const messages = useStore((s) => s.driverMessages).filter((m) => m.driverId === driver.id);
  const sendMessage = useStore((s) => s.actions.sendDriverMessage);
  const [value, setValue] = useState("");
  const startInboundCall = useStore((s) => s.actions.startInboundCall);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  function handleSend() {
    if (!value.trim()) return;
    sendMessage(driver.id, value.trim());
    setValue("");
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-start justify-between px-5">
        <div>
          <h1 className="font-display text-2xl text-ink-950">AI Dispatcher</h1>
          <p className="text-xs text-ink-500">Available 24/7 · responds in seconds</p>
        </div>
        <button
          onClick={() => startInboundCall(driver.id)}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-ink-100 text-ink-700"
          aria-label="Call AI Dispatcher"
        >
          <Phone className="h-4 w-4" />
        </button>
      </div>

      <div className="mt-4 flex-1 space-y-3 overflow-y-auto px-5 pb-2">
        {messages.map((m) => (
          <div key={m.id} className={cn("flex", m.from === "driver" ? "justify-end" : "justify-start")}>
            <div className={cn("max-w-[80%] rounded-2xl px-4 py-2.5 text-sm", m.from === "driver" ? "bg-ink-950 text-white rounded-br-sm" : "bg-ink-100 text-ink-900 rounded-bl-sm")}>
              <p className="leading-relaxed">{m.content}</p>
              <p className={cn("mt-1 text-[10px]", m.from === "driver" ? "text-white/50" : "text-ink-400")}>
                <TimeAgo iso={m.timestamp} />
              </p>
            </div>
          </div>
        ))}
        <div ref={endRef} />
      </div>

      <div className="flex items-center gap-2 border-t border-line px-5 py-3">
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSend()}
          placeholder="Ask about your load, detention, or anything else…"
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
  );
}
