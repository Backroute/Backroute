"use client";

import Link from "next/link";
import { ArrowRight, LayoutGrid, Smartphone, Sparkles } from "lucide-react";
import { Logo } from "@/components/shared/logo";
import { cloudEnabled } from "@/lib/cloud/client";
import { exitDemo, startDemo } from "@/lib/cloud/demo";

const TOURS = [
  {
    href: "/carrier",
    icon: LayoutGrid,
    title: "Owner dashboard",
    body: "Watch the AI find, negotiate and book loads for a 6-truck fleet, call drivers, and check rate cons. You only approve the few things that need you.",
  },
  {
    href: "/driver",
    icon: Smartphone,
    title: "Driver app",
    body: "What a driver sees: the next load, calls from the AI dispatcher in their own language, hands-free driving mode, documents and pay.",
  },
  {
    href: "/signup",
    icon: Sparkles,
    title: "Sign-up",
    body: "The five-minute setup, from MC number to trucks being dispatched. Try it as a fleet or as an owner-operator.",
  },
];

/** The link to share with anyone: the whole product on a sample fleet, no account needed. */
export default function DemoPage() {
  return (
    <div className="min-h-screen bg-ink-50">
      <div className="mx-auto flex max-w-2xl flex-col gap-8 px-4 py-10 sm:py-16">
        <Link href="/" aria-label="Backroute home" className="self-start">
          <Logo />
        </Link>
        <div>
          <h1 className="font-display text-4xl tracking-tight text-ink-950 sm:text-5xl">See how Backroute works</h1>
          <p className="mt-3 text-base text-ink-600">
            A sample fleet with the AI dispatcher running live. No account needed. Everything here is made up: the trucks, brokers, loads and calls.
            Nothing is saved, and nobody gets texted or called.
          </p>
        </div>

        <ul className="flex flex-col gap-3">
          {TOURS.map((t) => (
            <li key={t.href}>
              <button
                type="button"
                onClick={() => startDemo(t.href)}
                className="group flex w-full items-start gap-4 rounded-3xl border border-line bg-white p-5 text-left transition-colors hover:border-ink-400"
              >
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-ink-950 text-white">
                  <t.icon className="h-5 w-5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5 text-base font-semibold text-ink-950">
                    {t.title} <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                  </span>
                  <span className="mt-1 block text-sm text-ink-600">{t.body}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>

        <p className="rounded-2xl bg-amber-100 px-4 py-3 text-sm text-amber-950">
          Tip: switch between the owner and driver side from the yellow bar at the top. It&apos;s the same fleet, so a call the AI makes to a
          driver shows up on the owner&apos;s dashboard too.
        </p>

        {cloudEnabled && (
          <p className="text-center text-sm text-ink-600">
            Ready to run your own trucks?{" "}
            <button type="button" onClick={() => exitDemo("/signup")} className="font-medium text-ink-950 underline">
              Get started
            </button>{" "}
            or{" "}
            <button type="button" onClick={() => exitDemo("/login")} className="font-medium text-ink-950 underline">
              sign in
            </button>
            .
          </p>
        )}
      </div>
    </div>
  );
}
