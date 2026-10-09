"use client";

import { useEffect, useState } from "react";
import { History } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useStore } from "@/lib/store";
import { supabase } from "@/lib/cloud/client";
import { TimeAgo } from "@/components/shared/time-ago";

interface Entry {
  id: number;
  at: string;
  who: string;
  action: string;
  target: string | null;
}

const WHO: Record<string, string> = { owner: "Owner", dispatcher: "Dispatcher", bookkeeper: "Bookkeeper", driver: "Driver", ai: "Backroute", support: "Backroute support" };

/** Who changed what: people let in or removed, settings, loads moving, rates set, invoices and drivers paid. Owner only. */
export function AuditLogCard() {
  const carrierId = useStore((s) => s.session.carrierId);
  const signedIn = useStore((s) => s.session.mode === "office");
  const [rows, setRows] = useState<Entry[] | null>(null);
  const [who, setWho] = useState("");

  useEffect(() => {
    if (!signedIn || !carrierId) return;
    let q = supabase().from("audit_log").select("id, at, who, action, target").eq("carrier_id", carrierId).order("at", { ascending: false }).limit(100);
    if (who) q = q.eq("who", who);
    void q.then(({ data }) => setRows((data ?? []) as Entry[]));
  }, [carrierId, signedIn, who]);

  if (!signedIn) return null;
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle className="flex items-center gap-2">
            <History className="h-4 w-4" /> Who changed what
          </CardTitle>
          <CardDescription>The last 100 changes by anyone on the team, Backroute, or Backroute support. Only the owner sees this.</CardDescription>
        </div>
        <select aria-label="Who" value={who} onChange={(e) => setWho(e.target.value)} className="h-9 rounded-full border border-line bg-white px-3 text-sm">
          <option value="">Everyone</option>
          {Object.entries(WHO).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </CardHeader>
      <CardContent className="!pt-3">
        <ul className="flex flex-col divide-y divide-line text-sm">
          {(rows ?? []).map((r) => (
            <li key={r.id} className="flex items-baseline justify-between gap-3 py-2">
              <span className="min-w-0">
                <span className="font-medium text-ink-900">{WHO[r.who] ?? r.who}</span> <span className="text-ink-700">{r.action.toLowerCase()}</span>
                {r.target && <span className="text-ink-500"> · {r.target}</span>}
              </span>
              <TimeAgo iso={r.at} className="shrink-0 text-xs text-ink-400" />
            </li>
          ))}
          {rows && !rows.length && <li className="py-2 text-ink-500">Nothing yet.</li>}
          {!rows && <li className="py-2 text-ink-500">Loading…</li>}
        </ul>
      </CardContent>
    </Card>
  );
}
