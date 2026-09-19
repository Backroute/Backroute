"use client";

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Clock, CloudRain, Phone, PhoneOff, Send, Wrench } from "lucide-react";
import { cn, formatDuration } from "@/lib/utils";
import { useStore } from "@/lib/store";
import { classifyInstruction } from "@/lib/engine";
import type { CallTranscriptLine, IncidentType } from "@/lib/types";

type CheckinSpec = { kind: "checkin"; driverId: string; driverFirstName: string };
type FleetSpec = { kind: "fleet"; carrierId: string };
type IncidentSpec = { kind: "incident"; driverId: string; truckId: string; onComplete?: () => void };
type NegotiationSpec = {
  kind: "negotiation";
  loadId: string;
  actor: "driver" | "carrier";
  brokerName: string;
  origin: string;
  dest: string;
};

export type VoiceCallSpec = CheckinSpec | FleetSpec | IncidentSpec | NegotiationSpec;

const INCIDENT_TYPES: { key: IncidentType; label: string; icon: typeof Wrench }[] = [
  { key: "breakdown", label: "Breakdown", icon: Wrench },
  { key: "accident", label: "Accident", icon: AlertTriangle },
  { key: "delay", label: "Running late", icon: Clock },
  { key: "weather", label: "Weather", icon: CloudRain },
];

const NEGOTIATION_CALL_REPLY: Record<Exclude<ReturnType<typeof classifyInstruction>, "general">, (broker: string) => string> = {
  rate: (broker) => `On it. Taking that back to ${broker} right now, I'll confirm the second they answer.`,
  detention: (broker) => `Got it. I'm asking ${broker} to confirm detention and lumper terms on this one.`,
  schedule: (broker) => `Understood. Checking with ${broker} on flexibility for the pickup window.`,
  payment: (broker) => `On it. Asking ${broker} about quick pay on this load.`,
};

function greeting(spec: VoiceCallSpec): string {
  switch (spec.kind) {
    case "checkin":
      return `Hey ${spec.driverFirstName.split(" ")[0]}, AI Dispatcher here. What's going on?`;
    case "fleet":
      return "AI Dispatcher. What do you need on your fleet?";
    case "incident":
      return "AI Dispatcher. Go ahead, what happened?";
    case "negotiation":
      return `Calling about the ${spec.origin} → ${spec.dest} load with ${spec.brokerName}. What do you need me to push on?`;
  }
}

function outcomeFor(spec: VoiceCallSpec, saidSomething: boolean): string {
  if (!saidSomething) return "Call ended, nothing logged.";
  switch (spec.kind) {
    case "checkin":
      return "Logged with your AI dispatcher.";
    case "fleet":
      return "Logged with your AI dispatcher.";
    case "incident":
      return "Incident reported, AI dispatcher is on it.";
    case "negotiation":
      return "Relayed to the broker. Check the negotiation thread for updates.";
  }
}

/**
 * A simulated phone call to the AI dispatcher — the same engine that answers chat and negotiates with
 * brokers, just reached by voice instead of text. Every "say" during the call drives the real store
 * action for its mode (sendDriverMessage / reportIncident / sendNegotiationInstruction), so hanging up
 * leaves the exact same state changes a text message or the negotiation composer would have made.
 */
