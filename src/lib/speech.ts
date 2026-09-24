/** The browser's speech recognizer (Chrome and Safari prefix it). Absent in some browsers, where buttons still work. */
export type Recognizer = {
  lang: string;
  interimResults: boolean;
  onresult: ((e: { results: { 0: { transcript: string } }[] }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e?: { error?: string }) => void) | null;
  start: () => void;
  stop: () => void;
};

export function makeRecognizer(lang = "en-US"): Recognizer | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: new () => Recognizer; webkitSpeechRecognition?: new () => Recognizer };
  const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  if (!Ctor) return null;
  const r = new Ctor();
  r.lang = lang;
  return r;
}

/** The phone's voice for a language ("es-US" matches any "es" voice), or undefined when it has none. */
function voiceFor(lang: string): SpeechSynthesisVoice | undefined {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return undefined;
  const voices = window.speechSynthesis.getVoices();
  const base = lang.split("-")[0].toLowerCase();
  return voices.find((v) => v.lang.toLowerCase() === lang.toLowerCase()) ?? voices.find((v) => v.lang.toLowerCase().startsWith(base));
}

/** Whether this phone can speak the language at all. Voices load late on some browsers, so "unknown" means ask again. */
export function canSpeak(lang: string): boolean | "unknown" {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return false;
  if (!window.speechSynthesis.getVoices().length) return "unknown";
  return !!voiceFor(lang);
}

/** Reads a line out loud in `lang`, cutting off whatever was still being said. `onEnd` fires when it's done (or
 *  right away when the phone can't speak that language — the words are on screen either way). */
export function say(text: string, onEnd?: () => void, voice: { pitch?: number; rate?: number; lang?: string } = {}) {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) {
    onEnd?.();
    return;
  }
  const lang = voice.lang ?? "en-US";
  const match = voiceFor(lang);
  window.speechSynthesis.cancel();
  // An English voice reading Punjabi is worse than silence; when the phone has no voice for it, show it only.
  if (!match && !lang.startsWith("en") && window.speechSynthesis.getVoices().length) {
    onEnd?.();
    return;
  }
  const u = new SpeechSynthesisUtterance(text);
  u.lang = lang;
  if (match) u.voice = match;
  u.rate = voice.rate ?? 1.05;
  if (voice.pitch) u.pitch = voice.pitch;
  if (onEnd) {
    u.onend = onEnd;
    u.onerror = onEnd;
  }
  window.speechSynthesis.speak(u);
}

export function stopSpeaking() {
  if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
}
