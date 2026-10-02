"use client";

import { useEffect } from "react";
import { MotionConfig } from "framer-motion";
import { primeAudio } from "@/lib/feedback";

/** Animations follow the phone's "reduce motion" setting everywhere: cards still move, but instantly. */
export function MotionRoot({ children }: { children: React.ReactNode }) {
  useEffect(() => primeAudio(), []);
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}
