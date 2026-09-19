import { MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Load } from "@/lib/types";

interface Point {
  key: string;
  label: string;
  sublabel: string;
  done: boolean;
  action?: React.ReactNode;
}

/** Origin → intermediate stops → destination, in one connected line. Origin is always "done" (the
 *  load already exists) and destination is "done" once delivered; intermediate stops carry their own
 *  completed flag. Used on both the carrier and driver load-detail pages — the driver's copy passes
 *  onCompleteStop so the next open stop gets a "Mark complete" button, the carrier's is read-only. */
export function StopsTimeline({ load, onCompleteStop }: { load: Load; onCompleteStop?: (stopId: string) => void }) {
  if (!load.stops || load.stops.length === 0) return null;
  const sorted = [...load.stops].sort((a, b) => a.sequence - b.sequence);
  const nextStopId = sorted.find((s) => !s.completed)?.id;

  const points: Point[] = [
    { key: "origin", label: `${load.lane.origin}, ${load.lane.originState}`, sublabel: `Pickup · ${load.pickupWindow}`, done: true },
    ...sorted.map((s) => ({
      key: s.id,
      label: `${s.city}, ${s.state}`,
      sublabel: `${s.kind === "pickup" ? "Pickup" : "Delivery"} · ${s.window}`,
      done: s.completed,
      action: onCompleteStop && s.id === nextStopId ? (
        <Button size="sm" variant="outline" onClick={() => onCompleteStop(s.id)}>Mark complete</Button>
      ) : undefined,
    })),
    { key: "destination", label: `${load.lane.destination}, ${load.lane.destState}`, sublabel: `Delivery · ${load.deliveryWindow}`, done: load.stage === "delivered" },
  ];

  return (
    <div className="flex flex-col">
      {points.map((p, i) => (
        <div key={p.key}>
          <div className="flex items-start gap-3">
            <span
              className={cn(
                "flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2",
                p.done ? "border-ink-950 bg-ink-950 text-white" : "border-ink-300 text-ink-400",
              )}
            >
              <MapPin className="h-3.5 w-3.5" />
            </span>
            <div className={cn("min-w-0 flex-1", i < points.length - 1 && "pb-3")}>
              <p className={cn("text-sm font-medium", p.done ? "text-ink-950" : "text-ink-600")}>{p.label}</p>
              <p className="text-xs text-ink-500">{p.sublabel}</p>
              {p.action && <div className="mt-2">{p.action}</div>}
            </div>
          </div>
          {i < points.length - 1 && <div className="ml-3.5 -my-1 h-3 w-px bg-ink-200" />}
        </div>
      ))}
    </div>
  );
}
