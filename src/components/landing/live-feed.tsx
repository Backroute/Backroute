"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";

/** What the dispatcher is doing for one truck, one line at a time, beside the phone on the website. A sample, said so. */
const FEED = [
  { dot: "#276EF1", text: "Found 3 loads near Indianapolis for Truck 14" },
  { dot: "#FC823A", text: "Asking Coastal Freight for $1,180" },
  { dot: "#06C167", text: "Booked at $1,107, over your $1,050 floor" },
  { dot: "#06C167", text: "Called Marcus with the pickup and dock hours" },
  { dot: "#276EF1", text: "Next load lined up: Kansas City → Dallas" },
];

export function LiveFeed() {
  const still = useReducedMotion();
  const [i, setI] = useState(0);
  useEffect(() => {
    if (still) return;
    const t = setInterval(() => setI((x) => (x + 1) % FEED.length), 2800);
    return () => clearInterval(t);
  }, [still]);
  return (
    <div className="w-[340px] max-w-full">
      <div className="relative h-[52px]">
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.div
            key={i}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.45, ease: [0.2, 0.7, 0.2, 1] }}
            className="absolute inset-x-0 flex items-center gap-3 rounded-2xl border border-line bg-ink-0 px-4 py-3.5 text-[14px] font-medium text-ink-950 shadow-[0_16px_40px_-20px_rgb(0_0_0/0.35)]"
          >
            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: FEED[i].dot }} />
            <span className="truncate">{FEED[i].text}</span>
          </motion.div>
        </AnimatePresence>
      </div>
      <p className="mt-2 pl-1 text-xs text-ink-500">Sample day</p>
    </div>
  );
}
