"use client";

import { useStore } from "@/lib/store";
import { ActivityFeed } from "@/components/shared/activity-feed";
import { LiveDot } from "@/components/shared/live-dot";

export function LiveTicker() {
  const events = useStore((s) => s.activity).slice(0, 6);
  const metrics = useStore((s) => s.liveMetrics);

  return (
    <div className="rounded-3xl border border-white/10 bg-ink-900 p-6 sm:p-8">
      <div className="flex items-center justify-between">
        <div>
          <p className="font-display text-xl text-white">Live activity, right now</p>
          <p className="mt-1 text-sm text-white/50">Simulated live feed from the Backroute dispatcher engine</p>
        </div>
        <LiveDot />
      </div>

      <div className="mt-6 grid grid-cols-3 gap-4 border-y border-white/10 py-4">
        <div>
          <p className="font-display tabular text-2xl text-white">{metrics.activeCalls}</p>
          <p className="mt-0.5 text-[11px] uppercase tracking-wider text-white/40">Calls in progress</p>
        </div>
        <div>
          <p className="font-display tabular text-2xl text-white">{metrics.activeSmsThreads + metrics.activeEmailThreads}</p>
          <p className="mt-0.5 text-[11px] uppercase tracking-wider text-white/40">SMS + email threads</p>
        </div>
        <div>
          <p className="font-display tabular text-2xl text-white">{metrics.boardsConnected}</p>
          <p className="mt-0.5 text-[11px] uppercase tracking-wider text-white/40">Boards scanned</p>
        </div>
      </div>

      <div className="mt-2 [&_li]:border-white/10 [&_.text-ink-900]:text-white [&_.text-ink-500]:text-white/50 [&_.text-ink-400]:text-white/40 [&_.bg-ink-100]:bg-white/10 [&_.bg-ink-100]:text-white/70">
        <ActivityFeed events={events} dense />
      </div>
    </div>
  );
}
