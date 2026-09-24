"use client";

import { useEffect, useRef, useState } from "react";
import { Mic, MicOff, MessageSquareText, Phone, PhoneOff, RotateCcw, UserRound } from "lucide-react";
import { cn, formatDuration } from "@/lib/utils";
import { useNow } from "@/lib/hooks";
import { useStore } from "@/lib/store";
import { KIND_LABEL } from "@/lib/dispatch-calls";
import { makeRecognizer, say, stopSpeaking, type Recognizer } from "@/lib/speech";
import type { DispatchCall } from "@/lib/types";

const RING_SUBTITLE: Record<DispatchCall["kind"], string> = {
  next_load: "About your next load",
  pickup_brief: "Before you get to pickup",
  delivery_brief: "Before you get to delivery",
  late_eta: "Your delivery appointment",
  hours_parking: "Your hours and parking",
  setup: "Setting up your calls",
};

/** Words that always work on a call, whatever the AI just asked. */
const ALWAYS: [string, RegExp][] = [
  ["again", /\b(again|repeat|say that|what was that|come again)\b/],
  ["person", /\b(person|human|someone|somebody|real|office)\b/],
  ["hangup", /\b(hang up|goodbye)\b/],
];

/** Picks what the driver meant from what they said, or null when nothing fits. */
function matchReply(heard: string, call: DispatchCall): string | null {
  for (const choice of call.choices) {
    if (choice.match && new RegExp(`\\b(${choice.match})`).test(heard)) return choice.reply;
  }
  return ALWAYS.find(([, re]) => re.test(heard))?.[0] ?? null;
}

/**
 * The AI dispatcher calling the driver: a real incoming-call screen, then a call the driver can run without looking —
 * the AI talks, the phone listens, and the big buttons are there for when it's easier to tap. Rings over everything,
 * driving mode included. Whatever is agreed happens when the call ends, and a text copy lands in Messages.
 */
export function IncomingCallHost({ driverId }: { driverId: string }) {
  const calls = useStore((s) => s.dispatchCalls);
  const active = calls.find((c) => c.driverId === driverId && (c.status === "ringing" || c.status === "live"));
  const [ended, setEnded] = useState<{ outcome?: string } | null>(null);
  const [shownId, setShownId] = useState<string | null>(null);

  // A call that was on screen and just ended shows "Call ended" for a moment, so it doesn't just vanish.
  if (active && active.id !== shownId) setShownId(active.id);
  if (!active && shownId) {
    const last = calls.find((c) => c.id === shownId);
    setShownId(null);
    if (last?.status === "done" || last?.status === "missed") setEnded({ outcome: last.status === "missed" ? "Sent you a text instead" : last.outcome });
  }
  useEffect(() => {
    if (!ended) return;
    const t = setTimeout(() => setEnded(null), 2600);
    return () => clearTimeout(t);
  }, [ended]);

  if (active?.status === "ringing") return <Ringing call={active} />;
  if (active?.status === "live") return <LiveCall key={active.id} call={active} />;
  if (ended) {
    return (
      <div role="status" className="fixed inset-x-0 top-4 z-[80] mx-auto flex w-[min(92vw,24rem)] items-center gap-3 rounded-2xl bg-ink-950 px-4 py-3 text-white shadow-lg">
        <MessageSquareText className="h-5 w-5 shrink-0 text-emerald-300" />
        <div className="min-w-0">
          <p className="text-sm font-semibold">Call ended</p>
          <p className="truncate text-xs text-white/60">{ended.outcome ? `${ended.outcome}. ` : ""}Copy in your Messages.</p>
        </div>
      </div>
    );
  }
  return null;
}

