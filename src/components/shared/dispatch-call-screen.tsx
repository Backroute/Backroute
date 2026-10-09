"use client";

import { useEffect, useRef, useState } from "react";
import { Mic, MicOff, MessageSquareText, Phone, PhoneOff, RotateCcw, UserRound, Volume2 } from "lucide-react";
import { cn, formatDuration } from "@/lib/utils";
import { Portal } from "@/components/ui/portal";
import { useNow } from "@/lib/hooks";
import { useStore } from "@/lib/store";
import { DISPATCH_LINE, matchSpoken, OWNER_NAME } from "@/lib/dispatch-calls";
import { canSpeak, makeRecognizer, say, stopSpeaking, type Recognizer } from "@/lib/speech";
import { useDriverUi } from "@/lib/lang/use-driver-ui";
import { LANG_INFO } from "@/lib/lang";
import type { DispatchCall, Translations } from "@/lib/types";

/**
 * The AI dispatcher calling the driver: a real incoming-call screen, then a call the driver can run without looking —
 * the AI talks, the phone listens, and the big buttons are there for when it's easier to tap. Rings over everything,
 * driving mode included. Whatever is agreed happens when the call ends, and a text copy lands in Messages.
 */
export function IncomingCallHost({ driverId }: { driverId: string }) {
  const calls = useStore((s) => s.dispatchCalls);
  const active = calls.find((c) => c.driverId === driverId && (c.status === "ringing" || c.status === "live"));
  const { t } = useDriverUi();
  const [ended, setEnded] = useState<{ missed: boolean } | null>(null);
  const [shownId, setShownId] = useState<string | null>(null);

  // A call that was on screen and just ended shows "Call ended" for a moment, so it doesn't just vanish.
  if (active && active.id !== shownId) setShownId(active.id);
  if (!active && shownId) {
    const last = calls.find((c) => c.id === shownId);
    setShownId(null);
    if (last?.status === "done" || last?.status === "missed") setEnded({ missed: last.status === "missed" });
  }
  useEffect(() => {
    if (!ended) return;
    const t = setTimeout(() => setEnded(null), 2600);
    return () => clearTimeout(t);
  }, [ended]);

  if (active?.status === "ringing") return <Portal><Ringing call={active} /></Portal>;
  if (active?.status === "live") return <Portal><LiveCall key={active.id} call={active} /></Portal>;
  if (ended) {
    // Below the top bar (and below driving mode's "I'm parked"), never on top of a button.
    return (
      <Portal>
      <div role="status" className="theme-ink fixed inset-x-0 top-[calc(env(safe-area-inset-top)+4.75rem)] z-[80] mx-auto flex w-[min(92vw,24rem)] items-center gap-3 rounded-2xl bg-ink-950 px-4 py-3 text-white shadow-lg">
        <MessageSquareText className="h-5 w-5 shrink-0 text-white/70" />
        <div className="min-w-0">
          <p className="text-sm font-semibold">{t.callEnded}</p>
          <p className="truncate text-xs text-white/60">{ended.missed ? `${t.textedInstead}. ` : ""}{t.copyInMessages}</p>
        </div>
      </div>
      </Portal>
    );
  }
  return null;
}

function Ringing({ call }: { call: DispatchCall }) {
  const { answerDispatchCall, declineDispatchCall } = useStore((s) => s.actions);
  const { t } = useDriverUi();
  useRingtone();
  return (
    <div role="alertdialog" aria-modal="true" aria-label="Incoming call from dispatch" className="theme-ink fixed inset-0 z-[80] flex flex-col items-center bg-ink-950 px-6 pb-[max(3rem,env(safe-area-inset-bottom))] pt-[max(6rem,calc(env(safe-area-inset-top)+4rem))] text-white">
      <span className="relative flex h-24 w-24 items-center justify-center">
        <span className="absolute inset-0 animate-ping rounded-full bg-white/20" />
        <span className="relative flex h-24 w-24 items-center justify-center rounded-full bg-white text-2xl font-semibold text-ink-950">B</span>
      </span>
      <p className="mt-6 text-3xl font-semibold tracking-tight">{call.channel === "phone" ? "Titan Dispatch" : t.aiDispatch}</p>
      <p className="mt-2 text-base text-white/60">{call.channel === "phone" ? `${DISPATCH_LINE} · ${t.phoneCall}` : t.ringSub[call.kind]}</p>
      {call.channel === "phone" && (
        <p className="mt-6 max-w-xs text-center text-xs text-white/40">
          {t.phoneDemo}
        </p>
      )}
      <div className="mt-auto grid w-full max-w-xs grid-cols-2 gap-10">
        <button type="button" onClick={() => declineDispatchCall(call.id)} className="flex flex-col items-center gap-2 text-sm text-white/70">
          <span className="flex h-18 w-18 items-center justify-center rounded-full bg-white/15 p-5">
            <MessageSquareText className="h-8 w-8" />
          </span>
          {t.laterText}
        </button>
        <button type="button" onClick={() => answerDispatchCall(call.id)} className="flex flex-col items-center gap-2 text-sm font-semibold">
          <span className="flex h-18 w-18 items-center justify-center rounded-full bg-[var(--dot-live)] p-5">
            <Phone className="h-8 w-8" />
          </span>
          {t.answer}
        </button>
      </div>
    </div>
  );
}

