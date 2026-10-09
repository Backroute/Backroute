"use client";

import { useRef, type ReactNode } from "react";
import { motion, useMotionValue, useReducedMotion, useSpring, useTransform } from "framer-motion";

/** Rises into place the first time it scrolls into view. Still for anyone who asked for less motion. */
export function Reveal({ children, delay = 0, className }: { children: ReactNode; delay?: number; className?: string }) {
  const still = useReducedMotion();
  return (
    <motion.div
      className={className}
      initial={still ? false : { opacity: 0, y: 28 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{ duration: 0.6, delay, ease: [0.2, 0.7, 0.2, 1] }}
    >
      {children}
    </motion.div>
  );
}

/** Leans toward the pointer in 3D, with a soft light following it. Flat on touch screens and for less motion. */
export function TiltCard({ children, className }: { children: ReactNode; className?: string }) {
  const still = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const x = useMotionValue(0.5);
  const y = useMotionValue(0.5);
  const rx = useSpring(useTransform(y, [0, 1], [7, -7]), { stiffness: 180, damping: 18 });
  const ry = useSpring(useTransform(x, [0, 1], [-9, 9]), { stiffness: 180, damping: 18 });
  const glow = useTransform([x, y], ([gx, gy]) => `radial-gradient(420px circle at ${(gx as number) * 100}% ${(gy as number) * 100}%, rgb(255 255 255 / 0.10), transparent 60%)`);
  return (
    <div style={{ perspective: 1100 }} className={className}>
      <motion.div
        ref={ref}
        style={still ? undefined : { rotateX: rx, rotateY: ry, transformStyle: "preserve-3d" }}
        className="relative"
        onPointerMove={(e) => {
          if (still || e.pointerType !== "mouse" || !ref.current) return;
          const r = ref.current.getBoundingClientRect();
          x.set((e.clientX - r.left) / r.width);
          y.set((e.clientY - r.top) / r.height);
        }}
        onPointerLeave={() => {
          x.set(0.5);
          y.set(0.5);
        }}
      >
        {children}
        {!still && <motion.div aria-hidden className="pointer-events-none absolute inset-0 rounded-3xl" style={{ background: glow }} />}
      </motion.div>
    </div>
  );
}

/** A slow, endless row of names. Holds still for less motion, and pauses under the pointer. */
export function Marquee({ items }: { items: string[] }) {
  const still = useReducedMotion();
  const row = (hidden?: boolean) => (
    <ul aria-hidden={hidden} className="flex shrink-0 items-center gap-12 pr-12">
      {items.map((t) => (
        <li key={t} className="whitespace-nowrap text-[clamp(1.25rem,2.4vw,1.75rem)] font-bold tracking-[-0.02em] text-white/80">
          {t}
        </li>
      ))}
    </ul>
  );
  if (still) return <div className="flex flex-wrap justify-center gap-x-10 gap-y-3">{row()}</div>;
  return (
    <div className="group flex overflow-hidden [mask-image:linear-gradient(90deg,transparent,#000_12%,#000_88%,transparent)]">
      <div className="flex animate-[marquee_32s_linear_infinite] group-hover:[animation-play-state:paused]">
        {row()}
        {row(true)}
      </div>
    </div>
  );
}
