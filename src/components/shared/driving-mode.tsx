"use client";

import { useEffect, useRef, useState } from "react";
import { Clock, Mic, MicOff, Navigation, Package, Phone, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useEscapeKey, useNow } from "@/lib/hooks";
import { tripState } from "@/lib/trip-state";
import { makeRecognizer, say, type Recognizer } from "@/lib/speech";
import { useDriverUi } from "@/lib/lang/use-driver-ui";
import type { DriveCommand, UiText } from "@/lib/lang/ui";
import type { Load } from "@/lib/types";

/** Commands in the driver's language, checked in this order so "unloaded" wins over "loaded". English also keeps
 *  its looser patterns ("I'm loaded up", "at the dock"). */
const ORDER: DriveCommand[] = ["unloaded", "loaded", "arrived", "late", "call", "next"];
const EN: [DriveCommand, RegExp][] = [
  ["unloaded", /\bunload(ed)?\b|\bempty\b/],
  ["loaded", /\bload(ed)?\b/],
  ["arrived", /\barriv(e|ed|ing)\b|\bhere\b|\bat the (dock|shipper|receiver)\b/],
  ["late", /\blate\b|\bdelay(ed)?\b|\bbehind\b|\btraffic\b/],
  ["call", /\bcall\b|\bdispatch\b|\btalk\b/],
  ["next", /\bnext\b|\bwhat now\b|\bwhere\b|\beta\b/],
];

function commandFor(heard: string, t: UiText, english: boolean): DriveCommand | null {
  if (english) return EN.find(([, re]) => re.test(heard))?.[0] ?? null;
  return ORDER.find((cmd) => t.driveWords[cmd].some((w) => heard.includes(w.toLowerCase()))) ?? null;
}

/**
 * Hands-free while the truck is moving: no reading, no typing — the next stop in big type, four big buttons, and voice
 * for everything else. The driver talks, the app answers out loud. It exits only when the driver says they're parked.
 */
export function DrivingMode({
  load,
  needsPreTrip,
  onClose,
  onArrive,
  onTripStep,
  onLate,
  onCall,
}: {
  load: Load;
  needsPreTrip: boolean;
  onClose: () => void;
  onArrive: () => void;
  onTripStep: (step: "loaded" | "unloaded") => void;
  onLate: () => void;
  onCall: () => void;
}) {
  const now = useNow();
  const s = tripState(load, now, needsPreTrip);
  const { t, lang, info } = useDriverUi();
  const [reply, setReply] = useState(t.driveHint);
  const [listening, setListening] = useState(false);
  const recognizer = useRef<Recognizer | null>(null);
  const [canListen] = useState(() => makeRecognizer() !== null);
  useEscapeKey(onClose);
  useEffect(() => () => recognizer.current?.stop(), []);

  const place = s.card === "pickup" ? `${load.lane.origin}, ${load.lane.originState}` : `${load.lane.destination}, ${load.lane.destState}`;

  function run(cmd: DriveCommand) {
    let text: string;
    if (cmd === "arrived") {
      if (s.next.action === "arrive") {
        onArrive();
        text = t.checkedIn(place);
      } else text = s.arrived ? t.alreadyIn : t.finishSteps;
    } else if (cmd === "loaded" || cmd === "unloaded") {
      if (s.arrived && !s.handled && s.next.action === cmd) {
        onTripStep(cmd);
        text = cmd === "loaded" ? t.gotLoaded : t.gotUnloaded;
      } else text = s.arrived ? t.alreadyDone : t.notThere;
    } else if (cmd === "late") {
      onLate();
      text = t.toldLate;
    } else if (cmd === "call") {
      onCall();
      return;
    } else {
      // The step names come from the trip screens, which are English in the demo; other languages get the place.
      const stop = s.card === "pickup" ? t.pickup : s.card === "delivery" ? t.delivery : t.nextLoad;
      text = lang === "en" ? `Next: ${s.next.title}. ${s.card === "booking" ? "" : `${place}, ${s.drive}.`}` : `${stop}: ${place}${s.card === "booking" ? "" : `, ${s.drive}`}.`;
    }
    setReply(text);
    say(text, undefined, { lang: info.speech });
  }

  function listen() {
    if (listening) {
      recognizer.current?.stop();
      return;
    }
    const r = makeRecognizer(info.speech);
    if (!r) return;
    recognizer.current = r;
    r.interimResults = false;
    r.onresult = (e) => {
      const heard = e.results[0][0].transcript.toLowerCase();
      const cmd = commandFor(heard, t, lang === "en");
      if (cmd) run(cmd);
      else {
        const text = t.heard(heard);
        setReply(text);
        say(text, undefined, { lang: info.speech });
      }
    };
    r.onend = () => setListening(false);
    r.onerror = () => setListening(false);
    setListening(true);
    r.start();
  }

  const big = "flex flex-col items-center justify-center gap-2 rounded-3xl py-6 text-lg font-semibold active:scale-[0.98] transition-transform";
  return (
    <div role="dialog" aria-modal="true" aria-label="Driving mode" className="fixed inset-0 z-[70] flex flex-col bg-ink-950 p-5 text-white">
      <div className="flex items-center justify-between">
        <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-emerald-300">
          <Navigation className="h-4 w-4" /> {t.drivingMode}
        </p>
        <button type="button" onClick={onClose} className="flex items-center gap-1.5 rounded-full bg-white/10 px-4 py-2 text-sm font-semibold">
          <X className="h-4 w-4" /> {t.parked}
        </button>
      </div>

      <div className="mt-8">
        <p className="text-sm text-white/50">{s.card === "pickup" ? t.pickup : s.card === "delivery" ? t.delivery : t.nextLoad}</p>
        <p className="mt-1 text-4xl font-semibold leading-tight tracking-tight">{s.card === "booking" ? `${load.lane.origin} → ${load.lane.destination}` : place}</p>
        {s.card !== "booking" && <p className="mt-2 text-2xl font-semibold tabular text-white/80">{s.drive}</p>}
      </div>

      <p className="mt-6 min-h-[3.5rem] rounded-2xl bg-white/5 px-4 py-3 text-base leading-snug text-white/85" aria-live="polite">
        {reply}
      </p>

      <div className="mt-auto grid grid-cols-2 gap-3">
        <button type="button" onClick={() => run(s.arrived && !s.handled ? (s.card === "pickup" ? "loaded" : "unloaded") : "arrived")} className={cn(big, "bg-white text-ink-950")}>
          <Package className="h-7 w-7" /> {s.arrived && !s.handled ? (s.card === "pickup" ? t.loaded : t.unloaded) : t.arrived}
        </button>
        <button type="button" onClick={() => run("late")} className={cn(big, "bg-white/10")}>
          <Clock className="h-7 w-7" /> {t.late}
        </button>
        <button type="button" onClick={() => run("call")} className={cn(big, "bg-white/10")}>
          <Phone className="h-7 w-7" /> {t.callDispatch}
        </button>
        <button
          type="button"
          onClick={canListen ? listen : () => run("next")}
          aria-pressed={listening}
          className={cn(big, listening ? "bg-emerald-400 text-ink-950" : "bg-emerald-400/20 text-emerald-200")}
        >
          {listening ? <MicOff className="h-7 w-7" /> : <Mic className="h-7 w-7" />}
          {canListen ? (listening ? `${t.listening}…` : t.speak) : t.whatsNext}
        </button>
      </div>
      <p className="mt-4 text-center text-xs text-white/40">
        {t.driveFooter}
      </p>
    </div>
  );
}
