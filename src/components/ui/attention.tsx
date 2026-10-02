"use client";

import * as React from "react";
import { animate, motion, useMotionValue, useTransform, type PanInfo } from "framer-motion";
import { Check, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import { haptic } from "@/lib/feedback";

/**
 * How much something needs the owner, shown the same way everywhere: a thin colored edge on a plain card. Red needs a
 * decision now, amber is waiting on them, grey is for their information, green is done.
 */
export type AttentionTone = "urgent" | "waiting" | "info" | "done";

const EDGE: Record<AttentionTone, string> = {
  urgent: "bg-[var(--accent-danger)]",
  waiting: "bg-[var(--accent-warn)]",
  info: "bg-ink-300",
  done: "bg-[var(--accent-live)]",
};

export const TONE_LABEL: Record<AttentionTone, string> = {
  urgent: "Needs a decision now",
  waiting: "Waiting on you",
  info: "For your information",
  done: "Done",
};

export function AttentionCard({ tone, className, children, ...props }: { tone: AttentionTone } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("relative h-full overflow-hidden rounded-2xl border border-line bg-white p-4 pl-5 shadow-[0_1px_2px_rgb(0_0_0/0.04)]", className)} {...props}>
      <span aria-hidden className={cn("absolute inset-y-0 left-0 w-1", EDGE[tone])} />
      <span className="sr-only">{TONE_LABEL[tone]}. </span>
      {children}
    </div>
  );
}

/** Phones and tablets: swipes work. A mouse never drags a card by accident. */
function useCoarsePointer() {
  return React.useSyncExternalStore(
    (cb) => {
      const mq = window.matchMedia("(pointer: coarse)");
      mq.addEventListener("change", cb);
      return () => mq.removeEventListener("change", cb);
    },
    () => window.matchMedia("(pointer: coarse)").matches,
    () => false,
  );
}

const THRESHOLD = 96;

/**
 * Swipe right to do the card's main thing, left to set it aside until later. Only on touch screens, only for cards
 * whose main thing is safe in one move (no money decisions, no message to edit): everything else has its buttons.
 */
export function SwipeAction({
  onRight,
  rightLabel,
  onLeft,
  leftLabel = "Later",
  children,
}: {
  onRight?: () => void;
  rightLabel?: string;
  onLeft?: () => void;
  leftLabel?: string;
  children: React.ReactNode;
}) {
  const coarse = useCoarsePointer();
  const x = useMotionValue(0);
  const rightOpacity = useTransform(x, [0, THRESHOLD], [0, 1]);
  const leftOpacity = useTransform(x, [-THRESHOLD, 0], [1, 0]);
  if (!coarse || (!onRight && !onLeft)) return <>{children}</>;

  function end(_: unknown, info: PanInfo) {
    const go = info.offset.x > THRESHOLD || info.velocity.x > 600 ? "right" : info.offset.x < -THRESHOLD || info.velocity.x < -600 ? "left" : null;
    const fn = go === "right" ? onRight : go === "left" ? onLeft : undefined;
    if (fn) {
      haptic("tap");
      void animate(x, go === "right" ? 480 : -480, { duration: 0.18 }).then(fn);
    } else void animate(x, 0, { type: "spring", stiffness: 500, damping: 40 });
  }

  return (
    <div className="relative h-full">
      <div aria-hidden className="absolute inset-0 flex items-center justify-between rounded-2xl px-5 text-xs font-semibold">
        <motion.span style={{ opacity: rightOpacity }} className="flex items-center gap-1.5 text-[var(--accent-live)]">
          {onRight && (
            <>
              <Check className="h-4 w-4" /> {rightLabel}
            </>
          )}
        </motion.span>
        <motion.span style={{ opacity: leftOpacity }} className="flex items-center gap-1.5 text-ink-500">
          {onLeft && (
            <>
              {leftLabel} <Clock className="h-4 w-4" />
            </>
          )}
        </motion.span>
      </div>
      <motion.div
        drag="x"
        dragDirectionLock
        dragConstraints={{ left: onLeft ? -200 : 0, right: onRight ? 200 : 0 }}
        dragElastic={0.2}
        style={{ x, touchAction: "pan-y" }}
        onDragEnd={end}
        className="relative h-full"
      >
        {children}
      </motion.div>
    </div>
  );
}
