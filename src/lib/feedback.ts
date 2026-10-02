"use client";

import { useSyncExternalStore } from "react";

/**
 * The feel of the app in the hand: a tick under the thumb when something's done, and a short chime for the three
 * moments worth hearing (approved, delivered, paid). Sounds can be turned off on each phone; haptics follow the
 * phone's own settings.
 */

export type Haptic = "tap" | "success" | "warning";
export type Chime = "approve" | "delivered" | "paid";

const PATTERN: Record<Haptic, number | number[]> = { tap: 8, success: [10, 50, 16], warning: [24, 60, 24] };

const isIos = () => typeof navigator !== "undefined" && /iPhone|iPad|iPod/.test(navigator.userAgent);

/** Android vibrates; Safari on iPhone has no vibrate, but toggling a hidden switch gives the system's own tick. */
export function haptic(kind: Haptic = "tap") {
  if (typeof window === "undefined") return;
  try {
    if (typeof navigator.vibrate === "function") {
      navigator.vibrate(PATTERN[kind]);
      return;
    }
    if (!isIos()) return;
    const label = document.createElement("label");
    const input = document.createElement("input");
    input.type = "checkbox";
    input.setAttribute("switch", "");
    label.append(input);
    label.style.display = "none";
    document.body.append(label);
    label.click();
    if (kind !== "tap") setTimeout(() => label.click(), 70);
    setTimeout(() => label.remove(), 200);
  } catch {}
}

// ─── Sounds ──────────────────────────────────────────────────────────────────

const SOUND_KEY = "backroute.sounds";
const SOUND_EVENT = "backroute:sounds";

export function soundsOn(): boolean {
  try {
    return localStorage.getItem(SOUND_KEY) !== "off";
  } catch {
    return true;
  }
}

export function setSounds(on: boolean) {
  try {
    localStorage.setItem(SOUND_KEY, on ? "on" : "off");
  } catch {}
  window.dispatchEvent(new Event(SOUND_EVENT));
}

export function useSounds(): boolean {
  return useSyncExternalStore(
    (cb) => {
      window.addEventListener(SOUND_EVENT, cb);
      window.addEventListener("storage", cb);
      return () => {
        window.removeEventListener(SOUND_EVENT, cb);
        window.removeEventListener("storage", cb);
      };
    },
    soundsOn,
    () => true,
  );
}

// Rising notes, short and quiet: a confirmation, not an alarm.
const NOTES: Record<Chime, number[]> = {
  approve: [659.25, 987.77],
  delivered: [523.25, 659.25, 783.99],
  paid: [783.99, 1046.5, 1318.51],
};

let audio: AudioContext | null = null;

function context(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) return null;
  audio ??= new Ctx();
  return audio;
}

/** Phones only let sound start from a tap: the first tap anywhere opens the audio, so later chimes can play. */
export function primeAudio() {
  if (typeof window === "undefined") return () => {};
  const once = () => {
    try {
      const ctx = context();
      if (ctx?.state === "suspended") void ctx.resume();
    } catch {}
  };
  window.addEventListener("pointerdown", once, { once: true });
  return () => window.removeEventListener("pointerdown", once);
}

export function chime(kind: Chime) {
  if (!soundsOn()) return;
  try {
    const ctx = context();
    if (!ctx || ctx.state === "closed") return;
    if (ctx.state === "suspended") void ctx.resume();
    const start = ctx.currentTime + 0.01;
    NOTES[kind].forEach((freq, i) => {
      const t = start + i * 0.09;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.07, t + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.3);
    });
  } catch {}
}

/** Both at once, for the moments that earn it. */
export function celebrate(kind: Chime) {
  haptic("success");
  chime(kind);
}
