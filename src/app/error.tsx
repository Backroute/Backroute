"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { reportBrowserError } from "@/lib/report-error";

/** A page that crashed: the team hears about it (api/errors), and the person can try again or go home. */
export default function PageError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    reportBrowserError(error);
  }, [error]);
  return (
    <main className="mx-auto flex min-h-[60vh] w-full max-w-md flex-col items-center justify-center px-4 text-center">
      <h1 className="font-display text-2xl text-ink-950">Something went wrong on this page</h1>
      <p className="mt-2 text-sm text-ink-600">The Backroute team has been told. Your loads and messages are safe; dispatch keeps running.</p>
      <div className="mt-6 flex flex-wrap justify-center gap-2">
        <Button onClick={() => retry()}>Try again</Button>
        <Button variant="outline" href="/">
          Go home
        </Button>
      </div>
    </main>
  );
}
