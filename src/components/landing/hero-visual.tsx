"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";

/** The 3D lanes load after the page, in the browser only; until then (or without WebGL) a still backdrop shows. */
const RouteScene = dynamic(() => import("./route-scene"), { ssr: false, loading: () => <Backdrop /> });

/** What the truck's day looks like from the owner's phone, one line at a time (a sample, labelled). */
const FEED = [
  { dot: "#276EF1", text: "Found 3 loads near Indianapolis for Truck 14" },
  { dot: "#FC823A", text: "Calling Coastal Freight about Kansas City" },
  { dot: "#06C167", text: "Booked at $1,107, over your $1,050 floor" },
  { dot: "#06C167", text: "Marcus called with the pickup and dock hours" },
  { dot: "#276EF1", text: "Next load lined up: Kansas City → Dallas" },
];

function canWebGL() {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") ?? c.getContext("webgl"));
  } catch {
    return false;
  }
}

export function HeroVisual() {
  const [mode, setMode] = useState<"wait" | "3d" | "still3d" | "flat">("wait");
  const [i, setI] = useState(0);
  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    // A browser that can't draw 3D (or a slow phone that asks to save data) gets the flat backdrop.
    const save = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reads the browser once, after mount
    setMode(!canWebGL() || save ? "flat" : reduce ? "still3d" : "3d");
    if (reduce) return;
    const t = setInterval(() => setI((x) => (x + 1) % FEED.length), 2600);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="absolute inset-0">
      {mode === "3d" || mode === "still3d" ? <RouteScene still={mode === "still3d"} /> : <Backdrop />}
      {/* Fades the scene into the copy on the left, and into the page below. */}
      <div className="pointer-events-none absolute inset-0 hidden lg:block" style={{ background: "linear-gradient(90deg, #000 0%, rgb(0 0 0 / 0.8) 32%, rgb(0 0 0 / 0) 58%)" }} />
      <div className="pointer-events-none absolute inset-0 lg:hidden" style={{ background: "linear-gradient(180deg, rgb(0 0 0 / 0) 0%, rgb(0 0 0 / 0) 30%, rgb(0 0 0 / 0.85) 52%, #000 64%)" }} />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-40" style={{ background: "linear-gradient(180deg, rgb(0 0 0 / 0), #000)" }} />
      <div className="pointer-events-none absolute bottom-40 right-5 hidden w-[340px] sm:right-8 lg:block xl:right-[max(2rem,calc((100vw-72rem)/2))]" aria-live="off">
        <AnimatePresence mode="popLayout">
          <motion.div
            key={i}
            initial={{ opacity: 0, y: 14, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -14, scale: 0.97 }}
            transition={{ duration: 0.4, ease: [0.2, 0.7, 0.2, 1] }}
            className="flex items-center gap-3 rounded-2xl border border-white/10 bg-[#141414]/90 px-4 py-3 text-[14px] text-white backdrop-blur"
          >
            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: FEED[i].dot }} />
            <span className="flex-1">{FEED[i].text}</span>
          </motion.div>
        </AnimatePresence>
        <p className="mt-2 text-right text-xs text-white/40">Sample day</p>
      </div>
    </div>
  );
}

/** Flat lanes in SVG: what shows while the 3D loads, and instead of it where it can't run. */
function Backdrop() {
  return (
    <svg className="absolute inset-0 h-full w-full" viewBox="0 0 800 500" preserveAspectRatio="xMidYMid slice" aria-hidden>
      <defs>
        <pattern id="dots" width="14" height="14" patternUnits="userSpaceOnUse">
          <circle cx="1.5" cy="1.5" r="1.1" fill="#2a2a2a" />
        </pattern>
      </defs>
      <rect width="800" height="500" fill="#000" />
      <rect width="800" height="500" fill="url(#dots)" />
      <path d="M430 300 C 500 230, 560 220, 610 210 S 700 260, 690 330 S 560 380, 520 360 S 450 330, 430 300" fill="none" stroke="#276EF1" strokeWidth="3" strokeDasharray="10 6" />
      {[[430, 300], [610, 210], [690, 330], [520, 360]].map(([x, y]) => (
        <circle key={`${x}${y}`} cx={x} cy={y} r="6" fill="#fff" />
      ))}
      <circle cx="610" cy="210" r="12" fill="none" stroke="#06C167" strokeWidth="2.5" />
    </svg>
  );
}
