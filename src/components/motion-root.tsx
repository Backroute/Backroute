"use client";

import { MotionConfig } from "framer-motion";

/** Animations follow the phone's "reduce motion" setting everywhere: cards still move, but instantly. */
export function MotionRoot({ children }: { children: React.ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}
