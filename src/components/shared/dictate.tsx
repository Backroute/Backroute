"use client";

import { useRef, useState, useSyncExternalStore } from "react";
import { Mic, Square } from "lucide-react";
import type { Lang } from "@/lib/types";
import { cn } from "@/lib/utils";

/** The browser's speech-to-text (Chrome, Edge, Safari). Not there: no button. */
type Recognition = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start: () => void;
  stop: () => void;
};
type RecognitionCtor = new () => Recognition;
const ctor = (): RecognitionCtor | undefined => {
  if (typeof window === "undefined") return undefined;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
};

const SPEECH_LANG: Record<Lang, string> = { en: "en-US", es: "es-US", pa: "pa-IN", hi: "hi-IN", ru: "ru-RU", uk: "uk-UA", fr: "fr-CA" };

/**
 * Talk instead of typing: tap the microphone, say it, and the words land in the message box (the person still taps
 * Send). In their own language.
 */
export function DictateButton({ lang = "en", onText, className, label = "Speak your message" }: { lang?: Lang; onText: (text: string) => void; className?: string; label?: string }) {
  const supported = useSyncExternalStore(
    () => () => {},
    () => !!ctor(),
    () => false,
  );
  const [listening, setListening] = useState(false);
  const rec = useRef<Recognition | null>(null);
  if (!supported) return null;

  function toggle() {
    if (listening) {
      rec.current?.stop();
      return;
    }
    const Ctor = ctor();
    if (!Ctor) return;
    const r = new Ctor();
    r.lang = SPEECH_LANG[lang] ?? "en-US";
    r.interimResults = false;
    r.continuous = false;
    r.onresult = (e) => {
      const text = Array.from(e.results)
        .map((res) => res[0]?.transcript ?? "")
        .join(" ")
        .trim();
      if (text) onText(text);
    };
    r.onend = () => setListening(false);
    r.onerror = () => setListening(false);
    rec.current = r;
    setListening(true);
    r.start();
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={listening ? "Stop listening" : label}
      aria-pressed={listening}
      className={cn(
        "flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition-colors",
        listening ? "bg-[var(--accent-danger)] text-white" : "bg-ink-100 text-ink-700 hover:bg-ink-150",
        className,
      )}
    >
      {listening ? <Square className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
    </button>
  );
}