function Ringing({ call }: { call: DispatchCall }) {
  const { answerDispatchCall, declineDispatchCall } = useStore((s) => s.actions);
  useRingtone();
  return (
    <div role="alertdialog" aria-modal="true" aria-label="Incoming call from AI Dispatch" className="fixed inset-0 z-[80] flex flex-col items-center bg-ink-950 px-6 pb-12 pt-24 text-white">
      <span className="relative flex h-24 w-24 items-center justify-center">
        <span className="absolute inset-0 animate-ping rounded-full bg-emerald-400/25" />
        <span className="relative flex h-24 w-24 items-center justify-center rounded-full bg-white text-2xl font-semibold text-ink-950">AI</span>
      </span>
      <p className="mt-6 text-3xl font-semibold tracking-tight">AI Dispatch</p>
      <p className="mt-2 text-base text-white/60">{RING_SUBTITLE[call.kind]}</p>
      <div className="mt-auto grid w-full max-w-xs grid-cols-2 gap-10">
        <button type="button" onClick={() => declineDispatchCall(call.id)} className="flex flex-col items-center gap-2 text-sm text-white/70">
          <span className="flex h-18 w-18 items-center justify-center rounded-full bg-white/15 p-5">
            <MessageSquareText className="h-8 w-8" />
          </span>
          Later, text me
        </button>
        <button type="button" onClick={() => answerDispatchCall(call.id)} className="flex flex-col items-center gap-2 text-sm font-semibold">
          <span className="flex h-18 w-18 items-center justify-center rounded-full bg-emerald-500 p-5">
            <Phone className="h-8 w-8" />
          </span>
          Answer
        </button>
      </div>
    </div>
  );
}

