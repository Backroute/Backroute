"use client";

import { Children, useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

const GAP = 16;

/**
 * Load choices side by side, the way the App Store and ride apps line up options: swipe, or tap the arrows. It never
 * moves on its own, the next card peeks in from the edge so it's plain there's more, and "1 of 3" says how many.
 * Arrows and the count only show when the cards don't all fit.
 */
export function OfferRail({
  children,
  header,
  bleed,
  className,
}: {
  children: React.ReactNode;
  header?: React.ReactNode;
  /** On a phone screen with 20px sides: let the row run to the screen's edges. */
  bleed?: boolean;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const count = Children.count(children);
  const [state, setState] = useState({ index: 0, prev: false, next: count > 1 });

  const update = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const card = el.firstElementChild as HTMLElement | null;
    const step = (card?.offsetWidth ?? el.clientWidth) + GAP;
    const atEnd = el.scrollLeft + el.clientWidth >= el.scrollWidth - 4;
    setState({
      index: atEnd ? count - 1 : Math.min(count - 1, Math.round(el.scrollLeft / step)),
      prev: el.scrollLeft > 4,
      next: !atEnd,
    });
  }, [count]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    update();
    el.addEventListener("scroll", update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", update);
      ro.disconnect();
    };
  }, [update]);

  const go = (dir: 1 | -1) => {
    const el = ref.current;
    const card = el?.firstElementChild as HTMLElement | null;
    if (el && card) el.scrollBy({ left: dir * (card.offsetWidth + GAP), behavior: "smooth" });
  };

  const scrolls = state.prev || state.next;
  const arrow = "flex h-11 w-11 items-center justify-center rounded-full bg-ink-100 text-ink-950 transition-opacity hover:bg-ink-150 disabled:opacity-30";

  return (
    <div className={className}>
      {(header || scrolls) && (
        <div className="mb-1 flex items-center gap-3">
          <div className="min-w-0 flex-1">{header}</div>
          {scrolls && (
            <div className="flex shrink-0 items-center gap-2">
              <span className="mr-1 text-sm tabular text-ink-500" aria-live="polite">
                {state.index + 1} of {count}
              </span>
              <button type="button" aria-label="Previous load" className={arrow} disabled={!state.prev} onClick={() => go(-1)}>
                <ChevronLeft className="h-5 w-5" strokeWidth={2.5} />
              </button>
              <button type="button" aria-label="Next load" className={arrow} disabled={!state.next} onClick={() => go(1)}>
                <ChevronRight className="h-5 w-5" strokeWidth={2.5} />
              </button>
            </div>
          )}
        </div>
      )}
      {/* Room above for the "Best fit" tag and below for the shadow, which a scrolling row would otherwise clip. */}
      <div
        ref={ref}
        className={cn("flex snap-x snap-mandatory overflow-x-auto pb-8 pt-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden", bleed && "-mx-5 scroll-px-5 px-5")}
        style={{ gap: GAP }}
      >
        {Children.map(children, (child) => (
          <div className={cn("flex w-[min(88vw,23rem)] shrink-0 snap-start", count === 1 && "w-full max-w-[26rem]")}>{child}</div>
        ))}
      </div>
    </div>
  );
}
