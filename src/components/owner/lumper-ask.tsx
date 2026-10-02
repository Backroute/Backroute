"use client";

import { useState } from "react";
import { HandCoins } from "lucide-react";
import { AttentionCard } from "@/components/ui/attention";
import { Button } from "@/components/ui/button";
import { useStore } from "@/lib/store";
import { answerLumper, sampleExpressCode } from "@/lib/lumper";
import { celebrate } from "@/lib/feedback";
import { formatCurrency } from "@/lib/utils";
import type { Expense } from "@/lib/types";

/** A driver at the dock needs lumper money: approve it with the code they'll read out, or say no. */
export function LumperAsk({ ask, driverName, loadRef }: { ask: Expense; driverName: string; loadRef?: string }) {
  const demo = useStore((s) => s.session.mode === "demo");
  const [code, setCode] = useState("");
  return (
    <AttentionCard tone="urgent">
      <p className="flex items-center gap-2 text-sm font-medium text-ink-900">
        <HandCoins className="h-4 w-4 text-ink-400" /> {driverName} needs {formatCurrency(ask.amount)} for a lumper
      </p>
      <p className="mt-0.5 text-xs text-ink-500">
        {[ask.facility && `At ${ask.facility}`, loadRef, ask.note].filter(Boolean).join(" · ")}. Get an express code from your fuel card (Comdata, EFS) for this amount and send it.
      </p>
      <form
        className="mt-3 flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!code.trim()) return;
          answerLumper(ask.id, code);
          celebrate("approve");
        }}
      >
        <input
          aria-label="Payment code for the lumper"
          value={code}
          onChange={(e) => setCode(e.target.value.slice(0, 40))}
          placeholder="Express code"
          className="h-9 min-w-0 flex-1 rounded-full border border-line bg-white px-3 text-sm tabular outline-none focus:border-ink-400"
        />
        {demo && !code && (
          <Button size="sm" variant="ghost" type="button" onClick={() => setCode(sampleExpressCode())}>
            Make a sample code
          </Button>
        )}
        <Button size="sm" type="submit" disabled={!code.trim()}>
          Send code
        </Button>
        <Button size="sm" variant="danger" type="button" onClick={() => answerLumper(ask.id, null)}>
          No
        </Button>
      </form>
    </AttentionCard>
  );
}
