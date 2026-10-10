"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Phone, Send } from "lucide-react";
import { PageHeader } from "@/components/shared/portal-shell";
import { TimeAgo } from "@/components/shared/time-ago";
import { VoiceCallModal } from "@/components/shared/voice-call-modal";
import { usePrimaryCarrier } from "@/lib/selectors";
import { useStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import { AiTyping, LiveAiMark } from "@/components/shared/ai-typing";
import { useAiTyping } from "@/lib/ai/client";
import { DictateButton } from "@/components/shared/dictate";

export default function CarrierMessagesPage() {
  return (
    <Suspense>
      <Messages />
    </Suspense>
  );
}

/**
 * Two kinds of conversation in one place: asking Backroute about the fleet (not tied to one load), and writing to a
 * driver yourself, where the whole thread shows, including what Backroute told them. A load's Message button opens
 * that driver's thread (?driver=).
 */
function Messages() {
  const carrier = usePrimaryCarrier();
  const drivers = useStore((s) => s.drivers).filter((d) => d.carrierId === carrier.id);
  const asked = useSearchParams().get("driver");
  const [picked, setPicked] = useState<{ asked: string | null; thread: string } | null>(null);
  const thread = picked && picked.asked === asked ? picked.thread : asked && drivers.some((d) => d.id === asked) ? asked : "backroute";
  const setThread = (t: string) => setPicked({ asked, thread: t });
  const driver = drivers.find((d) => d.id === thread);
  const [calling, setCalling] = useState(false);

  return (
    <div className="flex h-[calc(100vh-73px)] flex-col">
      <PageHeader
        title="Messages"
        description={driver ? `You and ${driver.name}. Backroute's messages to them show too.` : "Ask Backroute about your fleet, not tied to one load"}
        right={
          <button
            onClick={() => setCalling(true)}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-ink-100 text-ink-700 hover:bg-ink-150"
            aria-label="Call dispatch"
          >
            <Phone className="h-4 w-4" />
          </button>
        }
      />
      <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col overflow-hidden px-4 sm:px-8">
        <div className="flex gap-1.5 overflow-x-auto pt-3 no-scrollbar" role="tablist" aria-label="Conversations">
          {[{ id: "backroute", name: "Backroute" }, ...drivers.map((d) => ({ id: d.id, name: d.name }))].map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={thread === t.id}
              onClick={() => setThread(t.id)}
              className={cn("shrink-0 rounded-full px-3.5 py-1.5 text-xs font-medium", thread === t.id ? "bg-ink-950 text-white" : "bg-ink-100 text-ink-700 hover:bg-ink-150")}
            >
              {t.name}
            </button>
          ))}
        </div>
        {driver ? <DriverThread driverId={driver.id} name={driver.name} /> : <BackrouteThread carrierId={carrier.id} />}
      </div>
      {calling && <VoiceCallModal spec={{ kind: "fleet", carrierId: carrier.id }} onClose={() => setCalling(false)} />}
    </div>
  );
}

