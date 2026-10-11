"use client";

import { useEffect, useRef, useState } from "react";
import { Sheet } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";

/**
 * In-app questions instead of the browser's prompt, confirm and alert boxes: they look like the rest of the app, work
 * the same on a phone, and can't be blocked or skipped by accident. Call `askAmount`, `askConfirm` or `tell` from
 * anywhere; the host mounted in the layout shows them one at a time.
 */
type Ask =
  | { kind: "amount"; title: string; body?: string; placeholder?: string; done: (v: number | null) => void }
  | { kind: "confirm"; title: string; body?: string; yes: string; danger?: boolean; done: (v: boolean) => void }
  | { kind: "tell"; title: string; body?: string; done: () => void };

const EVENT = "backroute:ask";
let queue: Ask[] = [];

function push(a: Ask) {
  queue = [...queue, a];
  if (typeof window !== "undefined") window.dispatchEvent(new Event(EVENT));
}

/** A dollar amount, or null when they cancel. */
export function askAmount(title: string, body?: string, placeholder?: string): Promise<number | null> {
  return new Promise((done) => push({ kind: "amount", title, body, placeholder, done }));
}

/** Yes or no, with the yes button saying what happens ("Remove 12 loads"). */
export function askConfirm(title: string, body: string | undefined, yes: string, danger?: boolean): Promise<boolean> {
  return new Promise((done) => push({ kind: "confirm", title, body, yes, danger, done }));
}

/** Something went wrong, said in the app. */
export function tell(title: string, body?: string): Promise<void> {
  return new Promise((done) => push({ kind: "tell", title, body, done }));
}

export function AskHost() {
  const [current, setCurrent] = useState<Ask | null>(null);
  const [value, setValue] = useState("");
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const next = () => setCurrent((c) => c ?? queue[0] ?? null);
    window.addEventListener(EVENT, next);
    next();
    return () => window.removeEventListener(EVENT, next);
  }, []);

  useEffect(() => {
    if (current?.kind === "amount") requestAnimationFrame(() => input.current?.focus());
  }, [current]);

  function finish(answer: unknown) {
    if (!current) return;
    queue = queue.filter((a) => a !== current);
    (current.done as (v: unknown) => void)(answer);
    setValue("");
    setCurrent(queue[0] ?? null);
  }

  const cancel = () => finish(current?.kind === "amount" ? null : current?.kind === "confirm" ? false : undefined);
  const amount = Number(value.replace(/[$,\s]/g, ""));

  return (
    <Sheet open={!!current} onClose={cancel} title={current?.title ?? ""}>
      {current?.body && <p className="text-sm text-ink-600">{current.body}</p>}
      {current?.kind === "amount" && (
        <form
          className="mt-4 flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (amount > 0) finish(amount);
          }}
        >
          <label className="relative block">
            <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-ink-400">$</span>
            <input
              ref={input}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              inputMode="decimal"
              placeholder={current.placeholder ?? "0"}
              aria-label={current.title}
              className="w-full rounded-2xl border border-line bg-white py-3 pl-8 pr-4 text-lg font-semibold tabular outline-none focus:border-ink-400"
            />
          </label>
          <div className="flex gap-2">
            <Button type="submit" disabled={!(amount > 0)}>
              Use {amount > 0 ? `$${amount.toLocaleString()}` : "this amount"}
            </Button>
            <Button type="button" variant="ghost" onClick={cancel}>
              Cancel
            </Button>
          </div>
        </form>
      )}
      {current?.kind === "confirm" && (
        <div className="mt-4 flex gap-2">
          <Button variant={current.danger ? "danger" : "primary"} onClick={() => finish(true)}>
            {current.yes}
          </Button>
          <Button variant="ghost" onClick={cancel}>
            Cancel
          </Button>
        </div>
      )}
      {current?.kind === "tell" && (
        <div className="mt-4">
          <Button onClick={() => finish(undefined)}>OK</Button>
        </div>
      )}
    </Sheet>
  );
}
