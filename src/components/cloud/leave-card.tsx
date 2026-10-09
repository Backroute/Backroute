"use client";

import { useState } from "react";
import { Download, Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { pickMembership, useMemberships } from "@/lib/cloud/account";
import { deleteAccount, downloadEverything } from "@/lib/cloud/leave";
import { signOut } from "@/lib/cloud/sync";

const WHY: Record<string, string> = {
  confirm: "That isn't the company name. Type it exactly as it shows above.",
  billing: "Your subscription couldn't be cancelled, so nothing was deleted. Try again in a minute, or email hello@backroute.pro.",
  owner_only: "Only the owner can delete the account.",
};

/** The owner taking everything with them, and deleting the account. */
export function LeaveCard() {
  const me = pickMembership(useMemberships((s) => s.list));
  const [progress, setProgress] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [typed, setTyped] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (me?.role !== "owner") return null;
  const name = me.carrierName;

  async function download() {
    setError(null);
    setSaved(null);
    setProgress("Starting…");
    try {
      const r = await downloadEverything(setProgress);
      setSaved(`Saved: your data and ${r.files} file${r.files === 1 ? "" : "s"}.${r.missed.length ? ` ${r.missed.length} couldn't be copied; they're listed in the README.` : ""}`);
    } catch {
      setError("Couldn't make the download. Check your connection and try again.");
    }
    setProgress(null);
  }

  async function remove() {
    setDeleting(true);
    setError(null);
    const r = await deleteAccount(typed).catch(() => ({ ok: false as const, reason: "failed" }));
    if (r.ok) return void signOut();
    setError(WHY[r.reason] ?? "Couldn't delete the account. Try again, or email hello@backroute.pro.");
    setDeleting(false);
  }

  const input = "w-full rounded-xl border border-line bg-white px-3 py-2 text-sm outline-none focus:border-ink-400";
  return (
    <Card>
      <CardHeader>
        <CardTitle>Your data</CardTitle>
        <CardDescription>Everything you have on Backroute is yours: download it any time. If you leave, you can delete the account and everything in it.</CardDescription>
      </CardHeader>
      <CardContent className="!pt-3 flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" disabled={!!progress || deleting} onClick={() => void download()}>
            {progress ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />} Download everything (.zip)
          </Button>
          <p className="text-xs text-ink-500" role="status">
            {progress ?? saved ?? "Loads, drivers, trucks, messages, calls and every file."}
          </p>
        </div>

        {!asking ? (
          <div>
            <Button size="sm" variant="ghost" className="text-[var(--accent-danger)]" onClick={() => setAsking(true)}>
              <Trash2 className="h-3.5 w-3.5" /> Delete account…
            </Button>
          </div>
        ) : (
          <div className="rounded-2xl border border-[var(--accent-danger)]/40 p-4">
            <p className="text-sm font-medium text-ink-900">Delete {name} from Backroute?</p>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-ink-700">
              <li>Your subscription is cancelled now.</li>
              <li>Loads, drivers, trucks, messages, calls, files and settings are deleted, and everyone is signed out.</li>
              <li>Nothing more goes to your brokers or drivers. Loads on the road are yours to finish.</li>
              <li>We keep only that the account existed, and each driver&apos;s answer about texts and calls (the record of their consent).</li>
              <li>This can&apos;t be undone. Download everything first if you want a copy.</li>
            </ul>
            <label className="mt-3 block text-xs text-ink-700" htmlFor="leave-confirm">
              Type <span className="font-medium text-ink-900">{name}</span> to confirm
            </label>
            <input id="leave-confirm" className={`${input} mt-1`} value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
            <div className="mt-3 flex flex-wrap gap-2">
              <Button size="sm" variant="danger" disabled={deleting || typed.trim().toLowerCase() !== name.trim().toLowerCase()} onClick={() => void remove()}>
                {deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />} Delete everything
              </Button>
              <Button size="sm" variant="ghost" disabled={deleting} onClick={() => (setAsking(false), setTyped(""))}>
                Keep my account
              </Button>
            </div>
          </div>
        )}
        {error && <p className="text-xs text-[var(--accent-danger)]" role="alert">{error}</p>}
      </CardContent>
    </Card>
  );
}
