"use client";

import { useRef, useState } from "react";
import { Camera, Loader2 } from "lucide-react";
import { autoCrop } from "@/lib/doc-scan";
import { uploadFile } from "@/lib/cloud/files";
import { useStore } from "@/lib/store";

export interface ReadReceipt {
  preview: string;
  fileId?: string;
  amount?: number;
}

/** About what each kind of stop costs, for the practice fleet's pretend reading. */
const DEMO_AMOUNT: Record<string, [number, number]> = { lumper: [85, 240], parking: [15, 40], scale: [12, 15], detention: [50, 150], other: [20, 90] };

/**
 * The receipt first: one photo, and the amount comes off it, so the driver checks a number instead of typing one. The
 * photo goes with the expense, so the owner sees what was paid. A real account stores it and has it read; the
 * practice fleet pretends to.
 */
export function ReceiptCapture({ loadId, category, onRead }: { loadId: string | null; category: string; onRead: (r: ReadReceipt) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const demo = useStore((s) => s.session.mode === "demo");
  const [state, setState] = useState<{ preview: string; busy: boolean; note: string | null } | null>(null);

  async function take(file: File) {
    const page = (await autoCrop(file)).file;
    const preview = URL.createObjectURL(page);
    setState({ preview, busy: true, note: null });
    if (demo) {
      const [lo, hi] = DEMO_AMOUNT[category] ?? DEMO_AMOUNT.other;
      await new Promise((r) => setTimeout(r, 900));
      const amount = Math.round(lo + Math.random() * (hi - lo));
      setState({ preview, busy: false, note: `Read $${amount} off the receipt. Check it.` });
      return onRead({ preview, amount });
    }
    const r = await uploadFile("receipt", page, { loadId: loadId ?? undefined });
    if (!r.ok) {
      setState({ preview, busy: false, note: `${r.reason} You can still type the amount.` });
      return onRead({ preview });
    }
    setState({ preview, busy: false, note: r.amount ? `Read $${r.amount} off the receipt. Check it.` : "Couldn't read the total. Type it in." });
    onRead({ preview, fileId: r.id, amount: r.amount ?? undefined });
  }

  return (
    <div className="flex items-center gap-3">
      <input
        ref={input}
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        tabIndex={-1}
        aria-label="Photo of the receipt"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) void take(f);
        }}
      />
      {state ? (
        <span aria-hidden className="h-12 w-12 shrink-0 rounded-lg bg-ink-100 bg-cover bg-center" style={{ backgroundImage: `url(${state.preview})` }} />
      ) : null}
      <div className="min-w-0 flex-1">
        <button
          type="button"
          onClick={() => input.current?.click()}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-full bg-ink-950 px-4 py-2 text-sm font-semibold text-white"
        >
          <Camera className="h-4 w-4" /> {state ? "Retake the receipt" : "Snap the receipt"}
        </button>
        {state && (
          <p className="mt-1 flex items-center gap-1 text-xs text-ink-500" role="status">
            {state.busy ? (
              <>
                <Loader2 className="h-3 w-3 animate-spin" /> Reading it…
              </>
            ) : (
              state.note
            )}
          </p>
        )}
      </div>
    </div>
  );
}
