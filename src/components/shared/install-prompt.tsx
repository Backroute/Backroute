"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Plus, Share, X } from "lucide-react";

const KEY = "backroute.install";
const VISITS = "backroute.visits";
const SNOOZE_MS = 30 * 86400_000;

interface InstallEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const standalone = () =>
  window.matchMedia("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone === true;

function snoozed(): boolean {
  try {
    const at = Number(localStorage.getItem(KEY) ?? 0);
    return at > 0 && Date.now() - at < SNOOZE_MS;
  } catch {
    return true;
  }
}

/**
 * "Add Backroute to your home screen", on phones only, from the second visit on: then it opens like an app, full
 * screen, and (on iPhone) can get notifications. Android gets the system's install sheet; iPhone gets the two taps
 * to do it, since Safari has no button for it. Closed, it waits a month.
 */
export function InstallPrompt() {
  const [event, setEvent] = useState<InstallEvent | null>(null);
  const [ios, setIos] = useState(false);
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (standalone() || snoozed() || !window.matchMedia("(pointer: coarse)").matches) return;
    let visits = 1;
    try {
      // A visit is a new tab or app open, not every page.
      visits = Number(localStorage.getItem(VISITS) ?? 0);
      if (!sessionStorage.getItem(VISITS)) {
        visits += 1;
        localStorage.setItem(VISITS, String(visits));
        sessionStorage.setItem(VISITS, "1");
      }
    } catch {}
    if (visits < 2) return;
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setEvent(e as InstallEvent);
      setShow(true);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    const iPhone = /iPhone|iPad|iPod/.test(navigator.userAgent) && /Safari/.test(navigator.userAgent) && !/CriOS|FxiOS|EdgiOS/.test(navigator.userAgent);
    const t = iPhone
      ? setTimeout(() => {
          setIos(true);
          setShow(true);
        }, 4000)
      : undefined;
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      if (t) clearTimeout(t);
    };
  }, []);

  const close = () => {
    setShow(false);
    try {
      localStorage.setItem(KEY, String(Date.now()));
    } catch {}
  };

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          role="dialog"
          aria-label="Add Backroute to your home screen"
          initial={{ y: 40, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 40, opacity: 0 }}
          transition={{ type: "spring", stiffness: 420, damping: 36 }}
          className="hide-when-driving fixed inset-x-3 bottom-[5.5rem] z-[65] mx-auto max-w-sm rounded-3xl border border-line bg-white p-4 shadow-2xl"
        >
          <div className="flex items-start gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/icons/icon-192.png" alt="" width={44} height={44} className="h-11 w-11 shrink-0 rounded-xl" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-ink-950">Add Backroute to your home screen</p>
              <p className="mt-0.5 text-xs text-ink-500">
                {ios ? (
                  <>
                    Tap <Share className="inline h-3.5 w-3.5 -translate-y-px" aria-label="Share" /> below, then <span className="font-medium text-ink-800">Add to Home Screen</span>. It opens full screen and can send you alerts.
                  </>
                ) : (
                  "It opens full screen, like an app, and keeps you signed in."
                )}
              </p>
            </div>
            <button type="button" onClick={close} aria-label="Not now" className="-mr-1 -mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-ink-400 hover:bg-ink-100">
              <X className="h-4 w-4" />
            </button>
          </div>
          {event && (
            <button
              type="button"
              onClick={async () => {
                await event.prompt();
                await event.userChoice.catch(() => null);
                setEvent(null);
                close();
              }}
              className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-full bg-brand py-2.5 text-sm font-semibold text-brand-ink"
            >
              <Plus className="h-4 w-4" /> Add to home screen
            </button>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
