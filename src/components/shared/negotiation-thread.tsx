import { cn, formatCurrency } from "@/lib/utils";
import type { NegotiationMessage } from "@/lib/types";
import { ChannelIcon } from "./channel-badge";
import { TimeAgo } from "./time-ago";

export function NegotiationThread({ messages }: { messages: NegotiationMessage[] }) {
  if (messages.length === 0) {
    return <p className="py-6 text-center text-sm text-ink-400">No messages yet. AI hasn’t reached out on this load.</p>;
  }
  return (
    <div className="flex flex-col gap-3">
      {messages.map((m) => {
        const isAi = m.direction === "outbound";
        return (
          <div key={m.id} className={cn("flex", isAi ? "justify-end" : "justify-start")}>
            <div className={cn("max-w-[80%] rounded-2xl px-4 py-3", isAi ? "bg-ink-950 text-white rounded-br-sm" : "bg-ink-100 text-ink-900 rounded-bl-sm")}>
              <div className={cn("mb-1 flex items-center gap-1.5 text-[10px] uppercase tracking-wider", isAi ? "text-white/60" : "text-ink-500")}>
                <ChannelIcon channel={m.channel} className="h-3 w-3" />
                <span>{isAi ? "Backroute AI" : m.from}</span>
                <span>·</span>
                <TimeAgo iso={m.timestamp} />
              </div>
              <p className="text-[13px] leading-relaxed">{m.content}</p>
              {typeof m.offerAmount === "number" && (
                <p className={cn("mt-1.5 font-display text-lg tabular", isAi ? "text-white" : "text-ink-950")}>
                  {formatCurrency(m.offerAmount)}
                </p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