function LiveCall({ call }: { call: DispatchCall }) {
  const { replyDispatchCall, hangUpDispatchCall } = useStore((s) => s.actions);
  const now = useNow();
  const [listening, setListening] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const [canListen] = useState(() => makeRecognizer() !== null);
  const recognizer = useRef<Recognizer | null>(null);
  const spoken = useRef(0);
  const autoListen = useRef(true);
  const callRef = useRef(call);
  useEffect(() => {
    callRef.current = call;
  });

  function listen() {
    recognizer.current?.stop();
    const r = makeRecognizer();
    if (!r) return;
    recognizer.current = r;
    r.lang = "en-US";
    r.interimResults = false;
    r.onresult = (e) => {
      const heard = e.results[0][0].transcript.toLowerCase().trim();
      const current = callRef.current;
      const reply = matchReply(heard, current);
      if (reply === "hangup") hangUpDispatchCall(current.id);
      else if (reply) {
        setHint(null);
        replyDispatchCall(current.id, reply, heard.charAt(0).toUpperCase() + heard.slice(1));
      } else setHint(`Didn't catch "${heard}". Say it again or tap.`);
    };
    r.onend = () => setListening(false);
    r.onerror = (e) => {
      setListening(false);
      // No microphone permission: stop trying on every line and let the buttons do the work.
      if (e?.error === "not-allowed" || e?.error === "service-not-allowed") autoListen.current = false;
    };
    setListening(true);
    try {
      r.start();
    } catch {
      setListening(false);
    }
  }

  // Every new AI line is read out loud; when it finishes, the phone listens for the answer.
  useEffect(() => {
    const last = call.lines.at(-1);
    if (call.lines.length === spoken.current || last?.speaker !== "ai") return;
    spoken.current = call.lines.length;
    recognizer.current?.stop();
    say(last.text, () => {
      if (autoListen.current && canListen && callRef.current.status === "live") listen();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [call.lines.length]);

  useEffect(
    () => () => {
      recognizer.current?.stop();
      stopSpeaking();
    },
    [],
  );

  const secs = now && call.answeredAt ? Math.max(0, Math.round((now - Date.parse(call.answeredAt)) / 1000)) : 0;
  const lines = call.lines.slice(-4);
  const bookedSomething = call.effects.some((e) => e.type === "book" || e.type === "reserve_parking");

  return (
    <div role="dialog" aria-modal="true" aria-label="Call with AI Dispatch" className="fixed inset-0 z-[80] flex flex-col bg-ink-950 px-5 pb-6 pt-8 text-white">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-lg font-semibold">AI Dispatch</p>
          <p className="text-xs text-white/50">
            {KIND_LABEL[call.kind]} · <span className="tabular">{formatDuration(secs)}</span>
          </p>
        </div>
        {canListen && (
          <button
            type="button"
            onClick={() => (listening ? recognizer.current?.stop() : listen())}
            aria-pressed={listening}
            className={cn("flex items-center gap-1.5 rounded-full px-3.5 py-2 text-xs font-semibold", listening ? "bg-emerald-400 text-ink-950" : "bg-white/10 text-white/80")}
          >
            {listening ? <Mic className="h-4 w-4" /> : <MicOff className="h-4 w-4" />}
            {listening ? "Listening" : "Tap to talk"}
          </button>
        )}
      </div>

      <div className="mt-6 flex flex-1 flex-col justify-end gap-3 overflow-hidden" aria-live="polite">
        {lines.map((l, i) => (
          <p
            key={call.lines.length - lines.length + i}
            className={cn(
              "leading-snug",
              l.speaker === "driver" ? "self-end rounded-2xl bg-white/10 px-3.5 py-2 text-sm text-white/80" : i === lines.length - 1 ? "text-xl font-medium" : "text-sm text-white/45",
            )}
          >
            {l.text}
          </p>
        ))}
        {hint && <p className="text-xs text-amber-200">{hint}</p>}
      </div>

      {call.choices.length > 0 && (
        <div className="mt-5 flex flex-col gap-2.5">
          {call.choices.map((ch, i) => (
            <button
              key={ch.reply}
              type="button"
              onClick={() => replyDispatchCall(call.id, ch.reply)}
              className={cn(
                "rounded-2xl py-4 text-lg font-semibold active:scale-[0.99]",
                ch.reply === "cancel" ? "bg-red-500/90 text-white" : i === 0 && !bookedSomething ? "bg-white text-ink-950" : "bg-white/10",
              )}
            >
              {ch.label}
            </button>
          ))}
        </div>
      )}

      <div className="mt-5 grid grid-cols-3 items-center gap-3">
        <button type="button" onClick={() => replyDispatchCall(call.id, "again")} className="flex flex-col items-center gap-1 text-[11px] text-white/60">
          <span className="rounded-full bg-white/10 p-3">
            <RotateCcw className="h-5 w-5" />
          </span>
          Say that again
        </button>
        <button type="button" onClick={() => hangUpDispatchCall(call.id)} aria-label="Hang up" className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-red-500">
          <PhoneOff className="h-7 w-7" />
        </button>
        <button type="button" onClick={() => replyDispatchCall(call.id, "person")} className="flex flex-col items-center gap-1 text-[11px] text-white/60">
          <span className="rounded-full bg-white/10 p-3">
            <UserRound className="h-5 w-5" />
          </span>
          Get me a person
        </button>
      </div>
    </div>
  );
}

/** A phone-style double ring while the call is ringing, and a buzz on phones that vibrate. Silent where the
 *  browser won't play sound before the first tap. */
function useRingtone() {
  useEffect(() => {
    type AudioCtor = typeof AudioContext;
    const Ctor = (window as unknown as { AudioContext?: AudioCtor; webkitAudioContext?: AudioCtor }).AudioContext ?? (window as unknown as { webkitAudioContext?: AudioCtor }).webkitAudioContext;
    let ctx: AudioContext | null = null;
    try {
      ctx = Ctor ? new Ctor() : null;
    } catch {
      ctx = null;
    }
    const ring = () => {
      navigator.vibrate?.([400, 200, 400]);
      if (!ctx || ctx.state !== "running") return;
      for (const offset of [0, 0.5]) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.frequency.value = 440;
        gain.gain.value = 0.08;
        osc.connect(gain).connect(ctx.destination);
        osc.start(ctx.currentTime + offset);
        osc.stop(ctx.currentTime + offset + 0.35);
      }
    };
    ctx?.resume().catch(() => {});
    ring();
    const t = setInterval(ring, 2500);
    return () => {
      clearInterval(t);
      navigator.vibrate?.(0);
      ctx?.close().catch(() => {});
    };
  }, []);
}
