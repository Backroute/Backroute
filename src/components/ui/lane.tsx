import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * A run from one place to another: "Chicago → Memphis" with a real arrow, sized to the text and as heavy as it, instead
 * of the thin "→" character. It takes the text's colour, so it works on light cards and dark panels alike.
 */
export function Lane({ from, to, className }: { from: React.ReactNode; to: React.ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex min-w-0 flex-wrap items-center gap-x-[0.3em]", className)}>
      <span>{from}</span>
      {/* The arrow stays with where it goes: a long lane wraps before the arrow, never leaving it hanging at a line's end. */}
      <span className="inline-flex items-center gap-x-[0.3em] whitespace-nowrap">
        <ArrowRight aria-label="to" className="h-[0.9em] w-[0.9em] shrink-0 opacity-45" strokeWidth={2.75} />
        <span>{to}</span>
      </span>
    </span>
  );
}
