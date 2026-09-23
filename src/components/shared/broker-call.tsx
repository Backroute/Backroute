"use client";

import { useEffect, useRef, useState } from "react";
import { Headphones, Phone, PhoneOff, RotateCcw, Volume2, VolumeX, X } from "lucide-react";
import { cn, formatCurrency, formatDuration } from "@/lib/utils";
import { useEscapeKey } from "@/lib/hooks";
import { extractDollarAmount } from "@/lib/engine";
import type { CallTranscriptLine, LiveBrokerCall, VoiceCall } from "@/lib/types";

type TimedLine = CallTranscriptLine & { atMs: number };
export interface PlayableCall {
  lines: TimedLine[];
  durationMs: number;
  openingOffer?: number;
  finalRate?: number;
}

const RING_MS = 2600;
const lineMs = (text: string) => Math.max(2800, text.split(/\s+/).length * 330);

/** A finished call, re-timed so it can be played back the same way a live one plays. */
export function playableFromVoiceCall(call: VoiceCall): PlayableCall {
  let at = RING_MS;
  const lines = call.transcript.map((l) => {
    const timed = { ...l, offer: l.offer ?? extractDollarAmount(l.text), atMs: at };
    at += lineMs(l.text);
    return timed;
  });
  const brokerOffers = lines.filter((l) => l.speaker === "broker" && l.offer);
  const offers = lines.filter((l) => l.offer);
  return {
    lines,
    durationMs: at + 800,
    openingOffer: brokerOffers[0]?.offer,
    finalRate: offers[offers.length - 1]?.offer,
  };
}

/** Milliseconds since `startedAt`, refreshed often enough for lines to land on time. */
function useElapsed(startedAt: number, stopAt: number) {
  const [elapsed, setElapsed] = useState(() => Math.max(0, Date.now() - startedAt));
  useEffect(() => {
    const t = setInterval(() => {
      const e = Date.now() - startedAt;
      setElapsed(e);
      if (e >= stopAt) clearInterval(t);
    }, 200);
    return () => clearInterval(t);
  }, [startedAt, stopAt]);
  return elapsed;
}

/** Reads each new line aloud with a different voice for the AI and the broker, when the listener turns audio on. */
function useSpeech(lines: TimedLine[], shown: number, on: boolean) {
  const spoken = useRef(0);
  useEffect(() => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    if (!on) {
      window.speechSynthesis.cancel();
      spoken.current = shown;
      return;
    }
    const voices = window.speechSynthesis.getVoices().filter((v) => v.lang.startsWith("en"));
    for (let i = spoken.current; i < shown; i++) {
      const line = lines[i];
      const u = new SpeechSynthesisUtterance(line.text);
      u.rate = 1.12;
      if (voices.length) u.voice = voices[line.speaker === "ai" ? 0 : Math.min(voices.length - 1, 3)];
      u.pitch = line.speaker === "ai" ? 1.05 : 0.85;
      window.speechSynthesis.speak(u);
    }
    spoken.current = shown;
  }, [lines, shown, on]);
  useEffect(() => () => {
    if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
  }, []);
}