function LiveCall({ call }: { call: DispatchCall }) {
  const { replyDispatchCall, hangUpDispatchCall } = useStore((s) => s.actions);
  const { t, lang: appLang } = useDriverUi();
  // The call is spoken, heard and listened for in its own language; the screen reads in the app's.
  const voice = LANG_INFO[call.lang];
  const readable = (words: string, tr?: Translations) => (appLang !== call.lang ? (tr?.[appLang] ?? words) : words);
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
    const r = makeRecognizer(voice.speech);
    if (!r) return;
    recognizer.current = r;
    r.interimResults = false;
    r.onresult = (e) => {
      const heard = e.results[0][0].transcript.toLowerCase().trim();
      const current = callRef.current;
      const reply = matchSpoken(heard, current);
      if (reply === "hangup") hangUpDispatchCall(current.id);
      else if (reply) {
        setHint(null);
        replyDispatchCall(current.id, reply, heard.charAt(0).toUpperCase() + heard.slice(1));
      } else setHint(t.didntCatch(heard));
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
    if (call.lines.length === spoken.current || !last || last.speaker === "driver") return;
    spoken.current = call.lines.length;
    recognizer.current?.stop();
    say(
      last.text,
      () => {
        if (autoListen.current && canListen && callRef.current.status === "live") listen();
      },
      // The owner sounds like a different person than the AI.
      last.speaker === "owner" ? { pitch: 0.8, rate: 1, lang: voice.speech } : { lang: voice.speech },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [call.lines.length]);

  useEffect(
    () => () => {
      recognizer.current?.stop();
      stopSpeaking();
    },
    [],
  );

  // Voices load late on some phones, so this is asked again on every render rather than once.
  const voiceMissing = canSpeak(voice.speech) === false;
  const secs = now && call.answeredAt ? Math.max(0, Math.round((now - Date.parse(call.answeredAt)) / 1000)) : 0;
  const lines = call.lines.slice(-4);
  const bookedSomething = call.effects.some((e) => e.type === "book" || e.type === "reserve_parking");

  return (
    <div role="dialog" aria-modal="true" aria-label="Call with dispatch" className="theme-ink fixed inset-0 z-[80] flex flex-col bg-ink-950 px-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-[max(2rem,env(safe-area-inset-top))] text-white">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-lg font-semibold">{call.ownerTookOver ? `${OWNER_NAME} · Titan Freight` : t.aiDispatch}</p>
          <p className="text-xs text-white/50">
            {call.ownerTookOver ? t.takingNotes : t.ringSub[call.kind]} · <span className="tabular">{formatDuration(secs)}</span>
          </p>
        </div>
        {canListen && (
          <button
            type="button"
            onClick={() => (listening ? recognizer.current?.stop() : listen())}
            aria-pressed={listening}
            className={cn("flex items-center gap-1.5 rounded-full px-3.5 py-2 text-xs font-semibold", listening ? "bg-[var(--action)] text-[var(--action-ink)]" : "bg-white/10 text-white/80")}
          >
            {listening ? <Mic className="h-4 w-4" /> : <MicOff className="h-4 w-4" />}
            {listening ? t.listening : t.tapToTalk}
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
            {l.speaker === "owner" && <span className="mb-0.5 block text-xs font-semibold uppercase tracking-wider text-white/55">{OWNER_NAME}</span>}
            {readable(l.text, l.tr)}
            {i === lines.length - 1 && l.speaker !== "driver" && readable(l.text, l.tr) !== l.text && (
              <span lang={call.lang} className="mt-1.5 flex items-start gap-1.5 text-sm font-normal text-white/40">
                <Volume2 className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {l.text}
              </span>
            )}
          </p>
        ))}
        {hint && <p className="text-xs text-white/70">{hint}</p>}
        {voiceMissing && <p className="text-xs text-white/40">{t.noVoice(voice.native)}</p>}
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
                ch.reply === "cancel" ? "bg-[var(--dot-danger)]/90 text-white" : i === 0 && !bookedSomething ? "bg-white text-ink-950" : "bg-white/10",
              )}
            >
              <span aria-hidden className="mr-2 text-sm font-medium opacity-50">{i + 1}</span>
              {readable(ch.label, ch.tr)}
              {readable(ch.label, ch.tr) !== ch.label && (
                <span lang={call.lang} className="ml-2 text-sm font-normal opacity-50">
                  {ch.label}
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      <div className="mt-5 grid grid-cols-3 items-center gap-3">
        <button
          type="button"
          onClick={() => (call.ownerTookOver ? replyDispatchCall(call.id, "again", t.sayAgain) : replyDispatchCall(call.id, "again"))}
          className="flex flex-col items-center gap-1 text-xs text-white/60"
        >
          <span className="rounded-full bg-white/10 p-3">
            <RotateCcw className="h-5 w-5" />
          </span>
          {t.sayAgain}
        </button>
        <button type="button" onClick={() => hangUpDispatchCall(call.id)} aria-label={t.hangUp} className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-[var(--dot-danger)]">
          <PhoneOff className="h-7 w-7" />
        </button>
        {call.ownerTookOver ? (
          <span />
        ) : (
          <button type="button" onClick={() => replyDispatchCall(call.id, "person")} className="flex flex-col items-center gap-1 text-xs text-white/60">
            <span className="rounded-full bg-white/10 p-3">
              <UserRound className="h-5 w-5" />
            </span>
            {t.person}
          </button>
        )}
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
