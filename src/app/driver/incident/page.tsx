"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { AlertTriangle, ArrowLeft, CloudRain, Clock, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { usePrimaryDriver, useCarrierTrucks } from "@/lib/selectors";
import { useStore } from "@/lib/store";
import type { IncidentType } from "@/lib/types";

const TYPES: { key: IncidentType; label: string; icon: typeof Wrench; desc: string }[] = [
  { key: "breakdown", label: "Breakdown", icon: Wrench, desc: "Mechanical issue, need roadside help" },
  { key: "accident", label: "Accident", icon: AlertTriangle, desc: "Collision or safety incident" },
  { key: "delay", label: "Running late", icon: Clock, desc: "Traffic, detention, or appointment slip" },
  { key: "weather", label: "Weather", icon: CloudRain, desc: "Storm, snow, or road closure" },
];

export default function ReportIncidentPage() {
  const router = useRouter();
  const driver = usePrimaryDriver();
  const trucks = useCarrierTrucks();
  const truck = trucks.find((t) => t.id === driver.truckId);
  const reportIncident = useStore((s) => s.actions.reportIncident);

  const [type, setType] = useState<IncidentType | null>(null);
  const [note, setNote] = useState("");
  const [sent, setSent] = useState(false);

  function handleSubmit() {
    if (!type || !truck) return;
    reportIncident(driver.id, truck.id, type, note.trim());
    setSent(true);
    setTimeout(() => router.push("/driver"), 1400);
  }

  if (sent) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 px-5 py-24 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-ink-950 text-white">
          <AlertTriangle className="h-6 w-6" />
        </div>
        <p className="font-display text-xl text-ink-950">AI dispatcher is on it</p>
        <p className="text-sm text-ink-500">
          {type === "accident"
            ? "Notifying the broker, working the checklist, and looping in a live human safety specialist now — check Home for live status."
            : "Notifying the broker and working the checklist now — check Home for live status."}
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5 px-5">
      <button onClick={() => router.back()} className="flex items-center gap-1.5 text-xs font-medium text-ink-500">
        <ArrowLeft className="h-3.5 w-3.5" /> Back
      </button>

      <div>
        <h1 className="font-display text-2xl text-ink-950">Report an issue</h1>
        <p className="mt-1 text-sm text-ink-500">Tell us what&apos;s going on — the AI dispatcher takes it from here.</p>
      </div>

      <div className="flex flex-col gap-2.5">
        {TYPES.map((t) => (
          <button
            key={t.key}
            onClick={() => setType(t.key)}
            className={cn(
              "flex items-center gap-3 rounded-2xl border p-4 text-left transition-colors",
              type === t.key ? "border-ink-950 bg-ink-950 text-white" : "border-line",
            )}
          >
            <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-full", type === t.key ? "bg-white/15" : "bg-ink-100")}>
              <t.icon className="h-4 w-4" />
            </span>
            <span>
              <span className="block text-sm font-medium">{t.label}</span>
              <span className={cn("block text-xs", type === t.key ? "text-white/60" : "text-ink-500")}>{t.desc}</span>
            </span>
          </button>
        ))}
      </div>

      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Anything else the dispatcher should know? (optional)"
        rows={3}
        className="rounded-2xl border border-line bg-ink-50/60 p-3.5 text-sm outline-none focus:border-ink-400"
      />

      <Button size="lg" disabled={!type} onClick={handleSubmit}>
        Send to AI dispatcher
      </Button>
    </div>
  );
}