/** The call as it happens: ringing, the transcript line by line, and a ticker of where each side's number stands. */
export function BrokerCallPlayer({
  call,
  startedAt,
  brokerName,
  contactName,
  replay,
  onReplay,
}: {
  call: PlayableCall;
  startedAt: number;
  brokerName: string;
  contactName?: string;
  replay?: boolean;
  onReplay?: () => void;
}) {
  const elapsed = useElapsed(startedAt, call.durationMs);
  const [audio, setAudio] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const shown = call.lines.filter((l) => l.atMs <= elapsed).length;
  const visible = call.lines.slice(0, shown);
  const ringing = elapsed < RING_MS;
  const ended = elapsed >= call.durationMs;
  const nextSpeaker = !ended && shown < call.lines.length ? call.lines[shown].speaker : null;
  useSpeech(call.lines, shown, audio);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [shown]);

  const lastOffer = (who: "ai" | "broker") => [...visible].reverse().find((l) => l.speaker === who && l.offer)?.offer;
  const brokerAt = lastOffer("broker");
  const aiAt = lastOffer("ai");
  const gain = call.finalRate && call.openingOffer ? call.finalRate - call.openingOffer : 0;
  const talkSec = Math.max(0, Math.floor((Math.min(elapsed, call.durationMs) - RING_MS) / 1000));

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-3">
        <span className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white/10">
          {ringing && <span className="absolute inset-0 animate-ping rounded-full bg-white/15" />}
          <Phone className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">AI Dispatcher ↔ {contactName ? `${contactName}, ` : ""}{brokerName}</p>
          <p className="text-xs text-white/55">
            {ringing ? "Ringing…" : ended ? (replay ? "Replay finished" : "Call ended") : `${replay ? "Replaying" : "Live"} · ${formatDuration(talkSec)}`}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setAudio((v) => !v)}
          aria-pressed={audio}
          aria-label={audio ? "Mute call audio" : "Play call audio"}
          className={cn("flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3 text-xs font-semibold", audio ? "bg-white text-ink-950" : "bg-white/10 text-white")}
        >
          {audio ? <Volume2 className="h-3.5 w-3.5" /> : <VolumeX className="h-3.5 w-3.5" />} {audio ? "Audio on" : "Listen"}
        </button>
      </div>

      <Waveform active={!ringing && !ended} speaker={visible[visible.length - 1]?.speaker} />

      <div className="grid grid-cols-2 gap-2">
        <Ticker label={`${brokerName.split(" ")[0]} offers`} value={brokerAt} />
        <Ticker label="AI is asking" value={aiAt} strong />
      </div>

      <div ref={scroller} className="mt-3 flex min-h-[8rem] flex-1 flex-col gap-2 overflow-y-auto pr-1">
        {visible.map((l, i) => (
          <div key={i} className={cn("flex animate-rise-in", l.speaker === "ai" ? "justify-end" : "justify-start")}>
            <p
              className={cn(
                "max-w-[85%] rounded-2xl px-3.5 py-2 text-[13px] leading-relaxed",
                l.speaker === "ai" ? "rounded-br-sm bg-white text-ink-950" : "rounded-bl-sm bg-white/10",
              )}
            >
              <span className={cn("mr-1.5 text-[10px] font-semibold uppercase tracking-wide", l.speaker === "ai" ? "text-ink-400" : "text-white/45")}>
                {l.speaker === "ai" ? "AI" : "Broker"}
              </span>
              {l.text}
            </p>
          </div>
        ))}
        {nextSpeaker && !ringing && (
          <div className={cn("flex", nextSpeaker === "ai" ? "justify-end" : "justify-start")}>
            <span className="flex items-center gap-1 rounded-2xl bg-white/10 px-3.5 py-2.5">
              {[0, 1, 2].map((i) => (
                <span key={i} className="h-1.5 w-1.5 animate-pulse rounded-full bg-white/60" style={{ animationDelay: `${i * 150}ms` }} />
              ))}
            </span>
          </div>
        )}
      </div>

      {ended && call.finalRate && (
        <div className="mt-3 flex items-center justify-between gap-3 rounded-2xl bg-emerald-400/15 px-4 py-3">
          <div>
            <p className="text-sm font-semibold text-emerald-200">Booked at {formatCurrency(call.finalRate)}</p>
            {gain > 0 && <p className="text-xs text-emerald-200/80">{formatCurrency(gain)} more than the broker&apos;s first offer</p>}
          </div>
          {onReplay && (
            <button type="button" onClick={onReplay} className="flex shrink-0 items-center gap-1 rounded-full bg-white/10 px-3 py-2 text-xs font-semibold">
              <RotateCcw className="h-3.5 w-3.5" /> Replay
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function Ticker({ label, value, strong }: { label: string; value?: number; strong?: boolean }) {
  return (
    <div className={cn("rounded-2xl px-3.5 py-2.5", strong ? "bg-white/10" : "bg-white/5")}>
      <p className="text-[11px] text-white/50">{label}</p>
      <p key={value} className="animate-rise-in text-lg font-semibold tabular">{value ? formatCurrency(value) : "—"}</p>
    </div>
  );
}

function Waveform({ active, speaker }: { active: boolean; speaker?: CallTranscriptLine["speaker"] }) {
  return (
    <div aria-hidden className="my-4 flex h-10 items-center justify-center gap-[3px]">
      {Array.from({ length: 40 }).map((_, i) => (
        <span
          key={i}
          className={cn("w-[3px] rounded-full", active ? (speaker === "ai" ? "animate-wave bg-white" : "animate-wave bg-white/50") : "bg-white/20")}
          style={{ height: active ? `${25 + ((i * 37) % 70)}%` : "12%", animationDelay: `${(i % 8) * 90}ms` }}
        />
      ))}
    </div>
  );
}

/** Full-screen call view: a live call the AI is on right now, or a replay of one it already made. */
export function BrokerCallModal({
  live,
  recorded,
  brokerName,
  contactName,
  onClose,
}: {
  live?: LiveBrokerCall;
  recorded?: VoiceCall;
  brokerName: string;
  contactName?: string;
  onClose: () => void;
}) {
  const [replayKey, setReplayKey] = useState(0);
  const [replayStart, setReplayStart] = useState(() => Date.now());
  useEscapeKey(onClose);
  const call: PlayableCall | null = live ? live : recorded ? playableFromVoiceCall(recorded) : null;
  if (!call) return null;
  const startedAt = live ? Date.parse(live.startedAt) : replayStart;

  return (
    <div role="dialog" aria-modal="true" aria-label={`Call with ${brokerName}`} className="fixed inset-0 z-[60] flex items-end justify-center bg-black/60 sm:items-center sm:p-6">
      <div className="flex h-[88dvh] w-full max-w-md animate-sheet-up flex-col rounded-t-3xl bg-ink-950 p-5 text-white sm:h-[80vh] sm:rounded-3xl">
        <div className="mb-4 flex items-center justify-between">
          <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-white/50">
            <Headphones className="h-3.5 w-3.5" /> {live ? "Listening in" : "Call replay"}
          </p>
          <button type="button" onClick={onClose} autoFocus aria-label="Close call" className="flex h-9 w-9 items-center justify-center rounded-full bg-white/10">
            <X className="h-4 w-4" />
          </button>
        </div>
        <BrokerCallPlayer
          key={replayKey}
          call={call}
          startedAt={startedAt}
          brokerName={brokerName}
          contactName={contactName}
          replay={!live}
          onReplay={
            live
              ? undefined
              : () => {
                  setReplayStart(Date.now());
                  setReplayKey((k) => k + 1);
                }
          }
        />
        <button type="button" onClick={onClose} className="mt-4 flex items-center justify-center gap-2 self-center rounded-full bg-white/10 px-5 py-2.5 text-sm font-semibold">
          <PhoneOff className="h-4 w-4" /> {live ? "Stop listening" : "Close"}
        </button>
      </div>
    </div>
  );
}

/** The booking card's phone line: the AI on a live call (tap to listen), or a one-tap "call them now" while a
 *  negotiation is still going back and forth by email. */
export function BrokerCallRow({ load, brokerName, contactName, onCall, compact }: {
  load: { liveCall?: LiveBrokerCall; stage: string; calls: VoiceCall[] };
  brokerName: string;
  contactName?: string;
  onCall: () => void;
  compact?: boolean;
}) {
  const [open, setOpen] = useState<"live" | "replay" | null>(null);
  const lastCall = load.calls.filter((c) => c.transcript.some((l) => l.speaker === "broker")).at(-1);
  const modal = open && (
    <BrokerCallModal
      live={open === "live" ? load.liveCall : undefined}
      recorded={open === "replay" ? lastCall : undefined}
      brokerName={brokerName}
      contactName={contactName}
      onClose={() => setOpen(null)}
    />
  );

  if (load.liveCall) {
    return (
      <>
        <button
          type="button"
          onClick={() => setOpen("live")}
          className={cn("flex w-full items-center gap-3 rounded-2xl bg-emerald-400/15 text-left", compact ? "px-3 py-2" : "px-4 py-3")}
        >
          <span className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-400/25">
            <span className="absolute inset-0 animate-ping rounded-full bg-emerald-400/20" />
            <Phone className="h-4 w-4 text-emerald-200" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium text-emerald-100">AI is on the phone with {brokerName}</span>
            {!compact && <span className="block text-xs text-emerald-200/70">Hear it negotiate your rate, live</span>}
          </span>
          <span className="flex shrink-0 items-center gap-1 rounded-full bg-white px-3 py-1.5 text-xs font-semibold text-ink-950">
            <Headphones className="h-3.5 w-3.5" /> Listen
          </span>
        </button>
        {modal}
      </>
    );
  }
  if (lastCall && !compact) {
    return (
      <>
        <button type="button" onClick={() => setOpen("replay")} className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3.5 py-2 text-xs font-semibold">
          <Headphones className="h-3.5 w-3.5" /> Replay the AI&apos;s call
        </button>
        {modal}
      </>
    );
  }
  if (load.stage === "negotiating" && !compact) {
    return (
      <button type="button" onClick={onCall} className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3.5 py-2 text-xs font-semibold">
        <Phone className="h-3.5 w-3.5" /> Have the AI call {brokerName}
      </button>
    );
  }
  return null;
}