export function VoiceCallModal({ spec, onClose }: { spec: VoiceCallSpec; onClose: () => void }) {
  const sendDriverMessage = useStore((s) => s.actions.sendDriverMessage);
  const sendCarrierMessage = useStore((s) => s.actions.sendCarrierMessage);
  const reportIncident = useStore((s) => s.actions.reportIncident);
  const sendNegotiationInstruction = useStore((s) => s.actions.sendNegotiationInstruction);
  const logLoadVoiceCall = useStore((s) => s.actions.logLoadVoiceCall);
  const driverMessages = useStore((s) => s.driverMessages);
  const carrierMessages = useStore((s) => s.carrierMessages);

  const [phase, setPhase] = useState<"connecting" | "live" | "ended">("connecting");
  const [transcript, setTranscript] = useState<CallTranscriptLine[]>([]);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [pending, setPending] = useState(false);
  const [text, setText] = useState("");
  const [incidentType, setIncidentType] = useState<IncidentType | null>(null);
  const [saidSomething, setSaidSomething] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const seenMessageIds = useRef<Set<string>>(new Set());
  const startedAt = useRef(new Date().toISOString());

  const youSpeaker: CallTranscriptLine["speaker"] = spec.kind === "negotiation" ? spec.actor : spec.kind === "fleet" ? "carrier" : "driver";

  // Ring, then connect and speak the opening line.
  useEffect(() => {
    const t = setTimeout(() => {
      setPhase("live");
      setTranscript([{ speaker: "ai", text: greeting(spec) }]);
    }, 1300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Call timer.
  useEffect(() => {
    if (phase !== "live") return;
    const t = setInterval(() => setElapsedSec((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [phase]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [transcript, pending]);

  // Watch for the real async AI reply landing in driverMessages/carrierMessages (checkin/fleet modes only).
  useEffect(() => {
    if (spec.kind === "checkin") {
      for (const m of driverMessages) {
        if (m.driverId !== spec.driverId || m.from !== "ai" || seenMessageIds.current.has(m.id)) continue;
        seenMessageIds.current.add(m.id);
        setTranscript((prev) => [...prev, { speaker: "ai", text: m.content }]);
        setPending(false);
      }
    } else if (spec.kind === "fleet") {
      for (const m of carrierMessages) {
        if (m.carrierId !== spec.carrierId || m.from !== "ai" || seenMessageIds.current.has(m.id)) continue;
        seenMessageIds.current.add(m.id);
        setTranscript((prev) => [...prev, { speaker: "ai", text: m.content }]);
        setPending(false);
      }
    }
  }, [driverMessages, carrierMessages, spec]);

  function say(spoken: string) {
    const value = spoken.trim();
    if (!value || pending) return;
    setSaidSomething(true);
    setTranscript((prev) => [...prev, { speaker: youSpeaker, text: value }]);
    setText("");
    setPending(true);

    if (spec.kind === "checkin") {
      sendDriverMessage(spec.driverId, value);
      // reply arrives via the driverMessages watcher above
    } else if (spec.kind === "fleet") {
      sendCarrierMessage(spec.carrierId, value);
      // reply arrives via the carrierMessages watcher above
    } else if (spec.kind === "negotiation") {
      const category = classifyInstruction(value);
      sendNegotiationInstruction(spec.loadId, spec.actor, value);
      setTimeout(() => {
        const reply = category === "general" ? "Got it. I'll flag that with the broker now." : NEGOTIATION_CALL_REPLY[category](spec.brokerName);
        setTranscript((prev) => [...prev, { speaker: "ai", text: reply }]);
        setPending(false);
      }, 900);
    }
  }

  function reportAndEnd() {
    if (spec.kind !== "incident" || !incidentType) return;
    const description = text.trim();
    if (description) setTranscript((prev) => [...prev, { speaker: "driver", text: description }]);
    reportIncident(spec.driverId, spec.truckId, incidentType, description);
    const closing =
      incidentType === "accident"
        ? "Notifying the broker, working the checklist, and looping in a live human safety specialist now."
        : "Notifying the broker and working the checklist now. Check Home for live status.";
    setTranscript((prev) => [...prev, { speaker: "ai", text: closing }]);
    setSaidSomething(true);
    setPhase("ended");
  }

  function hangUp() {
    if (spec.kind === "negotiation" && saidSomething) {
      logLoadVoiceCall(spec.loadId, {
        status: "completed",
        startedAt: startedAt.current,
        durationSec: elapsedSec,
        transcript,
        outcome: outcomeFor(spec, saidSomething),
      });
    }
    setPhase("ended");
  }

  function finish() {
    if (spec.kind === "incident") spec.onComplete?.();
    onClose();
  }

  const quickLines =
    spec.kind === "checkin"
      ? ["Give me an ETA update", "I'm running behind schedule", "Any word on my next load?", "Question about a fuel stop"]
      : spec.kind === "fleet"
        ? ["What needs my attention?", "How's net profit looking?", "How many trucks are available?", "Any DOT inspections due?"]
        : spec.kind === "negotiation"
          ? ["Push for a better rate", "Ask about detention pay", "Ask about the pickup window", "Ask about quick pay terms"]
          : [];

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-ink-950 text-white">
      <div className="flex flex-col items-center gap-2 px-6 pb-4 pt-10">
        <div className="relative flex h-20 w-20 items-center justify-center rounded-full bg-white/10">
          {phase === "connecting" && (
            <>
              <span className="absolute inset-0 animate-ping rounded-full bg-white/10" />
              <span className="absolute inset-[-8px] animate-ping rounded-full bg-white/5 [animation-delay:200ms]" />
            </>
          )}
          <Phone className="h-8 w-8" />
        </div>
        <p className="mt-1 text-lg font-semibold">AI Dispatcher</p>
        <p className="text-xs text-white/50">
          {phase === "connecting" ? "Calling…" : phase === "live" ? formatDuration(elapsedSec) : "Call ended"}
        </p>
      </div>

      <div ref={scrollRef} className="flex-1 space-y-2.5 overflow-y-auto px-5 pb-3">
        {transcript.map((line, i) => (
          <div key={i} className={cn("flex", line.speaker === "ai" ? "justify-start" : "justify-end")}>
            <div
              className={cn(
                "max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed",
                line.speaker === "ai" ? "bg-white/10 text-white rounded-bl-sm" : "bg-white text-ink-950 rounded-br-sm",
              )}
            >
              {line.text}
            </div>
          </div>
        ))}
        {pending && (
          <div className="flex justify-start">
            <div className="flex items-center gap-1 rounded-2xl rounded-bl-sm bg-white/10 px-4 py-3">
              {[0, 1, 2].map((i) => (
                <span key={i} className="h-1.5 w-1.5 animate-pulse rounded-full bg-white/60" style={{ animationDelay: `${i * 150}ms` }} />
              ))}
            </div>
          </div>
        )}
      </div>

      {phase === "live" && (
        <div className="flex flex-col gap-2.5 border-t border-white/10 px-5 pb-8 pt-3.5">
          {spec.kind === "incident" && !incidentType ? (
            <div className="grid grid-cols-2 gap-2">
              {INCIDENT_TYPES.map((t) => (
                <button
                  key={t.key}
                  onClick={() => {
                    setIncidentType(t.key);
                    setTranscript((prev) => [...prev, { speaker: "driver", text: t.label }]);
                  }}
                  className="flex items-center gap-2 rounded-xl border border-white/15 px-3 py-2.5 text-left text-xs font-medium hover:bg-white/5"
                >
                  <t.icon className="h-3.5 w-3.5 shrink-0" /> {t.label}
                </button>
              ))}
            </div>
          ) : (
            <>
              {quickLines.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {quickLines.map((q) => (
                    <button
                      key={q}
                      onClick={() => say(q)}
                      disabled={pending}
                      className="rounded-full border border-white/15 px-3 py-1.5 text-[11px] font-medium text-white/80 hover:bg-white/10 disabled:opacity-40"
                    >
                      {q}
                    </button>
                  ))}
                </div>
              )}
              <div className="flex items-center gap-2">
                <input
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && (spec.kind === "incident" ? reportAndEnd() : say(text))}
                  placeholder={spec.kind === "incident" ? "Describe what's happening…" : "Say something…"}
                  className="flex-1 rounded-full border border-white/15 bg-white/5 px-4 py-2.5 text-sm text-white outline-none placeholder:text-white/40 focus:border-white/30"
                />
                {spec.kind === "incident" ? (
                  <button
                    onClick={reportAndEnd}
                    className="flex h-10 shrink-0 items-center justify-center rounded-full bg-white px-4 text-xs font-semibold text-ink-950"
                  >
                    Report to dispatch
                  </button>
                ) : (
                  <button
                    onClick={() => say(text)}
                    disabled={!text.trim() || pending}
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white text-ink-950 disabled:opacity-30"
                  >
                    <Send className="h-4 w-4" />
                  </button>
                )}
              </div>
            </>
          )}

          <button
            onClick={hangUp}
            className="mt-1 flex items-center justify-center gap-2 self-center rounded-full bg-[var(--accent-danger)] px-6 py-2.5 text-sm font-semibold text-white"
          >
            <PhoneOff className="h-4 w-4" /> End call
          </button>
        </div>
      )}

      {phase === "ended" && (
        <div className="flex flex-col items-center gap-3 px-6 pb-10 pt-2 text-center">
          <p className="text-sm text-white/70">{outcomeFor(spec, saidSomething)}</p>
          <button onClick={finish} className="w-full max-w-xs rounded-full bg-white py-3 text-sm font-semibold text-ink-950">
            Done
          </button>
        </div>
      )}

      {phase === "connecting" && (
        <div className="flex justify-center px-6 pb-10">
          <button
            onClick={onClose}
            className="flex items-center justify-center gap-2 rounded-full bg-[var(--accent-danger)] px-6 py-2.5 text-sm font-semibold text-white"
          >
            <PhoneOff className="h-4 w-4" /> Cancel
          </button>
        </div>
      )}
    </div>
  );
}