function Composer({ placeholder, onSend, note }: { placeholder: string; onSend: (text: string) => void; note?: string | null }) {
  const [value, setValue] = useState("");
  const send = () => {
    if (!value.trim()) return;
    onSend(value.trim());
    setValue("");
  };
  return (
    <div className="border-t border-line py-3">
      {note && (
        <p className="mb-2 text-xs text-ink-500" role="status">
          {note}
        </p>
      )}
      <div className="flex items-center gap-2">
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
          placeholder={placeholder}
          aria-label="Message"
          className="min-w-0 flex-1 rounded-full border border-line bg-ink-50/60 px-4 py-2.5 text-sm outline-none focus:border-ink-400"
        />
        <DictateButton onText={(t) => setValue((v) => (v.trim() ? `${v.trim()} ${t}` : t))} className="h-10 w-10" />
        <button
          onClick={send}
          aria-label="Send"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-ink-950 text-white disabled:bg-ink-300"
          disabled={!value.trim()}
        >
          <Send className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

function useScrollToEnd(dep: unknown) {
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [dep]);
  return endRef;
}

function BackrouteThread({ carrierId }: { carrierId: string }) {
  const messages = useStore((s) => s.carrierMessages).filter((m) => m.carrierId === carrierId);
  const sendMessage = useStore((s) => s.actions.sendCarrierMessage);
  const typing = useAiTyping((s) => !!s.threads[`owner:${carrierId}`]);
  const endRef = useScrollToEnd(`${messages.length}${typing}`);
  return (
    <>
      <div className="flex-1 space-y-3 overflow-y-auto py-6">
        {messages.length === 0 && <p className="py-12 text-center text-sm text-ink-400">Ask about net profit, open escalations, fleet status, or anything else.</p>}
        {messages.map((m) => (
          <div key={m.id} className={cn("flex", m.from === "carrier" ? "justify-end" : "justify-start")}>
            <div className={cn("max-w-[80%] rounded-2xl px-4 py-2.5 text-sm", m.from === "carrier" ? "bg-ink-950 text-white rounded-br-sm" : "bg-ink-100 text-ink-900 rounded-bl-sm")}>
              <p className="leading-relaxed">{m.content}</p>
              <p className={cn("mt-1 flex items-center gap-1.5 text-xs", m.from === "carrier" ? "text-white/50" : "text-ink-400")}>
                <TimeAgo iso={m.timestamp} />
                {m.ai && <LiveAiMark label="Live answer" />}
              </p>
            </div>
          </div>
        ))}
        <AiTyping thread={`owner:${carrierId}`} />
        <div ref={endRef} />
      </div>
      <Composer placeholder="Ask about net profit, escalations, fleet status…" onSend={(t) => sendMessage(carrierId, t)} />
    </>
  );
}

const SENT_NOTE = {
  app: "Sent. It's in their app.",
  sms: "Sent as a text from your dispatch number.",
  held: "In their app. The text goes once they answer YES to texts from your dispatch number.",
  failed: "Didn't send. Check your connection and try again.",
} as const;

function DriverThread({ driverId, name }: { driverId: string; name: string }) {
  const messages = useStore((s) => s.driverMessages).filter((m) => m.driverId === driverId);
  const send = useStore((s) => s.actions.sendOwnerMessage);
  const [note, setNote] = useState<string | null>(null);
  const endRef = useScrollToEnd(messages.length);
  const first = name.split(" ")[0];
  return (
    <>
      <div className="flex-1 space-y-3 overflow-y-auto py-6">
        {messages.length === 0 && <p className="py-12 text-center text-sm text-ink-400">Nothing with {first} yet. What you write here goes to their phone.</p>}
        {messages.map((m) => {
          const mine = m.from === "owner";
          return (
            <div key={m.id} className={cn("flex", m.from === "driver" ? "justify-start" : "justify-end")}>
              <div
                className={cn(
                  "max-w-[80%] rounded-2xl px-4 py-2.5 text-sm",
                  m.from === "driver" ? "bg-ink-100 text-ink-900 rounded-bl-sm" : mine ? "bg-ink-950 text-white rounded-br-sm" : "border border-line bg-white text-ink-800 rounded-br-sm",
                )}
              >
                <p className="leading-relaxed">{m.content}</p>
                <p className={cn("mt-1 text-xs", mine ? "text-white/50" : "text-ink-400")}>
                  {m.from === "driver" ? first : mine ? "You" : m.bySupport ? `Backroute support (${m.bySupport})` : "Backroute"}
                  {m.channel === "sms" ? " · by text" : ""} · <TimeAgo iso={m.timestamp} />
                </p>
              </div>
            </div>
          );
        })}
        <div ref={endRef} />
      </div>
      <Composer
        placeholder={`Write to ${first}…`}
        note={note}
        onSend={(t) => {
          setNote(null);
          void send(driverId, t).then((r) => setNote(SENT_NOTE[r]));
        }}
      />
    </>
  );
}
