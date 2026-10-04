"use client";

import { Children, useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

const GAP = 16;

/**
 * Load choices side by side, the way the App Store and ride apps line up options: swipe, or tap the round arrows on
 * either side. It never moves on its own, the next card peeks in from the edge so it's plain there's more, and the dots
 * underneath say how many and which one is showing (tap one to jump to it). An arrow only shows where there's more.
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

  const stepOf = (el: HTMLElement) => ((el.firstElementChild as HTMLElement | null)?.offsetWidth ?? el.clientWidth) + GAP;

  const update = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const atEnd = el.scrollLeft + el.clientWidth >= el.scrollWidth - 4;
    setState({
      index: atEnd ? count - 1 : Math.min(count - 1, Math.round(el.scrollLeft / stepOf(el))),
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
    if (el) el.scrollBy({ left: dir * stepOf(el), behavior: "smooth" });
  };
  const jump = (i: number) => {
    const el = ref.current;
    if (el) el.scrollTo({ left: i * stepOf(el), behavior: "smooth" });
  };

  // A 44px target for a thumb, drawn as a 36px frosted circle. It sits level with the trip line, where the card's edge
  // has only the line and dots under it, so it never covers a word or a number.
  const arrow = "group/arrow absolute top-[8.25rem] z-10 flex h-11 w-11 items-center justify-center";
  const circle =
    "flex h-9 w-9 items-center justify-center rounded-full border border-line bg-white/90 text-ink-950 shadow-[0_4px_16px_rgb(0_0_0/0.2)] backdrop-blur group-hover/arrow:bg-white";

  return (
    <div className={className}>
      {header && <div className="mb-1">{header}</div>}
      <div className="relative">
        {/* Room above for the "Best fit" tag and below for the shadow, which a scrolling row would otherwise clip. */}
        <div
          ref={ref}
          className={cn("flex snap-x snap-mandatory items-start overflow-x-auto pb-8 pt-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden", bleed && "-mx-5 scroll-px-5 px-5")}
          style={{ gap: GAP }}
        >
          {Children.map(children, (child) => (
            <div className={cn("flex w-[min(88vw,23rem)] shrink-0 snap-start", count === 1 && "w-full max-w-[26rem]")}>{child}</div>
          ))}
        </div>
        {state.prev && (
          <button type="button" aria-label="Previous load" className={cn(arrow, bleed ? "-left-5" : "-left-6")} onClick={() => go(-1)}>
            <span className={circle}>
              <ChevronLeft className="h-5 w-5" strokeWidth={2.5} />
            </span>
          </button>
        )}
        {state.next && (
          <button type="button" aria-label="Next load" className={cn(arrow, bleed ? "-right-5" : "-right-3")} onClick={() => go(1)}>
            <span className={circle}>
              <ChevronRight className="h-5 w-5" strokeWidth={2.5} />
            </span>
          </button>
        )}
      </div>
      {(state.prev || state.next) && (
        <div className="relative z-10 -mt-5 flex items-center justify-center gap-0.5">
          {Children.map(children, (_, i) => (
            <button
              type="button"
              aria-label={`Load ${i + 1} of ${count}`}
              aria-current={i === state.index}
              onClick={() => jump(i)}
              className="flex h-8 items-center px-1"
            >
              <span className={cn("block h-2 rounded-full transition-all duration-300", i === state.index ? "w-6 bg-ink-950" : "w-2 bg-ink-300")} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
