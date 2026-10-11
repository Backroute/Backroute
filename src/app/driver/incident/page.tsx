"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { AlertTriangle, ArrowLeft, CloudRain, Clock, Phone, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { usePrimaryDriver, useCarrierTrucks } from "@/lib/selectors";
import { useStore } from "@/lib/store";
import type { IncidentType } from "@/lib/types";
import { LargeTitle } from "@/components/ui/large-title";
import { usePagesText } from "@/lib/lang/pages-ui";

const TYPES: { key: IncidentType; icon: typeof Wrench }[] = [
  { key: "breakdown", icon: Wrench },
  { key: "accident", icon: AlertTriangle },
  { key: "delay", icon: Clock },
  { key: "weather", icon: CloudRain },
];

export default function ReportIncidentPage() {
  const router = useRouter();
  const driver = usePrimaryDriver();
  const trucks = useCarrierTrucks();
  const truck = trucks.find((t) => t.id === driver.truckId);
  const reportIncident = useStore((s) => s.actions.reportIncident);
  const p = usePagesText();

  const [type, setType] = useState<IncidentType | null>(null);
  const [note, setNote] = useState("");
  const [sent, setSent] = useState(false);
  // "Call instead" reaches the same AI dispatch line as everywhere else, in the language the driver talks in.
  const startInboundCall = useStore((s) => s.actions.startInboundCall);

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
        <p className="font-display text-xl text-ink-950">{p.inc.onIt}</p>
        <p className="text-sm text-ink-500">{type === "accident" ? p.inc.sentAccident : p.inc.sent}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5 px-5">
      <button onClick={() => router.back()} className="flex items-center gap-1.5 text-xs font-medium text-ink-500">
        <ArrowLeft className="h-3.5 w-3.5" /> {p.inc.back}
      </button>

      <div>
        <LargeTitle className="font-display text-2xl text-ink-950">{p.inc.title}</LargeTitle>
        <p className="mt-1 text-sm text-ink-500">{p.inc.sub}</p>
      </div>

      <button
        onClick={() => startInboundCall(driver.id)}
        className="flex items-center justify-center gap-2 rounded-2xl border border-line py-3 text-sm font-medium text-ink-700"
      >
        <Phone className="h-4 w-4" /> {p.inc.callInstead}
      </button>

      <div className="flex items-center gap-3 text-xs font-medium uppercase tracking-wider text-ink-300">
        <span className="h-px flex-1 bg-line" /> {p.inc.orType} <span className="h-px flex-1 bg-line" />
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
              <span className="block text-sm font-medium">{p.inc.types[t.key][0]}</span>
              <span className={cn("block text-xs", type === t.key ? "text-white/60" : "text-ink-500")}>{p.inc.types[t.key][1]}</span>
            </span>
          </button>
        ))}
      </div>

      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder={p.inc.notePlaceholder}
        rows={3}
        className="rounded-2xl border border-line bg-ink-50/60 p-3.5 text-sm outline-none focus:border-ink-400"
      />

      <Button size="lg" disabled={!type} onClick={handleSubmit}>
        {p.inc.send}
      </Button>

    </div>
  );
}
