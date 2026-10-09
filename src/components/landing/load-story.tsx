"use client";

import { useRef, useState } from "react";
import { AnimatePresence, motion, useMotionValueEvent, useScroll, useSpring } from "framer-motion";
import { Check, FileCheck2, Phone, Search, Truck } from "lucide-react";

/**
 * One load, start to paid, as the page scrolls: the steps stay pinned on the left and the screen on the right changes
 * with each one. On a phone each step simply stacks with its screen under it. All numbers are a sample, said so.
 */

const STEPS = [
  { icon: Search, title: "Finds the load", body: "Every board and every broker email, checked all day. Ranked by what you keep after fuel, tolls and empty miles." },
  { icon: Phone, title: "Gets your rate", body: "It calls and emails brokers the way a good dispatcher does, and never goes below the floor you set." },
  { icon: Truck, title: "Keeps the truck moving", body: "Check calls, appointments and paperwork, with the next load lined up before this one delivers." },
  { icon: FileCheck2, title: "Gets you paid", body: "Proof of delivery and the invoice go to the broker the same day. Late payers get a reminder." },
];

export function LoadStory() {
  const ref = useRef<HTMLDivElement>(null);
  const [step, setStep] = useState(0);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end end"] });
  const bar = useSpring(scrollYProgress, { stiffness: 140, damping: 30 });
  useMotionValueEvent(scrollYProgress, "change", (v) => setStep(Math.min(STEPS.length - 1, Math.floor(v * STEPS.length))));

  return (
    <>
      {/* Phone: the steps stacked, each with its screen. */}
      <ol className="mt-10 flex flex-col gap-10 md:hidden">
        {STEPS.map((s, i) => (
          <li key={s.title}>
            <StepText i={i} active />
            <div className="mt-5">
              <Screen step={i} />
            </div>
          </li>
        ))}
      </ol>

      {/* Larger screens: pinned while the page scrolls through the four steps. */}
      <div ref={ref} className="relative hidden md:block" style={{ height: `${STEPS.length * 85}vh` }}>
        <div className="sticky top-16 grid h-[calc(100vh-4rem)] grid-cols-[1fr_1.1fr] items-center gap-14">
          <div className="flex gap-6">
            <div className="relative w-1 shrink-0 overflow-hidden rounded-full bg-ink-200">
              <motion.div className="absolute inset-x-0 top-0 origin-top bg-ink-950" style={{ scaleY: bar, height: "100%" }} />
            </div>
            <ol className="flex flex-col gap-7">
              {STEPS.map((s, i) => (
                <li key={s.title}>
                  <StepText i={i} active={i === step} />
                </li>
              ))}
            </ol>
          </div>
          <div className="relative h-[460px]">
            <AnimatePresence mode="wait">
              <motion.div
                key={step}
                className="absolute inset-0 flex items-center"
                initial={{ opacity: 0, y: 24, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -24, scale: 0.98 }}
                transition={{ duration: 0.35, ease: [0.2, 0.7, 0.2, 1] }}
              >
                <Screen step={step} />
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
      </div>
    </>
  );
}

function StepText({ i, active }: { i: number; active: boolean }) {
  const s = STEPS[i];
  const Icon = s.icon;
  return (
    <div className={`transition-opacity duration-300 ${active ? "opacity-100" : "opacity-35"}`}>
      <p className="flex items-center gap-2 text-sm font-semibold text-ink-500">
        <Icon className="h-4 w-4" /> Step {i + 1}
      </p>
      <h3 className="mt-1 text-2xl font-bold tracking-[-0.02em] lg:text-[28px]">{s.title}</h3>
      <p className="mt-2 max-w-md text-[16px] leading-relaxed text-ink-600">{s.body}</p>
    </div>
  );
}

const card = "theme-invert w-full rounded-3xl bg-black p-6 text-white shadow-[0_30px_60px_-30px_rgb(0_0_0/0.5)]";

