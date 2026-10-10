"use client";

import { useState } from "react";
import { BellRing, FileText, Landmark, Loader2, Send, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { invoiceAction } from "@/lib/cloud/agent";
import { openFile } from "@/lib/cloud/files";
import { useStore } from "@/lib/store";
import type { Load } from "@/lib/types";
import { formatCurrency } from "@/lib/utils";

type Open = null | "resend" | "paid";

/**
 * What the office can do with one invoice: open it, send it again (to the broker's accounts payable, say), send the
 * packet to factoring, remind the broker now, or mark it paid. Paid short, Backroute asks the broker what the
 * difference is for. Real accounts only: it all goes through the server.
 */
export function InvoiceActions({ load }: { load: Load }) {
  const real = useStore((s) => s.session.mode !== "demo");
  const factoringEmail = useStore((s) => s.settings.factoringEmail);
  const [open, setOpen] = useState<Open>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const inv = load.invoice;
  const [to, setTo] = useState(inv?.sentTo ?? "");
  const [amount, setAmount] = useState(inv ? String(inv.amount) : "");
  const [paidOn, setPaidOn] = useState(new Date().toISOString().slice(0, 10));
  if (!real || !inv) return null;

  const run = async (body: Parameters<typeof invoiceAction>[0], done: string) => {
    setBusy(true);
    const err = await invoiceAction(body);
    setBusy(false);
    setNote(err ?? done);
    if (!err) setOpen(null);
  };
  const paid = Number(amount.replace(/[$,\s]/g, ""));
  const field = "rounded-xl border border-line bg-white px-3 py-2 text-sm text-ink-900 outline-none focus:border-ink-400";

  return (
    <div className="mt-3 flex flex-col gap-2 border-t border-line pt-3">
      <div className="flex flex-wrap gap-1.5">
        {inv.fileId && (
          <Button size="sm" variant="ghost" onClick={() => void openFile(inv.fileId!)}>
            <FileText className="h-3.5 w-3.5" /> Open invoice
          </Button>
        )}
        {!inv.paidAt && (
          <>
            <Button size="sm" variant="ghost" aria-expanded={open === "resend"} onClick={() => setOpen(open === "resend" ? null : "resend")}>
              <Send className="h-3.5 w-3.5" /> {inv.sentAt ? "Send again" : "Send now"}
            </Button>
            {factoringEmail && !load.factoredAt && (
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => void run({ action: "factor", loadId: load.id }, `Sent the packet to ${factoringEmail}.`)}>
                <Landmark className="h-3.5 w-3.5" /> Send to factoring
              </Button>
            )}
            {inv.sentAt && !factoringEmail && (
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => void run({ action: "remind", loadId: load.id }, `Reminded ${inv.sentTo}.`)}>
                <BellRing className="h-3.5 w-3.5" /> Remind now
              </Button>
            )}
            <Button size="sm" variant="ghost" aria-expanded={open === "paid"} onClick={() => setOpen(open === "paid" ? null : "paid")}>
              <Wallet className="h-3.5 w-3.5" /> Mark paid
            </Button>
          </>
        )}
      </div>

      {open === "resend" && (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void run({ action: "resend", loadId: load.id, to: to.trim() || undefined }, `Sent invoice ${inv.number} to ${to.trim() || "the broker"}.`);
          }}
        >
          <label className="flex min-w-56 flex-1 flex-col gap-1 text-xs text-ink-500">
            Send to (their billing or accounts payable email)
            <input type="email" value={to} onChange={(e) => setTo(e.target.value)} placeholder="ap@broker.com" className={field} />
          </label>
          <Button size="sm" type="submit" disabled={busy}>
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />} Send with the POD
          </Button>
        </form>
      )}

      {open === "paid" && (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!(paid > 0)) return;
            const short = paid < inv.amount - 1;
            void run({ action: "paid", loadId: load.id, amount: paid, paidOn }, short ? `Marked paid, ${formatCurrency(inv.amount - paid)} short. Backroute is asking the broker what the difference is for.` : "Marked paid.");
          }}
        >
          <label className="flex w-32 flex-col gap-1 text-xs text-ink-500">
            Amount received
            <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className={field} aria-label="Amount received" />
          </label>
          <label className="flex w-40 flex-col gap-1 text-xs text-ink-500">
            Paid on
            <input type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} className={field} />
          </label>
          <Button size="sm" type="submit" disabled={busy || !(paid > 0)}>
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null} Save
          </Button>
          {paid > 0 && paid < inv.amount - 1 && <p className="w-full text-xs text-[var(--accent-warn)]">{formatCurrency(inv.amount - paid)} short of {formatCurrency(inv.amount)}. Backroute will ask the broker what it&apos;s for and for the balance.</p>}
        </form>
      )}

      {note && (
        <p className="text-xs text-ink-600" role="status">
          {note}
        </p>
      )}
    </div>
  );
}
