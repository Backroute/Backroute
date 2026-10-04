"use client";

import { useEffect, useId, useSyncExternalStore } from "react";
import { AnimatePresence, motion, useDragControls, type PanInfo } from "framer-motion";
import { X } from "lucide-react";
import { useEscapeKey } from "@/lib/hooks";
import { cn } from "@/lib/utils";
import { Portal } from "./portal";

const useWide = () =>
  useSyncExternalStore(
    (cb) => {
      const mq = window.matchMedia("(min-width: 640px)");
      mq.addEventListener("change", cb);
      return () => mq.removeEventListener("change", cb);
    },
    () => window.matchMedia("(min-width: 640px)").matches,
    () => true,
  );

/**
 * Everything that opens over a page: on a phone it slides up from the bottom with a handle, and a pull down closes
 * it (like Uber and Apple Maps); on a computer it's a centered panel. Escape and the backdrop close it too.
 */
export function Sheet({
  open,
  onClose,
  title,
  description,
  tone = "light",
  size = "md",
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  /** "ink" for the dark trip panels. */
  tone?: "light" | "ink";
  size?: "md" | "lg";
  children: React.ReactNode;
}) {
  const wide = useWide();
  const drag = useDragControls();
  const titleId = useId();
  useEscapeKey(onClose, open);
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  const ink = tone === "ink";
  const end = (_: unknown, info: PanInfo) => {
    if (info.offset.y > 110 || info.velocity.y > 700) onClose();
  };

  return (
    <Portal>
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-6">
          <motion.div className="absolute inset-0 bg-black/50 backdrop-blur-[2px]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            initial={wide ? { opacity: 0, scale: 0.97, y: 8 } : { y: "100%" }}
            animate={wide ? { opacity: 1, scale: 1, y: 0 } : { y: 0 }}
            exit={wide ? { opacity: 0, scale: 0.97, y: 8 } : { y: "100%" }}
            transition={{ type: "spring", stiffness: 420, damping: 40 }}
            drag={wide ? false : "y"}
            dragListener={false}
            dragControls={drag}
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.6 }}
            onDragEnd={end}
            className={cn(
              "relative flex max-h-[94dvh] w-full flex-col overflow-hidden rounded-t-[1.75rem] shadow-2xl sm:max-h-[90vh] sm:rounded-3xl",
              size === "lg" ? "sm:max-w-xl" : "sm:max-w-md",
              ink ? "theme-ink bg-ink-900 text-white" : "bg-white",
            )}
          >
            {/* The handle: grab it (or the header) and pull down to close. */}
            <div className="cursor-grab touch-none active:cursor-grabbing" onPointerDown={(e) => !wide && drag.start(e)}>
              <span aria-hidden className={cn("mx-auto mt-2 block h-1.5 w-10 rounded-full sm:hidden", ink ? "bg-white/25" : "bg-ink-200")} />
              <div className="flex items-start justify-between gap-3 px-5 pb-3 pt-3">
                <div className="min-w-0">
                  <h2 id={titleId} className={cn("t-section", ink ? "text-white" : "text-ink-950")}>
                    {title}
                  </h2>
                  {description && <p className={cn("mt-0.5 text-sm", ink ? "text-white/60" : "text-ink-500")}>{description}</p>}
                </div>
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="Close"
                  className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-full", ink ? "bg-white/10 hover:bg-white/15" : "bg-ink-100 text-ink-600 hover:bg-ink-150")}
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
            <div className="overflow-y-auto overscroll-contain px-5 pb-[max(1.5rem,env(safe-area-inset-bottom))]">{children}</div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
    </Portal>
  );
}