function Screen({ step }: { step: number }) {
  if (step === 0)
    return (
      <div className={card}>
        <p className="text-sm text-ink-500">Loads that fit Truck 14 · sample</p>
        <ul className="mt-4 flex flex-col gap-2.5">
          {[
            { lane: "Indianapolis → Kansas City", pay: "$1,107", keep: "$612 after costs", score: 91, best: true },
            { lane: "Indianapolis → Columbus", pay: "$640", keep: "$318 after costs", score: 74 },
            { lane: "Louisville → Atlanta", pay: "$1,050", keep: "$402 after costs", score: 62 },
          ].map((l, i) => (
            <motion.li
              key={l.lane}
              initial={{ opacity: 0, x: 16 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.08 * i }}
              className={`flex items-center justify-between gap-3 rounded-2xl p-4 ${l.best ? "bg-ink-100" : "border border-line"}`}
            >
              <div>
                {l.best && <p className="text-xs font-semibold text-[var(--link)]">Best fit</p>}
                <p className="font-bold">{l.lane}</p>
                <p className="text-sm text-ink-500">
                  {l.pay} · {l.keep}
                </p>
              </div>
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border-[3px] border-ink-950 text-sm font-bold tabular">{l.score}</span>
            </motion.li>
          ))}
        </ul>
      </div>
    );
  if (step === 1)
    return (
      <div className={card}>
        <p className="text-sm text-ink-500">Call with Coastal Freight · sample</p>
        <ul className="mt-4 flex flex-col gap-2.5 text-[15px]">
          {[
            { who: "Broker", text: "I can do a thousand on that one." },
            { who: "Backroute", text: "It's 486 miles into Kansas City. We'd need $1,180 to make it work." },
            { who: "Broker", text: "Best I can do is $1,107." },
            { who: "Backroute", text: "That works. Send the rate con to dispatch and I'll sign it." },
          ].map((m, i) => (
            <motion.li
              key={i}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.35 * i }}
              className={`max-w-[85%] rounded-2xl px-4 py-2.5 ${m.who === "Backroute" ? "self-end bg-ink-950 text-ink-0" : "self-start bg-ink-100"}`}
            >
              <span className="block text-xs font-semibold opacity-60">{m.who}</span>
              {m.text}
            </motion.li>
          ))}
        </ul>
        <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.5 }} className="mt-4 rounded-xl bg-ink-100 px-4 py-3 text-sm">
          Booked at <span className="font-bold">$1,107</span>, $57 over your $1,050 floor.
        </motion.p>
      </div>
    );
  if (step === 2)
    return (
      <div className={card}>
        <p className="text-sm text-ink-500">Truck 14 · Marcus · sample</p>
        <p className="mt-2 text-xl font-bold">Indianapolis → Kansas City</p>
        <div className="mt-5 h-2 overflow-hidden rounded-full bg-ink-100">
          <motion.div className="h-full rounded-full bg-[var(--dot-live)]" initial={{ width: "8%" }} animate={{ width: "64%" }} transition={{ duration: 1.6, ease: "easeOut" }} />
        </div>
        <ul className="mt-5 flex flex-col gap-3 text-[15px]">
          {["Called Marcus with the pickup address and dock hours", "Loaded at 9:40, seal 448812 noted", "Check call: on time, 3 hours out", "Next load lined up: Kansas City → Dallas"].map((t, i) => (
            <motion.li key={t} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.25 * i }} className="flex gap-3">
              <Check className="mt-0.5 h-5 w-5 shrink-0" strokeWidth={2.5} /> {t}
            </motion.li>
          ))}
        </ul>
      </div>
    );
  return (
    <div className={card}>
      <p className="text-sm text-ink-500">Invoice · sample</p>
      <div className="mt-4 flex items-end justify-between">
        <div>
          <p className="text-sm text-ink-500">Coastal Freight</p>
          <p className="text-[40px] font-bold leading-none tracking-[-0.04em] tabular">$1,107</p>
        </div>
        <motion.span initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: "spring", delay: 0.4 }} className="rounded-full bg-[var(--dot-live)] px-3 py-1.5 text-sm font-semibold text-black">
          Paid
        </motion.span>
      </div>
      <ul className="mt-5 flex flex-col gap-3 border-t border-line pt-5 text-[15px]">
        {["Proof of delivery read and attached", "Invoice sent with the rate con", "Payment matched to the invoice"].map((t) => (
          <li key={t} className="flex gap-3">
            <Check className="mt-0.5 h-5 w-5 shrink-0" strokeWidth={2.5} /> {t}
          </li>
        ))}
      </ul>
    </div>
  );
}
